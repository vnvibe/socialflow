/**
 * Comment on a Facebook post handler
 * Navigates to post URL, finds comment box, types comment, submits
 */
const { getPage, releaseSession } = require('../../browser/session-pool')
const { delay, humanBrowse, humanMouseMove } = require('../../browser/human')
const { checkAccountStatus, saveDebugScreenshot } = require('./post-utils')

// Lỗi do điều kiện tạm thời → có thể retry
function isRetryable(err) {
  const msg = err.message || ''
  return (
    msg.includes('Could not find comment input') ||
    msg.includes('timeout') ||
    msg.includes('Timeout') ||
    msg.includes('not focused') ||
    msg.includes('Element is not attached')
  )
}

async function commentPostHandler(payload, supabase) {
  const { account_id, post_url, fb_post_id, comment_text, source_name, job_id } = payload

  if (!account_id || !comment_text) throw new Error('account_id and comment_text required')
  if (!post_url && !fb_post_id) throw new Error('post_url or fb_post_id required')

  const { data: account } = await supabase
    .from('accounts')
    .select('*, proxies(*)')
    .eq('id', account_id)
    .single()

  if (!account) throw new Error('Account not found')

  // Find comment_log: ưu tiên match theo job_id (retry tạo job mới), fallback theo fb_post_id
  const ownerId = account.owner_id
  let commentLogQuery = supabase.from('comment_logs').select('id').eq('owner_id', ownerId).eq('account_id', account_id)
  if (job_id) {
    commentLogQuery = commentLogQuery.eq('job_id', job_id)
  } else {
    commentLogQuery = commentLogQuery.eq('fb_post_id', fb_post_id).eq('status', 'pending')
  }
  const { data: commentLogs } = await commentLogQuery.order('created_at', { ascending: false }).limit(1)
  const commentLogId = commentLogs?.[0]?.id

  const MAX_RETRIES = 2
  let lastErr = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      console.log(`[COMMENT-POST] Retry ${attempt}/${MAX_RETRIES} sau ${attempt * 5}s...`)
      await delay(attempt * 5000, attempt * 5000 + 2000)
    }

  let browserPage
  try {
    const session = await getPage(account)
    browserPage = session.page

    let targetUrl = post_url || `https://www.facebook.com/${fb_post_id}`

    // Validate URL — prevent commenting on group wall instead of specific post
    const isGroupUrl = /^https:\/\/www\.facebook\.com\/groups\/[^/]+\/?$/.test(targetUrl)
    if (isGroupUrl) {
      // Try to build URL from fb_post_id
      if (fb_post_id && !fb_post_id.startsWith('mobile_') && /^\d+$/.test(fb_post_id)) {
        const gMatch = targetUrl.match(/groups\/([^/?]+)/)
        if (gMatch) {
          targetUrl = `https://www.facebook.com/groups/${gMatch[1]}/posts/${fb_post_id}/`
          console.log(`[COMMENT-POST] Fixed group URL → ${targetUrl}`)
        } else {
          throw new Error('post_url is group URL without specific post — cannot comment safely')
        }
      } else {
        throw new Error('post_url is group URL without valid post ID — cannot comment safely')
      }
    }

    console.log(`[COMMENT-POST] Navigating to: ${targetUrl}`)

    await browserPage.goto(targetUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    })
    await delay(3000, 5000)

    // Verify we are on a single post page, not a group feed
    const pageUrl = browserPage.url()
    if (/\/groups\/[^/]+\/?(\?|$)/.test(pageUrl) && !pageUrl.includes('/posts/') && !pageUrl.includes('/permalink/')) {
      throw new Error('Navigated to group feed instead of single post — aborting to prevent wall post')
    }

    // Check for "content not available" page
    const pageText = await browserPage.evaluate(() => document.body?.innerText?.substring(0, 200) || '')
    if (pageText.includes('không xem được') || pageText.includes('not available') || pageText.includes('content isn')) {
      throw new Error('Post not available — may be deleted or restricted')
    }

    // Check checkpoint
    const status = await checkAccountStatus(browserPage, supabase, account_id)
    if (status.blocked) {
      throw new Error(`Account blocked: ${status.detail}`)
    }

    // Simulate reading the post before commenting — like a real person
    await humanMouseMove(browserPage)
    await delay(1500, 3000)
    // Scroll down slightly to read the full post
    await browserPage.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 300 + 100)))
    await delay(2000, 4000)
    // Random mouse move while "reading"
    await humanMouseMove(browserPage)
    await delay(1000, 2000)

    // Scroll down to load comments section
    await browserPage.evaluate(() => window.scrollBy(0, Math.floor(window.innerHeight * 0.6)))
    await delay(2000, 3000)

    // Find and click the comment input area
    console.log('[COMMENT-POST] Looking for comment box...')

    // Selectors for the ACTIVE Lexical editor (contenteditable) — priority order
    const activeBoxSelectors = [
      'div[data-lexical-editor="true"][contenteditable="true"]',
      'div[contenteditable="true"][aria-label*="bình luận" i]',
      'div[contenteditable="true"][aria-label*="comment" i]',
      'div[contenteditable="true"][aria-label*="Write" i]',
      'div[contenteditable="true"][aria-label*="Viết" i]',
      'div[contenteditable="true"][role="textbox"]',
    ]

    // Placeholder trigger selectors — clicking these activates the Lexical editor
    const placeholderSelectors = [
      // Non-hidden aria-label targets
      'div[aria-label="Viết bình luận"]:not([aria-hidden="true"])',
      'div[aria-label="Write a comment"]:not([aria-hidden="true"])',
      'div[aria-label="Leave a comment"]:not([aria-hidden="true"])',
      // Generic comment action area
      '[data-testid="comment-composer"]',
      'form[method="post"] [role="textbox"]',
    ]

    async function findActiveCommentBox() {
      for (const sel of activeBoxSelectors) {
        try {
          const el = await browserPage.$(sel)
          if (el) {
            // Confirm it's visible (not in a collapsed/hidden reply thread)
            const visible = await el.isVisible().catch(() => false)
            if (visible) {
              console.log(`[COMMENT-POST] Found comment box: ${sel}`)
              return el
            }
          }
        } catch {}
      }
      return null
    }

    let commentBox = await findActiveCommentBox()

    if (!commentBox) {
      // Try clicking placeholder to activate the Lexical editor
      console.log('[COMMENT-POST] No active box — clicking placeholder to activate...')
      for (const sel of placeholderSelectors) {
        try {
          const trigger = await browserPage.$(sel)
          if (trigger) {
            await trigger.scrollIntoViewIfNeeded()
            await trigger.click({ timeout: 5000 })
            await delay(1500, 2500)
            console.log(`[COMMENT-POST] Clicked placeholder: ${sel}`)
            break
          }
        } catch {}
      }

      // Scroll a bit more and re-search
      await browserPage.evaluate(() => window.scrollBy(0, 300))
      await delay(1000, 2000)
      commentBox = await findActiveCommentBox()
    }

    if (!commentBox) {
      // Last resort: try pressing Tab or clicking near comment area to trigger focus
      try {
        await browserPage.keyboard.press('Tab')
        await delay(800, 1200)
        commentBox = await findActiveCommentBox()
      } catch {}
    }

    if (!commentBox) {
      try { await saveDebugScreenshot(browserPage, `comment-no-box-${account_id}`) } catch {}
      throw new Error('Could not find comment input box')
    }

    // Scroll into view and focus via JS (avoid Playwright actionability timeout)
    await commentBox.scrollIntoViewIfNeeded().catch(() => {})
    await delay(300, 600)

    // Use JS focus + click — bypasses overlay/actionability issues
    await browserPage.evaluate(el => {
      el.scrollIntoView({ block: 'center' })
      el.focus()
      el.click()
    }, commentBox)
    await delay(500, 1000)

    // Verify focus — fallback to Playwright click if JS didn't work
    const isFocused = await browserPage.evaluate(
      el => document.activeElement === el || el.contains(document.activeElement),
      commentBox
    ).catch(() => false)
    if (!isFocused) {
      console.log('[COMMENT-POST] JS focus failed, trying Playwright click...')
      try {
        await commentBox.click({ timeout: 5000, force: true })
      } catch {
        await browserPage.evaluate(el => el.focus(), commentBox)
      }
      await delay(300, 600)
    }

    // Type comment with human-like delays
    console.log(`[COMMENT-POST] Typing comment (${comment_text.length} chars)...`)
    for (const char of comment_text) {
      await browserPage.keyboard.type(char, { delay: Math.random() * 80 + 30 })
    }
    await delay(1000, 2000)

    // Submit with Enter
    console.log('[COMMENT-POST] Submitting comment...')
    await browserPage.keyboard.press('Enter')

    // Wait for comment to appear — like a real person checking their comment posted
    await delay(3000, 5000)

    // Scroll slightly to see the comment area
    await browserPage.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 150 + 50)))
    await delay(1500, 3000)

    // Random mouse movement — looking at the posted comment
    await humanMouseMove(browserPage)
    await delay(2000, 4000)

    // Sometimes scroll back up a bit, like re-reading the post
    if (Math.random() < 0.4) {
      await browserPage.evaluate(() => window.scrollBy(0, -Math.floor(Math.random() * 100 + 30)))
      await delay(1000, 2000)
    }

    // Final pause before leaving — like lingering on the page
    await delay(2000, 4000)

    // Update comment_log status to done (scope by owner_id)
    if (commentLogId) {
      await supabase.from('comment_logs').update({
        status: 'done',
        finished_at: new Date().toISOString(),
      }).eq('id', commentLogId).eq('owner_id', ownerId)
    }

    console.log(`[COMMENT-POST] Success! Commented on ${source_name || fb_post_id}`)

    return {
      success: true,
      fb_post_id,
      source_name,
      comment_length: comment_text.length,
      attempts: attempt + 1,
    }

  } catch (err) {
    lastErr = err
    console.error(`[COMMENT-POST] Attempt ${attempt + 1} failed: ${err.message}`)

    // Debug screenshot (best effort)
    if (browserPage) {
      try { await saveDebugScreenshot(browserPage, `comment-error-${account_id}-attempt${attempt}`) } catch {}
    }

  } finally {
    if (browserPage) await browserPage.goto('about:blank', { timeout: 3000 }).catch(() => {})
    releaseSession(account_id)
  }

  // Nếu không retryable → dừng ngay
  if (!isRetryable(lastErr)) break
  } // end retry loop

  // Tất cả attempts đều thất bại
  if (commentLogId) {
    await supabase.from('comment_logs').update({
      status: 'failed',
      error_message: lastErr.message.substring(0, 500),
      finished_at: new Date().toISOString(),
    }).eq('id', commentLogId).eq('owner_id', ownerId).catch(() => {})
  }

  throw lastErr
}

module.exports = commentPostHandler
