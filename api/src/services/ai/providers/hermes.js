// Hermes provider — calls the local Hermes FastAPI service
// This routes LLM calls to Hermes Agent's skill-based system with DeepSeek as backend LLM
const HERMES_URL = process.env.HERMES_URL || 'http://127.0.0.1:8100'
const AGENT_SECRET = process.env.AGENT_SECRET

function createHermes() {
  return {
    async chat(model, messages, maxTokens) {
      if (!AGENT_SECRET) {
        throw new Error('AGENT_SECRET not configured — cannot call Hermes')
      }

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
            function_name: 'generic',
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
