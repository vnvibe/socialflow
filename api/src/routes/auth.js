module.exports = async (fastify) => {
  const { supabase } = fastify

  // POST /auth/register - Public registration (pending admin approval)
  fastify.post('/register', async (req, reply) => {
    const { email, password, display_name } = req.body
    if (!email || !password) {
      return reply.code(400).send({ error: 'Email và mật khẩu là bắt buộc' })
    }
    if (password.length < 6) {
      return reply.code(400).send({ error: 'Mật khẩu tối thiểu 6 ký tự' })
    }

    // Check if email already exists
    const { data: existing } = await supabase.auth.admin.listUsers()
    const exists = existing?.users?.find(u => u.email === email)
    if (exists) {
      return reply.code(400).send({ error: 'Email đã được sử dụng' })
    }

    // Create auth user (email confirmed so they can login)
    const { data: { user }, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (error) {
      return reply.code(400).send({ error: error.message })
    }

    // Create profile with is_active: false (pending approval)
    await supabase.from('profiles').upsert({
      id: user.id,
      username: email.split('@')[0],
      display_name: display_name || email.split('@')[0],
      role: 'user',
      is_active: false,
    }, { onConflict: 'id' })

    return reply.code(201).send({
      message: 'Đăng ký thành công! Vui lòng chờ admin duyệt tài khoản.',
    })
  })
}
