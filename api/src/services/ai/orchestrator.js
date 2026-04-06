const { createOpenAICompatible } = require('./providers/openai-compatible')
const { createAnthropic } = require('./providers/anthropic')
const { createGemini } = require('./providers/gemini')
const { createFal } = require('./providers/fal')

class AIOrchestrator {
  constructor(userSettings) {
    this.providers = userSettings.providers || {}
    this.defaults = userSettings.defaults || {}
    this.budgets = userSettings.token_budgets || {}
    this.fallbackChain = userSettings.fallback_chain || ['deepseek', 'openai', 'gemini']
  }

  async call(functionName, messages, overrideConfig = {}) {
    const config = { ...this.getFunctionConfig(functionName), ...overrideConfig }
    const providers = [config.provider, ...this.fallbackChain.filter(p => p !== config.provider)]

    for (const providerName of providers) {
      const providerConfig = this.providers[providerName]
      if (!providerConfig?.enabled || !providerConfig?.api_key) continue

      try {
        return await this.callProvider(providerName, providerConfig, config.model, messages, config.max_tokens)
      } catch (err) {
        if (err.status === 429 || err.status >= 500) continue
        throw err
      }
    }

    throw new Error('All AI providers are unavailable')
  }

  async callProvider(providerName, providerConfig, model, messages, maxTokens) {
    const OPENAI_COMPATIBLE = ['openai', 'deepseek', 'groq', 'kimi']
    const PROVIDER_URLS = {
      deepseek: 'https://api.deepseek.com/v1',
      groq: 'https://api.groq.com/openai/v1',
      kimi: 'https://api.moonshot.cn/v1'
    }

    if (OPENAI_COMPATIBLE.includes(providerName)) {
      const client = createOpenAICompatible({
        apiKey: providerConfig.api_key,
        baseURL: PROVIDER_URLS[providerName]
      })
      return client.chat(model, messages, maxTokens)
    }

    if (providerName === 'anthropic') {
      const client = createAnthropic({ apiKey: providerConfig.api_key })
      return client.chat(model, messages, maxTokens)
    }

    if (providerName === 'gemini') {
      const client = createGemini({ apiKey: providerConfig.api_key })
      return client.chat(model, messages, maxTokens)
    }

    if (providerName === 'minimax') {
      const { createMinimax } = require('./providers/minimax')
      const client = createMinimax({ apiKey: providerConfig.api_key })
      return client.chat(model, messages, maxTokens)
    }
  }

  /**
   * Generate image using fal.ai provider
   * @param {string} prompt - Image description
   * @param {object} overrideConfig - { model, image_size, negative_prompt }
   */
  async generateImage(prompt, overrideConfig = {}) {
    const config = { ...this.getFunctionConfig('image_gen'), ...overrideConfig }
    const providerName = config.provider || 'fal'
    const providerConfig = this.providers[providerName]

    if (!providerConfig?.enabled || !providerConfig?.api_key) {
      throw new Error('Image generation provider (fal.ai) not configured. Go to Settings > AI to set up.')
    }

    const client = createFal({ apiKey: providerConfig.api_key })
    return client.generateImage(
      config.model || 'fal-ai/flux/schnell',
      prompt,
      {
        image_size: overrideConfig.image_size,
        negative_prompt: overrideConfig.negative_prompt,
      }
    )
  }

  getFunctionConfig(functionName) {
    const DEFAULTS = {
      caption_gen:    { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 800 },
      hashtag_gen:    { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 300 },
      translate_sub:  { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 4000 },
      trend_analysis: { provider: 'gemini',   model: 'gemini-1.5-flash', max_tokens: 1000 },
      content_ideas:  { provider: 'gemini',   model: 'gemini-1.5-flash', max_tokens: 1500 },
      relevance_review: { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 1500 },
      ai_pilot:       { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 1000 },
      profile_eval:   { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 150 },
      group_eval:     { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 300 },
      post_strategy:  { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 300 },
      image_gen:      { provider: 'fal', model: 'fal-ai/flux/schnell' },
    }
    return this.defaults[functionName] || DEFAULTS[functionName] || DEFAULTS.caption_gen
  }
}

// System-wide AI: admin's config as base, user overrides on top
const ADMIN_USER_ID = process.env.ADMIN_USER_ID || '274868cf-742d-4d8a-89e8-bf1c37766b77'

async function getOrchestratorForUser(userId, supabase) {
  // Always get admin's config as base
  const { data: adminData } = await supabase.from('ai_settings').select('*').eq('id', ADMIN_USER_ID).single()
  const adminSettings = adminData || {}

  // If requesting user IS admin, or no userId, just return admin config
  if (!userId || userId === ADMIN_USER_ID) {
    return new AIOrchestrator(adminSettings)
  }

  // Check for user-level overrides
  const { data: userSettings } = await supabase
    .from('user_settings')
    .select('ai_providers')
    .eq('user_id', userId)
    .single()

  if (!userSettings?.ai_providers) {
    // No user overrides — use admin config
    return new AIOrchestrator(adminSettings)
  }

  // Merge: user's API keys override admin's for matching providers
  const mergedProviders = { ...(adminSettings.providers || {}) }
  for (const [key, userProvider] of Object.entries(userSettings.ai_providers)) {
    if (userProvider.api_key && !userProvider.api_key.endsWith('...')) {
      mergedProviders[key] = {
        ...(mergedProviders[key] || {}),
        ...userProvider,
      }
    }
  }

  return new AIOrchestrator({
    ...adminSettings,
    providers: mergedProviders,
  })
}

module.exports = { AIOrchestrator, getOrchestratorForUser }
