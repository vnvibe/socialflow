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

  // POST /campaigns
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const {
      name, topic, target_pages, target_groups, target_profiles,
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
    return reply.code(201).send(data)
  })

  // PUT /campaigns/:id
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = [
      'name', 'topic', 'target_pages', 'target_groups', 'target_profiles',
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
}
