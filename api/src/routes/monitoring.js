const { runApifyActor } = require('../services/apify')
const { getOrchestratorForUser } = require('../services/ai/orchestrator')
const { getRedis } = require('../lib/redis')

const POSTS_TTL = 24 * 60 * 60 // 24h

function postsKey(userId, sourceId) {
  return `monitor:posts:${userId}:${sourceId}`
}

async function cachePostsToRedis(userId, sourceId, posts, sourceName) {
  const redis = getRedis()
  if (!redis) return
  try {
    await redis.setex(postsKey(userId, sourceId), POSTS_TTL, JSON.stringify({ posts, source_name: sourceName, fetchedAt: Date.now() }))
  } catch {}
}

/**
 * Bulk upsert fetched posts into monitored_posts table.
 * Posts are shared globally — keyed by fb_post_id (unique).
 * fb_source_id links posts to monitored_sources for cross-user sharing.
 */
async function upsertPostsToDB(supabase, posts, fbSourceId) {
  if (!posts?.length) return
  const rows = posts.map(p => ({
    fb_post_id: p.fb_post_id,
    fb_source_id: fbSourceId || null,
    author_name: p.author_name || null,
    author_fb_id: p.author_fb_id || null,
    content_text: p.content_text || null,
    post_url: p.post_url || null,
    image_url: p.image_url || null,
    reactions: p.reactions || 0,
    comments: p.comments || 0,
    shares: p.shares || 0,
    posted_at: p.posted_at || null,
    fetched_at: new Date().toISOString(),
  }))
  try {
    await supabase.from('monitored_posts')
      .upsert(rows, { onConflict: 'fb_post_id', ignoreDuplicates: false })
  } catch (err) {
    console.error('[MONITORING] upsertPostsToDB error:', err.message)
  }
}

// apify/facebook-posts-scraper for pages, apify/facebook-groups-scraper for groups
const ACTOR_FB_PAGES = 'apify~facebook-posts-scraper'
const ACTOR_FB_GROUPS = 'apify~facebook-groups-scraper'

/**
 * Extract post ID from various URL formats
 */
function extractPostId(url) {
  if (!url) return null
  const m = url.match(/\/posts\/(\d+)/) ||
    url.match(/story_fbid=(\d+)/) ||
    url.match(/permalink\/(\d+)/) ||
    url.match(/\/(\d{10,})(?:\/|$|\?)/)
  return m ? m[1] : null
}

/**
 * Normalize Apify facebook-posts-scraper output to our schema.
 * Handles multiple actor output formats (apify official, community actors).
 */
function normalizePost(item) {
  const postUrl = item.url || item.postUrl || item.link || ''
  const fbPostId = item.postId || item.post_id || item.id || item.facebookId || extractPostId(postUrl) || null

  // Reactions: could be number, or object with breakdown {like, love, haha, ...}
  let reactions = 0
  if (typeof item.reactionsCount === 'number') {
    reactions = item.reactionsCount
  } else if (item.reactionsCount && typeof item.reactionsCount === 'object') {
    reactions = Object.values(item.reactionsCount).reduce((sum, v) => sum + (Number(v) || 0), 0)
  } else {
    reactions = item.likesCount || item.likes || item.reactions_count || item.likesTotal || 0
  }

  // Comments: could be number or array
  let comments = 0
  if (typeof item.commentsCount === 'number') {
    comments = item.commentsCount
  } else if (typeof item.comments_count === 'number') {
    comments = item.comments_count
  } else if (Array.isArray(item.comments)) {
    comments = item.comments.length
  } else if (typeof item.comments === 'number') {
    comments = item.comments
  }

  // Shares
  const shares = item.sharesCount || item.shares || item.reshare_count || item.sharesTotal || 0

  // Images: could be string, array, or nested — handle many Apify formats
  const imageUrl = item.photoUrl || item.imageUrl || item.photo
    || item.fullSizeUrl || item.attachedUrl || item.pictureUrl
    || (Array.isArray(item.imageUrls) ? item.imageUrls[0] : null)
    || (Array.isArray(item.images) ? item.images[0] : null)
    || (Array.isArray(item.attachments) ? (item.attachments[0]?.photo || item.attachments[0]?.url || item.attachments[0]?.imageUrl) : null)
    || item.media?.[0]?.thumbnail || item.media?.[0]?.photo || item.media?.[0]?.url
    || null

  return {
    fb_post_id: fbPostId,
    author_name: item.user?.name || item.authorName || item.pageName || item.userName || '',
    author_fb_id: item.user?.id || item.authorId || item.userId || null,
    content_text: (item.text || item.postText || item.message || item.body || item.post_text || '').substring(0, 2000),
    post_url: postUrl,
    image_url: imageUrl,
    reactions,
    comments,
    shares,
    posted_at: item.time || item.date || item.timestamp || item.publishedAt || null,
  }
}

/**
 * Fetch posts for a monitored source via Apify.
 * Returns posts array (does NOT save to DB — frontend caches in localStorage).
 */
async function fetchSourcePosts(supabase, source, log) {
  const url = source.url || `https://www.facebook.com/${source.source_type === 'group' ? 'groups/' : ''}${source.fb_source_id}`

  const isGroup = source.source_type === 'group'
  const actorId = isGroup ? ACTOR_FB_GROUPS : ACTOR_FB_PAGES

  // Limit to 10 posts within 24h, sorted by newest first
  const input = isGroup
    ? { startUrls: [{ url }], resultsLimit: 10, onlyPostsNewerThan: '1 day', viewOption: 'CHRONOLOGICAL', maxComments: 0 }
    : { startUrls: [{ url }], resultsLimit: 10, onlyPostsNewerThan: '1 day', captionText: false }

  console.log(`[MONITORING] Using actor ${actorId} for ${isGroup ? 'group' : 'page'}: ${url}`)

  const items = await runApifyActor(supabase, actorId, input, log)

  console.log(`[MONITORING] Apify returned ${(items || []).length} items for ${source.fb_source_id}`)
  if (items?.length > 0) {
    console.log('[MONITORING] Sample item keys:', Object.keys(items[0]).join(', '))
    console.log('[MONITORING] Sample item:', JSON.stringify(items[0]).slice(0, 500))
  }

  // Filter out error items, then enforce hard limit of 10
  const validItems = ((items || []).filter(item => !item.error && !item.errorDescription)).slice(0, 10)

  // Auto-detect source name from first valid item if not set
  let detectedName = null
  if (validItems.length > 0) {
    const first = validItems[0]
    detectedName = first.groupTitle || first.groupName || first.pageName || first.pageTitle
      || first.channelName || first.sourceName || null
    // Don't use user.name as source name — that's the post author, not the group/page
  }

  const posts = validItems.map(item => {
    const normalized = normalizePost(item)
    if (!normalized.fb_post_id && normalized.post_url) {
      normalized.fb_post_id = 'url_' + Buffer.from(normalized.post_url).toString('base64').slice(0, 20)
    }
    // Attach source info for frontend display
    normalized.source_id = source.id
    normalized.source_name = detectedName || source.name || source.fb_source_id
    normalized.source_type = source.source_type
    return normalized
  }).filter(p => p.fb_post_id && p.content_text)

  // Filter to last 24h only (server-side)
  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000
  const recentPosts = posts.filter(p => {
    if (!p.posted_at) return true // keep posts without date
    return new Date(p.posted_at).getTime() > oneDayAgo
  })

  console.log(`[MONITORING] ${posts.length} total → ${recentPosts.length} within 24h`)

  // Update source: timestamps + auto-detected name
  const nextFetch = new Date(Date.now() + (source.fetch_interval_minutes || 60) * 60 * 1000)
  const updateData = {
    last_fetched_at: new Date().toISOString(),
    next_fetch_at: nextFetch.toISOString(),
  }
  // Only set name if source has no name yet and we detected one
  if (!source.name && detectedName) {
    updateData.name = detectedName
  }
  await supabase.from('monitored_sources').update(updateData).eq('id', source.id)

  return recentPosts
}

module.exports = async (fastify) => {
  const { supabase } = fastify

  // Helper: resolve effective owner_id (admin can impersonate via ?as_user=uuid)
  function getOwnerId(req) {
    const asUser = req.query?.as_user
    if (asUser && req.user.role === 'admin' && asUser !== req.user.id) {
      return asUser
    }
    return req.user.id
  }

  // SOURCES CRUD (/monitoring/sources GET/POST/PUT/DELETE) removed in
  // phase-3 streamline (2026-04-19): no frontend callers. monitored_sources
  // rows are still fetched by the campaign-scheduler auto-fetch cron; only
  // the HTTP management surface was dead.

  // ============================================
  // FETCH — on-demand (frontend trigger) — sources/:id/posts list endpoint
  // removed as part of sources CRUD cleanup (no frontend caller).
  // ============================================

  // POST /monitoring/sources/:id/fetch-now removed — no frontend caller.
  // Auto-fetch still runs from campaign-scheduler's cron via
  // monitored_sources.next_fetch_at.

  // ============================================
  // AI REPLY GENERATION
  // ============================================

  // POST /monitoring/generate-reply — AI generates a comment for a post
  fastify.post('/generate-reply', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { content_text, author_name, source_name, tone } = req.body || {}
    if (!content_text) return reply.code(400).send({ error: 'content_text required' })

    try {
      const ai = await getOrchestratorForUser(req.user.id, supabase)
      const toneInstruction = tone === 'professional' ? 'chuyên nghiệp, lịch sự'
        : tone === 'friendly' ? 'thân thiện, gần gũi'
        : tone === 'funny' ? 'hài hước, vui vẻ'
        : 'tự nhiên, phù hợp với ngữ cảnh'

      const messages = [
        {
          role: 'system',
          content: `Bạn là chuyên gia trong lĩnh vực bài viết đề cập. Viết 1 comment tiếng Việt trên Facebook.

PHONG CÁCH: Ngắn, tự nhiên như người dùng mạng xã hội thật. Giọng: ${toneInstruction}.

CẤM:
- Sáo rỗng: "Cảm ơn chia sẻ", "Bài hay quá", "Thông tin hữu ích"
- Mở đầu "Cảm ơn anh/chị", khen chung chung
- Hashtag, emoji quá 1 cái

YÊU CẦU:
- 1-2 câu MAX, viết như đang lướt feed rồi comment nhanh
- Chia sẻ kinh nghiệm thực tế hoặc góc nhìn riêng về chủ đề
- Có thể đặt 1 câu hỏi cụ thể hoặc nêu ý kiến trái chiều nhẹ
- Đọc phải thấy là người hiểu về lĩnh vực, không phải bot
- CHỈ trả về nội dung comment`
        },
        {
          role: 'user',
          content: `Bài từ "${source_name || 'Facebook'}"${author_name ? ` — ${author_name}` : ''}:\n\n${content_text.substring(0, 1500)}`
        }
      ]

      const result = await ai.call('caption_gen', messages, { max_tokens: 200 })
      const comment = (result.content || result.text || '').trim()
      return { comment }
    } catch (err) {
      req.log.error({ err }, 'AI generate reply failed')
      return reply.code(500).send({ error: 'Lỗi AI: ' + (err.message || 'Unknown').substring(0, 200) })
    }
  })

  // ============================================
  // COMMENT LOGS — persistent record of all comment actions
  // ============================================

  // POST /monitoring/comment-log — create log when sending comment job
  fastify.post('/comment-log', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { job_id, account_id, fb_post_id, post_url, source_name, comment_text } = req.body || {}
    if (!fb_post_id || !comment_text) return reply.code(400).send({ error: 'fb_post_id and comment_text required' })

    const { data, error } = await supabase.from('comment_logs').insert({
      owner_id: req.user.id,
      job_id: job_id || null,
      account_id: account_id || null,
      fb_post_id,
      post_url: post_url || null,
      source_name: source_name || null,
      comment_text,
      status: 'pending',
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // GET /monitoring/comment-logs + PUT /monitoring/comment-logs/:id removed:
  // no frontend useQuery, and agent writes directly via
  // supabase.from('comment_logs') instead of going through HTTP.

  // ============================================
  // SAVE POST — only when user interacts (click/like/comment)
  // ============================================

  // POST /monitoring/save-post — save a single post to DB (shared, keyed by fb_post_id)
  fastify.post('/save-post', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { source_id, fb_source_id, fb_post_id, author_name, content_text, post_url, image_url, reactions, comments, shares, posted_at } = req.body || {}

    if (!fb_post_id) return reply.code(400).send({ error: 'fb_post_id required' })

    // Resolve fb_source_id from source_id if not provided
    let resolvedFbSourceId = fb_source_id || null
    if (!resolvedFbSourceId && source_id) {
      const { data: src } = await supabase.from('monitored_sources').select('fb_source_id').eq('id', source_id).single()
      resolvedFbSourceId = src?.fb_source_id || null
    }

    const { data, error } = await supabase.from('monitored_posts').upsert({
      fb_post_id,
      fb_source_id: resolvedFbSourceId,
      author_name: author_name || null,
      content_text: content_text || null,
      post_url: post_url || null,
      image_url: image_url || null,
      reactions: reactions || 0,
      comments: comments || 0,
      shares: shares || 0,
      posted_at: posted_at || null,
    }, { onConflict: 'fb_post_id', ignoreDuplicates: false }).select().single()

    if (error) {
      console.error('[MONITORING] save-post error:', error.message, { fb_post_id, fb_source_id: resolvedFbSourceId })
      return reply.code(500).send({ error: error.message })
    }
    return data
  })

  // ============================================
  // SHARED-POST helpers + /saved, /wall, /bookmark* (7 endpoints) all
  // removed in phase-3 streamline — no frontend callers. If bookmark/wall
  // UI is revived later, re-add minimally from git history; don't keep
  // dead code on trunk.
}

// Export for scheduler
module.exports.fetchSourcePosts = fetchSourcePosts
