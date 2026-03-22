const fp = require('fastify-plugin')
const { getRedis } = require('../lib/redis')

// Routes không cache
const SKIP_PREFIXES = [
  '/auth', '/jobs', '/agent', '/media/upload',
  '/websites/google', '/users',
]

// TTL theo route prefix (seconds)
const TTL_MAP = [
  { prefix: '/groups',    ttl: 5 * 60 },
  { prefix: '/fanpages',  ttl: 5 * 60 },
  { prefix: '/accounts',  ttl: 2 * 60 },
  { prefix: '/monitor',   ttl: 2 * 60 },
  { prefix: '/analytics', ttl: 10 * 60 },
  { prefix: '/trends',    ttl: 30 * 60 },
  { prefix: '/websites',  ttl: 5 * 60 },
  { prefix: '/content',   ttl: 2 * 60 },
  { prefix: '/inbox',     ttl: 60 },
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

// Decode JWT payload (không verify) chỉ để lấy userId làm cache key
// Auth thật vẫn do fastify.authenticate xử lý — đây chỉ cho cache scoping
function getUserIdFromJwt(req) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) return 'anon'
  try {
    const payload = JSON.parse(Buffer.from(auth.slice(7).split('.')[1], 'base64url').toString())
    return payload.sub || 'anon'
  } catch {
    return 'anon'
  }
}

module.exports = fp(async function cachePlugin(fastify) {
  const redis = getRedis()
  if (!redis) {
    fastify.log.warn('[CACHE] Redis chưa cấu hình — API cache bị tắt')
    fastify.decorate('invalidateCache', async () => {})
    return
  }

  fastify.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0]
    if (shouldSkip(url, req.method)) return

    const userId = getUserIdFromJwt(req)  // decode JWT không cần auth middleware
    const cacheKey = `api:${userId}:${url}:${req.url.split('?')[1] || ''}`

    try {
      const hit = await redis.get(cacheKey)
      if (hit !== null) {
        reply.header('X-Cache', 'HIT')
        reply.header('Content-Type', 'application/json')
        return reply.send(typeof hit === 'string' ? hit : JSON.stringify(hit))
      }
    } catch {}

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

  fastify.decorate('invalidateCache', async (userId, prefix) => {
    try {
      const pattern = `api:${userId}:${prefix}`
      const keys = await redis.keys(`${pattern}*`)
      if (keys.length > 0) await redis.del(...keys)
    } catch {}
  })

  fastify.log.info('[CACHE] API Redis cache enabled')
}, { name: 'cache-plugin' })
