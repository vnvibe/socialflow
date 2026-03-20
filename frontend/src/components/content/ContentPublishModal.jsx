import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { X, Send, Clock, Loader, Search, FileText, UsersRound } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../../lib/api'
// Agent guard removed — Graph API pages post directly without agent

const filterTabs = [
  { key: 'all', label: 'Tất cả' },
  { key: 'page', label: 'Trang' },
  { key: 'group', label: 'Nhóm' },
]

export default function ContentPublishModal({ contentId, content, onClose }) {
  const [selectedTargets, setSelectedTargets] = useState([])
  const [filterType, setFilterType] = useState('all')
  const [search, setSearch] = useState('')
  const [showSchedule, setShowSchedule] = useState(false)
  const [scheduledAt, setScheduledAt] = useState('')
  // No agent guard needed — API handles Graph API posting directly

  const { data: fanpages = [] } = useQuery({
    queryKey: ['fanpages'],
    queryFn: () => api.get('/fanpages').then(r => r.data),
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get('/groups').then(r => r.data),
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data),
  })

  // Build unified target list
  const allTargets = useMemo(() => {
    const targets = []
    fanpages.forEach(p => targets.push({
      id: p.id,
      type: 'page',
      name: p.name || p.fb_page_id,
      accountId: p.account_id,
      accountName: accounts.find(a => a.id === p.account_id)?.username || '—',
      info: p.fan_count ? `${p.fan_count.toLocaleString()} lượt thích` : '',
      postingMethod: p.posting_method || 'auto',
    }))
    groups.forEach(g => targets.push({
      id: g.id,
      type: 'group',
      name: g.name || g.fb_group_id,
      accountId: g.account_id,
      accountName: accounts.find(a => a.id === g.account_id)?.username || '—',
      info: g.member_count ? `${g.member_count.toLocaleString()} thành viên` : '',
    }))
    return targets
  }, [fanpages, groups, accounts])

  const filteredTargets = useMemo(() => {
    let list = allTargets
    if (filterType !== 'all') list = list.filter(t => t.type === filterType)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(t => t.name.toLowerCase().includes(q) || t.accountName.toLowerCase().includes(q))
    }
    return list
  }, [allTargets, filterType, search])

  const toggleTarget = (target) => {
    setSelectedTargets(prev => {
      const exists = prev.find(t => t.id === target.id && t.type === target.type)
      if (exists) return prev.filter(t => !(t.id === target.id && t.type === target.type))
      return [...prev, target]
    })
  }

  const isSelected = (target) => selectedTargets.some(t => t.id === target.id && t.type === target.type)

  const selectAll = () => setSelectedTargets([...filteredTargets])
  const deselectAll = () => setSelectedTargets([])

  const publishMutation = useMutation({
    mutationFn: async () => {
      const scheduled = showSchedule && scheduledAt ? new Date(scheduledAt).toISOString() : null
      // Group targets by account
      const byAccount = {}
      for (const target of selectedTargets) {
        if (!byAccount[target.accountId]) byAccount[target.accountId] = []
        byAccount[target.accountId].push({ type: target.type, id: target.id, name: target.name })
      }
      const results = []
      for (const [accountId, targets] of Object.entries(byAccount)) {
        const res = await api.post(`/accounts/${accountId}/quick-post`, {
          targets,
          caption: content?.caption || '',
          hashtags: content?.hashtags || [],
          media_id: content?.media_id || undefined,
          scheduled_at: scheduled || undefined,
        })
        results.push(res.data)
      }
      return results
    },
    onSuccess: (results) => {
      const directOk = results.reduce((n, r) => n + (r.direct_results || []).filter(d => d.status === 'success').length, 0)
      const queued = results.reduce((n, r) => n + (r.job_ids?.length || 0), 0)
      if (directOk > 0) toast.success(`Đã đăng ${directOk} bài qua API!`)
      if (queued > 0) toast.success(`${queued} bài đang chờ Agent`)
      if (directOk === 0 && queued === 0) toast.error('Không đăng được bài nào')
      onClose()
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Không thể tạo bài đăng'),
  })

  const hasTargets = allTargets.length > 0

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900">Đăng nội dung</h3>
            {content && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                {content.caption ? content.caption.slice(0, 60) + (content.caption.length > 60 ? '...' : '') : 'Không có nội dung'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Target selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">
                Chọn nơi đăng <span className="text-blue-600">({selectedTargets.length})</span>
              </label>
              <div className="flex items-center gap-2 text-xs">
                <button onClick={selectAll} className="text-blue-600 hover:text-blue-700">Chọn tất cả</button>
                <button onClick={deselectAll} className="text-gray-500 hover:text-gray-700">Bỏ chọn</button>
              </div>
            </div>

            {/* Search + filter */}
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Tìm trang/nhóm..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex gap-0.5 bg-gray-100 rounded-lg p-0.5">
                {filterTabs.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setFilterType(tab.key)}
                    className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                      filterType === tab.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Target list */}
            {hasTargets ? (
              <div className="max-h-52 overflow-y-auto border border-gray-200 rounded-lg divide-y">
                {filteredTargets.map(target => (
                  <label
                    key={`${target.type}-${target.id}`}
                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                      isSelected(target) ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected(target)}
                      onChange={() => toggleTarget(target)}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {target.type === 'page'
                          ? <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          : <UsersRound className="w-3.5 h-3.5 text-green-500 shrink-0" />
                        }
                        <span className="text-sm text-gray-800 truncate">{target.name}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">{target.accountName}</span>
                        {target.info && <span className="text-xs text-gray-400">&middot; {target.info}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {target.type === 'page' && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          target.postingMethod === 'access_token' ? 'bg-green-100 text-green-600' :
                          target.postingMethod === 'cookie' ? 'bg-orange-100 text-orange-600' :
                          'bg-gray-100 text-gray-500'
                        }`}>
                          {target.postingMethod === 'access_token' ? 'API' : target.postingMethod === 'cookie' ? 'Cookie' : 'Auto'}
                        </span>
                      )}
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                        target.type === 'page' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'
                      }`}>
                        {target.type === 'page' ? 'Trang' : 'Nhóm'}
                      </span>
                    </div>
                  </label>
                ))}
                {filteredTargets.length === 0 && (
                  <p className="text-xs text-gray-400 text-center py-6">Không tìm thấy trang/nhóm nào</p>
                )}
              </div>
            ) : (
              <div className="text-center py-6 border border-gray-200 rounded-lg">
                <p className="text-sm text-gray-500 mb-2">Chưa có trang/nhóm nào</p>
                <div className="flex items-center justify-center gap-2">
                  <Link to="/pages" onClick={onClose} className="text-xs text-blue-600 hover:underline">Thêm trang</Link>
                  <span className="text-xs text-gray-300">|</span>
                  <Link to="/groups" onClick={onClose} className="text-xs text-blue-600 hover:underline">Thêm nhóm</Link>
                </div>
              </div>
            )}
          </div>

          {/* Schedule */}
          <div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showSchedule}
                onChange={e => setShowSchedule(e.target.checked)}
                className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <Clock className="w-4 h-4 text-gray-500" />
              <span className="text-sm text-gray-700">Hẹn giờ đăng bài</span>
            </label>
            {showSchedule && (
              <>
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={e => setScheduledAt(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-400 mt-1">Để trống sẽ đăng ngay lập tức</p>
              </>
            )}
          </div>
        </div>

        {/* Validation */}
        {selectedTargets.length === 0 && (
          <div className="px-4 pb-2">
            <p className="text-xs text-amber-600">* Chọn ít nhất 1 trang hoặc nhóm để đăng bài</p>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Huỷ
          </button>
          <button
            onClick={() => publishMutation.mutate()}
            disabled={publishMutation.isPending || selectedTargets.length === 0}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400 transition-colors"
          >
            {publishMutation.isPending ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {publishMutation.isPending
              ? 'Đang xử lý...'
              : showSchedule && scheduledAt
                ? 'Hẹn giờ đăng'
                : `Đăng ngay (${selectedTargets.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}
