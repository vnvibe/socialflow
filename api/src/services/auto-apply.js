/**
 * Shared auto-apply + apply-recommendation logic.
 *
 * Used by:
 *   - routes/campaigns.js (manual apply + auto-apply after review)
 *   - routes/ai-hermes.js (trigger auto-apply after /campaign-review)
 *   - services/campaign-scheduler.js (cron 6h auto-review trigger)
 *
 * All functions take `supabase` as parameter so they work in both route
 * handler context + scheduler context.
 */

const TASK_TO_BUDGET = {
  comment_post: 'comment',
  campaign_nurture: 'comment',
  comment_gen: 'comment',
  nurture_feed: 'comment',
  campaign_opportunity_react: 'opportunity_comment',
  campaign_post: 'post',
  post_page: 'post',
  post_group: 'post',
  post_profile: 'post',
  campaign_send_friend_request: 'friend_request',
  campaign_scan_members: 'scan',
  discover_groups_keyword: 'scan',
  campaign_discover_groups: 'scan',
  campaign_interact_profile: 'like',
}

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 }

async function applyRecommendationCore(supabase, { campaignId, accountId, action, taskType, priority, createdBy }) {
  if (!action) return { ok: false, error: 'action required' }
  let applied_change = null

  if (action === 'fix_checkpoint') {
    if (!accountId) return { ok: false, error: 'account_id required for fix_checkpoint' }
    await supabase.from('accounts').update({ status: 'unknown' }).eq('id', accountId)
    const { error: jobErr } = await supabase.from('jobs').insert({
      type: 'check_health',
      priority: 1,
      status: 'pending',
      payload: { account_id: accountId, action: 'check_health', auto_refresh: true, triggered_by: 'hermes_review' },
      scheduled_at: new Date(Date.now() + 30000).toISOString(),
      created_by: createdBy,
    })
    applied_change = { type: 'status_reset', status: 'unknown', health_check_queued: !jobErr }
  } else if (action === 'pause') {
    if (!accountId) return { ok: false, error: 'account_id required for pause' }
    const { data: roles } = await supabase.from('campaign_roles')
      .select('id, account_ids, is_active').eq('campaign_id', campaignId)
    const affected = []
    for (const r of (roles || [])) {
      if ((r.account_ids || []).includes(accountId)) {
        const newIds = (r.account_ids || []).filter(id => id !== accountId)
        await supabase.from('campaign_roles').update({ account_ids: newIds }).eq('id', r.id)
        affected.push(r.id)
      }
    }
    applied_change = { type: 'removed_from_roles', role_ids: affected }
  } else if (action === 'increase' || action === 'decrease') {
    if (!accountId) return { ok: false, error: 'account_id required' }
    const budgetKey = TASK_TO_BUDGET[taskType] || 'comment'
    const multiplier = action === 'increase' ? 1.5 : 0.7
    const { data: acc } = await supabase.from('accounts')
      .select('daily_budget').eq('id', accountId).single()
    if (!acc) return { ok: false, error: 'Account not found' }
    const budget = acc.daily_budget || {}
    const curr = budget[budgetKey] || { max: 10, used: 0 }
    const oldMax = curr.max || 10
    const newMax = Math.max(1, Math.min(500, Math.round(oldMax * multiplier)))
    await supabase.from('accounts')
      .update({ daily_budget: { ...budget, [budgetKey]: { ...curr, max: newMax } } })
      .eq('id', accountId)
    applied_change = { type: 'budget_adjusted', key: budgetKey, old_max: oldMax, new_max: newMax, multiplier }
  } else if (action === 'focus') {
    if (!accountId) return { ok: false, error: 'account_id required for focus' }
    if (taskType === 'discover_groups' || taskType === 'discover_groups_keyword' || taskType === 'campaign_discover_groups') {
      const { data: camp } = await supabase.from('campaigns').select('topic').eq('id', campaignId).single()
      await supabase.from('jobs').insert({
        type: 'campaign_discover_groups',
        priority: 3, status: 'pending',
        payload: { account_id: accountId, campaign_id: campaignId, topic: camp?.topic || '', triggered_by: 'hermes_review' },
        scheduled_at: new Date(Date.now() + 60000).toISOString(),
        created_by: createdBy,
      })
      applied_change = { type: 'job_queued', job_type: 'campaign_discover_groups' }
    } else {
      await supabase.from('jobs').insert({
        type: taskType || 'campaign_nurture',
        priority: 3, status: 'pending',
        payload: { account_id: accountId, campaign_id: campaignId, triggered_by: 'hermes_review' },
        scheduled_at: new Date(Date.now() + 60000).toISOString(),
        created_by: createdBy,
      })
      applied_change = { type: 'job_queued', job_type: taskType }
    }
  } else {
    return { ok: false, error: `Unknown action: ${action}` }
  }

  return { ok: true, change: applied_change }
}

async function recordAppliedRec(supabase, { campaignId, accountId, action, taskType, priority, recIndex, change, appliedBy, autoApplied }) {
  const { data: latestReview } = await supabase
    .from('campaign_hermes_reviews')
    .select('id, applied_recommendations')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!latestReview) return
  const existing = Array.isArray(latestReview.applied_recommendations) ? latestReview.applied_recommendations : []
  await supabase.from('campaign_hermes_reviews').update({
    applied_recommendations: [...existing, {
      applied_at: new Date().toISOString(),
      applied_by: appliedBy,
      auto_applied: !!autoApplied,
      account_id: accountId, action, task_type: taskType, priority, rec_index: recIndex,
      change,
    }],
    applied_count: (existing.length || 0) + 1,
    applied_at: new Date().toISOString(),
  }).eq('id', latestReview.id)
}

async function resolveAccountIdForCampaign(supabase, ref, campaignId) {
  if (!ref) return null
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref)) return ref
  const { data: roles } = await supabase.from('campaign_roles').select('account_ids').eq('campaign_id', campaignId)
  const allIds = [...new Set((roles || []).flatMap(r => r.account_ids || []))]
  if (allIds.length === 0) return null
  const { data: accs } = await supabase.from('accounts').select('id, username').in('id', allIds)
  const match = (accs || []).find(a => a.username === ref)
  return match?.id || null
}

async function autoApplyRecommendations(supabase, { campaignId, recommendations, ownerId }) {
  const { data: campaign } = await supabase.from('campaigns')
    .select('auto_apply_enabled, auto_apply_percent, auto_apply_min_priority')
    .eq('id', campaignId).single()
  if (!campaign || !campaign.auto_apply_enabled || (campaign.auto_apply_percent || 0) <= 0) {
    return { auto_applied: [], skipped: 'disabled' }
  }

  const minRank = PRIORITY_RANK[campaign.auto_apply_min_priority || 'high'] || 3
  const applied = []
  const skipped = []

  for (let i = 0; i < (recommendations || []).length; i++) {
    const rec = recommendations[i]
    const recRank = PRIORITY_RANK[rec.priority || 'low'] || 1
    if (recRank < minRank) {
      skipped.push({ index: i, reason: `priority ${rec.priority} < min ${campaign.auto_apply_min_priority}` })
      continue
    }
    const roll = Math.random() * 100
    if (roll > campaign.auto_apply_percent) {
      skipped.push({ index: i, reason: `roll ${roll.toFixed(1)} > ${campaign.auto_apply_percent}%` })
      continue
    }
    const accId = await resolveAccountIdForCampaign(supabase, rec.account_id, campaignId)
    if (!accId && rec.action !== 'summary') {
      skipped.push({ index: i, reason: 'account_id could not resolve' })
      continue
    }
    try {
      const result = await applyRecommendationCore(supabase, {
        campaignId, accountId: accId, action: rec.action, taskType: rec.task_type,
        priority: rec.priority, createdBy: ownerId,
      })
      if (!result.ok) {
        skipped.push({ index: i, reason: result.error })
        continue
      }
      await recordAppliedRec(supabase, {
        campaignId, accountId: accId, action: rec.action, taskType: rec.task_type,
        priority: rec.priority, recIndex: i, change: result.change, appliedBy: ownerId, autoApplied: true,
      })
      applied.push({ index: i, account_id: accId, action: rec.action, change: result.change })
    } catch (e) {
      skipped.push({ index: i, reason: e.message })
    }
  }

  await supabase.from('campaigns')
    .update({ auto_apply_last_run_at: new Date().toISOString() })
    .eq('id', campaignId)

  return { auto_applied: applied, skipped }
}

module.exports = {
  applyRecommendationCore,
  recordAppliedRec,
  resolveAccountIdForCampaign,
  autoApplyRecommendations,
  TASK_TO_BUDGET,
  PRIORITY_RANK,
}
