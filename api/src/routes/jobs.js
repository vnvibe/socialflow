module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /jobs - List jobs with filters
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { status, type, account_id, limit = 50, offset = 0 } = req.query

    if (account_id) {
      // Fallback path: pg-supabase wrapper doesn't support payload->>'account_id' filter,
      // so drop to raw SQL via pool when caller wants jobs for a specific nick.
      const pool = supabase._pool || null
      if (pool) {
        const parts = [`SELECT * FROM jobs WHERE created_by = $1 AND payload->>'account_id' = $2`]
        const args = [req.user.id, account_id]
        if (status) { args.push(status); parts.push(`AND status = $${args.length}`) }
        if (type) { args.push(type); parts.push(`AND type = $${args.length}`) }
        parts.push(`ORDER BY created_at DESC LIMIT ${parseInt(limit)} OFFSET ${parseInt(offset)}`)
        try {
          const { rows } = await pool.query(parts.join(' '), args)
          return rows
        } catch (err) {
          return reply.code(500).send({ error: err.message })
        }
      }
    }

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

  // GET /jobs/:id (authenticated - full data, user's own jobs only)
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .eq('id', req.params.id)
      .eq('created_by', req.user.id)
      .single()

    if (error) return reply.code(404).send({ error: 'Not found' })
    return data
  })

  // GET /jobs/:id/status — lightweight polling, requires auth, scoped to owner
  fastify.get('/:id/status', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('jobs')
      .select('id, status, result, error_message, started_at, finished_at')
      .eq('id', req.params.id)
      .eq('created_by', req.user.id)
      .single()

    if (error) return reply.code(404).send({ error: 'Not found' })
    return data
  })

  // POST /jobs - Create a job
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { type, payload, scheduled_at } = req.body
    if (!type || !payload) return reply.code(400).send({ error: 'type and payload required' })

    // Chọn job type dựa trên posting_method của fanpage
    let jobType = type
    if (type === 'post_page' && payload?.target_id) {
      const { data: fanpages, error: fanpageErr } = await supabase
        .from('fanpages')
        .select('id, access_token, posting_method')
        .eq('id', payload.target_id)
        .limit(1)

      if (fanpageErr) {
        fastify.log.error({ fanpageErr, target_id: payload.target_id }, '[JOBS] Fanpage lookup failed')
      }

      const fanpage = fanpages?.[0]
      const method = fanpage?.posting_method || 'auto'
      if (method === 'access_token' && fanpage?.access_token) {
        jobType = 'post_page_graph'
      } else if (method === 'auto' && fanpage?.access_token) {
        jobType = 'post_page_graph'
      }
      // method === 'cookie' → giữ post_page (browser)
      fastify.log.info({ target_id: payload.target_id, method, jobType }, '[JOBS] Job type resolved')
    }

    const { data, error } = await supabase.from('jobs').insert({
      type: jobType,
      payload,
      scheduled_at: scheduled_at || new Date().toISOString(),
      created_by: req.user.id
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // POST /jobs/:id/cancel
  fastify.post('/:id/cancel', { preHandler: fastify.authenticate }, async (req, reply) => {
    // Allow cancel even when agent already picked up (claimed/running)
    const { data, error } = await supabase
      .from('jobs')
      .update({ status: 'cancelled' })
      .eq('id', req.params.id)
      .eq('created_by', req.user.id)
      .in('status', ['pending', 'claimed', 'running'])
      .select()
      .single()

    if (error) return reply.code(400).send({ error: 'Cannot cancel this job' })
    return data
  })

  // POST /jobs/:id/retry
  fastify.post('/:id/retry', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: job } = await supabase.from('jobs').select('*').eq('id', req.params.id).eq('created_by', req.user.id).single()
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

  // PUT /jobs/:id/target - Change where this job will post to (only if pending or failed)
  fastify.put('/:id/target', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { type, account_id, target_id } = req.body
    if (!type || !account_id) return reply.code(400).send({ error: 'type and account_id required' })
    if (type !== 'post_profile' && !target_id) return reply.code(400).send({ error: 'target_id required for page/group' })

    // Build new payload chunk
    const newTargetData = { account_id }
    if (target_id) newTargetData.target_id = target_id

    // Fetch existing job to verify ownership and status
    const { data: job, error: fetchErr } = await supabase
      .from('jobs')
      .select('id, status, payload')
      .eq('id', req.params.id)
      .eq('created_by', req.user.id)
      .single()

    if (fetchErr || !job) return reply.code(404).send({ error: 'Job not found' })
    if (!['pending', 'failed'].includes(job.status)) {
      return reply.code(400).send({ error: 'Only pending or failed jobs can be repointed' })
    }

    const updatedPayload = { ...job.payload, ...newTargetData }
    const updatedStatus = job.status === 'failed' ? 'pending' : job.status

    const { data, error } = await supabase
      .from('jobs')
      .update({ type, payload: updatedPayload, status: updatedStatus })
      .eq('id', req.params.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /jobs/:id
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase.from('jobs').delete().eq('id', req.params.id).eq('created_by', req.user.id)
    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // PUT /jobs/:id
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { scheduled_at } = req.body
    if (!scheduled_at) return reply.code(400).send({ error: 'scheduled_at required' })

    const { data, error } = await supabase
      .from('jobs')
      .update({ scheduled_at })
      .eq('id', req.params.id)
      .eq('created_by', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
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
