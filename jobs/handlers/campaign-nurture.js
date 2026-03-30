/**
 * Campaign Handler: Nurture Group (Role: nurture)
 * Visit joined groups, like posts, leave natural comments
 * Uses desktop Facebook with JS-based interaction (bypasses overlay interception)
 * Comments use mobile Facebook URL per-post (proven in comment-post.js)
 */

const { getPage, releaseSession } = require('../../browser/session-pool')
const { delay, humanScroll, humanMouseMove } = require('../../browser/human')
const { checkAccountStatus, saveDebugScreenshot } = require('./post-utils')
const { checkHardLimit, SessionTracker, applyAgeFactor } = require('../../lib/hard-limits')
const R = require('../../lib/randomizer')
const { getActionParams } = require('../../lib/plan-executor')
const { generateComment } = require('../../lib/ai-comment')
const { getSelectors, toMobileUrl, COMMENT_INPUT_SELECTORS, COMMENT_SUBMIT_SELECTORS, COMMENT_LINK_SELECTORS } = require('../../lib/mobile-selectors')
const { ActivityLogger } = require('../../lib/activity-logger')

async function campaignNurture(payload, supabase) {
  const { account_id, campaign_id, role_id, topic: rawTopic, config, read_from, parsed_plan } = payload
  const startTime = Date.now()

  // Build full topic from: plan keywords + topic field + requirement
  // This ensures AI filter + keyword fallback use ALL relevant terms
  const planKeywords = (Array.isArray(parsed_plan) ? parsed_plan : [])
    .flatMap(s => s.params?.keywords || [])
    .filter(Boolean)
  const topicParts = [rawTopic, ...planKeywords].filter(Boolean)
  const topic = [...new Set(topicParts.map(t => t.trim().toLowerCase()))].join(', ') || rawTopic

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

  const tracker = new SessionTracker()
  const nickAge = Math.floor((Date.now() - new Date(account.created_at).getTime()) / 86400000)

  const likeCheck = checkHardLimit('like', likeBudget.used, 0)
  const commentCheck = checkHardLimit('comment', commentBudget.used, 0)

  // Apply age factor for newer accounts
  const maxLikesSession = applyAgeFactor(likeCheck.remaining, nickAge)
  const maxCommentsSession = applyAgeFactor(commentCheck.remaining, nickAge)

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
    // Step 1: Priority — groups joined FOR THIS campaign (exact match via topic column)
    let dbQuery = supabase.from('fb_groups')
      .select('id, fb_group_id, name, url, member_count, topic, joined_via_campaign_id, ai_relevance')
      .eq('account_id', account_id)
      .or('is_blocked.is.null,is_blocked.eq.false') // exclude blocked groups

    if (topic && campaign_id) {
      // First try: groups joined by this campaign
      const { data: campaignGroups } = await dbQuery.eq('joined_via_campaign_id', campaign_id)
      if (campaignGroups?.length) {
        groups = campaignGroups
        console.log(`[NURTURE] Using ${groups.length} groups joined by this campaign`)
      }
    }

    // Step 2: If no campaign-specific groups, try topic-matched groups
    if (!groups.length) {
      const { data: allGroups } = await supabase.from('fb_groups')
        .select('id, fb_group_id, name, url, member_count, topic, joined_via_campaign_id, ai_relevance')
        .eq('account_id', account_id)
        .or('is_blocked.is.null,is_blocked.eq.false')

      if (!allGroups?.length) {
        // Không có nhóm nào — sẽ chạy scout bên dưới
      } else if (!topic) {
        groups = allGroups
        console.log(`[NURTURE] No topic filter — using all ${groups.length} groups`)
      } else {
        // DB topic match first (nhóm đã được tag topic khi join)
        const topicLower = topic.toLowerCase()
        const topicKeywords = topicLower.split(/[\s,]+/).filter(k => k.length > 2)
        const topicMatched = allGroups.filter(g => {
          if (!g.topic) return false
          const gt = g.topic.toLowerCase()
          return gt.includes(topicLower) || topicLower.includes(gt) || topicKeywords.some(kw => gt.includes(kw))
        })
        if (topicMatched.length > 0) {
          groups = topicMatched
          console.log(`[NURTURE] Found ${groups.length} groups with matching topic tag`)
        } else {
          // Fallback: AI filter
          try {
            const { filterRelevantGroups } = require('../../lib/ai-filter')
            const aiFiltered = await filterRelevantGroups(allGroups, topic, payload.owner_id, account_id, supabase)
            // Log AI filter decision to activity log
            const meta = aiFiltered._filterMeta || {}
            logger.log('ai_filter', {
              target_type: 'group', target_name: topic,
              result_status: aiFiltered.length > 0 ? 'success' : 'skipped',
              details: { ...meta, topic },
            })
            if (aiFiltered.length > 0) {
              groups = aiFiltered
              console.log(`[NURTURE] AI filtered ${aiFiltered.length}/${allGroups.length} groups for topic: ${topic}`)
            } else {
              console.log(`[NURTURE] AI says 0/${allGroups.length} groups match "${topic}" — skipping`)
            }
          } catch (err) {
            // AI unavailable — keyword fallback only
            const keywords = topic.toLowerCase().split(/[\s,]+/).filter(k => k.length > 2)
            const kwMatched = allGroups.filter(g => keywords.some(kw => (g.name || '').toLowerCase().includes(kw)))
            if (kwMatched.length > 0) {
              groups = kwMatched
              console.log(`[NURTURE] AI unavailable, using ${kwMatched.length} keyword-matched groups`)
            } else {
              console.log(`[NURTURE] No matching groups for "${topic}" — skipping`)
            }
          }
        }
      }
    }
  }

  // No groups → run scout inline if plan has join_group step
  if (!groups?.length && parsed_plan?.some(s => s.action === 'join_group')) {
    console.log(`[NURTURE] No groups joined — running inline scout for topic: ${topic}`)
    try {
      const discoverHandler = require('./campaign-discover-groups')
      const scoutResult = await discoverHandler(payload, supabase)
      console.log(`[NURTURE] Scout done: joined ${scoutResult.groups_joined} groups`)

      // Re-fetch + re-filter after scout
      const { data: newGroups } = await supabase
        .from('fb_groups')
        .select('id, fb_group_id, name, url, member_count, ai_relevance')
        .eq('account_id', account_id)

      if (topic && newGroups?.length) {
        try {
          const { filterRelevantGroups } = require('../../lib/ai-filter')
          groups = await filterRelevantGroups(newGroups, topic, payload.owner_id, account_id, supabase)
          console.log(`[NURTURE] Post-scout AI filtered: ${groups.length}/${newGroups.length}`)
        } catch {
          groups = newGroups || []
        }
      } else {
        groups = newGroups || []
      }
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

    // ─── Warm-up: browse feed naturally before doing actions ───
    const currentUrl = page.url()
    const needsWarmup = !currentUrl.includes('facebook.com') || currentUrl.includes('about:blank')
    if (needsWarmup) {
      console.log(`[NURTURE] Warming up nick: browsing feed...`)
      logger.log('visit_group', { target_type: 'feed', target_name: 'Warm-up browse', details: { phase: 'warmup' } })
      try {
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 })
        await R.sleepRange(3000, 6000)
        // Scroll feed naturally
        for (let s = 0; s < R.randInt(2, 4); s++) {
          await humanScroll(page)
          await R.sleepRange(2000, 4000)
        }
        await humanMouseMove(page)
        console.log(`[NURTURE] Warm-up done, starting campaign work`)
      } catch (err) {
        console.warn(`[NURTURE] Warm-up failed: ${err.message}`)
      }
    }

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

        // Language check — analyze first 8 posts + group description
        const groupAnalysis = await page.evaluate(() => {
          const articles = document.querySelectorAll('[role="article"]')
          let viPosts = 0, enPosts = 0, otherPosts = 0, totalPosts = 0
          const VI_DIACRITICS = /[àáảãạăắằẳẵặâấầẩẫậèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵđ]/gi
          const VI_WORDS = /\b(của|này|trong|không|được|những|cái|một|các|có|cho|với|đang|và|là|tôi|bạn|mình|anh|chị|em|ơi|nhé|nhỉ|vậy|sao|thế|gì|nào|ạ|ừ|rồi|cũng|nhưng|nên|vì|hỏi|bác|mấy|xin|giúp)\b/gi
          const CJK = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff\uac00-\ud7af]/g

          // Also check group description
          const descEl = document.querySelector('[data-testid="group-about-card"], [aria-label="Group description"]')
          const descText = descEl ? (descEl.innerText || '').substring(0, 200) : ''
          const descVi = (descText.match(VI_DIACRITICS) || []).length + (descText.match(VI_WORDS) || []).length
          const descIsVi = descVi > 3

          let translatedCount = 0
          for (const a of [...articles].slice(0, 8)) {
            const text = (a.innerText || '').substring(0, 500)
            if (text.length < 20) continue
            totalPosts++

            // CRITICAL: detect auto-translated posts (FB translates EN→VN for VN users)
            const isTranslated = /ẩn bản gốc|xem bản gốc|see original|translated from|đã dịch|bản dịch/i.test(text)
            if (isTranslated) {
              translatedCount++
              enPosts++ // translated = originally foreign language
              continue
            }

            const viDiacritics = (text.match(VI_DIACRITICS) || []).length
            const viWords = (text.match(VI_WORDS) || []).length
            const cjkChars = (text.match(CJK) || []).length

            if (cjkChars > 5) { otherPosts++; continue }
            if (viDiacritics > 3 || viWords > 3) { viPosts++; continue }
            enPosts++
          }

          // Strict: need MAJORITY of posts to be Vietnamese (>50%)
          const viRatio = totalPosts > 0 ? viPosts / totalPosts : 0
          let lang = 'unknown'
          if (viRatio > 0.5) lang = 'vi'          // >50% VN posts → Vietnamese
          else if (enPosts > viPosts) lang = 'en'  // more EN than VN → English
          else if (otherPosts > 0) lang = 'other'
          // Override: if description is clearly Vietnamese, give benefit of doubt
          if (lang !== 'vi' && descIsVi && viRatio >= 0.3) lang = 'vi'

          return { totalPosts, viPosts, enPosts, otherPosts, translatedCount, viRatio, lang, descIsVi }
        }).catch(() => ({ totalPosts: 0, viPosts: 0, enPosts: 0, otherPosts: 0, viRatio: 0, lang: 'unknown', descIsVi: false }))

        if (groupAnalysis.lang !== 'vi') {
          console.log(`[NURTURE] ⚠️ Skip group "${group.name}" — ${groupAnalysis.lang} (${groupAnalysis.viPosts}vi/${groupAnalysis.enPosts}en/${groupAnalysis.totalPosts}total, translated:${groupAnalysis.translatedCount || 0}, desc_vi:${groupAnalysis.descIsVi})`)
          logger.log('visit_group', { target_type: 'group', target_name: group.name, result_status: 'skipped',
            details: { reason: 'non_vietnamese_group', lang: groupAnalysis.lang, vi_posts: groupAnalysis.viPosts, en_posts: groupAnalysis.enPosts, total_posts: groupAnalysis.totalPosts } })

          // Auto-block non-Vietnamese group in DB (except manually added groups)
          try {
            await supabase.from('fb_groups')
              .update({ is_blocked: true, blocked_reason: `auto: ${groupAnalysis.lang} group (${groupAnalysis.viPosts}/${groupAnalysis.totalPosts} VN)` })
              .eq('fb_group_id', group.fb_group_id)
              .eq('account_id', account_id)
              .neq('added_by', 'manual') // never block manually added groups
            console.log(`[NURTURE] 🚫 Blocked "${group.name}" — won't visit again`)
          } catch {}

          result.errors.push(`blocked: ${groupAnalysis.lang} group`)
          groupResults.push(result)
          continue
        }

        // Topic relevance check — read first 3 posts, verify they relate to campaign topic
        if (topic) {
          const postSample = await page.evaluate(() => {
            const articles = document.querySelectorAll('[role="article"]')
            return [...articles].slice(0, 3).map(a => (a.innerText || '').substring(0, 200)).join(' | ')
          }).catch(() => '')

          if (postSample.length > 50) {
            const topicWords = topic.toLowerCase().split(/[\s,]+/).filter(w => w.length > 2)
            const sampleLower = postSample.toLowerCase()
            const matchCount = topicWords.filter(w => sampleLower.includes(w)).length
            if (matchCount === 0) {
              // No topic keywords found in any of first 3 posts → likely irrelevant group
              console.log(`[NURTURE] ⚠️ Skip "${group.name}" — no topic match in posts (topic: ${topic})`)
              logger.log('visit_group', { target_type: 'group', target_name: group.name, result_status: 'skipped',
                details: { reason: 'no_topic_match', topic, post_sample: postSample.substring(0, 100) } })
              // Block this group for this topic
              try {
                const prev = group.ai_relevance || {}
                const topicKey = topic.toLowerCase().trim().replace(/\s+/g, '_').slice(0, 50)
                prev[topicKey] = { relevant: false, score: 1, reason: 'posts_not_matching_topic', evaluated_at: new Date().toISOString() }
                await supabase.from('fb_groups').update({ ai_relevance: prev })
                  .eq('fb_group_id', group.fb_group_id).eq('account_id', account_id)
              } catch {}
              result.errors.push('skipped: posts not matching topic')
              groupResults.push(result)
              continue
            }
          }
        }

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
        if (likeCheck.allowed && tracker.get('like') < maxLikesSession) {
          const maxLikes = getActionParams(parsed_plan, 'like', { countMin: 3, countMax: 5 }).count
          let likesInGroup = 0

          // Find MAIN POST like buttons only (NOT comment like buttons)
          // Key: only look in article toolbar area, skip nested comment articles
          const likeableInfo = await page.evaluate(() => {
            const results = []
            const articles = document.querySelectorAll('[role="article"]')
            for (const article of [...articles].slice(0, 15)) {
              // Skip nested articles (comments inside posts)
              const parentArticle = article.parentElement?.closest('[role="article"]')
              if (parentArticle && parentArticle !== article) continue

              // Skip spam/ads: check post content
              const postBody = (article.querySelector('div[dir="auto"]')?.innerText || '').toLowerCase()
              const spamWords = ['inbox', 'liên hệ ngay', 'giảm giá', 'mua ngay', 'đặt hàng', 'chuyên cung cấp', 'dịch vụ giá rẻ']
              const spamScore = spamWords.filter(w => postBody.includes(w)).length
              if (spamScore >= 2) continue // skip spam posts

              // Find like button in toolbar area (not in comment sections)
              const toolbar = article.querySelector('[role="group"]')
              const searchArea = toolbar || article
              const allBtns = searchArea.querySelectorAll('[role="button"]')
              for (const btn of allBtns) {
                const label = btn.getAttribute('aria-label') || ''
                const text = (btn.innerText || '').trim()
                const pressed = btn.getAttribute('aria-pressed')
                if (
                  (/^(Like|Thích|Thich)$/i.test(label) || /^(Like|Thích|Thich)$/i.test(text)) &&
                  pressed !== 'true'
                ) {
                  // Extract post permalink from article (multiple strategies)
                  let postUrl = null
                  const selectors = [
                    'a[href*="/posts/"]', 'a[href*="/permalink/"]', 'a[href*="story_fbid"]',
                    'a[href*="/groups/"][role="link"]'
                  ]
                  for (const sel of selectors) {
                    if (postUrl) break
                    for (const link of article.querySelectorAll(sel)) {
                      const href = link.href || ''
                      if (href.match(/\/(posts|permalink)\/\d+/) || href.includes('story_fbid')) {
                        postUrl = href.split('?')[0]; break
                      }
                    }
                  }
                  // Extract engagement counts from article
                  let reactions = 0, commentCount = 0
                  const engText = article.innerText || ''
                  const reactMatch = engText.match(/(\d+[\d,.]*[KkMm]?)\s*(reactions?|lượt thích|người đã bày tỏ)/i)
                  if (reactMatch) {
                    let raw = reactMatch[1].replace(/[,.]/g, '')
                    if (/[Kk]/.test(raw)) reactions = Math.round(parseFloat(raw) * 1000)
                    else if (/[Mm]/.test(raw)) reactions = Math.round(parseFloat(raw) * 1000000)
                    else reactions = parseInt(raw) || 0
                  }
                  const cmtMatch = engText.match(/(\d+[\d,.]*)\s*(comments?|bình luận)/i)
                  if (cmtMatch) commentCount = parseInt(cmtMatch[1].replace(/[,.]/g, '')) || 0

                  results.push({ label, text, pressed, index: results.length, postUrl, reactions, commentCount })
                  btn.setAttribute('data-nurture-like', results.length - 1)
                }
              }
            }
            return results
          })

          result.posts_found = likeableInfo.length
          console.log(`[NURTURE] Found ${likeableInfo.length} likeable posts in DOM`)

          const likesToDo = Math.min(maxLikes, likeableInfo.length, maxLikesSession - tracker.get('like'))

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
              tracker.increment('like')
              await supabase.rpc('increment_budget', {
                p_account_id: account_id,
                p_action_type: 'like',
              })
              console.log(`[NURTURE] Liked #${totalLikes} (session: ${tracker.get('like')}/${maxLikesSession})`)
              logger.log('like', { target_type: 'group', target_id: group.fb_group_id, target_name: group.name, target_url: group.url, details: { post_url: likeableInfo[i]?.postUrl || null, reactions: likeableInfo[i]?.reactions || 0, comments: likeableInfo[i]?.commentCount || 0 } })

              // Human delay between likes (minGapSeconds: 2)
              await R.sleepRange(2000, 5000)
            } catch (err) {
              result.errors.push(`like: ${err.message}`)
            }
          }
          result.likes_done = likesInGroup
        }

        // ===== COMMENT ON POSTS (desktop — click comment button in feed) =====
        if (commentCheck.allowed && tracker.get('comment') < maxCommentsSession) {
          const maxComments = getActionParams(parsed_plan, 'comment', { countMin: 1, countMax: 2 }).count

          // Get already-commented post URLs for this account (dedup — never comment same post twice)
          const { data: prevComments } = await supabase
            .from('comment_logs')
            .select('post_url')
            .eq('account_id', account_id)
            .not('post_url', 'is', null)
            .order('created_at', { ascending: false })
            .limit(200)
          const commentedUrls = new Set((prevComments || []).map(c => c.post_url).filter(Boolean))

          // Extract ALL posts with content + tag comment buttons
          const commentableInfo = await page.evaluate(() => {
            const articles = document.querySelectorAll('[role="article"]')
            const results = []
            for (const article of [...articles].slice(0, 10)) {
              // Skip nested (comment articles)
              const parent = article.parentElement?.closest('[role="article"]')
              if (parent && parent !== article) continue

              // Extract post body
              let body = ''
              const bodyEl = article.querySelector('[data-ad-preview="message"], [data-ad-comet-preview="message"]')
              if (bodyEl) body = bodyEl.innerText.trim()
              if (!body || body.length < 10) {
                for (const d of article.querySelectorAll('div[dir="auto"]')) {
                  const t = d.innerText.trim()
                  if (t.length > body.length && t.length < 2000) body = t
                }
              }
              if (body.length < 10) continue

              // Extract author
              const authorEl = article.querySelector('a[role="link"] strong, h2 a, h3 a')
              const author = authorEl ? authorEl.textContent.trim() : ''

              // Extract post URL
              let postUrl = null
              for (const link of article.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]')) {
                const href = link.href || ''
                if (href.match(/\/(posts|permalink)\/\d+/) || href.includes('story_fbid')) {
                  postUrl = href.split('?')[0]; break
                }
              }

              // Check translated
              const isTranslated = /ẩn bản gốc|xem bản gốc|see original|đã dịch|bản dịch/i.test(article.innerText || '')

              // Tag comment button
              const toolbar = article.querySelector('[role="group"]') || article
              for (const btn of toolbar.querySelectorAll('[role="button"], a')) {
                const l = (btn.getAttribute('aria-label') || '').toLowerCase()
                const t = (btn.innerText || '').trim().toLowerCase()
                if (l.includes('comment') || l.includes('bình luận') || /^(comment|bình luận)$/i.test(t)) {
                  btn.setAttribute('data-nurture-comment', results.length)
                  break
                }
              }

              results.push({ index: results.length, postUrl, body: body.substring(0, 400), author, isTranslated })
            }
            return results
          })

          // Filter: skip translated, already commented, spam
          const eligible = commentableInfo.filter(p => {
            if (p.isTranslated) return false
            if (p.postUrl && commentedUrls.has(p.postUrl)) return false
            const lower = p.body.toLowerCase()
            const spamWords = ['inbox', 'liên hệ ngay', 'giảm giá', 'mua ngay', 'chuyên cung cấp']
            if (spamWords.filter(w => lower.includes(w)).length >= 2) return false
            return true
          })

          console.log(`[NURTURE] Extracted ${commentableInfo.length} posts, ${eligible.length} eligible for comment`)

          // === AI SELECTS which posts to comment ===
          let aiSelected = eligible
          if (eligible.length > 1) {
            try {
              const postList = eligible.map((p, i) =>
                `${i + 1}. [${p.author}] "${p.body.substring(0, 150)}"`
              ).join('\n')

              const { data: aiRes } = await axios.post(`${process.env.API_URL || 'http://localhost:3000'}/ai/generate`, {
                function_name: 'caption_gen',
                provider: 'deepseek',
                messages: [{
                  role: 'user',
                  content: `Nhóm Facebook: "${group.name}" | Chủ đề: ${topic}
Account ID: ${account_id.slice(0, 8)}

Danh sách bài viết:
${postList}

Chọn ${Math.min(maxComments, eligible.length)} bài ĐÁNG comment nhất.
Ưu tiên: bài HỎI câu hỏi, bài THẢO LUẬN, bài mới có ít comment.
Bỏ qua: bài quảng cáo, bài chỉ đăng link, bài không liên quan.
Trả về JSON array số thứ tự. VD: [1, 3]`
                }],
                max_tokens: 50,
                temperature: 0.1,
              }, {
                timeout: 10000,
                headers: {
                  'Content-Type': 'application/json',
                  ...(process.env.SUPABASE_SERVICE_ROLE_KEY && { Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` }),
                },
              })

              const text = aiRes?.text || aiRes?.result || ''
              const match = text.match(/\[[\d\s,]*\]/)
              if (match) {
                const indices = JSON.parse(match[0]).filter(i => i >= 1 && i <= eligible.length)
                aiSelected = indices.map(i => eligible[i - 1]).filter(Boolean)
                console.log(`[NURTURE] AI selected ${aiSelected.length}/${eligible.length} posts to comment:`)
                aiSelected.forEach(p => console.log(`  → [${p.author}] "${p.body.substring(0, 60)}..."`))
              }
            } catch (err) {
              console.warn(`[NURTURE] AI post selection failed: ${err.message}, using all eligible`)
            }
          }

          const commentsToDo = Math.min(maxComments, aiSelected.length, maxCommentsSession - tracker.get('comment'))
          console.log(`[NURTURE] Will comment on ${commentsToDo} posts`)

          let commented = 0
          for (const post of aiSelected) {
            if (commented >= commentsToDo) break

            try {
              const thisPostUrl = post.postUrl
              if (thisPostUrl && commentedUrls.has(thisPostUrl)) continue

              const commentBtn = await page.$(`[data-nurture-comment="${post.index}"]`)
              if (!commentBtn) continue

              // Post text already extracted during AI selection
              const postText = post.body || ''
              const postAuthor = post.author || ''

              // Final safety: skip if too short
              if (postText.length < 15) { continue }

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

              const commentResult = await generateComment({
                postText, groupName: group.name, topic,
                style: config?.comment_style || 'casual',
                userId: payload.owner_id,
                templates: config?.comment_templates,
              })
              const commentText = typeof commentResult === 'object' ? commentResult.text : commentResult
              const isAI = typeof commentResult === 'object' ? commentResult.ai : false

              await commentBox.click({ force: true, timeout: 5000 })
              await R.sleepRange(500, 1000)

              for (const char of commentText) {
                await page.keyboard.type(char, { delay: Math.random() * 80 + 30 })
              }
              await R.sleepRange(800, 1500)
              await page.keyboard.press('Enter')
              await R.sleepRange(2000, 4000)

              totalComments++
              tracker.increment('comment')
              result.comments_done++
              await supabase.rpc('increment_budget', { p_account_id: account_id, p_action_type: 'comment' })

              // Extract fb_post_id from URL for dedup
              const thisUrl = post.postUrl || null
              let fbPostId = null
              if (thisUrl) {
                const m = thisUrl.match(/(?:posts|permalink)\/(\d+)/) || thisUrl.match(/story_fbid=(\d+)/)
                if (m) fbPostId = m[1]
              }

              try {
                await supabase.from('comment_logs').insert({
                  owner_id: payload.owner_id || payload.created_by, account_id,
                  fb_post_id: fbPostId,
                  comment_text: commentText, source_name: group.name,
                  status: 'done', campaign_id,
                  ai_generated: isAI,
                  post_url: thisUrl,
                })
              } catch {}

              // Add to dedup set so same post won't be commented again this session
              if (thisUrl) commentedUrls.add(thisUrl)
              commented++

              console.log(`[NURTURE] Commented #${totalComments} (${isAI ? 'AI' : 'template'}): "${commentText.substring(0, 50)}..."`)
              logger.log('comment', { target_type: 'group', target_id: group.fb_group_id, target_name: group.name, target_url: group.url, details: { comment_text: commentText.substring(0, 200), post_url: thisUrl, ai_generated: isAI, post_author: postAuthor } })
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

      // Opportunistic friend request — if plan has send_friend_request, scan active members in this group
      const hasFriendTask = (parsed_plan || []).some(s => s.action === 'send_friend_request')
      const friendCheck = hasFriendTask ? tracker.check('friend_request', account.daily_budget?.friend_request?.used || 0) : { allowed: false }
      if (hasFriendTask && friendCheck.allowed && result.comments_done > 0) {
        try {
          // Extract commenters/likers from current page (people who interacted = active members)
          const activeMembers = await page.evaluate(() => {
            const members = []
            const seen = new Set()
            // Find profile links in comment sections and reaction lists
            const profileLinks = document.querySelectorAll('a[href*="facebook.com/"][role="link"]')
            for (const link of profileLinks) {
              const href = link.href || ''
              const match = href.match(/facebook\.com\/(?:profile\.php\?id=(\d+)|([a-zA-Z0-9._]+))/)
              if (!match) continue
              const uid = match[1] || match[2]
              if (!uid || seen.has(uid) || uid === 'groups' || uid === 'pages' || uid.length < 3) continue
              seen.add(uid)
              const name = (link.textContent || '').trim()
              if (name && name.length > 1 && name.length < 50) {
                members.push({ fb_user_id: uid, name, profile_url: href.split('?')[0] })
              }
            }
            return members.slice(0, 10) // max 10 candidates
          }).catch(() => [])

          if (activeMembers.length > 0) {
            const maxFR = Math.min(2, friendCheck.remaining) // max 2 opportunistic FR per group
            let frSent = 0
            for (const member of activeMembers.slice(0, maxFR + 2)) { // check a few extra in case some fail
              if (frSent >= maxFR) break
              try {
                // Check if already friends or already sent request
                const { data: existing } = await supabase.from('friend_request_log')
                  .select('id').eq('account_id', account_id).eq('target_fb_id', member.fb_user_id).limit(1)
                if (existing?.length) continue

                // Navigate to profile, find Add Friend button
                await page.goto(member.profile_url, { waitUntil: 'domcontentloaded', timeout: 15000 })
                await R.sleepRange(1500, 3000)

                let addBtn = await page.$('div[aria-label="Add friend"], div[aria-label="Thêm bạn bè"], div[aria-label="Add Friend"]')
                if (!addBtn) {
                  const loc = page.locator('div[role="button"]:has-text("Add friend"), div[role="button"]:has-text("Thêm bạn")').first()
                  if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) addBtn = await loc.elementHandle()
                }

                if (addBtn) {
                  await humanClick(page, addBtn)
                  await R.sleepRange(1000, 2500)
                  frSent++
                  tracker.increment('friend_request')
                  await supabase.rpc('increment_budget', { p_account_id: account_id, p_action_type: 'friend_request' })
                  await supabase.from('friend_request_log').insert({
                    account_id, campaign_id,
                    target_fb_id: member.fb_user_id, target_name: member.name,
                    target_profile_url: member.profile_url,
                    status: 'sent', sent_at: new Date(),
                  }).catch(() => {})
                  logger.log('friend_request', { target_type: 'profile', target_id: member.fb_user_id, target_name: member.name, target_url: member.profile_url })
                  console.log(`[NURTURE] 🤝 Friend request sent to ${member.name} (active in ${group.name})`)
                  await R.sleepRange(3000, 8000) // random gap between friend requests
                }
              } catch {}
            }
            if (frSent > 0) result.friends_sent = frSent
          }

          // Navigate back to group feed for next group
          if (activeMembers.length > 0) {
            await page.goto(`https://www.facebook.com/groups/${group.fb_group_id}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
            await R.sleepRange(1000, 2000)
          }
        } catch (frErr) {
          console.warn(`[NURTURE] Opportunistic FR failed: ${frErr.message}`)
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
    if (page) // Keep page on FB for session reuse
    releaseSession(account_id)
  }
}

module.exports = campaignNurture
