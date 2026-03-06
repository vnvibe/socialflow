module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /jobs - List jobs with filters
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { status, type, limit = 50, offset = 0 } = req.query

    let query = supabase
      .from('jobs')
      .select('*')
      .eq('created_by', req.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (status) query = query.eq('status', status)
    if (type) query = query.eq('type', type)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /jobs/:id
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', req.params.id)
      .single()

    if (error) return reply.code(404).send({ error: 'Not found' })
    return data
  })

  // POST /jobs - Create a job
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { type, payload, scheduled_at } = req.body
    if (!type || !payload) return reply.code(400).send({ error: 'type and payload required' })

    const { data, error } = await supabase.from('jobs').insert({
      type,
      payload,
      scheduled_at: scheduled_at || new Date().toISOString(),
      created_by: req.user.id
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // POST /jobs/:id/cancel
  fastify.post('/:id/cancel', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('jobs')
      .update({ status: 'cancelled' })
      .eq('id', req.params.id)
      .in('status', ['pending', 'claimed'])
      .select()
      .single()

    if (error) return reply.code(400).send({ error: 'Cannot cancel this job' })
    return data
  })

  // POST /jobs/:id/retry
  fastify.post('/:id/retry', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: job } = await supabase.from('jobs').select('*').eq('id', req.params.id).single()
    if (!job) return reply.code(404).send({ error: 'Not found' })

    // Create new job from failed one
    const { data, error } = await supabase.from('jobs').insert({
      type: job.type,
      payload: job.payload,
      scheduled_at: new Date().toISOString(),
      created_by: req.user.id
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // GET /jobs/stats - Job stats
  fastify.get('/stats', { preHandler: fastify.authenticate }, async (req, reply) => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const [pending, running, done, failed] = await Promise.all([
      supabase.from('jobs').select('id', { count: 'exact' }).eq('status', 'pending').eq('created_by', req.user.id),
      supabase.from('jobs').select('id', { count: 'exact' }).in('status', ['claimed', 'running']).eq('created_by', req.user.id),
      supabase.from('jobs').select('id', { count: 'exact' }).eq('status', 'done').eq('created_by', req.user.id).gte('finished_at', today.toISOString()),
      supabase.from('jobs').select('id', { count: 'exact' }).eq('status', 'failed').eq('created_by', req.user.id).gte('finished_at', today.toISOString())
    ])

    return {
      pending: pending.count || 0,
      running: running.count || 0,
      done_today: done.count || 0,
      failed_today: failed.count || 0
    }
  })
}
