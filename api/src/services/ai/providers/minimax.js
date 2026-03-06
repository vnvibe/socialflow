const axios = require('axios')

function createMinimax({ apiKey }) {
  return {
    async chat(model, messages, maxTokens = 1000) {
      const response = await axios.post(
        'https://api.minimax.chat/v1/text/chatcompletion_v2',
        {
          model: model || 'abab6.5s-chat',
          messages,
          max_tokens: maxTokens
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      )

      const data = response.data
      return {
        text: data.choices?.[0]?.message?.content || '',
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0
      }
    }
  }
}

module.exports = { createMinimax }
