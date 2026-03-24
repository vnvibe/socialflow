const { supabase } = require('../lib/supabase')
const handlers = require('./handlers')
const os = require('os')
const { closeAll } = require('../browser/session-pool')
const { classifyError, shouldDisableAccount, isRetryable, getRetryDelayMs } = require('../lib/error-classifier')
const { postCooldown } = require('../lib/randomizer')

const AGENT_ID = process.env.AGENT_ID || `${os.hostname()}-${process.pid}`
const AGENT_USER_ID = process.env.AGENT_USER_ID || null  // set when user logs in via Electron
const POLL_MS = 5000
const MAX_CONCURRENT = parseInt(process.env.MAX_CONCURRENT) || 2

const POST_TYPES = ['post_page', 'post_page_graph', 'post_group', 'post_profile']

// ─── NickPool — max 2 nicks concurrent ───────────────────
class NickPool {
  constructor() {
    this.running = new Set()      // account_ids currently busy
    this.runningJobs = new Set()  // job_ids currently running
    this.jobsToday = 0
    this.jobsFailed = 0
  }
  isBusy()         { return this.running.size >= MAX_CONCURRENT }
  isRunning(accId) { return this.running.has(accId) }
  acquire(accId, jobId) { this.running.add(accId); this.runningJobs.add(jobId) }
  release(accId, jobId) { this.running.delete(accId); this.runningJobs.delete(jobId); this.jobsToday++ }
  fail(accId, jobId)    { this.running.delete(accId); this.runningJobs.delete(jobId); this.jobsFailed++ }
}
const pool = new NickPool()

let lastPostFinishedAt = 0
let currentCooldownMs = 0
let pollFails = 0

// Cache user preferences to avoid querying on every poll
let preferenceCache = { data: [], fetchedAt: 0 }
const PREF_CACHE_TTL = 30000 // 30s

async function getExcludedUserIds() {
  const now = Date.now()
  if (now - preferenceCache.fetchedAt < PREF_CACHE_TTL) return preferenceCache.data

  // Users who have a preferred_executor_id that is NOT this agent → exclude them
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, preferred_executor_id')
    .not('preferred_executor_id', 'is', null)
    .neq('preferred_executor_id', AGENT_ID)

  preferenceCache = { data: (profiles || []).map(p => p.id), fetchedAt: now }
  return preferenceCache.data
}

async function poll() {
  if (pool.isBusy()) return  // all slots taken

  try {
    const slots = MAX_CONCURRENT - pool.running.size
    let query = supabase
      .from('jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true })
      .limit(slots)

    if (AGENT_USER_ID) {
      query = query.or(`created_by.eq.${AGENT_USER_ID},created_by.is.null`)
    } else {
      const excludedUserIds = await getExcludedUserIds()
      if (excludedUserIds.length > 0) {
        query = query.not('created_by', 'in', `(${excludedUserIds.join(',')})`)
      }
    }

    const { data: jobs } = await query
    if (!jobs?.length) return

    for (const job of jobs) {
      const accId = job.payload?.account_id
      const isPostJob = POST_TYPES.includes(job.type)

      // Skip if this nick is already busy
      if (accId && pool.isRunning(accId)) continue

      // Post cooldown between posting jobs
      if (isPostJob && lastPostFinishedAt > 0) {
        const elapsed = Date.now() - lastPostFinishedAt
        if (elapsed < currentCooldownMs) {
          const waitSec = Math.ceil((currentCooldownMs - elapsed) / 1000)
          console.log(`[POLLER] Post cooldown: ${waitSec}s remaining`)
          continue
        }
      }

      // Claim job
      const { error } = await supabase.from('jobs')
        .update({ status: 'claimed', agent_id: AGENT_ID, started_at: new Date() })
        .eq('id', job.id)
        .eq('status', 'pending')

      if (error) continue  // another agent claimed it first

      pool.acquire(accId, job.id)
      console.log(`[JOB] Claimed ${job.type} (${job.id}) [${pool.running.size}/${MAX_CONCURRENT} slots]`)

      // Fire & forget — don't await, allows concurrent execution
      executeJob(job).finally(() => {
        pool.release(accId, job.id)
        if (isPostJob) {
          lastPostFinishedAt = Date.now()
          currentCooldownMs = postCooldown()
          console.log(`[POLLER] Post done, next cooldown: ${(currentCooldownMs / 60000).toFixed(1)}min`)
        }
      })
    }
  } catch (err) {
    pollFails++
    if (pollFails === 1 || pollFails % 6 === 0) {
      console.error(`[POLL ERROR] ${err.message} (failed ${pollFails}x, retrying every ${POLL_MS / 1000}s)`)
    }
    return
  }
  if (pollFails > 0) {
    console.log(`[POLLER] Reconnected after ${pollFails} poll failures`)
    pollFails = 0
  }
}

async function executeJob(job) {
  // Use payload.action for routing if available, otherwise fall back to job.type
  // This allows using allowed DB types (like check_health) while routing to specific handlers
  const handlerKey = job.payload?.action || job.type
  const handler = handlers[handlerKey]
  if (!handler) {
    console.error(`[JOB] No handler for: ${handlerKey} (type: ${job.type})`)
    await updateJobStatus(job.id, 'failed', null, `Handler not found: ${handlerKey}`)
    return
  }

  try {
    await updateJobStatus(job.id, 'running')
    console.log(`[JOB] Running ${handlerKey} (${job.id})`)

    // Re-check in case user cancelled after claim
    const { data: statusRow } = await supabase
      .from('jobs')
      .select('status')
      .eq('id', job.id)
      .single()
    if (statusRow?.status === 'cancelled') {
      console.log(`[JOB] Cancelled before start ${handlerKey} (${job.id})`)
      await updateJobStatus(job.id, 'cancelled')
      return
    }

    // Wrap handler to allow mid-run cancel checks if handler returns a promise
    const result = await handler({ ...job.payload, job_id: job.id }, supabase)
    // Final cancel check before marking done
    const { data: finalStatus } = await supabase
      .from('jobs')
      .select('status')
      .eq('id', job.id)
      .single()
    if (finalStatus?.status === 'cancelled') {
      console.log(`[JOB] Marked cancelled after handler ${handlerKey} (${job.id})`)
      await updateJobStatus(job.id, 'cancelled')
      return
    }

    await updateJobStatus(job.id, 'done', result)
    console.log(`[JOB] Done ${handlerKey} (${job.id})`)
  } catch (err) {
    const classified = classifyError(err.message)
    console.error(`[JOB] Error ${handlerKey} (${job.id}) [${classified.type}]:`, err.message)

    const maxAttempts = job.max_attempts || 3
    const nextAttempt = (job.attempt || 0) + 1

    // ─── Save to job_failures table ────────────────────
    try {
      await supabase.from('job_failures').insert({
        job_id: job.id,
        account_id: job.payload?.account_id || null,
        campaign_id: job.payload?.campaign_id || null,
        error_type: classified.type,
        error_message: err.message,
        error_stack: err.stack?.substring(0, 2000),
        handler_name: handlerKey,
        page_url: err.pageUrl || null,
        attempt: nextAttempt,
        will_retry: isRetryable(classified) && nextAttempt < maxAttempts,
        next_retry_at: isRetryable(classified) && nextAttempt < maxAttempts
          ? new Date(Date.now() + getRetryDelayMs(classified, nextAttempt - 1)) : null,
      })
    } catch (insertErr) {
      console.error(`[JOB] Failed to save job_failure:`, insertErr.message)
    }

    // ─── Update account status if needed ───────────────
    if (shouldDisableAccount(classified) && job.payload?.account_id) {
      const newStatus = classified.newStatus || 'checkpoint'
      await supabase.from('accounts')
        .update({ status: newStatus, is_active: false })
        .eq('id', job.payload.account_id)
      console.log(`[JOB] Account ${job.payload.account_id} marked as ${newStatus}`)

      // Create notification for user
      if (classified.alertLevel && job.created_by) {
        try {
          const { data: acct } = await supabase.from('accounts').select('username').eq('id', job.payload.account_id).single()
          const nick = acct?.username || job.payload.account_id
          await supabase.from('notifications').insert({
            user_id: job.created_by,
            type: classified.type === 'CHECKPOINT' ? 'checkpoint' : 'session_expired',
            title: classified.alertMsg ? classified.alertMsg(nick) : `Nick loi: ${classified.type}`,
            body: `Job ${handlerKey} that bai sau ${nextAttempt} lan. Loi: ${err.message.slice(0, 200)}`,
            level: classified.alertLevel,
            data: { job_id: job.id, account_id: job.payload.account_id },
          })
        } catch (notifErr) {
          console.error(`[JOB] Failed to create notification:`, notifErr.message)
        }
      }
    }

    // ─── Skip errors — mark done with skip result ──────
    if (err.message.startsWith('SKIP_')) {
      await supabase.from('jobs').update({
        status: 'done',
        result: { skipped: true, reason: err.message },
        finished_at: new Date(),
        error_message: err.message,
      }).eq('id', job.id)
      console.log(`[JOB] Skipped ${job.id}: ${err.message}`)
      return
    }

    // ─── Retry or fail permanently ─────────────────────
    const canRetry = isRetryable(classified) && nextAttempt < maxAttempts

    if (canRetry) {
      const retryDelayMs = getRetryDelayMs(classified, nextAttempt - 1)
      const retryAfter = new Date(Date.now() + retryDelayMs)
      await supabase.from('jobs').update({
        status: 'pending',
        attempt: nextAttempt,
        scheduled_at: retryAfter.toISOString(),
        error_message: `[${classified.type}] ${err.message}`
      }).eq('id', job.id)
      console.log(`[JOB] Retry #${nextAttempt} in ${Math.ceil(retryDelayMs / 60000)}min [${classified.type}]`)
    } else {
      const reason = !isRetryable(classified) ? classified.type : `max_attempts (${maxAttempts})`
      await supabase.from('jobs').update({
        status: 'failed',
        attempt: nextAttempt,
        error_message: `[${classified.type}] ${err.message}`,
        finished_at: new Date()
      }).eq('id', job.id)
      console.log(`[JOB] Failed permanently: ${reason} (${job.id})`)

      // Notify user on permanent failure (if alert worthy)
      if (classified.alertLevel && job.created_by && !shouldDisableAccount(classified)) {
        try {
          await supabase.from('notifications').insert({
            user_id: job.created_by,
            type: 'job_failed',
            title: `Job ${handlerKey} that bai`,
            body: `Sau ${nextAttempt} lan thu. Loi: ${err.message.slice(0, 200)}`,
            level: classified.alertLevel || 'info',
            data: { job_id: job.id, account_id: job.payload?.account_id },
          })
        } catch (notifErr) {}
      }
    }
  }
}

async function updateJobStatus(id, status, result = null, error = null) {
  await supabase.from('jobs').update({
    status,
    ...(result && { result }),
    ...(error && { error_message: error }),
    ...(status === 'done' || status === 'failed' ? { finished_at: new Date() } : {})
  }).eq('id', id)
}

async function recoverStaleJobs() {
  // Reset jobs stuck in 'claimed' or 'running' for > 10 minutes (agent likely crashed)
  const staleTime = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  const { data: stale } = await supabase
    .from('jobs')
    .select('id, type, status, started_at')
    .in('status', ['claimed', 'running'])
    .lt('started_at', staleTime)

  for (const job of (stale || [])) {
    const nextAttempt = (job.attempt || 0) + 1
    await supabase.from('jobs').update({
      status: 'pending',
      agent_id: null,
      started_at: null,
      scheduled_at: new Date().toISOString(),
      attempt: nextAttempt,
      error_message: 'Agent crashed or timed out, retrying'
    }).eq('id', job.id)
    console.log(`[POLLER] Recovered stale job ${job.type} (${job.id}) - was ${job.status} since ${job.started_at}`)
  }
  if ((stale || []).length > 0) {
    console.log(`[POLLER] Recovered ${stale.length} stale jobs`)
  }
}

function startPoller() {
  const userInfo = AGENT_USER_ID ? ` | user: ${process.env.AGENT_USER_EMAIL || AGENT_USER_ID}` : ''
  console.log(`[POLLER] Starting — max ${MAX_CONCURRENT} concurrent nicks, error-classified retry${userInfo}`)
  recoverStaleJobs().then(() => poll())
  const pollInterval = setInterval(poll, POLL_MS)
  // Periodically recover stale jobs (every 2 minutes)
  const recoverInterval = setInterval(recoverStaleJobs, 2 * 60 * 1000)

  // Export stop function for agent.js shutdown handler
  stopPoller = async () => {
    console.log('[POLLER] Stopping...')
    clearInterval(pollInterval)
    clearInterval(recoverInterval)
    await closeAll()
    console.log('[POLLER] Stopped, browser sessions closed')
  }
}

let stopPoller = async () => {} // set by startPoller

function getPool() { return pool }

module.exports = { startPoller, getStopPoller: () => stopPoller, getPool }
