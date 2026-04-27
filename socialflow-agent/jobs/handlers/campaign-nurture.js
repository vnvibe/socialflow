/**
 * Campaign Handler: Nurture Group (Role: nurture)
 * Visit joined groups, like posts, leave natural comments
 * Uses desktop Facebook with JS-based interaction (bypasses overlay interception)
 * Comments use mobile Facebook URL per-post (proven in comment-post.js)
 */

const { getPage, releaseSession } = require('../../browser/session-pool')
const { delay, humanScroll, humanMouseMove } = require('../../browser/human')
const { checkAccountStatus, saveDebugScreenshot } = require('./post-utils')
const { checkHardLimit, SessionTracker, applyAgeFactor, getNickAgeDays } = require('../../lib/hard-limits')
const R = require('../../lib/randomizer')
const { getActionParams } = require('../../lib/plan-executor')
const { generateComment, generateOpportunityComment } = require('../../lib/ai-comment')
const { evaluatePosts, qualityGateComment, generateSmartComment, evaluateLeadQuality, scanGroupPosts, getBestPosts, detectGroupLanguage } = require('../../lib/ai-brain')
const { getSelectors, toMobileUrl, COMMENT_INPUT_SELECTORS, COMMENT_SUBMIT_SELECTORS, COMMENT_LINK_SELECTORS } = require('../../lib/mobile-selectors')
const { ActivityLogger } = require('../../lib/activity-logger')

// Group visit rate limit — max 2 nicks per group per 30 min (module-level cache)
const groupVisitCache = new Map() // groupFbId → [{accountId, timestamp}]
const GROUP_VISIT_WINDOW = 30 * 60 * 1000 // 30 min

// === Group performance tracking helpers ===
async function recordGroupSkip(supabase, accountId, fbGroupId) {
  if (!supabase || !fbGroupId) return
  try {
    // Increment consecutive_skips, fetch new value
    const { data: cur } = await supabase.from('fb_groups')
      .select('consecutive_skips')
      .eq('account_id', accountId).eq('fb_group_id', fbGroupId).single()
    const next = (cur?.consecutive_skips || 0) + 1
    await supabase.from('fb_groups')
      .update({ consecutive_skips: next })
      .eq('account_id', accountId).eq('fb_group_id', fbGroupId)
  } catch {}
}

async function recordGroupYield(supabase, accountId, fbGroupId, eligibleCount) {
  if (!supabase || !fbGroupId) return
  try {
    const { data: cur } = await supabase.from('fb_groups')
      .select('total_yields')
      .eq('account_id', accountId).eq('fb_group_id', fbGroupId).single()
    await supabase.from('fb_groups')
      .update({
        consecutive_skips: 0, // reset
        last_yield_at: new Date().toISOString(),
        total_yields: (cur?.total_yields || 0) + eligibleCount,
      })
      .eq('account_id', accountId).eq('fb_group_id', fbGroupId)
  } catch {}
}
const GROUP_VISIT_MAX = 2

function canVisitGroup(groupFbId, accountId) {
  const now = Date.now()
  const visits = (groupVisitCache.get(groupFbId) || []).filter(v => now - v.timestamp < GROUP_VISIT_WINDOW)
  groupVisitCache.set(groupFbId, visits)
  // Own visit doesn't count against limit
  const otherVisits = visits.filter(v => v.accountId !== accountId)
  return otherVisits.length < GROUP_VISIT_MAX
}

function recordGroupVisit(groupFbId, accountId) {
  const visits = groupVisitCache.get(groupFbId) || []
  visits.push({ accountId, timestamp: Date.now() })
  groupVisitCache.set(groupFbId, visits)
}

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
  const nickAge = getNickAgeDays(account)

  const likeCheck = checkHardLimit('like', likeBudget.used, 0)
  const commentCheck = checkHardLimit('comment', commentBudget.used, 0)

  // Phase 1+2: load campaign.language for filtering + scoring
  let campaignLanguage = 'vi'
  if (campaign_id) {
    try {
      const { data: _cl } = await supabase.from('campaigns').select('language').eq('id', campaign_id).single()
      if (_cl?.language) campaignLanguage = _cl.language
    } catch {}
  }

  // ── Ad config: load brand settings for opportunity comments ──
  // Brand config: prefer top-level brand_config (from new SaaS form),
  // fall back to legacy config.advertising shape
  const brandConfig = payload.brand_config || config?.brand_config || config?.advertising || null
  const adEnabled = brandConfig && (payload.ad_mode === 'ad_enabled' || config?.ad_mode === 'ad_enabled' || brandConfig.brand_name)
  const canDoAdComment = adEnabled && nickAge >= 30 // warmup >= 30 days required

  // Count today's ad comments for this nick (max 2/day)
  let adCommentsToday = 0
  if (canDoAdComment) {
    try {
      const vnToday = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
      const { count } = await supabase
        .from('campaign_activity_log')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', account_id)
        .eq('action_type', 'opportunity_comment')
        .gte('created_at', vnToday + 'T00:00:00+07:00')
      adCommentsToday = count || 0
    } catch {}
  }
  const AD_COMMENT_DAILY_LIMIT = 2

  // Apply age factor for newer accounts
  const maxLikesSession = applyAgeFactor(likeCheck.remaining, nickAge)
  const maxCommentsSession = applyAgeFactor(commentCheck.remaining, nickAge)

  if (!likeCheck.allowed && !commentCheck.allowed) {
    throw new Error('SKIP_nurture_budget_exceeded')
  }

  // Get groups — from target_queue (workflow chaining) or account's joined groups
  let groups = []

  // Hermes orchestrator (post-2026-04-25 social_graph_spreader) may pin a
  // specific group via payload.group_id. Honor it FIRST so the spreader's
  // allocation strategy (no two nicks on same group within 45min) holds.
  // Without this, the agent would pick from the junction and break the
  // graph isolation that prevents FB cluster detection.
  if (payload.group_id) {
    const { data: pinnedRow } = await supabase
      .from('fb_groups')
      .select('id, fb_group_id, name, url, member_count, topic, tags, joined_via_campaign_id, ai_relevance, user_approved, consecutive_skips, last_yield_at, total_yields, language, score_tier, engagement_rate, ai_join_score, is_member, pending_approval, is_blocked, global_score')
      .eq('id', payload.group_id)
      .single()
    if (pinnedRow && pinnedRow.is_member && !pinnedRow.pending_approval && !pinnedRow.is_blocked && pinnedRow.user_approved !== false) {
      groups = [pinnedRow]
      console.log(`[NURTURE] Hermes-pinned group: ${pinnedRow.name} (spreader allocation)`)
    } else if (pinnedRow) {
      console.warn(`[NURTURE] Hermes pinned group ${payload.group_id} (${pinnedRow.name}) but failed gate (member=${pinnedRow.is_member} pending=${pinnedRow.pending_approval} blocked=${pinnedRow.is_blocked}) — falling back to junction`)
    } else {
      console.warn(`[NURTURE] Hermes pinned group ${payload.group_id} not found in fb_groups — falling back`)
    }
  }

  if (!groups.length && read_from) {
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

  if (!groups.length && campaign_id) {
    // Phase 9: read groups via campaign_groups junction (campaign-scoped, per-nick assigned)
    const { data: junctionRows } = await supabase
      .from('campaign_groups')
      .select('id, score, tier, status, last_nurtured_at, fb_groups!inner(id, fb_group_id, name, url, member_count, topic, tags, joined_via_campaign_id, ai_relevance, user_approved, consecutive_skips, last_yield_at, total_yields, language, score_tier, engagement_rate, ai_join_score, is_member, pending_approval, is_blocked, global_score)')
      .eq('campaign_id', campaign_id)
      .eq('assigned_nick_id', account_id)
      .eq('status', 'active')
    // Flatten: keep one row per group with junction fields merged
    const junctionGroups = (junctionRows || [])
      .map(r => r.fb_groups && ({
        ...r.fb_groups,
        // Junction tier/score take precedence over global fb_groups values
        score_tier: r.tier || r.fb_groups.score_tier,
        _junction_id: r.id,
        _junction_score: r.score,
        _junction_tier: r.tier,
        _junction_last_nurtured: r.last_nurtured_at,
      }))
      .filter(Boolean)
      // Still enforce membership gates (junction status can lag)
      .filter(g => g.is_member === true && g.pending_approval === false)
      .filter(g => !g.is_blocked)
      .filter(g => g.user_approved !== false)
    if (junctionGroups.length > 0) {
      groups = junctionGroups
      console.log(`[NURTURE] Phase 9: ${groups.length} groups from campaign_groups junction (nick ${account_id.slice(0,8)})`)
    }
  }

  if (!groups.length) {
    // Legacy fallback: fb_groups direct query (old campaigns without junction backfill)
    const { data: labeledGroups } = await supabase.from('fb_groups')
      .select('id, fb_group_id, name, url, member_count, topic, tags, joined_via_campaign_id, ai_relevance, user_approved, consecutive_skips, last_yield_at, total_yields, language, score_tier, engagement_rate, ai_join_score, is_member, pending_approval')
      .eq('account_id', account_id)
      .eq('is_member', true)
      .eq('pending_approval', false)
      .or('is_blocked.is.null,is_blocked.eq.false')
      .or('user_approved.is.null,user_approved.eq.true')

    const allLabeled = (labeledGroups || []).filter(g => {
      // Phase 2: skip tier D entirely (low-quality groups)
      if (g.score_tier === 'D') return false
      // Group phải có ÍT NHẤT 1 trong: tags, topic, campaign_id
      const hasTags = g.tags?.length > 0
      const hasTopic = g.topic && g.topic.trim().length > 0
      const hasCampaign = g.joined_via_campaign_id
      return hasTags || hasTopic || hasCampaign
    })

    if (!allLabeled.length) {
      console.log(`[NURTURE] Không có group nào được gán nhãn — cần scout trước`)
    } else if (!topic) {
      groups = allLabeled
      console.log(`[NURTURE] Dùng ${groups.length} groups đã gán nhãn (không có topic filter)`)
    } else {
      const topicLower = topic.toLowerCase()
      const topicKeywords = topicLower.split(/[\s,]+/).filter(k => k.length > 2)

      // Filter: chỉ group match topic qua tags/topic field/campaign
      groups = allLabeled.filter(g => {
        // Match qua tags
        if (g.tags?.some(tag => topicKeywords.some(kw => tag.toLowerCase().includes(kw) || kw.includes(tag.toLowerCase())))) return true
        // Match qua topic field
        if (g.topic) {
          const gt = g.topic.toLowerCase()
          if (gt.includes(topicLower) || topicLower.includes(gt) || topicKeywords.some(kw => gt.includes(kw))) return true
        }
        // Match qua campaign
        if (g.joined_via_campaign_id === campaign_id) return true
        // AI cache approved
        const topicKey = topicLower.trim().replace(/\s+/g, '_').slice(0, 50)
        const cached = g.ai_relevance?.[topicKey]
        if (cached?.relevant && cached.score >= 5) return true
        return false
      })

      console.log(`[NURTURE] ${groups.length}/${allLabeled.length} groups gán nhãn match topic "${topic}"`)
    }

    // ── SMART ROTATION: ưu tiên group có score cao + recent yield ──
    // Score-based sort: tier1 (>=8) → tier2 (5-7) → tier3 (<5)
    // Penalty: groups with consecutive_skips >= 2 đẩy xuống cuối
    if (groups.length > 1) {
      const topicKey = (topic || '').toLowerCase().trim().replace(/\s+/g, '_').slice(0, 50)

      const scoreOf = (g) => {
        const cached = g.ai_relevance?.[topicKey]
        return cached?.score || 5
      }

      // Get recent visits to deprioritize same-group repeats within session
      const { data: recentVisits } = await supabase
        .from('campaign_activity_log')
        .select('target_name')
        .eq('campaign_id', campaign_id)
        .eq('action_type', 'visit_group')
        .eq('account_id', account_id)
        .order('created_at', { ascending: false })
        .limit(groups.length)
      const recentNames = (recentVisits || []).map(v => v.target_name)

      // Phase 2: tier ordering map (A=0 highest, D=3 — D already filtered)
      const tierRank = { A: 0, B: 1, C: 2, D: 3 }
      groups.sort((a, b) => {
        // 0. Phase 2: score_tier first (A → B → C)
        const ta = tierRank[a.score_tier || 'C']
        const tb = tierRank[b.score_tier || 'C']
        if (ta !== tb) return ta - tb

        // 1. Penalize consecutive skips heavily — push to bottom
        const skipsA = a.consecutive_skips || 0
        const skipsB = b.consecutive_skips || 0
        if (skipsA >= 3 && skipsB < 3) return 1
        if (skipsB >= 3 && skipsA < 3) return -1

        // 2. Sort by AI relevance score (higher first)
        const sa = scoreOf(a)
        const sb = scoreOf(b)
        if (sa !== sb) return sb - sa

        // 3. Tiebreaker: prefer groups not visited recently
        const aRecent = recentNames.indexOf(a.name)
        const bRecent = recentNames.indexOf(b.name)
        if (aRecent === -1 && bRecent !== -1) return -1
        if (bRecent === -1 && aRecent !== -1) return 1

        // 4. Final tiebreaker: random
        return Math.random() - 0.5
      })

      console.log(`[NURTURE] Smart rotation: ${groups.slice(0, 5).map(g => `${g.name?.substring(0, 20)}(s:${scoreOf(g)},sk:${g.consecutive_skips || 0})`).join(' → ')}`)
    }
  }

  // Phase 12: no groups → run scout inline (unconditionally).
  // Previously gated on parsed_plan having a join_group step, but the nurture
  // role's parsed_plan rarely has join_group (that lives on the scout role).
  // Scout handler still gates join_group by the nick's daily budget, so
  // triggering inline is safe — worst case it no-ops.
  if (!groups?.length) {
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

  // Phase 2: keep tier order (A → B → C); only randomize among the top tier slice
  const groupsToVisit = groups.slice(0, R.randInt(1, Math.min(3, groups.length)))

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
        // Audit 2026-04-12: 15s timeout (was 30s) — a slow warmup nav was
        // burning half the session before real work. Warmup failure must not
        // crash the job; the inner try/catch swallows it and the handler
        // continues straight to the main loop.
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 15000 })
        await R.sleepRange(3000, 6000)
        // Scroll feed naturally
        for (let s = 0; s < R.randInt(2, 4); s++) {
          await humanScroll(page)
          await R.sleepRange(2000, 4000)
        }
        await humanMouseMove(page)
        console.log(`[NURTURE] Warm-up done, starting campaign work`)
      } catch (err) {
        console.warn(`[NURTURE] Warm-up failed for ${account.username}: ${err.message} — continuing anyway`)
      }
    }

    let totalLikes = 0
    let totalComments = 0
    const groupResults = []
    let aiGroupEvalsThisRun = 0
    const MAX_AI_GROUP_EVALS = 2

    // === RANDOMIZE TASK ORDER per nick (avoid pattern detection) ===
    // 50% chance: scan first then comment | 50% comment from existing scans then scan new
    const scanFirst = Math.random() < 0.5
    if (scanFirst) {
      console.log(`[NURTURE] Strategy: SCAN first → then COMMENT from scored posts`)
    } else {
      console.log(`[NURTURE] Strategy: COMMENT from scored posts → then SCAN new group`)
    }

    // Phase A: Try to comment on BEST pre-scanned posts first (from previous scans)
    if (!scanFirst && commentCheck.allowed && tracker.get('comment') < maxCommentsSession) {
      try {
        const bestPosts = await getBestPosts({ campaignId: campaign_id, limit: 3, supabase })
        if (bestPosts.length > 0) {
          const bestGroup = bestPosts[0]
          console.log(`[NURTURE] Found ${bestPosts.length} pre-scored posts, best in "${bestGroup.group_name}" (score: ${bestGroup.ai_score})`)
          // Navigate to best group and comment on scored posts
          // (this reuses existing comment logic below by prioritizing this group)
          const scoredGroup = groupsToVisit.find(g => g.fb_group_id === bestGroup.fb_group_id)
          if (scoredGroup) {
            // Move this group to front of visit list
            const idx = groupsToVisit.indexOf(scoredGroup)
            if (idx > 0) { groupsToVisit.splice(idx, 1); groupsToVisit.unshift(scoredGroup) }
          }
        }
      } catch {}
    }

    let _groupIdx = 0
    for (const group of groupsToVisit) {
      _groupIdx++
      // Mid-session idle pause — 20% chance between groups, 30-120s.
      // Real users don't visit one group right after another at a
      // constant pace — they pause (read, get coffee, get distracted).
      // Skip for first group (just started session).
      if (_groupIdx > 1 && Math.random() < 0.2) {
        const idleMs = 30000 + Math.floor(Math.random() * 90000) // 30-120s
        console.log(`[NURTURE] 💤 Idle pause ${Math.round(idleMs/1000)}s (distracted-user simulation)`)
        await new Promise(r => setTimeout(r, idleMs))
      }

      // Feed detour — 12% chance between groups, navigate to home feed,
      // scroll briefly, come back. Real users don't go group→group→group
      // linearly; they bounce off the home feed occasionally. Break
      // 'linear traversal' bot pattern that FB graph analytics could see.
      if (_groupIdx > 1 && Math.random() < 0.12) {
        try {
          console.log(`[NURTURE] 🏠 Home feed detour`)
          await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {})
          await R.sleepRange(2000, 4000)
          // 2-4 natural scrolls on feed
          const scrollCount = 2 + Math.floor(Math.random() * 3)
          for (let s = 0; s < scrollCount; s++) {
            try { await humanScroll(page) } catch {}
            await R.sleepRange(2500, 5500)
          }
          // Occasionally scroll up too (re-check earlier post)
          if (Math.random() < 0.35) {
            try { await page.evaluate(() => window.scrollBy(0, -(200 + Math.random() * 400))) } catch {}
            await R.sleepRange(1500, 3000)
          }
        } catch (e) {
          console.warn(`[NURTURE] Home detour threw (non-fatal): ${e.message}`)
        }
      }

      // Group visit rate limit: max 2 nicks in same group within 30 min
      if (!canVisitGroup(group.fb_group_id, account_id)) {
        console.log(`[NURTURE] ⏭️ Skip "${group.name}" — group visit rate limit (${GROUP_VISIT_MAX} nicks/30min)`)
        continue
      }
      recordGroupVisit(group.fb_group_id, account_id)

      const result = { group_name: group.name, posts_found: 0, likes_done: 0, comments_done: 0, errors: [] }

      try {
        // Stay on DESKTOP Facebook (cookies work, no login overlay)
        // Force chronological feed view. Plain /groups/{ID} sometimes lands
        // on About page (cold session / no hydrated membership). Using
        // ?sorting_setting=CHRONOLOGICAL is the community-tested fix
        // (kevinzg/facebook-scraper#935) — pins FB to the feed + ordered
        // newest first, dramatically fewer About-page redirects than /posts.
        const baseUrl = (group.url || `https://www.facebook.com/groups/${group.fb_group_id}`)
          .replace('://m.facebook.com', '://www.facebook.com')
          .replace(/\/+$/, '')
          .replace(/\?.*$/, '')
        const groupUrl = `${baseUrl}/?sorting_setting=CHRONOLOGICAL`
        console.log(`[NURTURE] Visiting: ${group.name || group.fb_group_id}`)
        logger.log('visit_group', { target_type: 'group', target_id: group.fb_group_id, target_name: group.name, target_url: groupUrl })

        const _navStart = Date.now()
        await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
        const _navMs = Date.now() - _navStart
        await R.sleepRange(2000, 4000)

        // Signal detection: slow load + redirect
        try {
          const signals = require('../../lib/signal-collector')
          signals.checkSlowLoad(account_id, payload.job_id, groupUrl, _navMs)
          signals.checkRedirectWarn(account_id, payload.job_id, groupUrl, page.url())
        } catch {}

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

        // ═══ AI GROUP EVALUATION ═══
        // AI decides if group is relevant — replaces hardcoded keyword/language checks
        // If AI fails → skip this group THIS RUN (not failure, will retry next time)
        // Cache result in ai_relevance for 7 days.
        // Defensive: orchestrator-created jobs historically missed `topic` in
        // payload → crashed on toLowerCase. Coerce to '' if undefined.
        const topicKey = String(topic || '').toLowerCase().trim().replace(/\s+/g, '_').slice(0, 50) || 'default'
        const cachedEval = group.ai_relevance?.[topicKey]
        const CACHE_TTL = 7 * 24 * 3600 * 1000
        const cacheValid = cachedEval?.evaluated_at && (Date.now() - new Date(cachedEval.evaluated_at).getTime()) < CACHE_TTL

        if (cacheValid) {
          const cachedDecision = cachedEval.decision || (cachedEval.relevant === false && cachedEval.score < 3 ? 'reject' : cachedEval.relevant && cachedEval.score >= 5 ? 'engage' : 'observe')
          result.aiDecision = { action: cachedDecision, score: cachedEval.score, tier: cachedEval.tier, reason: cachedEval.reason || 'cached' }

          if (cachedDecision === 'reject') {
            console.log(`[NURTURE] Skip evaluate for ${account.username}: cached REJECT on "${group.name}" (score: ${cachedEval.score}, reason: ${cachedEval.reason || 'cached'})`)
            result.errors.push('skipped: cached reject')
            groupResults.push(result)
            continue
          }
          console.log(`[NURTURE] "${group.name}" — cached ${cachedDecision.toUpperCase()} (score: ${cachedEval.score})`)
        }

        if (!cacheValid && topic) {
          // Rate limit AI evals: max 2 per run, rest will be evaluated in future runs
          if (aiGroupEvalsThisRun >= MAX_AI_GROUP_EVALS) {
            console.log(`[NURTURE] ⚠️ "${group.name}" — skipping AI eval (${aiGroupEvalsThisRun}/${MAX_AI_GROUP_EVALS} evals this run), will evaluate next run`)
            // Don't skip the group — let it proceed without eval (give benefit of doubt)
          } else {
          // Need AI evaluation — extract group info from page
          try {
            const { evaluateGroup } = require('../../lib/ai-filter')

            // Scroll down to trigger FB lazy-loading more articles
            await humanScroll(page)
            await R.sleepRange(1500, 3000)
            await humanScroll(page)
            await R.sleepRange(1000, 2000)

            const groupInfo = await page.evaluate(() => {
              const nameEl = document.querySelector('h1') || document.querySelector('[role="main"] span[dir="auto"]')
              const name = nameEl?.textContent?.trim() || ''
              let description = ''
              const aboutEls = document.querySelectorAll('[role="main"] span[dir="auto"]')
              for (const el of aboutEls) {
                const t = el.textContent?.trim() || ''
                if (t.length > 30 && t.length < 500 && t !== name) { description = t; break }
              }
              const posts = []
              const articles = document.querySelectorAll('[role="article"]')
              for (const article of [...articles].slice(0, 8)) {
                // Skip nested articles (comments)
                const parentArticle = article.parentElement?.closest('[role="article"]')
                if (parentArticle && parentArticle !== article) continue

                let postText = ''
                // Try div[dir="auto"] first, fallback to article.innerText
                for (const d of article.querySelectorAll('div[dir="auto"]')) {
                  const t = d.innerText?.trim() || ''
                  if (t.length > 10 && t.length > postText.length) postText = t
                }
                if (!postText) {
                  postText = (article.innerText || '').substring(0, 300).trim()
                }
                if (postText.length >= 10) posts.push({ text: postText.substring(0, 200) })
              }
              return { name: name || '', description, posts, member_count: 0 }
            }).catch(() => null)

            if (groupInfo && groupInfo.posts.length > 0) {
              aiGroupEvalsThisRun++
              const aiResult = await evaluateGroup(groupInfo, topic, payload.owner_id)
              // ── Structured AI Decision ──
              const aiDecision = {
                action: 'reject', // default
                score: aiResult.score || 0,
                tier: aiResult.tier || 'tier3_irrelevant',
                relevant: aiResult.relevant === true,
                reason: aiResult.reason || '',
                language: aiResult.language || 'unknown',
              }

              // Decision rules: script uses these thresholds
              if (aiResult.relevant && aiResult.score >= 5) {
                aiDecision.action = 'engage'     // high confidence — like + comment
              } else if (aiResult.relevant || aiResult.score >= 3) {
                aiDecision.action = 'observe'    // medium confidence — like only, no comment
              } else {
                aiDecision.action = 'reject'     // low confidence — skip entirely
              }

              console.log(`[NURTURE] AI eval "${group.name}" → ${aiDecision.action.toUpperCase()} (score:${aiDecision.score}, tier:${aiDecision.tier}) — ${aiDecision.reason} [${aiGroupEvalsThisRun}/${MAX_AI_GROUP_EVALS}]`)

              // Cache result with decision for future runs
              try {
                const prev = group.ai_relevance || {}
                prev[topicKey] = { ...aiResult, decision: aiDecision.action, evaluated_at: new Date().toISOString() }
                await supabase.from('fb_groups').update({
                  ai_relevance: prev,
                  ai_note: (aiResult.note || aiResult.reason || '').slice(0, 300),
                }).eq('fb_group_id', group.fb_group_id).eq('account_id', account_id)
              } catch {}

              // Log AI decision to activity log — detailed enough to debug
              logger.log('ai_evaluate_group', {
                target_type: 'group', target_name: group.name,
                result_status: aiDecision.action === 'reject' ? 'skipped' : 'success',
                details: {
                  decision: aiDecision.action,
                  score: aiDecision.score,
                  tier: aiDecision.tier,
                  relevant: aiDecision.relevant,
                  reason: aiDecision.reason,
                  language: aiDecision.language,
                  group_tags: group.tags || [],
                  topic,
                },
              })

              // Store decision on the group result for later use (comment gating)
              result.aiDecision = aiDecision

              if (aiDecision.action === 'reject') {
                console.log(`[NURTURE] Skip evaluate for ${account.username}: AI reject on "${group.name}" (score:${aiDecision.score}, reason:${aiDecision.reason})`)
                result.errors.push(`skipped: AI decision=reject (score:${aiDecision.score}, reason:${aiDecision.reason})`)
                groupResults.push(result)
                continue
              }
            } else {
              // Page didn't load posts — skip this run, DON'T cache, retry next time
              console.log(`[NURTURE] Skip evaluate for ${account.username}: could not extract posts on "${group.name}" (DOM empty, will retry)`)
              result.errors.push('skipped: no posts for AI eval')
              groupResults.push(result)
              continue
            }
          } catch (aiErr) {
            // AI failed — NOT a failure, just skip this group this run
            console.log(`[NURTURE] Skip evaluate for ${account.username}: AI eval threw on "${group.name}": ${aiErr.message}`)
            // Continue to next group, don't block, don't cache
            result.errors.push('skipped: AI eval failed (will retry)')
            groupResults.push(result)
            continue
          }
          } // end rate limit else
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
              isLoggedIn: !!document.querySelector('[aria-label="Your profile"], [aria-label="Account"], [data-pagelet="ProfileActions"], [aria-label="Trang cá nhân của bạn"], [aria-label="Tài khoản"], [aria-label="Thông báo"]'),
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

          // Member verification: if page shows 'Tham gia nhóm' / 'Join group'
          // button AND only 2-3 articles visible, the nick is actually NOT
          // a member even though DB says so. Flip is_member=false + skip
          // so scheduler stops assigning this group. DB membership drift
          // (DB stale) was observed for Thúy's 2 groups — all 81 nurture
          // runs failed with posts_found:0 until caught here.
          const body = debugInfo.bodyText || ''
          const joinButtonVisible = /Tham gia nhóm|Join group|Join this group/i.test(body)
          if (joinButtonVisible && debugInfo.articlesCount < 3) {
            console.log(`[NURTURE] ❌ ${account.username} NOT actual member of "${group.name}" — FB shows Join button. Flipping is_member=false.`)
            try {
              await supabase.from('fb_groups')
                .update({ is_member: false, pending_approval: false, join_status: 'not_member' })
                .eq('id', group.id)
            } catch (uErr) {
              console.warn(`[NURTURE] is_member flip failed: ${uErr.message}`)
            }
            logger.log('visit_group', {
              target_type: 'group', target_id: group.fb_group_id, target_name: group.name,
              target_url: groupUrl, result_status: 'skipped',
              details: { reason: 'not_actual_member', body_snippet: body.substring(0, 100) },
            })
            result.errors.push('skipped: not_actual_member')
            groupResults.push(result)
            continue
          }
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

              // Reaction variety: 75% Like, 15% Love, 7% Haha, 3% Wow.
              // All-Like pattern across every post is a bot signal; real
              // users vary emotion. When picking non-Like, hover 500-900ms
              // on the Like button first to trigger the reaction tray,
              // then click the specific emoji. Fallback to plain click if
              // the tray doesn't appear.
              const reactionRoll = Math.random()
              let reactionType = 'like'
              if (reactionRoll >= 0.97) reactionType = 'wow'
              else if (reactionRoll >= 0.90) reactionType = 'haha'
              else if (reactionRoll >= 0.75) reactionType = 'love'

              const reactionLabels = {
                like: ['Like', 'Thích'],
                love: ['Love', 'Yêu thích'],
                haha: ['Haha'],
                wow: ['Wow'],
              }

              let reactionDone = false
              if (reactionType !== 'like') {
                try {
                  // Hover the Like button to open reaction tray
                  await btn.hover().catch(() => {})
                  await R.sleepRange(500, 900)
                  const labels = reactionLabels[reactionType]
                  reactionDone = await page.evaluate((labels) => {
                    const buttons = document.querySelectorAll('div[role="button"], div[aria-label]')
                    for (const b of buttons) {
                      const lab = (b.getAttribute('aria-label') || '').trim()
                      if (labels.some(l => lab === l || lab.startsWith(l + ':') || lab.startsWith(l + ' '))) {
                        const visible = b.offsetParent !== null || b.getBoundingClientRect().width > 0
                        if (visible) {
                          const rect = b.getBoundingClientRect()
                          const x = rect.left + rect.width / 2
                          const y = rect.top + rect.height / 2
                          const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }
                          b.dispatchEvent(new MouseEvent('mousedown', opts))
                          b.dispatchEvent(new MouseEvent('mouseup', opts))
                          b.dispatchEvent(new MouseEvent('click', opts))
                          return true
                        }
                      }
                    }
                    return false
                  }, labels)
                  if (reactionDone) console.log(`[NURTURE] Reaction: ${reactionType}`)
                } catch {}
              }

              if (!reactionDone) {
                // Plain Like click (default + fallback)
                await page.evaluate((idx) => {
                  const el = document.querySelector(`[data-nurture-like="${idx}"]`)
                  if (!el) return
                  const rect = el.getBoundingClientRect()
                  const x = rect.left + rect.width / 2
                  const y = rect.top + rect.height / 2
                  const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }
                  el.dispatchEvent(new MouseEvent('mousedown', opts))
                  el.dispatchEvent(new MouseEvent('mouseup', opts))
                  el.dispatchEvent(new MouseEvent('click', opts))
                }, i)
                reactionType = 'like'
              }

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
              logger.log('like', { target_type: 'group', target_id: group.fb_group_id, target_name: group.name, target_url: group.url, details: { post_url: likeableInfo[i]?.postUrl || null, reactions: likeableInfo[i]?.reactions || 0, comments: likeableInfo[i]?.commentCount || 0, reaction_type: reactionType } })

              // Human delay between likes (minGapSeconds: 2)
              await R.sleepRange(2000, 5000)
            } catch (err) {
              result.errors.push(`like: ${err.message}`)
            }
          }
          result.likes_done = likesInGroup
        }

        // ===== COMMENT ON POSTS (desktop — click comment button in feed) =====
        // Gate: only comment if AI decision is 'engage' (not 'observe')
        const canComment = result.aiDecision?.action !== 'observe' // observe = like only
        if (!canComment) {
          console.log(`[NURTURE] Skip evaluate for ${account.username}: AI observe on "${group.name}" (like-only, no comment)`)
        } else if (!commentCheck.allowed) {
          console.log(`[NURTURE] Skip evaluate for ${account.username}: comment budget exhausted (used ${commentBudget.used}/${commentBudget.max}) on "${group.name}"`)
        } else if (tracker.get('comment') >= maxCommentsSession) {
          console.log(`[NURTURE] Skip evaluate for ${account.username}: session comment cap hit (${tracker.get('comment')}/${maxCommentsSession}) on "${group.name}"`)
        }
        if (canComment && commentCheck.allowed && tracker.get('comment') < maxCommentsSession) {
          const maxComments = getActionParams(parsed_plan, 'comment', { countMin: 1, countMax: 2 }).count

          // Cross-session dedup — query BOTH comment_logs AND campaign_activity_log
          // so we catch comments posted when comment_logs insert may have
          // silently failed (CHECK constraint violation on 'posting' status
          // left the table empty historically). Query by owner_id — no
          // matter which nick posted, we treat it as the user's existing
          // comment on that post.
          const ownerId = payload.owner_id || payload.created_by
          const commentedUrls = new Set()
          const commentedPostIds = new Set()
          try {
            const { data: prevComments } = await supabase
              .from('comment_logs')
              .select('post_url, fb_post_id')
              .eq('owner_id', ownerId)
              .not('post_url', 'is', null)
              .order('created_at', { ascending: false })
              .limit(1000)
            for (const c of (prevComments || [])) {
              if (c.post_url) commentedUrls.add(c.post_url)
              if (c.fb_post_id) commentedPostIds.add(c.fb_post_id)
            }
          } catch {}
          try {
            const { data: prevLogs } = await supabase
              .from('campaign_activity_log')
              .select('details, target_url')
              .eq('owner_id', ownerId)
              .in('action_type', ['comment', 'opportunity_comment'])
              .eq('result_status', 'success')
              .order('created_at', { ascending: false })
              .limit(1000)
            for (const l of (prevLogs || [])) {
              const u = l.details?.post_url
              if (u) {
                commentedUrls.add(u)
                const m = u.match(/(?:posts|permalink)\/(\d+)/) || u.match(/story_fbid=(\d+)/)
                if (m) commentedPostIds.add(m[1])
              }
            }
          } catch {}
          console.log(`[NURTURE] Dedup: loaded ${commentedUrls.size} commented URLs + ${commentedPostIds.size} post IDs for this user`)

          // === EXPAND "See more" / "Xem thêm" links to get full post content ===
          // FB truncates long posts behind these links — click them so AI sees full context
          try {
            const expanded = await page.evaluate(() => {
              const articles = document.querySelectorAll('[role="article"]')
              let clicked = 0
              for (const article of [...articles].slice(0, 10)) {
                // Skip nested
                const parent = article.parentElement?.closest('[role="article"]')
                if (parent && parent !== article) continue
                // Find "See more" / "Xem thêm" within article (NOT in toolbar)
                for (const el of article.querySelectorAll('div[role="button"], span[role="button"]')) {
                  const text = (el.innerText || '').trim().toLowerCase()
                  if (text === 'xem thêm' || text === 'see more' || text === 'xem them') {
                    try { el.click(); clicked++ } catch {}
                    break
                  }
                }
              }
              return clicked
            })
            if (expanded > 0) {
              console.log(`[NURTURE] Expanded ${expanded} 'See more' links`)
              await R.sleepRange(800, 1500) // wait for content to render
            }
          } catch {}

          // Hybrid: attach GraphQL post sniffer BEFORE scrolling so we
          // passively capture post payloads regardless of whether DOM
          // selectors match. If DOM extraction yields 0 (FB DOM drift),
          // we can still fall back on captured posts instead of skipping
          // the whole group. Reuses the same extractor fetch_source_cookie
          // uses — that path returns 6-10 posts reliably.
          const sniffedPosts = []
          let sniffer = null
          try {
            const { extractPostsFromGraphQL } = require('./fetch-source-cookie')
            sniffer = async (response) => {
              try {
                const url = response.url()
                if (!url.includes('/api/graphql')) return
                if (response.status() !== 200) return
                const text = await response.text().catch(() => '')
                if (!text || text.length < 200) return
                const found = extractPostsFromGraphQL(text)
                if (found.length > 0) sniffedPosts.push(...found)
              } catch {}
            }
            page.on('response', sniffer)
          } catch (snifErr) {
            console.warn(`[NURTURE] GraphQL sniffer setup failed: ${snifErr.message}`)
          }

          // Scroll to trigger FB lazy-loading of feed posts. Without this,
          // DOM at `domcontentloaded` may only contain the group header/about
          // article and zero actual posts. Retry up to 2 times if post count
          // is too low after the first pass.
          let commentableInfo = []
          // Stats 2026-04-21: posts_found>0 dropped to 7-15% for all nicks
          // — FB lazy-loads more aggressively now, old 3x scroll is insufficient.
          // Bump to 5 retries with longer waits + wait for networkidle between.
          for (let _scrollAttempt = 0; _scrollAttempt < 5; _scrollAttempt++) {
            if (_scrollAttempt > 0) {
              console.log(`[NURTURE] Scroll attempt ${_scrollAttempt + 1}/5 for "${group.name}" — previous had ${commentableInfo.length} posts`)
            }
            await humanScroll(page)
            await R.sleepRange(2000, 3500)
            if (_scrollAttempt < 4) {
              await humanScroll(page)
              await R.sleepRange(1500, 2500)
            }
            // Let FB finish any in-flight fetches before snapshotting DOM
            try { await page.waitForLoadState('networkidle', { timeout: 4000 }) } catch {}

            // Extract ALL posts with content + tag comment buttons
            commentableInfo = await page.evaluate(() => {
              // 2026 FB Comet DOM: feed posts live in div[role="feed"] > children
              // with aria-posinset. Legacy [role="article"] only catches header/
              // pinned wrappers (2 per page vs 10+ actual feed posts). Research
              // (MasuRii/FBScrapeIdeas + thanh2004nguyen/facebook-group-scraper)
              // shows data-ad-rendering-role="story_message" is the current
              // stable post-body marker in Comet architecture. Walk up to the
              // feed-item wrapper from each message.
              const candidates = []
              const seen = new Set()

              // Strategy 1: walk up from story_message markers (most reliable 2026)
              for (const marker of document.querySelectorAll('[data-ad-rendering-role="story_message"]')) {
                const wrap = marker.closest('div[role="article"], div[data-pagelet^="FeedUnit"], div[aria-posinset]') || marker.parentElement?.parentElement?.parentElement
                if (wrap && !seen.has(wrap)) { seen.add(wrap); candidates.push(wrap) }
              }

              // Strategy 2: feed-scoped articles with aria-posinset (ARIA feed pattern)
              const feed = document.querySelector('div[role="feed"]')
              if (feed) {
                for (const el of feed.querySelectorAll('div[aria-posinset], div[role="article"], div[data-pagelet^="FeedUnit"]')) {
                  if (!seen.has(el)) { seen.add(el); candidates.push(el) }
                }
              }

              // Strategy 3: legacy fallbacks (older FB layouts / non-group pages)
              if (candidates.length < 3) {
                for (const sel of ['[data-pagelet^="FeedUnit"]', '[role="article"]', '[data-ft]']) {
                  for (const el of document.querySelectorAll(sel)) {
                    if (!seen.has(el)) { seen.add(el); candidates.push(el) }
                  }
                }
              }

              // Strategy 4: any post-body marker wrapped up (last resort)
              if (candidates.length === 0) {
                for (const marker of document.querySelectorAll('[data-ad-preview="message"], [data-ad-comet-preview="message"]')) {
                  const wrap = marker.closest('div[class][style], div[data-visualcompletion="ignore-dynamic"]') || marker.parentElement?.parentElement
                  if (wrap && !seen.has(wrap)) { seen.add(wrap); candidates.push(wrap) }
                }
              }
              const articles = candidates
              const results = []
              for (const article of articles.slice(0, 15)) {
              // Skip nested (comment articles)
              const parent = article.parentElement?.closest('[role="article"]')
              if (parent && parent !== article) continue

              // Extract post body — 2026 Comet primary marker is
              // data-ad-rendering-role="story_message". Keep legacy
              // data-ad-preview/comet-preview as fallback for older layouts.
              let body = ''
              const bodyEl = article.querySelector('[data-ad-rendering-role="story_message"], [data-ad-preview="message"], [data-ad-comet-preview="message"]')
              if (bodyEl) body = bodyEl.innerText.trim()
              if (!body || body.length < 10) {
                for (const d of article.querySelectorAll('div[dir="auto"]')) {
                  const t = d.innerText.trim()
                  if (t.length > body.length && t.length < 5000) body = t
                }
              }
              if (body.length < 10) continue

              // Extract author
              const authorEl = article.querySelector('a[role="link"] strong, h2 a, h3 a')
              const author = authorEl ? authorEl.textContent.trim() : ''

              // Extract post URL — the FB timestamp link (<abbr>'s wrapping
              // <a>) is the most reliable permalink source. In Comet layouts
              // it often sits OUTSIDE the story_message wrapper, so we also
              // walk up to the nearest [role="article"] or aria-posinset
              // ancestor and search there. Without this, many posts come
              // back with postUrl=null and "Xem bài" link disappears in UI.
              let postUrl = null
              const scope = article.closest('[role="article"], div[aria-posinset], [data-pagelet^="FeedUnit"]') || article
              // Strategy 1: abbr timestamp's ancestor <a>
              const abbrEl = scope.querySelector('abbr')
              if (abbrEl) {
                const abbrLink = abbrEl.closest('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/groups/"]')
                if (abbrLink?.href) postUrl = abbrLink.href.split('?')[0]
              }
              // Strategy 2: any permalink anchor in scope
              if (!postUrl) {
                for (const link of scope.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]')) {
                  const href = link.href || ''
                  if (href.match(/\/(posts|permalink)\/\d+/) || href.includes('story_fbid')) {
                    postUrl = href.split('?')[0]; break
                  }
                }
              }
              // Strategy 3: look at sibling wrapper (Comet sometimes puts
              // the permalink link outside the story_message but in same
              // parent feed unit)
              if (!postUrl && scope !== article && scope.parentElement) {
                for (const link of scope.parentElement.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"]')) {
                  const href = link.href || ''
                  if (href.match(/\/(posts|permalink)\/\d+/)) { postUrl = href.split('?')[0]; break }
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

              // Fix 2 (Phase 6): grab up to 5 already-visible thread comments so the AI
              // can answer the actual discussion instead of restating the post body.
              // We DO NOT click "View more" — only what FB rendered inline. If the post has
              // no comments visible yet, threadComments stays empty and AI falls back to
              // post body only (current behavior).
              const threadComments = []
              try {
                // Comment containers on desktop are <li> items inside the comment list
                // (role="article" with depth, or aria-label containing "Comment by/Bình luận của")
                const commentNodes = article.querySelectorAll('[role="article"][aria-label*="omment" i], [role="article"][aria-label*="ình luận" i]')
                for (const c of commentNodes) {
                  if (threadComments.length >= 5) break
                  const label = c.getAttribute('aria-label') || ''
                  // aria-label is usually "Comment by John Doe" / "Bình luận của John"
                  const cAuthorMatch = label.match(/(?:by|của)\s+(.+?)(?:\s+\d|$)/i)
                  const cAuthor = cAuthorMatch ? cAuthorMatch[1].trim() : ''
                  // Body is the longest dir="auto" inside the comment node
                  let cBody = ''
                  for (const d of c.querySelectorAll('div[dir="auto"]')) {
                    const t = (d.innerText || '').trim()
                    if (t.length > cBody.length && t.length < 1000) cBody = t
                  }
                  if (cBody && cBody.length >= 4 && cBody !== body) {
                    threadComments.push({ author: cAuthor, text: cBody.substring(0, 300) })
                  }
                }
              } catch {}

              // Keep up to 1500 chars per post (was 400) — AI needs context
              results.push({ index: results.length, postUrl, body: body.substring(0, 1500), author, isTranslated, threadComments })
            }
            return results
          })

            // If we got >= 2 posts, stop scrolling. Otherwise retry.
            if (commentableInfo.length >= 2) break
          } // end scroll retry loop

          // Detach GraphQL sniffer — we either captured enough by now or
          // the page is done loading anyway.
          if (sniffer) {
            try { page.off('response', sniffer) } catch {}
          }

          // Hybrid fallback: DOM extraction yielded 0 → merge in sniffed
          // posts from GraphQL. Dedupe by id (GraphQL) / postUrl. Map to
          // the same shape commentableInfo uses. threadComments empty
          // (API doesn't carry visible thread context); AI falls back
          // to post body only when no thread present.
          if (commentableInfo.length === 0 && sniffedPosts.length > 0) {
            const seen = new Set()
            const mapped = []
            for (const p of sniffedPosts) {
              const key = p.id || p.postUrl
              if (!key || seen.has(key)) continue
              seen.add(key)
              if (!p.msg || p.msg.length < 10) continue
              mapped.push({
                index: mapped.length,
                postUrl: p.postUrl || null,
                body: p.msg.substring(0, 1500),
                author: p.authorName || '',
                isTranslated: false,
                threadComments: [],
                _source: 'graphql',
              })
              if (mapped.length >= 15) break
            }
            if (mapped.length > 0) {
              console.log(`[NURTURE] 🔌 DOM empty → using ${mapped.length} posts from GraphQL sniffer for "${group.name}"`)
              commentableInfo = mapped
            }
          }

          // Filter: skip translated, already commented (by ANY nick in this campaign), spam
          const eligible = commentableInfo.filter(p => {
            if (p.isTranslated) return false
            if (p.postUrl && commentedUrls.has(p.postUrl)) return false
            // Also check fb_post_id extracted from URL
            if (p.postUrl) {
              const m = p.postUrl.match(/(?:posts|permalink)\/(\d+)/) || p.postUrl.match(/story_fbid=(\d+)/)
              if (m && commentedPostIds.has(m[1])) return false
            }
            const lower = p.body.toLowerCase()
            const spamWords = ['inbox', 'liên hệ ngay', 'giảm giá', 'mua ngay', 'chuyên cung cấp']
            if (spamWords.filter(w => lower.includes(w)).length >= 2) return false
            return true
          })

          console.log(`[NURTURE] Extracted ${commentableInfo.length} posts, ${eligible.length} eligible for comment`)

          // === SMART SKIP: 0 eligible posts → record skip + move to next group ===
          if (eligible.length === 0) {
            await recordGroupSkip(supabase, account_id, group.fb_group_id)
            console.log(`[NURTURE] Skip evaluate for ${account.username}: 0 eligible posts on "${group.name}" (extracted ${commentableInfo.length}, filtered out all)`)
          } else {
            // Has eligible posts → record yield (resets consecutive_skips)
            await recordGroupYield(supabase, account_id, group.fb_group_id, eligible.length)
          }

          // === DETECT GROUP LANGUAGE from sample of eligible posts ===
          // Use cached group.language if known, else detect now and persist
          let groupLanguage = group.language || null
          if (!groupLanguage && eligible.length >= 3) {
            try {
              groupLanguage = detectGroupLanguage(eligible)
              if (groupLanguage && groupLanguage !== 'unknown') {
                // Cache to DB for future runs
                supabase.from('fb_groups')
                  .update({ language: groupLanguage })
                  .eq('account_id', account_id).eq('fb_group_id', group.fb_group_id)
                  .then(() => {}, () => {})
                console.log(`[NURTURE] Detected group language: ${groupLanguage} for "${group.name}"`)
              }
            } catch {}
          }

          // === LANGUAGE GATE: skip English groups entirely for VN nicks ===
          // Per user request: nick VN không tương tác với group tiếng Anh
          // → mark group as skipped + record skip + move on to next group
          const nickLang = account.profile_language || 'vi'
          if (groupLanguage === 'en' && nickLang === 'vi') {
            console.log(`[NURTURE] ⏭️ Skip "${group.name}" — group is English, nick is VN (skipping entirely)`)
            await recordGroupSkip(supabase, account_id, group.fb_group_id)
            // Mark in DB so smart rotation deprioritizes this group permanently for VN nicks
            try {
              await supabase.from('fb_groups')
                .update({ language: 'en', user_approved: false })
                .eq('account_id', account_id).eq('fb_group_id', group.fb_group_id)
            } catch {}
            logger.log('visit_group', {
              target_type: 'group', target_name: group.name, target_url: group.url,
              result_status: 'skipped',
              details: { reason: 'english_group_vn_nick', group_language: groupLanguage },
            })
            groupResults.push(result)
            continue // skip to next group
          }
          const allowCommentInGroup = true

          // === AI BRAIN: Deep evaluation of which posts are worth engaging ===
          let aiSelected = []
          const postEvaluations = new Map() // store AI's reasoning per post
          if (eligible.length > 0) {
            try {
              // Fetch campaign details for context
              let campaignData = null
              if (campaign_id) {
                const { data: cData } = await supabase.from('campaigns')
                  .select('name, topic, requirement').eq('id', campaign_id).single()
                campaignData = cData
              }

              const evaluated = await evaluatePosts({
                posts: eligible,
                campaign: campaignData,
                nick: { id: account.id, username: account.username, created_at: account.created_at, mission: config?.nick_mission, persona_config: account.persona_config },
                group: { name: group.name, member_count: group.member_count, description: group.description },
                topic,
                maxPicks: Math.min(maxComments, eligible.length),
                ownerId: payload.owner_id,
                brandConfig, // AI now decides ad_opportunity contextually — no keyword matching
                groupLanguage, // language hint for AI
                // Fix 2: posts now carry threadComments (top 5 visible comments per article).
                // evaluatePosts uses them to understand the actual discussion thread.
              })

              if (evaluated.length > 0) {
                aiSelected = evaluated.map(e => {
                  const post = eligible[e.index - 1]
                  if (post) postEvaluations.set(post.index, e) // save AI reasoning
                  return post
                }).filter(Boolean)

                console.log(`[NURTURE] AI Brain evaluated ${eligible.length} posts, selected ${aiSelected.length}:`)
                for (const e of evaluated) {
                  const p = eligible[e.index - 1]
                  console.log(`  → score:${e.score} [${p?.author}] "${(p?.body || '').substring(0, 60)}..." — ${e.reason}`)
                }

                logger.log('ai_evaluate_posts', {
                  target_type: 'group', target_name: group.name,
                  details: { total_eligible: eligible.length, selected: evaluated.length, evaluations: evaluated },
                })

                // SAVE scored posts to DB for future comment sessions
                try {
                  await scanGroupPosts({
                    posts: eligible, group: { ...group, fb_group_id: group.fb_group_id },
                    campaign: campaignData, nick: { id: account.id, username: account.username, persona_config: account.persona_config },
                    topic, ownerId: payload.owner_id, brandConfig,
                    supabase, campaignId: campaign_id,
                  })
                } catch {}

                // Phase 3: upsert high-score posts into shared_posts pool for swarm
                try {
                  const rows = []
                  for (const e of evaluated) {
                    if ((e.score || 0) < 7) continue
                    const post = eligible[e.index - 1]
                    if (!post) continue
                    // Extract fb_post_id from URL
                    let postFbId = null
                    if (post.postUrl) {
                      const m = post.postUrl.match(/(?:posts|permalink)\/(\d+)/) || post.postUrl.match(/story_fbid=(\d+)/) || post.postUrl.match(/\/(\d{10,})/)
                      if (m) postFbId = m[1]
                    }
                    if (!postFbId) continue
                    const swarmTarget = e.score >= 9 ? 3 : (e.score >= 7 ? 2 : 1)
                    const isAdPost = e.is_ad_post === true || /sponsored|được tài trợ|promoted/i.test((post.body || '') + ' ' + (post.author || ''))
                    rows.push({
                      campaign_id,
                      group_fb_id: group.fb_group_id,
                      post_fb_id: postFbId,
                      post_content: (post.body || '').slice(0, 2000),
                      post_url: post.postUrl || null,
                      post_author: post.author || null,
                      ai_score: e.score,
                      ai_reason: (e.reason || '').slice(0, 500),
                      is_ad_opportunity: e.ad_opportunity === true,
                      ad_reason: (e.ad_reason || '').slice(0, 500) || null,
                      comment_angle: (e.comment_angle || '').slice(0, 500) || null,
                      language: e.comment_language || groupLanguage || 'vi',
                      is_ad_post: isAdPost,
                      swarm_target: swarmTarget,
                    })
                  }
                  if (rows.length) {
                    await supabase.from('shared_posts')
                      .upsert(rows, { onConflict: 'post_fb_id', ignoreDuplicates: true })
                    console.log(`[NURTURE] 🐝 Pooled ${rows.length} shared_posts (swarm targets: ${rows.map(r => r.swarm_target).join(',')})`)
                  }
                } catch (poolErr) {
                  console.warn(`[NURTURE] shared_posts upsert failed: ${poolErr.message}`)
                }
              } else {
                // Emergency warmup fallback — ai-brain Tier 2 should have
                // picked 1 post, but in production we still see evaluated=[]
                // daily (AI returns empty JSON / all posts flagged ad / parse
                // fail — silent catch → returns []). Without this, 0-comment
                // days persist even when 14 eligible posts sit on the page.
                // Condition: 3+ eligible (group is active). Post choice:
                // longest non-spam body — substantive enough to write a
                // contextual reply. No brand push (score=0 → ad path skips).
                if (eligible.length >= 3) {
                  const candidate = eligible
                    .filter(p => (p.body || '').length >= 30 && !/inbox|liên hệ|giảm giá|mua ngay/i.test(p.body || ''))
                    .sort((a, b) => (b.body?.length || 0) - (a.body?.length || 0))[0]
                  if (candidate) {
                    aiSelected = [candidate]
                    console.log(`[NURTURE] AI evaluate empty; emergency warmup fallback → post #${candidate.index} (body len=${candidate.body.length})`)
                    logger.log('ai_evaluate_posts', {
                      target_type: 'group', target_name: group.name, result_status: 'fallback',
                      details: { total_eligible: eligible.length, selected: 1, reason: 'emergency_warmup' },
                    })
                  } else {
                    console.log(`[NURTURE] AI empty + no non-spam candidate — skipping "${group.name}"`)
                    logger.log('ai_evaluate_posts', {
                      target_type: 'group', target_name: group.name, result_status: 'skipped',
                      details: { total_eligible: eligible.length, selected: 0, reason: 'no_relevant_posts' },
                    })
                  }
                } else {
                  console.log(`[NURTURE] AI Brain says NO posts worth engaging in "${group.name}" (${eligible.length} eligible, below threshold 3)`)
                  logger.log('ai_evaluate_posts', {
                    target_type: 'group', target_name: group.name, result_status: 'skipped',
                    details: { total_eligible: eligible.length, selected: 0, reason: 'no_relevant_posts' },
                  })
                }
              }
            } catch (err) {
              console.warn(`[NURTURE] AI Brain evaluation failed: ${err.message}, falling back to simple selection`)
              // Fallback: take first N eligible posts
              aiSelected = eligible.slice(0, maxComments)
            }
          }

          // Language gate: 0 comments if nick can't speak group's language
          const commentsToDo = allowCommentInGroup
            ? Math.min(maxComments, aiSelected.length, maxCommentsSession - tracker.get('comment'))
            : 0
          console.log(`[NURTURE] Will comment on ${commentsToDo} posts${allowCommentInGroup ? '' : ' (skipped — language gate)'}`)

          let commented = 0
          for (const post of aiSelected) {
            if (commented >= commentsToDo) break

            // Every failure path in this loop MUST write to activity_log
            // so we can see WHY comments fail from DB. Before these logs
            // the loop had 5 silent `continue`s — agent runs, no comments,
            // no error visible anywhere. User demand: "nếu lỗi phải nói rõ".
            const logFail = (step, extra = {}) => {
              console.log(`[NURTURE] ❌ Comment skip on post #${post.index}: ${step} ${JSON.stringify(extra)}`)
              try {
                logger.log('comment', {
                  target_type: 'group', target_id: group.fb_group_id,
                  target_name: group.name, target_url: group.url,
                  result_status: 'failed',
                  details: { step, post_index: post.index, post_url: post.postUrl, post_body_len: (post.body || '').length, ...extra },
                })
              } catch {}
            }

            try {
              const thisPostUrl = post.postUrl
              if (thisPostUrl && commentedUrls.has(thisPostUrl)) {
                logFail('dedup_local_url', { url: thisPostUrl })
                continue
              }
              // Cross-nick dedup by fb_post_id
              if (thisPostUrl) {
                const m = thisPostUrl.match(/(?:posts|permalink)\/(\d+)/) || thisPostUrl.match(/story_fbid=(\d+)/)
                if (m && commentedPostIds.has(m[1])) {
                  logFail('dedup_cross_nick', { fb_post_id: m[1] })
                  continue
                }
              }

              // Try tagged button first, then fallback strategies — DOM
              // may have re-rendered since extraction (scroll, lazy load)
              // and the attribute can get wiped. Fallbacks: find button
              // by post body match (most reliable) or URL substring.
              let commentBtn = await page.$(`[data-nurture-comment="${post.index}"]`)
              if (!commentBtn) {
                commentBtn = await page.evaluateHandle((postBody, postUrlPart) => {
                  const articles = document.querySelectorAll('[role="article"], [data-ad-rendering-role="story_message"], div[aria-posinset]')
                  for (const article of articles) {
                    const t = (article.innerText || '')
                    const matchesBody = postBody && postBody.length > 30 && t.includes(postBody.substring(0, 80))
                    const matchesUrl = postUrlPart && article.querySelector(`a[href*="${postUrlPart}"]`)
                    if (matchesBody || matchesUrl) {
                      const toolbar = article.querySelector('[role="group"]') || article
                      for (const btn of toolbar.querySelectorAll('[role="button"], a')) {
                        const l = (btn.getAttribute('aria-label') || '').toLowerCase()
                        const tx = (btn.innerText || '').trim().toLowerCase()
                        if (l.includes('comment') || l.includes('bình luận') || /^(comment|bình luận)$/i.test(tx)) {
                          return btn
                        }
                      }
                    }
                  }
                  return null
                }, post.body || '', (post.postUrl || '').split('/').slice(-2, -1)[0] || '')
                const asElement = commentBtn && await commentBtn.asElement()
                commentBtn = asElement || null
                if (commentBtn) console.log(`[NURTURE] Comment button fallback-matched for post #${post.index}`)
              }

              if (!commentBtn) {
                logFail('button_not_found')
                continue
              }

              const postText = post.body || ''
              const postAuthor = post.author || ''

              if (postText.length < 15) {
                logFail('body_too_short', { len: postText.length })
                continue
              }

              await commentBtn.scrollIntoViewIfNeeded()
              // Human "re-read" behavior: before clicking comment, 40%
              // chance to scroll up a bit (re-check post body), pause,
              // scroll back. Real users do this when composing a reply.
              if (Math.random() < 0.4) {
                try {
                  await page.evaluate(() => window.scrollBy(0, -(150 + Math.random() * 200)))
                  await R.sleepRange(800, 2000) // "re-reading" pause
                  await page.evaluate(() => window.scrollBy(0, 120 + Math.random() * 200))
                  await R.sleepRange(300, 700)
                } catch {}
              } else {
                // Just a shorter "reading" pause before engaging
                await R.sleepRange(1200, 3500)
              }
              await R.sleepRange(500, 1000)
              try {
                await commentBtn.click({ force: true, timeout: 5000 })
              } catch (clickErr) {
                logFail('button_click_failed', { err: clickErr.message })
                continue
              }
              await R.sleepRange(1500, 2500)

              // Comment input selectors — 2026 Comet uses Lexical editor
              // (div[data-lexical-editor="true"] + contenteditable). Include
              // as primary for newer layouts; keep legacy contenteditable as
              // fallback.
              const desktopCommentSels = [
                'div[contenteditable="true"][data-lexical-editor="true"][role="textbox"]',
                'div[contenteditable="true"][role="textbox"][aria-label*="comment" i]',
                'div[contenteditable="true"][role="textbox"][aria-label*="bình luận" i]',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"][aria-describedby]',
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
                logFail('textbox_not_found', { selectors_tried: desktopCommentSels.length })
                result.errors.push('comment: no comment box')
                continue
              }

              // Get AI Brain's evaluation for this specific post
              const evaluation = postEvaluations.get(post.index)
              const commentAngle = evaluation?.comment_angle || null
              const hasAdOpportunity = evaluation?.ad_opportunity === true
              const isLeadPotential = evaluation?.lead_potential === true
              // Per-post language: from AI eval, fall back to group language, default vi
              const postLanguage = evaluation?.comment_language || groupLanguage || 'vi'

              if (hasAdOpportunity) console.log(`[NURTURE] 📢 Ad opportunity on post #${post.index} by [${post.author}]`)
              if (isLeadPotential) console.log(`[NURTURE] 🎯 Lead potential: [${post.author}]`)

              // ── Ad opportunity check: use brand-aware comment if triggered ──
              let commentResult = null
              let adTriggered = false
              let campaignCtx = null
              const adConfig = config?.advertising || null

              if (campaign_id) {
                try {
                  const { data: cd } = await supabase.from('campaigns')
                    .select('name, topic, requirement').eq('id', campaign_id).single()
                  campaignCtx = cd
                } catch {}
              }

              // === AD TRIGGER: trust AI's contextual decision (no keyword matching) ===
              // hasAdOpportunity comes from evaluatePosts() which already considered brandConfig.
              // In-brand-group boost: if group name contains brand name AND the post is asking
              // for advice in the brand's domain, treat as ad opportunity even if AI score was
              // low or ad_opportunity flag was false — missing these is a direct lead leak
              // (observed 2026-04-21: Phương Nam asked for chatbot advice in OpenClaw VN group
              // and bot deflected with a counter-question instead of proposing OpenClaw).
              const brandNameLower = String(brandConfig?.brand_name || '').toLowerCase()
              const groupNameLower = (group?.name || '').toLowerCase()
              const inBrandGroup = brandNameLower && groupNameLower.includes(brandNameLower)
              const postRequestsAdvice = /(xin\s*gợi\s*ý|cho\s*(em|mình|mk|m)?\s*hỏi|tư\s*vấn|giúp\s*(em|mình|với)|chia\s*sẻ\s*(chút\s*)?kinh\s*nghiệm|các\s*bác\s*cho)/i.test(postText)
              const brandGroupAdBoost = inBrandGroup && postRequestsAdvice && brandConfig?.brand_name
              if (brandGroupAdBoost && !hasAdOpportunity) {
                console.log(`[NURTURE] 📢 In-brand-group advice request — boosting to ad opportunity for post #${post.index}`)
              }
              const adGatePasses = (hasAdOpportunity || brandGroupAdBoost) &&
                                   ((evaluation?.score || 0) >= 6 || brandGroupAdBoost)
              if (canDoAdComment && adCommentsToday < AD_COMMENT_DAILY_LIMIT && adGatePasses && brandConfig?.brand_name) {
                try {
                  // Extract any existing comments from the post to avoid duplicating brand mentions
                  const existingComments = Array.isArray(post.comments)
                    ? post.comments.map(c => c?.text || c?.body || '').filter(Boolean).slice(0, 5)
                    : []

                  const oppResult = await generateOpportunityComment({
                    postContent: postText,
                    brandName: brandConfig.brand_name,
                    brandDescription: brandConfig.brand_description || '',
                    brandVoice: brandConfig.brand_voice || brandConfig.tone || 'thân thiện, tự nhiên',
                    commentAngle: evaluation?.comment_angle || '',
                    existingComments,
                    language: postLanguage,
                    userId: payload.owner_id,
                  })
                  if (oppResult?.text && oppResult.text.length > 5) {
                    commentResult = oppResult
                    adTriggered = true
                    adCommentsToday++
                    console.log(`[NURTURE] 📢 Ad comment triggered by AI eval (score:${evaluation.score}, reason:"${(evaluation.ad_reason || '').substring(0, 60)}") — ad #${adCommentsToday}/${AD_COMMENT_DAILY_LIMIT}`)
                  }
                } catch (adErr) {
                  console.warn(`[NURTURE] Ad comment generation failed: ${adErr.message}, falling back to normal`)
                }
              }

              // Fix 2: pull thread comments captured during the post extraction step
              const postThreadComments = Array.isArray(post.threadComments) ? post.threadComments : []

              // Normal comment flow (if ad not triggered)
              if (!commentResult) {
                commentResult = await generateSmartComment({
                  postText, postAuthor,
                  group: { name: group.name, member_count: group.member_count },
                  campaign: campaignCtx,
                  nick: { id: account.id, username: account.username, created_at: account.created_at, mission: config?.nick_mission, persona_config: account.persona_config },
                  topic, commentAngle,
                  ownerId: payload.owner_id,
                  threadComments: postThreadComments, // Fix 2
                  adConfig, hasAdOpportunity,
                  language: postLanguage,
                })
              }

              // Fallback to old generateComment if Brain fails
              if (!commentResult) {
                commentResult = await generateComment({
                  postText, groupName: group.name, topic,
                  style: config?.comment_style || 'casual',
                  language: postLanguage,
                  userId: payload.owner_id,
                  templates: config?.comment_templates,
                })
              }

              const commentText = typeof commentResult === 'object' ? commentResult.text : commentResult
              const isAI = typeof commentResult === 'object' ? (commentResult.ai || commentResult.smart) : false
              const generatorProvider = typeof commentResult === 'object' ? (commentResult.provider || null) : null
              // Normalize provider → display label. DeepSeek is Hermes's
              // primary backend; orchestrator may return either name.
              const providerLabelMap = {
                hermes: 'Hermes',
                deepseek: 'Hermes',
                openai: 'OpenAI',
                gemini: 'Gemini',
                claude: 'Claude',
                anthropic: 'Claude',
                template: 'Template',
              }
              const generatorLabel = generatorProvider
                ? (providerLabelMap[String(generatorProvider).toLowerCase()] || generatorProvider)
                : (isAI ? 'AI' : 'Template')

              // === QUALITY GATE: Check comment quality before posting ===
              // Phase 6 Fix 4: gate now considers thread comments — comment must address
              // the actual ongoing discussion, not just the post body.
              if (commentText && commentText.length > 6) {
                const gate = await qualityGateComment({
                  comment: commentText, postText,
                  threadComments: postThreadComments,
                  group: { name: group.name },
                  topic, nick: { id: account.id, username: account.username, persona_config: account.persona_config },
                  ownerId: payload.owner_id,
                  brandConfig, // enables ad-drift rejection when brand name appears in off-domain posts
                })
                if (!gate.approved) {
                  console.log(`[NURTURE] ❌ Quality gate REJECTED: "${commentText.substring(0, 50)}..." (score: ${gate.score}, reason: ${gate.reason})`)
                  logger.log('comment_rejected', {
                    target_type: 'group', target_name: group.name,
                    details: { comment: commentText, score: gate.score, reason: gate.reason, post_author: postAuthor },
                  })
                  continue // Skip this post, don't waste comment budget
                }
                console.log(`[NURTURE] ✅ Quality gate PASSED (score: ${gate.score})`)
              }

              // Extract post URL + ID for logging
              const thisUrl = post.postUrl || null
              let fbPostId = null
              if (thisUrl) {
                const m = thisUrl.match(/(?:posts|permalink)\/(\d+)/) || thisUrl.match(/story_fbid=(\d+)/)
                if (m) fbPostId = m[1]
              }

              // PRE-LOG: Create comment_logs entry BEFORE posting (status='pending')
              // to serve as cross-session dedup source. Table has a CHECK
              // constraint status IN ('pending','done','failed','dismissed')
              // — previous code used 'posting' which silently violated and
              // insert failed, leaving table empty → dedup returned nothing
              // → same post got commented on every agent restart (observed:
              // Việt commented "929984039659793" twice 15:28 & 16:13).
              let commentLogId = null
              try {
                const { data: logEntry, error: logErr } = await supabase.from('comment_logs').insert({
                  owner_id: payload.owner_id || payload.created_by, account_id,
                  fb_post_id: fbPostId,
                  comment_text: commentText, source_name: group.name,
                  status: 'pending', campaign_id,
                  ai_generated: isAI,
                  post_url: thisUrl,
                }).select('id').single()
                if (logErr) {
                  console.warn(`[NURTURE] Pre-log insert error: ${logErr.message}`)
                } else {
                  commentLogId = logEntry?.id
                }
              } catch (logErr) {
                console.warn(`[NURTURE] Pre-log failed: ${logErr.message} — posting anyway`)
              }

              // Add to dedup BEFORE posting (prevent double-comment even if crash)
              if (thisUrl) commentedUrls.add(thisUrl)
              if (fbPostId) commentedPostIds.add(fbPostId)

              // TYPE + SUBMIT comment — log each failure mode explicitly
              try {
                await commentBox.click({ force: true, timeout: 5000 })
              } catch (clickErr) {
                logFail('textbox_click_failed', { err: clickErr.message })
                continue
              }
              await R.sleepRange(500, 1000)
              // Human-like typing: char-by-char with variable delay, plus
              // ~15% chance of typo+backspace to look less robotic. Real
              // people hit the wrong key, notice, backspace, retype — bots
              // never do. Also ~20% chance of a 'thinking pause' (400-
              // 1200ms) somewhere mid-sentence.
              try {
                const adjacentKeys = {
                  'a':'sw', 'b':'vn', 'c':'xv', 'd':'sf', 'e':'wr', 'f':'dg',
                  'g':'fh', 'h':'gj', 'i':'uo', 'j':'hk', 'k':'jl', 'l':'k',
                  'm':'n', 'n':'bm', 'o':'ip', 'p':'o', 'q':'w', 'r':'et',
                  's':'ad', 't':'ry', 'u':'yi', 'v':'cb', 'w':'qe', 'x':'zc',
                  'y':'tu', 'z':'x',
                }
                const thinkingPauseAt = Math.random() < 0.2 ? Math.floor(commentText.length * (0.3 + Math.random() * 0.4)) : -1
                for (let i = 0; i < commentText.length; i++) {
                  const char = commentText[i]
                  // Thinking pause mid-sentence
                  if (i === thinkingPauseAt) {
                    await R.sleepRange(400, 1200)
                  }
                  // 15% chance typo (lowercase letters only, avoid punctuation/VN diacritics)
                  const isLowerLetter = /^[a-z]$/.test(char)
                  if (isLowerLetter && adjacentKeys[char] && Math.random() < 0.15) {
                    const wrong = adjacentKeys[char][Math.floor(Math.random() * adjacentKeys[char].length)]
                    await page.keyboard.type(wrong, { delay: Math.random() * 80 + 30 })
                    await R.sleepRange(120, 320) // notice delay
                    await page.keyboard.press('Backspace')
                    await R.sleepRange(80, 220)
                  }
                  await page.keyboard.type(char, { delay: Math.random() * 80 + 30 })
                }
              } catch (typeErr) {
                logFail('keyboard_type_failed', { err: typeErr.message, text_len: commentText.length })
                continue
              }
              await R.sleepRange(800, 1500)
              // Randomize submit method: 70% Enter key, 30% click send
              // button. Always using same submit path is a subtle bot tell
              // FB behavioral analytics could pick up over time.
              const useSendButton = Math.random() < 0.3
              let submitted = false
              if (useSendButton) {
                try {
                  submitted = await page.evaluate(() => {
                    const btns = document.querySelectorAll('div[role="button"][aria-label="Comment"], div[role="button"][aria-label="Bình luận"]')
                    for (const b of btns) {
                      if (!b.closest('[role="article"], [data-ad-rendering-role="story_message"]')) continue
                      try { b.click(); return true } catch {}
                    }
                    return false
                  })
                } catch {}
                if (!submitted) {
                  // fallback to Enter
                  try { await page.keyboard.press('Enter'); submitted = true } catch (e) {
                    logFail('enter_press_failed', { err: e.message, tried_send_btn: true })
                    continue
                  }
                }
              } else {
                try {
                  await page.keyboard.press('Enter')
                  submitted = true
                } catch (enterErr) {
                  logFail('enter_press_failed', { err: enterErr.message })
                  continue
                }
              }
              await R.sleepRange(2000, 4000)

              // Verify submission actually happened — Lexical sometimes
              // eats Enter silently. Look for the comment we just posted
              // in the DOM; if not present, our "success" was a lie.
              try {
                const snippet = commentText.substring(0, 40)
                const appeared = await page.evaluate((s) => {
                  if (!s || s.length < 5) return true
                  return (document.body?.innerText || '').includes(s)
                }, snippet)
                if (!appeared) {
                  // Fallback: click the send button if Enter didn't fire
                  const sent = await page.evaluate(() => {
                    const btns = document.querySelectorAll('div[role="button"][aria-label="Comment"], div[role="button"][aria-label="Bình luận"]')
                    for (const b of btns) {
                      if (!b.closest('[role="article"]')) continue
                      try { b.click(); return true } catch {}
                    }
                    return false
                  })
                  if (sent) {
                    console.log(`[NURTURE] Enter didn't fire, clicked send button for post #${post.index}`)
                    await R.sleepRange(1500, 2500)
                  } else {
                    logFail('submit_verification_failed', { snippet })
                    continue
                  }
                }
              } catch (verifyErr) {
                console.warn(`[NURTURE] Submit verify threw (non-fatal): ${verifyErr.message}`)
              }

              // POST-SUCCESS: Update log status + increment counters
              totalComments++
              tracker.increment('comment')
              result.comments_done++
              commented++

              // Update comment_logs status to 'done'
              if (commentLogId) {
                try { await supabase.from('comment_logs').update({ status: 'done' }).eq('id', commentLogId) } catch {}
              }

              // Increment budget (separate try/catch — don't crash if this fails)
              try { await supabase.rpc('increment_budget', { p_account_id: account_id, p_action_type: 'comment' }) } catch {}

              // Mark post as commented in group_post_scores (for scan-based flow)
              if (fbPostId) {
                try { await supabase.from('group_post_scores').update({ commented: true, commented_at: new Date().toISOString() })
                  .eq('fb_post_id', fbPostId).eq('owner_id', payload.owner_id || payload.created_by) } catch {}
              }

              const isSoftAd = adTriggered || (hasAdOpportunity && brandConfig?.brand_name && commentText.toLowerCase().includes(brandConfig.brand_name.toLowerCase()))
              console.log(`[NURTURE] ✅ Commented #${totalComments} (${generatorLabel}${adTriggered ? ' +AD-TRIGGERED' : isSoftAd ? ' +AD' : ''}): "${commentText.substring(0, 50)}..."`)

              // Flag lead_potential authors for friend request pipeline
              if (isLeadPotential && post.author && campaign_id) {
                try {
                  // Extract author FB ID from post if available
                  const authorUid = post.authorFbId || null
                  if (authorUid) {
                    await supabase.from('target_queue').upsert({
                      campaign_id,
                      source_role_id: role_id,
                      target_role_id: role_id, // will be reassigned by connect role
                      fb_user_id: authorUid,
                      fb_user_name: post.author,
                      source_group_name: group.name,
                      active_score: 80, // high score = lead potential from AI
                      status: 'pending',
                      ai_score: evaluation?.score || 7,
                      ai_type: 'potential_buyer',
                      ai_reason: `Lead flagged from comment: ${evaluation?.reason || 'AI detected'}`,
                    }, { onConflict: 'campaign_id,fb_user_id' })
                    console.log(`[NURTURE] 🎯 Added lead [${post.author}] to target_queue for FR`)
                  }
                } catch {}
              }
              const logActionType = adTriggered ? 'opportunity_comment' : 'comment'
              try { await logger.log(logActionType, { target_type: 'group', target_id: group.fb_group_id, target_name: group.name, target_url: group.url, details: { comment_text: commentText.substring(0, 200), post_text: postText.substring(0, 200), post_url: thisUrl, ai_generated: isAI, generator: generatorLabel, provider: generatorProvider, post_author: postAuthor, soft_ad: isSoftAd, ad_triggered: adTriggered, ad_opportunity: hasAdOpportunity, lead_potential: isLeadPotential, comment_angle: commentAngle } }) } catch {}

              await R.sleepRange(90000, 180000) // 90-180 seconds gap
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

                // AI Brain: Evaluate if this person is worth connecting
                try {
                  const leadEval = await evaluateLeadQuality({
                    person: { name: member.name, fb_user_id: member.fb_user_id },
                    postContext: `Tương tác trong nhóm "${group.name}" về ${topic}`,
                    campaign: { name: rawTopic },
                    topic,
                    ownerId: payload.owner_id,
                  })
                  if (!leadEval.worth || leadEval.score < 4) {
                    console.log(`[NURTURE] Skip FR to ${member.name} — AI Brain: ${leadEval.reason} (score: ${leadEval.score}, type: ${leadEval.type})`)
                    continue
                  }
                  console.log(`[NURTURE] AI Brain approved FR to ${member.name} (score: ${leadEval.score}, type: ${leadEval.type})`)
                } catch {}

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

      // Phase 2: re-score group after visit and persist tier
      try {
        const { scoreGroup } = require('../../lib/ai-brain')
        const liked = result.likes_done || 0
        const commented = result.comments_done || 0
        const memberCount = group.member_count || 1
        const engagementRate = (liked + commented) / Math.max(1, memberCount)
        const postsPerDay = (result.posts_seen || result.eligible_posts || 0)
        const topicRelevance = group.ai_join_score || group.ai_relevance?.score || 5
        const langMatch = !group.language || campaignLanguage === 'mixed' || group.language === campaignLanguage
        const { score, tier } = scoreGroup({
          engagementRate, postsPerDay, topicRelevance, languageMatch: langMatch,
        })
        const yieldedAnything = (liked + commented) > 0
        const update = {
          score_tier: tier,
          engagement_rate: engagementRate,
          last_scored_at: new Date().toISOString(),
          total_interactions: (group.total_interactions || 0) + liked + commented,
          consecutive_skips: yieldedAnything ? 0 : ((group.consecutive_skips || 0) + 1),
        }
        if (yieldedAnything) update.last_yield_at = new Date().toISOString()
        await supabase.from('fb_groups').update(update)
          .eq('fb_group_id', group.fb_group_id).eq('account_id', account_id)
        // Phase 9: mirror score/tier + last_nurtured_at into campaign_groups junction
        if (group._junction_id) {
          try {
            await supabase.from('campaign_groups').update({
              score, tier, last_nurtured_at: new Date().toISOString(),
            }).eq('id', group._junction_id)
          } catch {}
        } else if (campaign_id && group.id) {
          try {
            await supabase.from('campaign_groups').update({
              score, tier, last_nurtured_at: new Date().toISOString(),
            }).eq('campaign_id', campaign_id).eq('group_id', group.id)
          } catch {}
        }
        console.log(`[NURTURE] 📊 ${group.name}: score=${score} tier=${tier} (eng=${engagementRate.toFixed(4)}, skips=${update.consecutive_skips})`)
      } catch (scErr) {
        console.warn(`[NURTURE] scoreGroup failed: ${scErr.message}`)
      }

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

    // ══════════════════════════════════════════════════════════
    // Phase 19: AI-driven continuous operation — post-session decision
    // AI decides: when to run next, what to do, based on actual performance.
    // ══════════════════════════════════════════════════════════
    try {
      // Gather context for AI
      const { data: kpiRow } = await supabase.from('nick_kpi_daily')
        .select('target_likes, done_likes, target_comments, done_comments, kpi_met')
        .eq('campaign_id', campaign_id).eq('account_id', account_id)
        .eq('date', new Date().toISOString().split('T')[0]).maybeSingle()

      const { count: groupsAvailable } = await supabase.from('campaign_groups')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaign_id).eq('assigned_nick_id', account_id)
        .eq('status', 'active')
      const { count: groupsPending } = await supabase.from('fb_groups')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', account_id).eq('pending_approval', true).eq('is_member', false)

      const vnHour = new Date(Date.now() + 7 * 3600000).getUTCHours()
      const skipReasons = groupResults.map(g => g.skip_reason).filter(Boolean)

      const sessionCtx = {
        groups_visited: groupResults.length,
        likes: totalLikes,
        comments: totalComments,
        duration_seconds: duration,
        skip_reasons: [...new Set(skipReasons)],
        groups_available: groupsAvailable || 0,
        groups_pending: groupsPending || 0,
        kpi: {
          likes_done: kpiRow?.done_likes || 0, likes_target: kpiRow?.target_likes || 0,
          comments_done: kpiRow?.done_comments || 0, comments_target: kpiRow?.target_comments || 0,
          met: kpiRow?.kpi_met || false,
        },
      }

      const axios = require('axios')
      const API_URL = process.env.API_URL || 'http://localhost:3000'
      const AUTH_TOKEN = process.env.AGENT_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.AGENT_USER_TOKEN || ''

      let decision = null
      try {
        const res = await axios.post(`${API_URL}/ai/generate`, {
          function_name: 'ai_pilot',
          messages: [{ role: 'user', content: `Nick "${account.username}" vừa xong nurture session:
Groups: ${sessionCtx.groups_visited} | Likes: ${sessionCtx.likes} | Comments: ${sessionCtx.comments} | Duration: ${duration}s
Skip reasons: ${sessionCtx.skip_reasons.join(', ') || 'none'}
KPI: likes ${sessionCtx.kpi.likes_done}/${sessionCtx.kpi.likes_target}, comments ${sessionCtx.kpi.comments_done}/${sessionCtx.kpi.comments_target}${sessionCtx.kpi.met ? ' (MET)' : ''}
Groups available: ${sessionCtx.groups_available} | Pending: ${sessionCtx.groups_pending}
Giờ VN: ${vnHour}h | Nick age: ${getNickAgeDays(account)}d | Status: ${account.status}

Quyết định next actions (JSON):
{"next_nurture_minutes":45,"do_feed_browse":true,"feed_browse_minutes":20,"check_pending_groups":false,"scout_new_groups":false,"rest_reason":null,"reasoning":"giải thích ngắn"}

Hướng dẫn: KPI gần đạt→tăng interval. Nhiều skip→ưu tiên scout. 0 comments→check groups. Ngoài 6-23h→rest. Nick<21d→rest.
Chỉ trả JSON.` }],
          max_tokens: 200, temperature: 0.1,
        }, {
          timeout: 10000,
          headers: { 'Content-Type': 'application/json',
            ...(AUTH_TOKEN && { Authorization: `Bearer ${AUTH_TOKEN}` }),
            ...(payload.owner_id && { 'x-user-id': payload.owner_id }),
          },
        })
        const text = res.data?.text || res.data?.result || ''
        const m = String(text).match(/\{[\s\S]*\}/)
        if (m) decision = JSON.parse(m[0])
      } catch (aiErr) {
        console.warn(`[AI-OPS] post-session AI failed: ${aiErr.message}`)
      }

      // Fallback defaults
      if (!decision) {
        decision = {
          next_nurture_minutes: 45,
          do_feed_browse: true,
          feed_browse_minutes: 20,
          check_pending_groups: (groupsPending || 0) > 0,
          scout_new_groups: (groupsAvailable || 0) < 3,
          rest_reason: null,
          reasoning: 'AI unavailable — defaults',
        }
      }

      // Apply decisions
      const now = Date.now()
      const jobsToCreate = []

      // Next nurture (if not resting and within active hours)
      if (!decision.rest_reason && vnHour >= 6 && vnHour < 23) {
        const nextAt = new Date(now + (decision.next_nurture_minutes || 45) * 60000)
        const { count: dupCount } = await supabase.from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('type', 'campaign_nurture')
          .in('status', ['pending', 'claimed', 'running'])
          .filter('payload->>campaign_id', 'eq', campaign_id)
          .filter('payload->>account_id', 'eq', account_id)
        if ((dupCount || 0) === 0) {
          jobsToCreate.push({
            type: 'campaign_nurture', priority: 3,
            payload: { ...payload, ai_scheduled: true, reason: decision.reasoning },
            status: 'pending', scheduled_at: nextAt.toISOString(),
            created_by: payload.owner_id,
          })
        }
      }

      // Feed browse
      if (decision.do_feed_browse) {
        jobsToCreate.push({
          type: 'nurture_feed', priority: 5,
          payload: { account_id, campaign_id, owner_id: payload.owner_id },
          status: 'pending',
          scheduled_at: new Date(now + (decision.feed_browse_minutes || 20) * 60000).toISOString(),
          created_by: payload.owner_id,
        })
      }

      // Check pending groups
      if (decision.check_pending_groups && (groupsPending || 0) > 0) {
        const { data: pGroups } = await supabase.from('fb_groups')
          .select('id, fb_group_id, name').eq('account_id', account_id)
          .eq('pending_approval', true).eq('is_member', false).limit(3)
        for (const g of pGroups || []) {
          jobsToCreate.push({
            type: 'check_group_membership', priority: 3,
            payload: { fb_group_id: g.fb_group_id, group_row_id: g.id, account_id, group_name: g.name, campaign_id },
            status: 'pending',
            scheduled_at: new Date(now + 5 * 60000).toISOString(),
          })
        }
      }

      // Scout new groups
      if (decision.scout_new_groups) {
        const { count: scoutDup } = await supabase.from('jobs')
          .select('id', { count: 'exact', head: true })
          .eq('type', 'campaign_discover_groups')
          .in('status', ['pending', 'claimed', 'running'])
          .filter('payload->>campaign_id', 'eq', campaign_id)
        if ((scoutDup || 0) === 0) {
          jobsToCreate.push({
            type: 'campaign_discover_groups', priority: 3,
            payload: { ...payload, reason: 'ai_continuous_ops' },
            status: 'pending',
            scheduled_at: new Date(now + 10 * 60000).toISOString(),
            created_by: payload.owner_id,
          })
        }
      }

      if (jobsToCreate.length) {
        await supabase.from('jobs').insert(jobsToCreate)
        console.log(`[AI-OPS] Scheduled ${jobsToCreate.length} follow-ups: ${decision.reasoning}`)
      }

      // Log decision for ops learning
      await supabase.from('campaign_activity_log').insert({
        campaign_id, account_id, owner_id: payload.owner_id,
        action_type: 'ai_next_action',
        result_status: decision.rest_reason ? 'skipped' : 'success',
        details: { decision, session: sessionCtx, jobs_scheduled: jobsToCreate.length },
      }).then(() => {}, () => {})

    } catch (opsErr) {
      console.warn(`[AI-OPS] post-session decision failed: ${opsErr.message}`)
    }

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

    // Level B: Remember nick behavior patterns
    try {
      const { remember } = require('../../lib/ai-memory')
      if (campaign_id && account_id) {
        // Track comment success rate per nick
        const commentLogs = logger.buffer?.filter(l => l.action_type === 'comment') || []
        const commentSuccess = commentLogs.filter(l => l.result_status === 'success').length
        const commentTotal = commentLogs.length
        if (commentTotal > 0) {
          await remember(supabase, {
            campaignId: campaign_id, accountId: account_id,
            memoryType: 'nick_behavior', key: 'comment_success_rate',
            value: { rate: Math.round(commentSuccess / commentTotal * 100), sample: commentTotal },
          })
        }

        // Track which hour this nick is active
        const hour = new Date().getHours()
        await remember(supabase, {
          campaignId: campaign_id, accountId: account_id,
          memoryType: 'nick_behavior', key: 'active_hour_' + hour,
          value: { hour, actions: logger.flushed || 0 },
        })
      }
    } catch {}

    if (page) // Keep page on FB for session reuse
    await releaseSession(account_id, supabase)
  }
}

module.exports = campaignNurture
