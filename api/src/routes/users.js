module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /users/:id/profile — Get user profile (for auth store, replaces direct Supabase query)
  fastify.get('/:id/profile', { preHandler: fastify.authenticate }, async (req, reply) => {
    // Users can only fetch their own profile (unless admin)
    if (req.params.id !== req.user.id && req.user.role !== 'admin') {
      return reply.code(403).send({ error: 'Forbidden' })
    }
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', req.params.id)
      .single()
    if (error || !profile) return reply.code(404).send({ error: 'Profile not found' })
    return profile
  })

  // GET /users - List all users (admin only)
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', req.user.id).single()
    if (profile?.role !== 'admin') return reply.code(403).send({ error: 'Admin only' })

    const { data: { users }, error } = await supabase.auth.admin.listUsers()
    if (error) return reply.code(500).send({ error: error.message })

    // Enrich with profile data (include is_active)
    const { data: profiles } = await supabase.from('profiles').select('id, username, display_name, role, is_active')
    const profileMap = new Map((profiles || []).map(p => [p.id, p]))

    return users.map(u => ({
      id: u.id,
      email: u.email,
      username: profileMap.get(u.id)?.username || null,
      display_name: profileMap.get(u.id)?.display_name || null,
      role: profileMap.get(u.id)?.role || 'user',
      is_active: profileMap.get(u.id)?.is_active ?? false,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
    }))
  })

  // POST /users - Create new user (admin only, auto-approved)
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', req.user.id).single()
    if (profile?.role !== 'admin') return reply.code(403).send({ error: 'Admin only' })

    const { email, password, role } = req.body
    if (!email || !password) return reply.code(400).send({ error: 'Email and password required' })

    const { data: { user }, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error) return reply.code(400).send({ error: error.message })

    // Admin-created users are auto-approved (is_active: true)
    await supabase.from('profiles').upsert({
      id: user.id,
      username: email.split('@')[0],
      role: role || 'user',
      is_active: true,
    }, { onConflict: 'id' })

    return reply.code(201).send({ id: user.id, email, role: role || 'user' })
  })

  // PUT /users/:id - Update user (admin only)
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', req.user.id).single()
    if (profile?.role !== 'admin') return reply.code(403).send({ error: 'Admin only' })

    const { is_active, role } = req.body

    // Toggle active status in profiles
    if (is_active !== undefined) {
      const { data: existingProfile } = await supabase
        .from('profiles').select('id').eq('id', req.params.id).single()

      if (existingProfile) {
        await supabase.from('profiles').update({ is_active }).eq('id', req.params.id)
      } else {
        // Profile doesn't exist (self-registered user) — derive username from email
        const { data: authUser } = await supabase.auth.admin.getUserById(req.params.id)
        const email = authUser?.user?.email || ''
        await supabase.from('profiles').insert({
          id: req.params.id,
          username: email.split('@')[0] || req.params.id.substring(0, 8),
          role: 'user',
          is_active,
        })
      }

      // Also ban/unban in Supabase auth
      try {
        if (!is_active) {
          await supabase.auth.admin.updateUserById(req.params.id, { ban_duration: '876000h' })
        } else {
          await supabase.auth.admin.updateUserById(req.params.id, { ban_duration: 'none' })
        }
      } catch (authErr) {
        console.error('[USERS] Failed to update auth ban status:', authErr.message)
      }
    }

    // Update role in profiles
    if (role) {
      await supabase.from('profiles').update({ role }).eq('id', req.params.id)
    }

    return { success: true }
  })

  // DELETE /users/:id - Delete user (admin only)
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', req.user.id).single()
    if (profile?.role !== 'admin') return reply.code(403).send({ error: 'Admin only' })

    // Prevent deleting yourself
    if (req.params.id === req.user.id) {
      return reply.code(400).send({ error: 'Không thể xóa chính mình' })
    }

    // Delete profile first (FK cascade may handle this)
    await supabase.from('profiles').delete().eq('id', req.params.id)

    // Delete auth user
    const { error } = await supabase.auth.admin.deleteUser(req.params.id)
    if (error) return reply.code(400).send({ error: error.message })

    return { success: true }
  })
}
