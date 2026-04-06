import { useState, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Settings, Save, Trash2, Clock, Calendar, Megaphone } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../../lib/api'
import { useNavigate } from 'react-router-dom'

const SCHEDULE_PRESETS = [
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

  // Advertising config — stored in first campaign_role's config.advertising
  const firstRole = campaign.campaign_roles?.[0]
  const existingAd = firstRole?.config?.advertising || {}
  const [adEnabled, setAdEnabled] = useState(existingAd.enabled || false)
  const [adBrand, setAdBrand] = useState(existingAd.brand_name || '')
  const [adProduct, setAdProduct] = useState(existingAd.product_name || '')
  const [adDescription, setAdDescription] = useState(existingAd.product_description || '')
  const [adWebsite, setAdWebsite] = useState(existingAd.website || '')
  const [adFrequency, setAdFrequency] = useState(existingAd.ad_frequency ?? 30)
  const [adCta, setAdCta] = useState(existingAd.cta_style || 'experience')

  useEffect(() => {
    setName(campaign.name || '')
    setTopic(campaign.topic || '')
    setRequirement(campaign.requirement || '')
    setCronExpr(campaign.cron_expression || '')
    setNickStagger(campaign.nick_stagger_seconds || 60)
    setRoleStagger(campaign.role_stagger_minutes || 30)
    // Reload ad config
    const ad = campaign.campaign_roles?.[0]?.config?.advertising || {}
    setAdEnabled(ad.enabled || false)
    setAdBrand(ad.brand_name || '')
    setAdProduct(ad.product_name || '')
    setAdDescription(ad.product_description || '')
    setAdWebsite(ad.website || '')
    setAdFrequency(ad.ad_frequency ?? 30)
    setAdCta(ad.cta_style || 'experience')
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
    // Save campaign settings
    updateMut.mutate({
      name, topic, requirement,
      cron_expression: cronExpr,
      nick_stagger_seconds: parseInt(nickStagger),
      role_stagger_minutes: parseInt(roleStagger),
    })

    // Save advertising config to ALL roles
    const adConfig = {
      enabled: adEnabled,
      brand_name: adBrand, product_name: adProduct,
      product_description: adDescription, website: adWebsite,
      ad_frequency: parseInt(adFrequency), cta_style: adCta,
    }
    for (const role of (campaign.campaign_roles || [])) {
      const existingConfig = role.config || {}
      try {
        await api.put(`/campaigns/${campaignId}/roles/${role.id}`, {
          config: { ...existingConfig, advertising: adConfig },
        })
      } catch {}
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
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Thuong hieu</label>
                <input type="text" value={adBrand} onChange={e => setAdBrand(e.target.value)}
                  placeholder="VD: TechVPS" className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">San pham</label>
                <input type="text" value={adProduct} onChange={e => setAdProduct(e.target.value)}
                  placeholder="VD: VPS Cloud Hosting" className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 px-3 py-2 text-sm" />
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Mo ta san pham</label>
              <textarea value={adDescription} onChange={e => setAdDescription(e.target.value)} rows={2}
                placeholder="VD: VPS gia re, toc do cao, ho tro 24/7"
                className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 px-3 py-2 text-sm" />
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Website (chi hien thi, KHONG chen vao comment)</label>
              <input type="text" value={adWebsite} onChange={e => setAdWebsite(e.target.value)}
                placeholder="VD: techvps.com" className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 px-3 py-2 text-sm" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tan suat quang cao ({adFrequency}% comment)</label>
                <input type="range" min="0" max="100" value={adFrequency} onChange={e => setAdFrequency(e.target.value)}
                  className="w-full" />
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>0% (khong QC)</span>
                  <span>50%</span>
                  <span>100% (luon QC)</span>
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Kieu mention</label>
                <select value={adCta} onChange={e => setAdCta(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg bg-white text-gray-700 px-3 py-2 text-sm">
                  <option value="question">Hoi nhe — "Ban da thu X chua?"</option>
                  <option value="suggestion">Goi y — "Minh suggest X"</option>
                  <option value="experience">Kinh nghiem — "Minh dang dung X"</option>
                </select>
              </div>
            </div>

            <p className="text-[11px] text-gray-500">
              AI se tu dong quyet dinh khi nao chen quang cao nhe va khi nao chi tuong tac thuan.
              Chi mention san pham khi bai viet DUNG chu de. Khong bao gio chen link hay so dien thoai.
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
