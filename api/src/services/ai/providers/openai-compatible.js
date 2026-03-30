const OpenAI = require('openai')

function createOpenAICompatible({ apiKey, baseURL }) {
  const client = new OpenAI({ apiKey, ...(baseURL && { baseURL }) })

  return {
    async chat(model, messages, maxTokens = 1000) {
      const response = await client.chat.completions.create({
        model,
        messages,
        max_tokens: maxTokens
      })
      return {
        text: response.choices[0].message.content,
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens
      }
    },

  }
}

module.exports = { createOpenAICompatible }
