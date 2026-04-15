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

  // ─── Skills CRUD proxies (admin only) ───────────────────
  fastify.get('/skills', { preHandler: fastify.authenticate }, async (req, reply) => {
    try {
      const res = await fetch(`${HERMES_URL}/skills`, {
        headers: { 'X-Agent-Key': AGENT_SECRET },
        signal: AbortSignal.timeout(5000),
      })
      return reply.code(res.status).send(await res.json())
    } catch (err) {
      return reply.code(503).send({ error: err.message })
    }
  })

  fastify.get('/skills/:task_type', { preHandler: fastify.authenticate }, async (req, reply) => {
    try {
      const res = await fetch(`${HERMES_URL}/skills/${encodeURIComponent(req.params.task_type)}`, {
        headers: { 'X-Agent-Key': AGENT_SECRET },
        signal: AbortSignal.timeout(5000),
      })
      return reply.code(res.status).send(await res.json())
    } catch (err) {
      return reply.code(503).send({ error: err.message })
    }
  })

  fastify.put('/skills/:task_type', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    try {
      const res = await fetch(`${HERMES_URL}/skills/${encodeURIComponent(req.params.task_type)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Key': AGENT_SECRET,
        },
        body: JSON.stringify(req.body),
        signal: AbortSignal.timeout(10000),
      })
      return reply.code(res.status).send(await res.json())
    } catch (err) {
      return reply.code(503).send({ error: err.message })
    }
  })

  fastify.post('/skills/reload', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    try {
      const res = await fetch(`${HERMES_URL}/skills/reload`, {
        method: 'POST',
        headers: { 'X-Agent-Key': AGENT_SECRET },
        signal: AbortSignal.timeout(5000),
      })
      return reply.code(res.status).send(await res.json())
    } catch (err) {
      return reply.code(503).send({ error: err.message })
    }
  })

  // ─── Config CRUD + test ──────────────────────────────────
  fastify.get('/config', { preHandler: fastify.authenticate }, async (req, reply) => {
    try {
      const res = await fetch(`${HERMES_URL}/config`, {
        headers: { 'X-Agent-Key': AGENT_SECRET },
        signal: AbortSignal.timeout(5000),
      })
      return reply.code(res.status).send(await res.json())
    } catch (err) {
      return reply.code(503).send({ error: err.message })
    }
  })

  fastify.put('/config', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const { status, json } = await proxyToHermes('/config', req.body, 10000)
    // Use PUT method — proxyToHermes only does POST, so roll manual:
    try {
      const res = await fetch(`${HERMES_URL}/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Key': AGENT_SECRET },
        body: JSON.stringify(req.body || {}),
        signal: AbortSignal.timeout(10000),
      })
      return reply.code(res.status).send(await res.json())
    } catch (err) {
      return reply.code(503).send({ error: err.message })
    }
  })

  fastify.post('/config/test', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const { status, json } = await proxyToHermes('/config/test', req.body, 15000)
    return reply.code(status).send(json)
  })

  // ─── Skill create + delete ───────────────────────────────
  fastify.post('/skills', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const { status, json } = await proxyToHermes('/skills', req.body, 10000)
    return reply.code(status).send(json)
  })

  fastify.delete('/skills/:task_type', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    try {
      const res = await fetch(`${HERMES_URL}/skills/${encodeURIComponent(req.params.task_type)}`, {
        method: 'DELETE',
        headers: { 'X-Agent-Key': AGENT_SECRET },
        signal: AbortSignal.timeout(5000),
      })
      return reply.code(res.status).send(await res.json())
    } catch (err) {
      return reply.code(503).send({ error: err.message })
    }
  })

  // ─── Memory stats per account (for /agents dashboard) ───
  fastify.get('/memory-stats', { preHandler: fastify.authenticate }, async (req, reply) => {
    try {
      const { data, error } = await fastify.supabase
        .from('ai_pilot_memory')
        .select('account_id', { count: 'exact' })
      if (error) return reply.code(500).send({ error: error.message })
      // Group by account_id
      const counts = {}
      for (const row of (data || [])) {
        const a = row.account_id
        if (!a) continue
        counts[a] = (counts[a] || 0) + 1
      }
      return counts
    } catch (err) {
      return reply.code(500).send({ error: err.message })
    }
  })

  // ─── Campaign Review ─────────────────────────────────────
  fastify.post('/campaign-review', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { status, json } = await proxyToHermes('/campaign-review', req.body, 60000)
    // If review succeeded AND campaign has auto_apply_enabled → run autoApply
    if (status === 200 && json?.ok && req.body?.campaign_id) {
      try {
        // Use shared service directly (don't rely on fastify decorator scoping)
        const { autoApplyRecommendations } = require('../services/auto-apply')
        const auto = await autoApplyRecommendations(fastify.supabase, {
          campaignId: req.body.campaign_id,
          recommendations: json.recommendations || [],
          ownerId: req.user.id,
        })
        json.auto_applied = auto.auto_applied
        json.auto_apply_skipped = auto.skipped
      } catch (err) {
        fastify.log.warn({ err }, '[AUTO-APPLY] Failed (review still saved)')
      }
    }
    return reply.code(status).send(json)
  })

  // ─── Memory + feedback delete ────────────────────────────
  fastify.delete('/memory', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const qs = new URLSearchParams()
    if (req.query.account_id) qs.set('account_id', req.query.account_id)
    if (req.query.all) qs.set('all', 'true')
    try {
      const res = await fetch(`${HERMES_URL}/memory?${qs}`, {
        method: 'DELETE',
        headers: { 'X-Agent-Key': AGENT_SECRET },
        signal: AbortSignal.timeout(10000),
      })
      return reply.code(res.status).send(await res.json())
    } catch (err) {
      return reply.code(503).send({ error: err.message })
    }
  })

  fastify.delete('/feedback', { preHandler: fastify.requireAdmin }, async (req, reply) => {
    const qs = new URLSearchParams()
    if (req.query.confirm) qs.set('confirm', req.query.confirm)
    try {
      const res = await fetch(`${HERMES_URL}/feedback?${qs}`, {
        method: 'DELETE',
        headers: { 'X-Agent-Key': AGENT_SECRET },
        signal: AbortSignal.timeout(10000),
      })
      return reply.code(res.status).send(await res.json())
    } catch (err) {
      return reply.code(503).send({ error: err.message })
    }
  })
}
