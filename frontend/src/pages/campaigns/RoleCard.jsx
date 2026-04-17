import { useState } from 'react'
import { Search, Heart, UserPlus, Edit, Settings, Trash2, Sparkles, ChevronDown, ChevronUp, Check, AlertTriangle, Clock, Target } from 'lucide-react'

const ROLE_TYPES = [
  { value: 'scout',   label: 'Tham do',   icon: Search,   color: 'text-blue-600 bg-blue-100', desc: 'Tim group, scan thanh vien' },
  { value: 'nurture', label: 'Cham soc',  icon: Heart,    color: 'text-pink-600 bg-pink-100', desc: 'Like, comment trong group' },
  { value: 'connect', label: 'Ket noi',   icon: UserPlus, color: 'text-hermes bg-green-100', desc: 'Ket ban, tuong tac profile' },
  { value: 'post',    label: 'Dang bai',  icon: Edit,     color: 'text-purple-600 bg-purple-100', desc: 'Dang bai vao group/page' },
  { value: 'custom',  label: 'Tuy chinh', icon: Settings, color: 'text-app-muted bg-app-elevated', desc: 'Nhiem vu tuy chinh' },
]

const ACTION_LABELS = {
  join_group: { label: 'Tham gia nhom', icon: '🏠' },
  like_posts: { label: 'Like bai viet', icon: '👍' },
  like: { label: 'Like bai viet', icon: '👍' },
  comment: { label: 'Binh luan', icon: '💬' },
  add_friend: { label: 'Ket ban', icon: '🤝' },
  send_friend_request: { label: 'Gui loi moi ket ban', icon: '🤝' },
  post: { label: 'Dang bai', icon: '📝' },
  scan_members: { label: 'Scan thanh vien', icon: '🔍' },
  browse: { label: 'Luot xem', icon: '👀' },
  reply: { label: 'Tra loi', icon: '↩️' },
  interact_profile: { label: 'Tuong tac profile', icon: '👤' },
}

const BUDGET_LIMITS = {
  like: 80, comment: 25, friend_request: 15, add_friend: 15,
  send_friend_request: 15, join_group: 3, post: 5, scan: 10,
  like_posts: 80, browse: 999,
}

export default function RoleCard({ role, index, accounts = [], otherRoles = [], onUpdate, onDelete, onParse, parsing }) {
  const [expanded, setExpanded] = useState(true)
  const roleType = ROLE_TYPES.find(r => r.value === role.role_type) || ROLE_TYPES[4]
  const Icon = roleType.icon
  const [bgColor, textColor] = roleType.color.split(' ')

  const selectedAccounts = accounts.filter(a => (role.account_ids || []).includes(a.id))
  const hasAccounts = selectedAccounts.length > 0
  const hasMission = (role.mission || '').trim().length > 0
  const hasParsedPlan = role.parsed_plan && Array.isArray(role.parsed_plan) && role.parsed_plan.length > 0

  // Check safety warnings from parsed plan
  const getSafetyWarnings = (steps) => {
    if (!steps) return []
    const warnings = []
    for (const step of steps) {
      const action = step.action || ''
      const count = step.count_max || step.quantity || 0
      const limit = BUDGET_LIMITS[action]
      if (limit && count > limit) {
        const info = ACTION_LABELS[action] || { label: action }
        warnings.push(`${info.label}: ${count} vuot gioi han an toan (${limit}/ngay)`)
      }
    }
    return warnings
  }

  return (
    <div className={`bg-app-surface rounded border border-app-border overflow-hidden transition-colors ${
      !hasAccounts && expanded ? 'border-orange-200' : ''
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-app-base border-b border-app-border">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg ${textColor} flex items-center justify-center`}>
            <Icon size={16} className={bgColor} />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={role.name || ''}
              onChange={e => onUpdate({ ...role, name: e.target.value })}
              placeholder="Ten role..."
              className="font-semibold text-sm text-app-primary bg-transparent border-none outline-none w-32"
            />
            <select
              value={role.role_type || 'custom'}
              onChange={e => onUpdate({ ...role, role_type: e.target.value })}
              className="text-[10px] border border-app-border rounded-lg bg-app-surface text-app-primary px-1.5 py-0.5"
            >
              {ROLE_TYPES.map(rt => (
                <option key={rt.value} value={rt.value}>{rt.label}</option>
              ))}
            </select>
          </div>
          {/* Status indicators */}
          <div className="flex items-center gap-1">
            {hasAccounts && <span className="w-1.5 h-1.5 rounded-full bg-hermes" title="Co tai khoan" />}
            {hasParsedPlan && role.is_confirmed && <Check size={12} className="text-hermes" />}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setExpanded(!expanded)} className="p-1 text-app-muted hover:text-app-primary">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button onClick={() => onDelete(index)} className="p-1 text-app-muted hover:text-red-400">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Account Selection */}
          <div>
            <label className="text-xs font-medium text-app-dim mb-1.5 block">
              Tai khoan thuc hien *
              {!hasAccounts && <span className="text-orange-600 ml-1">(chua chon)</span>}
            </label>
            {accounts.length === 0 ? (
              <p className="text-xs text-app-muted italic">Chua co tai khoan nao. Them tai khoan truoc.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {accounts.map(a => {
                  const isSelected = (role.account_ids || []).includes(a.id)
                  return (
                    <button
                      key={a.id}
                      onClick={() => {
                        const ids = role.account_ids || []
                        const newIds = isSelected ? ids.filter(id => id !== a.id) : [...ids, a.id]
                        onUpdate({ ...role, account_ids: newIds })
                      }}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        isSelected
                          ? 'bg-purple-600 text-white  shadow-purple-900/30'
                          : 'bg-app-elevated text-app-muted border border-app-border hover:bg-app-elevated'
                      }`}
                    >
                      {isSelected && <Check size={10} />}
                      {a.username || a.fb_user_id}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Mission */}
          <div>
            <label className="text-xs font-medium text-app-dim mb-1.5 block">
              Mo ta nhiem vu (viet tu nhien) *
            </label>
            <textarea
              value={role.mission || ''}
              onChange={e => onUpdate({ ...role, mission: e.target.value })}
              placeholder="VD: Vao nhom BDS Ha Noi, like 20 bai moi nhat, comment ngau nhien 5 bai, ket ban 3 nguoi active..."
              rows={3}
              className="w-full border border-app-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 px-3 py-2 text-sm resize-none"
            />
            <p className="text-[10px] text-app-muted mt-1">Viet bang tieng Viet tu nhien. AI se phan tich va tao ke hoach cu the.</p>
          </div>

          {/* AI Parse Button */}
          {hasMission && (
            <div>
              {onParse ? (
                <button
                  onClick={() => onParse(index)}
                  disabled={parsing}
                  className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-purple-700 bg-purple-50  rounded-lg hover:bg-purple-100 disabled:opacity-50 transition-colors"
                >
                  <Sparkles size={14} className={parsing ? 'animate-spin' : ''} />
                  {parsing ? 'AI dang phan tich...' : 'AI phan tich nhiem vu'}
                </button>
              ) : (
                <p className="text-[10px] text-app-muted italic flex items-center gap-1">
                  <Sparkles size={10} /> Luu chien dich truoc de su dung AI phan tich
                </p>
              )}
            </div>
          )}

          {/* Parsed Plan Preview */}
          {hasParsedPlan && (
            <div className="bg-app-base border border-app-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-app-base border-b border-app-border flex items-center justify-between">
                <span className="text-xs font-medium text-app-muted flex items-center gap-1.5">
                  <Target size={12} /> Ke hoach thuc hien
                </span>
                {role.parsed_plan.length > 0 && (
                  <span className="text-[10px] text-app-muted flex items-center gap-1">
                    <Clock size={10} />
                    ~{role.parsed_plan.reduce((sum, s) => sum + (s.duration_max || s.duration_min || 5), 0)} phut
                  </span>
                )}
              </div>
              <div className="p-3 space-y-2">
                {role.parsed_plan.map((step, i) => {
                  const actionInfo = ACTION_LABELS[step.action] || { label: step.action, icon: '▶️' }
                  const countText = step.count_min && step.count_max
                    ? `${step.count_min}-${step.count_max} lan`
                    : step.quantity ? `${step.quantity} lan` : ''

                  return (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="w-6 h-6 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 text-sm">
                          <span>{actionInfo.icon}</span>
                          <span className="font-medium text-app-primary">{actionInfo.label}</span>
                          {step.target && <span className="text-app-muted">— {step.target}</span>}
                        </div>
                        {countText && (
                          <p className="text-[11px] text-app-muted mt-0.5">{countText}</p>
                        )}
                        {step.description && (
                          <p className="text-[11px] text-app-muted mt-0.5">{step.description}</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Safety warnings */}
              {getSafetyWarnings(role.parsed_plan).length > 0 && (
                <div className="px-3 py-2 bg-orange-50 border-t border-orange-100">
                  {getSafetyWarnings(role.parsed_plan).map((w, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-orange-700">
                      <AlertTriangle size={11} />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Confirm button */}
              <div className="px-3 py-2 border-t border-app-border flex justify-end gap-2">
                {role.is_confirmed ? (
                  <span className="flex items-center gap-1 text-xs text-hermes font-medium">
                    <Check size={12} /> Da xac nhan ke hoach
                  </span>
                ) : (
                  <button
                    onClick={() => onUpdate({ ...role, is_confirmed: true })}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-hermes bg-green-50  rounded-lg hover:bg-green-100 transition-colors"
                  >
                    <Check size={12} /> Xac nhan ke hoach nay
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Feeds Into */}
          {otherRoles.length > 0 && (
            <div>
              <label className="text-xs font-medium text-app-dim mb-1 block">Gui du lieu cho</label>
              <select
                value={role.feeds_into || ''}
                onChange={e => onUpdate({ ...role, feeds_into: e.target.value || null })}
                className="w-full border border-app-border rounded-lg bg-app-surface text-app-primary px-3 py-1.5 text-sm"
              >
                <option value="">Khong gui</option>
                {otherRoles.map(r => (
                  <option key={r.id || r._tempId} value={r.id || r._tempId}>{r.name || 'Role chua dat ten'}</option>
                ))}
              </select>
              <p className="text-[10px] text-app-muted mt-1">VD: Role A tim nguoi → gui danh sach cho Role C ket ban</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
