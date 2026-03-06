const { validateCookie, getFbDtsg, extractCUserId, generateFingerprint, getDefaultUA } = require('../services/facebook/fb-auth')

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

  // POST /accounts - Add account via cookie
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { cookie_string, username, browser_type, proxy_id, notes, skip_validation } = req.body
    if (!cookie_string) return reply.code(400).send({ error: 'cookie_string required' })

    const fbUserId = extractCUserId(cookie_string)
    const fingerprint = generateFingerprint(fbUserId)
    let dtsg = null

    // Only validate/fetch dtsg if not skipped (validation fails from datacenter IPs)
    if (!skip_validation) {
      try {
        const mockAccount = { cookie_string, user_agent: fingerprint.userAgent }
        const check = await validateCookie(mockAccount)
        if (!check.valid) {
          fastify.log.warn(`Cookie validation failed: ${check.reason}, saving anyway`)
        }
        dtsg = await getFbDtsg(mockAccount)
      } catch (err) {
        fastify.log.warn(`Cookie validation skipped: ${err.message}`)
      }
    }

    const { data, error } = await supabase.from('accounts').insert({
      owner_id: req.user.id,
      username: username || (fbUserId ? `User ${fbUserId}` : 'Unknown'),
      fb_user_id: fbUserId,
      cookie_string,
      fb_dtsg: dtsg,
      dtsg_expires_at: dtsg ? new Date(Date.now() + 6 * 60 * 60 * 1000) : null,
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

  // POST /accounts/:id/check-health
  fastify.post('/:id/check-health', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: account } = await supabase
      .from('accounts')
      .select('*, proxies(*)')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (!account) return reply.code(404).send({ error: 'Not found' })

    const result = await validateCookie(account, account.proxies)
    await supabase.from('accounts').update({
      status: result.valid ? 'healthy' : (result.reason === 'CHECKPOINT' ? 'checkpoint' : 'expired'),
      last_checked_at: new Date()
    }).eq('id', req.params.id)

    return result
  })

  // POST /accounts/:id/update-cookie - Update cookie for existing account
  fastify.post('/:id/update-cookie', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { cookie_string } = req.body
    if (!cookie_string) return reply.code(400).send({ error: 'cookie_string required' })

    const mockAccount = { cookie_string, user_agent: getDefaultUA() }
    const check = await validateCookie(mockAccount)
    if (!check.valid) return reply.code(400).send({ error: `Cookie invalid: ${check.reason}` })

    const dtsg = await getFbDtsg(mockAccount)

    const { data, error } = await supabase.from('accounts').update({
      cookie_string,
      fb_dtsg: dtsg,
      dtsg_expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000),
      status: 'healthy',
      last_checked_at: new Date()
    }).eq('id', req.params.id).eq('owner_id', req.user.id).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // POST /accounts/bulk-import - Import multiple accounts
  fastify.post('/bulk-import', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { cookies, browser_type } = req.body
    if (!cookies?.length) return reply.code(400).send({ error: 'cookies array required' })

    const results = []
    for (const cookie_string of cookies) {
      try {
        const mockAccount = { cookie_string, user_agent: getDefaultUA() }
        const check = await validateCookie(mockAccount)
        if (!check.valid) {
          results.push({ cookie: cookie_string.substring(0, 20) + '...', success: false, error: check.reason })
          continue
        }

        const dtsg = await getFbDtsg(mockAccount)
        const fbUserId = extractCUserId(cookie_string)
        const fingerprint = generateFingerprint(fbUserId)

        const { data, error } = await supabase.from('accounts').insert({
          owner_id: req.user.id,
          username: `User ${fbUserId}`,
          fb_user_id: fbUserId,
          cookie_string,
          fb_dtsg: dtsg,
          dtsg_expires_at: new Date(Date.now() + 6 * 60 * 60 * 1000),
          browser_type: browser_type || 'chromium',
          user_agent: fingerprint.userAgent,
          viewport: fingerprint.viewport,
          timezone: fingerprint.timezone
        }).select().single()

        results.push({ fbUserId, success: !error, id: data?.id })
      } catch (err) {
        results.push({ cookie: cookie_string.substring(0, 20) + '...', success: false, error: err.message })
      }
    }

    return results
  })
}
