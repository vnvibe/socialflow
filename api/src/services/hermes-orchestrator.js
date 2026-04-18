/**
 * Hermes Campaign Orchestrator
 *
 * Reads the current state of a running campaign, asks Hermes for concrete
 * next-step actions, executes auto-applyable actions, and logs everything
 * to `hermes_decisions` for the UI audit tab.
 *
 * Entry points:
 *   runOrchestration(campaignId, supabase) — one-shot, returns result + decisions
 *   runAllRunningCampaigns(supabase)       — cron hook, iterates is_active=true
 *
 * See HERMES_ORCHESTRATOR.md for the design spec.
 */

const { randomUUID } = require('crypto')
const { checkAndReserve } = require('./nick-quota')

const HERMES_URL = process.env.HERMES_URL || 'http://127.0.0.1:8100'
const AGENT_SECRET = process.env.AGENT_SECRET

// ─── Hermes call helper ────────────────────────────────────
async function callHermes(taskType, userContent, maxTokens = 1500) {
  if (!AGENT_SECRET) throw new Error('AGENT_SECRET not configured')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  try {
    const res = await fetch(`${HERMES_URL}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Key': AGENT_SECRET },
      body: JSON.stringify({
        messages: [{ role: 'user', content: userContent }],
        max_tokens: maxTokens,
        temperature: 0.3,
        task_type: taskType,
        function_name: taskType,
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`Hermes ${taskType} HTTP ${res.status}`)
    const json = await res.json()
    return json.text
  } finally {
    clearTimeout(timer)
  }
}

function extractJson(text) {
  if (!text) return null
  // Strip ```json ... ``` fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? fenced[1] : text
  // Find first { ... } block
  const start = body.indexOf('{')
  if (start === -1) return null
  // Walk forward matching braces (avoids trailing garbage after the json)
  let depth = 0
  for (let i = start; i < body.length; i++) {
    if (body[i] === '{') depth++
    else if (body[i] === '}') {
      depth--
      if (depth === 0) {
        try { return JSON.parse(body.slice(start, i + 1)) } catch { return null }
      }
    }
  }
  return null
}

// ─── Context builder ───────────────────────────────────────
async function buildOrchestrationContext(campaignId, supabase) {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('*')
    .eq('id', campaignId)
    .single()
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`)

  // Roles + nicks assigned
  const { data: roles } = await supabase
    .from('campaign_roles')
    .select('id, name, role_type, account_ids, is_active')
    .eq('campaign_id', campaignId)
  const allAccountIds = new Set()
  for (const r of roles || []) (r.account_ids || []).forEach(id => allAccountIds.add(id))

  let nicks = []
  if (allAccountIds.size > 0) {
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, username, status, is_active, last_used_at, daily_budget, created_at')
      .in('id', [...allAccountIds])

    // Per-nick: jobs_today, active_job, failed_jobs
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const { data: todayJobs } = await supabase
      .from('jobs')
      .select('id, payload, status, started_at')
      .gte('created_at', since)
      .in('status', ['pending', 'claimed', 'running', 'done', 'failed'])

    const jobsByNick = new Map()
    for (const j of todayJobs || []) {
      const accId = j.payload?.account_id
      if (!accId) continue
      const entry = jobsByNick.get(accId) || { done: 0, failed: 0, active: null }
      if (j.status === 'done') entry.done++
      else if (j.status === 'failed') entry.failed++
      else if (['claimed', 'running'].includes(j.status)) entry.active = j.id
      jobsByNick.set(accId, entry)
    }

    const roleByAcc = new Map()
    for (const r of roles || []) {
      for (const accId of r.account_ids || []) {
        if (!roleByAcc.has(accId)) roleByAcc.set(accId, r.role_type)
      }
    }

    nicks = (accounts || []).map(a => {
      const jobStats = jobsByNick.get(a.id) || { done: 0, failed: 0, active: null }
      const idleMs = a.last_used_at ? Date.now() - new Date(a.last_used_at).getTime() : Infinity
      const idleMinutes = isFinite(idleMs) ? Math.floor(idleMs / 60000) : 999
      return {
        id: a.id,
        username: a.username,
        status: a.status || 'unknown',
        is_active: a.is_active !== false,
        role: roleByAcc.get(a.id) || 'unknown',
        jobs_today: jobStats.done,
        jobs_failed: jobStats.failed,
        active_job: jobStats.active,
        idle_minutes: idleMinutes,
        hermes_score: null, // filled by score service if present
      }
    })
  }

  // Campaign groups via junction
  const { data: junction } = await supabase
    .from('campaign_groups')
    .select('group_id, status, fb_groups!inner(id, fb_group_id, name, url, member_count, join_status, pending_since, last_posted_at, consecutive_skips)')
    .eq('campaign_id', campaignId)

  const groupIds = (junction || []).map(r => r.group_id).filter(Boolean)

  // Check-history per group: pending/running jobs + past finished checks.
  // Lets the skill distinguish "pending because FB hasn't approved yet" from
  // "pending because no nick has checked it yet".
  const checkHistory = new Map() // group_id → { has_check_job, last_check_at, check_count }
  if (groupIds.length) {
    try {
      const { data: checkJobs } = await supabase
        .from('jobs')
        .select('payload, status, finished_at, created_at')
        .eq('type', 'check_group_membership')
        .in('status', ['pending', 'claimed', 'running', 'done', 'failed'])
        .gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString())
      for (const j of checkJobs || []) {
        const gid = j.payload?.group_row_id
        if (!gid || !groupIds.includes(gid)) continue
        const entry = checkHistory.get(gid) || { has_check_job: false, last_check_at: null, check_count: 0 }
        const inflight = ['pending', 'claimed', 'running'].includes(j.status)
        if (inflight) entry.has_check_job = true
        const ts = j.finished_at || j.created_at
        if (ts && (!entry.last_check_at || new Date(ts) > new Date(entry.last_check_at))) {
          entry.last_check_at = ts
        }
        if (j.status === 'done' || j.status === 'failed') entry.check_count++
        checkHistory.set(gid, entry)
      }
    } catch {}
  }

  const groups = (junction || []).map(r => {
    const g = r.fb_groups || {}
    const pendingDays = g.pending_since
      ? Math.floor((Date.now() - new Date(g.pending_since).getTime()) / 86400000)
      : null
    const hist = checkHistory.get(g.id) || { has_check_job: false, last_check_at: null, check_count: 0 }
    return {
      id: g.id,
      fb_group_id: g.fb_group_id,
      name: g.name,
      join_status: g.join_status || 'unknown',
      member_count: g.member_count || 0,
      pending_days: pendingDays,
      posts_this_week: null, // expensive to compute; skip for now
      last_posted_at: g.last_posted_at,
      consecutive_skips: g.consecutive_skips || 0,
      // New (2026-04-17): so Hermes can decide "recheck vs skip" smartly
      has_check_job: hist.has_check_job,
      last_check_at: hist.last_check_at,
      check_count: hist.check_count,
    }
  })

  // Stats today
  const todayStart = new Date()
  todayStart.setUTCHours(0, 0, 0, 0)
  const { data: statsLog } = await supabase
    .from('campaign_activity_log')
    .select('action_type')
    .eq('campaign_id', campaignId)
    .gte('created_at', todayStart.toISOString())
  const stats = { comments: 0, posts: 0, interactions: 0, likes: 0, failed_jobs: 0, checkpoints: 0 }
  for (const row of statsLog || []) {
    const t = row.action_type
    if (t === 'comment') stats.comments++
    else if (t === 'post') stats.posts++
    else if (t === 'like') stats.likes++
    else stats.interactions++
  }
  const { count: failedTodayCount } = await supabase
    .from('job_failures')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .gte('created_at', todayStart.toISOString())
  stats.failed_jobs = failedTodayCount || 0
  stats.checkpoints = (nicks || []).filter(n => n.status === 'checkpoint').length

  const runningDays = campaign.created_at
    ? Math.floor((Date.now() - new Date(campaign.created_at).getTime()) / 86400000)
    : 0

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      owner_id: campaign.owner_id || campaign.created_by || null,
      goal: campaign.goal || campaign.mission || null,
      hermes_context: campaign.hermes_context || null,
      brand_config: campaign.brand_config || null,
      status: campaign.is_active ? 'running' : 'paused',
      running_days: runningDays,
    },
    nicks,
    groups,
    stats_today: stats,
    target: {
      comments_per_day: campaign.target_comments_per_day || 20,
      posts_per_day: campaign.target_posts_per_day || 3,
    },
  }
}

// 30-minute dedup window — don't let the orchestrator pile up jobs of the
// same type for the same nick when a previous recommendation is still pending.
// Prevents the "check already queued" noise seen in production + saves
// capacity on the 2-slot agent.
async function recentJobExists(supabase, { accountId, jobType, windowMinutes = 30 }) {
  if (!accountId) return false
  const since = new Date(Date.now() - windowMinutes * 60000).toISOString()
  const { data } = await supabase
    .from('jobs')
    .select('id, payload, status, created_at')
    .eq('type', jobType)
    .in('status', ['pending', 'claimed', 'running'])
    .gte('created_at', since)
  return (data || []).some(j => j.payload?.account_id === accountId)
}

// Build consistent payload for orchestrator-created jobs. Every job MUST carry
// owner_id so the agent's activity logger can insert into campaign_activity_log
// (owner_id is NOT NULL in schema). Observed bug: agent flushed null owner_id
// and the whole batch rolled back.
function orchestratorPayload(context, extras = {}) {
  return {
    campaign_id: context.campaign?.id,
    owner_id: context.campaign?.owner_id || null,
    orchestrator: true,
    ...extras,
  }
}

// ─── Action executors ──────────────────────────────────────
async function executeAction(action, campaignId, context, supabase) {
  switch (action.type) {
    case 'assign_job': {
      const accId = action.target_id
      const jobType = action.action_detail?.job_type || 'campaign_nurture'
      const groupId = action.action_detail?.group_id || null
      const nick = (context.nicks || []).find(n => n.id === accId)
      if (!nick) return { ok: false, detail: 'nick not found in context' }
      if (nick.active_job) return { ok: false, detail: 'nick already has active job' }

      // Dedup: if a same-type job for this nick is already in-flight within
      // the last 30 minutes, skip silently. The in-flight one covers the need.
      if (await recentJobExists(supabase, { accountId: accId, jobType })) {
        return { ok: false, detail: `${jobType} for nick already queued <30min` }
      }

      // Daily quota: cap creation per (nick, job_type, day) to match agent
      // drain rate. Without this, orchestrator + other crons would keep
      // queuing beyond what the 2-slot agent can process.
      const quotaRes = await checkAndReserve(supabase, { accountId: accId, jobType })
      if (!quotaRes.ok) {
        return { ok: false, detail: `${jobType} daily quota exhausted (${quotaRes.count}/${quotaRes.quota})` }
      }

      // Find the role for this nick in this campaign.
      // pg-supabase wrapper doesn't implement .contains() for arrays, so pull
      // all roles for the campaign and filter in JS.
      const { data: roles } = await supabase
        .from('campaign_roles')
        .select('id, account_ids')
        .eq('campaign_id', campaignId)
      const roleRow = (roles || []).find(r => (r.account_ids || []).includes(accId))

      const { data: inserted, error } = await supabase
        .from('jobs')
        .insert({
          type: jobType,
          priority: 2,
          status: 'pending',
          scheduled_at: new Date().toISOString(),
          payload: orchestratorPayload(context, {
            account_id: accId,
            role_id: roleRow?.id || null,
            group_id: groupId,
          }),
          created_by: context.campaign?.owner_id || null,
        })
        .select('id')
        .single()
      if (error) return { ok: false, detail: error.message }
      return { ok: true, detail: `job ${inserted.id} created` }
    }

    case 'skip_group': {
      const { error } = await supabase
        .from('fb_groups')
        .update({
          join_status: 'rejected',
          blocked_reason: action.action_detail?.reason || 'orchestrator_skip',
          is_blocked: true,
        })
        .eq('id', action.target_id)
      if (error) return { ok: false, detail: error.message }
      // Also deactivate junction row so schedulers stop seeing it
      await supabase
        .from('campaign_groups')
        .update({ status: 'skipped' })
        .eq('campaign_id', campaignId)
        .eq('group_id', action.target_id)
      return { ok: true, detail: 'group marked skipped' }
    }

    case 'recheck_group': {
      const accountId = action.action_detail?.account_id
        || (context.nicks || []).find(n => n.status === 'healthy')?.id
      if (!accountId) return { ok: false, detail: 'no healthy nick available to recheck from' }

      // Dedup: skip if a pending membership check already exists for this group.
      // Keep the per-group dedup (not just per-nick) because membership checks
      // are keyed by group_row_id.
      const { data: existingJobs } = await supabase
        .from('jobs')
        .select('id, payload')
        .eq('type', 'check_group_membership')
        .in('status', ['pending', 'running', 'claimed'])
      const dup = (existingJobs || []).some(j => j.payload?.group_row_id === action.target_id)
      if (dup) return { ok: false, detail: 'check already queued' }

      // Daily quota on the nick that will run the check
      const qr = await checkAndReserve(supabase, { accountId, jobType: 'check_group_membership' })
      if (!qr.ok) return { ok: false, detail: `check_group_membership daily quota exhausted (${qr.count}/${qr.quota})` }

      const { error } = await supabase.from('jobs').insert({
        type: 'check_group_membership',
        priority: 7,
        status: 'pending',
        scheduled_at: new Date(Date.now() + 60000).toISOString(),
        payload: orchestratorPayload(context, {
          account_id: accountId,
          group_row_id: action.target_id,
        }),
        created_by: context.campaign?.owner_id || null,
      })
      if (error) return { ok: false, detail: error.message }
      return { ok: true, detail: 'recheck queued' }
    }

    case 'reassign_nick': {
      const newRole = action.action_detail?.new_role
      if (!newRole) return { ok: false, detail: 'new_role required' }
      // Nothing to do structurally — roles are lists of account_ids.
      // Log only; user needs to move nick between roles in UI.
      return { ok: false, detail: 'reassign is user-facing; logged for review' }
    }

    case 'pause_nick': {
      const { error } = await supabase
        .from('accounts')
        .update({ is_active: false })
        .eq('id', action.target_id)
      if (error) return { ok: false, detail: error.message }
      return { ok: true, detail: 'nick paused (is_active=false)' }
    }

    case 'alert_user': {
      // Write a notification row so the user sees it in the UI
      const { error } = await supabase.from('notifications').insert({
        user_id: context.campaign?.owner_id || null,
        type: 'orchestrator_alert',
        title: `Hermes: ${action.target_name || action.target_id}`,
        body: action.reason + (action.action_detail?.message ? ` — ${action.action_detail.message}` : ''),
        level: action.action_detail?.severity === 'urgent' ? 'urgent' : 'warning',
        data: { campaign_id: campaignId, target_id: action.target_id },
      })
      if (error) return { ok: false, detail: error.message }
      return { ok: true, detail: 'notification created' }
    }

    case 'create_content':
    default:
      return { ok: false, detail: `action type '${action.type}' not implemented` }
  }
}

// ─── Main orchestration run ────────────────────────────────
async function runOrchestration(campaignId, supabase) {
  const started = Date.now()
  const orchestrationId = randomUUID()
  const context = await buildOrchestrationContext(campaignId, supabase)

  let result
  try {
    const raw = await callHermes('orchestrator', JSON.stringify(context), 1500)
    result = extractJson(raw)
    if (!result) throw new Error('Hermes returned unparseable JSON')
  } catch (err) {
    console.error(`[ORCHESTRATOR] ${campaignId}: Hermes call failed — ${err.message}`)
    throw err
  }

  const actions = Array.isArray(result.actions) ? result.actions : []
  const executed = []
  for (const action of actions) {
    let outcome = 'pending'
    let detail = null
    let appliedAt = null
    if (action.auto_apply) {
      try {
        const r = await executeAction(action, campaignId, context, supabase)
        outcome = r.ok ? 'success' : 'failed'
        detail = r.detail
        appliedAt = new Date().toISOString()
      } catch (err) {
        outcome = 'failed'
        detail = err.message
      }
    }

    await supabase.from('hermes_decisions').insert({
      campaign_id: campaignId,
      orchestration_id: orchestrationId,
      decision_type: 'orchestration',
      action_type: action.type,
      target_id: action.target_id || null,
      target_name: action.target_name || null,
      priority: action.priority || null,
      reason: action.reason || null,
      context_summary: result.summary || null,
      decision: action,
      auto_apply: !!action.auto_apply,
      auto_applied: action.auto_apply && outcome === 'success',
      applied_at: appliedAt,
      outcome,
      outcome_detail: detail,
    })

    executed.push({ ...action, outcome, outcome_detail: detail })
  }

  // Also log the top-level summary row (decision_type=orchestration, action_type=null)
  await supabase.from('hermes_decisions').insert({
    campaign_id: campaignId,
    orchestration_id: orchestrationId,
    decision_type: 'orchestration_summary',
    decision: {
      summary: result.summary,
      health_score: result.health_score,
      issues: result.issues,
      next_review_minutes: result.next_review_minutes,
      total_actions: actions.length,
      elapsed_ms: Date.now() - started,
    },
    auto_apply: false,
    auto_applied: false,
    outcome: 'success',
  })

  console.log(`[ORCHESTRATOR] campaign=${campaignId} health=${result.health_score} actions=${actions.length} auto=${executed.filter(a => a.auto_apply && a.outcome === 'success').length} (${Date.now() - started}ms)`)

  return {
    orchestration_id: orchestrationId,
    summary: result.summary,
    health_score: result.health_score,
    issues: result.issues || [],
    actions: executed,
    next_review_minutes: result.next_review_minutes,
    context_nicks: context.nicks.length,
    context_groups: context.groups.length,
  }
}

async function runAllRunningCampaigns(supabase) {
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, name')
    .eq('is_active', true)
  if (!campaigns?.length) return { ran: 0 }

  let ran = 0
  for (const c of campaigns) {
    try {
      await runOrchestration(c.id, supabase)
      ran++
    } catch (err) {
      console.error(`[ORCHESTRATOR] Failed for ${c.name || c.id}: ${err.message}`)
    }
  }
  return { ran, total: campaigns.length }
}

// ─── Reporter ──────────────────────────────────────────────
async function generateReport(campaignId, supabase) {
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, name')
    .eq('id', campaignId)
    .single()
  if (!campaign) throw new Error('Campaign not found')

  const since = new Date(Date.now() - 7 * 86400000).toISOString()
  const { data: logs } = await supabase
    .from('campaign_activity_log')
    .select('action_type, account_id')
    .eq('campaign_id', campaignId)
    .gte('created_at', since)

  const stats = { comments: 0, posts: 0, friend_requests: 0, interactions: 0 }
  const perNick = new Map()
  for (const row of logs || []) {
    const t = row.action_type
    if (t === 'comment') stats.comments++
    else if (t === 'post') stats.posts++
    else if (t === 'friend_request') stats.friend_requests++
    stats.interactions++
    if (row.account_id) {
      perNick.set(row.account_id, (perNick.get(row.account_id) || 0) + 1)
    }
  }

  const topNickIds = [...perNick.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => id)
  const { data: topNickRows } = await supabase
    .from('accounts').select('id, username').in('id', topNickIds.length ? topNickIds : ['00000000-0000-0000-0000-000000000000'])

  const top_nicks = topNickIds.map(id => {
    const a = (topNickRows || []).find(r => r.id === id)
    return { username: a?.username || '?', jobs: perNick.get(id) || 0 }
  })

  const { count: checkpoints } = await supabase
    .from('job_failures')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('error_type', 'CHECKPOINT')
    .gte('created_at', since)

  const input = {
    campaign_name: campaign.name,
    stats_7d: { ...stats, checkpoints: checkpoints || 0 },
    top_nicks,
    top_groups: [],      // would need per-group engagement aggregation
    failed_reasons: [],
    memory_insights: [],
  }

  const raw = await callHermes('reporter', JSON.stringify(input), 1200)
  const report = extractJson(raw)
  if (!report) throw new Error('Reporter returned unparseable JSON')

  await supabase.from('hermes_decisions').insert({
    campaign_id: campaignId,
    decision_type: 'reporter',
    decision: report,
    context_summary: JSON.stringify(input),
    auto_apply: false,
    auto_applied: false,
    outcome: 'success',
  })
  return report
}

// ─── Daily Self-Review ─────────────────────────────────────
const HERMES_URL2 = process.env.HERMES_URL || 'http://127.0.0.1:8100'

async function hermesPut(path, body) {
  const res = await fetch(`${HERMES_URL2}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Key': AGENT_SECRET },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) }
}

async function fetchCurrentSkill(taskType) {
  try {
    const res = await fetch(`${HERMES_URL2}/skills/${encodeURIComponent(taskType)}`, {
      headers: { 'X-Agent-Key': AGENT_SECRET },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const j = await res.json()
    // Returns { task_type, content, file } or similar — the full md text
    return j.content || j.prompt || j.text || null
  } catch { return null }
}

async function buildReviewContext(supabase) {
  const dayStart = new Date()
  dayStart.setUTCHours(0, 0, 0, 0)
  const dayStartIso = dayStart.toISOString()
  const dateStr = dayStart.toISOString().slice(0, 10)

  // Calls summary per task_type
  const { data: calls } = await supabase
    .from('hermes_calls')
    .select('task_type, latency_ms, ok')
    .gte('created_at', dayStartIso)

  const callsMap = new Map()
  for (const c of calls || []) {
    const e = callsMap.get(c.task_type) || { count: 0, latency_sum: 0, errors: 0 }
    e.count++
    e.latency_sum += c.latency_ms || 0
    if (!c.ok) e.errors++
    callsMap.set(c.task_type, e)
  }
  const calls_summary = [...callsMap.entries()].map(([task_type, e]) => ({
    task_type,
    count: e.count,
    avg_latency_ms: Math.round(e.latency_sum / e.count),
    error_rate: +(e.errors / e.count).toFixed(3),
  }))

  // Feedback per task_type (stats)
  const { data: feedback } = await supabase
    .from('hermes_feedback')
    .select('id, task_type, score, reason, output_text, prompt')
    .gte('created_at', dayStartIso)

  const fbMap = new Map()
  for (const f of feedback || []) {
    const e = fbMap.get(f.task_type) || { count: 0, sum: 0, dist: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }
    e.count++
    e.sum += f.score
    if (e.dist[f.score] !== undefined) e.dist[f.score]++
    fbMap.set(f.task_type, e)
  }
  const feedback_by_skill = [...fbMap.entries()].map(([task_type, e]) => ({
    task_type,
    count: e.count,
    avg_score: +(e.sum / e.count).toFixed(2),
    score_dist: e.dist,
  }))

  // Low-score samples (<=2) for rewrite context + purge candidates
  const low_score_samples = (feedback || [])
    .filter(f => f.score <= 2)
    .slice(0, 30)
    .map(f => ({
      id: f.id,
      task_type: f.task_type,
      score: f.score,
      reason: f.reason,
      output: (f.output_text || '').slice(0, 300),
      prompt_preview: (f.prompt || '').slice(0, 200),
    }))

  // Jobs today
  const { data: todayJobs } = await supabase
    .from('jobs')
    .select('status, error_message')
    .gte('created_at', dayStartIso)
    .in('status', ['done', 'failed'])
  const jobs_stats = { done: 0, failed: 0, errors: {} }
  for (const j of todayJobs || []) {
    if (j.status === 'done') jobs_stats.done++
    else if (j.status === 'failed') {
      jobs_stats.failed++
      const tag = (j.error_message || 'UNKNOWN').split(':')[0].trim().slice(0, 40)
      jobs_stats.errors[tag] = (jobs_stats.errors[tag] || 0) + 1
    }
  }
  const total = jobs_stats.done + jobs_stats.failed
  const success_rate = total > 0 ? +(jobs_stats.done / total).toFixed(3) : null
  const top_error = Object.entries(jobs_stats.errors).sort((a, b) => b[1] - a[1])[0]?.[0] || null

  // Comment rejection — proxy via campaign_activity_log action_type='comment' vs log of rejections
  const { count: commentsPosted } = await supabase
    .from('campaign_activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('action_type', 'comment')
    .gte('created_at', dayStartIso)
  const { count: commentsRejected } = await supabase
    .from('campaign_activity_log')
    .select('id', { count: 'exact', head: true })
    .eq('action_type', 'comment_rejected')
    .gte('created_at', dayStartIso)
  const postedN = commentsPosted || 0
  const rejectedN = commentsRejected || 0
  const comment_rejection = {
    posted: postedN,
    rejected_by_fb: rejectedN,
    rejection_rate: postedN + rejectedN > 0 ? +(rejectedN / (postedN + rejectedN)).toFixed(3) : 0,
  }

  // Fetch current skill prompts for any skill with avg_score < 3.5 (so Hermes can rewrite them)
  const low_skills = feedback_by_skill.filter(s => s.avg_score < 3.5).map(s => s.task_type)
  const current_skill_prompts = {}
  for (const t of low_skills.slice(0, 5)) {
    const content = await fetchCurrentSkill(t)
    if (content) current_skill_prompts[t] = content
  }

  // Recent checkpoint patterns — so self_reviewer can correlate skill/budget
  // recommendations with what actually killed nicks lately.
  let checkpoint_patterns = []
  try {
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString()
    const { data: patterns } = await supabase
      .from('ai_pilot_memory')
      .select('key, value, evidence_count, last_updated_at, account_id')
      .eq('memory_type', 'checkpoint_pattern')
      .gte('last_updated_at', since7d)
      .order('evidence_count', { ascending: false })
      .limit(20)
    checkpoint_patterns = (patterns || []).map(p => ({
      pattern: p.key,
      occurrences: p.evidence_count || 1,
      primary_cause: p.value?.primary_cause,
      summary: p.value?.summary,
      recommendations: p.value?.recommendations,
    }))
  } catch {}

  return {
    date: dateStr,
    calls_summary,
    feedback_by_skill,
    low_score_samples,
    jobs_stats: { ...jobs_stats, success_rate, top_error },
    comment_rejection,
    current_skill_prompts,
    checkpoint_patterns,
  }
}

async function applyReviewRecommendations(review, supabase) {
  const applied = {
    skills_rewritten: [],
    skills_rewrite_failed: [],
    feedback_purged: 0,
    quality_gate_updated: null,
  }

  // 1. Rewrite skills with provided new_prompt
  for (const s of review.skills_to_rewrite || []) {
    if (!s.task_type || !s.new_prompt) continue
    try {
      const r = await hermesPut(`/skills/${encodeURIComponent(s.task_type)}`, { content: s.new_prompt })
      if (r.ok) applied.skills_rewritten.push({ task_type: s.task_type, reason: s.reason })
      else applied.skills_rewrite_failed.push({ task_type: s.task_type, status: r.status })
    } catch (err) {
      applied.skills_rewrite_failed.push({ task_type: s.task_type, error: err.message })
    }
  }

  // 2. Purge low-score feedback rows (direct SQL — Hermes DELETE /feedback is all-or-nothing)
  const ids = (review.feedback_to_purge || []).map(f => f.id).filter(n => Number.isInteger(n))
  if (ids.length > 0) {
    const { error, count } = await supabase
      .from('hermes_feedback')
      .delete({ count: 'exact' })
      .in('id', ids)
    if (!error) applied.feedback_purged = count || 0
  }

  // 3. Quality gate threshold — persist to hermes_config table if present, else record only
  if (review.adjust_quality_gate?.new_threshold != null) {
    applied.quality_gate_updated = {
      new_threshold: review.adjust_quality_gate.new_threshold,
      reason: review.adjust_quality_gate.reason,
    }
    // Best-effort: upsert into hermes_config
    try {
      await supabase.from('hermes_config').upsert(
        { key: 'quality_gate_threshold', value: String(review.adjust_quality_gate.new_threshold) },
        { onConflict: 'key' }
      )
    } catch {}
  }

  // 4. Ask Hermes to hot-reload so rewritten skills take effect immediately
  if (applied.skills_rewritten.length > 0) {
    try {
      await fetch(`${HERMES_URL2}/skills/reload`, {
        method: 'POST',
        headers: { 'X-Agent-Key': AGENT_SECRET },
        signal: AbortSignal.timeout(5000),
      })
    } catch {}
  }

  return applied
}

async function runDailyReview(supabase) {
  const started = Date.now()
  const orchestrationId = randomUUID()
  const context = await buildReviewContext(supabase)

  const raw = await callHermes('self_reviewer', JSON.stringify(context), 2500)
  const review = extractJson(raw)
  if (!review) throw new Error('self_reviewer returned unparseable JSON')

  const applied = await applyReviewRecommendations(review, supabase)

  // Log to hermes_decisions (campaign_id NULL since this is system-wide)
  await supabase.from('hermes_decisions').insert({
    campaign_id: null,
    orchestration_id: orchestrationId,
    decision_type: 'self_improvement',
    action_type: 'daily_review',
    context_summary: review.summary || null,
    decision: {
      date: context.date,
      review,
      applied,
      elapsed_ms: Date.now() - started,
    },
    auto_apply: true,
    auto_applied: applied.skills_rewritten.length > 0 || applied.feedback_purged > 0 || applied.quality_gate_updated !== null,
    applied_at: new Date().toISOString(),
    outcome: 'success',
    outcome_detail: review.learning_log_entry || null,
  })

  console.log(`[SELF-REVIEW] date=${context.date} rewrote=${applied.skills_rewritten.length} purged=${applied.feedback_purged} qgate=${applied.quality_gate_updated ? 'adj' : 'keep'} (${Date.now() - started}ms)`)

  return {
    orchestration_id: orchestrationId,
    date: context.date,
    summary: review.summary,
    skills_rewritten: applied.skills_rewritten,
    skills_rewrite_failed: applied.skills_rewrite_failed,
    feedback_purged: applied.feedback_purged,
    quality_gate_updated: applied.quality_gate_updated,
    learning_log_entry: review.learning_log_entry,
    insights: review.insights || [],
  }
}

module.exports = {
  buildOrchestrationContext,
  runOrchestration,
  runAllRunningCampaigns,
  generateReport,
  executeAction,  // exported for tests
  buildReviewContext,
  runDailyReview,
  applyReviewRecommendations,
}
