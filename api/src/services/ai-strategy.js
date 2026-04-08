/**
 * Phase 5: Self-Improving Strategy (DeepSeek Brain)
 * Weekly job: collect 7-day performance per active campaign, ask AI to propose
 * adjustments (group tiers, best hours, recommended tone), persist into
 * ai_pilot_memory + apply mechanical updates (tier downgrades, campaigns.config).
 */

const { remember } = require('./ai-memory')
const { getOrchestratorForUser } = require('./ai/orchestrator')

// ── 1. Collect performance data for the past N days ──
async function collectPerformanceData(supabase, campaignId, days = 7) {
  const since = new Date(Date.now() - days * 86400000).toISOString()

  // Activity by group
  const { data: acts } = await supabase
    .from('campaign_activity_log')
    .select('action_type, result_status, target_id, target_name, created_at, details')
    .eq('campaign_id', campaignId)
    .gte('created_at', since)
    .limit(2000)

  const byGroup = {}
  const byHour = {}
  const commentSamples = []
  for (const a of acts || []) {
    const g = a.target_name || a.target_id || '?'
    if (!byGroup[g]) byGroup[g] = { name: g, fb_id: a.target_id, total: 0, success: 0, comments: 0, likes: 0 }
    byGroup[g].total++
    if (a.result_status === 'success') byGroup[g].success++
    if (a.action_type === 'comment') byGroup[g].comments++
    if (a.action_type === 'like') byGroup[g].likes++

    const h = new Date(a.created_at).getHours()
    if (!byHour[h]) byHour[h] = { hour: h, total: 0, success: 0 }
    byHour[h].total++
    if (a.result_status === 'success') byHour[h].success++

    if (a.action_type === 'comment' && a.details?.comment_text && commentSamples.length < 20) {
      commentSamples.push({
        text: (a.details.comment_text || '').slice(0, 200),
        success: a.result_status === 'success',
      })
    }
  }

  // Top shared posts (engagement) — Phase 3 source
  const { data: pooled } = await supabase
    .from('shared_posts')
    .select('group_fb_id, ai_score, swarm_count, swarm_target, is_ad_opportunity')
    .eq('campaign_id', campaignId)
    .gte('detected_at', since)
    .limit(500)

  return {
    days,
    by_group: Object.values(byGroup).sort((a, b) => b.total - a.total).slice(0, 30),
    by_hour: Object.values(byHour).sort((a, b) => a.hour - b.hour),
    comment_samples: commentSamples,
    pooled_summary: {
      total: (pooled || []).length,
      ad_opps: (pooled || []).filter(p => p.is_ad_opportunity).length,
      swarmed: (pooled || []).filter(p => (p.swarm_count || 0) > 0).length,
    },
  }
}

// ── 2. Ask AI for strategy adjustments ──
async function generateStrategyUpdate(supabase, campaign) {
  const perf = await collectPerformanceData(supabase, campaign.id, 7)
  if (perf.by_group.length === 0) {
    console.log(`[AI-STRATEGY] Campaign ${campaign.id.slice(0, 8)} — no activity, skipping`)
    return null
  }

  const prompt = `Bạn là AI strategy advisor cho Facebook automation campaign.

Campaign: ${campaign.name} | Topic: ${campaign.topic || '?'} | Language: ${campaign.language || 'vi'}

Dữ liệu performance ${perf.days} ngày qua:
- Groups (top 30): ${JSON.stringify(perf.by_group)}
- Hoạt động theo giờ: ${JSON.stringify(perf.by_hour)}
- Mẫu comments: ${JSON.stringify(perf.comment_samples.slice(0, 10))}
- Shared posts pool: ${JSON.stringify(perf.pooled_summary)}

Phân tích và trả về CHỈ JSON (không giải thích):
{
  "group_adjustments": [{ "group_fb_id": "...", "action": "increase|decrease|skip", "reason": "..." }],
  "content_insights": "1-2 câu ngắn",
  "best_hours": [8, 12, 19],
  "recommended_tone": "1 câu",
  "strategy_notes": "1-2 câu"
}`

  let result = null
  try {
    const orch = await getOrchestratorForUser(campaign.owner_id, supabase)
    const raw = await orch.call('ai_pilot', [
      { role: 'system', content: 'Bạn là AI advisor. Trả lời CHỈ JSON hợp lệ.' },
      { role: 'user', content: prompt },
    ], { max_tokens: 1500 })
    const text = raw?.content || raw?.text || raw || ''
    const m = String(text).match(/\{[\s\S]*\}/)
    if (m) result = JSON.parse(m[0])
  } catch (err) {
    console.error(`[AI-STRATEGY] AI call failed for ${campaign.id.slice(0, 8)}:`, err.message)
    return null
  }
  if (!result) return null

  // Persist to ai_pilot_memory
  try {
    await remember(supabase, {
      campaignId: campaign.id,
      memoryType: 'campaign_pattern',
      key: 'strategy_update',
      value: result,
      confidence: 0.7,
    })
  } catch (err) {
    console.warn(`[AI-STRATEGY] remember failed: ${err.message}`)
  }

  // Apply group adjustments (skip → tier D)
  for (const adj of result.group_adjustments || []) {
    if (!adj?.group_fb_id) continue
    if (adj.action === 'skip') {
      await supabase.from('fb_groups')
        .update({ score_tier: 'D' })
        .eq('fb_group_id', adj.group_fb_id)
    }
  }

  // Update campaigns.config.best_hours (jsonb merge)
  if (Array.isArray(result.best_hours) && result.best_hours.length > 0) {
    const { data: cur } = await supabase.from('campaigns').select('config').eq('id', campaign.id).single()
    const merged = { ...(cur?.config || {}), best_hours: result.best_hours, recommended_tone: result.recommended_tone || null }
    await supabase.from('campaigns').update({ config: merged }).eq('id', campaign.id)
  }

  console.log(`[AI-STRATEGY] ${campaign.name}: ${result.group_adjustments?.length || 0} group adjustments, best_hours=${JSON.stringify(result.best_hours)}`)
  return result
}

// ── 3. Driver: run for all active campaigns ──
async function runWeeklyStrategy(supabase) {
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, name, topic, language, owner_id, status')
    .or('status.eq.active,status.eq.running,status.is.null')
    .limit(100)
  let n = 0
  for (const c of campaigns || []) {
    try {
      const r = await generateStrategyUpdate(supabase, c)
      if (r) n++
    } catch (err) {
      console.warn(`[AI-STRATEGY] ${c.id.slice(0, 8)} failed: ${err.message}`)
    }
  }
  console.log(`[AI-STRATEGY] Weekly run done — updated ${n}/${(campaigns || []).length} campaigns`)
}

module.exports = { collectPerformanceData, generateStrategyUpdate, runWeeklyStrategy }
