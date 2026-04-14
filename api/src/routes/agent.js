const path = require('path')
const fs = require('fs')

module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /agent/config - Agent fetches config after login (SaaS model, no .env needed)
  fastify.get('/config', { preHandler: fastify.authenticate }, async (req, reply) => {
    return {
      supabase_url: process.env.SUPABASE_URL,
      supabase_anon_key: process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
      database_url: process.env.DATABASE_URL_EXTERNAL || process.env.DATABASE_URL?.replace('localhost', process.env.VPS_HOST || '103.142.24.60') || null,
      api_url: process.env.API_PUBLIC_URL || (process.env.RAILWAY_PUBLIC_DOMAIN
        ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
        : `https://103-142-24-60.sslip.io`),
      agent_secret_key: process.env.AGENT_SECRET_KEY || '',
      user_id: req.user.id,
      agent_settings: {
        max_concurrent: 2,
        poll_interval: 5000,
        heartbeat_interval: 30000,
      },
    }
  })

  // GET /agent/status - Check if any agent is online
  fastify.get('/status', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.id

    const [{ data: agents }, { data: profile }] = await Promise.all([
      supabase
        .from('agent_heartbeats')
        .select('agent_id, last_seen, hostname, platform, user_id')
        .gte('last_seen', new Date(Date.now() - 60000).toISOString())
        .or(`user_id.is.null,user_id.eq.${userId}`)
        .order('last_seen', { ascending: false }),
      supabase
        .from('profiles')
        .select('preferred_executor_id')
        .eq('id', userId)
        .single(),
    ])

    return {
      online: (agents?.length || 0) > 0,
      agents: agents || [],
      preferredExecutorId: profile?.preferred_executor_id || null,
    }
  })

  // PUT /agent/executor - Set preferred executor for current user
  fastify.put('/executor', { preHandler: fastify.authenticate }, async (req, reply) => {
    const userId = req.user.id
    const { executorId } = req.body // null = auto (any)

    await supabase
      .from('profiles')
      .update({ preferred_executor_id: executorId || null })
      .eq('id', userId)

    return { ok: true, preferredExecutorId: executorId || null }
  })

  // GET /agent/download - Return download URL for latest Electron exe
  fastify.get('/download', { preHandler: fastify.authenticate }, async (req, reply) => {
    const url = process.env.AGENT_DOWNLOAD_URL ||
      'https://github.com/nguyentanviet92-pixel/socialflow/releases/download/v1.1.0/SocialFlow.Agent.1.1.0.exe'
    return { url, filename: 'SocialFlow Agent 1.1.0.exe' }
  })
}
