/**
 * Campaign Handler: Interact Profile (Role: connect)
 * Visit target profile, browse, like posts, optionally comment
 */

const { getPage, releaseSession } = require('../../browser/session-pool')
const { humanScroll, humanMouseMove, humanClick } = require('../../browser/human')
const { saveDebugScreenshot } = require('./post-utils')
const { checkHardLimit } = require('../../lib/hard-limits')
const R = require('../../lib/randomizer')

async function campaignInteractProfile(payload, supabase) {
  const { account_id, campaign_id, role_id, config } = payload
  const targetUrl = config?.target_url || config?.fb_profile_url
  const targetFbId = config?.target_fb_id

  if (!targetUrl && !targetFbId) throw new Error('SKIP_no_target_profile')

  const { data: account } = await supabase
    .from('accounts')
    .select('*, proxies(*)')
    .eq('id', account_id)
    .single()
  if (!account) throw new Error('Account not found')

  const likeBudget = account.daily_budget?.like || { used: 0, max: 80 }
  const likeCheck = checkHardLimit('like', likeBudget.used, 0)

  let page
  try {
    const session = await getPage(account)
    page = session.page

    const profileUrl = targetUrl || `https://www.facebook.com/profile.php?id=${targetFbId}`
    console.log(`[CAMPAIGN-INTERACT] Visiting profile: ${profileUrl}`)
    await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
    await R.sleepRange(2000, 4000)

    // Browse naturally — simulate reading profile
    await humanMouseMove(page)
    await R.sleepRange(1000, 2000)
    await humanScroll(page)
    await R.sleepRange(1500, 3000)
    await humanScroll(page)
    await R.sleepRange(1000, 2000)

    let liked = 0
    let commented = 0

    // Like some posts
    if (likeCheck.allowed) {
      const maxLikes = R.randInt(2, 5)
      const likeButtons = await page.$$([
        'div[aria-label="Like"]',
        'div[aria-label="Thích"]',
        'div[aria-label="Thich"]',
      ].join(', '))

      const likesToDo = Math.min(maxLikes, likeButtons.length, likeCheck.remaining)

      for (let i = 0; i < likesToDo; i++) {
        try {
          const btn = likeButtons[i]
          const pressed = await btn.getAttribute('aria-pressed').catch(() => null)
          if (pressed === 'true') continue

          await btn.scrollIntoViewIfNeeded()
          await R.sleepRange(500, 1500)
          await btn.click()
          liked++

          await supabase.rpc('increment_budget', {
            p_account_id: account_id,
            p_action_type: 'like',
          })

          await R.sleepRange(3000, 8000)
        } catch (err) {
          // Skip individual errors
        }
      }
    }

    // Optionally comment if config says so
    if (config?.should_comment) {
      const commentBudget = account.daily_budget?.comment || { used: 0, max: 25 }
      const commentCheck = checkHardLimit('comment', commentBudget.used, 0)

      if (commentCheck.allowed) {
        const commentBtn = await page.$([
          'div[aria-label="Leave a comment"]',
          'div[aria-label="Viết bình luận"]',
          'div[aria-label="Comment"]',
          'div[aria-label="Bình luận"]',
        ].join(', '))

        if (commentBtn) {
          try {
            await commentBtn.scrollIntoViewIfNeeded()
            await R.sleepRange(500, 1000)
            await commentBtn.click()
            await R.sleepRange(1000, 2000)

            const commentBox = await page.$('div[contenteditable="true"][role="textbox"]')
            if (commentBox) {
              const templates = config?.comment_templates || ['👍', 'Hay quá!', 'Nice!', '❤️']
              const text = templates[Math.floor(Math.random() * templates.length)]

              await commentBox.click()
              await R.sleepRange(300, 800)
              for (const char of text) {
                await page.keyboard.type(char)
                await R.sleep(R.keyDelay())
              }
              await R.sleepRange(500, 1000)
              await page.keyboard.press('Enter')
              await R.sleepRange(1000, 2000)

              commented++
              await supabase.rpc('increment_budget', {
                p_account_id: account_id,
                p_action_type: 'comment',
              })
            }
          } catch (err) {
            console.warn(`[CAMPAIGN-INTERACT] Comment failed: ${err.message}`)
          }
        }
      }
    }

    console.log(`[CAMPAIGN-INTERACT] Done: ${liked} likes, ${commented} comments on profile`)
    return {
      success: true,
      profile_url: profileUrl,
      likes: liked,
      comments: commented,
    }
  } catch (err) {
    if (page) await saveDebugScreenshot(page, `campaign-interact-${account_id}`)
    throw err
  } finally {
    if (page) await page.goto('about:blank', { timeout: 3000 }).catch(() => {})
    releaseSession(account_id)
  }
}

module.exports = campaignInteractProfile
