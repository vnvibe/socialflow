/**
 * Phase 17 — AI Operations Manager
 * 3 levels: Hourly monitor, Daily plan, Weekly strategy.
 * Uses DeepSeek via the existing AIOrchestrator.
 */

const { remember, recall, formatMemoriesForPrompt } = require('./ai-memory')
const { getOrchestratorForUser } = require('./ai/orchestrator')
const { rebalanceKPI } = require('./kpi-calculator')

// ══════════════════════════════════════════════════════════
// HELPERS
// ══════════════════════════════════════════════════════════

async function getActiveCampaigns(supabase) {
  const { data } = await supabase.from('campaigns')
    .select('id, name, topic, language, owner_id, status, wave_config, kpi_config, total_runs')
    .eq('is_active', true).or('status.eq.running,status.eq.active,status.is.null')
    .limit(100)
  return data || []
}

function buildHourlyStats(logs) {
  const total = logs.length
  const success = logs.filter(l => l.result_status === 'success').length
  const failed = logs.filter(l => l.result_status === 'failed').length
  const byType = {}
  const byNick = {}
  for (const l of logs) {
    const t = l.action_type || 'other'
    if (!byType[t]) byType[t] = { total: 0, success: 0 }
    byType[t].total++
    if (l.result_status === 'success') byType[t].success++
    byType[t].success_rate = Math.round((byType[t].success / byType[t].total) * 100)

    const n = l.account_id || 'unknown'
    byNick[n] = (byNick[n] || 0) + 1
  }
  const nickCounts = Object.values(byNick)
  const maxNickShare = nickCounts.length > 0 ? Math.max(...nickCounts) / total : 0

  return {
    total, success, failed,
    success_rate: total > 0 ? Math.round((success / total) * 100) : 0,
    error_rate: total > 0 ? Math.round((failed / total) * 100) / 100 : 0,
    active_nicks: Object.keys(byNick).length,
    nick_balance: Math.round(maxNickShare * 100) / 100,
    by_type: byType,
  }
}

function detectAnomalies(stats) {
  const issues = []
  if (stats.success_rate < 50 && stats.total > 5) issues.push('low_success_rate')
  if (stats.total === 0) issues.push('no_activity')
  if (stats.nick_balance > 0.8 && stats.active_nicks > 1) issues.push('nick_imbalance')
  if (stats.error_rate > 0.3) issues.push('high_error_rate')
  return issues
}

function isAnalysisHour() {
  const h = new Date(Date.now() + 7 * 3600000).getUTCHours() // VN hour
  return h % 6 === 0 // 0, 6, 12, 18
}

async function callAI(supabase, ownerId, prompt, maxTokens = 500) {
  try {
    const orch = await getOrchestratorForUser(ownerId, supabase)
    const raw = await orch.call('ai_pilot', [
      { role: 'system', content: 'Bạn là AI Ops Manager cho Facebook automation. Trả lời CHỈ JSON hợp lệ, không giải thích.' },
      { role: 'user', content: prompt },
    ], { max_tokens: maxTokens })
    const text = raw?.content || raw?.text || raw || ''
    const m = String(text).match(/\{[\s\S]*\}/)
    if (m) return JSON.parse(m[0])
  } catch (err) {
    console.warn(`[AI-OPS] AI call failed: ${err.message}`)
  }
  return null
}

// ══════════════════════════════════════════════════════════
// LEVEL 1: HOURLY MONITOR
// ══════════════════════════════════════════════════════════

async function runHourlyMonitor(supabase) {
  const campaigns = await getActiveCampaigns(supabase)
  let processed = 0

  for (const campaign of campaigns) {
    try {
      const hourAgo = new Date(Date.now() - 3600000).toISOString()
      const { data: logs } = await supabase.from('campaign_activity_log')
        .select('action_type, result_status, account_id, details')
        .eq('campaign_id', campaign.id)
        .neq('action_type', 'ops_monitor').neq('action_type', 'daily_plan')
        .neq('action_type', 'weekly_strategy').neq('action_type', 'ai_control')
        .gte('created_at', hourAgo).limit(500)

      const stats = buildHourlyStats(logs || [])
      const anomalies = detectAnomalies(stats)

      // Only call AI if anomalies exist or it's an analysis hour (every 6h)
      let analysis = null
      if ((anomalies.length > 0 || isAnalysisHour()) && stats.total > 0) {
        const vnTime = new Date(Date.now() + 7 * 3600000).toISOString().slice(11, 16)
        analysis = await callAI(supabase, campaign.owner_id, `
Campaign "${campaign.name}" — Báo cáo 1 giờ qua (${vnTime} VN)

Actions: ${stats.total} | Success: ${stats.success_rate}% | Nicks active: ${stats.active_nicks}
Phân loại: ${Object.entries(stats.by_type).map(([k, v]) => `${k}:${v.total}(${v.success_rate}%)`).join(' | ')}
Anomalies: ${anomalies.join(', ') || 'none'}

Phân tích ngắn (JSON):
{"status":"good|warning|critical","headline":"1 câu","issues":["nếu có"],"suggestions":["ngắn gọn"]}
Chỉ trả JSON.`, 200)
      }

      const status = analysis?.status || (anomalies.length > 0 ? 'warning' : 'good')

      await supabase.from('campaign_activity_log').insert({
        campaign_id: campaign.id, owner_id: campaign.owner_id,
        action_type: 'ops_monitor', result_status: status,
        details: { stats, anomalies, analysis, generated_at: new Date().toISOString() },
      })

      if (status === 'critical' || status === 'warning') {
        await supabase.from('notifications').insert({
          user_id: campaign.owner_id, type: 'ops_alert',
          title: `${status === 'critical' ? '🚨' : '⚠️'} ${campaign.name}: ${analysis?.headline || anomalies.join(', ')}`,
          body: (analysis?.issues || anomalies).join(' · '),
          level: status === 'critical' ? 'urgent' : 'warning',
        }).then(() => {}, () => {})
      }
      processed++
    } catch (err) {
      console.warn(`[AI-OPS] hourly monitor ${campaign.id}: ${err.message}`)
    }
  }
  if (processed > 0) console.log(`[AI-OPS] Hourly monitor: ${processed}/${campaigns.length} campaigns`)
}

// ══════════════════════════════════════════════════════════
// LEVEL 2: DAILY PLAN (6:00 AM VN)
// ══════════════════════════════════════════════════════════

async function runDailyPlan(supabase) {
  const campaigns = await getActiveCampaigns(supabase)

  for (const campaign of campaigns) {
    try {
      const since24h = new Date(Date.now() - 24 * 3600000).toISOString()
      const { data: logs } = await supabase.from('campaign_activity_log')
        .select('action_type, result_status, account_id, created_at')
        .eq('campaign_id', campaign.id)
        .neq('action_type', 'ops_monitor').neq('action_type', 'daily_plan')
        .neq('action_type', 'weekly_strategy').neq('action_type', 'ai_control')
        .gte('created_at', since24h).limit(2000)

      const perf = buildHourlyStats(logs || [])
      // Best/worst hour
      const byHour = {}
      for (const l of logs || []) {
        const h = new Date(l.created_at).getHours()
        if (!byHour[h]) byHour[h] = { total: 0, success: 0 }
        byHour[h].total++
        if (l.result_status === 'success') byHour[h].success++
      }
      const hourEntries = Object.entries(byHour).map(([h, v]) => ({ hour: parseInt(h), ...v }))
      const bestHour = hourEntries.sort((a, b) => b.success - a.success)[0]?.hour ?? '?'
      const worstHour = hourEntries.sort((a, b) => a.success - b.success)[0]?.hour ?? '?'

      // Nick statuses
      const { data: roles } = await supabase.from('campaign_roles')
        .select('account_ids').eq('campaign_id', campaign.id).eq('is_active', true)
      const nickIds = [...new Set((roles || []).flatMap(r => r.account_ids || []))]
      const { data: nicks } = await supabase.from('accounts')
        .select('id, username, status, fb_created_at, created_at').in('id', nickIds)

      // Memories
      const memories = await recall(supabase, { campaignId: campaign.id, memoryType: 'campaign_pattern' })

      const nickLines = (nicks || []).map(n => {
        const age = n.fb_created_at || n.created_at
          ? Math.floor((Date.now() - new Date(n.fb_created_at || n.created_at).getTime()) / 86400000)
          : 0
        return `- ${n.username}: ${n.status}, ${age}d`
      }).join('\n')

      const plan = await callAI(supabase, campaign.owner_id, `
Campaign "${campaign.name}" — Lập kế hoạch ${new Date().toLocaleDateString('vi-VN')}

Hôm qua: ${perf.total} actions, ${perf.success_rate}% success, ${perf.active_nicks} nicks
Best hour: ${bestHour}h | Worst hour: ${worstHour}h
Nicks (${(nicks || []).length}):
${nickLines}
Memories: ${formatMemoriesForPrompt(memories)}

Lập kế hoạch hôm nay (JSON):
{"today_focus":"mục tiêu 1 câu","peak_hours":[8,12,19],"nick_guidance":[{"nick_id":"uuid","mode":"boost|normal|rest","reason":"ngắn"}],"kpi_suggestion":{"likes":60,"comments":15,"friend_requests":10},"watch_for":["điều cần chú ý"]}
Chỉ trả JSON.`, 500)

      if (!plan) continue

      // Apply KPI suggestion (only if significant change > 20%)
      if (plan.kpi_suggestion) {
        const cur = campaign.kpi_config || {}
        const change = Math.abs((plan.kpi_suggestion.likes || 60) - (cur.daily_likes || 60)) / (cur.daily_likes || 60)
        if (change > 0.2) {
          await supabase.from('campaigns').update({
            kpi_config: {
              ...cur,
              daily_likes: plan.kpi_suggestion.likes || cur.daily_likes,
              daily_comments: plan.kpi_suggestion.comments || cur.daily_comments,
              daily_friend_requests: plan.kpi_suggestion.friend_requests || cur.daily_friend_requests,
            }
          }).eq('id', campaign.id)
          await rebalanceKPI(supabase, campaign.id)
          console.log(`[AI-OPS] KPI auto-adjusted for ${campaign.name}`)
        }
      }

      // Save nick guidance to memory
      for (const g of plan.nick_guidance || []) {
        if (!g.nick_id) continue
        await remember(supabase, {
          campaignId: campaign.id, accountId: g.nick_id,
          memoryType: 'nick_behavior', key: 'daily_mode',
          value: { mode: g.mode, reason: g.reason, date: new Date().toISOString().split('T')[0] },
          confidence: 0.6,
        })
      }

      await supabase.from('campaign_activity_log').insert({
        campaign_id: campaign.id, owner_id: campaign.owner_id,
        action_type: 'daily_plan', result_status: 'good',
        details: { plan, perf: { total: perf.total, success_rate: perf.success_rate, best_hour: bestHour, worst_hour: worstHour }, generated_at: new Date().toISOString() },
      })

      await supabase.from('notifications').insert({
        user_id: campaign.owner_id, type: 'daily_briefing',
        title: `📋 ${campaign.name}: ${plan.today_focus}`,
        body: `Peak: ${(plan.peak_hours || []).join('h, ')}h | Watch: ${plan.watch_for?.[0] || 'bình thường'}`,
        level: 'info',
      }).then(() => {}, () => {})

      console.log(`[AI-OPS] Daily plan for ${campaign.name}: ${plan.today_focus}`)
    } catch (err) {
      console.warn(`[AI-OPS] daily plan ${campaign.id}: ${err.message}`)
    }
  }
}

// ══════════════════════════════════════════════════════════
// LEVEL 3: WEEKLY STRATEGY (Sunday 5:30 AM VN)
// ══════════════════════════════════════════════════════════

async function runWeeklyStrategy(supabase) {
  const campaigns = await getActiveCampaigns(supabase)

  for (const campaign of campaigns) {
    try {
      const since7d = new Date(Date.now() - 7 * 86400000).toISOString()
      const { data: logs } = await supabase.from('campaign_activity_log')
        .select('action_type, result_status, account_id, created_at, details')
        .eq('campaign_id', campaign.id)
        .neq('action_type', 'ops_monitor').neq('action_type', 'daily_plan')
        .neq('action_type', 'weekly_strategy').neq('action_type', 'ai_control')
        .gte('created_at', since7d).limit(5000)

      const weekPerf = buildHourlyStats(logs || [])

      // Daily breakdown
      const byDay = {}
      for (const l of logs || []) {
        const d = l.created_at.slice(0, 10)
        if (!byDay[d]) byDay[d] = { date: d, total: 0, success: 0 }
        byDay[d].total++
        if (l.result_status === 'success') byDay[d].success++
      }
      const daily = Object.values(byDay).map(d => ({
        ...d, success_rate: d.total > 0 ? Math.round((d.success / d.total) * 100) : 0,
      })).sort((a, b) => a.date.localeCompare(b.date))

      // Trend
      const firstHalf = daily.slice(0, Math.ceil(daily.length / 2))
      const secondHalf = daily.slice(Math.ceil(daily.length / 2))
      const avgFirst = firstHalf.reduce((s, d) => s + d.total, 0) / (firstHalf.length || 1)
      const avgSecond = secondHalf.reduce((s, d) => s + d.total, 0) / (secondHalf.length || 1)
      const trend = avgSecond >= avgFirst * 1.15 ? 'growing' : avgSecond <= avgFirst * 0.85 ? 'declining' : 'stable'

      // Top comments for style analysis
      const commentLogs = (logs || []).filter(l => l.action_type === 'comment' && l.details?.comment_text)
      const topComments = commentLogs.slice(0, 5).map(l => ({ text: (l.details.comment_text || '').slice(0, 100) }))

      // All memories
      const allMemories = await recall(supabase, { campaignId: campaign.id })

      const strategy = await callAI(supabase, campaign.owner_id, `
Campaign "${campaign.name}" — Phân tích chiến lược tuần

7 ngày: ${weekPerf.total} actions, ${weekPerf.success_rate}% success
Daily: ${daily.map(d => `${d.date}:${d.total}(${d.success_rate}%)`).join(' | ')}
Trend: ${trend}

Sample comments: ${topComments.map(c => `"${c.text}"`).join(' · ') || 'N/A'}
Memories: ${formatMemoriesForPrompt(allMemories)}

Đề xuất chiến lược tuần tới (JSON):
{"trend":"growing|stable|declining","weekly_summary":"2 câu","strategy_changes":["thay đổi"],"content_insights":"phong cách comment hiệu quả nhất","next_week_focus":"mục tiêu","new_learnings":[{"key":"insight","value":"nội dung","confidence":0.7}]}
Chỉ trả JSON.`, 600)

      if (!strategy) continue

      // Save learnings
      for (const learning of strategy.new_learnings || []) {
        if (!learning.key) continue
        await remember(supabase, {
          campaignId: campaign.id, memoryType: 'campaign_pattern',
          key: learning.key, value: learning.value, confidence: learning.confidence || 0.6,
        })
      }

      await supabase.from('campaign_activity_log').insert({
        campaign_id: campaign.id, owner_id: campaign.owner_id,
        action_type: 'weekly_strategy', result_status: trend,
        details: { strategy, weekPerf: { total: weekPerf.total, success_rate: weekPerf.success_rate, daily, trend }, generated_at: new Date().toISOString() },
      })

      const trendIcon = trend === 'growing' ? '📈' : trend === 'declining' ? '📉' : '➡️'
      await supabase.from('notifications').insert({
        user_id: campaign.owner_id, type: 'weekly_report',
        title: `📊 Tuần: ${trendIcon} ${(strategy.weekly_summary || '').slice(0, 60)}`,
        body: strategy.next_week_focus || '',
        level: 'info',
      }).then(() => {}, () => {})

      console.log(`[AI-OPS] Weekly strategy for ${campaign.name}: ${trend} — ${strategy.weekly_summary?.slice(0, 80)}`)
    } catch (err) {
      console.warn(`[AI-OPS] weekly strategy ${campaign.id}: ${err.message}`)
    }
  }
}

module.exports = { runHourlyMonitor, runDailyPlan, runWeeklyStrategy, buildHourlyStats, detectAnomalies }
