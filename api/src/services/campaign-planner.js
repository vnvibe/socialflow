/**
 * Campaign Planner — AI parse natural language mission → JSON execution plan
 * With fallback templates for each role type when AI fails
 */

const { getOrchestratorForUser } = require('./ai/orchestrator')

const SYSTEM_PROMPT = `Ban la AI planner cho he thong tu dong hoa Facebook.
Phan tich CHINH XAC yeu cau nguoi dung → tra ve JSON array cac buoc thuc thi.

QUAN TRONG: Doc ky yeu cau va trich xuat SO LIEU CU THE tu prompt.
Vi du: "binh luan 5 bai" → count_min: 5, count_max: 5
Vi du: "ket 5 ban moi" → count_min: 5, count_max: 5
Vi du: "tim 4-6 nhom" → count_min: 4, count_max: 6

Moi buoc la 1 object:
{
  "action": string,       // browse|like|comment|join_group|scan_members|send_friend_request|post|reply
  "description": string,  // mo ta CU THE, bao gom topic va so luong. VD: "Binh luan 5 bai trong nhom VPS hosting"
  "params": object,       // tham so cu the
  "quota_key": string,    // like|comment|friend_request|join_group|post|scan
  "count_mode": string,   // "fixed"|"range"
  "count_min": number,    // lay TU PROMPT, khong phai tu nghi
  "count_max": number,    // lay TU PROMPT
  "priority": number      // 1 = thuc hien truoc
}

Cac action:
- browse: Xem feed nhom/trang (warm up truoc khi tuong tac)
- like: Like bai viet (params.topic: chu de)
- comment: Binh luan (params.style: "natural"|"expert"|"casual", params.topic: chu de)
- join_group: Tim va tham gia nhom (params.keywords: tu khoa tim kiem, params.min_members: 100)
- scan_members: Scan thanh vien nhom (params.max_results: 30, params.active_only: true)
- send_friend_request: Ket ban (params.source: "group_members"|"commenters")
- post: Dang bai (params.content_source: "ai_gen")

GIOI HAN AN TOAN (PER NICK PER NGAY — count KHONG DUOC vuot):
- join_group: toi da 3/ngay → chia deu cho cac lan chay
- comment: toi da 15/ngay
- like: toi da 50/ngay
- friend_request: toi da 10/ngay
- post: toi da 3/ngay

CHIA COUNT CHO SO LAN CHAY: Neu lich chay 2 lan/ngay (6h + 18h), chia count cho 2.
VD: "binh luan 5 bai/ngay", chay 2 lan → count_min: 2, count_max: 3 (moi lan)

QUY TAC:
1. PHAI doc so lieu tu prompt nguoi dung, KHONG tu nghi ra con so
2. Sap xep: browse → join_group → scan → like → comment → friend_request
3. description phai cu the: bao gom topic + so luong + doi tuong
4. Toi da 8 buoc
5. Luon co buoc browse dau tien de warm up

CHI tra ve JSON array, KHONG giai thich.`

// Fallback plans when AI is unavailable or fails
const FALLBACK_PLANS = {
  scout: [
    { action: 'browse', description: 'Duyet feed de warm up', params: {}, quota_key: 'scan', count_mode: 'fixed', count_min: 1, count_max: 1, priority: 1 },
    { action: 'join_group', description: 'Tim va tham gia nhom moi', params: { min_members: 500 }, quota_key: 'join_group', count_mode: 'range', count_min: 1, count_max: 2, priority: 2 },
  ],
  scan_members: [
    { action: 'scan_members', description: 'Scan thanh vien nhom', params: { max_results: 30, active_only: true }, quota_key: 'scan', count_mode: 'range', count_min: 20, count_max: 30, priority: 1 },
  ],
  nurture: [
    { action: 'browse', description: 'Duyet feed nhom', params: {}, quota_key: 'scan', count_mode: 'fixed', count_min: 1, count_max: 1, priority: 1 },
    { action: 'like', description: 'Like bai viet trong nhom', params: {}, quota_key: 'like', count_mode: 'range', count_min: 3, count_max: 8, priority: 2 },
    { action: 'comment', description: 'Comment tu nhien', params: { style: 'casual' }, quota_key: 'comment', count_mode: 'range', count_min: 1, count_max: 2, priority: 3 },
  ],
  connect: [
    { action: 'browse', description: 'Xem profile truoc khi ket ban', params: {}, quota_key: 'scan', count_mode: 'fixed', count_min: 1, count_max: 1, priority: 1 },
    { action: 'send_friend_request', description: 'Gui loi moi ket ban', params: {}, quota_key: 'friend_request', count_mode: 'range', count_min: 2, count_max: 4, priority: 2 },
  ],
  interact: [
    { action: 'browse', description: 'Xem profile muc tieu', params: {}, quota_key: 'scan', count_mode: 'fixed', count_min: 1, count_max: 1, priority: 1 },
    { action: 'like', description: 'Like bai cua ho', params: {}, quota_key: 'like', count_mode: 'range', count_min: 2, count_max: 5, priority: 2 },
    { action: 'comment', description: 'Comment bai cua ho', params: { style: 'natural' }, quota_key: 'comment', count_mode: 'range', count_min: 1, count_max: 2, priority: 3 },
  ],
  post: [
    { action: 'post', description: 'Dang bai viet', params: { content_source: 'ai_gen' }, quota_key: 'post', count_mode: 'fixed', count_min: 1, count_max: 1, priority: 1 },
  ],
  custom: [
    { action: 'browse', description: 'Duyet trang', params: {}, quota_key: 'scan', count_mode: 'fixed', count_min: 1, count_max: 1, priority: 1 },
    { action: 'like', description: 'Like bai viet', params: {}, quota_key: 'like', count_mode: 'range', count_min: 3, count_max: 5, priority: 2 },
  ],
  auto: [
    { action: 'browse', description: 'Duyet feed de warm up', params: {}, quota_key: 'scan', count_mode: 'fixed', count_min: 1, count_max: 1, priority: 1 },
    { action: 'join_group', description: 'Tim va tham gia nhom moi', params: { min_members: 500 }, quota_key: 'join_group', count_mode: 'range', count_min: 1, count_max: 3, priority: 2 },
    { action: 'like', description: 'Like bai viet trong nhom', params: {}, quota_key: 'like', count_mode: 'range', count_min: 3, count_max: 8, priority: 3 },
    { action: 'comment', description: 'Comment bai viet tu nhien', params: { style: 'natural' }, quota_key: 'comment', count_mode: 'range', count_min: 2, count_max: 5, priority: 4 },
    { action: 'send_friend_request', description: 'Gui ket ban thanh vien tich cuc', params: {}, quota_key: 'friend_request', count_mode: 'range', count_min: 2, count_max: 5, priority: 5 },
  ],
}

/**
 * Parse a natural language mission into execution steps
 * Falls back to template plans if AI fails
 */
async function parseMission(mission, context, userId, supabase) {
  try {
    const orchestrator = await getOrchestratorForUser(userId, supabase)

    const nickInfo = (context.nickAges || []).map(n =>
      typeof n === 'object' ? `${n.name} (${n.age_days} ngay, ${n.status})` : String(n)
    ).join(', ')

    // Fetch prior campaign results for AI context
    let priorContext = ''
    if (context.campaignId) {
      try {
        const { data: priorStats } = await supabase
          .from('campaign_activity_log')
          .select('action_type, result_status')
          .eq('campaign_id', context.campaignId)
        if (priorStats?.length > 0) {
          const summary = {}
          for (const s of priorStats) {
            if (!summary[s.action_type]) summary[s.action_type] = { total: 0, success: 0 }
            summary[s.action_type].total++
            if (s.result_status === 'success') summary[s.action_type].success++
          }
          const lines = Object.entries(summary).map(([k, v]) =>
            `${k}: ${v.total} (thanh cong: ${v.success}/${v.total})`
          )
          priorContext = `\nKet qua lan truoc: ${lines.join(', ')}`
        }
      } catch {}
    }

    const runsPerDay = context.runsPerDay || 2
    const userPrompt = `Chu de: ${context.topic || 'general'}
So nick: ${context.accountCount || 1}
So lan chay/ngay: ${runsPerDay} (chia count cho ${runsPerDay})
${context.accountNames ? `Ten nick: ${context.accountNames.join(', ')}` : ''}
${nickInfo ? `Tuoi nick: ${nickInfo}` : ''}${priorContext}

Yeu cau NGUYEN VAN cua nguoi dung:
"${mission}"

Hay phan tich yeu cau tren va tao plan CU THE voi so lieu DUNG NHU NGUOI DUNG YEU CAU.`

    const aiResult = await orchestrator.call('caption_gen', [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ], { max_tokens: 2000, temperature: 0.3 })

    // orchestrator.call() returns { text, inputTokens, outputTokens }
    const result = aiResult?.text || (typeof aiResult === 'string' ? aiResult : JSON.stringify(aiResult))

    // Parse JSON from response (handle markdown code blocks)
    let jsonStr = result
    const match = result.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (match) jsonStr = match[1]

    // Also try to extract array from text
    if (!jsonStr.trim().startsWith('[')) {
      const arrayMatch = jsonStr.match(/\[[\s\S]*\]/)
      if (arrayMatch) jsonStr = arrayMatch[0]
    }
    jsonStr = jsonStr.trim()

    const plan = JSON.parse(jsonStr)

    if (!Array.isArray(plan)) {
      throw new Error('AI returned non-array response')
    }

    // Validate and normalize each step
    const validActions = ['browse', 'like', 'comment', 'join_group', 'scan_members', 'send_friend_request', 'post', 'reply']
    const validPlan = []
    for (const step of plan) {
      if (!step.action || !validActions.includes(step.action)) {
        console.warn(`[PLANNER] Skipping invalid action: ${step.action}`)
        continue
      }
      step.count_min = Math.max(1, step.count_min || 1)
      step.count_max = Math.max(step.count_min, step.count_max || step.count_min)
      step.count_mode = step.count_mode || 'range'
      step.priority = step.priority || 5
      step.params = step.params || {}
      step.quota_key = step.quota_key || step.action
      validPlan.push(step)
    }

    if (validPlan.length === 0) {
      throw new Error('AI returned plan with no valid actions')
    }

    return validPlan
  } catch (err) {
    console.error(`[PLANNER] AI plan failed: ${err.message} — using fallback for role: ${context.roleType}`)

    // Return fallback plan based on role type
    const fallback = FALLBACK_PLANS[context.roleType] || FALLBACK_PLANS.custom
    return fallback.map(step => ({
      ...step,
      description: `${step.description} (${context.topic || 'general'})`,
      params: { ...step.params, topic: context.topic },
    }))
  }
}

/**
 * Get fallback plan for a role type (used when no parsed_plan exists)
 */
function getFallbackPlan(roleType, topic) {
  const fallback = FALLBACK_PLANS[roleType] || FALLBACK_PLANS.custom
  return fallback.map(step => ({
    ...step,
    params: { ...step.params, topic },
  }))
}

module.exports = { parseMission, getFallbackPlan, FALLBACK_PLANS }
