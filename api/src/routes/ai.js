const { getOrchestratorForUser } = require('../services/ai/orchestrator')

module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /ai/settings - Get user AI settings
  fastify.get('/settings', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('ai_settings')
      .select('*')
      .eq('id', req.user.id)
      .single()

    if (error && error.code === 'PGRST116') {
      // No settings yet, return defaults
      return {
        id: req.user.id,
        providers: {},
        defaults: {},
        token_budgets: {},
        fallback_chain: ['deepseek', 'openai', 'gemini']
      }
    }
    if (error) return reply.code(500).send({ error: error.message })

    // Mask API keys for security
    const masked = { ...data }
    if (masked.providers) {
      for (const [key, val] of Object.entries(masked.providers)) {
        if (val.api_key) {
          masked.providers[key] = { ...val, api_key: val.api_key.substring(0, 8) + '...' }
        }
      }
    }
    return masked
  })

  // PUT /ai/settings - Update AI settings
  fastify.put('/settings', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { providers, defaults, token_budgets, fallback_chain } = req.body

    const { data, error } = await supabase
      .from('ai_settings')
      .upsert({
        id: req.user.id,
        ...(providers && { providers }),
        ...(defaults && { defaults }),
        ...(token_budgets && { token_budgets }),
        ...(fallback_chain && { fallback_chain }),
        updated_at: new Date().toISOString()
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // POST /ai/test - Test a provider
  fastify.post('/test', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { provider, api_key, model } = req.body
    if (!provider || !api_key) return reply.code(400).send({ error: 'provider and api_key required' })

    try {
      const orchestrator = new (require('../services/ai/orchestrator').AIOrchestrator)({
        providers: { [provider]: { enabled: true, api_key } },
        fallback_chain: [provider]
      })

      const result = await orchestrator.call('caption_gen', [
        { role: 'user', content: 'Say "Hello from SocialFlow!" in one short sentence.' }
      ], { provider, model })

      return { success: true, response: result.text, tokens: { input: result.inputTokens, output: result.outputTokens } }
    } catch (err) {
      return { success: false, error: err.message }
    }
  })

  // POST /ai/generate - Generic AI generation
  fastify.post('/generate', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { function_name, messages, provider, model } = req.body
    if (!messages?.length) return reply.code(400).send({ error: 'messages required' })

    try {
      const orchestrator = await getOrchestratorForUser(req.user.id, supabase)
      const result = await orchestrator.call(
        function_name || 'caption_gen',
        messages,
        { ...(provider && { provider }), ...(model && { model }) }
      )

      return {
        text: result.text,
        tokens: { input: result.inputTokens, output: result.outputTokens }
      }
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /ai/caption - Generate caption for content
  fastify.post('/caption', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { topic, style, language, keywords } = req.body

    const prompt = `Write a compelling Facebook caption about: ${topic || 'general content'}.
Style: ${style || 'engaging and friendly'}.
Language: ${language || 'Vietnamese'}.
${keywords ? `Include these keywords: ${keywords.join(', ')}` : ''}
Keep it concise (1-3 sentences). Include appropriate emojis.`

    try {
      const orchestrator = await getOrchestratorForUser(req.user.id, supabase)
      const result = await orchestrator.call('caption_gen', [{ role: 'user', content: prompt }])
      return { caption: result.text }
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /ai/hashtags - Generate hashtags
  fastify.post('/hashtags', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { caption, count } = req.body
    if (!caption) return reply.code(400).send({ error: 'caption required' })

    const prompt = `Generate ${count || 15} relevant hashtags for this Facebook post: "${caption}". Return as JSON array of strings (without # prefix).`

    try {
      const orchestrator = await getOrchestratorForUser(req.user.id, supabase)
      const result = await orchestrator.call('hashtag_gen', [{ role: 'user', content: prompt }])

      try {
        const hashtags = JSON.parse(result.text)
        return { hashtags: Array.isArray(hashtags) ? hashtags : [] }
      } catch {
        const matches = result.text.match(/#?\w+/g) || []
        return { hashtags: matches.map(h => h.replace('#', '')) }
      }
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /ai/ideas - Generate content ideas
  fastify.post('/ideas', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { niche, count } = req.body

    const prompt = `Suggest ${count || 10} content ideas for a Facebook page about: ${niche || 'general topics'}.
For each idea, provide:
- Title (short)
- Description (1 sentence)
- Best time to post
Return as JSON array: [{ "title": "...", "description": "...", "best_time": "..." }]`

    try {
      const orchestrator = await getOrchestratorForUser(req.user.id, supabase)
      const result = await orchestrator.call('content_ideas', [{ role: 'user', content: prompt }])

      try {
        return { ideas: JSON.parse(result.text) }
      } catch {
        return { ideas: result.text }
      }
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })
}
