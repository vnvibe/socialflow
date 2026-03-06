const { GoogleGenerativeAI } = require('@google/generative-ai')

function createGemini({ apiKey }) {
  const genAI = new GoogleGenerativeAI(apiKey)

  return {
    async chat(model, messages, maxTokens = 1000) {
      const geminiModel = genAI.getGenerativeModel({ model })

      // Convert OpenAI format to Gemini format
      const systemMsg = messages.find(m => m.role === 'system')
      const userMessages = messages.filter(m => m.role !== 'system')

      const history = userMessages.slice(0, -1).map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))

      const chat = geminiModel.startChat({
        history,
        ...(systemMsg && { systemInstruction: { parts: [{ text: systemMsg.content }] } }),
        generationConfig: { maxOutputTokens: maxTokens }
      })

      const lastMsg = userMessages[userMessages.length - 1]
      const result = await chat.sendMessage(lastMsg.content)
      const response = result.response

      return {
        text: response.text(),
        inputTokens: response.usageMetadata?.promptTokenCount || 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount || 0
      }
    }
  }
}

module.exports = { createGemini }
