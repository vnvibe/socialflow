const axios = require('axios')
const { fetchPageInbox, replyToMessage } = require('../services/facebook/fb-inbox')

module.exports = async (fastify) => {
  const { supabase } = fastify

  // Helper: verify account belongs to user
  const verifyAccountOwner = async (accountId, userId) => {
    const { data } = await supabase.from('accounts').select('id').eq('id', accountId).eq('owner_id', userId).single()
    return !!data
  }

  // Helper: verify fanpage belongs to user (via account)
  const verifyFanpageOwner = async (fanpageId, userId) => {
    const { data } = await supabase
      .from('fanpages')
      .select('id, accounts!inner(owner_id)')
      .eq('id', fanpageId)
      .eq('accounts.owner_id', userId)
      .single()
    return data
  }

  // GET /fanpages
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('fanpages')
      .select('*, accounts!inner(id, username, owner_id)')
      .eq('accounts.owner_id', req.user.id)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // POST /fanpages - Add fanpage manually
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { account_id, fb_page_id, name, url, category } = req.body
    if (!account_id || !fb_page_id) return reply.code(400).send({ error: 'account_id and fb_page_id required' })

    if (!await verifyAccountOwner(account_id, req.user.id)) {
      return reply.code(403).send({ error: 'Account not yours' })
    }

    const { data, error } = await supabase.from('fanpages').insert({
      account_id, fb_page_id, name, url, category
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // GET /fanpages/:id
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('fanpages')
      .select('*, accounts!inner(id, username, owner_id)')
      .eq('id', req.params.id)
      .eq('accounts.owner_id', req.user.id)
      .single()

    if (error) return reply.code(404).send({ error: 'Fanpage not found' })
    return data
  })

  // PUT /fanpages/:id
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    if (!await verifyFanpageOwner(req.params.id, req.user.id)) {
      return reply.code(403).send({ error: 'Not your fanpage' })
    }

    const allowed = ['name', 'inbox_enabled', 'inbox_interval_minutes', 'is_active', 'posting_method']
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
    if (!await verifyFanpageOwner(req.params.id, req.user.id)) {
      return reply.code(403).send({ error: 'Not your fanpage' })
    }

    const { error } = await supabase.from('fanpages').delete().eq('id', req.params.id)
    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // GET /fanpages/:id/inbox - Get inbox messages
  fastify.get('/:id/inbox', { preHandler: fastify.authenticate }, async (req, reply) => {
    // Verify fanpage belongs to user
    if (!await verifyFanpageOwner(req.params.id, req.user.id)) {
      return reply.code(403).send({ error: 'Not your fanpage' })
    }

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
      .select('*, accounts!inner(*, owner_id)')
      .eq('id', req.params.id)
      .eq('accounts.owner_id', req.user.id)
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
      .select('*, accounts!inner(*, owner_id)')
      .eq('id', req.params.id)
      .eq('accounts.owner_id', req.user.id)
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
    // Verify fanpage belongs to user
    if (!await verifyFanpageOwner(req.params.id, req.user.id)) {
      return reply.code(403).send({ error: 'Not your fanpage' })
    }

    const { message_ids } = req.body
    if (!message_ids?.length) return reply.code(400).send({ error: 'message_ids required' })

    const { error } = await supabase
      .from('inbox_messages')
      .update({ is_read: true })
      .in('id', message_ids)
      .eq('fanpage_id', req.params.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // POST /fanpages/:id/post-direct - Post directly via Graph API without agent/job
  fastify.post('/:id/post-direct', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { caption = '', media_url, media_type = 'text' } = req.body || {}

    // Load fanpage with token and fb_page_id
    const { data: fanpage } = await supabase
      .from('fanpages')
      .select('id, fb_page_id, access_token, posting_method, accounts!inner(owner_id)')
      .eq('id', req.params.id)
      .single()

    if (!fanpage) return reply.code(404).send({ error: 'Fanpage not found' })
    if (fanpage.accounts?.owner_id !== req.user.id) return reply.code(403).send({ error: 'Forbidden' })
    if (!fanpage.access_token) return reply.code(400).send({ error: 'Fanpage missing access_token' })
    if (fanpage.posting_method === 'cookie') return reply.code(400).send({ error: 'Fanpage is set to cookie-only posting. Use agent/job instead.' })

    const pageId = fanpage.fb_page_id
    const token = fanpage.access_token
    const graphBase = `https://graph.facebook.com/v21.0/${pageId}`

    try {
      let res
      if (media_type === 'photo' && media_url) {
        res = await axios.post(`${graphBase}/photos`, {
          url: media_url,
          caption,
          access_token: token,
        })
        return { success: true, fb_post_id: res.data?.post_id || res.data?.id, type: 'photo' }
      }

      if (media_type === 'video' && media_url) {
        res = await axios.post(`${graphBase}/videos`, {
          file_url: media_url,
          description: caption,
          access_token: token,
        })
        return { success: true, fb_post_id: res.data?.id, type: 'video' }
      }

      // default: text/link post
      res = await axios.post(`${graphBase}/feed`, {
        message: caption,
        access_token: token,
      })
      return { success: true, fb_post_id: res.data?.id, type: 'text' }
    } catch (err) {
      const fbErr = err.response?.data?.error
      fastify.log.error({ err: fbErr || err.message }, '[POST-DIRECT] Graph post failed')
      return reply.code(500).send({ error: fbErr?.message || err.message })
    }
  })
}
