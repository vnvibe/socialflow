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

  // GET /campaigns/:id
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (error) return reply.code(404).send({ error: 'Not found' })
    return data
  })

  // POST /campaigns
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const {
      name, target_pages, target_groups, target_profiles,
      content_ids, rotation_mode, spin_mode,
      schedule_type, cron_expression, interval_minutes,
      start_at, end_at, delay_between_targets_minutes
    } = req.body

    if (!name) return reply.code(400).send({ error: 'name required' })

    const { data, error } = await supabase.from('campaigns').insert({
      owner_id: req.user.id,
      name,
      target_pages: target_pages || [],
      target_groups: target_groups || [],
      target_profiles: target_profiles || [],
      content_ids: content_ids || [],
      rotation_mode: rotation_mode || 'sequential',
      spin_mode: spin_mode || 'basic',
      schedule_type, cron_expression, interval_minutes,
      start_at, end_at,
      delay_between_targets_minutes: delay_between_targets_minutes || 15
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // PUT /campaigns/:id
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = [
      'name', 'target_pages', 'target_groups', 'target_profiles',
      'content_ids', 'rotation_mode', 'spin_mode',
      'schedule_type', 'cron_expression', 'interval_minutes',
      'start_at', 'end_at', 'delay_between_targets_minutes'
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
        next_run_at: null
      })
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })
}
