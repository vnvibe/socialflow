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

  // ============================================
  // SOURCES CRUD
  // ============================================

  // GET /monitoring/sources
  fastify.get('/sources', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { account_id } = req.query

    let query = supabase
      .from('monitored_sources')
      .select('*, accounts:account_id(id, username, avatar_url, fb_user_id)')
      .eq('owner_id', getOwnerId(req))
      .order('created_at', { ascending: false })

    if (account_id) query = query.eq('account_id', account_id)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // POST /monitoring/sources
  fastify.post('/sources', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { source_type, fb_source_id, name, url, account_id } = req.body || {}

    if (!fb_source_id?.trim()) return reply.code(400).send({ error: 'fb_source_id required' })
    if (!account_id) return reply.code(400).send({ error: 'account_id required' })

    // Verify user owns this account
    const { data: acct } = await supabase.from('accounts').select('id, owner_id')
      .eq('id', account_id).single()
    if (!acct || acct.owner_id !== req.user.id) {
      return reply.code(403).send({ error: 'Khong co quyen su dung tai khoan nay' })
    }

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
      account_id,
      source_type: type,
      fb_source_id: fb_source_id.trim(),
      name: name || null,
      url: sourceUrl,
      is_active: true,
      fetch_method: 'cookie',
      fetch_account_id: account_id,
      fetch_interval_minutes: 60,
      next_fetch_at: nextFetch.toISOString(),
    }).select().single()

    if (error) {
      if (error.code === '23505') return reply.code(409).send({ error: 'Nguon nay da duoc them cho tai khoan nay' })
      return reply.code(500).send({ error: error.message })
    }
    return reply.code(201).send(data)
  })

  // PUT /monitoring/sources/:id
  fastify.put('/sources/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = ['name', 'is_active', 'fetch_interval_minutes', 'url', 'account_id']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    // Sync fetch_account_id when account_id changes
    if (updates.account_id) {
      updates.fetch_account_id = updates.account_id
      updates.fetch_method = 'cookie'
    }

    // Recalculate next_fetch_at when interval changes
    if (updates.fetch_interval_minutes !== undefined) {
      if (updates.fetch_interval_minutes === 0) {
        updates.next_fetch_at = null // OFF
      } else {
        updates.next_fetch_at = new Date(Date.now() + updates.fetch_interval_minutes * 60 * 1000).toISOString()
      }
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

  // GET /monitoring/sources/:id/posts — shared posts by fb_source_id
  fastify.get('/sources/:id/posts', { preHandler: fastify.authenticate }, async (req, reply) => {
    // Get fb_source_id from user's source
    const { data: src } = await supabase.from('monitored_sources')
      .select('fb_source_id, name')
      .eq('id', req.params.id)
      .eq('owner_id', getOwnerId(req))
      .single()
    if (!src) return reply.code(404).send({ error: 'Source not found' })

    const { data, error } = await supabase
      .from('monitored_posts')
      .select('*')
      .eq('fb_source_id', src.fb_source_id)
      .order('posted_at', { ascending: false, nullsFirst: false })
      .limit(50)

    if (error) return reply.code(500).send({ error: error.message })
    return { posts: data || [], total: (data || []).length, source_name: src.name || null }
  })

  // POST /monitoring/sources/:id/fetch-now — always uses cookie method
  fastify.post('/sources/:id/fetch-now', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: source } = await supabase
      .from('monitored_sources')
      .select('*')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (!source) return reply.code(404).send({ error: 'Source not found' })

    const accountId = source.account_id || source.fetch_account_id
    if (!accountId) return reply.code(400).send({ error: 'Source chua co tai khoan. Cap nhat tai khoan truoc.' })

    // --- Fetch dedup: skip if same fb_source_id was fetched recently (by any user) ---
    const DEDUP_MINUTES = 30
    const { data: recentFetch } = await supabase
      .from('monitored_sources')
      .select('last_fetched_at')
      .eq('fb_source_id', source.fb_source_id)
      .not('last_fetched_at', 'is', null)
      .gte('last_fetched_at', new Date(Date.now() - DEDUP_MINUTES * 60 * 1000).toISOString())
      .order('last_fetched_at', { ascending: false })
      .limit(1)

    if (recentFetch?.length > 0) {
      const { data: existingPosts } = await supabase
        .from('monitored_posts')
        .select('*')
        .eq('fb_source_id', source.fb_source_id)
        .order('posted_at', { ascending: false, nullsFirst: false })
        .limit(50)
      const posts = existingPosts || []

      await supabase.from('monitored_sources').update({
        last_fetched_at: new Date().toISOString(),
        next_fetch_at: new Date(Date.now() + (source.fetch_interval_minutes || 60) * 60 * 1000).toISOString(),
      }).eq('id', source.id)

      return { posts, total: posts.length, source_name: source.name, dedup: true }
    }

    // --- Cookie method: create agent job, poll for result ---
    const { data: agents } = await supabase.from('agent_heartbeats').select('agent_id')
      .gte('last_seen', new Date(Date.now() - 30000).toISOString()).limit(1)
    if (!agents?.length) return reply.code(503).send({ error: 'Agent khong online. Khoi dong agent truoc.' })

    const sourceUrl = source.url || `https://www.facebook.com/${source.source_type === 'group' ? 'groups/' : ''}${source.fb_source_id}`

    const { data: job, error: jobErr } = await supabase.from('jobs').insert({
      type: 'fetch_source_cookie',
      payload: {
        account_id: accountId,
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
        await upsertPostsToDB(supabase, posts, source.fb_source_id)
        return { posts, total: posts.length, source_name: sourceName }
      }
      if (updated?.status === 'failed') {
        return reply.code(500).send({ error: updated.error_message || 'Agent fetch failed' })
      }
      if (updated?.status === 'cancelled') {
        return reply.code(400).send({ error: 'Job was cancelled' })
      }
    }

    return reply.code(504).send({ error: 'Timeout — agent chua tra ket qua sau 90s. Thu lai sau.' })
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
  // SHARED POSTS — query by user's monitored fb_source_ids
  // ============================================

  // Helper: get user's source map { fb_source_id → { name, source_type, avatar_url, fb_source_id } }
  async function getUserSourceMap(ownerId) {
    const { data: sources } = await supabase
      .from('monitored_sources')
      .select('id, fb_source_id, name, source_type, avatar_url')
      .eq('owner_id', ownerId)
    const map = {}
    for (const s of (sources || [])) {
      map[s.fb_source_id] = { name: s.name, source_type: s.source_type, fb_source_id: s.fb_source_id, avatar_url: s.avatar_url }
    }
    return { sources: sources || [], map }
  }

  // Attach monitored_sources metadata to posts (for frontend compat)
  function enrichPosts(posts, sourceMap) {
    return posts.map(p => ({ ...p, monitored_sources: sourceMap[p.fb_source_id] || null }))
  }

  // GET /monitoring/saved
  fastify.get('/saved', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { source_id, search, page = 1, limit = 50 } = req.query
    const { sources, map: sourceMap } = await getUserSourceMap(getOwnerId(req))
    const fbSourceIds = sources.map(s => s.fb_source_id)
    if (!fbSourceIds.length) return { data: [], total: 0, page: Number(page), limit: Number(limit) }

    let query = supabase
      .from('monitored_posts')
      .select('*', { count: 'exact' })
      .in('fb_source_id', fbSourceIds)
      .order('fetched_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    // Filter by specific source: map source_id → fb_source_id
    if (source_id) {
      const src = sources.find(s => s.id === source_id)
      if (src) query = query.eq('fb_source_id', src.fb_source_id)
    }
    if (search) query = query.ilike('content_text', `%${search}%`)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { data: enrichPosts(data || [], sourceMap), total: count, page: Number(page), limit: Number(limit) }
  })

  // GET /monitoring/wall
  fastify.get('/wall', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { source_id, search, from_date, to_date, page = 1, limit = 50 } = req.query
    const { sources, map: sourceMap } = await getUserSourceMap(getOwnerId(req))
    const fbSourceIds = sources.map(s => s.fb_source_id)
    if (!fbSourceIds.length) return { data: [], total: 0, page: Number(page), limit: Number(limit) }

    let query = supabase
      .from('monitored_posts')
      .select('*', { count: 'exact' })
      .in('fb_source_id', fbSourceIds)
      .order('fetched_at', { ascending: false })
      .range((page - 1) * limit, page * limit - 1)

    if (source_id) {
      const src = sources.find(s => s.id === source_id)
      if (src) query = query.eq('fb_source_id', src.fb_source_id)
    }
    if (to_date) query = query.lte('fetched_at', to_date)
    if (from_date) query = query.gte('fetched_at', from_date)
    if (search) query = query.ilike('content_text', `%${search}%`)

    const { data, error, count } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return { data: enrichPosts(data || [], sourceMap), total: count, page: Number(page), limit: Number(limit) }
  })
}

// Export for scheduler
module.exports.fetchSourcePosts = fetchSourcePosts
