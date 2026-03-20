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
      await processPendingScans()
    } catch (err) {
      console.error('[SCHEDULER] Scan error:', err.message)
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

  console.log('[SCHEDULER] Campaign + Scan + Engagement + Monitoring scheduler started')
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
  if (monitoringInProgress) return // prevent overlap
  monitoringInProgress = true

  try {
    const now = new Date().toISOString()

    const { data: sources } = await supabase
      .from('monitored_sources')
      .select('*')
      .eq('is_active', true)
      .lte('next_fetch_at', now)
      .order('next_fetch_at', { ascending: true })
      .limit(3) // max 3 per cycle to avoid Apify quota burn

    if (!sources?.length) return

    const { fetchSourcePosts } = require('../routes/monitoring')

    for (const source of sources) {
      try {
        const method = source.fetch_method || 'apify'
        console.log(`[SCHEDULER] Fetching ${source.name || source.fb_source_id} via ${method}`)

        if (method === 'cookie' && source.fetch_account_id) {
          // Cookie method: create agent job
          const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id')
            .gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)

          if (!agents?.length) {
            console.log(`[SCHEDULER] Agent offline — skipping cookie fetch for ${source.name || source.fb_source_id}`)
            const nextFetch = new Date(Date.now() + 5 * 60 * 1000) // retry in 5min
            await supabase.from('monitored_sources').update({ next_fetch_at: nextFetch.toISOString() }).eq('id', source.id)
            continue
          }

          const sourceUrl = source.url || `https://www.facebook.com/${source.source_type === 'group' ? 'groups/' : ''}${source.fb_source_id}`
          await supabase.from('jobs').insert({
            type: 'fetch_source_cookie',
            payload: {
              account_id: source.fetch_account_id,
              source_url: sourceUrl,
              source_id: source.id,
              source_type: source.source_type,
              owner_id: source.owner_id,
            },
            status: 'pending',
            scheduled_at: new Date().toISOString(),
            created_by: source.owner_id,
          })
          console.log(`[SCHEDULER] Created cookie fetch job for ${source.name || source.fb_source_id}`)
          // next_fetch_at will be updated by the agent handler when done
        } else {
          // Apify method (default)
          const result = await fetchSourcePosts(supabase, source)
          console.log(`[SCHEDULER] Source ${source.name || source.fb_source_id}: ${(result || []).length} posts`)
        }
      } catch (err) {
        console.error(`[SCHEDULER] Monitoring source ${source.id} error:`, err.message)
        // Push next_fetch_at forward to avoid retrying immediately
        const nextFetch = new Date(Date.now() + (source.fetch_interval_minutes || 60) * 60 * 1000)
        await supabase.from('monitored_sources').update({
          next_fetch_at: nextFetch.toISOString(),
        }).eq('id', source.id)
      }
    }
  } finally {
    monitoringInProgress = false
  }
}

module.exports = { initScheduler, executeCampaign }
