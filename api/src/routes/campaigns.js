const { parseMission } = require('../services/campaign-planner')

module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /campaigns/calendar - Calendar data for jobs + publish_history
  fastify.get('/calendar', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { start, end } = req.query
    if (!start || !end) return reply.code(400).send({ error: 'start and end query params required (ISO format)' })

    try {
      // Fetch scheduled/running jobs
      const { data: jobs } = await supabase
        .from('jobs')
        .select('id, type, payload, status, scheduled_at, started_at, finished_at, error_message')
        .gte('scheduled_at', start)
        .lte('scheduled_at', end)
        .eq('created_by', req.user.id)
        .order('scheduled_at', { ascending: true })

      // Fetch publish history
      const { data: history } = await supabase
        .from('publish_history')
        .select('id, target_type, target_name, target_fb_id, final_caption, status, published_at, error_message')
        .gte('published_at', start)
        .lte('published_at', end)
        .eq('account_id', req.user.id) // owner filter via join would be better
        .order('published_at', { ascending: true })

      // Build calendar events
      const events = []

      for (const job of (jobs || [])) {
        const action = job.payload?.action || job.type
        const targetName = job.payload?.target_name || action
        events.push({
          id: job.id,
          type: 'job',
          title: `${action.replace('post_', 'Post to ').replace('_', ' ')}`,
          target_name: targetName,
          start: job.scheduled_at,
          status: job.status,
          caption_preview: job.payload?.caption?.substring(0, 100) || null,
          error: job.error_message,
        })
      }

      for (const h of (history || [])) {
        events.push({
          id: h.id,
          type: 'history',
          title: `Posted to ${h.target_name || h.target_type}`,
          target_name: h.target_name,
          start: h.published_at,
          status: h.status,
          caption_preview: h.final_caption?.substring(0, 100) || null,
          error: h.error_message,
        })
      }

      return events
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /campaigns
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /campaigns/:id (includes roles)
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*, campaign_roles(*)')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (error) return reply.code(404).send({ error: 'Not found' })
    // Sort roles by sort_order
    if (data.campaign_roles) {
      data.campaign_roles.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0))
    }
    return data
  })

  // POST /campaigns/preview-plan — AI generates plan from requirement (no save)
  fastify.post('/preview-plan', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { requirement, topic, account_ids } = req.body
    if (!requirement) return reply.code(400).send({ error: 'requirement required' })
    if (!account_ids?.length) return reply.code(400).send({ error: 'account_ids required' })

    // Get account names for context
    const { data: accounts } = await supabase
      .from('accounts')
      .select('id, username, fb_user_id, status, daily_budget, created_at')
      .in('id', account_ids)
      .eq('owner_id', req.user.id)

    if (!accounts?.length) return reply.code(400).send({ error: 'No valid accounts found' })

    const accountNames = accounts.map(a => a.username || a.fb_user_id)
    const nickAges = accounts.map(a => {
      const days = Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86400000)
      return { name: a.username || a.fb_user_id, age_days: days, status: a.status }
    })

    try {
      const steps = await parseMission(
        requirement,
        { topic: topic || '', roleType: 'auto', accountCount: accounts.length, accountNames, nickAges },
        req.user.id,
        supabase
      )

      // Build rich plan object matching frontend expectations
      // Distribute steps across accounts as roles
      const HARD_LIMITS = { like: 100, comment: 30, friend_request: 20, join_group: 3, post: 5, scan: 50 }
      const roles = accounts.map((acc, i) => {
        const name = acc.username || acc.fb_user_id || `Nick ${i + 1}`
        const ageDays = Math.floor((Date.now() - new Date(acc.created_at).getTime()) / 86400000)
        const ageFactor = ageDays < 30 ? 0.4 : ageDays < 90 ? 0.6 : ageDays < 180 ? 0.85 : 1.0
        return {
          name,
          account_name: name,
          account_ids: [acc.id],
          role_type: 'custom',
          steps: steps.map(s => ({
            ...s,
            quantity: s.count_mode === 'fixed' ? s.count_min : `${Math.round(s.count_min * ageFactor)}-${Math.round(s.count_max * ageFactor)}`,
          })),
        }
      })

      // Compute daily budget summary
      const dailyBudget = {}
      for (const step of steps) {
        const key = step.quota_key || step.action
        const max = step.count_max || step.count_min || 1
        dailyBudget[key] = (dailyBudget[key] || 0) + max * accounts.length
      }

      // Safety warnings
      const warnings = []
      for (const [key, total] of Object.entries(dailyBudget)) {
        const limit = HARD_LIMITS[key]
        if (limit && total > limit) {
          warnings.push(`${key}: ${total}/ngay vuot gioi han ${limit}/ngay`)
        }
      }

      // Estimate duration (each step ~2-5 min depending on count)
      const totalSteps = steps.reduce((sum, s) => sum + (s.count_max || 1), 0)
      const estimatedMinutes = Math.round(totalSteps * 2.5 * accounts.length)

      const plan = {
        summary: `${roles.length} nick × ${steps.length} buoc, topic: ${topic || 'general'}`,
        roles,
        daily_budget: dailyBudget,
        safety_warnings: warnings,
        estimated_duration_minutes: estimatedMinutes,
      }

      return { plan, accounts: accountNames }
    } catch (err) {
      return reply.code(500).send({ error: `AI plan failed: ${err.message}` })
    }
  })

  // POST /campaigns
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const {
      name, topic, requirement, account_ids, ai_plan, ai_plan_confirmed,
      target_pages, target_groups, target_profiles,
      content_ids, rotation_mode, spin_mode,
      schedule_type, cron_expression, interval_minutes,
      start_at, end_at, delay_between_targets_minutes,
      nick_stagger_seconds, role_stagger_minutes, campaign_active_days
    } = req.body

    if (!name) return reply.code(400).send({ error: 'name required' })

    const { data, error } = await supabase.from('campaigns').insert({
      owner_id: req.user.id,
      name,
      topic: topic || null,
      requirement: requirement || null,
      account_ids: account_ids || [],
      ai_plan: ai_plan || null,
      ai_plan_confirmed: ai_plan_confirmed || false,
      target_pages: target_pages || [],
      target_groups: target_groups || [],
      target_profiles: target_profiles || [],
      content_ids: content_ids || [],
      rotation_mode: rotation_mode || 'sequential',
      spin_mode: spin_mode || 'basic',
      schedule_type, cron_expression, interval_minutes,
      start_at, end_at,
      delay_between_targets_minutes: delay_between_targets_minutes || 15,
      nick_stagger_seconds: nick_stagger_seconds || 60,
      role_stagger_minutes: role_stagger_minutes || 30,
      campaign_active_days: campaign_active_days || [1,2,3,4,5,6,0],
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })

    // Auto-create roles from ai_plan if confirmed
    if (ai_plan?.roles && ai_plan_confirmed) {
      for (let i = 0; i < ai_plan.roles.length; i++) {
        const role = ai_plan.roles[i]
        await supabase.from('campaign_roles').insert({
          campaign_id: data.id,
          name: role.name || `Role ${String.fromCharCode(65 + i)}`,
          role_type: role.role_type || 'custom',
          account_ids: role.account_ids || [],
          mission: role.mission || '',
          parsed_plan: role.steps || null,
          sort_order: i,
          is_active: true,
        })
      }
    }

    return reply.code(201).send(data)
  })

  // PUT /campaigns/:id
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = [
      'name', 'topic', 'requirement', 'account_ids', 'ai_plan', 'ai_plan_confirmed',
      'target_pages', 'target_groups', 'target_profiles',
      'content_ids', 'rotation_mode', 'spin_mode',
      'schedule_type', 'cron_expression', 'interval_minutes',
      'start_at', 'end_at', 'delay_between_targets_minutes',
      'nick_stagger_seconds', 'role_stagger_minutes', 'campaign_active_days'
    ]
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase
      .from('campaigns')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /campaigns/:id
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase.from('campaigns').delete().eq('id', req.params.id).eq('owner_id', req.user.id)
    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // POST /campaigns/:id/start
  fastify.post('/:id/start', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('campaigns')
      .update({
        is_active: true,
        status: 'running',
        next_run_at: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // POST /campaigns/:id/stop
  fastify.post('/:id/stop', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('campaigns')
      .update({
        is_active: false,
        status: 'paused',
        next_run_at: null
      })
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // ═══════════════════════════════════════════════════════
  // ROLE ENDPOINTS
  // ═══════════════════════════════════════════════════════

  // POST /campaigns/:id/roles — add role
  fastify.post('/:id/roles', { preHandler: fastify.authenticate }, async (req, reply) => {
    // Verify campaign ownership
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { name, role_type, account_ids, mission, config, quota_override, feeds_into, read_from, sort_order } = req.body
    if (!name) return reply.code(400).send({ error: 'name required' })

    const { data, error } = await supabase.from('campaign_roles').insert({
      campaign_id: req.params.id,
      name,
      role_type: role_type || 'custom',
      account_ids: account_ids || [],
      mission: mission || null,
      config: config || {},
      quota_override: quota_override || null,
      feeds_into: feeds_into || null,
      read_from: read_from || null,
      sort_order: sort_order || 0,
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // PUT /campaigns/:id/roles/:roleId — update role
  fastify.put('/:id/roles/:roleId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const allowed = ['name', 'role_type', 'account_ids', 'mission', 'parsed_plan', 'config', 'quota_override', 'feeds_into', 'read_from', 'sort_order', 'is_active']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase.from('campaign_roles')
      .update(updates)
      .eq('id', req.params.roleId)
      .eq('campaign_id', req.params.id)
      .select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /campaigns/:id/roles/:roleId
  fastify.delete('/:id/roles/:roleId', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { error } = await supabase.from('campaign_roles')
      .delete()
      .eq('id', req.params.roleId)
      .eq('campaign_id', req.params.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { ok: true }
  })

  // POST /campaigns/:id/roles/:roleId/parse — AI parse mission preview
  fastify.post('/:id/roles/:roleId/parse', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id, topic').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { data: role } = await supabase.from('campaign_roles')
      .select('*').eq('id', req.params.roleId).eq('campaign_id', req.params.id).single()
    if (!role) return reply.code(404).send({ error: 'Role not found' })

    if (!role.mission) return reply.code(400).send({ error: 'Role has no mission text' })

    try {
      const plan = await parseMission(role.mission, {
        topic: campaign.topic,
        roleType: role.role_type,
        accountCount: (role.account_ids || []).length,
      }, req.user.id, supabase)

      return { plan, role_id: role.id }
    } catch (err) {
      return reply.code(500).send({ error: `AI parse failed: ${err.message}` })
    }
  })

  // GET /campaigns/:id/stats — realtime stats
  fastify.get('/:id/stats', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const cid = req.params.id

    const [queuePending, queueDone, queueFailed, friendSent, friendAccepted, jobsDone, jobsFailed] = await Promise.all([
      supabase.from('target_queue').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'pending'),
      supabase.from('target_queue').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'done'),
      supabase.from('target_queue').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'failed'),
      supabase.from('friend_request_log').select('id', { count: 'exact', head: true }).eq('campaign_id', cid),
      supabase.from('friend_request_log').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'accepted'),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('payload->>campaign_id', cid).eq('status', 'done'),
      supabase.from('jobs').select('id', { count: 'exact', head: true }).eq('payload->>campaign_id', cid).eq('status', 'failed'),
    ])

    return {
      queue: { pending: queuePending.count || 0, done: queueDone.count || 0, failed: queueFailed.count || 0 },
      friends: { sent: friendSent.count || 0, accepted: friendAccepted.count || 0 },
      jobs: { done: jobsDone.count || 0, failed: jobsFailed.count || 0 },
    }
  })

  // GET /campaigns/:id/report — aggregated campaign analytics
  fastify.get('/:id/report', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id, name, total_runs, created_at, last_run_at, campaign_roles(id, name, role_type, account_ids)')
      .eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const cid = req.params.id
    try {
      // 1. Fetch all campaign jobs (up to 2000)
      const { data: allJobs } = await supabase.from('jobs')
        .select('id, type, status, payload, started_at, finished_at, error_message, created_at')
        .eq('payload->>campaign_id', cid)
        .order('created_at', { ascending: false })
        .limit(2000)

      // 2. Target queue counts
      const [tqDone, tqFailed, tqPending] = await Promise.all([
        supabase.from('target_queue').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'done'),
        supabase.from('target_queue').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'failed'),
        supabase.from('target_queue').select('id', { count: 'exact', head: true }).eq('campaign_id', cid).eq('status', 'pending'),
      ])

      // 3. Friend request stats
      const { data: friendRows } = await supabase.from('friend_request_log')
        .select('status, sent_at')
        .eq('campaign_id', cid)
        .order('sent_at', { ascending: false })
        .limit(2000)

      const jobs = allJobs || []
      const friends = friendRows || []

      // === SUMMARY ===
      const jobsDone = jobs.filter(j => j.status === 'done').length
      const jobsFailed = jobs.filter(j => j.status === 'failed').length
      const totalJobs = jobs.length
      const successRate = totalJobs > 0 ? Math.round((jobsDone / totalJobs) * 100) : 0

      const friendsSent = friends.length
      const friendsAccepted = friends.filter(f => f.status === 'accepted').length
      const acceptRate = friendsSent > 0 ? Math.round((friendsAccepted / friendsSent) * 100) : 0

      // Average duration (only completed jobs with both timestamps)
      const durations = jobs
        .filter(j => j.started_at && j.finished_at)
        .map(j => (new Date(j.finished_at) - new Date(j.started_at)) / 1000)
      const avgDuration = durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0

      const firstJob = jobs.length > 0 ? jobs[jobs.length - 1].created_at : null

      // === DAILY BREAKDOWN (last 14 days) ===
      const dailyMap = {}
      const now = new Date()
      for (let i = 13; i >= 0; i--) {
        const d = new Date(now)
        d.setDate(d.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        dailyMap[key] = { date: key, jobs_done: 0, jobs_failed: 0, friends_sent: 0, friends_accepted: 0 }
      }

      for (const job of jobs) {
        const day = (job.created_at || '').slice(0, 10)
        if (dailyMap[day]) {
          if (job.status === 'done') dailyMap[day].jobs_done++
          if (job.status === 'failed') dailyMap[day].jobs_failed++
        }
      }
      for (const f of friends) {
        const day = (f.sent_at || '').slice(0, 10)
        if (dailyMap[day]) {
          dailyMap[day].friends_sent++
          if (f.status === 'accepted') dailyMap[day].friends_accepted++
        }
      }

      // === BY ROLE ===
      const roleMap = {}
      for (const role of (campaign.campaign_roles || [])) {
        roleMap[role.id] = { role_id: role.id, role_name: role.name, role_type: role.role_type, jobs_done: 0, jobs_failed: 0, total: 0 }
      }
      for (const job of jobs) {
        const rid = job.payload?.role_id
        if (rid && roleMap[rid]) {
          roleMap[rid].total++
          if (job.status === 'done') roleMap[rid].jobs_done++
          if (job.status === 'failed') roleMap[rid].jobs_failed++
        }
      }

      // === BY ACCOUNT ===
      const accountMap = {}
      for (const job of jobs) {
        const aid = job.payload?.account_id
        if (!aid) continue
        if (!accountMap[aid]) accountMap[aid] = { account_id: aid, jobs_done: 0, jobs_failed: 0, total: 0 }
        accountMap[aid].total++
        if (job.status === 'done') accountMap[aid].jobs_done++
        if (job.status === 'failed') accountMap[aid].jobs_failed++
      }

      // Get account names
      const accountIds = Object.keys(accountMap)
      if (accountIds.length > 0) {
        const { data: accounts } = await supabase.from('accounts').select('id, username').in('id', accountIds)
        for (const acc of (accounts || [])) {
          if (accountMap[acc.id]) accountMap[acc.id].account_name = acc.username || acc.id
        }
      }

      // Count friends sent per account from job payload
      for (const f of friends) {
        // friend_request_log may not have account_id directly, skip if not
      }

      // === RECENT ERRORS ===
      const recentErrors = jobs
        .filter(j => j.status === 'failed' && j.error_message)
        .slice(0, 10)
        .map(j => ({ job_id: j.id, type: j.type, error_message: j.error_message, created_at: j.created_at }))

      return {
        summary: {
          total_jobs: totalJobs,
          jobs_done: jobsDone,
          jobs_failed: jobsFailed,
          success_rate: successRate,
          total_targets: (tqDone.count || 0) + (tqFailed.count || 0) + (tqPending.count || 0),
          targets_done: tqDone.count || 0,
          targets_failed: tqFailed.count || 0,
          friends_sent: friendsSent,
          friends_accepted: friendsAccepted,
          accept_rate: acceptRate,
          avg_job_duration_sec: avgDuration,
          total_runs: campaign.total_runs || 0,
          first_run_at: firstJob,
          last_run_at: campaign.last_run_at,
        },
        daily: Object.values(dailyMap),
        by_role: Object.values(roleMap),
        by_account: Object.values(accountMap),
        recent_errors: recentErrors,
      }
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /campaigns/:id/targets — target queue (paginated)
  fastify.get('/:id/targets', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { status, limit = 50, offset = 0 } = req.query
    let query = supabase.from('target_queue')
      .select('*', { count: 'exact' })
      .eq('campaign_id', req.params.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (status) query = query.eq('status', status)

    const { data, count, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { data, total: count }
  })

  // GET /campaigns/:id/friend-log — friend request history
  fastify.get('/:id/friend-log', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { limit = 50, offset = 0 } = req.query
    const { data, count, error } = await supabase.from('friend_request_log')
      .select('*', { count: 'exact' })
      .eq('campaign_id', req.params.id)
      .order('sent_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (error) return reply.code(500).send({ error: error.message })
    return { data, total: count }
  })

  // GET /campaigns/:id/activity-log — granular per-action log (cursor-based)
  fastify.get('/:id/activity-log', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { limit = 30, after, page = 1, action_type, account_id, result_status, date_from, date_to } = req.query
    const lim = Math.min(parseInt(limit) || 30, 200)
    const pageNum = Math.max(1, parseInt(page) || 1)

    // Build base filter
    let baseFilter = supabase
      .from('campaign_activity_log')
      .select('*', { count: 'exact' })
      .eq('campaign_id', req.params.id)

    if (action_type) baseFilter = baseFilter.eq('action_type', action_type)
    if (account_id) baseFilter = baseFilter.eq('account_id', account_id)
    if (result_status) baseFilter = baseFilter.eq('result_status', result_status)
    if (date_from) baseFilter = baseFilter.gte('created_at', date_from)
    if (date_to) baseFilter = baseFilter.lte('created_at', date_to)

    let query, isPolling = false

    if (after) {
      // Poll mode: fetch entries NEWER than this timestamp (no pagination)
      query = baseFilter.gt('created_at', after).order('created_at', { ascending: true }).limit(lim)
      isPolling = true
    } else {
      // Page mode: offset-based pagination
      const offset = (pageNum - 1) * lim
      query = baseFilter.order('created_at', { ascending: false }).range(offset, offset + lim - 1)
    }

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })

    // When polling (after), reverse so newest is first for frontend prepend
    const entries = isPolling ? (data || []).reverse() : (data || [])

    // Enrich with account names
    const accountIds = [...new Set(entries.map(d => d.account_id).filter(Boolean))]
    let accountMap = {}
    if (accountIds.length) {
      const { data: accounts } = await supabase.from('accounts').select('id, username').in('id', accountIds)
      accountMap = Object.fromEntries((accounts || []).map(a => [a.id, a.username]))
    }

    const enriched = entries.map(d => ({
      ...d,
      account_name: accountMap[d.account_id] || d.account_id?.slice(0, 8),
    }))

    // Summary: aggregate over ENTIRE campaign (not just this page)
    let sumRows = null
    try {
      const { data } = await supabase.rpc('campaign_activity_summary', { p_campaign_id: req.params.id })
      sumRows = data
    } catch {}
    const summary = {}
    if (sumRows) {
      for (const r of sumRows) {
        summary[r.action_type] = { total: r.total, success: r.success, failed: r.failed }
      }
    } else {
      // Fallback: count from this page only
      for (const d of enriched) {
        const key = d.action_type
        if (!summary[key]) summary[key] = { total: 0, success: 0, failed: 0 }
        summary[key].total++
        if (d.result_status === 'success') summary[key].success++
        else if (d.result_status === 'failed') summary[key].failed++
      }
    }

    // Total count (from query with filters applied, or from count param)
    let total = count
    if (total == null) {
      const { count: c } = await supabase
        .from('campaign_activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', req.params.id)
      total = c || 0
    }

    const totalPages = Math.ceil(total / lim)

    // Get distinct accounts in this campaign (for filter dropdown)
    const { data: accountRows } = await supabase
      .from('campaign_activity_log')
      .select('account_id')
      .eq('campaign_id', req.params.id)
    const uniqueAccountIds = [...new Set((accountRows || []).map(r => r.account_id).filter(Boolean))]
    let accounts = []
    if (uniqueAccountIds.length) {
      const { data: accs } = await supabase.from('accounts').select('id, username').in('id', uniqueAccountIds)
      accounts = (accs || []).map(a => ({ id: a.id, name: a.username || a.id.slice(0, 8) }))
    }

    return { data: enriched, total, summary, page: pageNum, per_page: lim, total_pages: totalPages, accounts }
  })

  // GET /campaigns/:id/activity — real-time activity log (recent jobs)
  fastify.get('/:id/activity', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: campaign } = await supabase.from('campaigns')
      .select('id').eq('id', req.params.id).eq('owner_id', req.user.id).single()
    if (!campaign) return reply.code(404).send({ error: 'Campaign not found' })

    const { limit = 30, status: filterStatus } = req.query

    let query = supabase.from('jobs')
      .select('id, type, status, payload, result, error_message, started_at, finished_at, created_at, attempt')
      .eq('payload->>campaign_id', req.params.id)
      .order('created_at', { ascending: false })
      .limit(parseInt(limit))

    if (filterStatus) query = query.eq('status', filterStatus)

    const { data: jobs, error } = await query
    if (error) return reply.code(500).send({ error: error.message })

    // Enrich with account name and role name
    const accountIds = [...new Set((jobs || []).map(j => j.payload?.account_id).filter(Boolean))]
    const roleIds = [...new Set((jobs || []).map(j => j.payload?.role_id).filter(Boolean))]

    const [accountsRes, rolesRes] = await Promise.all([
      accountIds.length ? supabase.from('accounts').select('id, username').in('id', accountIds) : { data: [] },
      roleIds.length ? supabase.from('campaign_roles').select('id, name, role_type').in('id', roleIds) : { data: [] },
    ])

    const accountMap = Object.fromEntries((accountsRes.data || []).map(a => [a.id, a.username]))
    const roleMap = Object.fromEntries((rolesRes.data || []).map(r => [r.id, { name: r.name, type: r.role_type }]))

    const enriched = (jobs || []).map(j => ({
      id: j.id,
      type: j.type,
      status: j.status,
      attempt: j.attempt,
      account_name: accountMap[j.payload?.account_id] || j.payload?.account_id?.slice(0, 8),
      role_name: roleMap[j.payload?.role_id]?.name || '-',
      role_type: roleMap[j.payload?.role_id]?.type || '-',
      topic: j.payload?.topic,
      // Extract useful summary from result
      summary: extractJobSummary(j),
      error_message: j.error_message,
      started_at: j.started_at,
      finished_at: j.finished_at,
      created_at: j.created_at,
    }))

    // Count by status for filter pills
    let statusCounts = null
    try {
      const { data } = await supabase.rpc('count_by_status_jsonb', { cid: req.params.id })
      statusCounts = data
    } catch {}

    // Fallback count
    let counts = statusCounts
    if (!counts) {
      const allStatuses = (jobs || []).map(j => j.status)
      counts = {
        pending: allStatuses.filter(s => s === 'pending').length,
        running: allStatuses.filter(s => s === 'running').length,
        done: allStatuses.filter(s => s === 'done').length,
        failed: allStatuses.filter(s => s === 'failed').length,
      }
    }

    return { data: enriched, counts }
  })
}

function extractJobSummary(job) {
  const r = job.result
  if (!r) return null
  const parts = []
  if (r.groups_visited != null) parts.push(`${r.groups_visited} nhom`)
  if (r.liked != null) parts.push(`${r.liked} like`)
  if (r.commented != null) parts.push(`${r.commented} comment`)
  if (r.friends_sent != null) parts.push(`${r.friends_sent} ket ban`)
  if (r.groups_joined != null) parts.push(`${r.groups_joined} tham gia`)
  if (r.groups_discovered != null) parts.push(`${r.groups_discovered} tim thay`)
  if (r.posts_scanned != null) parts.push(`${r.posts_scanned} bai scan`)
  if (r.message) parts.push(r.message)
  return parts.length > 0 ? parts.join(', ') : null
}
