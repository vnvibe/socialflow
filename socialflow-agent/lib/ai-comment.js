/**
 * AI Comment Generator — calls SocialFlow API to generate contextual comments
 * Falls back to templates if API is unavailable
 */

const axios = require('axios')

const API_URL = process.env.API_URL || process.env.RAILWAY_URL || 'https://socialflow-production.up.railway.app'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

const FALLBACK_TEMPLATES = [
  'Hay quá! 👍',
  'Cảm ơn bạn chia sẻ',
  'Thông tin hữu ích',
  'Mình cũng nghĩ vậy',
  'Thanks for sharing!',
  'Đồng ý 💯',
  'Bài viết hay!',
  'Hữu ích quá',
]

/**
 * Generate a contextual comment using AI, with template fallback.
 * Returns { text, ai, provider } so caller can label source accurately.
 * Previously returned bare string → caller labelled every Hermes output
 * as 'template' in logs (observed: Diệu 2026-04-21 16:35 "token page"
 * cmt was DeepSeek/Hermes but activity log showed generator='template').
 */
async function generateComment(context = {}) {
  const { postText, groupName, topic, style, userId } = context

  if (!postText || postText.length < 10) {
    return { text: pickTemplate(context.templates), ai: false, provider: 'template' }
  }

  try {
    const res = await axios.post(`${API_URL}/ai/comment`, {
      post_snippet: postText,
      group_name: groupName || '',
      topic: topic || '',
      style: style || 'casual',
      language: 'vi',
      user_id: userId || null,
    }, {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        ...(SERVICE_KEY && { 'Authorization': `Bearer ${SERVICE_KEY}` }),
      },
    })

    const comment = res.data?.comment
    const provider = res.data?.provider || 'hermes'
    if (comment && comment.length > 0 && comment.length < 200) {
      return { text: comment, ai: true, provider }
    }
  } catch (err) {
    console.warn(`[AI-COMMENT] API failed, using template: ${err.message}`)
  }

  return { text: pickTemplate(context.templates), ai: false, provider: 'template' }
}

function pickTemplate(custom) {
  const templates = custom?.length ? custom : FALLBACK_TEMPLATES
  return templates[Math.floor(Math.random() * templates.length)]
}

module.exports = { generateComment, FALLBACK_TEMPLATES }
