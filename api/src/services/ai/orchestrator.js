const { createOpenAICompatible } = require('./providers/openai-compatible')
const { createAnthropic } = require('./providers/anthropic')
const { createGemini } = require('./providers/gemini')
const { createFal } = require('./providers/fal')
const { createHermes } = require('./providers/hermes')

class AIOrchestrator {
  // Process-wide circuit breaker: provider_name → deadUntilMs. Shared
  // across all AIOrchestrator instances so one 402 on a cron call marks
  // the provider dead for every subsequent call in the same process.
  static _deadProviders = new Map()

  constructor(userSettings) {
    this.providers = userSettings.providers || {}
    this.defaults = userSettings.defaults || {}
    this.budgets = userSettings.token_budgets || {}
    this.fallbackChain = userSettings.fallback_chain || ['hermes', 'deepseek', 'openai', 'gemini']
    // Per-task (function_name) provider+model override. Lets the user pin a
    // specific model per skill (e.g. cheap deepseek for relevance_review,
    // stronger model for comment_gen) without editing code.
    this.taskModels = userSettings.task_models || {}

    // Auto-inject Hermes as an available provider if not already configured
    // (Hermes is a local service, no API key needed — uses AGENT_SECRET from env)
    if (!this.providers.hermes && process.env.AGENT_SECRET) {
      this.providers.hermes = { enabled: true, api_key: 'local' }
    }
  }

  async call(functionName, messages, overrideConfig = {}) {
    const config = { ...this.getFunctionConfig(functionName), ...overrideConfig }
    const providers = [config.provider, ...this.fallbackChain.filter(p => p !== config.provider)]

    // Learning functions MUST go through Hermes (self-learning skills + memory).
    // Falling back to DeepSeek silently bypasses the learning loop → at scale
    // (10+ nicks) this causes spam because evaluation doesn't improve over time.
    const HERMES_STRICT = new Set(['relevance_review', 'comment_gen', 'quality_gate', 'profile_eval', 'group_eval', 'post_strategy'])
    const strictHermes = HERMES_STRICT.has(functionName) && config.provider === 'hermes'

    let lastErr = null
    for (const providerName of providers) {
      const providerConfig = this.providers[providerName]
      if (!providerConfig?.enabled || !providerConfig?.api_key) continue

      // Circuit breaker — if a provider failed with a billing/quota error
      // in the last 5 minutes, skip it on the next call instead of paying
      // latency for the same 402 again. User must either top up OR we
      // eventually retry.
      if (AIOrchestrator._deadProviders.has(providerName)) {
        const deadUntil = AIOrchestrator._deadProviders.get(providerName)
        if (Date.now() < deadUntil) continue
        AIOrchestrator._deadProviders.delete(providerName)
      }

      // Strict mode: if Hermes is the intended provider, never fall back.
      if (strictHermes && providerName !== 'hermes') {
        console.warn(`[ORCHESTRATOR] ${functionName} strict-Hermes: refusing fallback to ${providerName} (last err: ${lastErr?.status || lastErr?.message || 'n/a'})`)
        throw lastErr || new Error(`Hermes unavailable for ${functionName} (strict mode)`)
      }

      try {
        const result = await this.callProvider(providerName, providerConfig, config.model, messages, config.max_tokens, functionName, config)
        return { ...result, provider: providerName }
      } catch (err) {
        lastErr = err
        const reason = err.status ? `HTTP ${err.status}` : (err.name === 'AbortError' ? 'timeout' : err.message)
        console.warn(`[ORCHESTRATOR] ${functionName} via ${providerName} failed: ${reason}`)
        // Billing / auth failures — mark provider dead for 5 min so we
        // don't burn latency on the known-broken one. 402 = payment,
        // 401 = bad key, body-level 'Insufficient Balance' (DeepSeek) /
        // 'insufficient_quota' (OpenAI) / 'billing' (generic).
        const bodyErr = String(err.message || '')
        const billingHit = err.status === 402 || err.status === 401 ||
          /Insufficient|Payment|billing|insufficient_quota/i.test(bodyErr)
        if (billingHit) {
          AIOrchestrator._deadProviders.set(providerName, Date.now() + 5 * 60 * 1000)
          console.warn(`[ORCHESTRATOR] ${providerName} marked dead 5min (${reason})`)
        }
        if (err.status === 429 || err.status >= 500 || err.name === 'AbortError' || billingHit) continue
        throw err
      }
    }

    throw lastErr || new Error('All AI providers are unavailable')
  }

  async callProvider(providerName, providerConfig, model, messages, maxTokens, functionName, config = {}) {
    const OPENAI_COMPATIBLE = ['openai', 'deepseek', 'groq', 'kimi']
    const PROVIDER_URLS = {
      deepseek: 'https://api.deepseek.com/v1',
      groq: 'https://api.groq.com/openai/v1',
      kimi: 'https://api.moonshot.ai/v1'
    }

    if (providerName === 'hermes') {
      const client = createHermes()
      return client.chat(model, messages, maxTokens, functionName, config)
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
    // User-level per-task override takes highest priority. Lets the admin
    // pin specific (provider, model) per skill without touching code.
    const override = this.taskModels?.[functionName]
    if (override && (override.provider || override.model)) {
      const base = (this.defaults[functionName] || this._builtinDefault(functionName))
      return {
        ...base,
        ...(override.provider && { provider: override.provider }),
        ...(override.model && { model: override.model }),
      }
    }
    return this.defaults[functionName] || this._builtinDefault(functionName)
  }

  _builtinDefault(functionName) {
    // Hermes handles SocialFlow-specific operations (self-learning skills);
    // DeepSeek/Gemini handle general-purpose tasks
    const DEFAULTS = {
      // Content generation — DeepSeek for general captions, Hermes for social comments
      caption_gen:    { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 800 },
      hashtag_gen:    { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 300 },
      translate_sub:  { provider: 'deepseek', model: 'deepseek-chat', max_tokens: 4000 },
      // SocialFlow operations routed to Hermes (skill-based + learning)
      comment_gen:    { provider: 'hermes', model: 'deepseek-chat', max_tokens: 150 },
      quality_gate:   { provider: 'hermes', model: 'deepseek-chat', max_tokens: 200 },
      relevance_review: { provider: 'hermes', model: 'deepseek-chat', max_tokens: 1500 },
      profile_eval:   { provider: 'hermes', model: 'deepseek-chat', max_tokens: 150 },
      group_eval:     { provider: 'hermes', model: 'deepseek-chat', max_tokens: 300 },
      post_strategy:  { provider: 'hermes', model: 'deepseek-chat', max_tokens: 300 },
      // Campaign planning + post-session decisioner — pinned to Hermes since
      // user's deepseek key is 402 Insufficient Balance and Hermes routes to
      // free NVIDIA llama-3.3-70b. Without this, ai_pilot threw → agent's
      // post-nurture decisioner fell to 45-min default rest, killing throughput.
      ai_pilot:       { provider: 'hermes', model: 'deepseek-chat', max_tokens: 1000 },
      // Research via Gemini (web context)
      trend_analysis: { provider: 'gemini',   model: 'gemini-1.5-flash', max_tokens: 1000 },
      content_ideas:  { provider: 'gemini',   model: 'gemini-1.5-flash', max_tokens: 1500 },
      // Images via fal.ai
      image_gen:      { provider: 'fal', model: 'fal-ai/flux/schnell' },
      // Orchestrator-family skills (reasoning over campaign state).
      // Pinned to Hermes because these rely on skill prompts living on the
      // Hermes server — swapping providers here would lose the self-learning
      // memory that the skill queries. User can still override the MODEL
      // (deepseek-chat / gpt-4o-mini / …) via task_models.
      orchestrator:   { provider: 'hermes', model: 'deepseek-chat', max_tokens: 2000 },
      self_reviewer:  { provider: 'hermes', model: 'deepseek-chat', max_tokens: 1500 },
      reporter:       { provider: 'hermes', model: 'deepseek-chat', max_tokens: 1000 },
      group_evaluator:{ provider: 'hermes', model: 'deepseek-chat', max_tokens: 400 },
      cookie_death_analyzer: { provider: 'hermes', model: 'deepseek-chat', max_tokens: 800 },
      // Per-nick planner skills (2026-05-05) — pinned to Hermes since prompts
      // live in /opt/socialflow/hermes-api/skills/. DeepSeek doesn't know them.
      nick_schedule_planner: { provider: 'hermes', model: 'deepseek-chat', max_tokens: 400 },
      nick_budget_planner:   { provider: 'hermes', model: 'deepseek-chat', max_tokens: 400 },
    }
    return DEFAULTS[functionName] || DEFAULTS.caption_gen
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
    task_models: {
      ...(adminSettings.task_models || {}),
      ...(userSettings.task_models || {}),
    },
  })
}

module.exports = { AIOrchestrator, getOrchestratorForUser }
