import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Play, Square, Trash2, Calendar, Users, FileText,
  RefreshCw, Search, CheckSquare, XSquare, ChevronDown, ChevronRight,
  Globe, UsersRound, Clock, Sparkles, Loader,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const cronPresets = [
  { label: 'Mỗi ngày 8h sáng', cron: '0 8 * * *' },
  { label: 'Mỗi ngày 12h trưa', cron: '0 12 * * *' },
  { label: 'Mỗi ngày 18h tối', cron: '0 18 * * *' },
  { label: 'Mỗi 2 tiếng', cron: '0 */2 * * *' },
  { label: 'Thứ 2–6, 9h sáng', cron: '0 9 * * 1-5' },
]

const spinOptions = [
  { value: 'none', label: 'Không đổi', desc: 'Đăng nguyên gốc' },
  { value: 'basic', label: 'Cơ bản', desc: 'Xoay từ ngữ {a|b|c}' },
  { value: 'ai', label: 'AI', desc: 'AI viết lại mỗi bài' },
]

export default function CampaignManager() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [targetSearch, setTargetSearch] = useState('')
  const [contentSearch, setContentSearch] = useState('')
  const [expandedAccounts, setExpandedAccounts] = useState({})
  const [targetFilter, setTargetFilter] = useState('all')
  const [suggestingSchedule, setSuggestingSchedule] = useState(false)
  const [showAdvancedCron, setShowAdvancedCron] = useState(false)
  const [form, setForm] = useState({
    name: '',
    target_ids: [],
    content_ids: [],
    schedule_type: 'once',
    start_at: '',
    interval_minutes: 60,
    cron_expression: '',
    delay_between_targets_minutes: 5,
    spin_mode: 'none',
  })

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.get('/campaigns').then(r => r.data),
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get('/groups').then(r => r.data),
  })

  const { data: fanpages = [] } = useQuery({
    queryKey: ['fanpages'],
    queryFn: () => api.get('/fanpages').then(r => r.data),
  })

  const { data: contents = [] } = useQuery({
    queryKey: ['content'],
    queryFn: () => api.get('/content').then(r => r.data),
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data) => api.post('/campaigns', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      setShowForm(false)
      resetForm()
      toast.success('Đã tạo chiến dịch!')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Không thể tạo chiến dịch'),
  })

  const startMutation = useMutation({
    mutationFn: (id) => api.post(`/campaigns/${id}/start`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Chiến dịch đã chạy!') },
    onError: () => toast.error('Không thể chạy chiến dịch'),
  })

  const stopMutation = useMutation({
    mutationFn: (id) => api.post(`/campaigns/${id}/stop`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Đã dừng chiến dịch') },
    onError: () => toast.error('Không thể dừng'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/campaigns/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Đã xoá!') },
    onError: () => toast.error('Không thể xoá'),
  })

  const resetForm = () => setForm({
    name: '', target_ids: [], content_ids: [],
    schedule_type: 'once', start_at: '',
    interval_minutes: 60, cron_expression: '',
    delay_between_targets_minutes: 5, spin_mode: 'none',
  })

  const accountMap = useMemo(() => {
    const map = {}
    for (const a of accounts) map[a.id] = a
    return map
  }, [accounts])

  const targets = useMemo(() => [
    ...groups.map(g => ({
      id: g.id, name: g.name || g.fb_group_id, type: 'group',
      account_id: g.account_id, member_count: g.member_count,
      last_posted: g.last_posted_at, fb_id: g.fb_group_id,
    })),
    ...fanpages.map(p => ({
      id: p.id, name: p.name || p.fb_page_id, type: 'page',
      account_id: p.account_id, fan_count: p.fan_count,
      last_posted: p.last_posted_at, fb_id: p.fb_page_id, category: p.category,
    })),
  ], [groups, fanpages])

  const filteredTargets = useMemo(() => {
    let result = targets
    if (targetFilter !== 'all') result = result.filter(t => t.type === targetFilter)
    if (targetSearch.trim()) {
      const q = targetSearch.toLowerCase()
      result = result.filter(t => t.name.toLowerCase().includes(q))
    }
    return result
  }, [targets, targetFilter, targetSearch])

  const targetsByAccount = useMemo(() => {
    const grouped = {}
    for (const t of filteredTargets) {
      const accId = t.account_id || 'unknown'
      if (!grouped[accId]) grouped[accId] = []
      grouped[accId].push(t)
    }
    return grouped
  }, [filteredTargets])

  const filteredContents = useMemo(() => {
    if (!contentSearch.trim()) return contents
    const q = contentSearch.toLowerCase()
    return contents.filter(c =>
      (c.caption || '').toLowerCase().includes(q) ||
      (c.hashtags || []).some(h => h.toLowerCase().includes(q))
    )
  }, [contents, contentSearch])

  const toggleTarget = (id) => {
    setForm(prev => ({
      ...prev,
      target_ids: prev.target_ids.includes(id)
        ? prev.target_ids.filter(t => t !== id)
        : [...prev.target_ids, id],
    }))
  }

  const toggleContent = (id) => {
    setForm(prev => ({
      ...prev,
      content_ids: prev.content_ids.includes(id)
        ? prev.content_ids.filter(c => c !== id)
        : [...prev.content_ids, id],
    }))
  }

  const selectAllTargets = () => {
    const allIds = filteredTargets.map(t => t.id)
    setForm(prev => ({ ...prev, target_ids: [...new Set([...prev.target_ids, ...allIds])] }))
  }

  const deselectAllTargets = () => {
    const filteredIds = new Set(filteredTargets.map(t => t.id))
    setForm(prev => ({ ...prev, target_ids: prev.target_ids.filter(id => !filteredIds.has(id)) }))
  }

  const selectAllContents = () => {
    const allIds = filteredContents.map(c => c.id)
    setForm(prev => ({ ...prev, content_ids: [...new Set([...prev.content_ids, ...allIds])] }))
  }

  const deselectAllContents = () => {
    const filteredIds = new Set(filteredContents.map(c => c.id))
    setForm(prev => ({ ...prev, content_ids: prev.content_ids.filter(id => !filteredIds.has(id)) }))
  }

  const toggleAccountExpand = (accId) => {
    setExpandedAccounts(prev => ({ ...prev, [accId]: !prev[accId] }))
  }

  const selectAccountTargets = (accId) => {
    const accTargetIds = (targetsByAccount[accId] || []).map(t => t.id)
    const allSelected = accTargetIds.every(id => form.target_ids.includes(id))
    if (allSelected) {
      setForm(prev => ({ ...prev, target_ids: prev.target_ids.filter(id => !accTargetIds.includes(id)) }))
    } else {
      setForm(prev => ({ ...prev, target_ids: [...new Set([...prev.target_ids, ...accTargetIds])] }))
    }
  }

  const handleAISuggestSchedule = async () => {
    if (form.target_ids.length === 0) {
      toast.error('Hãy chọn nơi đăng trước')
      return
    }
    setSuggestingSchedule(true)
    try {
      const res = await api.post('/ai/suggest-schedule', {
        target_type: targetFilter !== 'all' ? targetFilter : 'page',
        count: 5,
      })
      if (res.data?.schedule?.length) {
        const firstSlot = res.data.schedule[0]
        toast.success(`AI gợi ý: ${firstSlot.time} (${firstSlot.reason || 'thời gian tương tác tốt nhất'})`)
        if (form.schedule_type === 'recurring' && firstSlot.cron) {
          setForm(prev => ({ ...prev, cron_expression: firstSlot.cron }))
        }
      }
    } catch {
      toast.error('AI gợi ý lịch thất bại')
    } finally {
      setSuggestingSchedule(false)
    }
  }

  const formatNumber = (n) => {
    if (!n) return '—'
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
    return n.toString()
  }

  const timeAgo = (date) => {
    if (!date) return 'Chưa đăng'
    const diff = Date.now() - new Date(date).getTime()
    const hours = Math.floor(diff / 3600000)
    if (hours < 1) return 'Vừa xong'
    if (hours < 24) return `${hours} giờ trước`
    const days = Math.floor(hours / 24)
    if (days < 30) return `${days} ngày trước`
    return `${Math.floor(days / 30)} tháng trước`
  }

  if (isLoading) return (
    <div className="flex justify-center py-12">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  )

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Chiến dịch</h1>
        <button
          onClick={() => { setShowForm(true); setExpandedAccounts({}) }}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          <Plus size={18} /> Tạo chiến dịch
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Calendar size={48} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500 mb-2">Chưa có chiến dịch nào</p>
          <p className="text-sm text-gray-400 mb-3">Tạo chiến dịch để tự động đăng bài lên nhiều trang/nhóm cùng lúc</p>
          <button
            onClick={() => { setShowForm(true); setExpandedAccounts({}) }}
            className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm"
          >
            <Plus size={16} /> Tạo chiến dịch đầu tiên
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {campaigns.map(campaign => (
            <div key={campaign.id} className="bg-white rounded-xl shadow p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-gray-900 text-lg">{campaign.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      campaign.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {campaign.is_active ? 'Đang chạy' : 'Dừng'}
                    </span>
                  </div>

                  <div className="flex items-center gap-6 mt-3 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <Users size={14} />
                      {(campaign.target_pages?.length || 0) + (campaign.target_groups?.length || 0) + (campaign.target_profiles?.length || 0)} nơi đăng
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText size={14} />
                      {campaign.contents_count ?? campaign.content_ids?.length ?? 0} nội dung
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar size={14} />
                      {campaign.schedule_type === 'once' ? '1 lần'
                        : campaign.schedule_type === 'interval' ? `Mỗi ${campaign.interval_minutes} phút`
                        : campaign.cron_expression || '—'}
                    </span>
                    <span className="flex items-center gap-1">
                      <RefreshCw size={14} />
                      Biến thể: {campaign.spin_mode === 'none' ? 'Không' : campaign.spin_mode === 'basic' ? 'Cơ bản' : campaign.spin_mode === 'ai' ? 'AI' : 'Không'}
                    </span>
                  </div>

                  <div className="flex items-center gap-6 mt-2 text-xs text-gray-400">
                    <span>Chạy lần cuối: {campaign.last_run ? new Date(campaign.last_run).toLocaleString() : 'Chưa chạy'}</span>
                    <span>Lần tới: {campaign.next_run ? new Date(campaign.next_run).toLocaleString() : '—'}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {campaign.is_active ? (
                    <button
                      onClick={() => stopMutation.mutate(campaign.id)}
                      disabled={stopMutation.isPending}
                      className="flex items-center gap-1 bg-red-50 text-red-600 px-3 py-2 rounded-lg hover:bg-red-100 text-sm"
                    >
                      <Square size={14} /> Dừng
                    </button>
                  ) : (
                    <button
                      onClick={() => startMutation.mutate(campaign.id)}
                      disabled={startMutation.isPending}
                      className="flex items-center gap-1 bg-green-50 text-green-600 px-3 py-2 rounded-lg hover:bg-green-100 text-sm"
                    >
                      <Play size={14} /> Chạy
                    </button>
                  )}
                  <button
                    onClick={() => { if (confirm('Bạn có chắc muốn xoá chiến dịch này?')) deleteMutation.mutate(campaign.id) }}
                    className="text-gray-400 hover:text-red-600 p-2"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* New Campaign Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 overflow-y-auto py-4" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-3xl m-4 max-h-[92vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Tạo chiến dịch mới</h2>
            <div className="space-y-5">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tên chiến dịch</label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="VD: Đăng bài buổi sáng, Quảng bá sản phẩm mới..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* ===== TARGET SELECTION ===== */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">
                    Nơi đăng bài <span className="text-blue-600 font-semibold">({form.target_ids.length})</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={selectAllTargets} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                      <CheckSquare size={12} /> Chọn tất cả
                    </button>
                    <button type="button" onClick={deselectAllTargets} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
                      <XSquare size={12} /> Bỏ chọn
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 mb-2">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                    <input
                      type="text"
                      value={targetSearch}
                      onChange={e => setTargetSearch(e.target.value)}
                      placeholder="Tìm trang/nhóm..."
                      className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                  </div>
                  <div className="flex gap-1">
                    {[
                      { key: 'all', label: 'Tất cả' },
                      { key: 'page', label: 'Trang' },
                      { key: 'group', label: 'Nhóm' },
                    ].map(f => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setTargetFilter(f.key)}
                        className={`px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                          targetFilter === f.key
                            ? 'bg-blue-50 border-blue-200 text-blue-700'
                            : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border border-gray-200 rounded-lg max-h-56 overflow-y-auto">
                  {Object.keys(targetsByAccount).length === 0 ? (
                    <div className="text-sm text-gray-400 p-4 text-center">
                      <p>Không tìm thấy trang/nhóm nào.</p>
                      <p className="mt-1">
                        <a href="/pages" className="text-blue-500 hover:underline">Thêm trang</a>
                        {' hoặc '}
                        <a href="/groups" className="text-blue-500 hover:underline">thêm nhóm</a>
                        {' trước.'}
                      </p>
                    </div>
                  ) : (
                    Object.entries(targetsByAccount).map(([accId, accTargets]) => {
                      const account = accountMap[accId]
                      const accountName = account?.name || account?.username || account?.fb_uid || accId.slice(0, 8)
                      const isExpanded = expandedAccounts[accId] !== false
                      const selectedCount = accTargets.filter(t => form.target_ids.includes(t.id)).length
                      const allSelected = selectedCount === accTargets.length

                      return (
                        <div key={accId} className="border-b border-gray-100 last:border-b-0">
                          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 sticky top-0 z-10">
                            <button type="button" onClick={() => toggleAccountExpand(accId)} className="text-gray-400 hover:text-gray-600">
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                            <button
                              type="button"
                              onClick={() => selectAccountTargets(accId)}
                              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                                allSelected ? 'bg-blue-600 border-blue-600' : selectedCount > 0 ? 'bg-blue-200 border-blue-400' : 'border-gray-300'
                              }`}
                            >
                              {allSelected && <span className="text-white text-xs">✓</span>}
                              {!allSelected && selectedCount > 0 && <span className="text-white text-xs">—</span>}
                            </button>
                            <span className="text-xs font-semibold text-gray-600 truncate">{accountName}</span>
                            <span className="text-xs text-gray-400 ml-auto">{selectedCount}/{accTargets.length}</span>
                          </div>

                          {isExpanded && (
                            <div className="px-1 py-1">
                              {accTargets.map(t => (
                                <label
                                  key={t.id}
                                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                                    form.target_ids.includes(t.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={form.target_ids.includes(t.id)}
                                    onChange={() => toggleTarget(t.id)}
                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                  />
                                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                                    t.type === 'page' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'
                                  }`}>
                                    {t.type === 'page' ? <Globe size={14} /> : <UsersRound size={14} />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-gray-800 truncate">{t.name}</p>
                                    <div className="flex items-center gap-3 text-xs text-gray-400">
                                      {t.type === 'page' && t.fan_count && <span>{formatNumber(t.fan_count)} lượt thích</span>}
                                      {t.type === 'page' && t.category && <span className="truncate max-w-[100px]">{t.category}</span>}
                                      {t.type === 'group' && t.member_count && <span>{formatNumber(t.member_count)} thành viên</span>}
                                      {t.last_posted && (
                                        <span className="flex items-center gap-0.5"><Clock size={10} /> {timeAgo(t.last_posted)}</span>
                                      )}
                                    </div>
                                  </div>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full shrink-0 ${
                                    t.type === 'page' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'
                                  }`}>
                                    {t.type === 'page' ? 'Trang' : 'Nhóm'}
                                  </span>
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* ===== CONTENT SELECTION ===== */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">
                    Nội dung bài viết <span className="text-blue-600 font-semibold">({form.content_ids.length})</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={selectAllContents} className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700">
                      <CheckSquare size={12} /> Chọn tất cả
                    </button>
                    <button type="button" onClick={deselectAllContents} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
                      <XSquare size={12} /> Bỏ chọn
                    </button>
                  </div>
                </div>

                <div className="relative mb-2">
                  <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    value={contentSearch}
                    onChange={e => setContentSearch(e.target.value)}
                    placeholder="Tìm nội dung..."
                    className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="border border-gray-200 rounded-lg max-h-44 overflow-y-auto p-1">
                  {filteredContents.length === 0 ? (
                    <div className="text-sm text-gray-400 p-4 text-center">
                      <p>Chưa có nội dung nào.</p>
                      <p className="mt-1"><a href="/content/new" className="text-blue-500 hover:underline">Tạo nội dung mới</a></p>
                    </div>
                  ) : (
                    filteredContents.map(c => (
                      <label
                        key={c.id}
                        className={`flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-colors ${
                          form.content_ids.includes(c.id) ? 'bg-blue-50' : 'hover:bg-gray-50'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={form.content_ids.includes(c.id)}
                          onChange={() => toggleContent(c.id)}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-700 truncate">{c.caption?.slice(0, 80) || 'Chưa có tiêu đề'}</p>
                          <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                            <span className="capitalize">{c.post_type === 'text' ? 'Văn bản' : c.post_type || 'Văn bản'}</span>
                            {c.spin_mode && c.spin_mode !== 'none' && (
                              <span className="text-purple-500">Biến thể: {c.spin_mode}</span>
                            )}
                            {c.hashtags?.length > 0 && (
                              <span className="text-blue-400 truncate max-w-[150px]">
                                {c.hashtags.slice(0, 3).map(h => `#${h}`).join(' ')}
                              </span>
                            )}
                          </div>
                        </div>
                        {c.media && (
                          <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded shrink-0">
                            {c.media.type === 'video' ? 'Video' : 'Ảnh'}
                          </span>
                        )}
                      </label>
                    ))
                  )}
                </div>
              </div>

              {/* ===== SCHEDULE ===== */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">Lịch đăng bài</label>
                  <button
                    type="button"
                    onClick={handleAISuggestSchedule}
                    disabled={suggestingSchedule}
                    className="inline-flex items-center gap-1 text-xs text-purple-600 hover:text-purple-700 disabled:text-purple-400"
                    title="AI gợi ý thời gian đăng bài tốt nhất"
                  >
                    {suggestingSchedule ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                    AI gợi ý
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Kiểu lịch</label>
                      <select
                        value={form.schedule_type}
                        onChange={e => setForm({ ...form, schedule_type: e.target.value })}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="once">Đăng 1 lần</option>
                        <option value="interval">Đăng lặp lại (theo khoảng thời gian)</option>
                        <option value="recurring">Đăng theo lịch cố định</option>
                      </select>
                    </div>
                    {form.schedule_type === 'once' && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Thời gian đăng</label>
                        <input
                          type="datetime-local"
                          value={form.start_at}
                          onChange={e => setForm({ ...form, start_at: e.target.value })}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="text-[10px] text-gray-400 mt-1">Để trống sẽ đăng ngay lập tức</p>
                      </div>
                    )}
                    {form.schedule_type === 'interval' && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Đăng mỗi (phút)</label>
                        <input
                          type="number"
                          value={form.interval_minutes}
                          onChange={e => setForm({ ...form, interval_minutes: parseInt(e.target.value) || 60 })}
                          min={1}
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <p className="text-[10px] text-gray-400 mt-1">VD: 60 = mỗi 1 tiếng, 1440 = mỗi ngày</p>
                      </div>
                    )}
                    {form.schedule_type === 'recurring' && (
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Chọn lịch</label>
                        <div className="flex flex-wrap gap-1 mb-2">
                          {cronPresets.map(preset => (
                            <button
                              key={preset.cron}
                              type="button"
                              onClick={() => setForm(prev => ({ ...prev, cron_expression: preset.cron }))}
                              className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                                form.cron_expression === preset.cron
                                  ? 'bg-blue-100 border-blue-300 text-blue-700'
                                  : 'border-gray-200 hover:bg-gray-50'
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => setShowAdvancedCron(!showAdvancedCron)}
                          className="text-xs text-gray-400 hover:text-gray-600 mb-1"
                        >
                          {showAdvancedCron ? '▾ Ẩn tuỳ chỉnh nâng cao' : '▸ Tuỳ chỉnh nâng cao'}
                        </button>
                        {showAdvancedCron && (
                          <div>
                            <input
                              value={form.cron_expression}
                              onChange={e => setForm({ ...form, cron_expression: e.target.value })}
                              placeholder="0 */2 * * *"
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                            <p className="text-[10px] text-gray-400 mt-1">phút giờ ngày tháng thứ (cú pháp cron)</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Thời gian nghỉ giữa mỗi nơi đăng (phút)</label>
                    <input
                      type="number"
                      value={form.delay_between_targets_minutes}
                      onChange={e => setForm({ ...form, delay_between_targets_minutes: parseInt(e.target.value) || 5 })}
                      min={1}
                      className="w-full max-w-[200px] border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Nghỉ giữa mỗi lần đăng để tránh bị Facebook hạn chế</p>
                  </div>
                </div>
              </div>

              {/* Spin mode */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Chế độ biến thể nội dung</label>
                <p className="text-xs text-gray-400 mb-2">Biến thể giúp mỗi bài đăng khác nhau, tránh bị Facebook đánh dấu spam</p>
                <div className="flex gap-2">
                  {spinOptions.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm({ ...form, spin_mode: opt.value })}
                      className={`flex-1 px-3 py-2 rounded-lg border text-sm text-left transition-colors ${
                        form.spin_mode === opt.value
                          ? 'bg-blue-50 border-blue-300 text-blue-700'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <span className="font-medium">{opt.label}</span>
                      <p className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Inline validation */}
            {(!form.name || form.target_ids.length === 0 || form.content_ids.length === 0) && (
              <div className="text-xs text-amber-600 space-y-1 mt-4">
                {!form.name && <p>* Chưa nhập tên chiến dịch</p>}
                {form.target_ids.length === 0 && <p>* Chưa chọn nơi đăng bài</p>}
                {form.content_ids.length === 0 && <p>* Chưa chọn nội dung</p>}
              </div>
            )}

            <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-200">
              <button
                onClick={() => { setShowForm(false); resetForm() }}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
              >
                Huỷ
              </button>
              <button
                onClick={() => {
                  const target_pages = form.target_ids.filter(id => targets.find(t => t.id === id && t.type === 'page'))
                  const target_groups = form.target_ids.filter(id => targets.find(t => t.id === id && t.type === 'group'))
                  const { target_ids, ...rest } = form
                  createMutation.mutate({ ...rest, target_pages, target_groups, target_profiles: [] })
                }}
                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:bg-blue-400"
                disabled={createMutation.isPending || !form.name || form.target_ids.length === 0 || form.content_ids.length === 0}
              >
                {createMutation.isPending ? 'Đang tạo...' : 'Tạo chiến dịch'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
