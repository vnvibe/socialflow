import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Database, Search, Filter, Download, Upload, Trash2,
  ChevronLeft, ChevronRight, Loader, RefreshCw, Zap,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const STATUS_CONFIG = {
  discovered: { label: 'Discovered', color: 'bg-blue-100 text-blue-700' },
  friend_sent: { label: 'Friend Sent', color: 'bg-yellow-100 text-yellow-700' },
  followed: { label: 'Followed', color: 'bg-green-100 text-green-700' },
  connected: { label: 'Connected', color: 'bg-emerald-100 text-emerald-700' },
  skipped: { label: 'Skipped', color: 'bg-gray-100 text-gray-600' },
  blocked: { label: 'Blocked', color: 'bg-red-100 text-red-700' },
}

function StatPill({ label, value, color, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-xl border-2 py-3 px-2 text-center transition-all ${
        active
          ? `${color} border-current shadow-sm`
          : 'bg-white border-gray-200 hover:border-gray-300'
      }`}
    >
      <p className={`text-xl font-bold ${active ? '' : 'text-gray-900'}`}>{value}</p>
      <p className={`text-[10px] font-semibold uppercase tracking-wider ${active ? '' : 'text-gray-500'}`}>{label}</p>
    </button>
  )
}

function formatDate(isoStr) {
  if (!isoStr) return '--'
  const d = new Date(isoStr)
  return `${d.getDate()}/${d.getMonth() + 1} ${d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
}

function getAvatarUrl(fbUid) {
  if (!fbUid) return null
  return `https://graph.facebook.com/${fbUid}/picture?type=small`
}

export default function DataCenter() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sourceFilter, setSourceFilter] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(new Set())
  const [showImport, setShowImport] = useState(false)
  const [importText, setImportText] = useState('')

  // Stats
  const { data: stats } = useQuery({
    queryKey: ['leads-stats'],
    queryFn: () => api.get('/leads/stats').then(r => r.data),
  })

  // Leads list
  const { data: leadsData, isLoading } = useQuery({
    queryKey: ['leads', { search, status: statusFilter, source: sourceFilter, page }],
    queryFn: () => {
      const params = new URLSearchParams({ page, limit: 50 })
      if (search) params.set('search', search)
      if (statusFilter) params.set('status', statusFilter)
      if (sourceFilter) params.set('source', sourceFilter)
      return api.get(`/leads?${params}`).then(r => r.data)
    },
    keepPreviousData: true,
  })

  const leads = leadsData?.data || []
  const totalPages = leadsData?.pages || 1
  const totalCount = leadsData?.total || 0

  // Mutations
  const updateMut = useMutation({
    mutationFn: ({ id, ...body }) => api.put(`/leads/${id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['leads-stats'] })
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/leads/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['leads-stats'] })
      toast.success('Da xoa')
    },
  })

  const bulkImportMut = useMutation({
    mutationFn: (leads) => api.post('/leads/bulk', { leads }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['leads'] })
      queryClient.invalidateQueries({ queryKey: ['leads-stats'] })
      toast.success(`Da import ${res.data.imported} leads`)
      setShowImport(false)
      setImportText('')
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Import that bai'),
  })

  const handleExport = async () => {
    try {
      const res = await api.post('/leads/export-csv', { status: statusFilter || undefined }, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'leads-export.csv'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      toast.success('Dang tai CSV...')
    } catch {
      toast.error('Export that bai')
    }
  }

  const handleBulkImport = () => {
    const lines = importText.trim().split('\n').filter(Boolean)
    const leads = lines.map(line => {
      const parts = line.split(',').map(s => s.trim())
      return { fb_uid: parts[0], name: parts[1] || null }
    }).filter(l => l.fb_uid)
    if (leads.length === 0) { toast.error('Khong co du lieu hop le'); return }
    bulkImportMut.mutate(leads)
  }

  const handleStatusChange = (leadId, newStatus) => {
    updateMut.mutate({ id: leadId, status: newStatus })
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === leads.length) setSelected(new Set())
    else setSelected(new Set(leads.map(l => l.id)))
  }

  const byStatus = stats?.by_status || {}
  const total = stats?.total || 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
            <Database size={20} className="text-blue-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">UID Data Center</h1>
            <p className="text-sm text-gray-500">{total.toLocaleString()} profiles collected</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['leads'] })
              queryClient.invalidateQueries({ queryKey: ['leads-stats'] })
            }}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            <RefreshCw size={14} /> Refresh
          </button>
          <button
            onClick={() => setShowImport(!showImport)}
            className="flex items-center gap-1.5 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
          >
            <Upload size={14} /> Import
          </button>
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-4 py-2 bg-red-500 text-white rounded-lg text-sm font-medium hover:bg-red-600"
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {/* Import Panel */}
      {showImport && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Bulk Import</h3>
          <p className="text-xs text-gray-500 mb-3">Moi dong: fb_uid, ten (VD: 100012345678, Nguyen Van A)</p>
          <textarea
            value={importText}
            onChange={e => setImportText(e.target.value)}
            rows={5}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
            placeholder="100012345678, Nguyen Van A&#10;100087654321, Tran Van B"
          />
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setShowImport(false)} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">
              Huy
            </button>
            <button
              onClick={handleBulkImport}
              disabled={bulkImportMut.isPending}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {bulkImportMut.isPending ? 'Dang import...' : 'Import'}
            </button>
          </div>
        </div>
      )}

      {/* Stats Pills */}
      <div className="flex gap-3 overflow-x-auto pb-1">
        <StatPill
          label="Total"
          value={total.toLocaleString()}
          color="bg-gray-50 text-gray-700"
          active={!statusFilter}
          onClick={() => { setStatusFilter(''); setPage(1) }}
        />
        <StatPill
          label="Facebook"
          value={(stats?.by_platform?.facebook || total).toLocaleString()}
          color="bg-blue-50 text-blue-700"
          active={false}
          onClick={() => {}}
        />
        <StatPill
          label="Discovered"
          value={(byStatus.discovered || 0).toLocaleString()}
          color="bg-blue-50 text-blue-700"
          active={statusFilter === 'discovered'}
          onClick={() => { setStatusFilter(statusFilter === 'discovered' ? '' : 'discovered'); setPage(1) }}
        />
        <StatPill
          label="Friend Sent"
          value={(byStatus.friend_sent || 0).toLocaleString()}
          color="bg-yellow-50 text-yellow-700"
          active={statusFilter === 'friend_sent'}
          onClick={() => { setStatusFilter(statusFilter === 'friend_sent' ? '' : 'friend_sent'); setPage(1) }}
        />
        <StatPill
          label="Followed"
          value={(byStatus.followed || 0).toLocaleString()}
          color="bg-green-50 text-green-700"
          active={statusFilter === 'followed'}
          onClick={() => { setStatusFilter(statusFilter === 'followed' ? '' : 'followed'); setPage(1) }}
        />
        <StatPill
          label="Skipped"
          value={(byStatus.skipped || 0).toLocaleString()}
          color="bg-gray-100 text-gray-600"
          active={statusFilter === 'skipped'}
          onClick={() => { setStatusFilter(statusFilter === 'skipped' ? '' : 'skipped'); setPage(1) }}
        />
      </div>

      {/* Search + Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search by name, UID, source..."
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <select
          value={sourceFilter}
          onChange={e => { setSourceFilter(e.target.value); setPage(1) }}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-600 bg-white"
        >
          <option value="">All Sources</option>
          <option value="reaction">Reaction</option>
          <option value="comment">Comment</option>
          <option value="group_member">Group Member</option>
          <option value="marketplace">Marketplace</option>
          <option value="manual">Manual</option>
          <option value="import">Import</option>
        </select>
        <button className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
          <Filter size={14} /> Filter
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-[40px_1fr_90px_110px_110px_100px_110px] gap-2 px-4 py-3 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <div className="flex items-center">
            <input
              type="checkbox"
              checked={selected.size === leads.length && leads.length > 0}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-gray-300"
            />
          </div>
          <div>UID / Name</div>
          <div>Platform</div>
          <div>Status</div>
          <div>Source</div>
          <div>Note</div>
          <div>Discovered</div>
        </div>

        {/* Rows */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader size={20} className="animate-spin text-blue-500" />
          </div>
        ) : leads.length === 0 ? (
          <div className="text-center py-12">
            <Database size={40} className="mx-auto text-gray-300 mb-2" />
            <p className="text-gray-500 text-sm">Chua co du lieu</p>
          </div>
        ) : (
          leads.map(lead => {
            const statusCfg = STATUS_CONFIG[lead.status] || STATUS_CONFIG.discovered
            const avatar = lead.avatar_url || getAvatarUrl(lead.fb_uid)
            return (
              <div
                key={lead.id}
                className="group grid grid-cols-[40px_1fr_90px_110px_110px_100px_110px] gap-2 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 items-center text-sm"
              >
                <div>
                  <input
                    type="checkbox"
                    checked={selected.has(lead.id)}
                    onChange={() => toggleSelect(lead.id)}
                    className="w-4 h-4 rounded border-gray-300"
                  />
                </div>
                <div className="flex items-center gap-3 min-w-0">
                  {avatar ? (
                    <img
                      src={avatar}
                      alt=""
                      className="w-8 h-8 rounded-full object-cover shrink-0"
                      onError={(e) => { e.target.style.display = 'none' }}
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center shrink-0 text-xs font-bold text-gray-500">
                      {(lead.name || '?')[0].toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{lead.name || lead.fb_uid}</p>
                    <p className="text-xs text-gray-400 truncate">{lead.fb_uid}</p>
                  </div>
                </div>
                <div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                    FB
                  </span>
                </div>
                <div>
                  <select
                    value={lead.status}
                    onChange={e => handleStatusChange(lead.id, e.target.value)}
                    className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 cursor-pointer ${statusCfg.color}`}
                  >
                    {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                      <option key={key} value={key}>{cfg.label}</option>
                    ))}
                  </select>
                </div>
                <div className="text-xs text-gray-500 flex items-center gap-1">
                  <Zap size={12} className="text-gray-400" />
                  {lead.source || '--'}
                </div>
                <div className="text-xs text-gray-400 truncate">{lead.note || '--'}</div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">{formatDate(lead.discovered_at)}</span>
                  <button
                    onClick={() => { if (confirm('Xoa lead nay?')) deleteMut.mutate(lead.id) }}
                    className="p-1 text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Page {page} / {totalPages} ({totalCount.toLocaleString()} total)
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-30"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-50 disabled:opacity-30"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
