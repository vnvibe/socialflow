import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings, Save, Trash2, Clock, Calendar, Megaphone, Users, Check } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../../lib/api'
import { useNavigate } from 'react-router-dom'

const SCHEDULE_PRESETS = [
  { label: '24/7', cron: '0 0,3,6,9,12,15,18,21 * * *', desc: '24/7 — moi 3h, khong gioi han gio', is247: true },
  { label: '6h-23h moi ngay', cron: '0 6-23/3 * * *', desc: 'Chay moi 3h tu 6h-23h' },
  { label: '2 lan/ngay', cron: '0 9,18 * * *', desc: '9h sang + 6h chieu' },
  { label: '1 lan/ngay', cron: '0 9 * * *', desc: 'Moi ngay luc 9h' },
  { label: 'Ngay lam viec', cron: '0 9,14 * * 1-5', desc: 'Thu 2-6, 9h + 14h' },
  { label: 'Moi 3h', cron: '0 */3 * * *', desc: '24/7 moi 3h' },
]

const DAY_LABELS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']

export default function SettingsSection({ campaignId, campaign }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [name, setName] = useState(campaign.name || '')
  const [topic, setTopic] = useState(campaign.topic || '')
  const [requirement, setRequirement] = useState(campaign.requirement || '')
  const [cronExpr, setCronExpr] = useState(campaign.cron_expression || '')
  const [nickStagger, setNickStagger] = useState(campaign.nick_stagger_seconds || 60)
  const [roleStagger, setRoleStagger] = useState(campaign.role_stagger_minutes || 30)
  const [selectedAccountIds, setSelectedAccountIds] = useState(campaign.account_ids || [])

  // Fetch all accounts for picker
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data),
  })

  // Brand/advertising — canonical source is campaigns.brand_config (new SaaS shape).
  // Fall back to legacy campaign_roles[0].config.advertising only if brand_config is empty.
  const legacyAd = campaign.campaign_roles?.[0]?.config?.advertising || {}
  const initialBrand = campaign.brand_config || (legacyAd.brand_name ? {
    brand_name: legacyAd.brand_name,
    brand_description: legacyAd.product_description || '',
    example_comment: '',
    brand_voice: 'casual',
  } : null)
  const [adEnabled, setAdEnabled] = useState(!!initialBrand)
  const [brandName, setBrandName] = useState(initialBrand?.brand_name || '')
  const [brandDescription, setBrandDescription] = useState(initialBrand?.brand_description || '')
  const [exampleComment, setExampleComment] = useState(initialBrand?.example_comment || '')
  const [brandVoice, setBrandVoice] = useState(initialBrand?.brand_voice || 'casual')

  useEffect(() => {
    setName(campaign.name || '')
    setTopic(campaign.topic || '')
    setRequirement(campaign.requirement || '')
    setCronExpr(campaign.cron_expression || '')
    setNickStagger(campaign.nick_stagger_seconds || 60)
    setRoleStagger(campaign.role_stagger_minutes || 30)
    setSelectedAccountIds(campaign.account_ids || [])
    // Reload brand_config (canonical) or fall back to legacy shape
    const bc = campaign.brand_config
    const legacy = campaign.campaign_roles?.[0]?.config?.advertising || {}
    if (bc) {
      setAdEnabled(true)
      setBrandName(bc.brand_name || '')
      setBrandDescription(bc.brand_description || '')
      setExampleComment(bc.example_comment || '')
      setBrandVoice(bc.brand_voice || 'casual')
    } else if (legacy.brand_name) {
      setAdEnabled(legacy.enabled || false)
      setBrandName(legacy.brand_name || '')
      setBrandDescription(legacy.product_description || '')
      setExampleComment('')
      setBrandVoice('casual')
    } else {
      setAdEnabled(false)
      setBrandName('')
      setBrandDescription('')
      setExampleComment('')
      setBrandVoice('casual')
    }
  }, [campaign])

  const updateMut = useMutation({
    mutationFn: (data) => api.put(`/campaigns/${campaignId}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] })
      toast.success('Da luu')
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi'),
  })

  const deleteMut = useMutation({
    mutationFn: () => api.delete(`/campaigns/${campaignId}`),
    onSuccess: () => {
      toast.success('Da xoa chien dich')
      navigate('/campaigns')
    },
  })

  const handleSave = async () => {
    // Build brand_config payload (null when ad disabled or brand_name empty)
    const brandPayload = adEnabled && brandName.trim() ? {
      brand_name: brandName.trim(),
      brand_description: brandDescription.trim(),
      example_comment: exampleComment.trim(),
      brand_voice: brandVoice,
    } : null

    // Save campaign settings — brand_config is persisted on the campaign row (new SaaS shape).
    // account_ids cascades to campaign_roles on the server side.
    updateMut.mutate({
      name, topic, requirement,
      cron_expression: cronExpr,
      nick_stagger_seconds: parseInt(nickStagger),
      role_stagger_minutes: parseInt(roleStagger),
      brand_config: brandPayload,
      ad_mode: brandPayload ? 'ad_enabled' : 'normal',
      account_ids: selectedAccountIds,
    })

    // 24/7 mode: push active_hours_start=0, end=24 to all selected nicks.
    // Detect via the matching SCHEDULE_PRESETS entry's is247 flag (cronExpr exact match).
    const matchedPreset = SCHEDULE_PRESETS.find(p => p.cron === cronExpr)
    if (matchedPreset?.is247 && selectedAccountIds.length) {
      await Promise.all(selectedAccountIds.map(aid =>
        api.put(`/accounts/${aid}`, { active_hours_start: 0, active_hours_end: 24 }).catch(() => {})
      ))
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <h2 className="text-lg font-bold text-gray-900">Cai dat chien dich</h2>

      {/* Basic Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-600">Thong tin co ban</h3>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Ten chien dich</label>
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Chu de / Topic</label>
          <input
            type="text" value={topic} onChange={e => setTopic(e.target.value)}
            className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Yeu cau (mission)</label>
          <textarea
            value={requirement} onChange={e => setRequirement(e.target.value)}
            rows={4}
            className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Schedule */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-600 flex items-center gap-2">
          <Clock size={16} /> Lich chay
        </h3>

        <div className="flex flex-wrap gap-2">
          {SCHEDULE_PRESETS.map(p => (
            <button
              key={p.cron}
              onClick={() => setCronExpr(p.cron)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                cronExpr === p.cron
                  ? 'border-purple-200 bg-purple-100 text-purple-700'
                  : 'border-gray-200 text-gray-500 hover:bg-gray-100'
              }`}
              title={p.desc}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div>
          <label className="block text-xs text-gray-500 mb-1">Cron expression</label>
          <input
            type="text" value={cronExpr} onChange={e => setCronExpr(e.target.value)}
            className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 px-3 py-2 text-sm font-mono"
            placeholder="0 9,18 * * *"
          />
        </div>
      </div>

      {/* Stagger Settings */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-600">Cai dat nang cao</h3>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Nick stagger (giay)</label>
            <input
              type="number" value={nickStagger} onChange={e => setNickStagger(e.target.value)}
              className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Role stagger (phut)</label>
            <input
              type="number" value={roleStagger} onChange={e => setRoleStagger(e.target.value)}
              className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </div>

      {/* Accounts picker */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
        <h3 className="text-sm font-semibold text-gray-600 flex items-center gap-2">
          <Users size={16} /> Tài khoản thực hiện
          <span className="text-xs font-normal text-gray-500">({selectedAccountIds.length} đã chọn)</span>
        </h3>
        {accounts.length === 0 ? (
          <p className="text-xs text-gray-500 italic">Chưa có tài khoản nào.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {accounts.map(a => {
                const sel = selectedAccountIds.includes(a.id)
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => {
                      setSelectedAccountIds(sel
                        ? selectedAccountIds.filter(x => x !== a.id)
                        : [...selectedAccountIds, a.id])
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                      sel ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-gray-200'
                    }`}
                  >
                    {sel && <Check size={10} />}
                    {a.username || a.fb_user_id}
                  </button>
                )
              })}
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setSelectedAccountIds(accounts.map(a => a.id))}
                className="text-[10px] text-blue-600 hover:underline">Chọn tất cả</button>
              <button type="button" onClick={() => setSelectedAccountIds([])}
                className="text-[10px] text-gray-500 hover:underline">Bỏ chọn</button>
            </div>
            <p className="text-[10px] text-gray-500 italic">
              Thêm/bớt nick sẽ áp dụng cho tất cả roles của campaign và có hiệu lực ở lần chạy tiếp theo.
            </p>
          </div>
        )}
      </div>

      {/* Soft Advertising */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-600 flex items-center gap-2">
            <Megaphone size={16} /> Quang cao nhe (Soft Ads)
          </h3>
          <button
            onClick={() => setAdEnabled(!adEnabled)}
            className={`relative w-10 h-5 rounded-full transition-colors ${adEnabled ? 'bg-purple-600' : 'bg-gray-200'}`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${adEnabled ? 'left-5' : 'left-0.5'}`} />
          </button>
        </div>

        {adEnabled && (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tên thương hiệu *</label>
              <input type="text" value={brandName} onChange={e => setBrandName(e.target.value)}
                placeholder="VD: OpenClaw"
                className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 px-3 py-2 text-sm" />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Mô tả sản phẩm *</label>
              <textarea value={brandDescription} onChange={e => setBrandDescription(e.target.value)} rows={2}
                placeholder="VD: AI Agent tự động hóa công việc — phù hợp cho người dùng VPS / cần host nhẹ"
                className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 px-3 py-2 text-sm resize-none" />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Comment mẫu (tham khảo tone)</label>
              <textarea value={exampleComment} onChange={e => setExampleComment(e.target.value)} rows={2}
                placeholder='VD: "Mình đang dùng OpenClaw thấy ổn, giá hợp lý lại không lag"'
                className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 px-3 py-2 text-sm resize-none" />
              <p className="text-[10px] text-gray-400 mt-1">AI sẽ tham khảo tone này khi viết comment có mention thương hiệu</p>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-2">Giọng điệu</label>
              <div className="flex gap-2">
                {[
                  { value: 'casual', label: 'Thân thiện' },
                  { value: 'professional', label: 'Chuyên nghiệp' },
                  { value: 'humor', label: 'Hài hước' },
                ].map(v => (
                  <button key={v.value} type="button" onClick={() => setBrandVoice(v.value)}
                    className={`flex-1 px-3 py-2 rounded-lg border text-center text-xs transition-colors ${
                      brandVoice === v.value
                        ? 'bg-orange-50 border-orange-300 text-orange-700 font-medium'
                        : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                    }`}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-gray-500">
              AI tự nhận biết cơ hội dựa trên ngữ cảnh bài viết — không cần keyword. Khi gặp người hỏi/tìm/than phiền về vấn đề thương hiệu giải quyết được, AI sẽ comment tự nhiên.
            </p>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => { if (confirm('Xoa chien dich nay? Khong the khoi phuc!')) deleteMut.mutate() }}
          className="flex items-center gap-1.5 px-4 py-2 text-sm text-red-700 bg-red-50  rounded-lg hover:bg-red-100"
        >
          <Trash2 size={14} /> Xoa chien dich
        </button>
        <button
          onClick={handleSave}
          disabled={updateMut.isPending}
          className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          <Save size={14} /> {updateMut.isPending ? 'Dang luu...' : 'Luu thay doi'}
        </button>
      </div>
    </div>
  )
}
