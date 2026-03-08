module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /users - List all users (admin only)
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    // Check admin
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', req.user.id).single()
    if (profile?.role !== 'admin') return reply.code(403).send({ error: 'Admin only' })

    const { data: { users }, error } = await supabase.auth.admin.listUsers()
    if (error) return reply.code(500).send({ error: error.message })

    // Enrich with profile data
    const { data: profiles } = await supabase.from('profiles').select('id, username, display_name, role')
    const profileMap = new Map((profiles || []).map(p => [p.id, p]))

    return users.map(u => ({
      id: u.id,
      email: u.email,
      username: profileMap.get(u.id)?.username || null,
      display_name: profileMap.get(u.id)?.display_name || null,
      role: profileMap.get(u.id)?.role || 'user',
      disabled: u.banned_until ? true : false,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    }))
  })

  // POST /users - Create new user (admin only)
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', req.user.id).single()
    if (profile?.role !== 'admin') return reply.code(403).send({ error: 'Admin only' })

    const { email, password, role } = req.body
    if (!email || !password) return reply.code(400).send({ error: 'Email and password required' })

    // Create auth user
    const { data: { user }, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error) return reply.code(400).send({ error: error.message })

    // Create/update profile with role
    await supabase.from('profiles').upsert({
      id: user.id,
      username: email.split('@')[0],
      role: role || 'user',
    }, { onConflict: 'id' })

    return reply.code(201).send({ id: user.id, email, role: role || 'user' })
  })

  // PUT /users/:id - Update user (admin only)
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', req.user.id).single()
    if (profile?.role !== 'admin') return reply.code(403).send({ error: 'Admin only' })

    const { disabled, role } = req.body

    // Toggle ban status
    if (disabled !== undefined) {
      if (disabled) {
        await supabase.auth.admin.updateUserById(req.params.id, { banned_until: '2099-01-01T00:00:00Z' })
      } else {
        await supabase.auth.admin.updateUserById(req.params.id, { banned_until: null })
      }
    }

    // Update role in profiles
    if (role) {
      await supabase.from('profiles').update({ role }).eq('id', req.params.id)
    }

    return { success: true }
  })
}
