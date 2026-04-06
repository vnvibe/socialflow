import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Target, Save, ArrowLeft, Clock, Sparkles, Check, AlertTriangle, Loader2, ChevronDown, ChevronUp, Info, Minus, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const randMin = () => Math.floor(Math.random() * 25) + 5
const DEFAULT_PRESETS = [
  { key: 'allday', label: '6h-23h', runs: 5, buildCron: () => `${randMin()} 6,10,14,18,22 * * *`, descFn: () => '6h, 10h, 14h, 18h, 22h (5 lần)' },
  { key: 'twice', label: '2 lần/ngày', runs: 2, defaultHours: [8, 18], buildCron: (h1, h2) => `${randMin()} ${h1},${h2} * * *`, descFn: (h1, h2) => `Lúc ${h1}h và ${h2}h` },
  { key: 'daily', label: '1 lần/ngày', runs: 1, defaultHour: 9, buildCron: (h) => `${randMin()} ${h} * * *`, descFn: (h) => `Mỗi ngày lúc ${h}h` },
  { key: 'weekday', label: 'T2-T6', runs: 1, defaultHour: 8, buildCron: (h) => `${randMin()} ${h} * * 1-5`, descFn: (h) => `T2-T6 lúc ${h}h` },
  { key: 'every3h', label: 'Mỗi 3 tiếng', runs: 6, buildCron: () => `${randMin()} 6,9,12,15,18,21 * * *`, descFn: () => '6h, 9h, 12h, 15h, 18h, 21h (6 lần)' },
]

const AVAILABLE_ACTIONS = [
  { key: 'join_group', label: 'Tìm & tham gia nhóm', icon: '🏠', desc: 'Scout tìm nhóm mới theo topic', defaultCount: 5, max: 999, min: 1 },
  { key: 'like', label: 'Like bài viết', icon: '👍', desc: 'Like bài trong nhóm đã tham gia', defaultCount: 20, max: 999, min: 1 },
  { key: 'comment', label: 'Bình luận bài viết', icon: '💬', desc: 'AI comment tự nhiên, đúng chủ đề', defaultCount: 10, max: 999, min: 1 },
  { key: 'friend_request', label: 'Kết bạn', icon: '🤝', desc: 'AI đánh giá & gửi lời mời kết bạn', defaultCount: 10, max: 999, min: 1 },
  { key: 'post', label: 'Đăng bài', icon: '📝', desc: 'Đăng bài vào nhóm/trang', defaultCount: 2, max: 999, min: 1 },
]

const ACTION_ICONS = {
  join_group: '🏠', like: '👍', comment: '💬', send_friend_request: '🤝',
  friend_request: '🤝', post: '📝', scan_members: '🔍', browse: '👀',
}

const DAY_LABELS = [
  { value: 1, label: 'T2' }, { value: 2, label: 'T3' }, { value: 3, label: 'T4' },
  { value: 4, label: 'T5' }, { value: 5, label: 'T6' }, { value: 6, label: 'T7' },
  { value: 0, label: 'CN' },
]

const ROLE_TYPE_LABELS = {
  scout: { label: 'Thám do', icon: '🔍', color: 'bg-blue-100 text-blue-700' },
  nurture: { label: 'Chăm sóc', icon: '💚', color: 'bg-green-100 text-green-700' },
  connect: { label: 'Kết nối', icon: '🤝', color: 'bg-purple-100 text-purple-700' },
  post: { label: 'Đăng bài', icon: '📝', color: 'bg-orange-100 text-orange-700' },
}

export default function CampaignForm() {
  const { id } = useParams()
  const isEdit = !!id
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [form, setForm] = useState({
    name: '', topic: '', requirement: '',
    schedule_type: 'recurring', cron_expression: `${randMin()} 6,10,14,18,22 * * *`,
  })
  const [selectedAccountIds, setSelectedAccountIds] = useState([])
  const [aiPlan, setAiPlan] = useState(null)
  const [planConfirmed, setPlanConfirmed] = useState(false)

  // Action picker state
  const [selectedActions, setSelectedActions] = useState(() => {
    const initial = {}
    AVAILABLE_ACTIONS.forEach(a => {
      initial[a.key] = { enabled: a.key !== 'post', count: a.defaultCount }
    })
    return initial
  })

  // Schedule state
  const [scheduleMode, setScheduleMode] = useState('allday')
  const [presetHour, setPresetHour] = useState(9)
  const [presetHour2, setPresetHour2] = useState(18)
  const [customHour, setCustomHour] = useState(9)
  const [customMinute, setCustomMinute] = useState(0)
  const [customDays, setCustomDays] = useState([1, 2, 3, 4, 5, 6, 0])
  const [showAdvanced, setShowAdvanced] = useState(false)

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data),
  })

  const { data: existing } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.get(`/campaigns/${id}`).then(r => r.data),
    enabled: isEdit,
  })

  useEffect(() => {
    if (existing) {
      setForm({
        name: existing.name || '', topic: existing.topic || '',
        requirement: existing.requirement || '',
        schedule_type: existing.schedule_type || 'recurring',
        cron_expression: existing.cron_expression || '0 9 * * *',
      })
      setSelectedAccountIds(existing.account_ids || [])
      if (existing.ai_plan) { setAiPlan(existing.ai_plan); setPlanConfirmed(existing.ai_plan_confirmed || false) }
      // Restore action state from existing plan if available
      if (existing.ai_plan?.selected_actions) {
        setSelectedActions(existing.ai_plan.selected_actions)
      }
      // Parse cron
      const cron = existing.cron_expression || '0 9 * * *'
      const parts = cron.split(' ')
      if (parts[1]?.split(',').length >= 4) setScheduleMode('allday')
      else if (parts[4] === '1-5') { setScheduleMode('weekday'); setPresetHour(parseInt(parts[1]) || 8) }
      else if (parts[1]?.includes(',')) { setScheduleMode('twice'); const h = parts[1].split(',').map(Number); setPresetHour(h[0]); setPresetHour2(h[1]) }
      else { setScheduleMode('daily'); setPresetHour(parseInt(parts[1]) || 9) }
    }
  }, [existing])

  const updateCron = (mode, h1, h2, cH, cM, cDays) => {
    const preset = DEFAULT_PRESETS.find(p => p.key === mode)
    let cron
    if (preset?.buildCron) {
      cron = preset.defaultHours ? preset.buildCron(h1 || preset.defaultHours[0], h2 || preset.defaultHours[1])
           : preset.defaultHour ? preset.buildCron(h1 || preset.defaultHour)
           : preset.buildCron()
    } else if (mode === 'custom') {
      cron = `${cM} ${cH} * * ${cDays?.length === 7 ? '*' : (cDays || []).join(',')}`
    } else {
      cron = `${randMin()} 6,10,14,18,22 * * *`
    }
    setForm(f => ({ ...f, schedule_type: 'recurring', cron_expression: cron }))
  }

  const selectMode = (mode) => {
    setScheduleMode(mode)
    const preset = DEFAULT_PRESETS.find(p => p.key === mode)
    if (!preset) { updateCron(mode, null, null, customHour, customMinute, customDays); return }
    if (preset.defaultHours) { setPresetHour(preset.defaultHours[0]); setPresetHour2(preset.defaultHours[1]); updateCron(mode, preset.defaultHours[0], preset.defaultHours[1]) }
    else if (preset.defaultHour) { setPresetHour(preset.defaultHour); updateCron(mode, preset.defaultHour) }
    else updateCron(mode)
  }

  const toggleAction = (key) => {
    setSelectedActions(prev => ({
      ...prev,
      [key]: { ...prev[key], enabled: !prev[key].enabled },
    }))
    setAiPlan(null); setPlanConfirmed(false)
  }

  const setActionCount = (key, count) => {
    const action = AVAILABLE_ACTIONS.find(a => a.key === key)
    const clamped = Math.max(action?.min || 1, Math.min(action?.max || 50, count))
    setSelectedActions(prev => ({
      ...prev,
      [key]: { ...prev[key], count: clamped },
    }))
    setAiPlan(null); setPlanConfirmed(false)
  }

  const getScheduleDesc = () => {
    const preset = DEFAULT_PRESETS.find(p => p.key === scheduleMode)
    if (preset?.descFn) return preset.descFn(presetHour, presetHour2)
    if (scheduleMode === 'custom') {
      const dayStr = customDays.length === 7 ? 'Mỗi ngày' : customDays.map(d => DAY_LABELS.find(l => l.value === d)?.label).join(', ')
      return `${dayStr} lúc ${String(customHour).padStart(2, '0')}:${String(customMinute).padStart(2, '0')}`
    }
    return ''
  }

  const enabledActions = Object.entries(selectedActions).filter(([_, v]) => v.enabled).map(([k, v]) => ({ key: k, count: v.count }))

  // AI Preview
  const previewMut = useMutation({
    mutationFn: () => {
      const preset = DEFAULT_PRESETS.find(p => p.key === scheduleMode)
      // Build requirement from selected actions
      const actionDescs = enabledActions.map(a => {
        const info = AVAILABLE_ACTIONS.find(x => x.key === a.key)
        return `${info?.label || a.key}: ${a.count}/ngày`
      })
      const autoRequirement = actionDescs.join(', ')
      const fullRequirement = form.requirement
        ? `${autoRequirement}. ${form.requirement}`
        : autoRequirement

      return api.post('/campaigns/preview-plan', {
        requirement: fullRequirement,
        topic: form.topic,
        account_ids: selectedAccountIds,
        runs_per_day: preset?.runs || 2,
        selected_actions: enabledActions,
      }).then(r => r.data)
    },
    onSuccess: (data) => { setAiPlan(data.plan); setPlanConfirmed(false) },
    onError: (err) => toast.error(err.response?.data?.error || 'AI không thể tạo kế hoạch'),
  })

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form, account_ids: selectedAccountIds,
        ai_plan: aiPlan ? { ...aiPlan, selected_actions: selectedActions } : null,
        ai_plan_confirmed: planConfirmed,
      }
      if (isEdit) { await api.put(`/campaigns/${id}`, payload); return id }
      else { const res = await api.post('/campaigns', payload); return res.data.id }
    },
    onSuccess: (cid) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      toast.success(isEdit ? 'Đã cập nhật' : 'Đã tạo AI Pilot')
      navigate(`/campaigns/${cid}`)
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Lỗi'),
  })

  const canPreview = form.topic.trim() && selectedAccountIds.length > 0 && enabledActions.length > 0
  const canSubmit = form.name.trim() && canPreview && aiPlan && planConfirmed

  return (
    <div className="max-w-2xl">
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => navigate('/campaigns')} className="p-1.5 text-gray-400 hover:text-gray-600"><ArrowLeft size={20} /></button>
          <Target size={24} className="text-purple-600" />
          <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Sửa AI Pilot' : 'Tạo AI Pilot'}</h1>
        </div>

        <div className="space-y-5">
          {/* 1. Basic Info */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Tên chiến dịch *</label>
              <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="VD: VPS Growth Campaign" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 mb-1 block">Chủ đề / Ngành hàng *</label>
              <input type="text" value={form.topic} onChange={e => { setForm({ ...form, topic: e.target.value }); setAiPlan(null) }}
                placeholder="VD: vps hosting, openclaw" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500" />
            </div>
          </div>

          {/* 2. ACTION PICKER */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <label className="text-xs font-medium text-gray-500 mb-3 block">Chọn hành động AI sẽ thực hiện *</label>
            <div className="space-y-2">
              {AVAILABLE_ACTIONS.map(action => {
                const state = selectedActions[action.key]
                return (
                  <div key={action.key}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all ${
                      state?.enabled
                        ? 'border-blue-300 bg-blue-50/50'
                        : 'border-gray-200 bg-gray-50/50 opacity-60'
                    }`}
                  >
                    {/* Toggle */}
                    <button
                      onClick={() => toggleAction(action.key)}
                      className={`w-5 h-5 rounded flex items-center justify-center shrink-0 transition-colors ${
                        state?.enabled ? 'bg-blue-600 text-white' : 'bg-gray-200'
                      }`}
                    >
                      {state?.enabled && <Check size={12} />}
                    </button>

                    {/* Icon + Label */}
                    <span className="text-lg shrink-0">{action.icon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{action.label}</p>
                      <p className="text-[11px] text-gray-500">{action.desc}</p>
                    </div>

                    {/* Count adjuster */}
                    {state?.enabled && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => setActionCount(action.key, (state?.count || action.defaultCount) - 1)}
                          className="w-6 h-6 rounded bg-gray-200 flex items-center justify-center hover:bg-gray-300"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-8 text-center text-sm font-bold text-blue-700">{state?.count || action.defaultCount}</span>
                        <button
                          onClick={() => setActionCount(action.key, (state?.count || action.defaultCount) + 1)}
                          className="w-6 h-6 rounded bg-gray-200 flex items-center justify-center hover:bg-gray-300"
                        >
                          <Plus size={12} />
                        </button>
                        <span className="text-[10px] text-gray-500 w-10">/ngày</span>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Optional note for AI */}
            <div className="mt-3">
              <label className="text-[11px] text-gray-500 mb-1 block">Ghi chú thêm cho AI (tùy chọn)</label>
              <textarea
                value={form.requirement}
                onChange={e => { setForm({ ...form, requirement: e.target.value }); setAiPlan(null); setPlanConfirmed(false) }}
                placeholder="VD: Tránh nhóm tiếng Anh, ưu tiên nhóm tech Việt Nam..."
                rows={2}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs resize-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>

          {/* 3. Accounts */}
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <label className="text-xs font-medium text-gray-500 mb-2 block">
              Tài khoản thực hiện * <span className="text-gray-500">({selectedAccountIds.length} đã chọn)</span>
            </label>
            {accounts.length === 0 ? (
              <p className="text-xs text-gray-500 italic">Chưa có tài khoản nào.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {accounts.map(a => {
                    const sel = selectedAccountIds.includes(a.id)
                    return (
                      <button key={a.id} onClick={() => {
                          const next = sel ? selectedAccountIds.filter(x => x !== a.id) : [...selectedAccountIds, a.id]
                          setSelectedAccountIds(next); setAiPlan(null); setPlanConfirmed(false)
                        }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          sel ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
                        }`}>
                        {sel && <Check size={10} />}
                        {a.username || a.fb_user_id}
                      </button>
                    )
                  })}
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setSelectedAccountIds(accounts.map(a => a.id)); setAiPlan(null) }}
                    className="text-[10px] text-blue-600 hover:underline">Chọn tất cả</button>
                  <button onClick={() => { setSelectedAccountIds([]); setAiPlan(null) }}
                    className="text-[10px] text-gray-500 hover:underline">Bỏ chọn</button>
                </div>
              </div>
            )}
          </div>

          {/* 4. Schedule */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-gray-400" />
                <h3 className="text-sm font-semibold text-gray-900">Lịch chạy</h3>
              </div>
              <span className="text-[11px] text-gray-500">{getScheduleDesc()}</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              {DEFAULT_PRESETS.map(p => (
                <button key={p.key} onClick={() => selectMode(p.key)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                    scheduleMode === p.key ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}>
                  <div>{p.label}</div>
                </button>
              ))}
              <button onClick={() => selectMode('custom')}
                className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                  scheduleMode === 'custom' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                }`}>Tùy chỉnh</button>
            </div>
            {scheduleMode === 'custom' && (
              <div className="bg-gray-50 rounded-lg p-3 space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-8">Giờ:</span>
                  <select value={customHour} onChange={e => { const h = parseInt(e.target.value); setCustomHour(h); updateCron('custom', null, null, h, customMinute, customDays) }}
                    className="border border-gray-300 rounded px-2 py-1 text-sm">
                    {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}</option>)}
                  </select>
                  <span className="text-gray-500">:</span>
                  <select value={customMinute} onChange={e => { const m = parseInt(e.target.value); setCustomMinute(m); updateCron('custom', null, null, customHour, m, customDays) }}
                    className="border border-gray-300 rounded px-2 py-1 text-sm">
                    {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500 w-8">Ngày:</span>
                  {DAY_LABELS.map(d => (
                    <button key={d.value} onClick={() => {
                      const next = customDays.includes(d.value) ? customDays.filter(x => x !== d.value) : [...customDays, d.value].sort()
                      if (!next.length) return; setCustomDays(next); updateCron('custom', null, null, customHour, customMinute, next)
                    }} className={`w-8 h-8 rounded-full text-xs font-medium transition-colors ${
                      customDays.includes(d.value) ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                    }`}>{d.label}</button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 5. AI Plan button */}
          {!aiPlan && (
            <button onClick={() => previewMut.mutate()} disabled={!canPreview || previewMut.isPending}
              className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all ${
                canPreview ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 shadow-lg shadow-purple-200'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}>
              {previewMut.isPending ? <><Loader2 size={16} className="animate-spin" /> AI đang phân tích...</>
                : <><Sparkles size={16} /> AI tạo kế hoạch</>}
            </button>
          )}

          {/* 6. AI Plan preview */}
          {aiPlan && (
            <div className="bg-white rounded-xl border-2 border-purple-200 overflow-hidden">
              <div className="px-5 py-3 bg-purple-50 border-b border-purple-100 flex items-center justify-between">
                <span className="text-sm font-semibold text-purple-800 flex items-center gap-2">
                  <Sparkles size={14} /> Kế hoạch AI
                </span>
                {aiPlan.estimated_duration_minutes && (
                  <span className="text-xs text-purple-500 flex items-center gap-1">
                    <Clock size={12} /> ~{aiPlan.estimated_duration_minutes} phút/ngày
                  </span>
                )}
              </div>

              {aiPlan.summary && (
                <div className="px-5 py-3 text-sm text-gray-600 border-b border-gray-100">{aiPlan.summary}</div>
              )}

              <div className="px-5 py-3 space-y-4">
                {(aiPlan.roles || []).map((role, ri) => {
                  const rtCfg = ROLE_TYPE_LABELS[role.role_type] || { label: role.role_type, icon: '⚙️', color: 'bg-gray-100 text-gray-700' }
                  return (
                    <div key={ri} className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${rtCfg.color}`}>
                          {rtCfg.icon} {rtCfg.label}
                        </span>
                        <span className="text-sm font-medium text-gray-900">{role.name}</span>
                        {role.account_names && (
                          <span className="text-xs text-gray-500">({role.account_names.join(', ')})</span>
                        )}
                      </div>
                      <div className="pl-8 space-y-1.5">
                        {(role.steps || []).map((step, si) => (
                          <div key={si} className="flex items-start gap-2 text-xs">
                            <span>{ACTION_ICONS[step.action] || '▶️'}</span>
                            <span className="text-gray-700">
                              {step.description || step.action}
                              {step.count_max && <span className="text-gray-400 ml-1">({step.count_min}-{step.count_max}/lần)</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>

              {aiPlan.daily_budget && (
                <div className="px-5 py-2 bg-gray-50 border-t border-gray-100">
                  <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                    {Object.entries(aiPlan.daily_budget).map(([key, val]) => (
                      <span key={key}><span className="font-medium text-gray-500">{key}:</span> {val}/ngày</span>
                    ))}
                  </div>
                </div>
              )}

              {aiPlan.safety_warnings?.length > 0 && (
                <div className="px-5 py-2 bg-orange-50 border-t border-orange-100">
                  {aiPlan.safety_warnings.map((w, i) => (
                    <div key={i} className="flex items-center gap-1.5 text-xs text-orange-600">
                      <AlertTriangle size={11} /> {w}
                    </div>
                  ))}
                </div>
              )}

              <div className="px-5 py-3 border-t border-gray-200 flex items-center justify-between">
                <button onClick={() => { setAiPlan(null); setPlanConfirmed(false) }}
                  className="text-xs text-gray-400 hover:text-gray-600">Tạo lại</button>
                {planConfirmed ? (
                  <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
                    <Check size={14} /> Đã xác nhận
                  </span>
                ) : (
                  <button onClick={() => setPlanConfirmed(true)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 transition-colors">
                    <Check size={14} /> Xác nhận kế hoạch
                  </button>
                )}
              </div>
            </div>
          )}

          {/* 7. Submit */}
          <div className="flex justify-end gap-3 pb-8">
            <button onClick={() => navigate('/campaigns')} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Hủy</button>
            <button onClick={() => saveMut.mutate()} disabled={!canSubmit || saveMut.isPending}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${
                canSubmit ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}>
              <Save size={16} /> {isEdit ? 'Cập nhật' : 'Tạo AI Pilot'}
            </button>
          </div>
        </div>
      </div>
  )
}
