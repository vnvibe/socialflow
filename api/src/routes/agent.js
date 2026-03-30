const path = require('path')
const fs = require('fs')

module.exports = async (fastify) => {
  const { supabase } = fastify

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
