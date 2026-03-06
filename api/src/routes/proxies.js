const axios = require('axios')

module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /proxies
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('proxies')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // POST /proxies - Add single proxy
  fastify.post('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { host, port, username, password, type, label, country } = req.body
    if (!host || !port) return reply.code(400).send({ error: 'host and port required' })

    const { data, error } = await supabase.from('proxies').insert({
      host, port, username, password,
      type: type || 'http',
      label, country
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send(data)
  })

  // POST /proxies/bulk-import - Import from text (ip:port:user:pass per line)
  fastify.post('/bulk-import', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { text, type } = req.body
    if (!text) return reply.code(400).send({ error: 'text required' })

    const lines = text.split('\n').filter(l => l.trim())
    const proxies = lines.map(line => {
      const parts = line.trim().split(':')
      return {
        host: parts[0],
        port: parseInt(parts[1]),
        username: parts[2] || null,
        password: parts[3] || null,
        type: type || 'http'
      }
    }).filter(p => p.host && p.port)

    if (proxies.length === 0) return reply.code(400).send({ error: 'No valid proxies found' })

    const { data, error } = await supabase.from('proxies').insert(proxies).select()
    if (error) return reply.code(500).send({ error: error.message })
    return { imported: data.length, proxies: data }
  })

  // PUT /proxies/:id
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = ['label', 'host', 'port', 'username', 'password', 'type', 'country', 'is_active']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase.from('proxies').update(updates).eq('id', req.params.id).select().single()
    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /proxies/:id
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { error } = await supabase.from('proxies').delete().eq('id', req.params.id)
    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // POST /proxies/:id/test - Test proxy connectivity
  fastify.post('/:id/test', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: proxy } = await supabase.from('proxies').select('*').eq('id', req.params.id).single()
    if (!proxy) return reply.code(404).send({ error: 'Not found' })

    const start = Date.now()
    try {
      await axios.get('https://httpbin.org/ip', {
        proxy: {
          host: proxy.host,
          port: proxy.port,
          ...(proxy.username && { auth: { username: proxy.username, password: proxy.password } })
        },
        timeout: 10000
      })

      const speed = Date.now() - start
      await supabase.from('proxies').update({
        is_active: true,
        speed_ms: speed,
        failure_count: 0,
        last_checked_at: new Date()
      }).eq('id', proxy.id)

      return { success: true, speed_ms: speed }
    } catch (err) {
      await supabase.from('proxies').update({
        failure_count: (proxy.failure_count || 0) + 1,
        last_checked_at: new Date()
      }).eq('id', proxy.id)

      return { success: false, error: err.message }
    }
  })

  // POST /proxies/test-all - Test all proxies
  fastify.post('/test-all', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: proxies } = await supabase.from('proxies').select('*').eq('is_active', true)

    const results = await Promise.allSettled(
      (proxies || []).map(async (proxy) => {
        const start = Date.now()
        try {
          await axios.get('https://httpbin.org/ip', {
            proxy: {
              host: proxy.host,
              port: proxy.port,
              ...(proxy.username && { auth: { username: proxy.username, password: proxy.password } })
            },
            timeout: 10000
          })
          const speed = Date.now() - start
          await supabase.from('proxies').update({ speed_ms: speed, failure_count: 0, last_checked_at: new Date() }).eq('id', proxy.id)
          return { id: proxy.id, success: true, speed_ms: speed }
        } catch (err) {
          await supabase.from('proxies').update({ failure_count: (proxy.failure_count || 0) + 1, last_checked_at: new Date() }).eq('id', proxy.id)
          return { id: proxy.id, success: false, error: err.message }
        }
      })
    )

    return results.map(r => r.status === 'fulfilled' ? r.value : { success: false })
  })
}
