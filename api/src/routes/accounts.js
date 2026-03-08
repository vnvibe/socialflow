const { extractCUserId, generateFingerprint } = require('../services/facebook/fb-auth')

module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /accounts - List all accounts for current user
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('accounts')
      .select('*, proxies(*)')
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /accounts/:id - Get single account
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('accounts')
      .select('*, proxies(*), fanpages(*), fb_groups(*)')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (error) return reply.code(404).send({ error: 'Not found' })
    return data
  })

  // POST /accounts - Add account (save only, no validation)
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { cookie_string, username, browser_type, proxy_id, notes } = req.body
    if (!cookie_string) return reply.code(400).send({ error: 'cookie_string required' })

    const fbUserId = extractCUserId(cookie_string)
    const fingerprint = generateFingerprint(fbUserId)

    const { data, error } = await supabase.from('accounts').insert({
      owner_id: req.user.id,
      username: username || (fbUserId ? `User ${fbUserId}` : 'Unknown'),
      fb_user_id: fbUserId,
      cookie_string,
      browser_type: browser_type || 'chromium',
      proxy_id: proxy_id || null,
      user_agent: fingerprint.userAgent,
      viewport: fingerprint.viewport,
      timezone: fingerprint.timezone,
      status: 'unknown',
      notes
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // PUT /accounts/:id - Update account
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = ['username', 'browser_type', 'proxy_id', 'notes', 'is_active',
      'active_hours_start', 'active_hours_end', 'active_days',
      'min_interval_minutes', 'max_daily_posts', 'random_delay_minutes']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase
      .from('accounts')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /accounts/:id
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase
      .from('accounts')
      .delete()
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)

    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // GET /accounts/:id/fanpages - List fanpages for specific account
  fastify.get('/:id/fanpages', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('fanpages')
      .select('*')
      .eq('account_id', req.params.id)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // GET /accounts/:id/groups - List groups for specific account
  fastify.get('/:id/groups', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('fb_groups')
      .select('*')
      .eq('account_id', req.params.id)
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data || []
  })

  // POST /accounts/:id/check-health - Create job for agent to validate
  fastify.post('/:id/check-health', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: account } = await supabase
      .from('accounts')
      .select('id')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (!account) return reply.code(404).send({ error: 'Not found' })

    // Check if agent is online (heartbeat within last 30s)
    const { data: agents } = await supabase
      .from('agent_heartbeats')
      .select('agent_id')
      .gte('last_seen', new Date(Date.now() - 30000).toISOString())
      .limit(1)

    if (!agents?.length) {
      return reply.code(503).send({ error: 'No agent online. Start the SocialFlow Agent first.' })
    }

    // Create job for agent
    const { data: job, error } = await supabase.from('jobs').insert({
      type: 'check_health',
      payload: { account_id: req.params.id },
      status: 'pending',
      scheduled_at: new Date().toISOString()
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })

    // Update account status to show checking
    await supabase.from('accounts').update({ status: 'checking' }).eq('id', req.params.id)

    return { message: 'Check queued', job_id: job.id }
  })

  // POST /accounts/:id/update-cookie - Update cookie (save only, agent validates later)
  fastify.post('/:id/update-cookie', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { cookie_string } = req.body
    if (!cookie_string) return reply.code(400).send({ error: 'cookie_string required' })

    const fbUserId = extractCUserId(cookie_string)

    const { data, error } = await supabase.from('accounts').update({
      cookie_string,
      fb_user_id: fbUserId || undefined,
      status: 'unknown',
    }).eq('id', req.params.id).eq('owner_id', req.user.id).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // POST /accounts/bulk-import - Import multiple accounts (save only)
  fastify.post('/bulk-import', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { cookies, browser_type } = req.body
    if (!cookies?.length) return reply.code(400).send({ error: 'cookies array required' })

    const results = []
    for (const cookie_string of cookies) {
      try {
        const fbUserId = extractCUserId(cookie_string)
        const fingerprint = generateFingerprint(fbUserId)

        const { data, error } = await supabase.from('accounts').insert({
          owner_id: req.user.id,
          username: `User ${fbUserId}`,
          fb_user_id: fbUserId,
          cookie_string,
          browser_type: browser_type || 'chromium',
          user_agent: fingerprint.userAgent,
          viewport: fingerprint.viewport,
          timezone: fingerprint.timezone,
          status: 'unknown'
        }).select().single()

        results.push({ fbUserId, success: !error, id: data?.id })
      } catch (err) {
        results.push({ cookie: cookie_string.substring(0, 20) + '...', success: false, error: err.message })
      }
    }

    return results
  })
}
