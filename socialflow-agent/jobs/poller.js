const { supabase } = require('../lib/supabase')
const handlers = require('./handlers')
const os = require('os')
const { closeAll } = require('../browser/session-pool')
const { classifyError, shouldDisableAccount, isRetryable, getRetryDelayMs } = require('../lib/error-classifier')
const { postCooldown } = require('../lib/randomizer')
const { getMinGapMs, checkWarmup } = require('../lib/hard-limits')
// Audit 2026-04-14: job lifecycle (GET pending, claim, status updates, fail,
// cancel-inactive, failures log) moved to REST API. Direct pg access from
// local Windows across the internet was too slow + flaky. supabase client
// is still used for secondary reads (accounts, campaigns, etc.) where a
// single round-trip per cycle is acceptable.
const apiClient = require('../lib/api-client')

const AGENT_ID = process.env.AGENT_ID || `${os.hostname()}-${process.pid}`
const AGENT_USER_ID = process.env.AGENT_USER_ID || null  // set when user logs in via Electron
const POLL_MS = 15000 // Reduced polling — Realtime handles instant pickup, polling is backup only
const MEM_PER_NICK_MB = 350 // ~350MB per Chromium instance
const MIN_CONCURRENT = 1
const MAX_CONCURRENT_CAP = 2 // Max 2 browser cùng lúc — match MAX_SESSIONS in session-pool

function calcMaxConcurrent() {
  const override = parseInt(process.env.MAX_CONCURRENT)
  if (override > 0) return override // manual override via env

  const totalMB = os.totalmem() / (1024 * 1024)
  const freeMB = os.freemem() / (1024 * 1024)
  // Use 60% of free RAM for browser instances
  const available = freeMB * 0.6
  const calculated = Math.floor(available / MEM_PER_NICK_MB)
  return Math.max(MIN_CONCURRENT, Math.min(calculated, MAX_CONCURRENT_CAP))
}

let MAX_CONCURRENT = calcMaxConcurrent()
// Re-calculate every 2 minutes (RAM changes as browsers open/close)
setInterval(() => {
  const prev = MAX_CONCURRENT
  MAX_CONCURRENT = calcMaxConcurrent()
  if (MAX_CONCURRENT !== prev) {
    console.log(`[POLLER] Auto-scale: ${prev} → ${MAX_CONCURRENT} concurrent nicks (${Math.round(os.freemem() / 1024 / 1024)}MB free)`)
  }
}, 120000)

const POST_TYPES = ['post_page', 'post_page_graph', 'post_group', 'post_profile', 'campaign_post']

// Job types that DON'T need a browser session — only HTTP/Supabase calls.
// These are the only jobs that can run alongside browser jobs without contention.
// All other "utility" jobs (fetch_*, check_*, scan_*) actually use browser, so they
// compete for the single browser slot like interaction jobs.
const BROWSER_FREE_TYPES = ['post_page_graph']
// Phase 11 fix: utility/system jobs bypass active_hours + warmup + KPI gates.
// These are background tasks that must run 24/7 regardless of nick "work hours".
// User-facing actions (campaign_nurture, friend_request, post, interact_profile,
// discover_groups) are NOT in this list and remain subject to active_hours.
const UTILITY_TYPES = [
  ...BROWSER_FREE_TYPES,
  'check_health',
  'check_engagement',
  'check_group_membership',
  'fetch_source_cookie',
  'fetch_all',
  'fetch_pages',
  'fetch_groups',
  'fetch_inbox',
  'resolve_group',
  'scan_group_keyword',
  'scan_group_feed',
  'discover_groups_keyword',
  'watch_my_posts',
  'campaign_group_monitor',
  'warmup_browse',
  'campaign_cleanup_groups',
  'nurture_feed',
]

// ─── NickPool — tracks browser-using and HTTP-only jobs ───
// All jobs that use a browser go into `interactionNicks` and count toward MAX_CONCURRENT.
// Only BROWSER_FREE_TYPES (e.g. post_page_graph via Graph API) go into `httpOnlyNicks`
// and run alongside browser jobs without contention.
class NickPool {
  constructor() {
    this.interactionNicks = new Set()  // account_ids using browser
    this.httpOnlyNicks = new Set()     // account_ids running browser-free jobs (HTTP only)
    this.runningJobs = new Map()       // job_id → { accId, jobType }
    this.jobsToday = 0
    this.jobsFailed = 0
  }
  // Browser-using nicks count toward concurrent limit
  isBusy()         { return this.interactionNicks.size >= MAX_CONCURRENT }
  // Same name kept for backward compat
  isRunningInteraction(accId) { return this.interactionNicks.has(accId) }
  // Nick is busy if doing ANY work
  isRunning(accId) { return this.interactionNicks.has(accId) || this.httpOnlyNicks.has(accId) }
  // Check if a specific account_id has any running job (used by session-pool to prevent eviction)
  hasRunningJob(accId) {
    for (const info of this.runningJobs.values()) {
      if (info.accId === accId) return true
    }
    return false
  }
  acquire(accId, jobId, jobType) {
    if (BROWSER_FREE_TYPES.includes(jobType)) {
      this.httpOnlyNicks.add(accId)
    } else {
      this.interactionNicks.add(accId)
    }
    this.runningJobs.set(jobId, { accId, jobType })
  }
  release(accId, jobId) {
    this.interactionNicks.delete(accId)
    this.httpOnlyNicks.delete(accId)
    this.runningJobs.delete(jobId)
    this.jobsToday++
  }
  fail(accId, jobId) {
    this.interactionNicks.delete(accId)
    this.httpOnlyNicks.delete(accId)
    this.runningJobs.delete(jobId)
    this.jobsFailed++
  }
  get size() { return this.interactionNicks.size + this.httpOnlyNicks.size }
  // Legacy alias for old code that read .utilityNicks
  get utilityNicks() { return this.httpOnlyNicks }
}
const pool = new NickPool()
// Export for session-pool to query running jobs (prevent evict-while-busy bug)
if (typeof globalThis !== 'undefined') {
  globalThis.__socialflowNickPool = pool
}

// ─── Per-nick isolation tracking ─────────────────────────
const nickCooldowns = new Map()        // account_id → { lastPostAt, cooldownMs }
const nickBudgetCache = new Map()      // account_id → { budget, fetchedAt }
const nickActionTimestamps = new Map()
const consecutiveSkips = new Map()     // `campaignId_roleId` → skip count (reset on success) // `${accId}:${actionType}` → lastActionAt
const nickHourlyActions = new Map()    // account_id → { count, resetAt }
const accountStatusCache = new Map()   // account_id → { is_active, status, fetchedAt }
const nickSessionStart = new Map()     // account_id → timestamp when session started
const nickRestUntil = new Map()        // account_id → { until, durationMin }
const nickBudgetExhaustedLog = new Set() // "budget_log:{accId}:{actionType}" — suppress spam logs
const nickWarmupBlockedLog = new Set()   // "{accId}:{actionType}" — suppress warm-up spam logs (1 log/nick/action)
// Phase 16: group visit isolation — max 2 different nicks visiting same group in 30min
const groupVisitLog = new Map()        // fb_group_id → [{ nickId, ts }]
const BUDGET_CACHE_TTL = 60000         // 1 min
const STATUS_CACHE_TTL = 60000         // 1 min
const MAX_HOURLY_ACTIONS = 50          // cumulative across all types
// Randomized ranges — avoid fixed patterns that FB can detect.
// Windows come from the Hermes runtime config (see agentRuntime below) so
// the admin can tune them from the Hermes Settings UI. The initial values
// below are defaults; fetchAndApplyRuntime() refreshes them every 5 min.
const randBetween = (min, max) => Math.floor(min + Math.random() * (max - min))
const agentRuntime = {
  rest_min_minutes: 20,
  rest_max_minutes: 60,
  session_min_minutes: 25,
  session_max_minutes: 45,
}
const randSessionMax = () => randBetween(agentRuntime.session_min_minutes, agentRuntime.session_max_minutes) * 60 * 1000
const randRestMs = () => randBetween(agentRuntime.rest_min_minutes, agentRuntime.rest_max_minutes) * 60 * 1000
// Smart stagger: if a nick has already rested this long AND another healthy
// nick is also currently resting, short-circuit the rest so at least one nick
// stays working. Prevents the "both rest, agent does nothing" pattern that
// kills throughput with a small nick pool.
const MIN_REST_BEFORE_STAGGER_EARLY_RELEASE = 15 * 60 * 1000   // 15 min floor

const JOB_ACTION_MAP = {
  post_page: 'post', post_page_graph: 'post', post_group: 'post', post_profile: 'post',
  campaign_post: 'post', campaign_nurture: 'like', campaign_discover_groups: 'join_group',
  campaign_send_friend_request: 'friend_request', campaign_interact_profile: 'like',
  campaign_scan_members: 'scan', campaign_group_monitor: 'scan',
  campaign_opportunity_react: 'comment', comment_post: 'comment',
  nurture_feed: 'nurture_react',
}

let pollFails = 0

// Cache user preferences to avoid querying on every poll
let preferenceCache = { data: [], fetchedAt: 0 }
const PREF_CACHE_TTL = 30000 // 30s

async function getExcludedUserIds() {
  const now = Date.now()
  if (now - preferenceCache.fetchedAt < PREF_CACHE_TTL) return preferenceCache.data

  try {
    const ids = await apiClient.getExcludedUserIds(AGENT_ID)
    preferenceCache = { data: ids || [], fetchedAt: now }
  } catch (err) {
    console.warn(`[POLLER] getExcludedUserIds failed: ${err.message}`)
    // Return cached data on failure; empty array if no cache yet
  }
  return preferenceCache.data
}

// Audit 2026-04-12: re-entrancy guard. Realtime can fire N events at once
// (e.g. 5 new campaign_nurture rows), each triggering poll(). Without a
// guard, all N polls read the same pending job, all N UPDATE with
// WHERE status='pending', Supabase returns error:null for all (0-row
// update is NOT an error), and the job executes N times in parallel.
let _polling = false
async function poll() {
  if (_polling) return  // another poll() is already running
  _polling = true
  try { await _pollInner() } finally { _polling = false }
}
async function _pollInner() {
  if (pool.isBusy()) return  // all interaction slots taken

  try {
    const slots = MAX_CONCURRENT - pool.interactionNicks.size

    // Fetch via REST API (moved off direct pg for latency + reliability).
    // Server-side does ORDER BY priority ASC, scheduled_at ASC, LIMIT slots.
    let jobs = []
    try {
      if (AGENT_USER_ID) {
        jobs = await apiClient.getPendingJobs({ slots, userId: AGENT_USER_ID })
      } else {
        const excludedUserIds = await getExcludedUserIds()
        jobs = await apiClient.getPendingJobs({ slots, excludeUserIds: excludedUserIds })
      }
    } catch (err) {
      pollFails++
      if (pollFails === 1 || pollFails % 4 === 0) {
        console.error(`[POLL ERROR] /agent-jobs/pending ${err.message} (failed ${pollFails}x)`)
      }
      return
    }

    // Audit 2026-04-12: never open a browser for check_group_membership while
    // any campaign_nurture / campaign_send_friend_request is still pending.
    // Nurture is user-facing; membership is janitorial. Priority ordering
    // already picks nurture first, but this gate handles the case where the
    // nurture job is gated (budget/warmup/hours) and membership is the only
    // thing the poller can see. We check ALL pending nurture/FR across the
    // queue (not just this batch) once per poll cycle.
    let nurturePendingCount = null
    const needsNurtureGate = (jobs || []).some(j => j.type === 'check_group_membership')
    if (needsNurtureGate) {
      const { count } = await supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .in('type', ['campaign_nurture', 'campaign_send_friend_request'])
        .eq('status', 'pending')
        .lte('scheduled_at', new Date().toISOString())
      nurturePendingCount = count || 0
    }

    if (!jobs?.length) {
      // No pending jobs — BUT check if any jobs are currently running before closing browsers
      const hasRunningJobs = pool.runningJobs && pool.runningJobs.size > 0
      const hasRestingNick = [...nickRestUntil.entries()].some(([_, r]) => r.until > Date.now())

      if (!hasRunningJobs && !hasRestingNick) {
        const sessionPool = require('../browser/session-pool')
        const openCount = sessionPool.getSessionCount?.() || 0
        if (openCount > 0) {
          console.log(`[POLLER] No pending/running jobs, no resting nicks → closing ${openCount} idle browser(s)`)
          await sessionPool.closeAll()
        }
      }
      return
    }

    for (const job of jobs) {
      const accId = job.payload?.account_id
      const isPostJob = POST_TYPES.includes(job.type)

      // Audit 2026-04-12: defer check_group_membership when nurture/FR is pending.
      // Nurture wins the browser slot even if it's currently gated (budget, warmup,
      // rest period) — the gate will clear within a few poll cycles and the nick
      // gets to its user-facing work first.
      if (job.type === 'check_group_membership' && nurturePendingCount > 0) {
        console.log(`[POLLER] Defer check_group_membership: ${nurturePendingCount} nurture/FR pending first`)
        continue
      }

      // 1 nick = 1 browser = 1 job tại 1 thời điểm
      // Job sau ĐỢI job trước xong — không skip, không cancel, chỉ defer
      const isUtility = UTILITY_TYPES.includes(job.type)
      if (accId && pool.isRunning(accId)) continue // sẽ được pick up ở poll cycle tiếp theo

      // Per-nick post cooldown (not global — each nick tracks independently)
      if (isPostJob && accId) {
        const cd = nickCooldowns.get(accId)
        if (cd && cd.lastPostAt > 0) {
          const elapsed = Date.now() - cd.lastPostAt
          if (elapsed < cd.cooldownMs) {
            continue // this nick is cooling down, try next job
          }
        }
      }

      // Per-nick action gap enforcement
      const actionType = JOB_ACTION_MAP[job.type]
      if (actionType && accId) {
        const gapKey = `${accId}:${actionType}`
        const lastAt = nickActionTimestamps.get(gapKey)
        if (lastAt) {
          const minGap = getMinGapMs(actionType)
          if (Date.now() - lastAt < minGap) continue
        }
      }

      // Per-nick account status check (skip disabled/checkpoint/expired accounts).
      // Phase 15 fix: diagnostic jobs (check_health, check_group_membership,
      // fetch_source_cookie) MUST bypass this gate — they're the mechanism to
      // RECOVER an inactive nick. Only cancel user-facing interaction jobs.
      const BYPASS_ACTIVE_CHECK = new Set([
        'check_health', 'check_engagement', 'check_group_membership',
        'fetch_source_cookie', 'warmup_browse',
      ])
      if (accId && !BYPASS_ACTIVE_CHECK.has(job.type)) {
        const statusOk = await checkAccountActive(accId)
        if (!statusOk) {
          // Auto-cancel job for inactive nick — prevent infinite skip loop
          try {
            try { await apiClient.cancelInactiveJob({ jobId: job.id, accountId: accId }) } catch {}
          } catch {}
          console.log(`[POLLER] Nick ${accId.slice(0,8)} not active — CANCELLED ${job.type} job ${job.id}`)
          continue
        }
      }

      // Per-nick risk level check (early warning system)
      if (accId && !UTILITY_TYPES.includes(job.type)) {
        try {
          const { getWarningScore } = require('../lib/signal-collector')
          const warning = await getWarningScore(accId)
          if (warning.risk_level === 'critical') {
            // Critical: pause nick, cancel job
            try {
              try { await apiClient.updateJobStatus(job.id, { status: 'cancelled', error_message: 'risk_level_critical' }) } catch {}
              await supabase.from('accounts').update({ status: 'at_risk' }).eq('id', accId)
              await supabase.from('notifications').insert({
                user_id: job.created_by || job.payload?.owner_id,
                type: 'account_risk',
                title: `Nick ${accId.slice(0, 8)} ở mức CRITICAL`,
                body: `${warning.signals_6h} cảnh báo trong 6h. Nick đã tạm dừng tự động.`,
                level: 'urgent',
              }).catch(() => {})
            } catch {}
            console.log(`[POLLER] ⛔ Nick ${accId.slice(0, 8)} CRITICAL (${warning.signals_6h} signals/6h) — CANCELLED + paused`)
            continue
          }
          if (warning.risk_level === 'warning') {
            console.log(`[POLLER] ⚠️ Nick ${accId.slice(0, 8)} WARNING (${warning.signals_24h} signals/24h) — reducing budget 50%`)
            // Tag this job so handler knows to reduce actions
            job._riskReduction = 0.5
          }
        } catch {}
      }

      // Per-nick active hours check (Asia/Ho_Chi_Minh timezone)
      // 24/7 mode: active_hours_start=0 AND active_hours_end=24 → bypass entirely
      if (accId && !UTILITY_TYPES.includes(job.type)) {
        const cached = accountStatusCache.get(accId)
        if (cached) {
          const startH = cached.active_hours_start ?? 7
          const endH = cached.active_hours_end ?? 23
          const is247 = startH === 0 && endH === 24
          if (!is247) {
            const vnNow = new Date(Date.now() + 7 * 3600 * 1000)
            const vnHour = vnNow.getUTCHours()
            if (vnHour < startH || vnHour >= endH) {
              continue // outside active hours — job stays pending
            }
          }
        }
      }

      // Per-nick warm-up check (block certain actions for young nicks)
      if (accId && actionType && actionType !== 'utility') {
        const cached = accountStatusCache.get(accId)
        if (cached?.created_at) {
          const ageDays = Math.floor((Date.now() - new Date(cached.created_at).getTime()) / 86400000)
          const warmup = checkWarmup(actionType, ageDays)
          if (!warmup.allowed) {
            // Suppress repeat logs — same pattern as nickBudgetExhaustedLog
            const warmupKey = `${accId}:${actionType}`
            if (!nickWarmupBlockedLog.has(warmupKey)) {
              nickWarmupBlockedLog.add(warmupKey)
              console.log(`[POLLER] Nick ${accId.slice(0,8)} warm-up blocked: ${warmup.reason} (suppressing further logs)`)
            }
            continue
          }
        }
      }

      // Phase 11: per-nick KPI gate — skip if this nick has already met its
      // share for THIS job's action type today (frees the slot for nicks behind).
      // Maps job.type → KPI action field.
      const KPI_FIELD_MAP = {
        campaign_nurture: 'comments',           // primary action
        campaign_send_friend_request: 'friend_requests',
        campaign_discover_groups: 'group_joins',
      }
      const kpiField = KPI_FIELD_MAP[job.type]
      const campaignIdForKpi = job.payload?.campaign_id
      if (accId && campaignIdForKpi && kpiField) {
        try {
          // VN date (UTC+7) — must match kpi-calculator.js + activity-logger.js
          const today = new Date(Date.now() + 7 * 3600000).toISOString().split('T')[0]
          const { data: kpiRow } = await supabase.from('nick_kpi_daily')
            .select('kpi_met, target_likes, done_likes, target_comments, done_comments, target_friend_requests, done_friend_requests, target_group_joins, done_group_joins')
            .eq('campaign_id', campaignIdForKpi)
            .eq('account_id', accId)
            .eq('date', today)
            .maybeSingle()
          if (kpiRow) {
            // Guard: if all targets=0, the row was created by increment_kpi
            // before rebalance ran — ignore kpi_met (it would be true because
            // target=0 OR done>=target, both trivially satisfied).
            const hasTargets = (kpiRow.target_likes || 0) > 0 || (kpiRow.target_comments || 0) > 0
            if (kpiRow.kpi_met && hasTargets) {
              console.log(`[POLLER] Nick ${accId.slice(0,8)} KPI met today — yielding slot`)
              continue
            }
            // Action-specific check
            const targetField = `target_${kpiField}`
            const doneField = `done_${kpiField}`
            const tgt = kpiRow[targetField] || 0
            const done = kpiRow[doneField] || 0
            if (tgt > 0 && done >= tgt) {
              console.log(`[POLLER] Nick ${accId.slice(0,8)} ${kpiField} KPI met (${done}/${tgt}) — skipping ${job.type}`)
              continue
            }
          }
        } catch {}
      }

      // Phase 16: group visit isolation — max 2 different nicks in same group within 30min.
      // Only for nurture/interact/monitor jobs that target a specific group.
      if (accId && ['campaign_nurture', 'campaign_interact_profile', 'campaign_group_monitor'].includes(job.type)) {
        // Clean expired entries every check (cheap — map is small)
        const now = Date.now()
        for (const [gid, visits] of groupVisitLog.entries()) {
          const fresh = visits.filter(v => now - v.ts < 30 * 60 * 1000)
          if (fresh.length === 0) groupVisitLog.delete(gid)
          else groupVisitLog.set(gid, fresh)
        }
      }

      // Per-nick hourly rate limit (max 50 actions/hour across all types)
      if (accId) {
        const hourly = nickHourlyActions.get(accId)
        if (hourly) {
          if (Date.now() > hourly.resetAt) {
            nickHourlyActions.set(accId, { count: 0, resetAt: Date.now() + 3600000 })
          } else if (hourly.count >= MAX_HOURLY_ACTIONS) {
            console.log(`[POLLER] Nick ${accId.slice(0,8)} hit hourly limit (${MAX_HOURLY_ACTIONS}), skipping`)
            continue
          }
        }
      }

      // Per-nick session duration cap (25-45min random continuous work)
      if (accId) {
        const sessionStart = nickSessionStart.get(accId)
        // Each nick gets a random session max on first check
        if (!nickSessionStart.has(`${accId}_max`)) nickSessionStart.set(`${accId}_max`, randSessionMax())
        const sessionMax = nickSessionStart.get(`${accId}_max`)
        if (sessionStart && (Date.now() - sessionStart) > sessionMax) {
          const durMin = Math.round((Date.now() - sessionStart) / 60000)
          console.log(`[POLLER] Nick ${accId.slice(0,8)} session ${durMin}min, forcing rest`)
          nickSessionStart.delete(accId)
          nickSessionStart.delete(`${accId}_max`)
          const restMs = randRestMs()
          nickRestUntil.set(accId, { until: Date.now() + restMs, durationMin: Math.round(restMs / 60000) })
          try { const { releaseSession } = require('../browser/session-pool'); releaseSession(accId) } catch {}
          continue
        }
      }

      // Per-nick rest period (20-60min random gap).
      // Smart stagger: if another resting nick exists AND this nick has
      // already rested >= 15 min, release early. Ensures with 2-3 healthy
      // nicks we never have ALL of them in rest simultaneously.
      if (accId) {
        const rest = nickRestUntil.get(accId)
        if (rest && Date.now() < rest.until) {
          const restedMs = rest.durationMin * 60000 - (rest.until - Date.now())
          // Check other nicks also resting
          let othersResting = 0
          for (const [otherId, otherRest] of nickRestUntil.entries()) {
            if (otherId !== accId && otherRest.until > Date.now()) othersResting++
          }
          const canStaggerEarly = othersResting > 0 && restedMs >= MIN_REST_BEFORE_STAGGER_EARLY_RELEASE
          if (canStaggerEarly) {
            console.log(`[POLLER] Nick ${accId.slice(0,8)} early-release from rest (${Math.round(restedMs/60000)}min rested, ${othersResting} other nick${othersResting > 1 ? 's' : ''} also resting)`)
            nickRestUntil.delete(accId)
            // fall through to the rest of the per-nick gates
          } else {
            const remainMin = Math.round((rest.until - Date.now()) / 60000)
            if (!nickSessionStart.has(`${accId}_restlog`) || Date.now() - nickSessionStart.get(`${accId}_restlog`) > 300000) {
              console.log(`[POLLER] Nick ${accId.slice(0,8)} resting (${remainMin}/${rest.durationMin}min)`)
              nickSessionStart.set(`${accId}_restlog`, Date.now())
            }
            continue
          }
        }
        if (rest && Date.now() >= rest.until) nickRestUntil.delete(accId)
      }

      // Per-nick budget pre-check (avoid claiming if daily limit already reached)
      if (actionType && accId) {
        const budgetOk = await checkBudgetBeforeClaim(accId, actionType)
        if (!budgetOk) {
          // Suppress spam: only log once per nick+action until reset
          const logKey = `budget_log:${accId}:${actionType}`
          if (!nickBudgetExhaustedLog.has(logKey)) {
            nickBudgetExhaustedLog.add(logKey)
            console.log(`[POLLER] Nick ${accId.slice(0,8)} budget exhausted for ${actionType}, skipping (further logs suppressed until reset)`)
          }
          continue
        }
      }

      // ATOMIC: Acquire pool slot BEFORE claiming in DB
      // This prevents race: two poll cycles both see nick as free
      if (accId) {
        pool.acquire(accId, job.id, job.type)
        // Start session timer if not already running
        if (!nickSessionStart.has(accId)) {
          nickSessionStart.set(accId, Date.now())
        }
      }

      // Claim via REST — server returns 409 if already claimed by another
      // poll cycle / agent. API does the atomic UPDATE WHERE status='pending'
      // and checks rowCount, so the duplicate-execution race from the old
      // supabase.from('jobs').update() path is gone.
      let claimOk = null
      try {
        claimOk = await apiClient.claimJob(job.id, AGENT_ID)
      } catch (err) {
        console.warn(`[JOB] Claim ${job.id} threw: ${err.message}`)
      }
      if (!claimOk) {
        if (accId) pool.release(accId, job.id)
        continue
      }

      // Set pessimistic cooldown + timestamps AT CLAIM TIME (not after completion)
      // This prevents next poll from picking up another job for this nick
      if (isPostJob && accId) {
        nickCooldowns.set(accId, { lastPostAt: Date.now(), cooldownMs: 10 * 60000 }) // pessimistic 10min
      }
      if (actionType && accId) {
        nickActionTimestamps.set(`${accId}:${actionType}`, Date.now())
      }
      // Optimistic budget increment (prevents race: 2 jobs same nick in 1 poll cycle)
      if (actionType && accId) {
        const cached = nickBudgetCache.get(accId)
        if (cached?.budget?.[actionType]) {
          cached.budget[actionType].used = (cached.budget[actionType].used || 0) + 1
        }
      }
      // Increment hourly counter
      if (accId) {
        const hourly = nickHourlyActions.get(accId) || { count: 0, resetAt: Date.now() + 3600000 }
        hourly.count++
        nickHourlyActions.set(accId, hourly)
      }

      console.log(`[JOB] Claimed ${job.type} (${job.id}) [${pool.interactionNicks.size}/${MAX_CONCURRENT} browser${pool.httpOnlyNicks.size ? ` +${pool.httpOnlyNicks.size} http-only` : ''}]`)

      // Fire & forget — don't await, allows concurrent execution
      executeJob(job).finally(() => {
        pool.release(accId, job.id)

        // Update cooldown with actual value (overwrite pessimistic)
        if (isPostJob && accId) {
          const cd = postCooldown()
          nickCooldowns.set(accId, { lastPostAt: Date.now(), cooldownMs: cd })
          console.log(`[POLLER] Nick ${accId.slice(0,8)} post done, cooldown: ${(cd / 60000).toFixed(1)}min`)
        }

        // Update action timestamp (overwrite claim-time value)
        if (actionType && accId) {
          nickActionTimestamps.set(`${accId}:${actionType}`, Date.now())
        }

        // Invalidate budget cache + log suppression so next poll fetches fresh
        if (accId) {
          nickBudgetCache.delete(accId)
          // Clear all budget exhausted log suppressions for this nick
          for (const key of nickBudgetExhaustedLog) {
            if (key.startsWith(`budget_log:${accId}:`)) nickBudgetExhaustedLog.delete(key)
          }
          // Clear warmup suppressions too — nick may have crossed an age boundary
          for (const key of nickWarmupBlockedLog) {
            if (key.startsWith(`${accId}:`)) nickWarmupBlockedLog.delete(key)
          }
        }

        // If nick has no more running jobs, end session tracking
        // (next job will start a fresh session timer)
        if (accId && !pool.isRunning(accId)) {
          const sessionStart = nickSessionStart.get(accId)
          if (sessionStart) {
            const durationMin = Math.round((Date.now() - sessionStart) / 60000)
            console.log(`[POLLER] Nick ${accId.slice(0,8)} session ended after ${durationMin}min`)
            nickSessionStart.delete(accId)
            // Only rest after interaction jobs that actually did work (> 1 min)
            const isInteraction = (job.type || '').startsWith('campaign_') ||
              ['comment_post', 'post_page', 'post_group', 'post_profile', 'join_group'].includes(job.type)
            if (isInteraction && durationMin >= 1) {
              const restMs = randRestMs()
              const restMin = Math.round(restMs / 60000)
              nickRestUntil.set(accId, { until: Date.now() + restMs, durationMin: restMin })
              nickSessionStart.delete(`${accId}_max`)
              console.log(`[POLLER] Nick ${accId.slice(0,8)} → rest ${restMin}min (after ${durationMin}min work)`)
            } else if (isInteraction && durationMin < 1) {
              console.log(`[POLLER] Nick ${accId.slice(0,8)} → no rest (session was ${durationMin}min, skipped/failed)`)
            }
          }
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

    // Check campaign still active (for campaign jobs only)
    if (job.payload?.campaign_id && handlerKey.startsWith('campaign_')) {
      const { data: camp } = await supabase.from('campaigns')
        .select('status').eq('id', job.payload.campaign_id).single()
      if (camp && !['active', 'running'].includes(camp.status)) {
        console.log(`[JOB] Campaign ${job.payload.campaign_id} is ${camp.status}, skipping job`)
        await updateJobStatus(job.id, 'done', { skipped: true, reason: `campaign_${camp.status}` })
        return
      }
    }

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

    // Reset consecutive skip counter on success
    if (job.payload?.campaign_id) {
      const skipKey = `${job.payload.campaign_id}_${job.payload.role_id || 'default'}`
      consecutiveSkips.delete(skipKey)
    }
  } catch (err) {
    // Session pool busy → don't fail, reset to pending and let next poll retry
    if (err.code === 'SESSION_POOL_BUSY' || err.message === 'SESSION_POOL_BUSY') {
      console.log(`[JOB] Session pool busy, requeue ${handlerKey} (${job.id}) for retry in 30s`)
      try {
        await apiClient.updateJobStatus(job.id, {
          status: 'pending',
          scheduled_at: new Date(Date.now() + 30000).toISOString(),
        })
      } catch {}
      return // skip the rest of the error handling — not a real failure
    }

    const classified = classifyError(err.message)
    console.error(`[JOB] Error ${handlerKey} (${job.id}) [${classified.type}]:`, err.message)

    const maxAttempts = job.max_attempts || 3
    const nextAttempt = (job.attempt || 0) + 1

    // ─── BROWSER_CRASH: clear profile lock + requeue, NEVER disable account ──
    // Browser launch failures (lock files, process kill, etc) are infrastructure
    // problems, not account problems. Don't penalize the nick.
    if (classified.isBrowserCrash && job.payload?.account_id) {
      try {
        const path = require('path')
        const os = require('os')
        const { clearProfileLock } = require('../browser/launcher')
        const userDataDir = path.join(os.homedir(), '.socialflow', 'profiles', job.payload.account_id, 'browser-data')
        clearProfileLock(userDataDir)
      } catch (clearErr) {
        console.warn(`[JOB] clearProfileLock failed: ${clearErr.message}`)
      }
      // Requeue with 60s delay — don't increment attempt counter, don't fail
      try {
        await apiClient.updateJobStatus(job.id, {
          status: 'pending',
          scheduled_at: new Date(Date.now() + 60000).toISOString(),
          error_message: 'BROWSER_CRASH — auto-retry after clearing profile lock',
        })
      } catch {}
      console.log(`[JOB] BROWSER_CRASH ${handlerKey} (${job.id}) — cleared lock, requeue in 60s (no penalty)`)
      return // skip rest of error handling
    }

    // ─── Save to job_failures table (via REST) ─────────
    try {
      await apiClient.recordFailure({
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
          ? new Date(Date.now() + getRetryDelayMs(classified, nextAttempt - 1)).toISOString() : null,
      })
    } catch (insertErr) {
      console.error(`[JOB] Failed to save job_failure:`, insertErr.message)
    }

    // ─── CHECKPOINT double-check: require 2 CHECKPOINT errors in last hour ──
    // First strike → queue health check, don't disable yet (false positives common)
    if (classified.type === 'CHECKPOINT' && job.payload?.account_id) {
      try {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString()
        const { count: recentCheckpoints } = await supabase
          .from('job_failures')
          .select('id', { count: 'exact', head: true })
          .eq('account_id', job.payload.account_id)
          .eq('error_type', 'CHECKPOINT')
          .gte('created_at', oneHourAgo)

        if ((recentCheckpoints || 0) < 2) {
          console.log(`[JOB] CHECKPOINT first strike for ${job.payload.account_id.slice(0, 8)} — queueing health check, NOT disabling`)
          // Queue a health check to confirm
          try {
            const { data: existing } = await supabase.from('jobs')
              .select('id')
              .eq('type', 'check-health')
              .eq('payload->>account_id', job.payload.account_id)
              .in('status', ['pending', 'claimed', 'running'])
              .limit(1)
            if (!existing?.length) {
              await supabase.from('jobs').insert({
                type: 'check-health',
                priority: 1,
                payload: { account_id: job.payload.account_id, action: 'check-health', auto_refresh: true },
                status: 'pending',
                scheduled_at: new Date(Date.now() + 30000).toISOString(),
                created_by: job.created_by,
              })
            }
          } catch {}
          // Mark job as failed (single attempt) but don't disable account
          try {
            await apiClient.failJob(job.id, { error_message: 'CHECKPOINT first strike — health check queued', attempt: nextAttempt })
          } catch {}
          return // bypass disable
        }
        console.log(`[JOB] CHECKPOINT confirmed (${recentCheckpoints} in last hour) — disabling account`)
      } catch (checkErr) {
        console.warn(`[JOB] CHECKPOINT double-check failed: ${checkErr.message}`)
      }
    }

    // ─── Update account status if needed ───────────────
    if (shouldDisableAccount(classified) && job.payload?.account_id) {
      const newStatus = classified.newStatus || 'checkpoint'
      await supabase.from('accounts')
        .update({ status: newStatus, is_active: false })
        .eq('id', job.payload.account_id)
      console.log(`[JOB] Account ${job.payload.account_id} marked as ${newStatus}`)
      // Invalidate status cache immediately
      accountStatusCache.delete(job.payload.account_id)

      // Fire-and-forget cookie-death postmortem — Hermes reads the last 2h of
      // activity log + budget snapshot and stores a `checkpoint_pattern`
      // memory + a `checkpoint_analysis` decision row. Poller does NOT wait
      // for the result (analyzer runs ~10-30s).
      try {
        const API_URL = process.env.API_URL || process.env.API_BASE_URL
        const AGENT_KEY = process.env.AGENT_SECRET_KEY
        if (API_URL && AGENT_KEY) {
          fetch(`${API_URL}/ai-hermes/cookie-death`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Agent-Key': AGENT_KEY },
            body: JSON.stringify({
              account_id: job.payload.account_id,
              death_type: classified.type,
              death_message: err.message.slice(0, 500),
              window_hours: 2,
            }),
          }).then(r => r.ok && console.log(`[COOKIE-DEATH] postmortem fired for ${job.payload.account_id?.slice(0,8)}`))
            .catch(e => console.warn(`[COOKIE-DEATH] fire failed: ${e.message}`))
        }
      } catch (e) { console.warn(`[COOKIE-DEATH] dispatch failed: ${e.message}`) }

      // Auto-queue health check to try refreshing cookie (only for SESSION_EXPIRED, not CHECKPOINT)
      if (classified.type === 'SESSION_EXPIRED') {
        try {
          const { data: existing } = await supabase.from('jobs')
            .select('id')
            .eq('type', 'check-health')
            .eq('payload->>account_id', job.payload.account_id)
            .in('status', ['pending', 'claimed', 'running'])
            .limit(1)
          if (!existing?.length) {
            await supabase.from('jobs').insert({
              type: 'check-health',
              priority: 1, // CRITICAL
              payload: { account_id: job.payload.account_id, action: 'check-health', auto_refresh: true },
              status: 'pending',
              scheduled_at: new Date(Date.now() + 60000).toISOString(), // 1 phut sau
              created_by: job.created_by,
            })
            console.log(`[JOB] Auto-queued health check for expired account ${job.payload.account_id}`)
          }
        } catch (e) {
          console.warn(`[JOB] Failed to queue auto health check:`, e.message)
        }
      }

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
      await apiClient.updateJobStatus(job.id, {
        status: 'done',
        result: { skipped: true, reason: err.message },
        error_message: err.message,
      })
      console.log(`[JOB] Skipped ${job.id}: ${err.message}`)

      // Track consecutive skips per campaign+role — prevent infinite loop
      if (err.message === 'SKIP_no_groups_joined' && job.payload?.campaign_id) {
        const skipKey = `${job.payload.campaign_id}_${job.payload.role_id || 'default'}`
        const skipCount = (consecutiveSkips.get(skipKey) || 0) + 1
        consecutiveSkips.set(skipKey, skipCount)

        if (skipCount >= 3) {
          // 3 consecutive skips → notify user + pause this role
          console.warn(`[JOB] ⚠️ ${skipCount} consecutive skips for campaign role — notifying user`)
          try {
            await supabase.from('notifications').insert({
              user_id: job.payload.owner_id || job.created_by,
              title: 'AI Pilot: Không tìm được nhóm phù hợp',
              body: `Campaign "${job.payload.topic || 'unknown'}" đã thử ${skipCount} lần nhưng không tìm được nhóm nào phù hợp. Hãy kiểm tra topic hoặc thêm nhóm thủ công.`,
              type: 'campaign_warning',
              metadata: { campaign_id: job.payload.campaign_id, role_id: job.payload.role_id },
            })
          } catch {}

          // Pause the role to stop new jobs
          if (job.payload.role_id) {
            await supabase.from('campaign_roles')
              .update({ status: 'paused' })
              .eq('id', job.payload.role_id)
            console.warn(`[JOB] Paused role ${job.payload.role_id} after ${skipCount} consecutive no-group skips`)
          }
          consecutiveSkips.delete(skipKey)
        }
      }
      return
    }

    // ─── Retry or fail permanently ─────────────────────
    const canRetry = isRetryable(classified) && nextAttempt < maxAttempts

    if (canRetry) {
      const retryDelayMs = getRetryDelayMs(classified, nextAttempt - 1)
      const retryAfter = new Date(Date.now() + retryDelayMs)
      await apiClient.updateJobStatus(job.id, {
        status: 'pending',
        attempt: nextAttempt,
        scheduled_at: retryAfter.toISOString(),
        error_message: `[${classified.type}] ${err.message}`,
      })
      console.log(`[JOB] Retry #${nextAttempt} in ${Math.ceil(retryDelayMs / 60000)}min [${classified.type}]`)
    } else {
      const reason = !isRetryable(classified) ? classified.type : `max_attempts (${maxAttempts})`
      await apiClient.failJob(job.id, {
        error_message: `[${classified.type}] ${err.message}`,
        attempt: nextAttempt,
      })
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
  const update = { status }
  if (result) update.result = result
  if (error) update.error_message = error
  await apiClient.updateJobStatus(id, update)
}

async function recoverStaleJobs() {
  // Reset jobs stuck in 'claimed' or 'running' for > 10 minutes (agent likely crashed).
  // API does the SELECT + UPDATE server-side in one call — saves 2 round trips.
  try {
    const res = await apiClient.recoverStaleJobs()
    if (res?.recovered > 0) {
      console.log(`[POLLER] Recovered ${res.recovered}/${res.total_stale} stale jobs`)
    }
  } catch (err) {
    console.warn(`[POLLER] recoverStaleJobs failed: ${err.message}`)
  }
  return
  if ((stale || []).length > 0) {
    console.log(`[POLLER] Recovered ${stale.length} stale jobs`)
  }
}

// ─── Opportunity React: pick pending opportunities and create react jobs ───
async function checkOpportunities() {
  try {
    const { data: opps } = await supabase
      .from('group_opportunities')
      .select('*, monitored_groups(brand_keywords, brand_name, brand_voice, account_id, campaign_id, owner_id)')
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .order('opportunity_score', { ascending: false })
      .limit(5)

    if (!opps?.length) return

    let created = 0
    for (const opp of opps) {
      const mg = opp.monitored_groups
      if (!mg) continue

      // Pick a reactor account DIFFERENT from the scanner
      const scannerAccountId = mg.account_id
      const { data: campaignRoles } = await supabase
        .from('campaign_roles')
        .select('account_ids')
        .eq('campaign_id', mg.campaign_id)
        .eq('is_active', true)

      // Collect all account IDs from campaign roles
      const allAccountIds = [...new Set(
        (campaignRoles || []).flatMap(r => r.account_ids || [])
      )].filter(id => id !== scannerAccountId)

      if (allAccountIds.length === 0) {
        console.log(`[OPP-CHECK] No alternative accounts for opportunity ${opp.id}, skipping`)
        continue
      }

      // Check which accounts are active and old enough (>= 21 days)
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, created_at, status, is_active')
        .in('id', allAccountIds)
        .eq('is_active', true)
        .eq('status', 'healthy')

      const eligible = (accounts || []).filter(a => {
        const age = Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86400000)
        return age >= 21 // Week 3+ warmup
      })

      if (eligible.length === 0) {
        console.log(`[OPP-CHECK] No eligible reactors for opportunity ${opp.id}`)
        continue
      }

      // Pick random eligible account
      const reactor = eligible[Math.floor(Math.random() * eligible.length)]

      // Check this account hasn't already acted on this post
      const { count: alreadyActed } = await supabase
        .from('group_opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('post_fb_id', opp.post_fb_id)
        .eq('acted_by_account_id', reactor.id)
        .eq('status', 'acted')

      if (alreadyActed > 0) continue

      // Check no duplicate react job
      const { count: dupJob } = await supabase
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('type', 'campaign_opportunity_react')
        .in('status', ['pending', 'claimed', 'running'])
        .filter('payload->>opportunity_id', 'eq', opp.id)

      if (dupJob > 0) continue

      // Mark opportunity as 'acting' to prevent double-pick
      await supabase.from('group_opportunities')
        .update({ status: 'acting' })
        .eq('id', opp.id)
        .eq('status', 'pending') // optimistic lock

      // Create react job
      const { error } = await supabase.from('jobs').insert({
        type: 'campaign_opportunity_react',
        priority: 5, // NORMAL
        payload: {
          opportunity_id: opp.id,
          account_id: reactor.id,
          campaign_id: mg.campaign_id,
          owner_id: mg.owner_id,
        },
        status: 'pending',
        scheduled_at: new Date(Date.now() + Math.floor(Math.random() * 120 + 30) * 1000).toISOString(), // 30s-2.5min jitter
        created_by: mg.owner_id,
      })

      if (!error) {
        created++
        console.log(`[OPP-CHECK] Created react job for opportunity ${opp.id} (score: ${opp.opportunity_score}) → account ${reactor.id.slice(0, 8)}`)
      }
    }

    if (created > 0) {
      console.log(`[OPP-CHECK] Created ${created} opportunity react jobs`)
    }
  } catch (err) {
    console.error(`[OPP-CHECK] Error: ${err.message}`)
  }
}

// ─── Phase 3: Shared Post Swarm — extend swarm targets for high-score pooled posts ───
async function checkSharedPostSwarm() {
  try {
    const { data: posts } = await supabase
      .from('shared_posts')
      .select('*')
      .eq('status', 'pending')
      .eq('is_ad_post', false)
      .gt('expires_at', new Date().toISOString())
      .order('ai_score', { ascending: false })
      .limit(10)

    if (!posts?.length) return

    let created = 0
    for (const p of posts) {
      if ((p.swarm_count || 0) >= (p.swarm_target || 1)) continue

      // Find eligible accounts in this campaign that haven't acted on this post yet
      const { data: roles } = await supabase
        .from('campaign_roles')
        .select('account_ids')
        .eq('campaign_id', p.campaign_id)
        .eq('is_active', true)
      const allIds = [...new Set((roles || []).flatMap(r => r.account_ids || []))]
        .filter(id => !(p.swarm_account_ids || []).includes(id))
      if (!allIds.length) continue

      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, created_at')
        .in('id', allIds)
        .eq('is_active', true)
        .eq('status', 'healthy')
      const eligible = (accounts || []).filter(a => {
        const age = Math.floor((Date.now() - new Date(a.created_at).getTime()) / 86400000)
        return age >= 21
      })
      if (!eligible.length) continue

      const reactor = eligible[Math.floor(Math.random() * eligible.length)]

      // Cumulative delay based on swarm_count: nick2 +10-20min, nick3 +25-40min
      const slot = (p.swarm_count || 0) + 1
      const delayMin = slot === 2 ? (10 + Math.random() * 10) : (25 + Math.random() * 15)
      const scheduledAt = new Date(Date.now() + delayMin * 60 * 1000).toISOString()

      const { error } = await supabase.from('jobs').insert({
        type: 'campaign_opportunity_react',
        priority: 5,
        payload: {
          shared_post_id: p.id,
          post_fb_id: p.post_fb_id,
          post_url: p.post_url,
          account_id: reactor.id,
          campaign_id: p.campaign_id,
          comment_angle: p.comment_angle,
          language: p.language,
        },
        status: 'pending',
        scheduled_at: scheduledAt,
      })

      if (!error) {
        // Optimistic: claim a swarm slot
        await supabase.from('shared_posts').update({
          swarm_count: (p.swarm_count || 0) + 1,
          swarm_account_ids: [...(p.swarm_account_ids || []), reactor.id],
          status: ((p.swarm_count || 0) + 1) >= (p.swarm_target || 1) ? 'in_progress' : 'pending',
        }).eq('id', p.id)
        created++
        console.log(`[SWARM] Queued react slot ${slot}/${p.swarm_target} for shared_post ${p.id.slice(0,8)} (delay +${Math.round(delayMin)}min)`)
      }
    }
    if (created > 0) console.log(`[SWARM] Created ${created} swarm react jobs`)
  } catch (err) {
    console.error(`[SWARM] Error: ${err.message}`)
  }
}

async function syncRuntimeConfig() {
  const remote = await apiClient.getRuntimeConfig()
  if (!remote || typeof remote !== 'object') return
  let changed = false
  for (const k of Object.keys(agentRuntime)) {
    if (remote[k] !== undefined && remote[k] !== null && remote[k] !== agentRuntime[k]) {
      agentRuntime[k] = remote[k]
      changed = true
    }
  }
  if (changed) {
    console.log(`[POLLER] Hermes runtime config synced: rest=${agentRuntime.rest_min_minutes}-${agentRuntime.rest_max_minutes}min, session=${agentRuntime.session_min_minutes}-${agentRuntime.session_max_minutes}min`)
  }
}

function startPoller() {
  const userInfo = AGENT_USER_ID ? ` | user: ${process.env.AGENT_USER_EMAIL || AGENT_USER_ID}` : ''
  const totalGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1)
  const freeGB = (os.freemem() / 1024 / 1024 / 1024).toFixed(1)
  console.log(`[POLLER] Starting — max ${MAX_CONCURRENT} concurrent nicks (auto-scale, ${freeGB}/${totalGB}GB RAM), Realtime+Polling hybrid${userInfo}`)

  // Pull Hermes-controlled runtime config now + every 5 min.
  // User tweaks rest/session/timeout from /hermes/settings → Agent Playwright
  // and the agent picks up the new values on the next sync without a restart.
  syncRuntimeConfig().catch(() => {})
  const runtimeInterval = setInterval(() => {
    syncRuntimeConfig().catch(() => {})
  }, 5 * 60 * 1000)

  recoverStaleJobs().then(() => poll())
  const pollInterval = setInterval(poll, POLL_MS)
  const recoverInterval = setInterval(recoverStaleJobs, 2 * 60 * 1000)

  // ── Group Opportunity React: check pending opportunities every 5 min ──
  const opportunityInterval = setInterval(() => {
    checkOpportunities().catch(err => console.warn(`[OPP-CHECK] Error: ${err.message}`))
    checkSharedPostSwarm().catch(err => console.warn(`[SWARM] Error: ${err.message}`))
  }, 5 * 60 * 1000)

  // ── Supabase Realtime: instant job pickup ──
  // Subscribe to INSERT events on jobs table — triggers poll() immediately
  let realtimeChannel = null
  try {
    realtimeChannel = supabase
      .channel('jobs-realtime')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'jobs',
        filter: 'status=eq.pending',
      }, (payload) => {
        const jobType = payload.new?.type || '?'
        console.log(`[REALTIME] New job: ${jobType} — triggering immediate poll`)
        // Debounce: don't poll if we just polled < 2s ago
        poll()
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('[REALTIME] ✓ Subscribed to jobs table — instant pickup enabled')
        } else if (status === 'CHANNEL_ERROR') {
          console.warn('[REALTIME] ⚠️ Channel error — falling back to polling only')
        }
      })
  } catch (err) {
    console.warn(`[REALTIME] Failed to subscribe: ${err.message} — polling only`)
  }

  // Export stop function for agent.js shutdown handler
  stopPoller = async () => {
    console.log('[POLLER] Stopping...')
    clearInterval(pollInterval)
    clearInterval(recoverInterval)
    clearInterval(opportunityInterval)
    clearInterval(runtimeInterval)
    if (realtimeChannel) {
      try { await supabase.removeChannel(realtimeChannel) } catch {}
    }
    await closeAll()
    // Flush pending health signals
    try { const { stopCollector } = require('../lib/signal-collector'); await stopCollector() } catch {}
    console.log('[POLLER] Stopped, browser sessions closed')
  }
}

let stopPoller = async () => {} // set by startPoller

function getPool() { return pool }

// ─── Per-nick account status check ──────────────────────
async function checkAccountActive(accountId) {
  try {
    const cached = accountStatusCache.get(accountId)
    if (cached && Date.now() - cached.fetchedAt < STATUS_CACHE_TTL) {
      return cached.is_active === true
    }
    const { data } = await supabase
      .from('accounts')
      .select('is_active, status, created_at, active_hours_start, active_hours_end')
      .eq('id', accountId)
      .single()
    if (data) {
      accountStatusCache.set(accountId, { ...data, fetchedAt: Date.now() })
      return data.is_active === true
    }
    return true // account not found — let handler deal with it
  } catch {
    return true
  }
}

// ─── Per-nick budget pre-check ───────────────────────────
async function checkBudgetBeforeClaim(accountId, actionType) {
  try {
    const cached = nickBudgetCache.get(accountId)
    let budget = cached?.budget

    if (!cached || Date.now() - cached.fetchedAt >= BUDGET_CACHE_TTL) {
      const { data } = await supabase
        .from('accounts')
        .select('daily_budget')
        .eq('id', accountId)
        .single()
      budget = data?.daily_budget || {}
      nickBudgetCache.set(accountId, { budget, fetchedAt: Date.now() })
    }

    // Check if budget needs daily reset (reset_at is before today VN timezone)
    const resetAt = budget?.reset_at
    if (resetAt) {
      const vnNow = new Date(Date.now() + 7 * 3600 * 1000) // UTC+7
      const vnToday = vnNow.toISOString().slice(0, 10)
      const resetDate = new Date(new Date(resetAt).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10)

      if (resetDate < vnToday) {
        // Budget is stale — trigger reset by calling increment_budget with 0
        console.log(`[POLLER] Budget stale for ${accountId.slice(0, 8)} (reset_at=${resetDate}, today=${vnToday}) — triggering reset`)
        try {
          await supabase.rpc('increment_budget', { p_account_id: accountId, p_action_type: actionType, p_count: 0 })
          // Invalidate cache to fetch fresh reset budget
          nickBudgetCache.delete(accountId)
          // Clear log suppression
          for (const key of nickBudgetExhaustedLog) {
            if (key.startsWith(`budget_log:${accountId}:`)) nickBudgetExhaustedLog.delete(key)
          }
          // New day → nick may have aged past warmup phase, allow logs again
          for (const key of nickWarmupBlockedLog) {
            if (key.startsWith(`${accountId}:`)) nickWarmupBlockedLog.delete(key)
          }
          return true // budget just reset, allow
        } catch (resetErr) {
          console.warn(`[POLLER] Budget reset RPC failed: ${resetErr.message}`)
        }
      }
    }

    const cat = budget?.[actionType]
    if (cat && cat.used >= cat.max) return false
    return true
  } catch {
    return true // on error, allow the job (handler will check again)
  }
}

// Phase 16: group isolation — handlers call this after visiting a group
function recordGroupVisit(fbGroupId, nickId) {
  if (!fbGroupId || !nickId) return
  const visits = groupVisitLog.get(fbGroupId) || []
  visits.push({ nickId, ts: Date.now() })
  groupVisitLog.set(fbGroupId, visits)
}

function canVisitGroup(fbGroupId, nickId) {
  if (!fbGroupId) return true
  const visits = (groupVisitLog.get(fbGroupId) || []).filter(v => Date.now() - v.ts < 30 * 60 * 1000)
  const uniqueNicks = new Set(visits.map(v => v.nickId))
  if (uniqueNicks.has(nickId)) return true // this nick already visited → ok
  return uniqueNicks.size < 2 // max 2 different nicks per 30min
}

module.exports = { startPoller, getStopPoller: () => stopPoller, getPool, recordGroupVisit, canVisitGroup }
