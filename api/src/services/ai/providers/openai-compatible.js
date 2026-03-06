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

    async whisper(audioBuffer, language = 'vi') {
      const { File } = await import('node:buffer')
      const audioFile = new File([audioBuffer], 'audio.mp3', { type: 'audio/mpeg' })
      const response = await client.audio.transcriptions.create({
        file: audioFile,
        model: 'whisper-large-v3',
        language,
        response_format: 'verbose_json',
        timestamp_granularities: ['segment']
      })
      return response
    }
  }
}

module.exports = { createOpenAICompatible }
