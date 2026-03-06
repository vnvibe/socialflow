const { createOpenAICompatible } = require('./providers/openai-compatible')
const { createAnthropic } = require('./providers/anthropic')
const { createGemini } = require('./providers/gemini')

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

  getFunctionConfig(functionName) {
    const DEFAULTS = {
      caption_gen:    { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 800 },
      hashtag_gen:    { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 300 },
      translate_sub:  { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 4000 },
      trend_analysis: { provider: 'gemini',   model: 'gemini-1.5-flash', max_tokens: 1000 },
      content_ideas:  { provider: 'gemini',   model: 'gemini-1.5-flash', max_tokens: 1500 }
    }
    return this.defaults[functionName] || DEFAULTS[functionName] || DEFAULTS.caption_gen
  }
}

async function getOrchestratorForUser(userId, supabase) {
  const { data } = await supabase.from('ai_settings').select('*').eq('id', userId).single()
  return new AIOrchestrator(data || {})
}

module.exports = { AIOrchestrator, getOrchestratorForUser }
