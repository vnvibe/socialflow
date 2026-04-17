import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { XCircle, RotateCcw, Clock, Loader2, CheckCircle, AlertCircle, Ban, PenSquare, Megaphone, Send, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const statusTabs = [
  { key: 'all', label: 'Tất cả' },
  { key: 'pending', label: 'Chờ xử lý' },
  { key: 'running', label: 'Đang chạy' },
  { key: 'done', label: 'Hoàn thành' },
  { key: 'failed', label: 'Thất bại' }
]

const statusConfig = {
  pending: { icon: Clock, label: 'Chờ xử lý', cls: 'bg-yellow-100 text-yellow-700' },
  claimed: { icon: Loader2, label: 'Đang xử lý', cls: 'bg-blue-100 text-info' },
  running: { icon: Loader2, label: 'Đang chạy', cls: 'bg-blue-100 text-info' },
  done: { icon: CheckCircle, label: 'Hoàn thành', cls: 'bg-green-100 text-hermes' },
  failed: { icon: AlertCircle, label: 'Thất bại', cls: 'bg-red-100 text-red-700' },
  cancelled: { icon: Ban, label: 'Đã huỷ', cls: 'bg-app-elevated text-app-muted' }
}

const typeLabels = {
  post_page: 'Đăng trang',
  post_group: 'Đăng nhóm',
  post_profile: 'Đăng cá nhân',
  process_video: 'Xử lý video',
  fetch_inbox: 'Tải hộp thư',
  check_health: 'Kiểm tra',
  fetch_pages: 'Tải trang',
  fetch_groups: 'Tải nhóm',
  fetch_all: 'Tải tất cả',
}

function JobStatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig.pending
  const Icon = config.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${config.cls}`}>
      <Icon size={12} className={status === 'running' || status === 'claimed' ? 'animate-spin' : ''} />
      {config.label}
    </span>
  )
}

export default function PublishQueue() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('all')
  const [pendingAction, setPendingAction] = useState({ id: null, type: null })

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.get('/jobs').then(r => r.data),
    refetchInterval: 10000
  })

  const cancelMutation = useMutation({
    mutationFn: (id) => api.post(`/jobs/${id}/cancel`),
    onMutate: (id) => setPendingAction({ id, type: 'cancel' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); toast.success('Đã huỷ') },
    onError: () => toast.error('Không thể huỷ'),
    onSettled: () => setPendingAction({ id: null, type: null }),
  })

  const retryMutation = useMutation({
    mutationFn: (id) => api.post(`/jobs/${id}/retry`),
    onMutate: (id) => setPendingAction({ id, type: 'retry' }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); toast.success('Đã thêm lại') },
    onError: () => toast.error('Không thể thử lại'),
    onSettled: () => setPendingAction({ id: null, type: null }),
  })

  const filtered = activeTab === 'all' ? jobs : jobs.filter(j => j.status === activeTab)

  const tabCounts = {
    all: jobs.length,
    pending: jobs.filter(j => j.status === 'pending').length,
    running: jobs.filter(j => j.status === 'running' || j.status === 'claimed').length,
    done: jobs.filter(j => j.status === 'done').length,
    failed: jobs.filter(j => j.status === 'failed').length
  }

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-app-primary">Hàng đợi đăng bài</h1>
        <div className="flex gap-2">
          <Link to="/content/new" className="flex items-center gap-2 border border-app-border px-4 py-2 rounded-lg hover:bg-app-base text-sm">
            <PenSquare size={16} /> Tạo nội dung mới
          </Link>
          <Link to="/campaigns" className="flex items-center gap-2 bg-info text-white px-4 py-2 rounded-lg hover:opacity-90 text-sm">
            <Megaphone size={16} /> Chiến dịch
          </Link>
        </div>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-1 mb-6 bg-app-elevated rounded-lg p-1 w-fit">
        {statusTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key ? 'bg-app-surface shadow text-app-primary' : 'text-app-muted hover:text-app-primary'
            }`}
          >
            {tab.label}
            {tabCounts[tab.key] > 0 && (
              <span className="ml-1.5 text-xs bg-app-hover text-app-muted px-1.5 py-0.5 rounded-full">{tabCounts[tab.key]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="bg-app-surface rounded shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-app-base">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Loại</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Nơi đăng</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Tài khoản</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Nội dung</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Lịch đăng</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Trạng thái</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-app-muted">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(job => (
              <tr key={job.id} className="hover:bg-app-base">
                <td className="px-4 py-3">
                  <span className="text-xs bg-app-elevated text-app-muted px-2 py-0.5 rounded-full">
                    {typeLabels[job.job_type || job.type] || job.job_type || job.type || '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {job.target_name || job.fanpage?.name || job.group?.name || '—'}
                </td>
                <td className="px-4 py-3 text-sm text-app-muted">{job.account?.username || '—'}</td>
                <td className="px-4 py-3 text-sm text-app-muted max-w-xs truncate">{job.content?.caption || job.caption || '—'}</td>
                <td className="px-4 py-3 text-sm text-app-muted">
                  {job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3">
                  <JobStatusBadge status={job.status} />
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  {(job.status === 'pending' || job.status === 'claimed') && (
                    <button
                      onClick={() => cancelMutation.mutate(job.id)}
                      disabled={pendingAction.id === job.id}
                      className="text-app-dim hover:text-red-600 inline-flex items-center gap-1 text-sm"
                      title="Huỷ bài đăng"
                    >
                      {pendingAction.id === job.id && pendingAction.type === 'cancel' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />} Huỷ
                    </button>
                  )}
                  {job.status === 'failed' && (
                    <button
                      onClick={() => retryMutation.mutate(job.id)}
                      disabled={pendingAction.id === job.id}
                      className="text-app-dim hover:text-info inline-flex items-center gap-1 text-sm"
                      title="Thử lại"
                    >
                      {pendingAction.id === job.id && pendingAction.type === 'retry' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />} Thử lại
                    </button>
                  )}
                  {job.error_message && (
                    <span className="text-xs text-red-500 cursor-help" title={job.error_message}>Xem lỗi</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <Send size={40} className="mx-auto mb-3 text-app-dim" />
                  <p className="text-app-muted mb-2">Chưa có bài đăng nào trong hàng đợi</p>
                  <p className="text-sm text-app-dim mb-4">Tạo nội dung hoặc chiến dịch để bắt đầu đăng bài tự động</p>
                  <div className="flex items-center justify-center gap-3">
                    <Link to="/content/new" className="inline-flex items-center gap-2 bg-info text-white px-4 py-2 rounded-lg hover:opacity-90 text-sm">
                      <Plus size={16} /> Tạo nội dung
                    </Link>
                    <Link to="/campaigns" className="inline-flex items-center gap-2 border border-app-border px-4 py-2 rounded-lg hover:bg-app-base text-sm">
                      <Megaphone size={16} /> Tạo chiến dịch
                    </Link>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
