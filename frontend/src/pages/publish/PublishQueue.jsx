import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { XCircle, RotateCcw, Clock, Loader2, CheckCircle, AlertCircle, Ban } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const statusTabs = [
  { key: 'all', label: 'All' },
  { key: 'pending', label: 'Pending' },
  { key: 'running', label: 'Running' },
  { key: 'done', label: 'Done' },
  { key: 'failed', label: 'Failed' }
]

const statusConfig = {
  pending: { icon: Clock, label: 'Pending', cls: 'bg-yellow-100 text-yellow-700' },
  running: { icon: Loader2, label: 'Running', cls: 'bg-blue-100 text-blue-700' },
  done: { icon: CheckCircle, label: 'Done', cls: 'bg-green-100 text-green-700' },
  failed: { icon: AlertCircle, label: 'Failed', cls: 'bg-red-100 text-red-700' },
  cancelled: { icon: Ban, label: 'Cancelled', cls: 'bg-gray-100 text-gray-600' }
}

function JobStatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig.pending
  const Icon = config.icon
  return (
    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${config.cls}`}>
      <Icon size={12} className={status === 'running' ? 'animate-spin' : ''} />
      {config.label}
    </span>
  )
}

export default function PublishQueue() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('all')

  const { data: jobs = [], isLoading } = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api.get('/jobs').then(r => r.data),
    refetchInterval: 10000
  })

  const cancelMutation = useMutation({
    mutationFn: (id) => api.post(`/jobs/${id}/cancel`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); toast.success('Job cancelled') },
    onError: () => toast.error('Failed to cancel')
  })

  const retryMutation = useMutation({
    mutationFn: (id) => api.post(`/jobs/${id}/retry`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['jobs'] }); toast.success('Job retried') },
    onError: () => toast.error('Failed to retry')
  })

  const filtered = activeTab === 'all' ? jobs : jobs.filter(j => j.status === activeTab)

  const tabCounts = {
    all: jobs.length,
    pending: jobs.filter(j => j.status === 'pending').length,
    running: jobs.filter(j => j.status === 'running').length,
    done: jobs.filter(j => j.status === 'done').length,
    failed: jobs.filter(j => j.status === 'failed').length
  }

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Publish Queue</h1>
      </div>

      {/* Status Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {statusTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
            {tabCounts[tab.key] > 0 && (
              <span className="ml-1.5 text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full">{tabCounts[tab.key]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Type</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Target</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Account</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Caption</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Scheduled At</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filtered.map(job => (
              <tr key={job.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">{job.job_type || job.type || '—'}</span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {job.target_name || job.fanpage?.name || job.group?.name || '—'}
                </td>
                <td className="px-4 py-3 text-sm text-gray-600">{job.account?.username || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-500 max-w-xs truncate">{job.content?.caption || job.caption || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {job.scheduled_at ? new Date(job.scheduled_at).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3">
                  <JobStatusBadge status={job.status} />
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  {job.status === 'pending' && (
                    <button
                      onClick={() => cancelMutation.mutate(job.id)}
                      disabled={cancelMutation.isPending}
                      className="text-gray-400 hover:text-red-600 inline-flex items-center gap-1 text-sm"
                      title="Cancel"
                    >
                      <XCircle size={14} /> Cancel
                    </button>
                  )}
                  {job.status === 'failed' && (
                    <button
                      onClick={() => retryMutation.mutate(job.id)}
                      disabled={retryMutation.isPending}
                      className="text-gray-400 hover:text-blue-600 inline-flex items-center gap-1 text-sm"
                      title="Retry"
                    >
                      <RotateCcw size={14} /> Retry
                    </button>
                  )}
                  {job.error_message && (
                    <span className="text-xs text-red-500" title={job.error_message}>Error info</span>
                  )}
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No jobs in queue</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
