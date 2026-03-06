module.exports = async (fastify) => {
  const { supabase } = fastify

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
