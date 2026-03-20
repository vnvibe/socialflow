const { getTrends, RSS_FEEDS } = require('../services/trend-engine')

module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /trends?region=VN&sources=vnexpress,tinhte,voz
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const region = req.query.region || 'VN'
    const sources = req.query.sources ? req.query.sources.split(',') : null

    try {
      const trends = await getTrends(region, supabase, { sources })
      return { trends, total: trends.length }
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // POST /trends/refresh - Force refresh trends
  fastify.post('/refresh', { preHandler: fastify.authenticate }, async (req, reply) => {
    const region = req.body.region || 'VN'

    // Clear old cache for this region
    await supabase
      .from('trends_cache')
      .delete()
      .eq('region', region)

    const trends = await getTrends(region, supabase)
    return { refreshed: true, count: trends.length, trends }
  })

  // GET /trends/sources - List available trend sources
  fastify.get('/sources', { preHandler: fastify.authenticate }, async (req, reply) => {
    return {
      sources: [
        { id: 'youtube', name: 'YouTube VN', type: 'api' },
        { id: 'reddit', name: 'Reddit', type: 'api' },
        ...RSS_FEEDS.map(f => ({ id: f.source, name: f.source, type: 'rss', category: f.category, url: f.url })),
      ]
    }
  })
}
