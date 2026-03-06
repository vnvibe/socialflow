const { fetchPageInbox, replyToMessage } = require('../services/facebook/fb-inbox')

module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /fanpages
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('fanpages')
      .select('*, accounts!inner(owner_id)')
      .eq('accounts.owner_id', req.user.id)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // POST /fanpages - Add fanpage manually
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { account_id, fb_page_id, name, url, category } = req.body
    if (!account_id || !fb_page_id) return reply.code(400).send({ error: 'account_id and fb_page_id required' })

    const { data, error } = await supabase.from('fanpages').insert({
      account_id, fb_page_id, name, url, category
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // PUT /fanpages/:id
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = ['name', 'inbox_enabled', 'inbox_interval_minutes', 'is_active']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase.from('fanpages').update(updates).eq('id', req.params.id).select().single()
    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /fanpages/:id
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase.from('fanpages').delete().eq('id', req.params.id)
    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // GET /fanpages/:id/inbox - Get inbox messages
  fastify.get('/:id/inbox', { preHandler: fastify.authenticate }, async (req, reply) => {
    const limit = parseInt(req.query.limit) || 50
    const offset = parseInt(req.query.offset) || 0

    const { data, error } = await supabase
      .from('inbox_messages')
      .select('*')
      .eq('fanpage_id', req.params.id)
      .order('received_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // POST /fanpages/:id/fetch-inbox - Fetch fresh inbox from Facebook
  fastify.post('/:id/fetch-inbox', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: fanpage } = await supabase
      .from('fanpages')
      .select('*, accounts(*)')
      .eq('id', req.params.id)
      .single()

    if (!fanpage) return reply.code(404).send({ error: 'Not found' })

    const messages = await fetchPageInbox(fanpage, fanpage.accounts, supabase)

    // Upsert messages
    if (messages.length > 0) {
      const { error } = await supabase
        .from('inbox_messages')
        .upsert(messages, { onConflict: 'fb_message_id' })

      if (error) return reply.code(500).send({ error: error.message })
    }

    // Update last checked
    await supabase.from('fanpages').update({
      inbox_last_checked_at: new Date()
    }).eq('id', req.params.id)

    return { fetched: messages.length }
  })

  // POST /fanpages/:id/reply - Reply to a message
  fastify.post('/:id/reply', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { thread_id, message_id, reply_text } = req.body
    if (!thread_id || !reply_text) return reply.code(400).send({ error: 'thread_id and reply_text required' })

    const { data: fanpage } = await supabase
      .from('fanpages')
      .select('*, accounts(*)')
      .eq('id', req.params.id)
      .single()

    if (!fanpage) return reply.code(404).send({ error: 'Not found' })

    await replyToMessage(fanpage, fanpage.accounts, thread_id, reply_text, supabase)

    // Update message as replied
    if (message_id) {
      await supabase.from('inbox_messages').update({
        replied_at: new Date(),
        reply_text
      }).eq('id', message_id)
    }

    return { success: true }
  })

  // POST /fanpages/:id/mark-read - Mark messages as read
  fastify.post('/:id/mark-read', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { message_ids } = req.body
    if (!message_ids?.length) return reply.code(400).send({ error: 'message_ids required' })

    const { error } = await supabase
      .from('inbox_messages')
      .update({ is_read: true })
      .in('id', message_ids)

    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })
}
