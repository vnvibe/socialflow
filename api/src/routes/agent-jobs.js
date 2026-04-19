// Agent job lifecycle routes — machine-to-machine API for the desktop agent
// Auth: X-Agent-Key header matching AGENT_SECRET env var
module.exports = async (fastify) => {
  const { supabase } = fastify
  const AGENT_SECRET = process.env.AGENT_SECRET

  // ─── Agent auth middleware ─────────────────────────────
  const agentAuth = async (request, reply) => {
    const key = request.headers['x-agent-key']
    if (!AGENT_SECRET) {
      return reply.code(500).send({ error: 'AGENT_SECRET not configured on server' })
    }
    if (!key || key !== AGENT_SECRET) {
      return reply.code(401).send({ error: 'Invalid agent key' })
    }
    // Extract agent metadata from headers
    request.agent = {
      id: request.headers['x-agent-id'] || 'unknown',
      userId: request.headers['x-agent-user-id'] || null,
    }
  }

  // ─── GET /agent-jobs/pending ───────────────────────────
  // Returns pending jobs for the agent to pick from.
  // Agent does local filtering (cooldowns, budgets, KPI gates, etc.)
  fastify.get('/pending', { preHandler: agentAuth }, async (req, reply) => {
    const { user_id, slots = 10, exclude_user_ids } = req.query
    const pool = supabase._pool || null

    // Fair scheduling: 1 job per nick, sorted by least-recently-active.
    // Without this, nicks with big backlogs (e.g. Việt with 37 pending)
    // monopolize the 2 agent slots, starving other nicks (Diệu Hiền with
    // 6 pending waits forever). Rotation ensures every active nick gets
    // a turn within one poll cycle.
    if (pool) {
      const args = []
      const where = [`j.status = 'pending'`, `j.scheduled_at <= now()`]
      if (user_id) {
        args.push(user_id)
        where.push(`j.created_by = $${args.length}`)
      } else if (exclude_user_ids) {
        const ids = exclude_user_ids.split(',').filter(Boolean)
        if (ids.length > 0) {
          const placeholders = ids.map(id => { args.push(id); return `$${args.length}` }).join(',')
          where.push(`j.created_by NOT IN (${placeholders})`)
        }
      }
      args.push(parseInt(slots))
      const sql = `
        WITH nick_activity AS (
          SELECT
            payload->>'account_id' AS account_id,
            MAX(COALESCE(started_at, finished_at, created_at)) AS last_activity
          FROM jobs
          WHERE payload ? 'account_id'
          GROUP BY payload->>'account_id'
        ),
        one_per_nick AS (
          SELECT DISTINCT ON (j.payload->>'account_id')
            j.*,
            COALESCE(na.last_activity, '1970-01-01'::timestamptz) AS _last_activity
          FROM jobs j
          LEFT JOIN nick_activity na ON na.account_id = j.payload->>'account_id'
          WHERE ${where.join(' AND ')}
          ORDER BY j.payload->>'account_id' NULLS FIRST, j.priority ASC, j.scheduled_at ASC
        )
        SELECT * FROM one_per_nick
        ORDER BY _last_activity ASC, priority ASC, scheduled_at ASC
        LIMIT $${args.length}
      `
      try {
        const { rows } = await pool.query(sql, args)
        return rows
      } catch (err) {
        fastify.log.error({ err }, '[AGENT-JOBS] Fair-pending query failed')
        // fall through to legacy path below
      }
    }

    // Legacy fallback (when _pool unavailable or SQL fails)
    let query = supabase
      .from('jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('priority', { ascending: true })
      .order('scheduled_at', { ascending: true })
      .limit(parseInt(slots))

    if (user_id) {
      query = query.eq('created_by', user_id)
    } else if (exclude_user_ids) {
      const ids = exclude_user_ids.split(',').filter(Boolean)
      if (ids.length > 0) {
        query = query.not('created_by', 'in', `(${ids.join(',')})`)
      }
    }

    const { data, error } = await query
    if (error) {
      fastify.log.error({ error }, '[AGENT-JOBS] Pending query failed')
      return reply.code(500).send({ error: error.message })
    }
    return data || []
  })

  // ─── PATCH /agent-jobs/:id/claim ───────────────────────
  // Atomic claim: only succeeds if job is still pending
  fastify.patch('/:id/claim', { preHandler: agentAuth }, async (req, reply) => {
    const { agent_id } = req.body || {}

    const { data, error } = await supabase
      .from('jobs')
      .update({
        status: 'claimed',
        agent_id: agent_id || req.agent.id,
        started_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('status', 'pending')
      .select('id')

    if (error) {
      fastify.log.error({ error, jobId: req.params.id }, '[AGENT-JOBS] Claim failed')
      return reply.code(500).send({ error: error.message })
    }
    if (!data?.length) {
      return reply.code(409).send({ error: 'Job already claimed or not pending' })
    }
    return { ok: true, id: data[0].id }
  })

  // ─── PATCH /agent-jobs/:id/status ──────────────────────
  // Generic status update (running, done, failed, cancelled, pending)
  fastify.patch('/:id/status', { preHandler: agentAuth }, async (req, reply) => {
    const { status, result, error_message, attempt, scheduled_at, agent_id } = req.body || {}

    if (!status) return reply.code(400).send({ error: 'status required' })

    const update = { status }
    if (result !== undefined) update.result = result
    if (error_message !== undefined) update.error_message = error_message
    if (attempt !== undefined) update.attempt = attempt
    if (scheduled_at !== undefined) update.scheduled_at = scheduled_at
    if (agent_id !== undefined) update.agent_id = agent_id
    if (status === 'done' || status === 'failed') update.finished_at = new Date().toISOString()
    if (status === 'running') update.started_at = update.started_at || new Date().toISOString()

    const { data, error } = await supabase
      .from('jobs')
      .update(update)
      .eq('id', req.params.id)
      .select('id, status')

    if (error) {
      fastify.log.error({ error, jobId: req.params.id }, '[AGENT-JOBS] Status update failed')
      return reply.code(500).send({ error: error.message })
    }
    if (!data?.length) {
      return reply.code(404).send({ error: 'Job not found' })
    }
    return { ok: true, ...data[0] }
  })

  // ─── PATCH /agent-jobs/:id/complete ────────────────────
  // Shorthand for marking job done
  fastify.patch('/:id/complete', { preHandler: agentAuth }, async (req, reply) => {
    const { result } = req.body || {}

    const { data, error } = await supabase
      .from('jobs')
      .update({
        status: 'done',
        result: result || null,
        finished_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .select('id, status')

    if (error) {
      fastify.log.error({ error, jobId: req.params.id }, '[AGENT-JOBS] Complete failed')
      return reply.code(500).send({ error: error.message })
    }
    if (!data?.length) {
      return reply.code(404).send({ error: 'Job not found' })
    }
    return { ok: true, ...data[0] }
  })

  // ─── PATCH /agent-jobs/:id/fail ────────────────────────
  // Shorthand for marking job failed
  fastify.patch('/:id/fail', { preHandler: agentAuth }, async (req, reply) => {
    const { error_message, attempt } = req.body || {}

    const update = {
      status: 'failed',
      finished_at: new Date().toISOString(),
    }
    if (error_message) update.error_message = error_message
    if (attempt) update.attempt = attempt

    const { data, error } = await supabase
      .from('jobs')
      .update(update)
      .eq('id', req.params.id)
      .select('id, status')

    if (error) {
      fastify.log.error({ error, jobId: req.params.id }, '[AGENT-JOBS] Fail update failed')
      return reply.code(500).send({ error: error.message })
    }
    if (!data?.length) {
      return reply.code(404).send({ error: 'Job not found' })
    }
    return { ok: true, ...data[0] }
  })

  // ─── POST /agent-jobs/recover-stale ────────────────────
  // Reset jobs stuck in claimed/running for > 10 min (agent crash recovery)
  // No body expected. Agent must NOT send Content-Type: application/json
  // with empty body — Fastify rejects with FST_ERR_CTP_EMPTY_JSON_BODY.
  fastify.post('/recover-stale', { preHandler: agentAuth }, async (req, reply) => {
    const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString()

    const { data: stale } = await supabase
      .from('jobs')
      .select('id, type, status, started_at, attempt')
      .in('status', ['claimed', 'running'])
      .lt('started_at', staleTime)

    let recovered = 0
    for (const job of (stale || [])) {
      const { error } = await supabase
        .from('jobs')
        .update({
          status: 'pending',
          agent_id: null,
          started_at: null,
          scheduled_at: new Date().toISOString(),
          attempt: (job.attempt || 0) + 1,
          error_message: 'Agent crashed or timed out, retrying',
        })
        .eq('id', job.id)

      if (!error) recovered++
    }

    return { recovered, total_stale: (stale || []).length }
  })

  // ─── POST /agent-jobs/cancel-inactive ──────────────────
  // Cancel pending jobs for an inactive account
  fastify.post('/cancel-inactive', { preHandler: agentAuth }, async (req, reply) => {
    const { account_id, job_id } = req.body || {}
    if (!job_id) return reply.code(400).send({ error: 'job_id required' })

    const { data, error } = await supabase
      .from('jobs')
      .update({ status: 'cancelled', error_message: 'account_not_active' })
      .eq('id', job_id)
      .eq('status', 'pending')
      .select('id')

    if (error) return reply.code(500).send({ error: error.message })
    return { ok: true, cancelled: data?.length || 0 }
  })

  // ─── POST /agent-jobs/failures ─────────────────────────
  // Record job failure for debugging
  fastify.post('/failures', { preHandler: agentAuth }, async (req, reply) => {
    const { job_id, account_id, campaign_id, error_type, error_message,
      error_stack, handler_name, page_url, attempt, will_retry, next_retry_at } = req.body || {}

    if (!job_id) return reply.code(400).send({ error: 'job_id required' })

    // Validate account_id/campaign_id against accounts/campaigns tables
    // before insert — orchestrator sometimes emits jobs with a user_id in
    // the account_id slot (LLM mix-up), and without this guard the FK
    // constraint kills the failure record, masking the real bug.
    let safeAccountId = account_id || null
    let safeCampaignId = campaign_id || null
    try {
      const pool = supabase._pool
      if (pool && safeAccountId) {
        const { rows } = await pool.query('SELECT 1 FROM accounts WHERE id = $1 LIMIT 1', [safeAccountId])
        if (!rows.length) safeAccountId = null
      }
      if (pool && safeCampaignId) {
        const { rows } = await pool.query('SELECT 1 FROM campaigns WHERE id = $1 LIMIT 1', [safeCampaignId])
        if (!rows.length) safeCampaignId = null
      }
    } catch {
      // On DB error, fall through — insert will still either succeed or
      // surface its own error below. Don't let validation failure block
      // diagnostics.
    }

    const { error } = await supabase.from('job_failures').insert({
      job_id,
      account_id: safeAccountId,
      campaign_id: safeCampaignId,
      error_type, error_message,
      error_stack: error_stack?.substring(0, 2000),
      handler_name, page_url, attempt,
      will_retry: will_retry || false,
      next_retry_at: next_retry_at || null,
    })

    if (error) {
      fastify.log.error({ error }, '[AGENT-JOBS] Failed to save job_failure')
      return reply.code(500).send({ error: error.message })
    }
    return { ok: true }
  })

  // ─── GET /agent-jobs/account-status/:id ────────────────
  // Check account active status + metadata (for poller pre-checks)
  fastify.get('/account-status/:id', { preHandler: agentAuth }, async (req, reply) => {
    const { data, error } = await supabase
      .from('accounts')
      .select('id, is_active, status, created_at, active_hours_start, active_hours_end, daily_budget')
      .eq('id', req.params.id)
      .single()

    if (error || !data) return reply.code(404).send({ error: 'Account not found' })
    return data
  })

  // ─── GET /agent-jobs/excluded-users ────────────────────
  // Get user IDs that have a preferred executor that isn't this agent
  fastify.get('/excluded-users', { preHandler: agentAuth }, async (req, reply) => {
    const { agent_id } = req.query
    if (!agent_id) return reply.code(400).send({ error: 'agent_id required' })

    const { data } = await supabase
      .from('profiles')
      .select('id, preferred_executor_id')
      .not('preferred_executor_id', 'is', null)
      .neq('preferred_executor_id', agent_id)

    return (data || []).map(p => p.id)
  })

  // ─── POST /agent-jobs/heartbeat ────────────────────────
  // Agent heartbeat — keeps agent status alive
  fastify.post('/heartbeat', { preHandler: agentAuth }, async (req, reply) => {
    const { agent_id, hostname, platform, user_id, stats } = req.body || {}
    if (!agent_id) return reply.code(400).send({ error: 'agent_id required' })

    const { error } = await supabase.from('agent_heartbeats').upsert({
      agent_id,
      hostname: hostname || 'unknown',
      platform: platform || 'unknown',
      user_id: user_id || null,
      last_seen: new Date().toISOString(),
    }, { onConflict: 'agent_id' })

    if (error) {
      fastify.log.error({ error }, '[AGENT-JOBS] Heartbeat upsert failed')
      return reply.code(500).send({ error: error.message })
    }
    return { ok: true }
  })
}
