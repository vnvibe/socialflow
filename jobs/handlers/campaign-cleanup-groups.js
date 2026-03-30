/**
 * Campaign Handler: Cleanup Groups
 * AI evaluates all joined groups for relevance, leaves irrelevant ones.
 * Runs per-account (account_id in payload) to avoid cross-nick issues.
 */

const { getPage, releaseSession } = require('../../browser/session-pool')
const { delay, humanScroll, humanClick } = require('../../browser/human')
const R = require('../../lib/randomizer')
const { filterRelevantGroups } = require('../../lib/ai-filter')
const { ActivityLogger } = require('../../lib/activity-logger')

async function campaignCleanupGroups(payload, supabase) {
  const { account_id, campaign_id, topic, config, owner_id } = payload

  const logger = new ActivityLogger(supabase, {
    campaign_id, account_id, owner_id: owner_id || payload.created_by,
    job_id: payload.job_id,
  })

  if (!topic) throw new Error('SKIP_no_topic_for_cleanup')

  // Get ALL groups for this account
  const { data: allGroups } = await supabase
    .from('fb_groups')
    .select('id, fb_group_id, name, url, member_count, topic, joined_via_campaign_id')
    .eq('account_id', account_id)

  if (!allGroups?.length) {
    return { cleaned: 0, total: 0, message: 'No groups to evaluate' }
  }

  console.log(`[CLEANUP] Evaluating ${allGroups.length} groups for account ${account_id.slice(0, 8)}`)

  // AI evaluates which groups are relevant
  const relevant = await filterRelevantGroups(allGroups, topic, owner_id, account_id, supabase)
  const relevantIds = new Set(relevant.map(g => g.fb_group_id))

  // Groups to leave = not relevant AND not joined by this campaign
  const toLeave = allGroups.filter(g =>
    !relevantIds.has(g.fb_group_id) &&
    g.joined_via_campaign_id !== campaign_id
  )

  if (!toLeave.length) {
    console.log(`[CLEANUP] All ${allGroups.length} groups are relevant — nothing to clean`)
    return { cleaned: 0, kept: allGroups.length, total: allGroups.length }
  }

  console.log(`[CLEANUP] Will leave ${toLeave.length}/${allGroups.length} irrelevant groups`)

  const maxLeave = config?.max_leave_per_run || 10
  const toProcess = toLeave.slice(0, maxLeave)

  // Get account for browser session
  const { data: account } = await supabase
    .from('accounts')
    .select('*, proxies(*)')
    .eq('id', account_id)
    .single()
  if (!account) throw new Error('Account not found')

  let page
  let left = 0
  const leftGroups = []

  try {
    const session = await getPage(account)
    page = session.page

    for (const group of toProcess) {
      try {
        const groupUrl = group.url || `https://www.facebook.com/groups/${group.fb_group_id}`
        console.log(`[CLEANUP] Leaving: ${group.name}`)
        logger.log('leave_group', {
          target_type: 'group', target_id: group.fb_group_id,
          target_name: group.name, target_url: groupUrl,
          result_status: 'pending',
        })

        await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await R.sleepRange(2000, 4000)

        // Find "Joined" or "Đã tham gia" button → click to get leave option
        const joinedBtn = await page.$([
          'div[aria-label="Joined"]',
          'div[aria-label="Đã tham gia"]',
          'div[role="button"]:has-text("Joined")',
          'div[role="button"]:has-text("Đã tham gia")',
        ].join(', '))

        if (!joinedBtn) {
          console.log(`[CLEANUP] No "Joined" button for ${group.name} — skip`)
          continue
        }

        await humanClick(page, joinedBtn)
        await R.sleepRange(1000, 2000)

        // Find "Leave group" or "Rời nhóm" in dropdown
        const leaveBtn = await page.$([
          'div[role="menuitem"]:has-text("Leave group")',
          'div[role="menuitem"]:has-text("Rời nhóm")',
          'div[role="menuitem"]:has-text("Leave Group")',
          'span:has-text("Leave group")',
          'span:has-text("Rời nhóm")',
        ].join(', '))

        if (!leaveBtn) {
          console.log(`[CLEANUP] No "Leave" option for ${group.name} — skip`)
          // Close dropdown
          await page.keyboard.press('Escape')
          continue
        }

        await humanClick(page, leaveBtn)
        await R.sleepRange(1000, 2000)

        // Confirm leave dialog
        const confirmBtn = await page.$([
          'div[aria-label="Leave group"]',
          'div[aria-label="Rời nhóm"]',
          'div[role="button"]:has-text("Leave")',
          'div[role="button"]:has-text("Rời")',
        ].join(', '))

        if (confirmBtn) {
          await humanClick(page, confirmBtn)
          await R.sleepRange(1500, 3000)
        }

        // Remove from DB
        await supabase.from('fb_groups')
          .delete()
          .eq('id', group.id)

        left++
        leftGroups.push(group.name)
        console.log(`[CLEANUP] ✓ Left: ${group.name}`)
        logger.log('leave_group', {
          target_type: 'group', target_id: group.fb_group_id,
          target_name: group.name, result_status: 'success',
        })

        // Gap between leaves
        await R.sleepRange(5000, 10000)

      } catch (err) {
        console.warn(`[CLEANUP] Error leaving ${group.name}: ${err.message}`)
        logger.log('leave_group', {
          target_type: 'group', target_name: group.name,
          result_status: 'failed', details: { error: err.message },
        })
      }
    }
  } finally {
    await logger.flush()
    if (page) releaseSession(account_id)
  }

  return {
    cleaned: left,
    kept: allGroups.length - left,
    total: allGroups.length,
    left_groups: leftGroups,
    remaining_irrelevant: toLeave.length - left,
  }
}

module.exports = campaignCleanupGroups
