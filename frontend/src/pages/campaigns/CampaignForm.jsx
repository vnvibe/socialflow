import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { Target, Save, ArrowLeft, Clock, Sparkles, Check, AlertTriangle, Loader2, ChevronDown, ChevronUp, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

// Presets với giờ mặc định có thể chỉnh
const DEFAULT_PRESETS = [
  { key: 'daily', label: 'Hằng ngày', defaultHour: 9, buildCron: (h) => `0 ${h} * * *`, descFn: (h) => `Mỗi ngày lúc ${h}:00` },
  { key: 'twice', label: 'Sáng & chiều', defaultHours: [6, 18], buildCron: (h1, h2) => `0 ${h1},${h2} * * *`, descFn: (h1, h2) => `Lúc ${h1}:00 và ${h2}:00` },
  { key: 'weekday', label: 'Ngày làm việc', defaultHour: 8, buildCron: (h) => `0 ${h} * * 1-5`, descFn: (h) => `T2-T6 lúc ${h}:00` },
  { key: 'every4h', label: 'Mỗi 4 tiếng', buildCron: () => '0 */4 * * *', descFn: () => '6h, 10h, 14h, 18h, 22h' },
]

const ACTION_ICONS = {
  join_group: '🏠', like_posts: '👍', like: '👍', comment: '💬',
  add_friend: '🤝', send_friend_request: '🤝', post: '📝',
  scan_members: '🔍', browse: '👀', reply: '↩️', interact_profile: '👤',
}

const DAY_LABELS = [
  { value: 1, label: 'T2' }, { value: 2, label: 'T3' }, { value: 3, label: 'T4' },
  { value: 4, label: 'T5' }, { value: 5, label: 'T6' }, { value: 6, label: 'T7' },
  { value: 0, label: 'CN' },
]

export default function CampaignForm() {
  const { id } = useParams()
  const isEdit = !!id
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [form, setForm] = useState({
    name: '', topic: '', requirement: '',
    schedule_type: 'recurring', cron_expression: '0 9 * * *',
    interval_minutes: 60,
  })
  const [selectedAccountIds, setSelectedAccountIds] = useState([])
  const [aiPlan, setAiPlan] = useState(null)
  const [planConfirmed, setPlanConfirmed] = useState(false)

  // Lịch chạy state
  const [scheduleMode, setScheduleMode] = useState('daily') // daily | twice | weekday | every4h | custom
  const [presetHour, setPresetHour] = useState(9)
  const [presetHour2, setPresetHour2] = useState(18)
  const [customHour, setCustomHour] = useState(9)
  const [customMinute, setCustomMinute] = useState(0)
  const [customDays, setCustomDays] = useState([1, 2, 3, 4, 5, 6, 0])
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Load accounts
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data),
  })

  // Load existing campaign for edit
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
        interval_minutes: existing.interval_minutes || 60,
      })
      setSelectedAccountIds(existing.account_ids || [])
      if (existing.ai_plan) { setAiPlan(existing.ai_plan); setPlanConfirmed(existing.ai_plan_confirmed || false) }
      // Parse cron để detect mode
      const cron = existing.cron_expression || '0 9 * * *'
      const parts = cron.split(' ')
      if (cron.includes('*/4')) {
        setScheduleMode('every4h')
      } else if (parts[4] === '1-5') {
        setScheduleMode('weekday')
        setPresetHour(parseInt(parts[1]) || 8)
      } else if (parts[1]?.includes(',')) {
        setScheduleMode('twice')
        const hours = parts[1].split(',').map(Number)
        setPresetHour(hours[0] || 6)
        setPresetHour2(hours[1] || 18)
      } else if (parts[4] === '*') {
        setScheduleMode('daily')
        setPresetHour(parseInt(parts[1]) || 9)
      } else {
        setScheduleMode('custom')
        setCustomMinute(parseInt(parts[0]) || 0)
        setCustomHour(parseInt(parts[1]) || 9)
      }
    }
  }, [existing])

  // Cập nhật cron khi thay đổi preset/hour
  const updateCron = (mode, h1, h2, cH, cM, cDays) => {
    let cron = '0 9 * * *'
    if (mode === 'daily') cron = `0 ${h1} * * *`
    else if (mode === 'twice') cron = `0 ${h1},${h2} * * *`
    else if (mode === 'weekday') cron = `0 ${h1} * * 1-5`
    else if (mode === 'every4h') cron = '0 */4 * * *'
    else if (mode === 'custom') cron = `${cM} ${cH} * * ${cDays.length === 7 ? '*' : cDays.join(',')}`
    setForm(f => ({ ...f, schedule_type: 'recurring', cron_expression: cron }))
  }

  const selectMode = (mode) => {
    setScheduleMode(mode)
    if (mode === 'daily') { setPresetHour(9); updateCron(mode, 9) }
    else if (mode === 'twice') { setPresetHour(6); setPresetHour2(18); updateCron(mode, 6, 18) }
    else if (mode === 'weekday') { setPresetHour(8); updateCron(mode, 8) }
    else if (mode === 'every4h') { updateCron(mode) }
    else if (mode === 'custom') { updateCron(mode, null, null, customHour, customMinute, customDays) }
  }

  const handleDayToggle = (day) => {
    const next = customDays.includes(day) ? customDays.filter(d => d !== day) : [...customDays, day].sort()
    if (!next.length) return
    setCustomDays(next)
    updateCron('custom', null, null, customHour, customMinute, next)
  }

  // Mô tả lịch chạy hiện tại
  const getScheduleDesc = () => {
    if (scheduleMode === 'daily') return `Mỗi ngày lúc ${presetHour}:00`
    if (scheduleMode === 'twice') return `Lúc ${presetHour}:00 và ${presetHour2}:00`
    if (scheduleMode === 'weekday') return `T2-T6 lúc ${presetHour}:00`
    if (scheduleMode === 'every4h') return '6:00, 10:00, 14:00, 18:00, 22:00'
    if (scheduleMode === 'custom') {
      const dayStr = customDays.length === 7 ? 'Mỗi ngày' : customDays.map(d => DAY_LABELS.find(l => l.value === d)?.label).join(', ')
      return `${dayStr} lúc ${String(customHour).padStart(2, '0')}:${String(customMinute).padStart(2, '0')}`
    }
    return ''
  }

  // AI Preview Plan
  const previewMut = useMutation({
    mutationFn: () => api.post('/campaigns/preview-plan', {
      requirement: form.requirement, topic: form.topic, account_ids: selectedAccountIds,
    }).then(r => r.data),
    onSuccess: (data) => { setAiPlan(data.plan); setPlanConfirmed(false) },
    onError: (err) => toast.error(err.response?.data?.error || 'AI không thể tạo kế hoạch'),
  })

  // Create/Update campaign
  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form, account_ids: selectedAccountIds,
        ai_plan: aiPlan, ai_plan_confirmed: planConfirmed,
      }
      if (isEdit) {
        await api.put(`/campaigns/${id}`, payload)
        return id
      } else {
        const res = await api.post('/campaigns', payload)
        return res.data.id
      }
    },
    onSuccess: (cid) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      toast.success(isEdit ? 'Đã cập nhật' : 'Đã tạo AI Pilot')
      navigate(`/campaigns/${cid}`)
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Lỗi'),
  })

  const canPreview = form.requirement.trim() && form.topic.trim() && selectedAccountIds.length > 0
  const canSubmit = form.name.trim() && canPreview && aiPlan && planConfirmed

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/campaigns')} className="p-1.5 text-gray-400 hover:text-gray-600">
          <ArrowLeft size={20} />
        </button>
        <Target size={24} className="text-purple-600" />
        <h1 className="text-2xl font-bold text-gray-900">{isEdit ? 'Sửa AI Pilot' : 'Tạo AI Pilot'}</h1>
      </div>

      <div className="space-y-5">
        {/* 1. Thông tin cơ bản */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Tên chiến dịch *</label>
            <input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
              placeholder="VD: VPS Growth Campaign" className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-500 mb-1 block">Chủ đề / Ngành hàng *</label>
            <input type="text" value={form.topic} onChange={e => setForm({ ...form, topic: e.target.value })}
              placeholder="VD: mỹ phẩm, bất động sản, công nghệ, ẩm thực..." className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" />
            <p className="text-[11px] text-gray-400 mt-1">AI sẽ dùng thông tin này để tạo nội dung phù hợp với lĩnh vực của bạn</p>
          </div>
        </div>

        {/* 2. Yêu cầu */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <label className="text-xs font-medium text-gray-500 mb-1 block">Yêu cầu của bạn *</label>
          <textarea
            value={form.requirement}
            onChange={e => { setForm({ ...form, requirement: e.target.value }); setAiPlan(null); setPlanConfirmed(false) }}
            placeholder="VD: Tìm các nhóm Facebook về VPS và hosting, tham gia và tương tác tự nhiên. Mỗi ngày like 15-20 bài, comment ngắn 5 bài, kết bạn 3-5 người active. Tránh spam, hành động phải tự nhiên như người thật."
            rows={4}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm resize-none focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
          />
          <p className="text-[11px] text-gray-400 mt-1">Viết bằng tiếng Việt tự nhiên. AI sẽ phân tích và tự phân công cho từng tài khoản.</p>
        </div>

        {/* 3. Tài khoản thực hiện */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <label className="text-xs font-medium text-gray-500 mb-2 block">
            Tài khoản thực hiện * <span className="text-gray-400">({selectedAccountIds.length} đã chọn)</span>
          </label>
          {accounts.length === 0 ? (
            <p className="text-xs text-gray-400 italic">Chưa có tài khoản nào. Thêm tài khoản trong trang Tài khoản.</p>
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
                      {a.status !== 'healthy' && <span className="text-[10px] opacity-60">({a.status})</span>}
                    </button>
                  )
                })}
              </div>
              <div className="flex gap-2">
                <button onClick={() => { setSelectedAccountIds(accounts.map(a => a.id)); setAiPlan(null) }}
                  className="text-[10px] text-blue-600 hover:underline">Chọn tất cả</button>
                <button onClick={() => { setSelectedAccountIds([]); setAiPlan(null) }}
                  className="text-[10px] text-gray-400 hover:underline">Bỏ chọn</button>
              </div>
            </div>
          )}
        </div>

        {/* 4. Lịch chạy — NẰM TRƯỚC button AI (UI-011 fix) */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock size={16} className="text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-900">Lịch chạy</h3>
            </div>
            <span className="text-[11px] text-gray-400">{getScheduleDesc()}</span>
          </div>

          <div className="flex gap-2 flex-wrap">
            {/* Hằng ngày — cho đổi giờ (UI-010 fix) */}
            <button onClick={() => selectMode('daily')}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                scheduleMode === 'daily' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              <div className="flex items-center gap-1">
                Hằng ngày
                {scheduleMode === 'daily' && (
                  <select value={presetHour} onClick={e => e.stopPropagation()}
                    onChange={e => { const h = parseInt(e.target.value); setPresetHour(h); updateCron('daily', h) }}
                    className="bg-transparent text-blue-700 font-bold border-0 p-0 text-xs w-10 cursor-pointer focus:ring-0">
                    {Array.from({ length: 17 }, (_, i) => i + 6).map(h => <option key={h} value={h}>{h}h</option>)}
                  </select>
                )}
                {scheduleMode !== 'daily' && <span>9h</span>}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">{scheduleMode === 'daily' ? `Lúc ${presetHour}:00` : 'Mỗi ngày lúc 9:00'}</div>
            </button>

            {/* Sáng & chiều — cho đổi 2 giờ */}
            <button onClick={() => selectMode('twice')}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                scheduleMode === 'twice' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              <div className="flex items-center gap-1">
                {scheduleMode === 'twice' ? (
                  <>
                    <select value={presetHour} onClick={e => e.stopPropagation()}
                      onChange={e => { const h = parseInt(e.target.value); setPresetHour(h); updateCron('twice', h, presetHour2) }}
                      className="bg-transparent text-blue-700 font-bold border-0 p-0 text-xs w-10 cursor-pointer focus:ring-0">
                      {Array.from({ length: 12 }, (_, i) => i + 5).map(h => <option key={h} value={h}>{h}h</option>)}
                    </select>
                    <span>&</span>
                    <select value={presetHour2} onClick={e => e.stopPropagation()}
                      onChange={e => { const h = parseInt(e.target.value); setPresetHour2(h); updateCron('twice', presetHour, h) }}
                      className="bg-transparent text-blue-700 font-bold border-0 p-0 text-xs w-10 cursor-pointer focus:ring-0">
                      {Array.from({ length: 12 }, (_, i) => i + 12).map(h => <option key={h} value={h}>{h}h</option>)}
                    </select>
                  </>
                ) : '6h & 18h'}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">{scheduleMode === 'twice' ? `Lúc ${presetHour}:00 và ${presetHour2}:00` : 'Sáng & chiều'}</div>
            </button>

            {/* Ngày làm việc — cho đổi giờ */}
            <button onClick={() => selectMode('weekday')}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                scheduleMode === 'weekday' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              <div className="flex items-center gap-1">
                Ngày làm việc
                {scheduleMode === 'weekday' && (
                  <select value={presetHour} onClick={e => e.stopPropagation()}
                    onChange={e => { const h = parseInt(e.target.value); setPresetHour(h); updateCron('weekday', h) }}
                    className="bg-transparent text-blue-700 font-bold border-0 p-0 text-xs w-10 cursor-pointer focus:ring-0">
                    {Array.from({ length: 17 }, (_, i) => i + 6).map(h => <option key={h} value={h}>{h}h</option>)}
                  </select>
                )}
                {scheduleMode !== 'weekday' && <span>8h</span>}
              </div>
              <div className="text-[10px] text-gray-400 mt-0.5">{scheduleMode === 'weekday' ? `T2-T6 lúc ${presetHour}:00` : 'T2-T6 lúc 8:00'}</div>
            </button>

            {/* Mỗi 4 tiếng — hiện giờ cụ thể (UI-012 fix) */}
            <button onClick={() => selectMode('every4h')}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                scheduleMode === 'every4h' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              <div>Mỗi 4 tiếng</div>
              <div className="text-[10px] text-gray-400 mt-0.5">6h, 10h, 14h, 18h, 22h</div>
            </button>

            {/* Tùy chỉnh */}
            <button onClick={() => selectMode('custom')}
              className={`px-3 py-2 rounded-lg text-xs font-medium border transition-colors ${
                scheduleMode === 'custom' ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
              }`}>
              <div>Tùy chỉnh</div>
              <div className="text-[10px] text-gray-400 mt-0.5">Chọn giờ & ngày</div>
            </button>
          </div>

          {/* Custom schedule picker */}
          {scheduleMode === 'custom' && (
            <div className="bg-gray-50 rounded-lg p-3 space-y-3">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500 w-8">Giờ:</span>
                <select value={customHour} onChange={e => { const h = parseInt(e.target.value); setCustomHour(h); updateCron('custom', null, null, h, customMinute, customDays) }}
                  className="border border-gray-300 rounded px-2 py-1 text-sm">
                  {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}</option>)}
                </select>
                <span className="text-gray-400">:</span>
                <select value={customMinute} onChange={e => { const m = parseInt(e.target.value); setCustomMinute(m); updateCron('custom', null, null, customHour, m, customDays) }}
                  className="border border-gray-300 rounded px-2 py-1 text-sm">
                  {[0, 15, 30, 45].map(m => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-8">Ngày:</span>
                {DAY_LABELS.map(d => (
                  <button key={d.value} onClick={() => handleDayToggle(d.value)}
                    className={`w-8 h-8 rounded-full text-xs font-medium ${
                      customDays.includes(d.value) ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                    }`}>{d.label}</button>
                ))}
              </div>
            </div>
          )}

          {/* Cài đặt nâng cao */}
          <button onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-[11px] text-gray-400 hover:text-gray-600">
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Cài đặt nâng cao
          </button>
          {showAdvanced && (
            <div className="text-[11px] text-gray-400 bg-gray-50 rounded-lg p-3 flex items-center gap-1.5">
              <Info size={12} />
              AI sẽ tự động tính toán thời gian nghỉ giữa các tài khoản và nhóm nhiệm vụ dựa trên tuổi nick và trạng thái hiện tại.
            </div>
          )}
        </div>

        {/* 5. AI tạo kế hoạch — NẰM SAU lịch chạy (UI-011 fix) */}
        {!aiPlan && (
          <button
            onClick={() => previewMut.mutate()}
            disabled={!canPreview || previewMut.isPending}
            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all ${
              canPreview
                ? 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-700 hover:to-blue-700 shadow-lg shadow-purple-200'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}>
            {previewMut.isPending ? (
              <><Loader2 size={16} className="animate-spin" /> AI đang phân tích...</>
            ) : (
              <><Sparkles size={16} /> AI tạo kế hoạch</>
            )}
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
              {(aiPlan.roles || []).map((role, ri) => (
                <div key={ri} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold">
                      {String.fromCharCode(65 + ri)}
                    </span>
                    <span className="text-sm font-medium text-gray-800">{role.name || `Tài khoản ${ri + 1}`}</span>
                    {role.account_name && <span className="text-xs text-gray-400">({role.account_name})</span>}
                  </div>
                  <div className="pl-8 space-y-1.5">
                    {(role.steps || []).map((step, si) => (
                      <div key={si} className="flex items-start gap-2 text-xs">
                        <span>{ACTION_ICONS[step.action] || '▶️'}</span>
                        <span className="text-gray-700">
                          {step.description || step.action}
                          {step.quantity && <span className="text-gray-400 ml-1">({step.quantity} lần)</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {aiPlan.daily_budget && (
              <div className="px-5 py-2 bg-gray-50 border-t border-gray-100">
                <div className="flex flex-wrap gap-3 text-xs text-gray-500">
                  {Object.entries(aiPlan.daily_budget).map(([key, val]) => (
                    <span key={key} className="flex items-center gap-1">
                      <span className="font-medium">{key}:</span> {val}/ngày
                    </span>
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
                className="text-xs text-gray-400 hover:text-gray-600">
                Tạo lại kế hoạch
              </button>
              {planConfirmed ? (
                <span className="flex items-center gap-1.5 text-sm text-green-600 font-medium">
                  <Check size={14} /> Đã xác nhận
                </span>
              ) : (
                <button onClick={() => setPlanConfirmed(true)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">
                  <Check size={14} /> Xác nhận kế hoạch này
                </button>
              )}
            </div>
          </div>
        )}

        {/* 7. Submit */}
        <div className="flex justify-end gap-3 pb-8">
          <button onClick={() => navigate('/campaigns')} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Hủy</button>
          <button
            onClick={() => saveMut.mutate()}
            disabled={!canSubmit || saveMut.isPending}
            className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              canSubmit
                ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-200'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
            title={!canSubmit ? 'Cần: tên + chủ đề + yêu cầu + tài khoản + xác nhận kế hoạch AI' : ''}>
            <Save size={16} /> {isEdit ? 'Cập nhật' : 'Tạo AI Pilot'}
          </button>
        </div>
      </div>
    </div>
  )
}
