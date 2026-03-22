const fp = require('fastify-plugin')
const { getRedis } = require('../lib/redis')

// Routes không cache (data thay đổi liên tục hoặc sensitive)
const SKIP_PREFIXES = [
  '/auth', '/jobs', '/agent', '/media/upload',
  '/websites/google', '/users',
]

// TTL mặc định theo route prefix (seconds)
const TTL_MAP = [
  { prefix: '/groups',    ttl: 5 * 60 },   // 5 phút
  { prefix: '/fanpages',  ttl: 5 * 60 },
  { prefix: '/accounts',  ttl: 2 * 60 },   // 2 phút
  { prefix: '/monitor',   ttl: 2 * 60 },
  { prefix: '/analytics', ttl: 10 * 60 },  // 10 phút
  { prefix: '/trends',    ttl: 30 * 60 },  // 30 phút
  { prefix: '/websites',  ttl: 5 * 60 },
  { prefix: '/content',   ttl: 2 * 60 },
  { prefix: '/inbox',     ttl: 60 },       // 1 phút (messages thay đổi nhanh)
]

const DEFAULT_TTL = 2 * 60

function getTtl(url) {
  const match = TTL_MAP.find(r => url.startsWith(r.prefix))
  return match ? match.ttl : DEFAULT_TTL
}

function shouldSkip(url, method) {
  if (method !== 'GET') return true
  return SKIP_PREFIXES.some(p => url.startsWith(p))
}

module.exports = fp(async function cachePlugin(fastify) {
  const redis = getRedis()
  if (!redis) {
    fastify.log.warn('[CACHE] Redis chưa cấu hình — API cache bị tắt')
    return
  }

  fastify.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0]
    if (shouldSkip(url, req.method)) return

    // Cache key: user-scoped
    const userId = req.user?.id || 'anon'
    const cacheKey = `api:${userId}:${url}:${req.url.split('?')[1] || ''}`

    try {
      const hit = await redis.get(cacheKey)
      if (hit !== null) {
        reply.header('X-Cache', 'HIT')
        reply.header('Content-Type', 'application/json')
        return reply.send(typeof hit === 'string' ? hit : JSON.stringify(hit))
      }
    } catch {}

    // Lưu cacheKey vào request để dùng ở onSend
    req.cacheKey = cacheKey
    req.cacheTtl = getTtl(url)
  })

  fastify.addHook('onSend', async (req, reply, payload) => {
    if (!req.cacheKey) return payload
    if (reply.statusCode !== 200) return payload
    if (!payload) return payload

    try {
      await redis.setex(req.cacheKey, req.cacheTtl, payload)
      reply.header('X-Cache', 'MISS')
    } catch {}

    return payload
  })

  // Decorator để invalidate cache theo prefix từ các route
  fastify.decorate('invalidateCache', async (userId, prefix) => {
    try {
      const pattern = `api:${userId}:${prefix}`
      const keys = await redis.keys(`${pattern}*`)
      if (keys.length > 0) await redis.del(...keys)
    } catch {}
  })

  fastify.log.info('[CACHE] API Redis cache enabled')
}, { name: 'cache-plugin' })
