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

  // ============================================
  // SOURCES CRUD
  // ============================================

  // GET /monitoring/sources
  fastify.get('/sources', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('monitored_sources')
      .select('*')
      .eq('owner_id', getOwnerId(req))
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // POST /monitoring/sources
  fastify.post('/sources', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { source_type, fb_source_id, name, url } = req.body || {}

    if (!fb_source_id?.trim()) return reply.code(400).send({ error: 'fb_source_id required' })

    let type = source_type || 'page'
    if (url && url.includes('/groups/')) type = 'group'

    let sourceUrl = url
    if (!sourceUrl) {
      sourceUrl = type === 'group'
        ? `https://www.facebook.com/groups/${fb_source_id}`
        : `https://www.facebook.com/${fb_source_id}`
    }

    const nextFetch = new Date(Date.now() + 60 * 1000)

    const { data, error } = await supabase.from('monitored_sources').insert({
      owner_id: req.user.id,
      source_type: type,
      fb_source_id: fb_source_id.trim(),
      name: name || null,
      url: sourceUrl,
      is_active: true,
      fetch_interval_minutes: 60,
      next_fetch_at: nextFetch.toISOString(),
    }).select().single()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'Nguồn này đã được thêm' })
      return reply.code(500).send({ error: error.message })
    }
    return reply.code(201).send(data)
  })

  // PUT /monitoring/fetch-method — bulk update fetch_method for all user's sources
  fastify.put('/fetch-method', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { fetch_method, fetch_account_id } = req.body || {}
    if (!fetch_method || !['apify', 'cookie'].includes(fetch_method)) {
      return reply.code(400).send({ error: 'fetch_method must be apify or cookie' })
    }
    const updates = { fetch_method }
    if (fetch_method === 'cookie' && fetch_account_id) {
      updates.fetch_account_id = fetch_account_id
    } else if (fetch_method === 'apify') {
      updates.fetch_account_id = null
    }
    const { error } = await supabase
      .from('monitored_sources')
      .update(updates)
      .eq('owner_id', req.user.id)
    if (error) return reply.code(500).send({ error: error.message })
    return { success: true, fetch_method }
  })

  // PUT /monitoring/sources/:id
  fastify.put('/sources/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = ['name', 'is_active', 'fetch_interval_minutes', 'url']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase
      .from('monitored_sources')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /monitoring/sources/:id
  fastify.delete('/sources/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase
      .from('monitored_sources')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // ============================================
  // FETCH — returns posts to frontend (cached in localStorage)
  // ============================================

  // GET /monitoring/sources/:id/posts — đọc posts từ Redis cache (cross-browser)
  fastify.get('/sources/:id/posts', { preHandler: fastify.authenticate }, async (req, reply) => {
    const redis = getRedis()
    if (!redis) return { posts: [], total: 0, source_name: null, fetchedAt: null }
    try {
      const cached = await redis.get(postsKey(req.user.id, req.params.id))
      if (cached) {
        const data = typeof cached === 'string' ? JSON.parse(cached) : cached
        return { posts: data.posts || [], total: (data.posts || []).length, source_name: data.source_name, fetchedAt: data.fetchedAt }
      }
    } catch {}
    return { posts: [], total: 0, source_name: null, fetchedAt: null }
  })

  // POST /monitoring/sources/:id/fetch-now — returns posts directly
  // body.method: 'apify' (default) | 'cookie'
  // body.account_id: required when method === 'cookie'
  fastify.post('/sources/:id/fetch-now', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { method = 'apify', account_id } = req.body || {}

    const { data: source } = await supabase
      .from('monitored_sources')
      .select('*')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (!source) return reply.code(404).send({ error: 'Source not found' })

    // --- Cookie method: create agent job, poll for result ---
    if (method === 'cookie') {
      if (!account_id) return reply.code(400).send({ error: 'account_id required for cookie method' })

      // Check agent online
      const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id')
        .gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
      if (!agents?.length) return reply.code(503).send({ error: 'Agent không online. Khởi động agent trước.' })

      const sourceUrl = source.url || `https://www.facebook.com/${source.source_type === 'group' ? 'groups/' : ''}${source.fb_source_id}`

      // Create job
      const { data: job, error: jobErr } = await supabase.from('jobs').insert({
        type: 'fetch_source_cookie',
        payload: {
          account_id,
          source_url: sourceUrl,
          source_id: source.id,
          source_type: source.source_type,
          owner_id: req.user.id,
        },
        status: 'pending',
        scheduled_at: new Date().toISOString(),
        created_by: req.user.id,
      }).select().single()

      if (jobErr) return reply.code(500).send({ error: jobErr.message })

      // Poll for result (timeout 90s)
      const deadline = Date.now() + 90000
      while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000))
        const { data: updated } = await supabase.from('jobs').select('status, result, error_message')
          .eq('id', job.id).single()

        if (updated?.status === 'done') {
          const result = updated.result || {}
          const posts = result.posts || []
          const sourceName = result.source_name || source.name
          await cachePostsToRedis(req.user.id, req.params.id, posts, sourceName)
          return { posts, total: posts.length, source_name: sourceName }
        }
        if (updated?.status === 'failed') {
          return reply.code(500).send({ error: updated.error_message || 'Agent fetch failed' })
        }
        if (updated?.status === 'cancelled') {
          return reply.code(400).send({ error: 'Job was cancelled' })
        }
      }

      return reply.code(504).send({ error: 'Timeout — agent chưa trả kết quả sau 90s. Thử lại sau.' })
    }

    // --- Apify method (default) ---
    try {
      const posts = await fetchSourcePosts(supabase, source, req.log)
      // Re-read source to get updated name
      const { data: updatedSource } = await supabase
        .from('monitored_sources')
        .select('name')
        .eq('id', req.params.id)
        .single()
      const sourceName = updatedSource?.name || source.name
      await cachePostsToRedis(req.user.id, req.params.id, posts, sourceName)
      return { posts, total: posts.length, source_name: sourceName }
    } catch (err) {
      req.log.error({ err }, 'Fetch source failed')
      // Return user-friendly error
      const msg = err.message || 'Unknown error'
      if (msg.includes('actor-is-not-rented')) {
        return reply.code(400).send({ error: 'Apify actor cần được thuê (rent) trước khi sử dụng. Kiểm tra Apify Console.' })
      }
      if (msg.includes('usage hard limit exceeded') || msg.includes('platform-feature-disabled')) {
        return reply.code(429).send({ error: 'Apify đã hết quota tháng. Nạp thêm hoặc đổi API key trong Cài đặt.' })
      }
      if (msg.includes('ENOTFOUND') || msg.includes('fetch failed')) {
        return reply.code(502).send({ error: 'Không thể kết nối Apify. Kiểm tra kết nối mạng.' })
      }
      if (msg.includes('Không có Apify API key')) {
        return reply.code(400).send({ error: 'Chưa cấu hình Apify API key. Vào Cài đặt để thêm.' })
      }
      if (msg.includes('TIMEOUT') || msg.includes('FAILED') || msg.includes('ABORTED')) {
        return reply.code(502).send({ error: 'Apify actor chạy thất bại hoặc timeout. Thử lại sau.' })
      }
      return reply.code(500).send({ error: `Lỗi fetch: ${msg.substring(0, 200)}` })
    }
  })

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
          content: `Bạn là người có chuyên môn sâu trong lĩnh vực liên quan đến bài viết. Viết 1 comment tiếng Việt reply bài Facebook.

QUAN TRỌNG - TUYỆT ĐỐI KHÔNG:
- Câu sáo rỗng: "Cảm ơn chia sẻ", "Bài viết rất hữu ích", "Thông tin quý giá"
- Khen chung chung: "Hay quá", "Tuyệt vời", "Rất bổ ích"
- Mở đầu bằng "Cảm ơn anh/chị"
- Dùng hashtag, emoji quá 1 cái

YÊU CẦU:
- Giọng văn: ${toneInstruction}
- Đi thẳng vào nội dung, nói như người hiểu biết thật sự về chủ đề
- Bổ sung góc nhìn, kinh nghiệm thực tế, hoặc thông tin liên quan
- Nếu có ý kiến trái chiều hợp lý thì nêu ra (tạo thảo luận)
- Đặt câu hỏi cụ thể về chi tiết trong bài (không hỏi chung chung)
- 1-3 câu, ngắn gọn, đọc như người thật comment
- CHỈ trả về nội dung comment, không giải thích`
        },
        {
          role: 'user',
          content: `Bài viết từ "${source_name || 'Facebook'}"${author_name ? ` bởi ${author_name}` : ''}:\n\n${content_text.substring(0, 1500)}`
        }
      ]

      const result = await ai.call('caption_gen', messages, { max_tokens: 300 })
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

  // GET /monitoring/comment-logs — list comment history
  fastify.get('/comment-logs', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { status, account_id, limit = 100, offset = 0 } = req.query

    let query = supabase
      .from('comment_logs')
      .select('*, accounts(username)')
      .eq('owner_id', getOwnerId(req))
      .order('created_at', { ascending: false })
      .range(offset, offset + parseInt(limit) - 1)

    if (status) query = query.eq('status', status)
    if (account_id) query = query.eq('account_id', account_id)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // PUT /monitoring/comment-logs/:id — update status (called by agent after execution, or frontend for retry/dismiss)
  fastify.put('/comment-logs/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { status, error_message, job_id } = req.body || {}
    if (!status) return reply.code(400).send({ error: 'status required' })

    const updates = { status }
    if (error_message) updates.error_message = error_message
    if (status === 'done' || status === 'failed') updates.finished_at = new Date().toISOString()
    if (status === 'pending') {
      // Reset về pending (retry) — xóa error cũ, cập nhật job_id mới nếu có
      updates.error_message = null
      updates.finished_at = null
      if (job_id) updates.job_id = job_id
    }

    const { data, error } = await supabase
      .from('comment_logs')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // ============================================
  // SAVE POST — only when user interacts (click/like/comment)
  // ============================================

  // POST /monitoring/save-post — save a single post to DB
  fastify.post('/save-post', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { source_id, fb_post_id, author_name, content_text, post_url, image_url, reactions, comments, shares, posted_at, interaction_type } = req.body || {}

    if (!fb_post_id) return reply.code(400).send({ error: 'fb_post_id required' })

    const { data, error } = await supabase.from('monitored_posts').upsert({
      owner_id: req.user.id,
      source_id: source_id || null,
      fb_post_id,
      author_name: author_name || null,
      content_text: content_text || null,
      post_url: post_url || null,
      image_url: image_url || null,
      reactions: reactions || 0,
      comments: comments || 0,
      shares: shares || 0,
      posted_at: posted_at || null,
    }, { onConflict: 'owner_id,fb_post_id', ignoreDuplicates: false }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // ============================================
  // SAVED POSTS (DB) — posts user interacted with
  // ============================================

  // GET /monitoring/saved
  fastify.get('/saved', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { source_id, search, page = 1, limit = 50 } = req.query

    let query = supabase
      .from('monitored_posts')
      .select('*, monitored_sources(name, source_type, fb_source_id, avatar_url)', { count: 'exact' })
      .eq('owner_id', getOwnerId(req))
      .order('fetched_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (source_id) query = query.eq('source_id', source_id)
    if (search) query = query.ilike('content_text', `%${search}%`)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { data: data || [], total: count, page: Number(page), limit: Number(limit) }
  })

  // GET /monitoring/wall — kept for backward compat, same as /saved
  fastify.get('/wall', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { source_id, search, from_date, to_date, page = 1, limit = 50 } = req.query

    let query = supabase
      .from('monitored_posts')
      .select('*, monitored_sources(name, source_type, fb_source_id, avatar_url)', { count: 'exact' })
      .eq('owner_id', getOwnerId(req))
      .order('fetched_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (source_id) query = query.eq('source_id', source_id)
    if (to_date) query = query.lte('fetched_at', to_date)
    if (from_date) query = query.gte('fetched_at', from_date)
    if (search) query = query.ilike('content_text', `%${search}%`)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { data: data || [], total: count, page: Number(page), limit: Number(limit) }
  })
}

// Export for scheduler
module.exports.fetchSourcePosts = fetchSourcePosts
