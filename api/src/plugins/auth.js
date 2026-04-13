// Fastify plugin for JWT authentication
// - authenticate: verify Bearer token, get role from profiles table
// - requireAdmin: authenticate + check role === 'admin'
//
// Supports both Supabase Auth (cloud) and self-hosted JWT mode.
// When DATABASE_URL is set, verifies JWT locally using JWT_SECRET.
// Otherwise, uses supabase.auth.getUser() for verification.

const fp = require('fastify-plugin')

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

module.exports = fp(async (fastify) => {
  const { supabase } = require('../lib/supabase')
  const useSelfHosted = !!process.env.DATABASE_URL

  // For self-hosted: verify JWT using jsonwebtoken
  let jwt = null
  let JWT_SECRET = process.env.JWT_SECRET || null
  if (useSelfHosted) {
    jwt = require('jsonwebtoken')
    if (!JWT_SECRET) {
      // Derive from SUPABASE_SERVICE_ROLE_KEY if available (for backward compat)
      // Or use a standalone secret
      console.warn('[AUTH] No JWT_SECRET set — using fallback. Set JWT_SECRET in .env for production!')
      JWT_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY || 'socialflow-default-secret-change-me'
    }
  }

  // Cache: token → { user, profile, expiresAt }
  const authCache = new Map()
  const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

  // Verify token — self-hosted uses jsonwebtoken, cloud uses supabase.auth.getUser
  // Supabase Auth client — used for JWT verification (frontend tokens come from Supabase Auth)
  let _sbAuth = null
  function getSupabaseAuth() {
    if (_sbAuth) return _sbAuth
    if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const { createClient } = require('@supabase/supabase-js')
      _sbAuth = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    }
    return _sbAuth
  }

  async function verifyToken(token) {
    // Always try Supabase Auth first (frontend tokens are Supabase JWTs)
    const sbAuth = getSupabaseAuth()
    if (sbAuth) {
      try {
        const result = await getUserWithRetry(sbAuth, token)
        if (result.user) return result
      } catch (err) {
        // Supabase Auth unavailable — fall through to local JWT
      }
    }

    // Fallback: local JWT verification (for self-issued tokens)
    if (jwt && JWT_SECRET) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET)
        return { user: { id: decoded.sub || decoded.id, email: decoded.email }, error: null }
      } catch {}
    }

    return { user: null, error: { message: 'Invalid token' } }
  }

  async function getUserWithRetry(sbAuth, token, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const { data: { user }, error } = await sbAuth.auth.getUser(token)
        return { user, error }
      } catch (err) {
        const isNetworkError = err.message?.includes('fetch failed')
          || err.cause?.code === 'ENOTFOUND'
          || err.cause?.code === 'ECONNREFUSED'
          || err.cause?.code === 'ETIMEDOUT'
        if (isNetworkError && attempt < retries) {
          fastify.log.warn(`[AUTH] Network error (attempt ${attempt + 1}/${retries + 1}), retrying...`)
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

    // Check cache
    const cached = authCache.get(token)
    if (cached && cached.expiresAt > Date.now()) {
      request.user = cached.user
      return
    }

    try {
      const { user, error } = await verifyToken(token)
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
      authCache.set(token, { user: fullUser, expiresAt: Date.now() + CACHE_TTL })
      request.user = fullUser
    } catch (err) {
      const isNetworkError = err.message?.includes('fetch failed')
        || err.cause?.code === 'ENOTFOUND'
        || err.cause?.code === 'ECONNREFUSED'
      if (isNetworkError) {
        if (cached) {
          request.user = cached.user
          fastify.log.warn('[AUTH] Using expired cache due to network error')
          return
        }
        return reply.code(503).send({ error: 'Database temporarily unavailable' })
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

  // Clean expired cache
  setInterval(() => {
    const now = Date.now()
    for (const [key, val] of authCache) {
      if (val.expiresAt + CACHE_TTL < now) authCache.delete(key)
    }
  }, 10 * 60 * 1000)
})
