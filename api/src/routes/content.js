const { getOrchestratorForUser } = require('../services/ai/orchestrator')
const { spin } = require('../services/spin-engine')

module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /content - List contents
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('contents')
      .select('*, media(*)')
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /content/:id
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('contents')
      .select('*, media(*)')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (error) return reply.code(404).send({ error: 'Not found' })
    return data
  })

  // POST /content - Create content
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { media_id, post_type, caption, hashtags, link_url, privacy, spin_mode, spin_template } = req.body

    const { data, error } = await supabase.from('contents').insert({
      owner_id: req.user.id,
      media_id, post_type, caption, hashtags, link_url,
      privacy: privacy || 'PUBLIC',
      spin_mode: spin_mode || 'none',
      spin_template
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // PUT /content/:id
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = ['caption', 'hashtags', 'link_url', 'privacy', 'spin_mode', 'spin_template', 'media_id', 'post_type']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase
      .from('contents')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /content/:id
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase.from('contents').delete().eq('id', req.params.id).eq('owner_id', req.user.id)
    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // POST /content/:id/generate-caption - AI generate caption
  fastify.post('/:id/generate-caption', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { prompt, provider, model } = req.body

    const orchestrator = await getOrchestratorForUser(req.user.id, supabase)
    const result = await orchestrator.call('caption_gen', [
      { role: 'user', content: prompt || 'Write a compelling Facebook caption for this content.' }
    ], { ...(provider && { provider }), ...(model && { model }) })

    return { caption: result.text, tokens: { input: result.inputTokens, output: result.outputTokens } }
  })

  // POST /content/:id/generate-hashtags - AI generate hashtags
  fastify.post('/:id/generate-hashtags', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: content } = await supabase.from('contents').select('caption').eq('id', req.params.id).single()

    const orchestrator = await getOrchestratorForUser(req.user.id, supabase)
    const result = await orchestrator.call('hashtag_gen', [
      { role: 'user', content: `Generate 10-15 relevant hashtags for this caption: "${content?.caption}". Return as JSON array.` }
    ])

    try {
      const hashtags = JSON.parse(result.text)
      return { hashtags }
    } catch {
      return { hashtags: result.text.match(/#\w+/g) || [] }
    }
  })

  // POST /content/:id/spin-preview - Preview spin variations
  fastify.post('/:id/spin-preview', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { count, mode } = req.body
    const { data: content } = await supabase.from('contents').select('caption, spin_mode, spin_template').eq('id', req.params.id).single()
    if (!content) return reply.code(404).send({ error: 'Not found' })

    const orchestrator = await getOrchestratorForUser(req.user.id, supabase)
    const variants = await spin(
      content.spin_template || content.caption,
      mode || content.spin_mode || 'basic',
      count || 5,
      orchestrator
    )

    return { variants }
  })
}
