import { useState, useMemo, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { X, Save, Search, FileText, UsersRound, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const filterTabs = [
  { key: 'all', label: 'Tất cả' },
  { key: 'page', label: 'Trang' },
  { key: 'group', label: 'Nhóm' },
]

export default function JobEditTargetModal({ job, onClose }) {
  const queryClient = useQueryClient()
  const [selectedTarget, setSelectedTarget] = useState(null)
  const [filterType, setFilterType] = useState('all')
  const [search, setSearch] = useState('')

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
    }))
    groups.forEach(g => targets.push({
      id: g.id,
      type: 'group',
      name: g.name || g.fb_group_id,
      accountId: g.account_id,
      accountName: accounts.find(a => a.id === g.account_id)?.username || '—',
      info: g.member_count ? `${g.member_count.toLocaleString()} thành viên` : '',
    }))
    // Optional: Personal Profiles
    accounts.forEach(a => {
      targets.push({
        id: a.id,
        type: 'profile',
        name: a.username || 'Trang cá nhân',
        accountId: a.id,
        accountName: a.username || 'Trang cá nhân',
        info: 'Trang cá nhân',
      })
    })

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

  // Pre-select current target
  useEffect(() => {
    if (job && allTargets.length > 0 && !selectedTarget) {
      const currentTargetType = job.type === 'post_page' ? 'page' : job.type === 'post_group' ? 'group' : 'profile'
      const match = allTargets.find(t => 
        (t.type === currentTargetType) && 
        (currentTargetType === 'profile' ? t.accountId === job.payload?.account_id : t.id === job.payload?.target_id)
      )
      if (match) setSelectedTarget(match)
    }
  }, [job, allTargets, selectedTarget])

  const updateTargetMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTarget) throw new Error('Vui lòng chọn 1 mục tiêu')
      
      const targetType = selectedTarget.type === 'page' ? 'post_page' : selectedTarget.type === 'group' ? 'post_group' : 'post_profile'

      return api.put(`/jobs/${job.id}/target`, {
        type: targetType,
        account_id: selectedTarget.accountId,
        target_id: selectedTarget.id === selectedTarget.accountId ? null : selectedTarget.id
      })
    },
    onSuccess: () => {
      toast.success('Đã thay đổi nơi đăng thành công!')
      queryClient.invalidateQueries({ queryKey: ['content'] })
      onClose()
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Lỗi khi cập nhật nơi đăng')
    }
  })

  const hasTargets = allTargets.length > 0
  const isSelected = (target) => selectedTarget?.id === target.id && selectedTarget?.type === target.type

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-app-surface rounded w-full max-w-lg  max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-app-border">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-app-primary">Thay đổi Nơi đăng</h3>
            {job && (
              <p className="text-xs text-app-muted mt-0.5 truncate">
                Đang chuyển đổi cho tiến trình đang: {job.status === 'failed' ? 'Lỗi' : 'Chờ chạy'}
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-app-elevated transition-colors">
            <X className="w-5 h-5 text-app-muted" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-app-primary">
                Chọn lại nơi xuất bản
              </label>
            </div>

            {/* Search + filter */}
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-app-dim" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Tìm trang/nhóm..."
                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-app-border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="flex gap-0.5 bg-app-elevated rounded-lg p-0.5 whitespace-nowrap overflow-x-auto min-w-0">
                {filterTabs.map(tab => (
                  <button
                    key={tab.key}
                    onClick={() => setFilterType(tab.key)}
                    className={`px-2 py-1 text-xs rounded-md font-medium transition-colors ${
                      filterType === tab.key ? 'bg-app-surface shadow text-app-primary' : 'text-app-muted hover:text-app-primary'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Target list */}
            {hasTargets ? (
              <div className="max-h-52 overflow-y-auto border border-app-border rounded-lg divide-y bg-app-surface">
                {filteredTargets.map(target => (
                  <label
                    key={`${target.type}-${target.id}`}
                    className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                      isSelected(target) ? 'bg-blue-50' : 'hover:bg-app-base'
                    }`}
                  >
                    <input
                      type="radio"
                      name="job_target"
                      checked={isSelected(target)}
                      onChange={() => setSelectedTarget(target)}
                      className="rounded-full border-app-border text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {target.type === 'page'
                          ? <FileText className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          : target.type === 'group' 
                          ? <UsersRound className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                          : <UsersRound className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                        }
                        <span className="text-sm font-medium text-app-primary truncate">{target.name}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-0.5">
                        <span className="text-xs text-app-dim">Từ: {target.accountName}</span>
                        {target.info && target.type !== 'profile' && <span className="text-xs text-app-dim">&middot; {target.info}</span>}
                      </div>
                    </div>
                    <span className={`text-[10px] whitespace-nowrap shrink-0 px-1.5 py-0.5 rounded-full ${
                      target.type === 'page' ? 'bg-blue-100 text-blue-600' : target.type === 'group' ? 'bg-purple-100 text-purple-600' : 'bg-orange-100 text-orange-600'
                    }`}>
                      {target.type === 'page' ? 'Fanpage' : target.type === 'group' ? 'Group' : 'Cá nhân'}
                    </span>
                  </label>
                ))}
                {filteredTargets.length === 0 && (
                  <p className="text-xs text-app-dim text-center py-6">Không tìm thấy kết quả</p>
                )}
              </div>
            ) : (
              <div className="text-center py-6 border border-app-border rounded-lg bg-app-base">
                <p className="text-sm text-app-muted">Chưa có trang/nhóm nào</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-app-border flex justify-end gap-2 bg-app-base rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-app-primary bg-app-surface border border-app-border rounded-lg hover:bg-app-base transition-colors"
          >
            Hủy
          </button>
          <button
            onClick={() => updateTargetMutation.mutate()}
            disabled={!selectedTarget || updateTargetMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-info rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors"
          >
            <Save size={16} />
            {updateTargetMutation.isPending ? 'Đang cập nhật...' : 'Cập nhật Nơi đăng'}
          </button>
        </div>
      </div>
    </div>
  )
}
