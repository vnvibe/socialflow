module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /groups
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('fb_groups')
      .select('*, accounts!inner(owner_id, username)')
      .eq('accounts.owner_id', req.user.id)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // POST /groups - Add group
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { account_id, fb_group_id, name, url, group_type, is_admin } = req.body
    if (!account_id || !fb_group_id) return reply.code(400).send({ error: 'account_id and fb_group_id required' })

    const { data, error } = await supabase.from('fb_groups').insert({
      account_id, fb_group_id, name, url,
      group_type: group_type || 'public',
      is_admin: is_admin || false
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // POST /groups/bulk-add - Add multiple groups
  fastify.post('/bulk-add', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { account_id, groups } = req.body
    if (!account_id || !groups?.length) return reply.code(400).send({ error: 'account_id and groups required' })

    const rows = groups.map(g => ({
      account_id,
      fb_group_id: g.fb_group_id,
      name: g.name || null,
      url: g.url || null,
      group_type: g.group_type || 'public'
    }))

    const { data, error } = await supabase.from('fb_groups').upsert(rows, {
      onConflict: 'account_id,fb_group_id'
    }).select()

    if (error) return reply.code(500).send({ error: error.message })
    return { imported: data.length, groups: data }
  })

  // PUT /groups/:id
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = ['name', 'group_type', 'is_admin', 'post_approval_required', 'is_active']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase.from('fb_groups').update(updates).eq('id', req.params.id).select().single()
    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /groups/:id
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase.from('fb_groups').delete().eq('id', req.params.id)
    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // POST /groups/resolve - Queue agent job to visit group URLs and fetch name/info
  fastify.post('/resolve', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { account_id, group_ids } = req.body
    if (!account_id || !group_ids?.length) return reply.code(400).send({ error: 'account_id and group_ids required' })

    // Check agent online
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id').gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
    if (!agents?.length) return reply.code(503).send({ error: 'No agent online. Start the SocialFlow Agent first.' })

    // Fetch group records
    const { data: groups } = await supabase.from('fb_groups').select('id, fb_group_id, url').in('id', group_ids)
    if (!groups?.length) return reply.code(404).send({ error: 'No groups found' })

    // Create agent job
    const { data: job, error } = await supabase.from('jobs').insert({
      type: 'check_health',
      payload: { action: 'resolve_group', account_id, groups },
      status: 'pending',
      scheduled_at: new Date().toISOString()
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return { message: 'Resolve queued', job_id: job.id, group_count: groups.length }
  })
}
