/**
 * AI-Powered Adaptive Post Scheduling
 *
 * Collects performance history from publish_history and campaign_activity_log,
 * then asks AI to recommend optimal posting strategy.
 *
 * Only activates when account has >= 5 published posts (enough data to learn from).
 */

const MIN_POSTS_FOR_AI = 5

/**
 * Collect performance data for an account from publish_history
 * @param {object} supabase - Supabase client
 * @param {string} accountId - Account UUID
 * @returns {object|null} - Performance data or null if insufficient
 */
async function collectPerformanceData(supabase, accountId) {
  // Engagement by hour of day (last 30 days)
  const { data: hourlyData } = await supabase
    .from('publish_history')
    .select('published_at, reactions, comments, shares, target_type, target_fb_id, target_name')
    .eq('account_id', accountId)
    .eq('status', 'success')
    .gte('published_at', new Date(Date.now() - 30 * 86400000).toISOString())
    .order('published_at', { ascending: false })

  if (!hourlyData?.length || hourlyData.length < MIN_POSTS_FOR_AI) {
    return null // Not enough data
  }

  // Aggregate by hour
  const byHour = {}
  for (let h = 0; h < 24; h++) byHour[h] = { reactions: 0, comments: 0, count: 0 }

  for (const post of hourlyData) {
    if (!post.published_at) continue
    const hour = new Date(post.published_at).getHours()
    byHour[hour].reactions += post.reactions || 0
    byHour[hour].comments += post.comments || 0
    byHour[hour].count++
  }

  // Find best hours (top 3 by avg engagement)
  const hourStats = Object.entries(byHour)
    .filter(([, v]) => v.count > 0)
    .map(([h, v]) => ({
      hour: parseInt(h),
      avg_reactions: v.count > 0 ? Math.round(v.reactions / v.count * 10) / 10 : 0,
      avg_comments: v.count > 0 ? Math.round(v.comments / v.count * 10) / 10 : 0,
      post_count: v.count,
      total_engagement: v.reactions + v.comments,
    }))
    .sort((a, b) => (b.avg_reactions + b.avg_comments) - (a.avg_reactions + a.avg_comments))

  const bestHours = hourStats.slice(0, 5).map(h => h.hour)

  // Aggregate by day of week
  const byDay = {}
  for (let d = 0; d < 7; d++) byDay[d] = { reactions: 0, comments: 0, count: 0 }

  for (const post of hourlyData) {
    if (!post.published_at) continue
    const day = new Date(post.published_at).getDay()
    byDay[day].reactions += post.reactions || 0
    byDay[day].comments += post.comments || 0
    byDay[day].count++
  }

  const dayNames = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
  const bestDays = Object.entries(byDay)
    .filter(([, v]) => v.count > 0)
    .sort((a, b) => (b[1].reactions + b[1].comments) - (a[1].reactions + a[1].comments))
    .slice(0, 3)
    .map(([d]) => dayNames[parseInt(d)])

  // Per-group performance
  const groupPerf = {}
  for (const post of hourlyData) {
    if (post.target_type !== 'group' || !post.target_fb_id) continue
    if (!groupPerf[post.target_fb_id]) {
      groupPerf[post.target_fb_id] = {
        group_id: post.target_fb_id,
        group_name: post.target_name || post.target_fb_id,
        reactions: 0, comments: 0, count: 0, last_post_at: null,
      }
    }
    const g = groupPerf[post.target_fb_id]
    g.reactions += post.reactions || 0
    g.comments += post.comments || 0
    g.count++
    if (!g.last_post_at || post.published_at > g.last_post_at) {
      g.last_post_at = post.published_at
    }
  }

  const groupStats = Object.values(groupPerf)
    .map(g => ({
      ...g,
      avg_reactions: g.count > 0 ? Math.round(g.reactions / g.count * 10) / 10 : 0,
      avg_comments: g.count > 0 ? Math.round(g.comments / g.count * 10) / 10 : 0,
    }))
    .sort((a, b) => (b.avg_reactions + b.avg_comments) - (a.avg_reactions + a.avg_comments))

  // Content type performance
  const contentPerf = {}
  for (const post of hourlyData) {
    const type = post.target_type || 'unknown'
    if (!contentPerf[type]) contentPerf[type] = { reactions: 0, comments: 0, count: 0 }
    contentPerf[type].reactions += post.reactions || 0
    contentPerf[type].comments += post.comments || 0
    contentPerf[type].count++
  }

  return {
    total_posts: hourlyData.length,
    hour_stats: hourStats,
    best_hours: bestHours,
    best_days: bestDays,
    group_stats: groupStats,
    content_stats: contentPerf,
  }
}

/**
 * Ask AI for optimal post strategy based on collected data
 * @param {object} supabase - Supabase client
 * @param {string} ownerId - User UUID
 * @param {object} perfData - From collectPerformanceData()
 * @param {object} campaign - Campaign object with topic
 * @returns {object} Strategy recommendation
 */
async function evaluatePostStrategy(supabase, ownerId, perfData, campaign) {
  if (!perfData) return null

  const hourSummary = perfData.hour_stats
    .filter(h => h.post_count > 0)
    .slice(0, 8)
    .map(h => `  ${h.hour}h: ${h.avg_reactions} reactions, ${h.avg_comments} comments (${h.post_count} posts)`)
    .join('\n')

  const groupSummary = perfData.group_stats
    .slice(0, 10)
    .map(g => `  "${g.group_name}": avg ${g.avg_reactions} reactions, ${g.avg_comments} comments (${g.count} posts, last: ${g.last_post_at ? new Date(g.last_post_at).toLocaleDateString() : '?'})`)
    .join('\n')

  const prompt = `Phân tích hiệu suất posting và đề xuất chiến lược tối ưu.

=== CHIẾN DỊCH ===
Chủ đề: "${campaign.topic || campaign.name}"
Tổng posts 30 ngày: ${perfData.total_posts}

=== HIỆU SUẤT THEO GIỜ ===
${hourSummary || '(chưa đủ dữ liệu)'}

=== HIỆU SUẤT THEO NHÓM ===
${groupSummary || '(chưa đủ dữ liệu)'}

=== NGÀY TỐT NHẤT ===
${perfData.best_days.join(', ') || '(chưa đủ dữ liệu)'}

=== YÊU CẦU ===
Dựa trên dữ liệu trên, đề xuất:
1. Giờ nào nên post (top 3 giờ)
2. Nhóm nào nên ưu tiên (top 3 group_id)
3. Nhóm nào nên tránh (engagement thấp hoặc không phản hồi)
4. Gợi ý dạng content hiệu quả nhất

Trả về JSON duy nhất:
{
  "recommended_hours": [8, 12, 19],
  "best_groups": ["group_fb_id_1"],
  "avoid_groups": ["group_fb_id_3"],
  "content_suggestion": "gợi ý dạng content",
  "confidence": "high|medium|low",
  "reason": "tóm tắt 1-2 câu"
}`

  try {
    const { getOrchestratorForUser } = require('./ai/orchestrator')
    const orchestrator = await getOrchestratorForUser(ownerId, supabase)

    const result = await orchestrator.call('post_strategy', [
      { role: 'user', content: prompt }
    ], { max_tokens: 300, temperature: 0.15 })

    const text = result?.text || result?.content || ''
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      const strategy = JSON.parse(match[0])
      // Ensure arrays exist
      strategy.recommended_hours = strategy.recommended_hours || perfData.best_hours
      strategy.best_groups = strategy.best_groups || []
      strategy.avoid_groups = strategy.avoid_groups || []
      return strategy
    }
  } catch (err) {
    console.warn(`[POST-STRATEGY] AI evaluation failed: ${err.message}`)
  }

  // Fallback: use raw data without AI
  return {
    recommended_hours: perfData.best_hours,
    best_groups: perfData.group_stats.slice(0, 3).map(g => g.group_id),
    avoid_groups: perfData.group_stats.filter(g => g.count >= 3 && g.avg_reactions === 0 && g.avg_comments === 0).map(g => g.group_id),
    content_suggestion: null,
    confidence: 'low',
    reason: 'Dùng dữ liệu thô (AI không khả dụng)',
  }
}

/**
 * Get optimal scheduled_at time based on recommended hours
 * Picks the nearest recommended hour in the future
 *
 * @param {number[]} recommendedHours - e.g. [8, 12, 19]
 * @param {number} minDelayMinutes - minimum delay from now
 * @returns {Date} - Optimal schedule time
 */
function getOptimalScheduleTime(recommendedHours, minDelayMinutes = 5) {
  if (!recommendedHours?.length) return new Date(Date.now() + minDelayMinutes * 60000)

  const now = new Date()
  const currentHour = now.getHours()
  const currentMin = now.getMinutes()

  // Sort hours and find next upcoming one
  const sorted = [...recommendedHours].sort((a, b) => a - b)

  for (const hour of sorted) {
    if (hour > currentHour || (hour === currentHour && currentMin < 45)) {
      // This hour is still upcoming today
      const target = new Date(now)
      target.setHours(hour, Math.floor(Math.random() * 30) + 5, 0, 0) // random minute 5-35
      if (target.getTime() - now.getTime() >= minDelayMinutes * 60000) {
        return target
      }
    }
  }

  // All recommended hours passed today — schedule for first hour tomorrow
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(sorted[0], Math.floor(Math.random() * 30) + 5, 0, 0)
  return tomorrow
}

module.exports = {
  collectPerformanceData,
  evaluatePostStrategy,
  getOptimalScheduleTime,
  MIN_POSTS_FOR_AI,
}
