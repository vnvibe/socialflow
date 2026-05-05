// Hermes provider — calls the local Hermes FastAPI service
// This routes LLM calls to Hermes Agent's skill-based system with DeepSeek as backend LLM
const HERMES_URL = process.env.HERMES_URL || 'http://127.0.0.1:8100'
const AGENT_SECRET = process.env.AGENT_SECRET

// Map agent's function_name → Hermes skill task_type.
// Audit 2026-04-14: agent was sending 'relevance_review' but Hermes only has
// 'relevance_score' → Hermes fell to generic skill → meaningless output. This
// translation layer keeps the orchestrator's naming stable while matching
// whatever skills Hermes actually exposes on this deployment.
const HERMES_SKILL_MAP = {
  relevance_review: 'relevance_score',
  group_eval: 'group_evaluator',  // uses the dedicated orchestrator-facing skill
  profile_eval: 'post_eval',
  post_strategy: 'action_decision',
  // passthrough for names that match on both sides
  comment_gen: 'comment_gen',
  quality_gate: 'quality_gate',
  caption_gen: 'caption_gen',
  content_eval: 'content_eval',
  lead_score: 'lead_score',
  reply_gen: 'reply_gen',
  post_eval: 'post_eval',
  action_decision: 'action_decision',
  // Orchestrator-family skills (registered in Hermes TASK_ALIASES 2026-04-14)
  orchestrator: 'orchestrator',
  group_evaluator: 'group_evaluator',
  reporter: 'reporter',
  self_reviewer: 'self_reviewer',
  // Anti-detection pre-orchestration pipeline (10 nicks / 1 machine survival)
  checkpoint_predictor: 'checkpoint_predictor',
  traffic_conductor: 'traffic_conductor',
  social_graph_spreader: 'social_graph_spreader',
  // Per-nick schedule personality generator (2026-05-05)
  nick_schedule_planner: 'nick_schedule_planner',
}

function mapSkill(functionName) {
  if (!functionName) return 'generic'
  return HERMES_SKILL_MAP[functionName] || 'generic'
}

function createHermes() {
  return {
    /**
     * @param {string} model - model name (currently ignored — Hermes uses its own config)
     * @param {Array} messages - chat messages
     * @param {number} maxTokens
     * @param {string} [functionName] - agent's function name; mapped to Hermes skill
     */
    async chat(model, messages, maxTokens, functionName, config = {}) {
      if (!AGENT_SECRET) {
        throw new Error('AGENT_SECRET not configured — cannot call Hermes')
      }

      const skill = mapSkill(functionName)

      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 60000)

      try {
        const res = await fetch(`${HERMES_URL}/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Agent-Key': AGENT_SECRET,
          },
          body: JSON.stringify({
            messages,
            max_tokens: maxTokens || 500,
            temperature: 0.7,
            task_type: skill,
            function_name: functionName || 'generic',
            account_id: config.account_id,
            campaign_id: config.campaign_id,
          }),
          signal: controller.signal,
        })

        if (!res.ok) {
          const err = new Error(`Hermes API HTTP ${res.status}`)
          err.status = res.status
          throw err
        }

        const json = await res.json()
        return {
          text: json.text,
          inputTokens: json.input_tokens || 0,
          outputTokens: json.output_tokens || 0,
        }
      } finally {
        clearTimeout(timer)
      }
    },
  }
}

module.exports = { createHermes }
