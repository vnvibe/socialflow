/**
 * Agent API Client — wraps the /agent-jobs/* routes on the API VPS.
 *
 * Replaces direct `supabase.from('jobs')` queries that were slow + unreliable
 * over the internet (agent on local Windows → pg on VPS). All job lifecycle
 * goes through HTTPS instead: the API handles DB, we just call REST.
 *
 * Auth: X-Agent-Key header (must match AGENT_SECRET in API .env).
 */
const axios = require('axios')

const API_URL = process.env.API_URL || process.env.API_BASE_URL || 'https://103-142-24-60.sslip.io'
const AGENT_KEY = process.env.AGENT_SECRET_KEY
const AGENT_ID = process.env.AGENT_ID || 'unknown'
const AGENT_USER_ID = process.env.AGENT_USER_ID || null

if (!AGENT_KEY) {
  console.warn('[API-CLIENT] AGENT_SECRET_KEY not set — /agent-jobs calls will 401')
}

const client = axios.create({
  baseURL: `${API_URL}/agent-jobs`,
  timeout: 15000,
  headers: {
    'X-Agent-Key': AGENT_KEY || '',
    'X-Agent-Id': AGENT_ID,
    ...(AGENT_USER_ID ? { 'X-Agent-User-Id': AGENT_USER_ID } : {}),
  },
})

// Retry once on transient network errors (ECONNRESET, ETIMEDOUT). Don't retry
// 4xx — those are legitimate (e.g. 409 on claim means someone else won).
client.interceptors.response.use(
  (r) => r,
  async (err) => {
    const cfg = err.config || {}
    const isTransient = !err.response && ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(err.code)
    if (isTransient && !cfg._retried) {
      cfg._retried = true
      await new Promise(r => setTimeout(r, 500))
      return client(cfg)
    }
    return Promise.reject(err)
  }
)

/**
 * GET /agent-jobs/pending — fetch pending jobs ready to be claimed.
 * @param {object} opts - { slots, userId, excludeUserIds }
 */
async function getPendingJobs({ slots = 10, userId = null, excludeUserIds = [] } = {}) {
  const params = { slots }
  if (userId) params.user_id = userId
  else if (excludeUserIds.length) params.exclude_user_ids = excludeUserIds.join(',')

  const { data } = await client.get('/pending', { params })
  return data || []
}

/**
 * PATCH /agent-jobs/:id/claim — atomic claim (409 if already claimed).
 * Returns { ok: true, id } on success, null if already claimed.
 */
async function claimJob(jobId, agentId = AGENT_ID) {
  try {
    const { data } = await client.patch(`/${jobId}/claim`, { agent_id: agentId })
    return data
  } catch (err) {
    if (err.response?.status === 409) return null // already claimed
    throw err
  }
}

/**
 * PATCH /agent-jobs/:id/status — generic status update.
 */
async function updateJobStatus(jobId, updates) {
  const { data } = await client.patch(`/${jobId}/status`, updates)
  return data
}

/**
 * PATCH /agent-jobs/:id/complete — mark job done + optional result payload.
 */
async function completeJob(jobId, result = null) {
  const { data } = await client.patch(`/${jobId}/complete`, { result })
  return data
}

/**
 * PATCH /agent-jobs/:id/fail — mark job failed.
 */
async function failJob(jobId, { error_message, attempt } = {}) {
  const { data } = await client.patch(`/${jobId}/fail`, { error_message, attempt })
  return data
}

/**
 * POST /agent-jobs/recover-stale — reset jobs stuck in claimed/running > 10 min.
 */
async function recoverStaleJobs() {
  // Fastify 5 default parser rejects unregistered Content-Types (octet-stream
  // returns 415). An empty JSON object works — the route ignores the body.
  const { data } = await client.post('/recover-stale', {})
  return data
}

/**
 * POST /agent-jobs/cancel-inactive — cancel one pending job for inactive account.
 */
async function cancelInactiveJob({ jobId, accountId }) {
  const { data } = await client.post('/cancel-inactive', { job_id: jobId, account_id: accountId })
  return data
}

/**
 * POST /agent-jobs/failures — record failure for debugging.
 */
async function recordFailure(payload) {
  try {
    const { data } = await client.post('/failures', payload)
    return data
  } catch (err) {
    console.warn(`[API-CLIENT] recordFailure failed: ${err.message}`)
    return null
  }
}

/**
 * GET /agent-jobs/account-status/:id — account is_active + metadata.
 */
async function getAccountStatus(accountId) {
  try {
    const { data } = await client.get(`/account-status/${accountId}`)
    return data
  } catch (err) {
    if (err.response?.status === 404) return null
    throw err
  }
}

/**
 * GET /agent-jobs/excluded-users — users with a preferred executor that's not us.
 */
async function getExcludedUserIds(agentId = AGENT_ID) {
  const { data } = await client.get('/excluded-users', { params: { agent_id: agentId } })
  return data || []
}

/**
 * POST /agent-jobs/heartbeat — keep agent alive in agent_heartbeats table.
 */
async function heartbeat({ agentId = AGENT_ID, hostname, platform, userId, stats } = {}) {
  try {
    const { data } = await client.post('/heartbeat', {
      agent_id: agentId,
      hostname: hostname || require('os').hostname(),
      platform: platform || process.platform,
      user_id: userId || AGENT_USER_ID,
      stats,
    })
    return data
  } catch (err) {
    console.warn(`[API-CLIENT] heartbeat failed: ${err.message}`)
    return null
  }
}

module.exports = {
  API_URL,
  AGENT_ID,
  getPendingJobs,
  claimJob,
  updateJobStatus,
  completeJob,
  failJob,
  recoverStaleJobs,
  cancelInactiveJob,
  recordFailure,
  getAccountStatus,
  getExcludedUserIds,
  heartbeat,
}
