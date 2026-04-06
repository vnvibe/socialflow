import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Plus, Loader } from 'lucide-react'
import api from '../../lib/api'

const SCAN_INTERVALS = [
  { value: 60, label: 'Mỗi 1 giờ' },
  { value: 120, label: 'Mỗi 2 giờ' },
  { value: 240, label: 'Mỗi 4 giờ' },
  { value: 480, label: 'Mỗi 8 giờ' },
]

export default function AddEditGroupModal({ group, onClose, onSave }) {
  const isEdit = !!group

  const [form, setForm] = useState({
    group_fb_id: '',
    group_name: '',
    brand_keywords: [],
    brand_name: '',
    brand_voice: '',
    opportunity_threshold: 7,
    scan_interval_minutes: 120,
    account_id: '',
    campaign_id: '',
  })
  const [keywordInput, setKeywordInput] = useState('')
  const [saving, setSaving] = useState(false)

  // Load accounts for dropdown
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts-healthy'],
    queryFn: () => api.get('/accounts').then(r => (r.data?.data || r.data || []).filter(a => a.is_active)),
  })

  // Load campaigns for optional dropdown
  const { data: campaigns = [] } = useQuery({
    queryKey: ['campaigns-list'],
    queryFn: () => api.get('/campaigns').then(r => r.data?.data || r.data || []),
  })

  useEffect(() => {
    if (group) {
      setForm({
        group_fb_id: group.group_fb_id || '',
        group_name: group.group_name || '',
        brand_keywords: group.brand_keywords || [],
        brand_name: group.brand_name || '',
        brand_voice: group.brand_voice || '',
        opportunity_threshold: group.opportunity_threshold || 7,
        scan_interval_minutes: group.scan_interval_minutes || 120,
        account_id: group.account_id || '',
        campaign_id: group.campaign_id || '',
      })
    }
  }, [group])

  const addKeyword = () => {
    const kw = keywordInput.trim()
    if (kw && !form.brand_keywords.includes(kw)) {
      setForm(f => ({ ...f, brand_keywords: [...f.brand_keywords, kw] }))
    }
    setKeywordInput('')
  }

  const removeKeyword = (kw) => {
    setForm(f => ({ ...f, brand_keywords: f.brand_keywords.filter(k => k !== kw) }))
  }

  const handleKeywordKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      addKeyword()
    }
  }

  const handleSubmit = async () => {
    if (!form.group_fb_id.trim()) return
    if (!form.account_id) return

    setSaving(true)
    try {
      await onSave(form)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
          <h2 className="text-base font-bold">{isEdit ? 'Sửa nhóm theo dõi' : 'Thêm nhóm theo dõi'}</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {/* Group FB ID */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Group ID</label>
            <input
              type="text"
              value={form.group_fb_id}
              onChange={e => setForm(f => ({ ...f, group_fb_id: e.target.value }))}
              disabled={isEdit}
              placeholder="VD: 1183213533741931"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
            />
          </div>

          {/* Group Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tên nhóm</label>
            <input
              type="text"
              value={form.group_name}
              onChange={e => setForm(f => ({ ...f, group_name: e.target.value }))}
              placeholder="Tên nhóm Facebook"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Account */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tài khoản theo dõi</label>
            <select
              value={form.account_id}
              onChange={e => setForm(f => ({ ...f, account_id: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">-- Chọn tài khoản --</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.username || a.fb_user_id || a.id.slice(0, 8)}</option>
              ))}
            </select>
          </div>

          {/* Campaign (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Chiến dịch (tùy chọn)</label>
            <select
              value={form.campaign_id}
              onChange={e => setForm(f => ({ ...f, campaign_id: e.target.value }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">-- Không gắn chiến dịch --</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.name || c.id.slice(0, 8)}</option>
              ))}
            </select>
          </div>

          {/* Brand Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tên thương hiệu</label>
            <input
              type="text"
              value={form.brand_name}
              onChange={e => setForm(f => ({ ...f, brand_name: e.target.value }))}
              placeholder="VD: SocialFlow"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {/* Brand Keywords (tag input) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Từ khóa thương hiệu</label>
            <div className="flex flex-wrap gap-1.5 mb-2">
              {form.brand_keywords.map(kw => (
                <span key={kw} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                  {kw}
                  <button onClick={() => removeKeyword(kw)} className="hover:text-blue-900">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={keywordInput}
                onChange={e => setKeywordInput(e.target.value)}
                onKeyDown={handleKeywordKeyDown}
                placeholder="Nhập keyword rồi Enter"
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
              <button
                onClick={addKeyword}
                disabled={!keywordInput.trim()}
                className="px-3 py-2 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>

          {/* Brand Voice */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Giọng điệu thương hiệu</label>
            <textarea
              value={form.brand_voice}
              onChange={e => setForm(f => ({ ...f, brand_voice: e.target.value }))}
              rows={2}
              placeholder="VD: thân thiện, tự nhiên, không quảng cáo lộ"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          {/* Opportunity Threshold (slider) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Ngưỡng cơ hội: <span className="text-blue-600 font-bold">{form.opportunity_threshold}/10</span>
            </label>
            <input
              type="range"
              min={1}
              max={10}
              value={form.opportunity_threshold}
              onChange={e => setForm(f => ({ ...f, opportunity_threshold: Number(e.target.value) }))}
              className="w-full accent-blue-600"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-0.5">
              <span>Rộng (1)</span>
              <span>Chặt (10)</span>
            </div>
          </div>

          {/* Scan Interval */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tần suất scan</label>
            <select
              value={form.scan_interval_minutes}
              onChange={e => setForm(f => ({ ...f, scan_interval_minutes: Number(e.target.value) }))}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {SCAN_INTERVALS.map(s => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-gray-100 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium hover:bg-gray-50"
          >
            Hủy
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || !form.group_fb_id.trim() || !form.account_id}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader size={14} className="animate-spin" />}
            {isEdit ? 'Cập nhật' : 'Thêm'}
          </button>
        </div>
      </div>
    </div>
  )
}
