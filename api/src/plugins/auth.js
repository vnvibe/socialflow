// Fastify plugin for Supabase JWT authentication
// - authenticate: verify Bearer token via supabase.auth.getUser(), get role from profiles table
// - requireAdmin: authenticate + check role === 'admin'
// Uses fastify-plugin, @supabase/supabase-js
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const fp = require('fastify-plugin')
const { createClient } = require('@supabase/supabase-js')

// Simple delay helper
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

module.exports = fp(async (fastify) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // Cache: token → { user, profile, expiresAt }
  const authCache = new Map()
  const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  // getUser with retry on DNS/network errors
  async function getUserWithRetry(token, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await supabase.auth.getUser(token)
        return result
      } catch (err) {
        const isNetworkError = err.message?.includes('fetch failed')
          || err.cause?.code === 'ENOTFOUND'
          || err.cause?.code === 'ECONNREFUSED'
          || err.cause?.code === 'ETIMEDOUT'
        if (isNetworkError && attempt < retries) {
          fastify.log.warn(`[AUTH] Network error (attempt ${attempt + 1}/${retries + 1}), retrying in ${(attempt + 1) * 500}ms...`)
          await wait((attempt + 1) * 500)
          continue
        }
        throw err
      }
    }
  }

  fastify.decorate('authenticate', async (request, reply) => {
    const token = request.headers.authorization?.replace('Bearer ', '')
    if (!token) return reply.code(401).send({ error: 'Unauthorized' })

    // Check cache first
    const cached = authCache.get(token)
    if (cached && cached.expiresAt > Date.now()) {
      request.user = cached.user
      return
    }

    try {
      const { data: { user }, error } = await getUserWithRetry(token)
      if (error || !user) {
        authCache.delete(token)
        return reply.code(401).send({ error: 'Invalid token' })
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('role, is_active')
        .eq('id', user.id)
        .single()

      if (!profile?.is_active) return reply.code(403).send({ error: 'Account disabled' })

      const fullUser = { ...user, role: profile.role }

      // Cache successful auth
      authCache.set(token, { user: fullUser, expiresAt: Date.now() + CACHE_TTL })

      request.user = fullUser
    } catch (err) {
      // Network-level failure → 503 instead of generic 500
      const isNetworkError = err.message?.includes('fetch failed')
        || err.cause?.code === 'ENOTFOUND'
        || err.cause?.code === 'ECONNREFUSED'
      if (isNetworkError) {
        // Try to serve from cache even if expired (grace period)
        if (cached) {
          request.user = cached.user
          fastify.log.warn('[AUTH] Using expired cache due to network error')
          return
        }
        return reply.code(503).send({ error: 'Database temporarily unavailable, please retry' })
      }
      throw err
    }
  })

  fastify.decorate('requireAdmin', async (request, reply) => {
    await fastify.authenticate(request, reply)
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ error: 'Admin required' })
    }
  })

  // Clean expired cache entries every 10 minutes
  setInterval(() => {
    const now = Date.now()
    for (const [key, val] of authCache) {
      if (val.expiresAt + CACHE_TTL < now) authCache.delete(key) // Delete after 2x TTL
    }
  }, 10 * 60 * 1000)
})
