/**
 * Campaign Planner — AI parse natural language mission → JSON execution plan
 * With fallback templates for each role type when AI fails
 */

const { getOrchestratorForUser } = require('./ai/orchestrator')

const SYSTEM_PROMPT = `Ban la AI planner cho he thong tu dong hoa Facebook.
Phan tich CHINH XAC yeu cau nguoi dung → tra ve JSON array cac buoc thuc thi.

=== QUY TAC TICH XUAT SO LIEU ===
CHI tao buoc cho nhung gi NGUOI DUNG YEU CAU. KHONG tu them action.
- Neu nguoi dung noi "binh luan 5 bai" → CHI co comment, count = 5/ngay
- Neu nguoi dung KHONG noi "like" → KHONG co buoc like
- Neu nguoi dung KHONG noi "dang bai" → KHONG co buoc post
- Luon giu DUNG so lieu: "5 bai" = 5, "4-6 nhom" = 4-6, "5 ban" = 5

=== CHIA COUNT CHO SO LAN CHAY ===
So lieu trong prompt la TONG MOI NGAY, chia cho so lan chay.
VD: "binh luan 5 bai/ngay", chay 2 lan → count_per_run = ceil(5/2) = 3
VD: "ket 5 ban/ngay", chay 2 lan → count_per_run = ceil(5/2) = 3
VD: "tim 4-6 nhom" (1 lan duy nhat, KHONG chia) → count_min: 2, count_max: 3 (chia cho 2 runs)

=== GIOI HAN AN TOAN PER NICK PER NGAY ===
join_group: 3 | comment: 15 | like: 50 | friend_request: 10 | post: 3
Neu count vuot limit → giam xuong = limit. VD: join 6 nhom → giam con 3.

=== FORMAT ===
Moi buoc:
{
  "action": "browse|join_group|comment|send_friend_request|like|scan_members|post",
  "description": "Mo ta CU THE bao gom: hanh dong + so luong/ngay + topic + ghi chu chia runs",
  "params": {},
  "quota_key": "scan|join_group|comment|friend_request|like|post",
  "count_mode": "fixed|range",
  "count_min": number,  // SO LIEU MOI LAN CHAY (da chia cho runs)
  "count_max": number,
  "priority": number    // 1 = lam truoc
}

=== PARAMS QUAN TRONG ===
- join_group: params.keywords = MANG tu khoa trich tu prompt. VD: "nhom vps hosting, openclaw" → ["vps hosting", "openclaw"]. params.min_members: 100
- comment: params.style = "natural"|"expert"|"casual", params.topic = chu de
- send_friend_request: params.source = "group_members"

=== THU TU ===
browse (warm up) → join_group → scan_members → comment → send_friend_request
CHI them like neu nguoi dung YEU CAU. browse LUON la buoc dau tien.
Toi da 6 buoc. CHI tra ve JSON array, KHONG giai thich.`

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

    // Brand/ads context — only included if user enabled ads in form
    const brandBlock = context.brandConfig && context.brandConfig.brand_name ? `

=== QUANG CAO THUONG HIEU (DA BAT) ===
Ten thuong hieu: ${context.brandConfig.brand_name}
${context.brandConfig.brand_description ? `Mo ta: ${context.brandConfig.brand_description}` : ''}
${context.brandConfig.brand_keywords?.length ? `Tu khoa kich hoat: ${context.brandConfig.brand_keywords.join(', ')}` : ''}
${context.brandConfig.brand_voice ? `Giong dieu: ${context.brandConfig.brand_voice}` : ''}
=> Khi gap bai viet co tu khoa kich hoat, AI se de xuat thuong hieu mot cach tu nhien (max 2 lan/nick/ngay).
=> Khong can them buoc rieng — buoc comment se tu xu ly.` : ''

    const userPrompt = `Chu de: ${context.topic || 'general'}
So nick: ${context.accountCount || 1}
So lan chay moi ngay: ${runsPerDay}
${context.accountNames ? `Ten nick: ${context.accountNames.join(', ')}` : ''}
${nickInfo ? `Tuoi nick: ${nickInfo}` : ''}${priorContext}${brandBlock}

=== YEU CAU NGUYEN VAN ===
"${mission}"

=== HUONG DAN ===
1. Doc prompt tren, trich xuat CHINH XAC cac hanh dong va SO LIEU
2. CHI tao buoc cho nhung gi nguoi dung YEU CAU, KHONG tu them
3. So luong trong prompt la TONG/NGAY → chia cho ${runsPerDay} lan chay → count_per_run
4. Neu so lieu vuot gioi han an toan → giam xuong bang gioi han
5. join_group params.keywords: trich TRUC TIEP tu khoa tu prompt`

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

    let plan
    try {
      plan = JSON.parse(jsonStr)
    } catch (parseErr) {
      throw new Error(`AI returned invalid JSON: ${parseErr.message} — raw: ${jsonStr.substring(0, 200)}`)
    }

    if (!Array.isArray(plan)) {
      throw new Error(`AI returned non-array response: ${typeof plan}`)
    }

    // Hard limits per nick per day — AI CANNOT exceed these
    const HARD_LIMITS = {
      join_group: 3,
      comment: 15,  // was 30 — FB blocks at 15-20/day
      like: 80,     // was 100
      friend_request: 10,
      post: 3,
      scan: 15,
    }

    // Validate, normalize, and ENFORCE hard limits on each step
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

      // ENFORCE: cap daily total (count_per_run * runs) to hard limit
      const limitKey = step.quota_key === 'friend_request' ? 'friend_request' : step.quota_key
      const dailyLimit = HARD_LIMITS[limitKey]
      if (dailyLimit) {
        const maxPerRun = Math.ceil(dailyLimit / runsPerDay)
        if (step.count_max > maxPerRun) {
          console.warn(`[PLANNER] Capping ${step.action}: ${step.count_max}/run → ${maxPerRun}/run (limit: ${dailyLimit}/day ÷ ${runsPerDay} runs)`)
          step.count_max = maxPerRun
          step.count_min = Math.min(step.count_min, step.count_max)
        }
      }

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
