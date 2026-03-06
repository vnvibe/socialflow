const Anthropic = require('@anthropic-ai/sdk')

function createAnthropic({ apiKey }) {
  const client = new Anthropic({ apiKey })

  return {
    async chat(model, messages, maxTokens = 1000) {
      // Convert OpenAI format to Anthropic format
      const systemMsg = messages.find(m => m.role === 'system')
      const userMessages = messages.filter(m => m.role !== 'system')

      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        ...(systemMsg && { system: systemMsg.content }),
        messages: userMessages.map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content
        }))
      })

      return {
        text: response.content[0].text,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens
      }
    }
  }
}

module.exports = { createAnthropic }
