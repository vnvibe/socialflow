/**
 * Hard limits — CANNOT be overridden by user/campaign config
 * These protect accounts from Facebook detection
 */

const HARD_LIMITS = {
  friend_request: { maxPerDay: 20, maxPerSession: 5,  minGapSeconds: 45  },
  join_group:     { maxPerDay: 3,  maxPerSession: 1,  minGapSeconds: 120 },
  comment:        { maxPerDay: 30, maxPerSession: 8,  minGapSeconds: 10  },
  like:           { maxPerDay: 100,maxPerSession: 25, minGapSeconds: 2   },
  post:           { maxPerDay: 5,  maxPerSession: 2,  minGapSeconds: 60  },
  scan:           { maxPerDay: 15, maxPerSession: 5,  minGapSeconds: 5   },
}

/**
 * Apply age factor — newer accounts get lower quotas automatically
 * @param {number} count - desired count
 * @param {number} nickAgeDays - account age in days
 * @returns {number} adjusted count
 */
function applyAgeFactor(count, nickAgeDays) {
  if (nickAgeDays < 30)  return Math.max(1, Math.floor(count * 0.4))
  if (nickAgeDays < 90)  return Math.max(1, Math.floor(count * 0.65))
  if (nickAgeDays < 180) return Math.max(1, Math.floor(count * 0.85))
  return count
}

/**
 * Check if action is within hard limits
 * @param {string} actionType - action type key
 * @param {number} usedToday - how many already used today
 * @param {number} usedThisSession - how many in current session
 * @returns {{ allowed: boolean, reason?: string, remaining: number }}
 */
function checkHardLimit(actionType, usedToday, usedThisSession = 0) {
  const limit = HARD_LIMITS[actionType]
  if (!limit) return { allowed: true, remaining: Infinity }

  if (usedToday >= limit.maxPerDay) {
    return { allowed: false, reason: `daily_limit_${actionType}`, remaining: 0 }
  }
  if (usedThisSession >= limit.maxPerSession) {
    return { allowed: false, reason: `session_limit_${actionType}`, remaining: 0 }
  }

  return {
    allowed: true,
    remaining: Math.min(limit.maxPerDay - usedToday, limit.maxPerSession - usedThisSession)
  }
}

/**
 * Get minimum gap between actions of this type (ms)
 */
function getMinGapMs(actionType) {
  const limit = HARD_LIMITS[actionType]
  return limit ? limit.minGapSeconds * 1000 : 5000
}

/**
 * SessionTracker — per-job session counter for maxPerSession enforcement
 * Each handler creates one at start, increments after each successful action
 */
class SessionTracker {
  constructor() { this.counts = {} }
  increment(actionType) { this.counts[actionType] = (this.counts[actionType] || 0) + 1 }
  get(actionType) { return this.counts[actionType] || 0 }

  /** Check if next action is within session + daily limits */
  check(actionType, usedToday = 0) {
    return checkHardLimit(actionType, usedToday + this.get(actionType), this.get(actionType))
  }
}

/**
 * Warm-up rules — blocks certain actions for young accounts
 * Returns which actions are allowed based on account age
 */
const WARMUP_PHASES = [
  { maxDays: 7,   label: 'week1',  allowed: ['browse', 'like'],                                          maxActions: 10 },
  { maxDays: 14,  label: 'week2',  allowed: ['browse', 'like', 'comment'],                               maxActions: 20 },
  { maxDays: 21,  label: 'week3',  allowed: ['browse', 'like', 'comment', 'join_group', 'scan'],          maxActions: 30 },
  { maxDays: 30,  label: 'week4',  allowed: ['browse', 'like', 'comment', 'join_group', 'scan', 'send_friend_request'], maxActions: 40 },
]

/**
 * Check if action is allowed for nick's age (warm-up enforcement)
 * @param {string} actionType
 * @param {number} nickAgeDays
 * @returns {{ allowed: boolean, phase?: string, reason?: string }}
 */
function checkWarmup(actionType, nickAgeDays) {
  if (nickAgeDays >= 30) return { allowed: true, phase: 'mature' }

  for (const phase of WARMUP_PHASES) {
    if (nickAgeDays <= phase.maxDays) {
      if (phase.allowed.includes(actionType)) {
        return { allowed: true, phase: phase.label }
      }
      return {
        allowed: false,
        phase: phase.label,
        reason: `warm_up_${phase.label}: ${actionType} blocked until day ${phase.maxDays + 1}`
      }
    }
  }
  return { allowed: true, phase: 'mature' }
}

module.exports = {
  HARD_LIMITS,
  WARMUP_PHASES,
  applyAgeFactor,
  checkHardLimit,
  checkWarmup,
  getMinGapMs,
  SessionTracker,
}
