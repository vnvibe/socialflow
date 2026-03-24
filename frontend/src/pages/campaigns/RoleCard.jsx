import { useState } from 'react'
import { Search, Heart, UserPlus, Edit, Settings, Trash2, Sparkles, ChevronDown, ChevronUp } from 'lucide-react'

const ROLE_TYPES = [
  { value: 'scout',   label: 'Tham do',   icon: Search,   desc: 'Tim group, scan members' },
  { value: 'nurture', label: 'Cham soc',  icon: Heart,    desc: 'Like, comment trong group' },
  { value: 'connect', label: 'Ket noi',   icon: UserPlus, desc: 'Ket ban, tuong tac profile' },
  { value: 'post',    label: 'Dang bai',  icon: Edit,     desc: 'Dang bai vao group/page' },
  { value: 'custom',  label: 'Tuy chinh', icon: Settings, desc: 'Handler tuy chinh' },
]

export default function RoleCard({ role, index, accounts = [], otherRoles = [], onUpdate, onDelete, onParse, parsing }) {
  const [expanded, setExpanded] = useState(true)
  const roleType = ROLE_TYPES.find(r => r.value === role.role_type) || ROLE_TYPES[4]
  const Icon = roleType.icon

  const selectedAccounts = accounts.filter(a => (role.account_ids || []).includes(a.id))

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center">
            <Icon size={14} className="text-blue-600" />
          </div>
          <div>
            <input
              type="text"
              value={role.name || ''}
              onChange={e => onUpdate({ ...role, name: e.target.value })}
              placeholder="Ten role..."
              className="font-medium text-sm text-gray-900 bg-transparent border-none outline-none"
            />
            <p className="text-[10px] text-gray-400">{roleType.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setExpanded(!expanded)} className="p-1 text-gray-400 hover:text-gray-600">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button onClick={() => onDelete(index)} className="p-1 text-gray-400 hover:text-red-500">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-3">
          {/* Role Type */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Loai role</label>
            <select
              value={role.role_type || 'custom'}
              onChange={e => onUpdate({ ...role, role_type: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            >
              {ROLE_TYPES.map(rt => (
                <option key={rt.value} value={rt.value}>{rt.label} — {rt.desc}</option>
              ))}
            </select>
          </div>

          {/* Account Selection */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">
              Chon nick ({selectedAccounts.length} da chon)
            </label>
            <div className="flex flex-wrap gap-1.5 mb-2">
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
                    className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                      isSelected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {a.username || a.fb_user_id}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Mission */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Nhiem vu (ngon ngu tu nhien)</label>
            <textarea
              value={role.mission || ''}
              onChange={e => onUpdate({ ...role, mission: e.target.value })}
              placeholder="VD: Tim group ve VPS/hosting, tham gia va scan thanh vien active..."
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
            />
            {onParse && role.mission && (
              <button
                onClick={() => onParse(index)}
                disabled={parsing}
                className="mt-1.5 flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-purple-700 bg-purple-50 rounded-lg hover:bg-purple-100 disabled:opacity-50"
              >
                <Sparkles size={12} /> {parsing ? 'Dang phan tich...' : 'AI Parse Preview'}
              </button>
            )}
          </div>

          {/* Parsed Plan Preview */}
          {role.parsed_plan && (
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Ke hoach AI</label>
              <div className="bg-gray-50 rounded-lg p-3 space-y-1.5">
                {(role.parsed_plan || []).map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-medium">{i + 1}</span>
                    <span className="font-medium text-gray-700">{step.action}</span>
                    <span className="text-gray-400">—</span>
                    <span className="text-gray-500">{step.description || `${step.count_min}-${step.count_max} lan`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Feeds Into */}
          {otherRoles.length > 0 && (
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Gui du lieu cho role</label>
              <select
                value={role.feeds_into || ''}
                onChange={e => onUpdate({ ...role, feeds_into: e.target.value || null })}
                className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">Khong gui</option>
                {otherRoles.map(r => (
                  <option key={r.id || r._tempId} value={r.id || r._tempId}>{r.name || 'Role chua dat ten'}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
