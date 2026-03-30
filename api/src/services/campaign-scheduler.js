const cron = require('node-cron')
const cronParser = require('cron-parser')
const { createClient } = require('@supabase/supabase-js')

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
    // scan_group_keyword auto-scheduling disabled — jobs must be triggered manually
    // try {
    //   await processPendingScans()
    // } catch (err) {
    //   console.error('[SCHEDULER] Scan error:', err.message)
    // }
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

  // Create jobs for each target with delay
  let jobsCreated = 0
  for (let i = 0; i < allTargets.length; i++) {
    const target = allTargets[i]
    const delayMinutes = i * (campaign.delay_between_targets_minutes || 15)
    const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000)

    // Get account for this target
    let accountId = null
    if (target.type === 'page') {
      const { data } = await supabase.from('fanpages').select('account_id').eq('id', target.id).single()
      accountId = data?.account_id
    } else if (target.type === 'group') {
      const { data } = await supabase.from('fb_groups').select('account_id').eq('id', target.id).single()
      accountId = data?.account_id
    } else {
      accountId = target.id // profile = account
    }

    if (!accountId) continue

    const { error } = await supabase.from('jobs').insert({
      type: `post_${target.type}`,
      payload: {
        content_id: contentId,
        target_id: target.id,
        account_id: accountId,
        campaign_id: campaign.id,
        spin_mode: campaign.spin_mode || 'none'
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
      const interval = cronParser.parseExpression(campaign.cron_expression, {
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
    for (let i = 0; i < accountIds.length; i++) {
      orderedAccounts.push(accountIds[(lastIdx + i) % accountIds.length])
    }
    rrState[role.id] = (lastIdx + orderedAccounts.length) % accountIds.length

    for (let i = 0; i < orderedAccounts.length; i++) {
      const accountId = orderedAccounts[i]

      // Skip if duplicate job already exists
      const jobKey = `${jobType}:${accountId}`
      if (existingKeys.has(jobKey)) {
        jobsSkipped++
        continue
      }

      const nickDelay = i * (campaign.nick_stagger_seconds || 60)
      const totalDelaySec = roleDelay + nickDelay
      const scheduledAt = new Date(Date.now() + totalDelaySec * 1000)

      const { error } = await supabase.from('jobs').insert({
        type: jobType,
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
 * AI Supreme Control — evaluates campaign results and auto-adjusts
 * Runs every 3rd campaign execution. Can:
 * - Adjust parsed_plan counts (increase/decrease actions)
 * - Pause underperforming roles
 * - Reallocate nicks between roles
 * - Log decisions to campaign_activity_log
 */
async function aiEvaluateCampaign(campaign, roles) {
  // Gather results from last 24h
  const { data: activityStats } = await supabase
    .from('campaign_activity_log')
    .select('action_type, result_status, account_id')
    .eq('campaign_id', campaign.id)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())

  if (!activityStats?.length) return

  const summary = {}
  const accountPerf = {}
  for (const s of activityStats) {
    if (!summary[s.action_type]) summary[s.action_type] = { total: 0, success: 0, failed: 0 }
    summary[s.action_type].total++
    if (s.result_status === 'success') summary[s.action_type].success++
    if (s.result_status === 'failed') summary[s.action_type].failed++

    // Per-account performance
    if (s.account_id) {
      if (!accountPerf[s.account_id]) accountPerf[s.account_id] = { total: 0, success: 0, failed: 0 }
      accountPerf[s.account_id].total++
      if (s.result_status === 'success') accountPerf[s.account_id].success++
      if (s.result_status === 'failed') accountPerf[s.account_id].failed++
    }
  }

  const summaryText = Object.entries(summary).map(([k, v]) =>
    `${k}: ${v.total} (success: ${v.success}, failed: ${v.failed})`
  ).join('\n')

  const accountText = Object.entries(accountPerf).map(([id, v]) =>
    `${id.slice(0, 8)}: ${v.total} actions, ${v.failed} failed`
  ).join('\n')

  // Call AI for evaluation
  try {
    const { getOrchestratorForUser } = require('./ai/orchestrator')
    const orchestrator = await getOrchestratorForUser(campaign.owner_id, supabase)

    const prompt = `Ban la AI dieu khien chien dich marketing tren Facebook.
Campaign: "${campaign.name}" (topic: ${campaign.topic})
Da chay ${campaign.total_runs} lan.

Ket qua 24h qua:
${summaryText}

Hieu suat per-nick:
${accountText}

Roles hien tai:
${roles.map(r => `- ${r.name} (${r.role_type}): ${(r.account_ids || []).length} nick`).join('\n')}

Hay tra loi JSON voi cac quyet dinh:
{
  "adjustments": [
    {"role_id": "...", "action": "increase|decrease|pause|resume", "field": "count_max|count_min", "value": number, "reason": "..."}
  ],
  "overall_assessment": "good|warning|critical",
  "recommendation": "..."
}
Chi tra ve JSON, khong giai thich them.`

    const result = await orchestrator.call('caption_gen', [
      { role: 'user', content: prompt }
    ], { max_tokens: 500, temperature: 0.2 })

    const text = result?.text || result || ''
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      let decisions
      try { decisions = JSON.parse(match[0]) } catch { decisions = {} }

      // Apply adjustments
      for (const adj of (decisions.adjustments || [])) {
        if (!adj.role_id || !adj.action) continue

        if (adj.action === 'pause') {
          await supabase.from('campaign_roles').update({ is_active: false }).eq('id', adj.role_id)
          console.log(`[AI-CTRL] Paused role ${adj.role_id}: ${adj.reason}`)
        } else if (adj.action === 'resume') {
          await supabase.from('campaign_roles').update({ is_active: true }).eq('id', adj.role_id)
          console.log(`[AI-CTRL] Resumed role ${adj.role_id}: ${adj.reason}`)
        } else if ((adj.action === 'increase' || adj.action === 'decrease') && adj.field && adj.value) {
          const role = roles.find(r => r.id === adj.role_id)
          if (role?.parsed_plan) {
            let plan
            try { plan = typeof role.parsed_plan === 'string' ? JSON.parse(role.parsed_plan) : role.parsed_plan } catch { plan = [] }
            for (const step of plan) {
              if (step[adj.field] !== undefined) {
                step[adj.field] = Math.max(1, adj.value)
              }
            }
            await supabase.from('campaign_roles').update({ parsed_plan: plan }).eq('id', adj.role_id)
            console.log(`[AI-CTRL] Adjusted role ${adj.role_id} ${adj.field}=${adj.value}: ${adj.reason}`)
          }
        }
      }

      // Log AI decision
      await supabase.from('campaign_activity_log').insert({
        campaign_id: campaign.id,
        action_type: 'ai_control',
        result_status: decisions.overall_assessment || 'success',
        details: {
          assessment: decisions.overall_assessment,
          recommendation: decisions.recommendation,
          adjustments: decisions.adjustments,
          run_number: campaign.total_runs,
        },
        created_at: new Date().toISOString(),
      })

      console.log(`[AI-CTRL] Campaign ${campaign.name}: ${decisions.overall_assessment} — ${decisions.recommendation}`)
    }
  } catch (err) {
    console.warn(`[AI-CTRL] AI evaluation error: ${err.message}`)
  }
}

// ============================================
// SCAN KEYWORDS SCHEDULER
// ============================================

async function processPendingScans() {
  const now = new Date().toISOString()

  const { data: keywords } = await supabase
    .from('scan_keywords')
    .select('*')
    .eq('is_active', true)
    .lte('next_scan_at', now)

  if (!keywords?.length) return

  // Check if agent is online
  const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id')
    .gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
  if (!agents?.length) return // No agent, skip this cycle

  for (const kw of keywords) {
    try {
      // Determine job type based on scan_type
      let jobType
      if (kw.scan_type === 'discover_groups') jobType = 'discover_groups_keyword'
      else if (kw.scan_type === 'group_feed') jobType = 'scan_group_feed'
      else jobType = 'scan_group_keyword'

      // For group scans: resolve target groups
      let groupIds = kw.target_group_ids
      if ((jobType === 'scan_group_keyword' || jobType === 'scan_group_feed') && (!groupIds || groupIds.length === 0)) {
        const { data: groups } = await supabase.from('fb_groups').select('fb_group_id')
          .eq('account_id', kw.account_id)
        groupIds = groups?.map(g => g.fb_group_id) || []
      }

      // Create job
      const { error } = await supabase.from('jobs').insert({
        type: jobType,
        payload: {
          account_id: kw.account_id,
          keyword: kw.keyword,
          keyword_id: kw.id,
          group_ids: groupIds,
          topics: kw.topics || [],
          time_window_hours: kw.time_window_hours,
          owner_id: kw.owner_id,
        },
        status: 'pending',
        scheduled_at: now,
        created_by: kw.owner_id,
      })

      if (error) {
        console.error(`[SCHEDULER] Scan job create error for keyword "${kw.keyword}":`, error.message)
        continue
      }

      // Calculate next scan
      let nextScan = null
      if (kw.cron_expression) {
        try {
          const interval = cronParser.parseExpression(kw.cron_expression, {
            currentDate: new Date(),
            tz: 'Asia/Ho_Chi_Minh',
          })
          nextScan = interval.next().toDate().toISOString()
        } catch (e) {
          nextScan = new Date(Date.now() + 6 * 3600 * 1000).toISOString() // fallback: 6h
        }
      }

      await supabase.from('scan_keywords').update({
        last_scan_at: now,
        next_scan_at: nextScan,
        total_scans: (kw.total_scans || 0) + 1,
      }).eq('id', kw.id)

      console.log(`[SCHEDULER] Scan queued: "${kw.keyword}" (${kw.scan_type}), next: ${nextScan || 'none'}`)
    } catch (err) {
      console.error(`[SCHEDULER] Scan keyword "${kw.keyword}" error:`, err.message)
    }
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

        const sourceUrl = source.url || `https://www.facebook.com/${source.source_type === 'group' ? 'groups/' : ''}${source.fb_source_id}`
        await supabase.from('jobs').insert({
          type: 'fetch_source_cookie',
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
