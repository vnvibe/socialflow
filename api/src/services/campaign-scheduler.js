const cron = require('node-cron')
const { CronExpressionParser } = require('cron-parser')
const { createClient } = require('@supabase/supabase-js')
const { getBusyNicks } = require('../lib/nick-lock')
const { collectPerformanceData, evaluatePostStrategy, getOptimalScheduleTime, MIN_POSTS_FOR_AI } = require('./post-strategy')
const { remember, recall, formatMemoriesForPrompt } = require('./ai-memory')

// Job priority map: lower = higher priority
// 1=CRITICAL, 3=HIGH, 5=NORMAL (default), 7=LOW, 9=BACKGROUND
const JOB_PRIORITY = {
  // CRITICAL — health/safety checks
  check_health: 1,
  check_engagement: 1,

  // HIGH — main campaign work
  campaign_nurture: 3,
  campaign_discover_groups: 3,
  campaign_send_friend_request: 3,
  campaign_interact_profile: 3,
  campaign_scan_members: 3,
  nurture_feed: 3,

  // NORMAL — content posting + monitoring
  campaign_post: 5,
  post_page: 5,
  post_group: 5,
  post_profile: 5,
  post_page_graph: 5,
  campaign_group_monitor: 5,
  campaign_opportunity_react: 5,

  // LOW — utility/data fetching
  fetch_source_cookie: 7,
  fetch_all: 7,
  fetch_pages: 7,
  fetch_groups: 7,
  resolve_group: 7,
  scan_group_feed: 7,
  scan_group_keyword: 7,
  watch_my_posts: 7,
  ai_pilot: 7,

  // BACKGROUND
  cleanup: 9,
  memory_decay: 9,
}

function getJobPriority(jobType) {
  return JOB_PRIORITY[jobType] || 5
}

let supabase = null

function initScheduler() {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // Check campaigns every minute
  cron.schedule('* * * * *', async () => {
    try {
      await processPendingCampaigns()
    } catch (err) {
      console.error('[SCHEDULER] Campaign error:', err.message)
    }
    try {
      await processRoleCampaigns()
    } catch (err) {
      console.error('[SCHEDULER] Role campaign error:', err.message)
    }
    try {
      await processEngagementChecks()
    } catch (err) {
      console.error('[SCHEDULER] Engagement error:', err.message)
    }
    try {
      await processMonitoringSources()
    } catch (err) {
      console.error('[SCHEDULER] Monitoring error:', err.message)
    }
  })

  console.log('[SCHEDULER] Campaign + Role + Engagement + Monitoring scheduler started')
}

async function processPendingCampaigns() {
  const now = new Date().toISOString()

  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('*')
    .eq('is_active', true)
    .lte('next_run_at', now)

  if (!campaigns?.length) return

  for (const campaign of campaigns) {
    try {
      console.log(`[SCHEDULER] Executing campaign: ${campaign.name || campaign.id}`)
      await executeCampaign(campaign)
    } catch (err) {
      console.error(`[SCHEDULER] Campaign ${campaign.id} error:`, err.message)
    }
  }
}

async function executeCampaign(campaign) {
  const allTargets = [
    ...(campaign.target_pages || []).map(id => ({ id, type: 'page' })),
    ...(campaign.target_groups || []).map(id => ({ id, type: 'group' })),
    ...(campaign.target_profiles || []).map(id => ({ id, type: 'profile' }))
  ]

  const contentIds = campaign.content_ids || []
  if (contentIds.length === 0 || allTargets.length === 0) return

  // Pick content based on rotation mode
  const contentIdx = campaign.rotation_mode === 'random'
    ? Math.floor(Math.random() * contentIds.length)
    : campaign.total_runs % contentIds.length
  const contentId = contentIds[contentIdx]

  // ── Adaptive scheduling: collect performance data per account ──
  // Cache strategy per account to avoid repeated AI calls within same campaign run
  const strategyCache = {}
  async function getStrategy(accountId) {
    if (strategyCache[accountId] !== undefined) return strategyCache[accountId]
    try {
      const perfData = await collectPerformanceData(supabase, accountId)
      if (perfData) {
        const strategy = await evaluatePostStrategy(supabase, campaign.owner_id, perfData, campaign)
        strategyCache[accountId] = strategy
        if (strategy) console.log(`[SCHEDULER] AI strategy for ${accountId.slice(0, 8)}: hours=[${strategy.recommended_hours}], confidence=${strategy.confidence}`)
        return strategy
      }
    } catch (err) {
      console.warn(`[SCHEDULER] Strategy eval failed for ${accountId.slice(0, 8)}: ${err.message}`)
    }
    strategyCache[accountId] = null
    return null
  }

  // Create jobs for each target with delay
  let jobsCreated = 0
  for (let i = 0; i < allTargets.length; i++) {
    const target = allTargets[i]

    // Get account for this target
    let accountId = null
    if (target.type === 'page') {
      const { data } = await supabase.from('fanpages').select('account_id').eq('id', target.id).single()
      accountId = data?.account_id
    } else if (target.type === 'group') {
      const { data } = await supabase.from('fb_groups').select('account_id, fb_group_id').eq('id', target.id).single()
      accountId = data?.account_id
      // Check if AI strategy says avoid this group
      if (accountId) {
        const strategy = await getStrategy(accountId)
        if (strategy?.avoid_groups?.includes(data?.fb_group_id)) {
          console.log(`[SCHEDULER] Skipping group ${target.id} — AI strategy: avoid (low engagement)`)
          continue
        }
      }
    } else {
      accountId = target.id // profile = account
    }

    if (!accountId) continue

    // Determine schedule time: AI optimal hour or fallback to delay-based
    const strategy = await getStrategy(accountId)
    let scheduledAt
    if (strategy?.recommended_hours?.length && i === 0) {
      // First target: schedule at optimal hour
      scheduledAt = getOptimalScheduleTime(strategy.recommended_hours, 5)
    } else {
      // Subsequent targets or no strategy: use delay from first
      const baseTime = strategyCache[accountId]?.recommended_hours?.length
        ? getOptimalScheduleTime(strategyCache[accountId].recommended_hours, 5).getTime()
        : Date.now()
      const delayMinutes = i * (campaign.delay_between_targets_minutes || 15)
      scheduledAt = new Date(baseTime + delayMinutes * 60 * 1000)
    }

    const postType = `post_${target.type}`
    const { error } = await supabase.from('jobs').insert({
      type: postType,
      priority: getJobPriority(postType),
      payload: {
        content_id: contentId,
        target_id: target.id,
        account_id: accountId,
        campaign_id: campaign.id,
        spin_mode: campaign.spin_mode || 'none',
        ...(strategy && { ai_strategy: { recommended_hours: strategy.recommended_hours, confidence: strategy.confidence, content_suggestion: strategy.content_suggestion } }),
      },
      scheduled_at: scheduledAt.toISOString(),
      created_by: campaign.owner_id
    })

    if (!error) jobsCreated++
  }

  // Update campaign
  const nextRun = calculateNextRun(campaign)
  await supabase.from('campaigns').update({
    last_run_at: new Date().toISOString(),
    next_run_at: nextRun,
    total_runs: (campaign.total_runs || 0) + 1,
    ...(nextRun === null && { is_active: false })
  }).eq('id', campaign.id)

  console.log(`[SCHEDULER] Campaign ${campaign.name || campaign.id}: ${jobsCreated} jobs created, next run: ${nextRun || 'none'}`)
}

function calculateNextRun(campaign) {
  if (campaign.schedule_type === 'once') return null

  if (campaign.schedule_type === 'interval' && campaign.interval_minutes) {
    const next = new Date(Date.now() + campaign.interval_minutes * 60 * 1000)
    if (campaign.end_at && next > new Date(campaign.end_at)) return null
    return next.toISOString()
  }

  // Parse cron expression properly
  if (campaign.schedule_type === 'recurring' && campaign.cron_expression) {
    try {
      const interval = CronExpressionParser.parse(campaign.cron_expression, {
        currentDate: new Date(),
        tz: 'Asia/Ho_Chi_Minh',
      })
      const next = interval.next().toDate()
      if (campaign.end_at && next > new Date(campaign.end_at)) return null
      return next.toISOString()
    } catch (err) {
      console.error(`[SCHEDULER] Invalid cron expression "${campaign.cron_expression}": ${err.message}`)
      // Fallback: 1 hour
      const next = new Date(Date.now() + 60 * 60 * 1000)
      if (campaign.end_at && next > new Date(campaign.end_at)) return null
      return next.toISOString()
    }
  }

  return null
}

// ============================================
// ROLE-BASED CAMPAIGN SCHEDULER
// ============================================

async function processRoleCampaigns() {
  const now = new Date().toISOString()

  // Find campaigns with topic (role-based) that are running and due
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('*, campaign_roles(*)')
    .eq('status', 'running')
    .eq('is_active', true)
    .lte('next_run_at', now)
    .not('topic', 'is', null)

  if (!campaigns?.length) return

  for (const campaign of campaigns) {
    try {
      console.log(`[SCHEDULER] Executing role campaign: ${campaign.name || campaign.id}`)
      await executeRoleCampaign(campaign)
    } catch (err) {
      console.error(`[SCHEDULER] Role campaign ${campaign.id} error:`, err.message)
    }
  }
}

async function executeRoleCampaign(campaign) {
  const roles = (campaign.campaign_roles || [])
    .filter(r => r.is_active)
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))

  if (roles.length === 0) {
    console.log(`[SCHEDULER] Campaign ${campaign.id} has no active roles, skipping`)
    return
  }

  // Check if today is an active day
  const today = new Date().getDay() // 0=Sun, 1=Mon...
  const activeDays = campaign.campaign_active_days || [1, 2, 3, 4, 5, 6, 0]
  if (!activeDays.includes(today)) {
    console.log(`[SCHEDULER] Campaign ${campaign.id} not active today (day ${today})`)
    const nextRun = calculateNextRun(campaign)
    await supabase.from('campaigns').update({ next_run_at: nextRun }).eq('id', campaign.id)
    return
  }

  // ── Duplicate prevention: check for existing pending/running jobs for this campaign ──
  const { data: existingJobs } = await supabase
    .from('jobs')
    .select('id, type, payload->account_id')
    .in('status', ['pending', 'claimed', 'running'])
    .filter('payload->>campaign_id', 'eq', campaign.id)
    .limit(100)

  const existingKeys = new Set(
    (existingJobs || []).map(j => `${j.type}:${j['payload->account_id'] || j.account_id}`)
  )

  // ── Check agent online before creating jobs ──
  const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id')
    .gte('last_seen', new Date(Date.now() - 120000).toISOString()).limit(1)
  if (!agents?.length) {
    console.log(`[SCHEDULER] No agent online — deferring campaign ${campaign.id}`)
    // Push next_run_at 5 minutes forward instead of skipping entirely
    await supabase.from('campaigns').update({
      next_run_at: new Date(Date.now() + 5 * 60 * 1000).toISOString()
    }).eq('id', campaign.id)
    return
  }

  // ── Verify accounts are active before creating jobs ──
  const allAccountIds = [...new Set(roles.flatMap(r => r.account_ids || []))]
  const { data: activeAccounts } = await supabase
    .from('accounts')
    .select('id')
    .in('id', allAccountIds)
    .eq('is_active', true)
  const activeAccountSet = new Set((activeAccounts || []).map(a => a.id))

  // ── Nick lock: batch check which accounts are busy (nurture or other jobs) ──
  let busyNickSet = new Set()
  try {
    busyNickSet = await getBusyNicks([...activeAccountSet])
  } catch (err) {
    console.warn(`[SCHEDULER] Nick lock check failed: ${err.message} — proceeding without lock`)
  }

  let jobsCreated = 0
  let jobsSkipped = 0
  let roleDelay = 0

  // ── Role dependency check: sort roles by dependency order ──
  // scout → nurture → connect (scout must complete before nurture starts)
  const ROLE_ORDER = { scout: 0, scan_members: 1, nurture: 2, interact: 3, connect: 4, post: 5, custom: 2 }
  const sortedRoles = [...roles].sort((a, b) => (ROLE_ORDER[a.role_type] || 5) - (ROLE_ORDER[b.role_type] || 5))

  // Check if dependency roles have completed their latest jobs
  const roleCompletionCache = {}
  async function isRoleDependencyMet(role) {
    if (!role.read_from) return true // no dependency
    const depRoleId = role.read_from
    if (roleCompletionCache[depRoleId] !== undefined) return roleCompletionCache[depRoleId]

    // Check if dependency role has at least 1 completed job in last 24h
    const { data: depJobs } = await supabase.from('jobs')
      .select('id')
      .filter('payload->>campaign_id', 'eq', campaign.id)
      .filter('payload->>role_id', 'eq', depRoleId)
      .eq('status', 'done')
      .gte('finished_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1)
    const met = (depJobs?.length || 0) > 0
    roleCompletionCache[depRoleId] = met
    return met
  }

  // ── Round-robin: track last used account per role ──
  // Use campaign.meta?.round_robin_state or start fresh
  const rrState = campaign.meta?.round_robin_state || {}

  const jobTypeMap = {
    scout: 'campaign_discover_groups',
    scan_members: 'campaign_scan_members',
    nurture: 'campaign_nurture',
    connect: 'campaign_send_friend_request',
    interact: 'campaign_interact_profile',
    post: 'campaign_post',
    custom: 'campaign_nurture',
  }

  for (const role of sortedRoles) {
    const accountIds = (role.account_ids || []).filter(id => activeAccountSet.has(id))
    if (accountIds.length === 0) {
      console.log(`[SCHEDULER] Role ${role.name || role.role_type} has no active accounts, skipping`)
      continue
    }

    // Check role dependency
    const depMet = await isRoleDependencyMet(role)
    if (!depMet) {
      console.log(`[SCHEDULER] Role ${role.name || role.role_type} dependency not met, skipping`)
      jobsSkipped += accountIds.length
      continue
    }

    const jobType = jobTypeMap[role.role_type] || 'campaign_nurture'

    // Round-robin: pick next account(s) in rotation
    const lastIdx = rrState[role.id] || 0
    const orderedAccounts = []

    if (role.role_type === 'scout') {
      // Scout: chỉ 1 nick mỗi run, round-robin giữa các nicks
      orderedAccounts.push(accountIds[lastIdx % accountIds.length])
      rrState[role.id] = (lastIdx + 1) % accountIds.length
    } else {
      for (let i = 0; i < accountIds.length; i++) {
        orderedAccounts.push(accountIds[(lastIdx + i) % accountIds.length])
      }
      rrState[role.id] = (lastIdx + orderedAccounts.length) % accountIds.length
    }

    for (let i = 0; i < orderedAccounts.length; i++) {
      const accountId = orderedAccounts[i]

      // Skip if duplicate job already exists
      const jobKey = `${jobType}:${accountId}`
      if (existingKeys.has(jobKey)) {
        jobsSkipped++
        continue
      }

      // Nick lock: skip if nick is busy with nurture or other job
      if (busyNickSet.has(accountId)) {
        jobsSkipped++
        continue
      }

      // Budget pre-check: skip if all relevant budgets exhausted (avoid creating dead jobs)
      try {
        const { data: accBudget } = await supabase.from('accounts')
          .select('daily_budget').eq('id', accountId).single()
        const budgetMap = { scout: 'join_group', nurture: 'like', connect: 'friend_request', post: 'post', interact: 'like' }
        const budgetKey = budgetMap[role.role_type]
        if (budgetKey && accBudget?.daily_budget?.[budgetKey]) {
          const b = accBudget.daily_budget[budgetKey]
          if (b.used >= b.max) {
            jobsSkipped++
            continue
          }
        }
      } catch {}

      const nickDelay = i * (campaign.nick_stagger_seconds || 60)
      const totalDelaySec = roleDelay + nickDelay
      const scheduledAt = new Date(Date.now() + totalDelaySec * 1000)

      const { error } = await supabase.from('jobs').insert({
        type: jobType,
        priority: getJobPriority(jobType),
        payload: {
          campaign_id: campaign.id,
          role_id: role.id,
          account_id: accountId,
          owner_id: campaign.owner_id,
          mission: role.mission,
          parsed_plan: role.parsed_plan,
          config: role.config,
          topic: campaign.topic,
          role_type: role.role_type,
          feeds_into: role.feeds_into,
          read_from: role.read_from,
          // Brand/ads context (new SaaS form)
          brand_config: campaign.brand_config || null,
          ad_mode: campaign.ad_mode || 'normal',
        },
        status: 'pending',
        scheduled_at: scheduledAt.toISOString(),
        created_by: campaign.owner_id,
      })

      if (!error) jobsCreated++
    }

    // Stagger between roles
    roleDelay += (campaign.role_stagger_minutes || 30) * 60
  }

  // Save round-robin state
  await supabase.from('campaigns').update({
    meta: { ...(campaign.meta || {}), round_robin_state: rrState }
  }).eq('id', campaign.id)

  // Calculate next run
  const nextRun = calculateNextRun(campaign)
  await supabase.from('campaigns').update({
    last_run_at: new Date().toISOString(),
    next_run_at: nextRun,
    total_runs: (campaign.total_runs || 0) + 1,
    ...(nextRun === null ? { status: 'completed', is_active: false } : {})
  }).eq('id', campaign.id)

  console.log(`[SCHEDULER] Role campaign ${campaign.name || campaign.id}: ${jobsCreated} jobs created, ${jobsSkipped} skipped (dup), ${roles.length} roles, next: ${nextRun || 'completed'}`)

  // ── AI Supreme Control: evaluate after every 3rd run ──
  if ((campaign.total_runs || 0) % 3 === 0 && campaign.total_runs > 0) {
    aiEvaluateCampaign(campaign, roles).catch(err =>
      console.warn(`[AI-CTRL] Evaluation failed for ${campaign.id}: ${err.message}`)
    )
  }
}

/**
 * AI Pilot — evaluates campaign performance and auto-adjusts strategy
 * Runs every 3rd campaign execution.
 *
 * Root causes fixed (2026-04-04):
 * 1. AI returned role_type name instead of UUID → now prompt includes actual role IDs
 * 2. Missing owner_id in log insert → now includes campaign.owner_id
 * 3. increase/decrease used same logic → now properly increase vs decrease with limits
 * 4. All parsed_plan steps updated → now only updates matching action step
 * 5. No hard limit enforcement → now clamps to HARD_LIMITS
 */

const HARD_LIMITS = {
  comment: 15, like: 80, join_group: 3, friend_request: 10, post: 3, scan: 15,
}

async function aiEvaluateCampaign(campaign, roles) {
  // ── 1. Gather activity stats (last 24h) ──
  const { data: activityStats, error: actErr } = await supabase
    .from('campaign_activity_log')
    .select('action_type, result_status, account_id, role_id, source')
    .eq('campaign_id', campaign.id)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  if (actErr) {
    console.error(`[AI-PILOT] Activity query error: ${actErr.message}`)
    return
  }
  if (!activityStats?.length) {
    console.log(`[AI-PILOT] No activity in last 24h for campaign ${campaign.id}, skipping evaluation`)
    return
  }

  // Aggregate per action_type
  const summary = {}
  const accountPerf = {}
  const rolePerf = {}
  for (const s of activityStats) {
    if (!summary[s.action_type]) summary[s.action_type] = { total: 0, success: 0, failed: 0 }
    summary[s.action_type].total++
    if (s.result_status === 'success') summary[s.action_type].success++
    if (s.result_status === 'failed') summary[s.action_type].failed++

    if (s.account_id) {
      if (!accountPerf[s.account_id]) accountPerf[s.account_id] = { total: 0, success: 0, failed: 0 }
      accountPerf[s.account_id].total++
      if (s.result_status === 'success') accountPerf[s.account_id].success++
      if (s.result_status === 'failed') accountPerf[s.account_id].failed++
    }

    if (s.role_id) {
      if (!rolePerf[s.role_id]) rolePerf[s.role_id] = { total: 0, success: 0, failed: 0 }
      rolePerf[s.role_id].total++
      if (s.result_status === 'success') rolePerf[s.role_id].success++
      if (s.result_status === 'failed') rolePerf[s.role_id].failed++
    }
  }

  const summaryText = Object.entries(summary)
    .map(([k, v]) => `${k}: ${v.total} (thành công: ${v.success}, thất bại: ${v.failed})`)
    .join('\n')

  // ── 2. Account health context ──
  const allAccountIds = [...new Set(roles.flatMap(r => r.account_ids || []))]
  let accountHealthText = ''
  if (allAccountIds.length) {
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, username, status, is_active, created_at')
      .in('id', allAccountIds)
    if (accounts?.length) {
      accountHealthText = accounts.map(a => {
        const age = Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86400000)
        const perf = accountPerf[a.id] || { total: 0, failed: 0 }
        return `  ${a.username || a.id.slice(0, 8)}: trạng thái=${a.status}, tuổi=${age} ngày, ${perf.total} actions, ${perf.failed} lỗi`
      }).join('\n')
    }
  }

  // ── 2b. Warning scores context ──
  let warningText = ''
  try {
    const { data: warnings } = await supabase
      .from('account_warning_scores')
      .select('*')
      .in('account_id', allAccountIds)

    if (warnings?.length) {
      warningText = warnings.map(w =>
        `  ${w.account_id.slice(0, 8)}: ${w.risk_level.toUpperCase()} — ${w.signals_24h} cảnh báo/24h, ${w.signals_6h} cảnh báo/6h`
      ).join('\n')
    }
  } catch (err) {
    console.warn(`[AI-PILOT] Warning scores query failed: ${err.message}`)
  }

  // ── 2c. Post performance context (for post strategy feedback) ──
  let postPerfText = ''
  try {
    // Check if any account has enough data for strategy
    for (const accId of allAccountIds.slice(0, 3)) { // check top 3 accounts
      const perfData = await collectPerformanceData(supabase, accId)
      if (perfData) {
        const bestHrs = perfData.best_hours.join('h, ') + 'h'
        const topGroups = perfData.group_stats.slice(0, 3).map(g => `"${g.group_name}" (avg ${g.avg_reactions} reactions)`).join(', ')
        postPerfText += `  ${accId.slice(0, 8)}: best hours=[${bestHrs}], top groups=[${topGroups}], ${perfData.total_posts} posts/30d\n`
      }
    }
  } catch {}

  // ── 3. Group performance context ──
  let groupPerfText = ''
  try {
    const { data: groupPerf } = await supabase
      .from('group_performance')
      .select('*')
      .eq('campaign_id', campaign.id)

    if (groupPerf?.length) {
      groupPerfText = groupPerf.map(g =>
        `  "${g.group_name}": ${g.detected_7d} cơ hội/7 ngày, avg score ${g.avg_score || '?'}, đã act ${g.acted_7d}`
      ).join('\n')
    }
  } catch (err) {
    console.warn(`[AI-PILOT] Group perf query failed: ${err.message}`)
  }

  // ── 4. Build role details with ACTUAL UUIDs + parsed_plan ──
  const rolesText = roles.map(r => {
    const perf = rolePerf[r.id] || { total: 0, success: 0, failed: 0 }
    let planSummary = ''
    try {
      const plan = typeof r.parsed_plan === 'string' ? JSON.parse(r.parsed_plan) : (r.parsed_plan || [])
      planSummary = plan.map(s => `${s.action}: ${s.count_min || 0}-${s.count_max || 0}`).join(', ')
    } catch { planSummary = '(không có plan)' }

    return `  - role_id: "${r.id}"
    Tên: ${r.name} (${r.role_type}), ${(r.account_ids || []).length} nick
    Plan hiện tại: ${planSummary}
    Hiệu suất 24h: ${perf.total} actions, ${perf.success} thành công, ${perf.failed} lỗi`
  }).join('\n')

  // ── 5. Recall memories from previous runs ──
  let memoryContext = ''
  try {
    const campaignMemories = await recall(supabase, { campaignId: campaign.id, memoryType: 'campaign_pattern' })
    // Also get per-nick memories for all campaign accounts
    const nickMemories = []
    for (const accId of allAccountIds.slice(0, 4)) {
      const mems = await recall(supabase, { campaignId: campaign.id, accountId: accId, memoryType: 'nick_behavior' })
      if (mems.length) nickMemories.push({ accId, memories: mems })
    }

    if (campaignMemories.length || nickMemories.length) {
      memoryContext = '\n=== MEMORY TỪ CÁC LẦN ĐÁNH GIÁ TRƯỚC ===\n'
      if (campaignMemories.length) {
        memoryContext += 'Campaign-level:\n' + formatMemoriesForPrompt(campaignMemories) + '\n'
      }
      for (const nm of nickMemories) {
        memoryContext += `Nick ${nm.accId.slice(0, 8)}:\n` + formatMemoriesForPrompt(nm.memories) + '\n'
      }
      console.log(`[AI-PILOT] Recalled ${campaignMemories.length} campaign + ${nickMemories.reduce((s, n) => s + n.memories.length, 0)} nick memories`)
    }
  } catch (err) {
    console.warn(`[AI-PILOT] Memory recall failed: ${err.message}`)
  }

  // ── 6. Call AI with structured prompt ──
  try {
    const { getOrchestratorForUser } = require('./ai/orchestrator')
    const orchestrator = await getOrchestratorForUser(campaign.owner_id, supabase)

    const systemPrompt = `Bạn là AI Pilot điều khiển chiến dịch marketing trên Facebook.
Nhiệm vụ: Phân tích hiệu suất chiến dịch và đưa ra quyết định điều chỉnh.

QUY TẮC BẮT BUỘC:
- role_id PHẢI là UUID chính xác được cung cấp, KHÔNG được dùng tên role
- Giới hạn cứng mỗi nick/ngày: comment=15, like=80, join_group=3, friend_request=10, post=3, scan=15
- Giá trị count_max KHÔNG được vượt giới hạn cứng
- Nếu tỷ lệ lỗi > 30%: nên giảm volume hoặc pause role
- Nếu nick bị checkpoint/expired: đề xuất loại khỏi role
- Nếu nick có risk_level WARNING/CRITICAL: đề xuất giảm actions hoặc cho nghỉ (pause role chứa nick đó)
- Nick ở mức WATCH: giảm 30% count_max, nick WARNING: giảm 50%, nick CRITICAL: pause role

Trả về JSON duy nhất, không giải thích thêm.`

    const userPrompt = `Chiến dịch: "${campaign.name}" (chủ đề: ${campaign.topic})
Đã chạy: ${campaign.total_runs} lần

=== KẾT QUẢ 24H QUA ===
${summaryText}

=== TÌNH TRẠNG NICK ===
${accountHealthText || '(không có dữ liệu)'}

=== CẢNH BÁO SỨC KHỎE NICK ===
${warningText || '(không có cảnh báo)'}

=== HIỆU SUẤT POST (30 ngày) ===
${postPerfText || '(chưa đủ dữ liệu)'}

=== HIỆU SUẤT NHÓM ===
${groupPerfText || '(không có dữ liệu)'}

=== ROLES (dùng chính xác role_id UUID bên dưới) ===
${rolesText}

${memoryContext}

Trả về JSON:
{
  "adjustments": [
    {"role_id": "UUID_CHÍNH_XÁC", "action": "increase|decrease|pause|resume", "field": "count_max", "new_value": number, "reason": "..."}
  ],
  "new_learnings": [
    {"scope": "campaign|nick|group", "account_id": null, "group_fb_id": null, "key": "insight_ngắn", "value": "nội dung học được", "confidence": 0.7}
  ],
  "overall_assessment": "good|warning|critical",
  "recommendation": "tóm tắt 1-2 câu"
}`

    console.log(`[AI-PILOT] Calling AI for campaign "${campaign.name}" (${activityStats.length} activities, ${roles.length} roles)`)

    const result = await orchestrator.call('ai_pilot', [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { max_tokens: 1000, temperature: 0.15 })

    const text = result?.text || result?.content || (typeof result === 'string' ? result : '')
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      console.warn(`[AI-PILOT] No JSON in AI response (${text.length} chars)`)
      return
    }

    let decisions
    try { decisions = JSON.parse(match[0]) } catch (e) {
      console.warn(`[AI-PILOT] JSON parse failed: ${e.message}`)
      return
    }

    // ── 6. Apply adjustments with validation ──
    let appliedCount = 0
    for (const adj of (decisions.adjustments || [])) {
      if (!adj.role_id || !adj.action) continue

      // Resolve role by UUID (primary) or fallback to role_type/name match
      let role = roles.find(r => r.id === adj.role_id)
      if (!role) {
        role = roles.find(r => r.role_type === adj.role_id || r.name === adj.role_id)
        if (role) {
          console.log(`[AI-PILOT] Resolved "${adj.role_id}" → role UUID ${role.id} (${role.name})`)
          adj.role_id = role.id
        }
      }
      if (!role) {
        console.warn(`[AI-PILOT] Unknown role_id "${adj.role_id}", skipping`)
        continue
      }

      // Normalize action aliases (AI sometimes returns synonyms)
      const actionMap = { reduce: 'decrease', lower: 'decrease', raise: 'increase', activate: 'resume', deactivate: 'pause', maintain: 'skip', stop: 'pause' }
      const action = actionMap[adj.action] || adj.action

      if (action === 'skip' || action === 'maintain') {
        console.log(`[AI-PILOT] ≡ Maintain "${role.name}": ${adj.reason}`)
        continue
      }

      if (action === 'pause') {
        await supabase.from('campaign_roles').update({ is_active: false }).eq('id', role.id)
        console.log(`[AI-PILOT] ⏸ Paused "${role.name}": ${adj.reason}`)
        appliedCount++

      } else if (action === 'resume') {
        await supabase.from('campaign_roles').update({ is_active: true }).eq('id', role.id)
        console.log(`[AI-PILOT] ▶ Resumed "${role.name}": ${adj.reason}`)
        appliedCount++

      } else if (action === 'increase' || action === 'decrease') {
        const field = adj.field || 'count_max'
        // Handle new_value as number or string like "1-1" (extract max from "min-max")
        let rawValue = adj.new_value ?? adj.value
        if (typeof rawValue === 'string') {
          const parts = rawValue.split('-').map(Number).filter(n => !isNaN(n))
          rawValue = parts.length > 1 ? parts[1] : parts[0] // take max from "min-max"
        }
        const newValue = Number(rawValue)
        if (isNaN(newValue) || newValue < 0) {
          console.warn(`[AI-PILOT] Invalid new_value "${adj.new_value}" for ${role.name}, skipping`)
          continue
        }

        let plan
        try { plan = typeof role.parsed_plan === 'string' ? JSON.parse(role.parsed_plan) : [...(role.parsed_plan || [])] } catch { plan = [] }
        if (!plan.length) continue

        let updated = false
        for (const step of plan) {
          const actionType = step.action || step.type
          const hardLimit = HARD_LIMITS[actionType]

          if (step[field] !== undefined) {
            const oldVal = step[field]
            let clampedValue = Math.max(1, newValue)
            if (hardLimit) clampedValue = Math.min(clampedValue, hardLimit)

            step[field] = clampedValue
            if (clampedValue !== oldVal) updated = true
            console.log(`[AI-PILOT] ${action === 'increase' ? '↑' : '↓'} "${role.name}" ${actionType}.${field}: ${oldVal} → ${clampedValue}${hardLimit && newValue > hardLimit ? ` (clamped from ${newValue}, limit=${hardLimit})` : ''}`)
          }
        }

        if (updated) {
          await supabase.from('campaign_roles').update({ parsed_plan: plan }).eq('id', role.id)
          appliedCount++
        }
      }
    }

    // ── 7. Log AI decision (with owner_id!) ──
    const { error: logErr } = await supabase.from('campaign_activity_log').insert({
      campaign_id: campaign.id,
      owner_id: campaign.owner_id,
      action_type: 'ai_control',
      result_status: decisions.overall_assessment || 'good',
      source: 'campaign',
      details: {
        assessment: decisions.overall_assessment,
        recommendation: decisions.recommendation,
        adjustments: decisions.adjustments,
        applied_count: appliedCount,
        run_number: campaign.total_runs,
        activity_count: activityStats.length,
      },
      created_at: new Date().toISOString(),
    })

    if (logErr) {
      console.error(`[AI-PILOT] Log insert failed: ${logErr.message}`)
    }

    // ── 8. Remember decision context (Level A) ──
    try {
      await remember(supabase, {
        campaignId: campaign.id,
        memoryType: 'campaign_pattern',
        key: 'last_decision',
        value: {
          assessment: decisions.overall_assessment,
          adjustments_count: (decisions.adjustments || []).length,
          applied_count: appliedCount,
          run_number: campaign.total_runs,
          activity_count: activityStats.length,
        },
      })

      // Remember success rate trend
      const totalActions = activityStats.length
      const successActions = activityStats.filter(s => s.result_status === 'success').length
      const successRate = totalActions > 0 ? Math.round(successActions / totalActions * 100) : 0
      await remember(supabase, {
        campaignId: campaign.id,
        memoryType: 'campaign_pattern',
        key: 'success_rate_trend',
        value: { rate: successRate, sample_size: totalActions, run: campaign.total_runs },
      })
    } catch (memErr) {
      console.warn(`[AI-PILOT] Memory save failed: ${memErr.message}`)
    }

    // ── 9. Level D: AI self-write memories (new_learnings) ──
    try {
      for (const learning of (decisions.new_learnings || [])) {
        if (!learning.key) continue
        const memType = learning.scope === 'nick' ? 'nick_behavior'
          : learning.scope === 'group' ? 'group_response'
          : 'campaign_pattern'

        await remember(supabase, {
          campaignId: campaign.id,
          accountId: learning.account_id || null,
          groupFbId: learning.group_fb_id || null,
          memoryType: memType,
          key: learning.key,
          value: learning.value,
          confidence: learning.confidence || 0.5,
        })
      }
      if (decisions.new_learnings?.length) {
        console.log(`[AI-PILOT] Stored ${decisions.new_learnings.length} AI self-learnings`)
      }
    } catch (learnErr) {
      console.warn(`[AI-PILOT] new_learnings save failed: ${learnErr.message}`)
    }

    console.log(`[AI-PILOT] ✓ Campaign "${campaign.name}": ${decisions.overall_assessment} — ${appliedCount} adjustments applied — ${decisions.recommendation}`)

  } catch (err) {
    console.error(`[AI-PILOT] AI evaluation error: ${err.message}`)
    console.error(`[AI-PILOT] Stack: ${err.stack?.split('\n').slice(0, 3).join(' | ')}`)
  }
}

// ============================================
// AUTO ENGAGEMENT CHECK (every 30 min)
// ============================================

let lastEngagementCheck = 0

async function processEngagementChecks() {
  // Only run every 30 minutes
  const now = Date.now()
  if (now - lastEngagementCheck < 30 * 60 * 1000) return
  lastEngagementCheck = now

  // Check if agent is online
  const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id')
    .gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
  if (!agents?.length) return

  // Find own posts from last 48h that have fb_post_id
  const since48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString()
  const { data: ownPosts } = await supabase
    .from('publish_history')
    .select('id, fb_post_id, account_id, owner_id')
    .eq('status', 'success')
    .gte('published_at', since48h)
    .not('fb_post_id', 'is', null)
    .limit(50)

  if (!ownPosts?.length) return

  // Group by account_id
  const byAccount = {}
  for (const p of ownPosts) {
    if (!byAccount[p.account_id]) byAccount[p.account_id] = { owner_id: p.owner_id, posts: [] }
    byAccount[p.account_id].posts.push({ fb_post_id: p.fb_post_id, source_type: 'own_post', source_id: p.id })
  }

  for (const [accountId, { owner_id, posts }] of Object.entries(byAccount)) {
    const { error } = await supabase.from('jobs').insert({
      type: 'check_engagement',
      priority: getJobPriority('check_engagement'),
      payload: {
        account_id: accountId,
        post_ids: posts,
        owner_id,
      },
      status: 'pending',
      scheduled_at: new Date().toISOString(),
      created_by: owner_id,
    })

    if (!error) {
      console.log(`[SCHEDULER] Engagement check queued: ${posts.length} posts for account ${accountId}`)
    }
  }
}

// ============================================
// MONITORING SOURCES (Apify-based, every interval)
// ============================================

let monitoringInProgress = false

async function processMonitoringSources() {
  if (monitoringInProgress) return
  monitoringInProgress = true

  try {
    const now = new Date().toISOString()

    const { data: sources } = await supabase
      .from('monitored_sources')
      .select('*')
      .eq('is_active', true)
      .gt('fetch_interval_minutes', 0)
      .not('next_fetch_at', 'is', null)
      .lte('next_fetch_at', now)
      .order('next_fetch_at', { ascending: true })
      .limit(5)

    if (!sources?.length) return

    // Check agent online once
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id')
      .gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)

    if (!agents?.length) {
      console.log('[SCHEDULER] Agent offline — skipping all monitoring fetches')
      return
    }

    for (const source of sources) {
      try {
        const accountId = source.account_id || source.fetch_account_id
        if (!accountId) {
          console.log(`[SCHEDULER] Source ${source.name || source.fb_source_id} has no account — skipping`)
          const nextFetch = new Date(Date.now() + (source.fetch_interval_minutes || 60) * 60 * 1000)
          await supabase.from('monitored_sources').update({ next_fetch_at: nextFetch.toISOString() }).eq('id', source.id)
          continue
        }

        // Verify the assigned account is still active — don't queue jobs for checkpoint/disabled nicks
        const { data: acct } = await supabase.from('accounts')
          .select('is_active, status')
          .eq('id', accountId)
          .single()
        if (!acct || acct.is_active === false) {
          console.log(`[SCHEDULER] Source ${source.name || source.fb_source_id} → account ${accountId.slice(0, 8)} inactive (status: ${acct?.status || 'missing'}) — skipping fetch`)
          // Push next_fetch out 6h to avoid spamming logs while user fixes the nick
          await supabase.from('monitored_sources').update({
            next_fetch_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString()
          }).eq('id', source.id)
          continue
        }

        // Per-source dedup: skip if there's already a pending fetch_source_cookie
        // for this same source_id. Prevents pile-up when previous run hasn't finished.
        const { count: pendingForSource } = await supabase
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('type', 'fetch_source_cookie')
          .eq('status', 'pending')
          .eq('payload->>source_id', source.id)

        if ((pendingForSource || 0) > 0) {
          console.log(`[SCHEDULER] Source ${source.name || source.fb_source_id} already has ${pendingForSource} pending job(s) — skipping create`)
          // Push next_fetch out by interval so we don't loop on the same source
          const intervalMs = (source.fetch_interval_minutes || 60) * 60 * 1000
          await supabase.from('monitored_sources').update({
            next_fetch_at: new Date(Date.now() + intervalMs).toISOString(),
          }).eq('id', source.id)
          continue
        }

        const sourceUrl = source.url || `https://www.facebook.com/${source.source_type === 'group' ? 'groups/' : ''}${source.fb_source_id}`
        await supabase.from('jobs').insert({
          type: 'fetch_source_cookie',
          priority: getJobPriority('fetch_source_cookie'),
          payload: {
            account_id: accountId,
            source_url: sourceUrl,
            source_id: source.id,
            source_type: source.source_type,
            owner_id: source.owner_id,
          },
          status: 'pending',
          scheduled_at: new Date().toISOString(),
          created_by: source.owner_id,
        })

        // Update next_fetch_at immediately to prevent duplicate jobs
        const intervalMs = (source.fetch_interval_minutes || 60) * 60 * 1000
        await supabase.from('monitored_sources').update({
          next_fetch_at: new Date(Date.now() + intervalMs).toISOString(),
        }).eq('id', source.id)

        console.log(`[SCHEDULER] Created fetch job: ${source.name || source.fb_source_id} (next: ${source.fetch_interval_minutes}min)`)
      } catch (err) {
        console.error(`[SCHEDULER] Source ${source.id} error:`, err.message)
        const nextFetch = new Date(Date.now() + (source.fetch_interval_minutes || 60) * 60 * 1000)
        await supabase.from('monitored_sources').update({ next_fetch_at: nextFetch.toISOString() }).eq('id', source.id)
      }
    }
  } finally {
    monitoringInProgress = false
  }
}

module.exports = { initScheduler, executeCampaign }
