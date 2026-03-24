/**
 * Campaign Handler: Nurture Group (Role: nurture)
 * Visit joined groups, like posts, leave natural comments
 */

const { getPage, releaseSession } = require('../../browser/session-pool')
const { delay, humanScroll, humanMouseMove, humanClick, humanType } = require('../../browser/human')
const { saveDebugScreenshot } = require('./post-utils')
const { checkHardLimit } = require('../../lib/hard-limits')
const R = require('../../lib/randomizer')

async function campaignNurture(payload, supabase) {
  const { account_id, campaign_id, role_id, topic, config } = payload

  const { data: account } = await supabase
    .from('accounts')
    .select('*, proxies(*)')
    .eq('id', account_id)
    .single()
  if (!account) throw new Error('Account not found')

  const likeBudget = account.daily_budget?.like || { used: 0, max: 80 }
  const commentBudget = account.daily_budget?.comment || { used: 0, max: 25 }

  const likeCheck = checkHardLimit('like', likeBudget.used, 0)
  const commentCheck = checkHardLimit('comment', commentBudget.used, 0)

  if (!likeCheck.allowed && !commentCheck.allowed) {
    throw new Error('SKIP_nurture_budget_exceeded')
  }

  // Get groups this account has joined
  const { data: groups } = await supabase
    .from('fb_groups')
    .select('fb_group_id, name, url')
    .eq('account_id', account_id)

  if (!groups?.length) throw new Error('SKIP_no_groups_joined')

  // Pick random 1-3 groups
  const shuffled = groups.sort(() => Math.random() - 0.5)
  const groupsToVisit = shuffled.slice(0, R.randInt(1, Math.min(3, groups.length)))

  let page
  try {
    const session = await getPage(account)
    page = session.page

    let totalLikes = 0
    let totalComments = 0
    const nickAge = Math.floor((Date.now() - new Date(account.created_at).getTime()) / 86400000)

    for (const group of groupsToVisit) {
      const groupUrl = group.url || `https://www.facebook.com/groups/${group.fb_group_id}`
      console.log(`[CAMPAIGN-NURTURE] Visiting group: ${group.name || group.fb_group_id}`)

      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await R.sleepRange(2000, 4000)
      await humanMouseMove(page)

      // Browse feed naturally
      await humanScroll(page)
      await R.sleepRange(1000, 2000)
      await humanScroll(page)
      await R.sleepRange(1000, 2000)

      // Find like buttons on posts
      if (likeCheck.allowed && totalLikes < likeCheck.remaining) {
        const maxLikes = R.randInt(3, 8)
        const likeButtons = await page.$$([
          'div[aria-label="Like"], div[aria-label="Thích"]',
          'div[aria-label="Thich"]',
          'span[aria-label="Like"]',
        ].join(', '))

        const likesToDo = Math.min(maxLikes, likeButtons.length, likeCheck.remaining - totalLikes)

        for (let i = 0; i < likesToDo; i++) {
          try {
            const btn = likeButtons[i]
            // Check if not already liked
            const ariaPressed = await btn.getAttribute('aria-pressed').catch(() => null)
            if (ariaPressed === 'true') continue

            await btn.scrollIntoViewIfNeeded()
            await R.sleepRange(500, 1500)
            await btn.click()
            totalLikes++

            await supabase.rpc('increment_budget', {
              p_account_id: account_id,
              p_action_type: 'like',
            })

            await R.sleepRange(R.randInt(2, 5) * 1000, R.randInt(5, 10) * 1000)
          } catch (err) {
            // Skip individual like errors
          }
        }
      }

      // Comment on 1-2 posts (if budget allows)
      if (commentCheck.allowed && totalComments < commentCheck.remaining) {
        const maxComments = R.randInt(1, 2)
        const commentTemplates = config?.comment_templates || [
          'Hay quá! 👍',
          'Cảm ơn bạn chia sẻ',
          'Thông tin hữu ích',
          'Mình cũng nghĩ vậy',
          'Thanks for sharing!',
          'Đồng ý 💯',
        ]

        // Find comment buttons
        const commentBtns = await page.$$([
          'div[aria-label="Leave a comment"], div[aria-label="Viết bình luận"]',
          'div[aria-label="Comment"], div[aria-label="Bình luận"]',
        ].join(', '))

        const commentsToDo = Math.min(maxComments, commentBtns.length, commentCheck.remaining - totalComments)

        for (let i = 0; i < commentsToDo; i++) {
          try {
            const btn = commentBtns[i]
            await btn.scrollIntoViewIfNeeded()
            await R.sleepRange(500, 1000)
            await btn.click()
            await R.sleepRange(1000, 2000)

            // Find comment input
            const commentBox = await page.$([
              'div[contenteditable="true"][role="textbox"]',
              'div[aria-label*="comment"][contenteditable="true"]',
              'div[aria-label*="bình luận"][contenteditable="true"]',
            ].join(', '))

            if (commentBox) {
              const text = commentTemplates[Math.floor(Math.random() * commentTemplates.length)]

              await commentBox.click()
              await R.sleepRange(500, 1000)

              // Type char by char
              for (const char of text) {
                await page.keyboard.type(char)
                await R.sleep(R.keyDelay())
                const pause = R.thinkPause()
                if (pause > 0) await R.sleep(pause)
              }

              await R.sleepRange(500, 1500)
              await page.keyboard.press('Enter')
              await R.sleepRange(1000, 2000)

              totalComments++
              await supabase.rpc('increment_budget', {
                p_account_id: account_id,
                p_action_type: 'comment',
              })

              console.log(`[CAMPAIGN-NURTURE] Commented in ${group.name}: "${text}"`)
            }

            // Gap between comments
            await R.sleepRange(10000, 30000)
          } catch (err) {
            console.warn(`[CAMPAIGN-NURTURE] Comment failed: ${err.message}`)
          }
        }
      }

      // Gap between groups
      if (groupsToVisit.indexOf(group) < groupsToVisit.length - 1) {
        await R.sleepRange(30000, 60000)
      }
    }

    console.log(`[CAMPAIGN-NURTURE] Done: ${totalLikes} likes, ${totalComments} comments in ${groupsToVisit.length} groups`)
    return {
      success: true,
      groups_visited: groupsToVisit.length,
      likes: totalLikes,
      comments: totalComments,
    }
  } catch (err) {
    if (page) await saveDebugScreenshot(page, `campaign-nurture-${account_id}`)
    throw err
  } finally {
    if (page) await page.goto('about:blank', { timeout: 3000 }).catch(() => {})
    releaseSession(account_id)
  }
}

module.exports = campaignNurture
