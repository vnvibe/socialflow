const { runApifyActor } = require('../services/apify')

// Apify actor IDs
const ACTORS = {
  facebook_posts: 'apify~facebook-posts-scraper',
  facebook_pages: 'apify~facebook-pages-scraper',
  web_scraper: 'apify~website-content-crawler',
}

module.exports = async (fastify) => {
  const { supabase } = fastify

  // POST /research/facebook - Research Facebook posts
  fastify.post('/facebook', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { url, max_posts = 1 } = req.body || {}
    if (!url) return reply.code(400).send({ error: 'Thiếu URL Facebook' })

    // Auto-detect type from URL
    const lowerUrl = url.toLowerCase()
    let type = 'post'
    if (lowerUrl.includes('/groups/')) type = 'group'
    else if (lowerUrl.includes('/profile.php') || lowerUrl.match(/facebook\.com\/[a-z0-9.]+\/?$/)) type = 'profile'
    else if (lowerUrl.includes('/pages/') || lowerUrl.match(/facebook\.com\/[a-z0-9.]+\/?$/)) type = 'page'

    try {
      const actorId = ACTORS.facebook_posts
      const input = {
        startUrls: [{ url }],
        maxPosts: max_posts,
        maxPostComments: 0,
      }

      const items = await runApifyActor(supabase, actorId, input, req.log)

      // Normalize results
      const results = (items || []).map(item => ({
        text: item.text || item.postText || item.message || '',
        url: item.url || item.postUrl || '',
        likes: item.likes || item.likesCount || 0,
        comments: item.comments || item.commentsCount || 0,
        shares: item.shares || item.sharesCount || 0,
        date: item.time || item.date || item.timestamp || null,
        author: item.user?.name || item.authorName || item.pageName || '',
        media: item.photoUrl || item.imageUrl || item.media?.[0]?.thumbnail || null,
        type: item.type || 'post',
      }))

      // Save to DB
      const { data: saved } = await supabase
        .from('research_results')
        .insert({
          owner_id: req.user.id,
          source: 'facebook',
          source_url: url,
          research_type: type,
          results,
          result_count: results.length,
        })
        .select()
        .single()

      return { id: saved?.id, results, count: results.length }
    } catch (err) {
      req.log.error({ err }, 'Facebook research failed')
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /research/web - Research any web page
  fastify.post('/web', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { url, max_pages = 5 } = req.body || {}
    if (!url) return reply.code(400).send({ error: 'Thiếu URL' })

    try {
      const items = await runApifyActor(supabase, ACTORS.web_scraper, {
        startUrls: [{ url }],
        maxCrawlPages: max_pages,
        maxCrawlDepth: 0, // Stay on target page, don't follow links
        crawlerType: 'playwright:chrome', // Better content extraction than cheerio
        renderingTypeDetection: false,
      }, req.log)

      const results = (items || []).map(item => ({
        url: item.url || '',
        title: item.metadata?.title || item.title || '',
        description: item.metadata?.description || item.description || '',
        heading: item.metadata?.h1 || '',
        text: (item.text || item.markdown || '').substring(0, 15000), // Full article, cap at 15k chars
        images: (item.metadata?.images || []).slice(0, 10),
      }))

      const { data: saved } = await supabase
        .from('research_results')
        .insert({
          owner_id: req.user.id,
          source: 'web',
          source_url: url,
          research_type: 'web',
          results,
          result_count: results.length,
        })
        .select()
        .single()

      return { id: saved?.id, results, count: results.length }
    } catch (err) {
      req.log.error({ err }, 'Web research failed')
      return reply.code(500).send({ error: err.message })
    }
  })

  // GET /research - List research history
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('research_results')
      .select('id, source, source_url, research_type, result_count, created_at')
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /research/:id - Get specific research result
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('research_results')
      .select('*')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (error) return reply.code(404).send({ error: 'Không tìm thấy' })
    return data
  })

  // DELETE /research/:id
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase
      .from('research_results')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })
}
