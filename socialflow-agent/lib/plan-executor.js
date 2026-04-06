/**
 * Plan Executor — extract action parameters from AI-generated parsed_plan
 * Allows campaign handlers to be driven by AI plans instead of hardcoded values
 */

const R = require('./randomizer')

/**
 * Get action parameters from parsed_plan, with fallback to defaults
 * @param {Array} parsedPlan - AI-generated plan array [{action, count_min, count_max, params}]
 * @param {string} actionType - e.g. 'like', 'comment', 'join_group', 'friend_request'
 * @param {object} defaults - fallback values {countMin, countMax, style}
 * @returns {object} {count, countMin, countMax, style, params}
 */
function getActionParams(parsedPlan, actionType, defaults = {}) {
  const fallback = {
    count: R.randInt(defaults.countMin || 1, defaults.countMax || defaults.countMin || 1),
    countMin: defaults.countMin || 1,
    countMax: defaults.countMax || defaults.countMin || 1,
    style: defaults.style || null,
    params: {},
  }

  if (!parsedPlan || !Array.isArray(parsedPlan) || parsedPlan.length === 0) {
    return fallback
  }

  const step = parsedPlan.find(s =>
    s.action === actionType ||
    s.type === actionType ||
    s.action_type === actionType
  )

  if (!step) return fallback

  const countMin = step.count_min ?? step.min ?? defaults.countMin ?? 1
  const countMax = step.count_max ?? step.max ?? defaults.countMax ?? countMin
  const count = countMin === countMax ? countMin : R.randInt(countMin, countMax)

  return {
    count,
    countMin,
    countMax,
    style: step.style ?? step.params?.style ?? defaults.style ?? null,
    params: step.params || {},
  }
}

module.exports = { getActionParams }
