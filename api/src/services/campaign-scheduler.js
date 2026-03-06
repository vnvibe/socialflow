const cron = require('node-cron')
const { createClient } = require('@supabase/supabase-js')

let supabase = null

function initScheduler() {
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // Check campaigns every minute
  cron.schedule('* * * * *', async () => {
    await processPendingCampaigns()
  })
}

async function processPendingCampaigns() {
  const now = new Date().toISOString()

  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('*')
    .eq('is_active', true)
    .lte('next_run_at', now)

  if (!campaigns?.length) return

  for (const campaign of campaigns) {
    try {
      await executeCampaign(campaign)
    } catch (err) {
      console.error(`Campaign ${campaign.id} error:`, err.message)
    }
  }
}

async function executeCampaign(campaign) {
  const allTargets = [
    ...(campaign.target_pages || []).map(id => ({ id, type: 'page' })),
    ...(campaign.target_groups || []).map(id => ({ id, type: 'group' })),
    ...(campaign.target_profiles || []).map(id => ({ id, type: 'profile' }))
  ]

  const contentIds = campaign.content_ids || []
  if (contentIds.length === 0 || allTargets.length === 0) return

  // Pick content based on rotation mode
  const contentIdx = campaign.rotation_mode === 'random'
    ? Math.floor(Math.random() * contentIds.length)
    : campaign.total_runs % contentIds.length
  const contentId = contentIds[contentIdx]

  // Create jobs for each target with delay
  for (let i = 0; i < allTargets.length; i++) {
    const target = allTargets[i]
    const delayMinutes = i * (campaign.delay_between_targets_minutes || 15)
    const scheduledAt = new Date(Date.now() + delayMinutes * 60 * 1000)

    // Get account for this target
    let accountId = null
    if (target.type === 'page') {
      const { data } = await supabase.from('fanpages').select('account_id').eq('id', target.id).single()
      accountId = data?.account_id
    } else if (target.type === 'group') {
      const { data } = await supabase.from('fb_groups').select('account_id').eq('id', target.id).single()
      accountId = data?.account_id
    } else {
      accountId = target.id // profile = account
    }

    if (!accountId) continue

    await supabase.from('jobs').insert({
      type: `post_${target.type}`,
      payload: {
        content_id: contentId,
        target_id: target.id,
        account_id: accountId,
        campaign_id: campaign.id,
        spin_mode: campaign.spin_mode || 'basic'
      },
      scheduled_at: scheduledAt.toISOString(),
      created_by: campaign.owner_id
    })
  }

  // Update campaign
  const nextRun = calculateNextRun(campaign)
  await supabase.from('campaigns').update({
    last_run_at: new Date().toISOString(),
    next_run_at: nextRun,
    total_runs: (campaign.total_runs || 0) + 1,
    ...(nextRun === null && { is_active: false })
  }).eq('id', campaign.id)
}

function calculateNextRun(campaign) {
  if (campaign.schedule_type === 'once') return null

  if (campaign.schedule_type === 'interval' && campaign.interval_minutes) {
    const next = new Date(Date.now() + campaign.interval_minutes * 60 * 1000)
    if (campaign.end_at && next > new Date(campaign.end_at)) return null
    return next.toISOString()
  }

  // For cron, let node-cron handle it
  if (campaign.schedule_type === 'recurring' && campaign.cron_expression) {
    // Simple: next interval based on cron
    const next = new Date(Date.now() + 60 * 60 * 1000) // fallback: 1 hour
    if (campaign.end_at && next > new Date(campaign.end_at)) return null
    return next.toISOString()
  }

  return null
}

module.exports = { initScheduler, executeCampaign }
