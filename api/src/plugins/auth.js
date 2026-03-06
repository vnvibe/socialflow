// Fastify plugin for Supabase JWT authentication
// - authenticate: verify Bearer token via supabase.auth.getUser(), get role from profiles table
// - requireAdmin: authenticate + check role === 'admin'
// Uses fastify-plugin, @supabase/supabase-js
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const fp = require('fastify-plugin')
const { createClient } = require('@supabase/supabase-js')

module.exports = fp(async (fastify) => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  fastify.decorate('authenticate', async (request, reply) => {
    const token = request.headers.authorization?.replace('Bearer ', '')
    if (!token) return reply.code(401).send({ error: 'Unauthorized' })

    const { data: { user }, error } = await supabase.auth.getUser(token)
    if (error || !user) return reply.code(401).send({ error: 'Invalid token' })

    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', user.id)
      .single()

    if (!profile?.is_active) return reply.code(403).send({ error: 'Account disabled' })

    request.user = { ...user, role: profile.role }
  })

  fastify.decorate('requireAdmin', async (request, reply) => {
    await fastify.authenticate(request, reply)
    if (request.user?.role !== 'admin') {
      return reply.code(403).send({ error: 'Admin required' })
    }
  })
})
