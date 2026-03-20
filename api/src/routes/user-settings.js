module.exports = async (fastify) => {
  const { supabase } = fastify

  // ============================================================
  // GET /user-settings — Get current user's settings (any role)
  // Returns: { ai_providers, apify_config, proxy_ids }
  // AI keys are masked for display
  // ============================================================
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.id

    const { data, error } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single()

    if (error && error.code === 'PGRST116') {
      // No settings yet
      return { user_id: userId, ai_providers: null, apify_config: null, proxy_ids: [] }
    }
    if (error) return reply.code(500).send({ error: error.message })

    // Mask AI keys
    const result = { ...data }
    if (result.ai_providers) {
      for (const [key, val] of Object.entries(result.ai_providers)) {
        if (val.api_key) {
          result.ai_providers[key] = { ...val, api_key: val.api_key.substring(0, 8) + '...' }
        }
      }
    }

    // Mask Apify keys
    if (result.apify_config?.keys?.length) {
      result.apify_config = {
        ...result.apify_config,
        keys: result.apify_config.keys.map(k => ({
          ...k,
          key: k.key ? k.key.substring(0, 8) + '...' : '',
        }))
      }
    }

    return result
  })

  // ============================================================
  // PUT /user-settings — Update current user's settings
  // Body: { ai_providers?, apify_config? }
  // Handles masked key merging (same pattern as admin settings)
  // ============================================================
  fastify.put('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.id
    const { ai_providers, apify_config } = req.body

    // Fetch existing to merge masked keys
    const { data: existing } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', userId)
      .single()

    let finalAiProviders = ai_providers
    let finalApifyConfig = apify_config

    // Merge masked AI keys with real ones
    if (finalAiProviders && existing?.ai_providers) {
      for (const [key, val] of Object.entries(finalAiProviders)) {
        if (val.api_key?.endsWith('...')) {
          const orig = existing.ai_providers[key]
          if (orig?.api_key) {
            finalAiProviders[key] = { ...val, api_key: orig.api_key }
          }
        }
      }
    }

    // Merge masked Apify keys
    if (finalApifyConfig?.keys?.length && existing?.apify_config?.keys?.length) {
      const existingKeys = existing.apify_config.keys
      finalApifyConfig = {
        ...finalApifyConfig,
        keys: finalApifyConfig.keys.map(k => {
          if (k.key?.endsWith('...')) {
            const orig = existingKeys.find(ek => ek.key?.substring(0, 8) + '...' === k.key)
            return orig ? { ...k, key: orig.key } : k
          }
          return k
        })
      }
    }

    const updateData = {
      user_id: userId,
      updated_at: new Date().toISOString(),
    }
    if (finalAiProviders !== undefined) updateData.ai_providers = finalAiProviders
    if (finalApifyConfig !== undefined) updateData.apify_config = finalApifyConfig

    const { data, error } = await supabase
      .from('user_settings')
      .upsert(updateData)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // ============================================================
  // GET /user-settings/ai-effective — Get effective AI config
  // Merges user overrides with admin defaults
  // Used by frontend to show which provider is active
  // ============================================================
  fastify.get('/ai-effective', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.id
    const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '274868cf-742d-4d8a-89e8-bf1c37766b77'

    // Get admin's AI settings (the base)
    const { data: adminSettings } = await supabase
      .from('ai_settings')
      .select('*')
      .eq('id', ADMIN_USER_ID)
      .single()

    // Get user's overrides
    const { data: userSettings } = await supabase
      .from('user_settings')
      .select('ai_providers')
      .eq('user_id', userId)
      .single()

    const adminProviders = adminSettings?.providers || {}
    const userProviders = userSettings?.ai_providers || {}

    // Build effective config: user override > admin default
    const effectiveProviders = {}
    const allKeys = new Set([...Object.keys(adminProviders), ...Object.keys(userProviders)])

    for (const key of allKeys) {
      const adminP = adminProviders[key]
      const userP = userProviders[key]

      if (userP?.api_key && !userP.api_key.endsWith('...')) {
        // User has their own key — use it
        effectiveProviders[key] = {
          ...adminP,
          ...userP,
          source: 'user', // indicate this is user's own key
        }
      } else if (adminP) {
        effectiveProviders[key] = {
          ...adminP,
          source: 'admin', // using admin's key
          api_key: adminP.api_key ? '(mặc định hệ thống)' : '',
        }
      }
    }

    return {
      providers: effectiveProviders,
      defaults: adminSettings?.defaults || {},
      fallback_chain: adminSettings?.fallback_chain || ['deepseek', 'openai', 'gemini'],
    }
  })

  // ============================================================
  // POST /user-settings/test-ai — Test a provider with user's key
  // ============================================================
  fastify.post('/test-ai', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { provider, api_key, model } = req.body
    const { getOrchestratorForUser } = require('../services/ai/orchestrator')

    // Create a temporary orchestrator with just this provider
    const { AIOrchestrator } = require('../services/ai/orchestrator')
    const tempOrch = new AIOrchestrator({
      providers: {
        [provider]: { enabled: true, api_key, model }
      }
    })

    try {
      const result = await tempOrch.call('caption_gen', [
        { role: 'user', content: 'Say "OK" in one word.' }
      ], { provider, model })
      return { success: true, response: result?.substring?.(0, 100) || 'OK' }
    } catch (err) {
      return reply.code(400).send({ error: err.message })
    }
  })

  // ============================================================
  // GET /user-settings/proxies — Get proxies assigned to current user
  // Admin sees all, user sees only their own
  // ============================================================
  fastify.get('/proxies', { preHandler: fastify.authenticate }, async (req, reply) => {
    const isAdmin = req.user.role === 'admin'

    if (isAdmin) {
      const { data } = await supabase.from('proxies').select('*').order('created_at', { ascending: false })
      return data || []
    }

    // For non-admin: get proxy_ids from user_settings, then fetch those proxies
    const { data: settings } = await supabase
      .from('user_settings')
      .select('proxy_ids')
      .eq('user_id', req.user.id)
      .single()

    const proxyIds = settings?.proxy_ids || []
    if (!proxyIds.length) return []

    const { data } = await supabase
      .from('proxies')
      .select('*')
      .in('id', proxyIds)
      .order('created_at', { ascending: false })

    return data || []
  })

  // ============================================================
  // GET /user-settings/admin-view/:userId — Admin reads any user's settings
  // ============================================================
  fastify.get('/admin-view/:userId', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const { data } = await supabase
      .from('user_settings')
      .select('*')
      .eq('user_id', req.params.userId)
      .single()
    return data || { user_id: req.params.userId, ai_providers: null, apify_config: null, proxy_ids: [] }
  })

  // ============================================================
  // PUT /user-settings/assign-proxies — Admin assigns proxies to a user
  // ============================================================
  fastify.put('/assign-proxies', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const { target_user_id, proxy_ids } = req.body
    if (!target_user_id) return reply.code(400).send({ error: 'target_user_id required' })

    const { data, error } = await supabase
      .from('user_settings')
      .upsert({
        user_id: target_user_id,
        proxy_ids: proxy_ids || [],
        updated_at: new Date().toISOString(),
      })
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })
}
