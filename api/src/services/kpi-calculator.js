/**
 * Phase 11 — KPI Calculator
 *
 * Computes per-nick daily targets for a campaign by weighting nicks
 * according to their warmup phase + health status, then upserts the
 * targets into nick_kpi_daily for today.
 *
 * Triggered:
 *   - PUT /campaigns/:id when account_ids change
 *   - POST /campaigns/:id/priority-groups (after KPI bump)
 *   - POST /campaigns/:id/rebalance-kpi (manual)
 *   - Daily cron 00:01 VN (nurture-scheduler.js)
 *   - Agent: when a nick is force-disabled (poller calls API endpoint)
 */

function getNickAgeDays(nick) {
  const created = nick.fb_created_at || nick.created_at
  if (!created) return 0
  return Math.floor((Date.now() - new Date(created).getTime()) / 86400000)
}

function nickWeight(nick) {
  const age = getNickAgeDays(nick)
  let w = 1.0
  if (age < 14) w = 0.2
  else if (age < 30) w = 0.35
  else if (age < 90) w = 0.6
  else if (age < 180) w = 0.85
  if (nick.status === 'at_risk') w *= 0.5
  return w
}

const DEFAULT_KPI = { daily_likes: 60, daily_comments: 15, daily_friend_requests: 10, daily_group_joins: 9 }

async function rebalanceKPI(supabase, campaignId) {
  if (!campaignId) return { ok: false, reason: 'no campaign_id' }

  const { data: campaign, error: cErr } = await supabase
    .from('campaigns')
    .select('id, kpi_config, campaign_roles(account_ids)')
    .eq('id', campaignId)
    .single()
  if (cErr || !campaign) return { ok: false, reason: cErr?.message || 'campaign not found' }

  const allNickIds = [...new Set((campaign.campaign_roles || []).flatMap(r => r.account_ids || []))]
  if (allNickIds.length === 0) {
    console.log(`[KPI] Campaign ${campaignId.slice(0,8)} has no nicks — nothing to rebalance`)
    return { ok: true, nicks: 0 }
  }

  const { data: nicks } = await supabase
    .from('accounts')
    .select('id, status, fb_created_at, created_at')
    .in('id', allNickIds)
    .eq('is_active', true)
    .in('status', ['healthy', 'unknown', 'at_risk'])

  if (!nicks?.length) {
    console.log(`[KPI] Campaign ${campaignId.slice(0,8)} has no eligible nicks`)
    return { ok: true, nicks: 0 }
  }

  const weighted = nicks.map(n => ({ id: n.id, weight: nickWeight(n) }))
  const totalWeight = weighted.reduce((s, n) => s + n.weight, 0) || 1
  const kpi = { ...DEFAULT_KPI, ...(campaign.kpi_config || {}) }

  const today = new Date().toISOString().split('T')[0]
  const rows = weighted.map(n => {
    const share = n.weight / totalWeight
    return {
      campaign_id: campaignId,
      account_id: n.id,
      date: today,
      target_likes: Math.round(kpi.daily_likes * share),
      target_comments: Math.round(kpi.daily_comments * share),
      target_friend_requests: Math.round(kpi.daily_friend_requests * share),
      target_group_joins: Math.round(kpi.daily_group_joins * share),
    }
  })

  // Upsert preserves done_* counters because we're not setting them.
  const { error: upErr } = await supabase
    .from('nick_kpi_daily')
    .upsert(rows, { onConflict: 'campaign_id,account_id,date' })
  if (upErr) {
    console.warn(`[KPI] upsert failed: ${upErr.message}`)
    return { ok: false, reason: upErr.message }
  }

  console.log(`[KPI] Rebalanced ${nicks.length} nicks for campaign ${campaignId.slice(0,8)} (total weight ${totalWeight.toFixed(2)})`)
  return { ok: true, nicks: nicks.length, totalWeight, targets: rows }
}

async function rebalanceAllActive(supabase) {
  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, name')
    .eq('is_active', true)
  let n = 0
  for (const c of campaigns || []) {
    try {
      const r = await rebalanceKPI(supabase, c.id)
      if (r.ok) n++
    } catch (err) {
      console.warn(`[KPI] daily rebalance ${c.id} failed: ${err.message}`)
    }
  }
  console.log(`[KPI] Daily rebalance: ${n}/${(campaigns || []).length} campaigns`)
  return n
}

module.exports = { rebalanceKPI, rebalanceAllActive, nickWeight, getNickAgeDays, DEFAULT_KPI }
