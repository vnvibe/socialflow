/**
 * Campaign Planner — AI parse natural language mission → JSON execution plan
 */

const { getOrchestratorForUser } = require('./ai/orchestrator')

const SYSTEM_PROMPT = `Ban la AI planner cho he thong tu dong hoa Facebook.
Phan tich nhiem vu nguoi dung → tra ve JSON array cac buoc thuc thi.

Moi buoc la 1 object:
{
  "action": string,       // browse|like|comment|join_group|scan_members|send_friend_request|post|reply
  "description": string,  // mo ta ngan
  "params": object,       // tham so cu the cho action
  "quota_key": string,    // key budget: like|comment|friend_request|join_group|post|scan
  "count_mode": string,   // "fixed"|"range"|"ai_decide"
  "count_min": number,    // so luong toi thieu
  "count_max": number,    // so luong toi da
  "priority": number      // 1 = cao nhat
}

Cac action ho tro:
- browse: Vao trang/group de xem, khong tuong tac
- like: Like bai viet
- comment: Binh luan bai viet (params.style: "natural"|"expert"|"casual")
- join_group: Tham gia nhom moi
- scan_members: Scan thanh vien nhom (params.max_results, params.active_only)
- send_friend_request: Gui loi moi ket ban
- post: Dang bai (params.content_source: "ai_gen"|"content_id")
- reply: Tra loi binh luan/tin nhan

Quy tac:
- Uu tien an toan: nick moi nen it hanh dong
- count_mode="ai_decide" de he thong tu quyet dinh dua tren context
- Sap xep theo thu tu thuc hien hop ly
- Toi da 8 buoc

CHI tra ve JSON array, KHONG giai thich them.`

/**
 * Parse a natural language mission into execution steps
 * @param {string} mission - User's mission description
 * @param {object} context - { topic, roleType, accountCount }
 * @param {string} userId - User ID for AI orchestrator
 * @param {object} supabase - Supabase client
 * @returns {Array} Parsed plan steps
 */
async function parseMission(mission, context, userId, supabase) {
  const orchestrator = await getOrchestratorForUser(userId, supabase)

  const userPrompt = `Chu de: ${context.topic || 'general'}
Loai role: ${context.roleType || 'custom'}
So nick: ${context.accountCount || 1}

Nhiem vu: ${mission}`

  const result = await orchestrator.call('caption_gen', [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: userPrompt }
  ], { max_tokens: 2000 })

  // Parse JSON from response (handle markdown code blocks)
  let jsonStr = result
  const match = result.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (match) jsonStr = match[1]
  jsonStr = jsonStr.trim()

  const plan = JSON.parse(jsonStr)

  if (!Array.isArray(plan)) {
    throw new Error('AI returned non-array response')
  }

  // Validate each step
  const validActions = ['browse', 'like', 'comment', 'join_group', 'scan_members', 'send_friend_request', 'post', 'reply']
  for (const step of plan) {
    if (!step.action || !validActions.includes(step.action)) {
      throw new Error(`Invalid action: ${step.action}`)
    }
    step.count_min = step.count_min || 1
    step.count_max = step.count_max || step.count_min
    step.count_mode = step.count_mode || 'range'
    step.priority = step.priority || 5
  }

  return plan
}

module.exports = { parseMission }
