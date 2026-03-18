const { runApifyActor } = require('../services/apify')

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

  // Images: could be string, array, or nested
  const imageUrl = item.photoUrl || item.imageUrl || item.photo
    || (Array.isArray(item.imageUrls) ? item.imageUrls[0] : null)
    || (Array.isArray(item.images) ? item.images[0] : null)
    || item.media?.[0]?.thumbnail || null

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

  // ============================================
  // SOURCES CRUD
  // ============================================

  // GET /monitoring/sources
  fastify.get('/sources', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('monitored_sources')
      .select('*')
      .eq('owner_id', req.user.id)
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

  // POST /monitoring/sources/:id/fetch-now — returns posts directly
  fastify.post('/sources/:id/fetch-now', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: source } = await supabase
      .from('monitored_sources')
      .select('*')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (!source) return reply.code(404).send({ error: 'Source not found' })

    try {
      const posts = await fetchSourcePosts(supabase, source, req.log)
      // Re-read source to get updated name
      const { data: updatedSource } = await supabase
        .from('monitored_sources')
        .select('name')
        .eq('id', req.params.id)
        .single()
      return { posts, total: posts.length, source_name: updatedSource?.name || source.name }
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
      .eq('owner_id', req.user.id)
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
      .eq('owner_id', req.user.id)
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
