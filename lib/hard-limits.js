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

module.exports = {
  HARD_LIMITS,
  applyAgeFactor,
  checkHardLimit,
  getMinGapMs,
}
