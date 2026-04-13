import { useMemo } from 'react'
import { Minus, Plus, AlertTriangle } from 'lucide-react'

// Display config for each action/quota_key
const ACTION_DISPLAY = {
  join_group:         { icon: '🔍', label: 'Thám dò nhóm',     unit: 'nhóm/nick/ngày' },
  scan_members:       { icon: '👥', label: 'Quét thành viên',  unit: 'lần/nick/ngày' },
  browse:             { icon: '👀', label: 'Lướt feed',        unit: 'lần/nick/ngày' },
  like:               { icon: '👍', label: 'Like bài',         unit: 'bài/nick/ngày' },
  comment:            { icon: '💬', label: 'Comment',          unit: 'bài/nick/ngày' },
  send_friend_request:{ icon: '🤝', label: 'Kết bạn',          unit: 'người/nick/ngày' },
  friend_request:     { icon: '🤝', label: 'Kết bạn',          unit: 'người/nick/ngày' },
  post:               { icon: '📝', label: 'Đăng bài',         unit: 'bài/nick/ngày' },
  opportunity_comment:{ icon: '📢', label: 'Quảng cáo tự nhiên', unit: 'lần/nick/ngày' },
}

// Hard limits per nick per day — warning only, doesn't block
const HARD_LIMITS = {
  join_group: 3,
  comment: 15,
  like: 80,
  friend_request: 10,
  post: 3,
  opportunity_comment: 2,
  scan_members: 15,
  browse: 30,
}

/**
 * Build editable plan rows from aiPlan.roles
 * Each row represents a unique quota_key across all roles
 */
export function buildPlanRows(aiPlan, runsPerDay = 2) {
  if (!aiPlan?.roles) return []
  const savedBudget = aiPlan.daily_budget || {} // User's saved daily values
  const seen = new Map()
  for (const role of aiPlan.roles) {
    for (const step of (role.steps || [])) {
      const key = step.quota_key || step.action
      if (seen.has(key)) continue
      const display = ACTION_DISPLAY[key] || ACTION_DISPLAY[step.action]
      if (!display) continue
      const max = step.count_max || step.count_min || 1
      const aiSuggestedDaily = max * runsPerDay
      // Use saved daily_budget if available (preserves user edits),
      // otherwise fall back to computed from count_max * runsPerDay
      const savedDaily = savedBudget[key]
      seen.set(key, {
        key,
        action: step.action,
        ...display,
        ai_suggested: aiSuggestedDaily,
        count: savedDaily != null ? savedDaily : aiSuggestedDaily,
      })
    }
  }
  return Array.from(seen.values())
}

/**
 * Apply edited rows back to aiPlan.roles — updates count_min/count_max in matching steps
 * Returns a new plan object (immutable)
 */
export function applyRowsToPlan(aiPlan, rows, runsPerDay = 2) {
  if (!aiPlan?.roles) return aiPlan
  const byKey = new Map(rows.map(r => [r.key, r]))

  const newRoles = aiPlan.roles.map(role => ({
    ...role,
    steps: (role.steps || []).map(step => {
      const key = step.quota_key || step.action
      const row = byKey.get(key)
      if (!row) return step
      const perRun = Math.max(1, Math.ceil(row.count / runsPerDay))
      return {
        ...step,
        count_min: Math.max(1, Math.min(step.count_min || 1, perRun)),
        count_max: perRun,
      }
    }),
  }))

  // Store daily_budget directly from user's input (NOT from count_max * runsPerDay)
  // This preserves exact values like "4 comments/day" even with 8 runs
  const dailyBudget = {}
  for (const row of rows) {
    dailyBudget[row.key] = row.count
  }

  return { ...aiPlan, roles: newRoles, daily_budget: dailyBudget }
}

/**
 * Editable plan list — user can adjust counts with +/- buttons.
 * Hard limits show as warnings (red text) but don't prevent edits.
 *
 * Props:
 * - rows: array from buildPlanRows()
 * - onChange: (newRows) => void
 * - readonly?: boolean
 */
export default function EditablePlanList({ rows, onChange, readonly = false }) {
  const updateRow = (key, newCount) => {
    if (readonly) return
    const clamped = Math.max(0, Math.floor(newCount))
    onChange(rows.map(r => r.key === key ? { ...r, count: clamped } : r))
  }

  if (!rows?.length) {
    return <div className="px-5 py-4 text-sm text-gray-400 italic">Chưa có kế hoạch</div>
  }

  return (
    <div className="px-5 py-4 space-y-2">
      {rows.map(row => {
        const limit = HARD_LIMITS[row.key]
        const overLimit = limit && row.count > limit
        const aiDiff = row.count !== row.ai_suggested

        return (
          <div
            key={row.key}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
              overLimit ? 'bg-red-50 border border-red-200' : 'bg-gray-50'
            }`}
          >
            <span className="text-lg shrink-0">{row.icon}</span>
            <span className="text-sm font-medium text-gray-900 flex-1">{row.label}</span>

            {/* +/- counter */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                disabled={readonly || row.count <= 0}
                onClick={() => updateRow(row.key, row.count - 1)}
                className="w-7 h-7 rounded bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Minus size={12} />
              </button>
              <input
                type="number"
                min="0"
                value={row.count}
                onChange={e => updateRow(row.key, parseInt(e.target.value || '0', 10))}
                disabled={readonly}
                className={`w-12 text-center text-sm font-bold rounded border ${
                  overLimit
                    ? 'border-red-300 text-red-700'
                    : 'border-gray-200 text-blue-700'
                } focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:bg-gray-50 disabled:text-gray-500`}
              />
              <button
                type="button"
                disabled={readonly}
                onClick={() => updateRow(row.key, row.count + 1)}
                className="w-7 h-7 rounded bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Plus size={12} />
              </button>
            </div>

            <span className="text-[11px] text-gray-500 w-24 shrink-0">{row.unit}</span>

            {overLimit && (
              <span className="flex items-center gap-1 text-[11px] text-red-600 shrink-0" title={`AI đề xuất ${row.ai_suggested}, giới hạn an toàn ${limit}`}>
                <AlertTriangle size={11} /> &gt; {limit}
              </span>
            )}
            {!overLimit && aiDiff && (
              <span className="text-[10px] text-purple-500 shrink-0" title={`AI đề xuất ${row.ai_suggested}`}>
                AI: {row.ai_suggested}
              </span>
            )}
          </div>
        )
      })}
      <p className="text-[10px] text-gray-400 mt-2 italic">
        Cảnh báo đỏ = vượt giới hạn an toàn. Bạn vẫn có thể chỉnh, nhưng nick có thể bị FB hạn chế.
      </p>
    </div>
  )
}
