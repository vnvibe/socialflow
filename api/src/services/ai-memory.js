/**
 * AI Memory — API-side thin wrapper for AI Pilot integration
 * Same logic as agent/lib/ai-memory.js but uses passed supabase client
 */

async function remember(supabase, { campaignId, accountId, groupFbId, memoryType, key, value, confidence }) {
  if (!campaignId || !memoryType || !key) return
  try {
    let query = supabase.from('ai_pilot_memory')
      .select('id, confidence, evidence_count')
      .eq('campaign_id', campaignId).eq('memory_type', memoryType).eq('key', key)
    if (accountId) query = query.eq('account_id', accountId)
    else query = query.is('account_id', null)
    if (groupFbId) query = query.eq('group_fb_id', groupFbId)
    else query = query.is('group_fb_id', null)

    const { data: existing } = await query.maybeSingle()
    if (existing) {
      await supabase.from('ai_pilot_memory').update({
        value, confidence: confidence ?? Math.min(0.95, existing.confidence + 0.05),
        evidence_count: existing.evidence_count + 1, last_updated_at: new Date().toISOString(),
      }).eq('id', existing.id)
    } else {
      await supabase.from('ai_pilot_memory').insert({
        campaign_id: campaignId, account_id: accountId || null, group_fb_id: groupFbId || null,
        memory_type: memoryType, key, value, confidence: confidence ?? 0.5, evidence_count: 1,
      })
    }
  } catch (err) { console.warn(`[AI-MEMORY] remember error: ${err.message}`) }
}

async function recall(supabase, { campaignId, accountId, groupFbId, memoryType }) {
  try {
    let query = supabase.from('ai_pilot_memory')
      .select('key, value, confidence, evidence_count, last_updated_at')
      .order('confidence', { ascending: false }).gte('confidence', 0.15).limit(30)
    if (campaignId) query = query.eq('campaign_id', campaignId)
    if (accountId) query = query.eq('account_id', accountId)
    if (groupFbId) query = query.eq('group_fb_id', groupFbId)
    if (memoryType) query = query.eq('memory_type', memoryType)
    const { data } = await query
    return data || []
  } catch { return [] }
}

function formatMemoriesForPrompt(memories) {
  if (!memories?.length) return '(chưa có memory)'
  return memories.map(m => {
    const val = typeof m.value === 'string' ? m.value : JSON.stringify(m.value)
    return `- ${m.key}: ${val.substring(0, 120)} (tin cậy: ${Math.round(m.confidence * 100)}%, ${m.evidence_count} lần)`
  }).join('\n')
}

async function decayOldMemories(supabase, campaignId) {
  try {
    const { data: stale } = await supabase.from('ai_pilot_memory')
      .select('id, confidence').lt('last_updated_at', new Date(Date.now() - 7 * 86400000).toISOString())
      .gt('confidence', 0.1).limit(100)
    let count = 0
    for (const m of (stale || [])) {
      const newConf = Math.round((m.confidence - 0.1) * 100) / 100
      if (newConf <= 0.1) await supabase.from('ai_pilot_memory').delete().eq('id', m.id)
      else await supabase.from('ai_pilot_memory').update({ confidence: newConf, last_updated_at: new Date().toISOString() }).eq('id', m.id)
      count++
    }
    return count
  } catch { return 0 }
}

module.exports = { remember, recall, formatMemoriesForPrompt, decayOldMemories }
