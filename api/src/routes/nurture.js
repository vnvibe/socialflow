const { getAccessibleIds } = require('../lib/access-check')

module.exports = async (fastify) => {
  const { supabase } = fastify

  function getOwnerId(req) {
    const asUser = req.query?.as_user
    if (asUser && req.user.role === 'admin' && asUser !== req.user.id) return asUser
    return req.user.id
  }

  // GET /nurture/profiles — List all nurture profiles with account info
  fastify.get('/profiles', { preHandler: fastify.authenticate }, async (req, reply) => {
    const ownerId = getOwnerId(req)

    const { data, error } = await supabase
      .from('nurture_profiles')
      .select(`
        *,
        accounts!inner(id, username, fb_user_id, avatar_url, status, is_active, created_at, last_used_at)
      `)
      .eq('owner_id', ownerId)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })

    // Get campaign role counts for each account (to show AI Pilot badge)
    const accountIds = (data || []).map(p => p.account_id)
    let campaignCounts = {}
    if (accountIds.length > 0) {
      const { data: roles } = await supabase
        .from('campaign_roles')
        .select('account_ids')
        .eq('is_active', true)
      if (roles) {
        for (const role of roles) {
          for (const accId of (role.account_ids || [])) {
            campaignCounts[accId] = (campaignCounts[accId] || 0) + 1
          }
        }
      }
    }

    // Enrich with age/phase info + campaign count
    const enriched = (data || []).map(p => {
      const acc = p.accounts
      const ageDays = Math.floor((Date.now() - new Date(acc.created_at).getTime()) / 86400000)
      let phase = 'mature'
      if (ageDays <= 7) phase = 'week1'
      else if (ageDays <= 14) phase = 'week2'
      else if (ageDays <= 21) phase = 'week3'
      else if (ageDays <= 30) phase = 'week4'

      // Reset daily counters if needed
      const today = new Date().toISOString().split('T')[0]
      const needsReset = p.budget_reset_date !== today

      return {
        ...p,
        account: acc,
        age_days: ageDays,
        phase,
        campaign_count: campaignCounts[p.account_id] || 0,
        today_reacts: needsReset ? 0 : p.today_reacts,
        today_comments: needsReset ? 0 : p.today_comments,
        today_stories: needsReset ? 0 : p.today_stories,
        today_sessions: needsReset ? 0 : p.today_sessions,
      }
    })

    return enriched
  })

  // POST /nurture/profiles — Create nurture profile for account
  fastify.post('/profiles', { preHandler: fastify.authenticate }, async (req, reply) => {
    const ownerId = getOwnerId(req)
    const { account_id, persona, daily_reacts, daily_comments, daily_story_views, daily_feed_scrolls, active_hours, active_days, min_session_gap_minutes } = req.body || {}

    if (!account_id) return reply.code(400).send({ error: 'account_id required' })

    // Verify ownership — must belong to current user
    const { data: acc } = await supabase.from('accounts')
      .select('id, owner_id')
      .eq('id', account_id)
      .eq('owner_id', req.user.id)
      .single()
    if (!acc) return reply.code(404).send({ error: 'Account not found or no access' })

    // Check if profile already exists
    const { data: existing } = await supabase.from('nurture_profiles').select('id').eq('account_id', account_id).single()
    if (existing) return reply.code(409).send({ error: 'Nurture profile already exists for this account' })

    const { data, error } = await supabase
      .from('nurture_profiles')
      .insert({
        owner_id: ownerId,
        account_id,
        persona: persona || 'friendly',
        daily_reacts: daily_reacts || 15,
        daily_comments: daily_comments || 3,
        daily_story_views: daily_story_views || 5,
        daily_feed_scrolls: daily_feed_scrolls || 3,
        active_hours: active_hours || { start: 7, end: 23 },
        active_days: active_days || [1, 2, 3, 4, 5, 6, 0],
        min_session_gap_minutes: min_session_gap_minutes || 60,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // PUT /nurture/profiles/:id — Update settings
  fastify.put('/profiles/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { id } = req.params
    const allowed = [
      'enabled', 'persona', 'daily_feed_scrolls', 'daily_reacts', 'daily_comments',
      'daily_story_views', 'active_hours', 'active_days', 'min_session_gap_minutes',
    ]
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }
    updates.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('nurture_profiles')
      .update(updates)
      .eq('id', id)
      .eq('owner_id', getOwnerId(req))
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    if (!data) return reply.code(404).send({ error: 'Not found' })
    return data
  })

  // DELETE /nurture/profiles/:id
  fastify.delete('/profiles/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase
      .from('nurture_profiles')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_id', getOwnerId(req))

    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // POST /nurture/profiles/:id/run — Manual trigger
  fastify.post('/profiles/:id/run', { preHandler: fastify.authenticate }, async (req, reply) => {
    try {
    const { id } = req.params
    const ownerId = getOwnerId(req)

    const { data: profile, error: profileErr } = await supabase
      .from('nurture_profiles')
      .select('*, accounts!inner(id, status, is_active)')
      .eq('id', id)
      .eq('owner_id', ownerId)
      .single()

    if (profileErr) return reply.code(500).send({ error: profileErr.message })
    if (!profile) return reply.code(404).send({ error: 'Profile not found' })
    if (!profile.accounts.is_active) return reply.code(400).send({ error: 'Account is not active' })
    if (profile.accounts.status === 'checkpoint' || profile.accounts.status === 'expired') {
      return reply.code(400).send({ error: `Account status: ${profile.accounts.status}` })
    }

    // Check no existing pending/running nurture job for this account
    const { data: existingJobs } = await supabase
      .from('jobs')
      .select('id, payload')
      .eq('type', 'nurture_feed')
      .in('status', ['pending', 'claimed', 'running'])
      .limit(50)

    const hasExisting = (existingJobs || []).some(j => {
      return j.payload?.account_id === profile.account_id
    })

    if (hasExisting) return reply.code(409).send({ error: 'Nick nay dang co job nurture pending/running' })

    // Create job
    const { data: job, error } = await supabase
      .from('jobs')
      .insert({
        type: 'nurture_feed',
        payload: {
          account_id: profile.account_id,
          nurture_profile_id: profile.id,
          owner_id: ownerId,
          persona: profile.persona,
          daily_reacts: profile.daily_reacts,
          daily_comments: profile.daily_comments,
          daily_story_views: profile.daily_story_views,
          today_reacts: profile.today_reacts || 0,
          today_comments: profile.today_comments || 0,
          today_stories: profile.today_stories || 0,
          manual: true,
        },
        status: 'pending',
        scheduled_at: new Date().toISOString(),
        created_by: ownerId,
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })

    // Update last_session_at
    await supabase.from('nurture_profiles').update({ last_session_at: new Date().toISOString() }).eq('id', id)

    return { success: true, job_id: job.id }
    } catch (err) {
      console.error('[NURTURE] Run error:', err.message)
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /nurture/jobs — Active nurture jobs (for UI state)
  fastify.get('/jobs', { preHandler: fastify.authenticate }, async (req, reply) => {
    const ownerId = getOwnerId(req)

    const { data, error } = await supabase
      .from('jobs')
      .select('id, type, status, payload, created_at, started_at')
      .eq('type', 'nurture_feed')
      .in('status', ['pending', 'claimed', 'running'])
      .eq('created_by', ownerId)
      .order('created_at', { ascending: false })
      .limit(20)

    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // POST /nurture/jobs/:jobId/cancel — Cancel a nurture job
  fastify.post('/jobs/:jobId/cancel', { preHandler: fastify.authenticate }, async (req, reply) => {
    try {
      const { jobId } = req.params
      const ownerId = getOwnerId(req)

      // Try cancelling pending/claimed jobs
      const { data, error } = await supabase
        .from('jobs')
        .update({ status: 'cancelled' })
        .eq('id', jobId)
        .eq('type', 'nurture_feed')
        .eq('created_by', ownerId)
        .in('status', ['pending', 'claimed', 'running'])
        .select()

      if (error) return reply.code(500).send({ error: error.message })
      if (!data?.length) return reply.code(404).send({ error: 'Job not found or already done' })
      return { success: true }
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /nurture/activity — Recent activity log
  fastify.get('/activity', { preHandler: fastify.authenticate }, async (req, reply) => {
    const ownerId = getOwnerId(req)
    const limit = Math.min(parseInt(req.query.limit) || 50, 200)
    const offset = parseInt(req.query.offset) || 0
    const profileId = req.query.profile_id

    let query = supabase
      .from('campaign_activity_log')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('source', 'nurture')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (profileId) query = query.filter('details->>nurture_profile_id', 'eq', profileId)

    const accountId = req.query.account_id
    if (accountId) query = query.eq('account_id', accountId)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // GET /nurture/stats — Aggregate stats
  fastify.get('/stats', { preHandler: fastify.authenticate }, async (req, reply) => {
    const ownerId = getOwnerId(req)

    const { data: profiles } = await supabase
      .from('nurture_profiles')
      .select('enabled, health_score, today_sessions, today_reacts, today_comments, today_stories, streak_days')
      .eq('owner_id', ownerId)

    if (!profiles || profiles.length === 0) {
      return { total_profiles: 0, enabled: 0, today_sessions: 0, today_reacts: 0, today_comments: 0, avg_health: 0 }
    }

    const enabled = profiles.filter(p => p.enabled).length
    const today = new Date().toISOString().split('T')[0]

    return {
      total_profiles: profiles.length,
      enabled,
      today_sessions: profiles.reduce((s, p) => s + (p.today_sessions || 0), 0),
      today_reacts: profiles.reduce((s, p) => s + (p.today_reacts || 0), 0),
      today_comments: profiles.reduce((s, p) => s + (p.today_comments || 0), 0),
      today_stories: profiles.reduce((s, p) => s + (p.today_stories || 0), 0),
      avg_health: Math.round(profiles.reduce((s, p) => s + (p.health_score || 0), 0) / profiles.length),
      max_streak: Math.max(...profiles.map(p => p.streak_days || 0)),
    }
  })

  // POST /nurture/bulk-enable
  fastify.post('/bulk-enable', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase
      .from('nurture_profiles')
      .update({ enabled: true, updated_at: new Date().toISOString() })
      .eq('owner_id', getOwnerId(req))

    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // POST /nurture/bulk-disable
  fastify.post('/bulk-disable', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase
      .from('nurture_profiles')
      .update({ enabled: false, updated_at: new Date().toISOString() })
      .eq('owner_id', getOwnerId(req))

    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })
}
