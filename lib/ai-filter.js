/**
 * AI-powered relevance filter for group discovery
 * Sends group list to AI → returns only relevant groups
 * Cost: ~$0.001-0.003 per call (500-1500 tokens)
 * Fallback: keyword matching if AI unavailable
 */

const axios = require('axios')

const API_URL = process.env.API_URL || process.env.RAILWAY_URL || 'https://socialflow-production.up.railway.app'
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''

/**
 * Filter groups by topic relevance using AI
 * @param {Array} groups - [{ name, member_count, ... }]
 * @param {string} topic - Search topic/keyword
 * @param {string} ownerId - User UUID for AI settings
 * @returns {Array} Filtered groups that are relevant
 */
async function filterRelevantGroups(groups, topic, ownerId) {
  if (!groups.length) return []

  const groupList = groups.map((g, i) =>
    `${i + 1}. "${g.name}" (${g.member_count || '?'} members)`
  ).join('\n')

  try {
    const res = await axios.post(`${API_URL}/ai/generate`, {
      function_name: 'caption_gen',
      messages: [
        {
          role: 'user',
          content: `Chủ đề cần tìm nhóm Facebook: "${topic}"

Danh sách nhóm tìm được:
${groupList}

Trả về CHỈ các số thứ tự nhóm THỰC SỰ liên quan đến chủ đề "${topic}".
Loại bỏ nhóm cá cược, game, lừa đảo, MLM, không liên quan.
Trả về JSON array số, VD: [1, 3, 5]
Nếu không có nhóm nào liên quan, trả về: []`
        }
      ],
      max_tokens: 200,
      temperature: 0.1,
    }, {
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
        ...(SERVICE_KEY && { 'Authorization': `Bearer ${SERVICE_KEY}` }),
        ...(ownerId && { 'x-user-id': ownerId }),
      },
    })

    const text = res.data?.text || res.data?.result || ''
    const match = text.match(/\[[\d\s,]*\]/)
    if (match) {
      const indices = JSON.parse(match[0])
      const filtered = indices
        .filter(i => i >= 1 && i <= groups.length)
        .map(i => groups[i - 1])

      console.log(`[AI-FILTER] ${filtered.length}/${groups.length} groups relevant to "${topic}"`)
      filtered.forEach(g => console.log(`  ✅ ${g.name}`))
      groups.filter(g => !filtered.includes(g)).forEach(g => console.log(`  ❌ ${g.name}`))

      return filtered
    }
  } catch (err) {
    console.warn(`[AI-FILTER] AI failed, using keyword fallback: ${err.message}`)
  }

  // Fallback: keyword matching
  const topicWords = topic.toLowerCase().split(/[\s,]+/).filter(w => w.length >= 2)
  const fallback = groups.filter(g => {
    const text = `${g.name} ${g.description || ''}`.toLowerCase()
    return topicWords.some(w => text.includes(w))
  })
  console.log(`[AI-FILTER] Keyword fallback: ${fallback.length}/${groups.length} groups matched`)
  return fallback
}

module.exports = { filterRelevantGroups }
