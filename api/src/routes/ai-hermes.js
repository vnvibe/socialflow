// Hermes AI routes — proxy to the Hermes FastAPI service on localhost:8100
// Exposes /ai-hermes/comment, /ai-hermes/evaluate, /ai-hermes/quality-gate, /ai-hermes/generate
module.exports = async (fastify) => {
  const HERMES_URL = process.env.HERMES_URL || 'http://127.0.0.1:8100'
  const AGENT_SECRET = process.env.AGENT_SECRET

  async function proxyToHermes(path, body, timeout = 30000) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const res = await fetch(`${HERMES_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Key': AGENT_SECRET,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const json = await res.json().catch(() => ({ error: 'Invalid JSON response' }))
      return { status: res.status, json }
    } finally {
      clearTimeout(timer)
    }
  }

  // ─── Health check (passthrough) ────────────────────────
  fastify.get('/health', async (req, reply) => {
    try {
      const res = await fetch(`${HERMES_URL}/health`, { signal: AbortSignal.timeout(5000) })
      const json = await res.json()
      return { ...json, proxy: 'ok' }
    } catch (err) {
      return reply.code(503).send({ error: 'Hermes API unreachable', detail: err.message })
    }
  })

  // ─── Comment generation ────────────────────────────────
  // Auth: user must be logged in (JWT)
  fastify.post('/comment', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { status, json } = await proxyToHermes('/comment', req.body, 30000)
    return reply.code(status).send(json)
  })

  // ─── Post evaluation ───────────────────────────────────
  fastify.post('/evaluate', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { status, json } = await proxyToHermes('/evaluate', req.body, 45000)
    return reply.code(status).send(json)
  })

  // ─── Quality gate ──────────────────────────────────────
  fastify.post('/quality-gate', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { status, json } = await proxyToHermes('/quality-gate', req.body, 15000)
    return reply.code(status).send(json)
  })

  // ─── Generic generate (drop-in for orchestrator) ───────
  fastify.post('/generate', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { status, json } = await proxyToHermes('/generate', req.body, 30000)
    return reply.code(status).send(json)
  })

  // ─── Agent authentication variants (X-Agent-Key) ───────
  // Allows the desktop agent to call these directly without a user JWT
  const agentAuth = async (request, reply) => {
    const key = request.headers['x-agent-key']
    if (!AGENT_SECRET || key !== AGENT_SECRET) {
      return reply.code(401).send({ error: 'Invalid agent key' })
    }
  }

  fastify.post('/agent/comment', { preHandler: agentAuth }, async (req, reply) => {
    const { status, json } = await proxyToHermes('/comment', req.body, 30000)
    return reply.code(status).send(json)
  })

  fastify.post('/agent/evaluate', { preHandler: agentAuth }, async (req, reply) => {
    const { status, json } = await proxyToHermes('/evaluate', req.body, 45000)
    return reply.code(status).send(json)
  })

  fastify.post('/agent/quality-gate', { preHandler: agentAuth }, async (req, reply) => {
    const { status, json } = await proxyToHermes('/quality-gate', req.body, 15000)
    return reply.code(status).send(json)
  })

  fastify.post('/agent/generate', { preHandler: agentAuth }, async (req, reply) => {
    const { status, json } = await proxyToHermes('/generate', req.body, 30000)
    return reply.code(status).send(json)
  })

  // ─── Feedback endpoint (agent-auth) ────────────────────
  fastify.post('/agent/feedback', { preHandler: agentAuth }, async (req, reply) => {
    const { status, json } = await proxyToHermes('/feedback', req.body, 5000)
    return reply.code(status).send(json)
  })

  // ─── Status / performance / skills (both auth paths) ────
  // For HermesBar component + /hermes Brain page.
  async function getStatus() {
    const res = await fetch(`${HERMES_URL}/status`, {
      headers: { 'X-Agent-Key': AGENT_SECRET },
      signal: AbortSignal.timeout(5000),
    })
    return { status: res.status, json: await res.json() }
  }

  fastify.get('/status', { preHandler: fastify.authenticate }, async (req, reply) => {
    try {
      const { status, json } = await getStatus()
      return reply.code(status).send(json)
    } catch (err) {
      return reply.code(503).send({ status: 'OFFLINE', error: err.message })
    }
  })

  fastify.get('/agent/status', { preHandler: agentAuth }, async (req, reply) => {
    try {
      const { status, json } = await getStatus()
      return reply.code(status).send(json)
    } catch (err) {
      return reply.code(503).send({ status: 'OFFLINE', error: err.message })
    }
  })

  fastify.get('/performance', { preHandler: fastify.authenticate }, async (req, reply) => {
    try {
      const res = await fetch(`${HERMES_URL}/performance`, {
        headers: { 'X-Agent-Key': AGENT_SECRET },
        signal: AbortSignal.timeout(10000),
      })
      return reply.code(res.status).send(await res.json())
    } catch (err) {
      return reply.code(503).send({ error: err.message })
    }
  })

  fastify.get('/skills/status', { preHandler: fastify.authenticate }, async (req, reply) => {
    try {
      const res = await fetch(`${HERMES_URL}/skills/status`, {
        headers: { 'X-Agent-Key': AGENT_SECRET },
        signal: AbortSignal.timeout(10000),
      })
      return reply.code(res.status).send(await res.json())
    } catch (err) {
      return reply.code(503).send({ error: err.message })
    }
  })

  fastify.get('/feedback/recent', { preHandler: fastify.authenticate }, async (req, reply) => {
    try {
      const limit = req.query.limit || 50
      const res = await fetch(`${HERMES_URL}/feedback/recent?limit=${limit}`, {
        headers: { 'X-Agent-Key': AGENT_SECRET },
        signal: AbortSignal.timeout(10000),
      })
      return reply.code(res.status).send(await res.json())
    } catch (err) {
      return reply.code(503).send({ error: err.message })
    }
  })
}
