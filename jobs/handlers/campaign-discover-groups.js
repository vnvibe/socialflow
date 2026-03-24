/**
 * Campaign Handler: Discover Groups (Role: scout)
 * Search groups by topic, join, scan members → feed target_queue
 */

const { getPage, releaseSession } = require('../../browser/session-pool')
const { delay, humanScroll, humanMouseMove, humanClick } = require('../../browser/human')
const { saveDebugScreenshot } = require('./post-utils')
const { checkHardLimit, applyAgeFactor } = require('../../lib/hard-limits')
const R = require('../../lib/randomizer')

async function campaignDiscoverGroups(payload, supabase) {
  const { account_id, campaign_id, role_id, topic, config, feeds_into } = payload

  const { data: account } = await supabase
    .from('accounts')
    .select('*, proxies(*)')
    .eq('id', account_id)
    .single()
  if (!account) throw new Error('Account not found')

  // Check budget
  const budget = account.daily_budget?.join_group || { used: 0, max: 3 }
  const { allowed, remaining } = checkHardLimit('join_group', budget.used, 0)
  if (!allowed || remaining <= 0) {
    throw new Error('SKIP_join_group_budget_exceeded')
  }

  const nickAge = Math.floor((Date.now() - new Date(account.created_at).getTime()) / 86400000)
  const maxJoin = applyAgeFactor(remaining, nickAge)

  let page
  try {
    const session = await getPage(account)
    page = session.page

    // Search groups by topic
    const searchUrl = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(topic)}`
    console.log(`[CAMPAIGN-SCOUT] Searching groups: ${topic}`)
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await R.sleepRange(2000, 4000)

    // Scroll to load results
    const scrollCount = R.randInt(3, 6)
    for (let i = 0; i < scrollCount; i++) {
      await humanScroll(page)
      await R.sleepRange(1000, 2000)
    }

    // Extract group data from search results
    const groups = await page.evaluate(() => {
      const results = []
      const links = document.querySelectorAll('a[href*="/groups/"]')
      const seen = new Set()

      for (const link of links) {
        const href = link.href
        const match = href.match(/\/groups\/(\d+)/)
        if (!match) continue
        const groupId = match[1]
        if (seen.has(groupId)) continue
        seen.add(groupId)

        // Try to get group name and member count from nearby elements
        const container = link.closest('[role="article"]') || link.closest('div[class]')
        const name = link.textContent?.trim() || ''
        const text = container?.textContent || ''
        const memberMatch = text.match(/([\d,.]+)\s*(thành viên|members|người)/i)
        const memberCount = memberMatch ? parseInt(memberMatch[1].replace(/[.,]/g, '')) : 0

        if (name && name.length > 2) {
          results.push({
            fb_group_id: groupId,
            name: name.substring(0, 100),
            url: `https://www.facebook.com/groups/${groupId}`,
            member_count: memberCount,
          })
        }
      }
      return results.slice(0, 20)
    })

    console.log(`[CAMPAIGN-SCOUT] Found ${groups.length} groups for "${topic}"`)

    // Get already joined groups
    const { data: existingGroups } = await supabase
      .from('fb_groups')
      .select('fb_group_id')
      .eq('account_id', account_id)
    const joinedSet = new Set((existingGroups || []).map(g => g.fb_group_id))

    // Filter: not joined, > 100 members
    const minMembers = config?.min_members || 100
    const candidates = groups.filter(g =>
      !joinedSet.has(g.fb_group_id) && g.member_count >= minMembers
    )

    let joined = 0
    const joinedGroups = []

    for (const group of candidates) {
      if (joined >= maxJoin) break

      try {
        await page.goto(group.url, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await R.sleepRange(2000, 4000)
        await humanMouseMove(page)

        // Find join button
        const joinBtn = await page.$([
          'div[aria-label="Join group"]',
          'div[aria-label="Tham gia nhóm"]',
          'div[aria-label="Join Group"]',
          'div[role="button"]:has-text("Join")',
          'div[role="button"]:has-text("Tham gia")',
        ].join(', '))

        if (joinBtn) {
          await humanClick(page, joinBtn)
          await R.sleepRange(1500, 3000)

          // Answer screening questions if any
          const submitBtn = await page.$('div[aria-label="Submit"], div[aria-label="Gửi"]')
          if (submitBtn) {
            await R.sleepRange(1000, 2000)
            await humanClick(page, submitBtn)
            await R.sleepRange(1000, 2000)
          }

          // Increment budget
          await supabase.rpc('increment_budget', {
            p_account_id: account_id,
            p_action_type: 'join_group',
          })

          // Save group to DB
          await supabase.from('fb_groups').upsert({
            account_id,
            fb_group_id: group.fb_group_id,
            name: group.name,
            url: group.url,
            member_count: group.member_count,
          }, { onConflict: 'account_id,fb_group_id', ignoreDuplicates: true })

          joined++
          joinedGroups.push(group)
          console.log(`[CAMPAIGN-SCOUT] Joined group: ${group.name} (${group.member_count} members)`)

          // Gap between joins
          if (joined < maxJoin && candidates.indexOf(group) < candidates.length - 1) {
            const gap = R.joinGroupGap()
            console.log(`[CAMPAIGN-SCOUT] Waiting ${Math.round(gap / 1000)}s before next join`)
            await R.sleep(gap)
          }
        }
      } catch (err) {
        console.warn(`[CAMPAIGN-SCOUT] Failed to join ${group.name}: ${err.message}`)
      }
    }

    // If feeds_into role, scan members of joined groups and add to target_queue
    if (feeds_into && joinedGroups.length > 0) {
      let totalMembers = 0
      for (const group of joinedGroups) {
        try {
          await page.goto(`${group.url}/members`, { waitUntil: 'domcontentloaded', timeout: 30000 })
          await R.sleepRange(2000, 3000)

          // Scroll to load members
          for (let i = 0; i < 3; i++) {
            await humanScroll(page)
            await R.sleepRange(1000, 2000)
          }

          const members = await page.evaluate(() => {
            const results = []
            const links = document.querySelectorAll('a[href*="/user/"], a[href*="/profile.php"]')
            const seen = new Set()
            for (const link of links) {
              const href = link.href
              const idMatch = href.match(/\/user\/(\d+)/) || href.match(/id=(\d+)/)
              if (!idMatch) continue
              const fbId = idMatch[1]
              if (seen.has(fbId)) continue
              seen.add(fbId)
              results.push({
                fb_user_id: fbId,
                fb_user_name: link.textContent?.trim()?.substring(0, 80) || '',
                fb_profile_url: href,
              })
            }
            return results.slice(0, 30)
          })

          if (members.length > 0) {
            await supabase.from('target_queue').upsert(
              members.map(m => ({
                campaign_id,
                source_role_id: role_id,
                target_role_id: feeds_into,
                fb_user_id: m.fb_user_id,
                fb_user_name: m.fb_user_name,
                fb_profile_url: m.fb_profile_url,
                source_group_name: group.name,
                active_score: 50 + Math.random() * 50,
                status: 'pending',
              })),
              { onConflict: 'campaign_id,fb_user_id', ignoreDuplicates: true }
            )
            totalMembers += members.length
          }
        } catch (err) {
          console.warn(`[CAMPAIGN-SCOUT] Failed to scan members of ${group.name}: ${err.message}`)
        }
      }
      console.log(`[CAMPAIGN-SCOUT] Added ${totalMembers} members to target_queue`)
    }

    return {
      success: true,
      groups_found: groups.length,
      groups_joined: joined,
      topic,
    }
  } catch (err) {
    if (page) await saveDebugScreenshot(page, `campaign-scout-${account_id}`)
    throw err
  } finally {
    if (page) await page.goto('about:blank', { timeout: 3000 }).catch(() => {})
    releaseSession(account_id)
  }
}

module.exports = campaignDiscoverGroups
