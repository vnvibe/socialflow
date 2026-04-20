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

  // Roles + nicks assigned. AI_PILOT campaigns can have account_ids at the
  // campaign level WITHOUT any campaign_roles rows (Hermes orchestrates
  // roles implicitly). Fall back to campaign.account_ids so the context
  // isn't empty — otherwise every assign_job/recheck_group fails with
  // "nick not found in context" and only skip_group ever succeeds.
  const { data: roles } = await supabase
    .from('campaign_roles')
    .select('id, name, role_type, account_ids, is_active')
    .eq('campaign_id', campaignId)
  const allAccountIds = new Set()
  for (const r of roles || []) (r.account_ids || []).forEach(id => allAccountIds.add(id))
  if (allAccountIds.size === 0) {
    for (const id of campaign.account_ids || []) allAccountIds.add(id)
  }

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

    // ── Checkpoint-risk signal (per nick) ──────────────────
    // Hermes uses this to PROACTIVELY throttle before the nick actually dies.
    // Three inputs:
    //   1. recent_checkpoints_7d — how many times this nick failed with
    //      CHECKPOINT/SESSION_EXPIRED in the last 7 days (from job_failures)
    //   2. avg_gap_seconds — average time between the nick's last 10 actions
    //      (too fast = bot-like → higher risk)
    //   3. patterns — any ai_pilot_memory.checkpoint_pattern rows Hermes has
    //      previously deduced for this nick
    const since7d = new Date(Date.now() - 7 * 86400000).toISOString()
    const riskByNick = new Map()
    try {
      // 1. Checkpoint failures per nick (last 7d)
      const { data: failRows } = await supabase
        .from('job_failures')
        .select('account_id, error_type')
        .gte('created_at', since7d)
        .in('error_type', ['CHECKPOINT', 'SESSION_EXPIRED'])
      for (const r of failRows || []) {
        const e = riskByNick.get(r.account_id) || { recent_checkpoints_7d: 0 }
        e.recent_checkpoints_7d = (e.recent_checkpoints_7d || 0) + 1
        riskByNick.set(r.account_id, e)
      }

      // 2. Avg gap between last 10 COMMENTS (per nick). We used to average
      // across all action types, but likes naturally come in quick bursts
      // (2-5s apart when human scrolls and hearts) — that pulled the gap
      // below 120s for legitimate healthy behavior and triggered pause_nick
      // false positives. Comments are the signal that matters for spam
      // detection anyway, and the agent already enforces 90s minGap between
      // them, so normal baseline should be 90-180s.
      const { data: recentActions } = await supabase
        .from('campaign_activity_log')
        .select('account_id, action_type, created_at')
        .in('account_id', [...allAccountIds])
        .in('action_type', ['comment', 'opportunity_comment'])
        .gte('created_at', new Date(Date.now() - 6 * 3600 * 1000).toISOString())
        .order('created_at', { ascending: false })
      const actionsByNick = new Map()
      for (const row of recentActions || []) {
        if (!row.account_id) continue
        const arr = actionsByNick.get(row.account_id) || []
        if (arr.length < 10) arr.push(new Date(row.created_at).getTime())
        actionsByNick.set(row.account_id, arr)
      }
      for (const [accId, times] of actionsByNick.entries()) {
        if (times.length < 2) continue
        const gaps = []
        for (let i = 0; i < times.length - 1; i++) gaps.push((times[i] - times[i + 1]) / 1000)
        const avgGap = Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length)
        const e = riskByNick.get(accId) || {}
        e.avg_comment_gap_seconds = avgGap
        e.comment_sample_size = gaps.length
        riskByNick.set(accId, e)
      }

      // 3. Hermes-learned patterns for each nick
      const { data: memRows } = await supabase
        .from('ai_pilot_memory')
        .select('account_id, key, value, confidence, evidence_count')
        .in('account_id', [...allAccountIds])
        .eq('memory_type', 'checkpoint_pattern')
        .order('evidence_count', { ascending: false })
      for (const m of memRows || []) {
        const e = riskByNick.get(m.account_id) || {}
        if (!e.patterns) e.patterns = []
        if (e.patterns.length < 3) {
          e.patterns.push({
            key: m.key,
            cause: m.value?.primary_cause,
            confidence: m.confidence,
            evidence_count: m.evidence_count,
          })
        }
        riskByNick.set(m.account_id, e)
      }
    } catch (err) {
      console.warn(`[ORCHESTRATOR] checkpoint_risk compute failed: ${err.message}`)
    }

    nicks = (accounts || []).map(a => {
      const jobStats = jobsByNick.get(a.id) || { done: 0, failed: 0, active: null }
      const idleMs = a.last_used_at ? Date.now() - new Date(a.last_used_at).getTime() : Infinity
      const idleMinutes = isFinite(idleMs) ? Math.floor(idleMs / 60000) : 999
      const risk = riskByNick.get(a.id) || {}
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
        checkpoint_risk: {
          recent_checkpoints_7d: risk.recent_checkpoints_7d || 0,
          avg_comment_gap_seconds: risk.avg_comment_gap_seconds ?? null,
          comment_sample_size: risk.comment_sample_size || 0,
          patterns: risk.patterns || [],
        },
        // Expose current budget caps so Hermes doesn't emit decrease_budget
        // when the budget is already at floor (e.g., comment.max=1 → 1 no-op).
        budget_caps: (() => {
          const b = a.daily_budget || {}
          const out = {}
          for (const k of ['comment', 'like', 'post', 'friend_request', 'join_group']) {
            if (b[k]?.max != null) out[k] = { used: b[k].used || 0, max: b[k].max }
          }
          return out
        })(),
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
      topic: campaign.topic || null,
      mission: campaign.mission || null,
      hermes_context: campaign.hermes_context || null,
      brand_config: campaign.brand_config || null,
      ad_mode: campaign.ad_mode || 'normal',
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
// owner_id + topic + mission etc. so the agent handler has the context it
// needs. Observed bug: orchestrator jobs missed `topic` and campaign-nurture
// crashed on `topic.toLowerCase()` at line 504 → 0 KPI across every session.
function orchestratorPayload(context, extras = {}) {
  const c = context.campaign || {}
  return {
    campaign_id: c.id,
    owner_id: c.owner_id || null,
    topic: c.topic || null,
    mission: c.mission || null,
    brand_config: c.brand_config || null,
    ad_mode: c.ad_mode || 'normal',
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
      if (nick.is_active === false) return { ok: false, detail: 'nick is paused (is_active=false)' }
      if (nick.active_job) return { ok: false, detail: 'nick already has active job' }

      // Global pending cap — if schedulers have already queued MAX for this
      // nick across ALL campaigns, don't add more. Orchestrator runs per
      // campaign so without this it would happily stack jobs the agent
      // can't drain in time.
      try {
        const { getNickPendingCounts, MAX_PENDING_PER_NICK } = require('../lib/nick-lock')
        const counts = await getNickPendingCounts([accId])
        const pending = counts.get(accId) || 0
        if (pending >= MAX_PENDING_PER_NICK) {
          return { ok: false, detail: `nick at pending cap (${pending}/${MAX_PENDING_PER_NICK})` }
        }
      } catch { /* non-fatal — fall through */ }

      // Dedup: if a same-type job for this nick is already in-flight within
      // the last 30 minutes, skip silently. The in-flight one covers the need.
      if (await recentJobExists(supabase, { accountId: accId, jobType })) {
        return { ok: false, detail: `${jobType} for nick already queued <30min` }
      }

      // Rest-state gate: the poller enforces a 45-120min rest after each
      // 25-45min session. If we assign during rest, the job just sits pending
      // until rest ends — wasteful + clogs the queue. Use the DB as ground
      // truth (we don't have a nick_session_state table): if the most recent
      // done/failed job finished < 45 minutes ago, skip.
      try {
        const { data: lastDone } = await supabase
          .from('jobs')
          .select('finished_at, status')
          .eq('payload->>account_id', accId)
          .in('status', ['done', 'failed'])
          .order('finished_at', { ascending: false })
          .limit(1)
        const last = lastDone?.[0]
        if (last?.finished_at) {
          const restedMs = Date.now() - new Date(last.finished_at).getTime()
          const restedMin = Math.floor(restedMs / 60000)
          if (restedMin < 45) {
            return { ok: false, detail: `nick resting (${restedMin}/45 min since last job)` }
          }
        }
      } catch (err) {
        // Non-fatal — fall through to insert
        console.warn(`[ORCHESTRATOR] rest-check failed: ${err.message}`)
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
      // Validate accountId against context.nicks so LLM can't accidentally
      // hand us a user_id (owner_id) instead of an account UUID — we've seen
      // the LLM do this, and it caused the handler to error with
      // 'account_id and fb_group_id required' and FK violations on
      // job_failures (account_id not in accounts table).
      const nickIds = new Set((context.nicks || []).map(n => n.id))
      const candidate = action.action_detail?.account_id
      let accountId = (candidate && nickIds.has(candidate)) ? candidate : null
      if (!accountId) {
        accountId = (context.nicks || []).find(n => n.status === 'healthy')?.id
          || (context.nicks || [])[0]?.id
      }
      if (!accountId) return { ok: false, detail: 'no healthy nick available to recheck from' }

      // Handler needs fb_group_id (the FB-side id) AND group_row_id (our uuid).
      // Resolve fb_group_id from fb_groups using the target_id (a group_row_id).
      const { data: grp } = await supabase
        .from('fb_groups')
        .select('id, fb_group_id, url, name')
        .eq('id', action.target_id)
        .single()
      if (!grp?.fb_group_id) {
        return { ok: false, detail: `fb_group_id not found for group ${action.target_id}` }
      }

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
          fb_group_id: grp.fb_group_id,
          group_url: grp.url || null,
          group_name: grp.name || null,
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
      // Supports temporary pause via action_detail.duration_hours — writes a
      // resume_at timestamp so a future cron (or the orchestrator itself) can
      // re-enable. If no duration, pauses indefinitely (user must manually resume).
      const hours = Number(action.action_detail?.duration_hours) || null
      const resumeAt = hours ? new Date(Date.now() + hours * 3600 * 1000).toISOString() : null
      const updates = { is_active: false }
      if (resumeAt) updates.notes = `orchestrator_pause_until:${resumeAt} — ${action.reason || ''}`.slice(0, 500)
      const { error } = await supabase
        .from('accounts')
        .update(updates)
        .eq('id', action.target_id)
      if (error) return { ok: false, detail: error.message }
      return { ok: true, detail: resumeAt ? `paused until ${resumeAt}` : 'paused indefinitely' }
    }

    case 'decrease_budget': {
      // Proactive throttle: multiply a specific budget field by a fraction.
      // action_detail: { task_type: 'comment'|'like'|..., multiplier: 0.5 }
      // Persists to accounts.daily_budget[task_type].max; new max is max(1, floor(current*multiplier)).
      // Does NOT reset .used — just caps future creation.
      const taskType = action.action_detail?.task_type
      const mult = Number(action.action_detail?.multiplier)
      if (!taskType || !(mult > 0 && mult <= 1)) {
        return { ok: false, detail: 'task_type + multiplier (0-1) required' }
      }
      const { data: acc, error: readErr } = await supabase
        .from('accounts')
        .select('id, daily_budget, username')
        .eq('id', action.target_id)
        .single()
      if (readErr || !acc) return { ok: false, detail: readErr?.message || 'nick not found' }
      const budget = acc.daily_budget || {}
      const slot = budget[taskType] || { used: 0, max: 10 }
      const oldMax = slot.max || 10
      // Guard: don't bother executing when already at or below the minimum floor.
      // Caller's Hermes should skip this but belt-and-suspenders.
      if (oldMax <= 1) {
        return { ok: false, detail: `${acc.username} ${taskType}.max already at ${oldMax}, no-op` }
      }
      const newMax = Math.max(1, Math.floor(oldMax * mult))
      if (newMax >= oldMax) {
        return { ok: false, detail: `${acc.username} ${taskType}.max ${oldMax} → ${newMax} (no reduction, skip)` }
      }
      const newBudget = { ...budget, [taskType]: { ...slot, max: newMax } }
      const { error: upErr } = await supabase
        .from('accounts')
        .update({ daily_budget: newBudget })
        .eq('id', action.target_id)
      if (upErr) return { ok: false, detail: upErr.message }
      return { ok: true, detail: `${acc.username} ${taskType}.max ${oldMax} → ${newMax}` }
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

    case 'raise_kpi_target': {
      // Applies the capability bump recommended by nick-kpi-watcher.
      // Bumps target_* columns on today's + future nick_kpi_daily rows.
      const accountId = action.target_id
      const detail = action.action_detail || (typeof action.decision === 'object' ? action.decision : {})
      const bumpPct = detail.bump_pct || 20
      const factor = 1 + bumpPct / 100
      try {
        await supabase._pool.query(
          `UPDATE nick_kpi_daily
           SET target_likes   = ROUND(target_likes   * $2)::int,
               target_comments= ROUND(target_comments* $2)::int,
               target_friend_requests = ROUND(target_friend_requests * $2)::int,
               target_group_joins     = ROUND(target_group_joins     * $2)::int
           WHERE account_id = $1 AND date >= CURRENT_DATE`,
          [accountId, factor]
        )
        // Also persist the new capability in ai_pilot_memory so the scheduler's
        // next-day target calc picks it up
        await supabase.from('ai_pilot_memory').upsert({
          memory_type: 'nick_capability',
          key: `capability_bump:${accountId}`,
          value: { bump_pct: bumpPct, applied_at: new Date().toISOString() },
          owner_id: context.campaign?.owner_id || null,
        })
        return { ok: true, detail: `KPI target +${bumpPct}% applied` }
      } catch (err) {
        return { ok: false, detail: err.message }
      }
    }

    case 'investigate_nick_shortfall': {
      // Informational — nothing to execute. The decision itself IS the
      // information (cause + plan shown in the drawer).
      return { ok: true, detail: 'shortfall diagnosis logged' }
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
    checkpoint_patterns_applied: review.checkpoint_patterns_applied || [],
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
