module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /inbox - Get all inbox messages across fanpages
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { is_read, message_type, limit = 50, offset = 0 } = req.query

    let query = supabase
      .from('inbox_messages')
      .select('*, fanpages!inner(*, accounts!inner(owner_id))')
      .eq('fanpages.accounts.owner_id', req.user.id)
      .order('received_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (is_read !== undefined) query = query.eq('is_read', is_read === 'true')
    if (message_type) query = query.eq('message_type', message_type)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /inbox/unread-count — only count user's own unread messages
  fastify.get('/unread-count', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { count, error } = await supabase
      .from('inbox_messages')
      .select('id, fanpages!inner(*, accounts!inner(owner_id))', { count: 'exact' })
      .eq('is_read', false)
      .eq('fanpages.accounts.owner_id', req.user.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { unread: count || 0 }
  })

  // POST /inbox/mark-all-read — only mark user's own messages
  fastify.post('/mark-all-read', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { fanpage_id } = req.body

    // Get user's fanpage IDs to scope the update
    const { data: userFanpages } = await supabase
      .from('fanpages')
      .select('id, accounts!inner(owner_id)')
      .eq('accounts.owner_id', req.user.id)

    const fanpageIds = (userFanpages || []).map(f => f.id)
    if (!fanpageIds.length) return { success: true }

    let query = supabase
      .from('inbox_messages')
      .update({ is_read: true })
      .eq('is_read', false)

    if (fanpage_id) {
      // Verify this fanpage belongs to user
      if (!fanpageIds.includes(fanpage_id)) {
        return reply.code(403).send({ error: 'Not your fanpage' })
      }
      query = query.eq('fanpage_id', fanpage_id)
    } else {
      query = query.in('fanpage_id', fanpageIds)
    }

    const { error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })
}
