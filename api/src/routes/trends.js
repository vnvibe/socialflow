const { getTrends } = require('../services/trend-engine')

module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /trends
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const region = req.query.region || 'VN'

    try {
      const trends = await getTrends(region, supabase)
      return trends
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
}
