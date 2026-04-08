const cron = require('node-cron')
const { createClient } = require('@supabase/supabase-js')
const { getBusyNicks } = require('../lib/nick-lock')

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Age-based max sessions per day
function getMaxSessions(ageDays, profileTarget) {
  if (ageDays <= 7) return 1
  if (ageDays <= 14) return 2
  if (ageDays <= 21) return 3
  return profileTarget
}

// Random jitter ±minutes
function jitter(minutes) {
  return Math.floor(Math.random() * minutes * 2) - minutes
}

/**
 * Auto-create nurture profiles for active accounts that don't have one yet.
 * This ensures nurture is the BASELINE — every nick gets nurtured by default.
 * Runs once per scheduler cycle (every 2 min).
 */
async function autoCreateProfiles() {
  try {
    // Get all active accounts
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, owner_id, status, is_active')
      .eq('is_active', true)
      .not('status', 'in', '("checkpoint","expired","disabled")')

    if (!accounts?.length) return

    // Get existing nurture profiles
    const { data: existing } = await supabase
      .from('nurture_profiles')
      .select('account_id')

    const hasProfile = new Set((existing || []).map(p => p.account_id))

    // Create profiles for accounts that don't have one
    const toCreate = accounts.filter(a => !hasProfile.has(a.id))
    if (!toCreate.length) return

    const inserts = toCreate.map(a => ({
      owner_id: a.owner_id,
      account_id: a.id,
      enabled: true,
      persona: 'friendly',
      daily_feed_scrolls: 2,        // 2 sessions/ngày — nhẹ nhàng
      daily_reacts: 5,              // 5 likes/ngày — rất an toàn
      daily_comments: 1,            // 1 comment/ngày — rất chọn lọc
      daily_story_views: 2,         // 2 stories/ngày
      min_session_gap_minutes: 180, // 3 giờ giữa mỗi session
    }))

    const { error } = await supabase.from('nurture_profiles').insert(inserts)
    if (!error) {
      console.log(`[NURTURE] Auto-created ${inserts.length} nurture profiles for new accounts`)
    }
  } catch (err) {
    console.error('[NURTURE] Auto-create error:', err.message)
  }
}

async function processNurtureProfiles() {
  const now = new Date()
  const currentHour = now.getHours()
  const currentDay = now.getDay()
  const todayStr = now.toISOString().split('T')[0]

  try {
    // Auto-create profiles for accounts without one
    await autoCreateProfiles()

    // Fetch all enabled profiles with account info
    const { data: profiles, error } = await supabase
      .from('nurture_profiles')
      .select(`
        *,
        accounts!inner(id, status, is_active, created_at)
      `)
      .eq('enabled', true)

    if (error || !profiles?.length) return

    // Batch check which nicks are already busy (campaign or nurture jobs)
    const allAccountIds = profiles.map(p => p.accounts.id)
    const busyNicks = await getBusyNicks(allAccountIds)

    for (const profile of profiles) {
      try {
        const acc = profile.accounts

        // 0. Nick lock: skip if nick has ANY active job (campaign or nurture)
        if (busyNicks.has(acc.id)) {
          continue
        }

        // 1. Account must be active and healthy
        if (!acc.is_active) continue
        if (['checkpoint', 'expired', 'disabled'].includes(acc.status)) continue

        // 2. Health score check
        if (profile.health_score <= 0) continue

        // 3. Active days check
        if (!profile.active_days?.includes(currentDay)) continue

        // 4. Active hours check
        const hours = profile.active_hours || { start: 7, end: 23 }
        if (currentHour < hours.start || currentHour >= hours.end) continue

        // 5. Reset daily counters if needed
        if (profile.budget_reset_date !== todayStr) {
          // Check streak: was last session yesterday?
          const yesterday = new Date(now - 86400000).toISOString().split('T')[0]
          const lastSessionDate = profile.last_session_at
            ? new Date(profile.last_session_at).toISOString().split('T')[0]
            : null
          const newStreak = lastSessionDate === yesterday ? (profile.streak_days || 0) + 1 : 0

          await supabase.from('nurture_profiles').update({
            today_reacts: 0,
            today_comments: 0,
            today_stories: 0,
            today_sessions: 0,
            budget_reset_date: todayStr,
            streak_days: newStreak,
            updated_at: now.toISOString(),
          }).eq('id', profile.id)

          // Use reset values for this cycle
          profile.today_reacts = 0
          profile.today_comments = 0
          profile.today_stories = 0
          profile.today_sessions = 0
        }

        // 6. Check daily targets — skip if all met
        const ageDays = Math.floor((Date.now() - new Date(acc.created_at).getTime()) / 86400000)
        const maxSessions = getMaxSessions(ageDays, profile.daily_feed_scrolls)

        if (
          profile.today_sessions >= maxSessions &&
          profile.today_reacts >= profile.daily_reacts &&
          profile.today_comments >= profile.daily_comments
        ) continue

        // 7. Session gap check with jitter — MINIMUM 90 phút giữa sessions
        if (profile.last_session_at) {
          const elapsed = (now - new Date(profile.last_session_at)) / 60000 // minutes
          const baseGap = Math.max(profile.min_session_gap_minutes, 90) // enforce minimum 90 phút
          const effectiveGap = baseGap + jitter(20) // ±20min jitter
          if (elapsed < Math.max(effectiveGap, 90)) continue // hard minimum 90 phút
        }

        // 8. Create nurture_feed job with scheduling jitter
        const scheduleDelay = Math.floor(Math.random() * 300) + 60 // 1-6 phút delay
        const scheduledAt = new Date(now.getTime() + scheduleDelay * 1000).toISOString()

        const remainReacts = Math.max(0, profile.daily_reacts - (profile.today_reacts || 0))
        const remainComments = Math.max(0, profile.daily_comments - (profile.today_comments || 0))
        const remainStories = Math.max(0, profile.daily_story_views - (profile.today_stories || 0))

        await supabase.from('jobs').insert({
          type: 'nurture_feed',
          priority: 3, // HIGH — main work
          payload: {
            account_id: acc.id,
            nurture_profile_id: profile.id,
            owner_id: profile.owner_id,
            persona: profile.persona,
            daily_reacts: profile.daily_reacts,
            daily_comments: profile.daily_comments,
            daily_story_views: profile.daily_story_views,
            today_reacts: profile.today_reacts || 0,
            today_comments: profile.today_comments || 0,
            today_stories: profile.today_stories || 0,
            remain_reacts: remainReacts,
            remain_comments: remainComments,
            remain_stories: remainStories,
            age_days: ageDays,
          },
          status: 'pending',
          scheduled_at: scheduledAt,
          created_by: profile.owner_id,
        })

        // Update last_session_at immediately to prevent double-scheduling
        await supabase.from('nurture_profiles').update({
          last_session_at: now.toISOString(),
        }).eq('id', profile.id)

        console.log(`[NURTURE] Scheduled nurture_feed for ${acc.id} (age: ${ageDays}d, sessions: ${profile.today_sessions}/${maxSessions})`)

      } catch (err) {
        console.error(`[NURTURE] Error processing profile ${profile.id}:`, err.message)
      }
    }
  } catch (err) {
    console.error('[NURTURE] Scheduler error:', err.message)
  }
}

// ============================================
// GROUP MONITOR SCHEDULING
// ============================================

async function scheduleGroupMonitors() {
  try {
    const now = new Date()

    // Fetch monitored groups that need scanning
    const { data: groups, error } = await supabase
      .from('monitored_groups')
      .select('*, accounts!inner(id, status, is_active)')
      .eq('is_active', true)

    if (error || !groups?.length) return

    // Filter: needs scan (null or past due)
    const needsScan = groups.filter(g => {
      if (!g.last_scanned_at) return true
      const elapsed = (now - new Date(g.last_scanned_at)) / 60000
      return elapsed >= (g.scan_interval_minutes || 120)
    })

    if (!needsScan.length) return

    // Check agent online
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id')
      .gte('last_seen', new Date(Date.now() - 120000).toISOString()).limit(1)
    if (!agents?.length) return

    // Batch check busy nicks
    const accountIds = [...new Set(needsScan.map(g => g.account_id).filter(Boolean))]
    const busyNicks = await getBusyNicks(accountIds)

    for (const group of needsScan) {
      try {
        const acc = group.accounts
        if (!acc.is_active || ['checkpoint', 'expired', 'disabled'].includes(acc.status)) continue
        if (busyNicks.has(acc.id)) continue

        // Check no duplicate job pending
        const { count } = await supabase
          .from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('type', 'campaign_group_monitor')
          .in('status', ['pending', 'claimed', 'running'])
          .filter('payload->>monitored_group_id', 'eq', group.id)

        if (count > 0) continue

        // Create monitor job with jitter
        const scheduleDelay = Math.floor(Math.random() * 180) + 30 // 30s-3.5min
        const scheduledAt = new Date(now.getTime() + scheduleDelay * 1000).toISOString()

        await supabase.from('jobs').insert({
          type: 'campaign_group_monitor',
          priority: 5, // NORMAL
          payload: {
            monitored_group_id: group.id,
            account_id: acc.id,
            campaign_id: group.campaign_id,
            owner_id: group.owner_id,
            group_fb_id: group.group_fb_id,
            group_name: group.group_name,
            group_url: group.group_url,
            brand_keywords: group.brand_keywords,
            brand_name: group.brand_name,
            brand_voice: group.brand_voice,
            opportunity_threshold: group.opportunity_threshold || 7,
            scan_lookback_minutes: group.scan_lookback_minutes || 180,
          },
          status: 'pending',
          scheduled_at: scheduledAt,
          created_by: group.owner_id,
        })

        // Update last_scanned_at immediately to prevent double-scheduling
        await supabase.from('monitored_groups').update({
          last_scanned_at: now.toISOString(),
        }).eq('id', group.id)

        console.log(`[GROUP-MONITOR] Scheduled scan for "${group.group_name}" (campaign: ${group.campaign_id})`)
      } catch (err) {
        console.error(`[GROUP-MONITOR] Error scheduling group ${group.id}:`, err.message)
      }
    }
  } catch (err) {
    console.error('[GROUP-MONITOR] Scheduler error:', err.message)
  }
}

function initNurtureScheduler() {
  // Run every 5 minutes — nurture is slow/relaxed, no need to check frequently
  cron.schedule('*/5 * * * *', () => {
    processNurtureProfiles().catch(err => console.error('[NURTURE] cron error:', err.message))
    scheduleGroupMonitors().catch(err => console.error('[GROUP-MONITOR] cron error:', err.message))
  })

  // Weekly: decay old AI memories (every Sunday 3am)
  cron.schedule('0 3 * * 0', async () => {
    try {
      const { decayOldMemories } = require('./ai-memory')
      const count = await decayOldMemories(supabase)
      if (count > 0) console.log(`[AI-MEMORY] Weekly decay: ${count} memories adjusted`)
    } catch (err) {
      console.error('[AI-MEMORY] Weekly decay error:', err.message)
    }
  })

  // Phase 5: Weekly DeepSeek strategy update (every Sunday 4am)
  cron.schedule('0 4 * * 0', async () => {
    try {
      const { runWeeklyStrategy } = require('./ai-strategy')
      await runWeeklyStrategy(supabase)
    } catch (err) {
      console.error('[AI-STRATEGY] Weekly strategy error:', err.message)
    }
  })

  // Daily: cleanup stale jobs (every day 0:15 VN time)
  cron.schedule('15 0 * * *', async () => {
    try {
      // Delete pending jobs older than 24h (budget-skipped, never ran)
      const { count: pendingDeleted } = await supabase
        .from('jobs')
        .delete({ count: 'exact' })
        .eq('status', 'pending')
        .lt('scheduled_at', new Date(Date.now() - 24 * 3600 * 1000).toISOString())

      // Delete cancelled jobs older than 3 days
      const { count: cancelledDeleted } = await supabase
        .from('jobs')
        .delete({ count: 'exact' })
        .eq('status', 'cancelled')
        .lt('created_at', new Date(Date.now() - 3 * 86400000).toISOString())

      // Delete done jobs older than 7 days (keep recent for audit)
      const { count: doneDeleted } = await supabase
        .from('jobs')
        .delete({ count: 'exact' })
        .eq('status', 'done')
        .lt('finished_at', new Date(Date.now() - 7 * 86400000).toISOString())

      const total = (pendingDeleted || 0) + (cancelledDeleted || 0) + (doneDeleted || 0)
      if (total > 0) {
        console.log(`[CLEANUP] Daily jobs cleanup: ${pendingDeleted || 0} stale pending, ${cancelledDeleted || 0} cancelled, ${doneDeleted || 0} old done — total ${total} deleted`)
      }

      // Also cleanup old health signals (>30 days)
      await supabase.from('account_health_signals')
        .delete()
        .lt('detected_at', new Date(Date.now() - 30 * 86400000).toISOString())
    } catch (err) {
      console.error('[CLEANUP] Daily cleanup error:', err.message)
    }
  })

  console.log('[NURTURE] Scheduler initialized (every 5 min) — includes group monitor + weekly memory decay + daily cleanup')
}

module.exports = { initNurtureScheduler }
