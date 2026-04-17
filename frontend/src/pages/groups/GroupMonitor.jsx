import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Radar, Plus, Trash2, Search, Eye, RefreshCw, Loader,
  ToggleLeft, ToggleRight, Pencil, Play, ArrowLeft,
  BarChart3, Target, Clock, ExternalLink,
} from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import api from '../../lib/api'
import AddEditGroupModal from '../../components/group-monitor/AddEditGroupModal'

const TABS = [
  { key: 'groups', label: 'Nhóm theo dõi', icon: Radar },
  { key: 'performance', label: 'Hiệu suất', icon: BarChart3 },
]

const OPP_STATUS = {
  pending:  { label: 'Chờ xử lý', color: 'bg-yellow-100 text-yellow-700' },
  acting:   { label: 'Đang xử lý', color: 'bg-blue-100 text-info' },
  acted:    { label: 'Đã tương tác', color: 'bg-green-100 text-hermes' },
  skipped:  { label: 'Bỏ qua', color: 'bg-app-elevated text-app-muted' },
  expired:  { label: 'Hết hạn', color: 'bg-red-100 text-red-600' },
  failed:   { label: 'Lỗi', color: 'bg-red-100 text-red-600' },
}

function scoreColor(score) {
  if (score >= 8) return 'bg-green-100 text-hermes'
  if (score >= 6) return 'bg-yellow-100 text-yellow-700'
  return 'bg-app-elevated text-app-muted'
}

function relTime(date) {
  if (!date) return '—'
  try { return formatDistanceToNow(new Date(date), { locale: vi, addSuffix: true }) }
  catch { return '—' }
}

export default function GroupMonitor() {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('groups')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editGroup, setEditGroup] = useState(null)
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [oppStatusFilter, setOppStatusFilter] = useState('')

  // ─── Queries ───
  const { data: groupsRes, isLoading: loadingGroups } = useQuery({
    queryKey: ['watched-groups'],
    queryFn: () => api.get('/monitor/watched-groups').then(r => r.data),
  })
  const groups = groupsRes?.data || groupsRes || []

  const { data: perfData = [], isLoading: loadingPerf } = useQuery({
    queryKey: ['group-performance'],
    queryFn: () => api.get('/monitor/group-performance').then(r => r.data),
    enabled: tab === 'performance',
  })

  const { data: oppsRes, isLoading: loadingOpps } = useQuery({
    queryKey: ['group-opportunities', selectedGroup?.id, oppStatusFilter],
    queryFn: () => {
      const params = new URLSearchParams()
      if (oppStatusFilter) params.set('status', oppStatusFilter)
      return api.get(`/monitor/watched-groups/${selectedGroup.id}/opportunities?${params}`).then(r => r.data)
    },
    enabled: !!selectedGroup,
  })
  const opportunities = oppsRes?.data || oppsRes || []

  // ─── Mutations ───
  const createMut = useMutation({
    mutationFn: (data) => api.post('/monitor/watched-groups', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watched-groups'] })
      setShowModal(false)
      toast.success('Đã thêm nhóm theo dõi')
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Lỗi tạo nhóm'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/monitor/watched-groups/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watched-groups'] })
      setEditGroup(null)
      toast.success('Đã cập nhật')
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Lỗi cập nhật'),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/monitor/watched-groups/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['watched-groups'] })
      toast.success('Đã xóa')
    },
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }) => api.put(`/monitor/watched-groups/${id}`, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watched-groups'] }),
  })

  const scanNowMut = useMutation({
    mutationFn: (id) => api.post(`/monitor/watched-groups/${id}/scan-now`),
    onSuccess: (res) => toast.success(res.data?.message || 'Scan queued'),
    onError: (err) => toast.error(err.response?.data?.error || 'Lỗi scan'),
  })

  // ─── Filter ───
  const filteredGroups = useMemo(() => {
    if (!search) return groups
    const s = search.toLowerCase()
    return groups.filter(g =>
      (g.group_name || '').toLowerCase().includes(s) ||
      (g.brand_name || '').toLowerCase().includes(s) ||
      (g.brand_keywords || []).some(k => k.toLowerCase().includes(s))
    )
  }, [groups, search])

  // ─── Handlers ───
  const handleSave = async (form) => {
    if (editGroup) {
      await updateMut.mutateAsync({ id: editGroup.id, ...form })
    } else {
      await createMut.mutateAsync(form)
    }
  }

  const handleDelete = (g) => {
    if (!confirm(`Xóa nhóm "${g.group_name}" khỏi danh sách theo dõi?`)) return
    deleteMut.mutate(g.id)
  }

  // ─── Render ───
  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Radar size={24} className="text-info" />
          <h1 className="text-xl font-bold text-app-primary">Theo dõi nhóm</h1>
          <span className="text-sm text-app-muted">{groups.length} nhóm</span>
        </div>
        <button
          onClick={() => { setEditGroup(null); setShowModal(true) }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-info text-white text-sm font-medium hover:opacity-90"
        >
          <Plus size={16} />
          Thêm nhóm
        </button>
      </div>

      {/* Tabs */}
      {!selectedGroup && (
        <div className="flex gap-1 mb-4 bg-app-elevated rounded-lg p-1 w-fit">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                tab === t.key ? 'bg-app-surface text-app-primary ' : 'text-app-muted hover:text-app-primary'
              }`}
            >
              <t.icon size={14} />
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Opportunities detail view */}
      {selectedGroup && (
        <OpportunitiesPanel
          group={selectedGroup}
          opportunities={opportunities}
          loading={loadingOpps}
          statusFilter={oppStatusFilter}
          onStatusFilter={setOppStatusFilter}
          onBack={() => setSelectedGroup(null)}
        />
      )}

      {/* Tab: Groups */}
      {!selectedGroup && tab === 'groups' && (
        <>
          {/* Search */}
          <div className="relative mb-4 max-w-sm">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-app-dim" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm nhóm, keyword..."
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-app-border text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          {loadingGroups ? (
            <div className="flex items-center justify-center py-20">
              <Loader size={24} className="animate-spin text-info" />
            </div>
          ) : filteredGroups.length === 0 ? (
            <div className="text-center py-20 text-app-dim">
              <Radar size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Chưa có nhóm nào được theo dõi</p>
              <button
                onClick={() => setShowModal(true)}
                className="mt-3 text-sm text-info hover:underline"
              >
                + Thêm nhóm đầu tiên
              </button>
            </div>
          ) : (
            <div className="bg-app-surface rounded shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-app-base">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-app-muted uppercase">Nhóm</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-app-muted uppercase">Tài khoản</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-app-muted uppercase">Keywords</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-app-muted uppercase">Ngưỡng</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-app-muted uppercase">Scan gần nhất</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-app-muted uppercase">Active</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-app-muted uppercase">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filteredGroups.map(g => (
                    <tr key={g.id} className="hover:bg-app-base">
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setSelectedGroup(g)}
                          className="text-sm font-medium text-app-primary hover:text-info text-left"
                        >
                          {g.group_name || g.group_fb_id}
                        </button>
                        {g.brand_name && (
                          <p className="text-xs text-app-dim mt-0.5">{g.brand_name}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-app-muted">
                        {g.accounts?.username || g.accounts?.fb_user_id?.slice(0, 10) || '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {(g.brand_keywords || []).slice(0, 3).map(kw => (
                            <span key={kw} className="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-info">
                              {kw}
                            </span>
                          ))}
                          {(g.brand_keywords || []).length > 3 && (
                            <span className="text-xs text-app-dim">+{g.brand_keywords.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${scoreColor(g.opportunity_threshold)}`}>
                          {g.opportunity_threshold}/10
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-app-muted">
                        <div className="flex items-center gap-1">
                          <Clock size={12} />
                          {relTime(g.last_scanned_at)}
                        </div>
                        <span className="text-app-dim">{g.total_scans || 0} lần scan</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => toggleMut.mutate({ id: g.id, is_active: !g.is_active })}>
                          {g.is_active
                            ? <ToggleRight size={20} className="text-hermes" />
                            : <ToggleLeft size={20} className="text-app-dim" />
                          }
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => setSelectedGroup(g)}
                            title="Xem cơ hội"
                            className="p-1.5 text-app-dim hover:text-info"
                          >
                            <Eye size={14} />
                          </button>
                          <button
                            onClick={() => scanNowMut.mutate(g.id)}
                            title="Scan ngay"
                            disabled={scanNowMut.isPending}
                            className="p-1.5 text-app-dim hover:text-hermes disabled:opacity-50"
                          >
                            {scanNowMut.isPending ? <Loader size={14} className="animate-spin" /> : <Play size={14} />}
                          </button>
                          <button
                            onClick={() => { setEditGroup(g); setShowModal(true) }}
                            title="Sửa"
                            className="p-1.5 text-app-dim hover:text-yellow-500"
                          >
                            <Pencil size={14} />
                          </button>
                          <button
                            onClick={() => handleDelete(g)}
                            title="Xóa"
                            className="p-1.5 text-app-dim hover:text-red-500"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Tab: Performance */}
      {!selectedGroup && tab === 'performance' && (
        <PerformanceTable data={perfData} loading={loadingPerf} />
      )}

      {/* Modal */}
      {showModal && (
        <AddEditGroupModal
          group={editGroup}
          onClose={() => { setShowModal(false); setEditGroup(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

// ─── Opportunities Panel ───
function OpportunitiesPanel({ group, opportunities, loading, statusFilter, onStatusFilter, onBack }) {
  const statuses = ['', 'pending', 'acted', 'skipped', 'expired', 'failed']
  const statusLabels = { '': 'Tất cả', ...Object.fromEntries(Object.entries(OPP_STATUS).map(([k, v]) => [k, v.label])) }

  return (
    <div>
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-app-muted hover:text-app-primary mb-4">
        <ArrowLeft size={16} /> Quay lại danh sách
      </button>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-app-primary">{group.group_name}</h2>
          <p className="text-sm text-app-muted">
            {group.total_opportunities || 0} cơ hội phát hiện &middot; {group.total_acted || 0} đã tương tác
          </p>
        </div>
        <div className="flex gap-1">
          {statuses.map(s => (
            <button
              key={s}
              onClick={() => onStatusFilter(s)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                statusFilter === s ? 'bg-blue-100 text-info' : 'bg-app-elevated text-app-muted hover:bg-app-hover'
              }`}
            >
              {statusLabels[s]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader size={24} className="animate-spin text-info" />
        </div>
      ) : opportunities.length === 0 ? (
        <div className="text-center py-16 text-app-dim">
          <Target size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Chưa có cơ hội nào</p>
        </div>
      ) : (
        <div className="space-y-3">
          {opportunities.map(opp => {
            const status = OPP_STATUS[opp.status] || OPP_STATUS.pending
            return (
              <div key={opp.id} className="bg-app-surface rounded shadow p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-app-primary line-clamp-3">
                      {opp.post_content || '(Không có nội dung)'}
                    </p>
                    {opp.post_author && (
                      <p className="text-xs text-app-dim mt-1">Bởi: {opp.post_author}</p>
                    )}
                    {opp.opportunity_reason && (
                      <p className="text-xs text-info mt-1 italic">{opp.opportunity_reason}</p>
                    )}
                    {opp.comment_posted && (
                      <div className="mt-2 px-3 py-2 bg-green-50 rounded-lg text-xs text-hermes">
                        Comment: "{opp.comment_posted}"
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-bold ${scoreColor(opp.opportunity_score)}`}>
                      {opp.opportunity_score}/10
                    </span>
                    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                      {status.label}
                    </span>
                    <span className="text-xs text-app-dim">{relTime(opp.detected_at)}</span>
                  </div>
                </div>
                {opp.matched_keywords?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {opp.matched_keywords.map(kw => (
                      <span key={kw} className="px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-600">{kw}</span>
                    ))}
                  </div>
                )}
                {opp.post_url && (
                  <a
                    href={opp.post_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs text-info hover:underline"
                  >
                    <ExternalLink size={12} /> Xem bài gốc
                  </a>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Performance Table ───
function PerformanceTable({ data, loading }) {
  const [sortBy, setSortBy] = useState('acted_7d')
  const [sortDir, setSortDir] = useState('desc')

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = a[sortBy] ?? 0
      const bv = b[sortBy] ?? 0
      return sortDir === 'desc' ? bv - av : av - bv
    })
  }, [data, sortBy, sortDir])

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortBy(col); setSortDir('desc') }
  }

  const SortHeader = ({ col, children }) => (
    <th
      onClick={() => toggleSort(col)}
      className="px-4 py-3 text-left text-xs font-medium text-app-muted uppercase cursor-pointer hover:text-app-primary select-none"
    >
      {children} {sortBy === col && (sortDir === 'desc' ? '↓' : '↑')}
    </th>
  )

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader size={24} className="animate-spin text-info" />
    </div>
  )

  if (!data.length) return (
    <div className="text-center py-20 text-app-dim">
      <BarChart3 size={48} className="mx-auto mb-3 opacity-30" />
      <p className="text-sm">Chưa có dữ liệu hiệu suất</p>
    </div>
  )

  return (
    <div className="bg-app-surface rounded shadow overflow-hidden">
      <table className="w-full">
        <thead className="bg-app-base">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-app-muted uppercase">Nhóm</th>
            <SortHeader col="total_detected">Phát hiện</SortHeader>
            <SortHeader col="total_acted">Đã act</SortHeader>
            <SortHeader col="avg_score">Avg Score</SortHeader>
            <SortHeader col="detected_7d">7 ngày detect</SortHeader>
            <SortHeader col="acted_7d">7 ngày act</SortHeader>
            <th className="px-4 py-3 text-left text-xs font-medium text-app-muted uppercase">Cơ hội gần nhất</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map(g => (
            <tr key={g.monitored_group_id} className={g.acted_7d > 5 ? 'bg-green-50/50' : 'hover:bg-app-base'}>
              <td className="px-4 py-3 text-sm font-medium text-app-primary">{g.group_name || g.group_fb_id}</td>
              <td className="px-4 py-3 text-sm text-app-muted">{g.total_detected}</td>
              <td className="px-4 py-3 text-sm text-app-muted">{g.total_acted}</td>
              <td className="px-4 py-3">
                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-bold ${scoreColor(g.avg_score)}`}>
                  {g.avg_score || '—'}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-app-muted">{g.detected_7d}</td>
              <td className="px-4 py-3">
                <span className="text-sm font-medium text-hermes">{g.acted_7d}</span>
              </td>
              <td className="px-4 py-3 text-xs text-app-muted">{relTime(g.last_opportunity_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
