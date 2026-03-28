/**
 * Campaign Handler: Nurture Group (Role: nurture)
 * Visit joined groups, like posts, leave natural comments
 * Uses desktop Facebook with JS-based interaction (bypasses overlay interception)
 * Comments use mobile Facebook URL per-post (proven in comment-post.js)
 */

const { getPage, releaseSession } = require('../../browser/session-pool')
const { delay, humanScroll, humanMouseMove } = require('../../browser/human')
const { checkAccountStatus, saveDebugScreenshot } = require('./post-utils')
const { checkHardLimit } = require('../../lib/hard-limits')
const R = require('../../lib/randomizer')
const { getActionParams } = require('../../lib/plan-executor')
const { generateComment } = require('../../lib/ai-comment')
const { getSelectors, toMobileUrl, COMMENT_INPUT_SELECTORS, COMMENT_SUBMIT_SELECTORS, COMMENT_LINK_SELECTORS } = require('../../lib/mobile-selectors')
const { ActivityLogger } = require('../../lib/activity-logger')

async function campaignNurture(payload, supabase) {
  const { account_id, campaign_id, role_id, topic, config, read_from, parsed_plan } = payload
  const startTime = Date.now()

  // Activity logger — logs every action for AI analysis
  const logger = new ActivityLogger(supabase, {
    campaign_id, role_id, account_id,
    job_id: payload.job_id,
    owner_id: payload.owner_id || payload.created_by,
  })

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

  // Get groups — from target_queue (workflow chaining) or account's joined groups
  let groups = []
  if (read_from) {
    const { data: queueEntries } = await supabase
      .from('target_queue')
      .select('*')
      .eq('campaign_id', campaign_id)
      .eq('target_role_id', role_id)
      .eq('status', 'pending')
      .order('active_score', { ascending: false })
      .limit(5)

    if (queueEntries?.length) {
      const seen = new Set()
      for (const entry of queueEntries) {
        if (entry.source_group_name && !seen.has(entry.source_group_name)) {
          seen.add(entry.source_group_name)
          const { data: grp } = await supabase
            .from('fb_groups')
            .select('fb_group_id, name, url')
            .eq('account_id', account_id)
            .ilike('name', `%${entry.source_group_name}%`)
            .limit(1)
            .single()
          if (grp) groups.push(grp)
        }
      }
      if (groups.length > 0) {
        const ids = queueEntries.map(e => e.id)
        await supabase.from('target_queue').update({ status: 'done', processed_at: new Date() }).in('id', ids)
      }
      console.log(`[NURTURE] Got ${groups.length} groups from workflow queue`)
    }
  }

  if (!groups.length) {
    // Lấy groups của account — ưu tiên filter theo campaign topic
    const { data: dbGroups } = await supabase
      .from('fb_groups')
      .select('fb_group_id, name, url')
      .eq('account_id', account_id)

    if (topic && dbGroups?.length) {
      // Filter groups liên quan đến topic bằng keyword matching đơn giản
      const keywords = topic.toLowerCase().split(/[\s,]+/).filter(k => k.length > 2)
      const relevant = dbGroups.filter(g => {
        const name = (g.name || '').toLowerCase()
        return keywords.some(kw => name.includes(kw))
      })
      if (relevant.length > 0) {
        groups = relevant
        console.log(`[NURTURE] Filtered ${relevant.length}/${dbGroups.length} groups matching topic: ${topic}`)
      } else {
        // Nếu không match keyword nào → dùng AI filter (nếu có)
        try {
          const { filterRelevantGroups } = require('../../lib/ai-filter')
          const aiFiltered = await filterRelevantGroups(dbGroups, topic, payload.owner_id)
          if (aiFiltered.length > 0) {
            groups = aiFiltered
            console.log(`[NURTURE] AI filtered ${aiFiltered.length}/${dbGroups.length} groups for topic: ${topic}`)
          } else {
            console.log(`[NURTURE] No groups match topic "${topic}" — skipping to avoid visiting unrelated groups`)
          }
        } catch {
          console.log(`[NURTURE] No groups match topic "${topic}" — skipping`)
        }
      }
    } else {
      groups = dbGroups || []
    }
  }

  // If no groups and parsed_plan has join_group step → run scout inline first
  if (!groups?.length && parsed_plan?.some(s => s.action === 'join_group')) {
    console.log(`[NURTURE] No groups joined — running inline scout for topic: ${topic}`)
    try {
      const discoverHandler = require('./campaign-discover-groups')
      const scoutResult = await discoverHandler(payload, supabase)
      console.log(`[NURTURE] Scout done: joined ${scoutResult.groups_joined} groups`)

      // Re-fetch groups after scout
      const { data: newGroups } = await supabase
        .from('fb_groups')
        .select('fb_group_id, name, url')
        .eq('account_id', account_id)
      groups = newGroups || []
    } catch (err) {
      console.warn(`[NURTURE] Inline scout failed: ${err.message}`)
    }
  }

  if (!groups?.length) throw new Error('SKIP_no_groups_joined')

  const shuffled = groups.sort(() => Math.random() - 0.5)
  const groupsToVisit = shuffled.slice(0, R.randInt(1, Math.min(3, groups.length)))

  let page
  try {
    const session = await getPage(account)
    page = session.page

    let totalLikes = 0
    let totalComments = 0
    const groupResults = []

    for (const group of groupsToVisit) {
      const result = { group_name: group.name, posts_found: 0, likes_done: 0, comments_done: 0, errors: [] }

      try {
        // Stay on DESKTOP Facebook (cookies work, no login overlay)
        const groupUrl = (group.url || `https://www.facebook.com/groups/${group.fb_group_id}`)
          .replace('://m.facebook.com', '://www.facebook.com')
        console.log(`[NURTURE] Visiting: ${group.name || group.fb_group_id}`)
        logger.log('visit_group', { target_type: 'group', target_id: group.fb_group_id, target_name: group.name, target_url: groupUrl })

        await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        await R.sleepRange(2000, 4000)

        // Check for checkpoint/block
        const status = await checkAccountStatus(page, supabase, account_id)
        if (status.blocked) throw new Error(`Account blocked: ${status.detail}`)

        // Browse feed naturally — scroll to load posts
        await humanMouseMove(page)
        for (let s = 0; s < 4; s++) {
          await humanScroll(page)
          await R.sleepRange(1000, 2000)
        }

        // Debug: check page state and dump DOM info
        try {
          const debugInfo = await page.evaluate(() => {
            const articles = document.querySelectorAll('[role="article"]')
            const buttons = document.querySelectorAll('[role="button"]')
            const likeButtons = [...buttons].filter(b => {
              const l = (b.getAttribute('aria-label') || '').toLowerCase()
              const t = (b.innerText || '').trim().toLowerCase()
              return l.includes('like') || l.includes('thích') || t === 'like' || t === 'thích'
            })
            return {
              url: location.href,
              isLoggedIn: !!document.querySelector('[aria-label="Your profile"], [aria-label="Account"], [data-pagelet="ProfileActions"]'),
              articlesCount: articles.length,
              buttonsCount: buttons.length,
              likeButtonsCount: likeButtons.length,
              likeLabels: likeButtons.slice(0, 5).map(b => ({
                label: b.getAttribute('aria-label'),
                text: (b.innerText || '').trim().substring(0, 30),
                pressed: b.getAttribute('aria-pressed'),
              })),
              bodyText: (document.body?.innerText || '').substring(0, 200),
            }
          })
          const fs = require('fs')
          const debugPath = require('path').join(__dirname, '..', '..', 'debug', `nurture-dom-${Date.now()}.json`)
          fs.writeFileSync(debugPath, JSON.stringify(debugInfo, null, 2))
          console.log(`[NURTURE] DOM: ${debugInfo.articlesCount} articles, ${debugInfo.likeButtonsCount} like btns, logged=${debugInfo.isLoggedIn}, url=${debugInfo.url}`)
        } catch (e) { console.warn('[NURTURE] DOM debug failed:', e.message) }

        // ===== LIKE POSTS (desktop, JS-based) =====
        if (likeCheck.allowed && totalLikes < likeCheck.remaining) {
          const maxLikes = getActionParams(parsed_plan, 'like', { countMin: 3, countMax: 5 }).count
          let likesInGroup = 0

          // Use page.evaluate() to find like buttons via DOM inspection
          // This avoids Playwright selector issues with changing aria-labels
          const likeableInfo = await page.evaluate(() => {
            const results = []
            // Find all elements that act as like buttons
            // Strategy: look for the reaction toolbar in each post
            const articles = document.querySelectorAll('[role="article"]')
            for (const article of [...articles].slice(0, 15)) {
              // Find the action bar area (Like / Comment / Share row)
              const allBtns = article.querySelectorAll('[role="button"]')
              for (const btn of allBtns) {
                const label = btn.getAttribute('aria-label') || ''
                const text = (btn.innerText || '').trim()
                const pressed = btn.getAttribute('aria-pressed')
                // Match like button: aria-label contains Like/Thích, or text is exactly Like/Thích
                if (
                  (/^(Like|Thích|Thich)$/i.test(label) || /^(Like|Thích|Thich)$/i.test(text)) &&
                  pressed !== 'true'
                ) {
                  // Get a unique path to this element for re-selection
                  results.push({
                    label, text, pressed,
                    // Create a data-nurture-id for re-selection
                    index: results.length
                  })
                  btn.setAttribute('data-nurture-like', results.length - 1)
                }
              }
            }
            return results
          })

          result.posts_found = likeableInfo.length
          console.log(`[NURTURE] Found ${likeableInfo.length} likeable posts in DOM`)

          const likesToDo = Math.min(maxLikes, likeableInfo.length, likeCheck.remaining - totalLikes)

          for (let i = 0; i < likesToDo; i++) {
            try {
              // Re-find the button using the data attribute we set
              const btn = await page.$(`[data-nurture-like="${i}"]`)
              if (!btn) continue

              await btn.scrollIntoViewIfNeeded()
              await R.sleepRange(800, 1500)

              // Click using dispatchEvent for React compatibility
              await page.evaluate((idx) => {
                const el = document.querySelector(`[data-nurture-like="${idx}"]`)
                if (!el) return
                // Dispatch full mouse event sequence for React
                const rect = el.getBoundingClientRect()
                const x = rect.left + rect.width / 2
                const y = rect.top + rect.height / 2
                const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }
                el.dispatchEvent(new MouseEvent('mousedown', opts))
                el.dispatchEvent(new MouseEvent('mouseup', opts))
                el.dispatchEvent(new MouseEvent('click', opts))
              }, i)

              await R.sleepRange(1500, 2500)

              // Count as success — strict verification unreliable (FB re-renders)
              likesInGroup++
              totalLikes++
              await supabase.rpc('increment_budget', {
                p_account_id: account_id,
                p_action_type: 'like',
              })
              console.log(`[NURTURE] Liked #${totalLikes}`)
              logger.log('like', { target_type: 'group', target_id: group.fb_group_id, target_name: group.name })

              // Human delay between likes (minGapSeconds: 2)
              await R.sleepRange(2000, 5000)
            } catch (err) {
              result.errors.push(`like: ${err.message}`)
            }
          }
          result.likes_done = likesInGroup
        }

        // ===== COMMENT ON POSTS (desktop — click comment button in feed) =====
        if (commentCheck.allowed && totalComments < commentCheck.remaining) {
          const maxComments = getActionParams(parsed_plan, 'comment', { countMin: 1, countMax: 2 }).count

          // Find comment buttons in articles and tag them
          const commentableCount = await page.evaluate(() => {
            const articles = document.querySelectorAll('[role="article"]')
            let count = 0
            for (const article of [...articles].slice(0, 10)) {
              // Search all interactive elements (buttons, links, spans with role)
              const candidates = article.querySelectorAll('[role="button"], span[role], div[tabindex], a')
              for (const el of candidates) {
                const label = (el.getAttribute('aria-label') || '').toLowerCase()
                const text = (el.innerText || '').trim().toLowerCase()
                // Match broadly: comment, bình luận, leave/write a comment
                if (label.includes('comment') || label.includes('bình luận') ||
                    label.includes('leave a comment') || label.includes('write a comment') ||
                    /^(comment|bình luận)$/.test(text)) {
                  el.setAttribute('data-nurture-comment', count)
                  count++
                  break // one per article
                }
              }
            }
            return count
          })

          const commentsToDo = Math.min(maxComments, commentableCount, commentCheck.remaining - totalComments)
          console.log(`[NURTURE] Found ${commentableCount} commentable posts, will comment on ${commentsToDo}`)

          for (let i = 0; i < commentsToDo; i++) {
            try {
              const commentBtn = await page.$(`[data-nurture-comment="${i}"]`)
              if (!commentBtn) continue

              // Extract post text for AI
              let postText = ''
              try {
                postText = await page.evaluate((idx) => {
                  const btn = document.querySelector(`[data-nurture-comment="${idx}"]`)
                  const article = btn?.closest('[role="article"]')
                  return (article?.innerText || '').substring(0, 300)
                }, i)
              } catch {}

              await commentBtn.scrollIntoViewIfNeeded()
              await R.sleepRange(500, 1000)
              await commentBtn.click({ force: true, timeout: 5000 })
              await R.sleepRange(1500, 2500)

              // Find comment textbox (desktop contenteditable)
              const desktopCommentSels = [
                'div[contenteditable="true"][role="textbox"][aria-label*="comment" i]',
                'div[contenteditable="true"][role="textbox"][aria-label*="bình luận" i]',
                'div[contenteditable="true"][role="textbox"]',
              ]
              let commentBox = null
              for (const sel of desktopCommentSels) {
                try {
                  const els = await page.$$(sel)
                  for (const el of els) {
                    if (await el.isVisible().catch(() => false)) commentBox = el
                  }
                  if (commentBox) break
                } catch {}
              }

              if (!commentBox) {
                result.errors.push('comment: no comment box')
                continue
              }

              const commentText = await generateComment({
                postText, groupName: group.name, topic,
                style: config?.comment_style || 'casual',
                userId: payload.owner_id,
                templates: config?.comment_templates,
              })

              await commentBox.click({ force: true, timeout: 5000 })
              await R.sleepRange(500, 1000)

              for (const char of commentText) {
                await page.keyboard.type(char, { delay: Math.random() * 80 + 30 })
              }
              await R.sleepRange(800, 1500)
              await page.keyboard.press('Enter')
              await R.sleepRange(2000, 4000)

              totalComments++
              result.comments_done++
              await supabase.rpc('increment_budget', { p_account_id: account_id, p_action_type: 'comment' })

              try {
                await supabase.from('comment_logs').insert({
                  owner_id: payload.created_by, account_id,
                  comment_text: commentText, source_name: group.name,
                  status: 'done', campaign_id,
                })
              } catch {}

              console.log(`[NURTURE] Commented #${totalComments}: "${commentText.substring(0, 50)}..."`)
              logger.log('comment', { target_type: 'group', target_id: group.fb_group_id, target_name: group.name, details: { comment_text: commentText.substring(0, 200) } })
              await R.sleepRange(10000, 20000)
            } catch (err) {
              result.errors.push(`comment: ${err.message}`)
              logger.log('comment', { target_type: 'group', target_name: group.name, result_status: 'failed', details: { error: err.message } })
            }
          }
        }
      } catch (err) {
        console.warn(`[NURTURE] Group "${group.name}" failed: ${err.message}`)
        result.errors.push(`group: ${err.message}`)
        if (err.message.includes('blocked') || err.message.includes('checkpoint')) {
          if (page) await saveDebugScreenshot(page, `nurture-blocked-${account_id}`)
          throw err
        }
      }

      groupResults.push(result)

      if (groupsToVisit.indexOf(group) < groupsToVisit.length - 1) {
        await R.sleepRange(20000, 45000)
      }
    }

    // Screenshot if 0 results for debugging
    if (totalLikes === 0 && totalComments === 0 && page) {
      await saveDebugScreenshot(page, `nurture-zero-${account_id}`)
    }

    const duration = Math.round((Date.now() - startTime) / 1000)
    console.log(`[NURTURE] Done: ${totalLikes} likes, ${totalComments} comments in ${groupResults.length} groups (${duration}s)`)
    return {
      success: true,
      groups_visited: groupResults.length,
      likes: totalLikes,
      comments: totalComments,
      details: groupResults,
      duration_seconds: duration,
    }
  } catch (err) {
    if (page) await saveDebugScreenshot(page, `nurture-error-${account_id}`)
    throw err
  } finally {
    await logger.flush().catch(() => {})
    if (page) await page.goto('about:blank', { timeout: 3000 }).catch(() => {})
    releaseSession(account_id)
  }
}

module.exports = campaignNurture
