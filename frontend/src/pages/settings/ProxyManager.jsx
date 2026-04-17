import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, Trash2, Zap, Loader2, CheckCircle, AlertCircle, Globe, Wifi } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

export default function ProxyManager() {
  const queryClient = useQueryClient()
  const [bulkText, setBulkText] = useState('')
  const [testingAll, setTestingAll] = useState(false)

  const { data: proxies = [], isLoading } = useQuery({
    queryKey: ['proxies'],
    queryFn: () => api.get('/proxies').then(r => r.data)
  })

  const bulkImportMutation = useMutation({
    mutationFn: (lines) => api.post('/proxies/bulk-import', { proxies: lines }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['proxies'] })
      setBulkText('')
      toast.success(`Imported ${res.data.imported || res.data.count || 'proxies'} successfully`)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Import failed')
  })

  const testMutation = useMutation({
    mutationFn: (id) => api.post(`/proxies/${id}/test`),
    onSuccess: (res, id) => {
      queryClient.invalidateQueries({ queryKey: ['proxies'] })
      toast.success(`Proxy test: ${res.data.speed || 'OK'}`)
    },
    onError: (err, id) => {
      queryClient.invalidateQueries({ queryKey: ['proxies'] })
      toast.error('Proxy test failed')
    }
  })

  const testAllMutation = useMutation({
    mutationFn: () => api.post('/proxies/test-all'),
    onMutate: () => setTestingAll(true),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['proxies'] })
      setTestingAll(false)
      toast.success(`Tested all proxies: ${res.data.passed || 0} passed, ${res.data.failed || 0} failed`)
    },
    onError: () => { setTestingAll(false); toast.error('Test all failed') }
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/proxies/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['proxies'] }); toast.success('Deleted') },
    onError: () => toast.error('Failed to delete')
  })

  const handleBulkImport = () => {
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return toast.error('Enter at least one proxy')
    bulkImportMutation.mutate(lines)
  }

  const statusIcon = (status) => {
    if (status === 'active' || status === 'online') return <CheckCircle size={14} className="text-hermes" />
    if (status === 'failed' || status === 'dead') return <AlertCircle size={14} className="text-red-500" />
    return <div className="w-3.5 h-3.5 rounded-full bg-app-hover" />
  }

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-app-primary">Proxy Manager</h1>
        <button
          onClick={() => testAllMutation.mutate()}
          disabled={testingAll}
          className="flex items-center gap-2 bg-info text-white px-4 py-2 rounded-lg hover:opacity-90"
        >
          {testingAll ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
          Test All
        </button>
      </div>

      {/* Bulk Import */}
      <div className="bg-app-surface rounded shadow p-4 mb-6">
        <h3 className="font-semibold text-app-primary mb-2">Bulk Import</h3>
        <p className="text-sm text-app-muted mb-3">Enter one proxy per line in format: <code className="bg-app-elevated px-1 rounded text-xs">ip:port:username:password</code></p>
        <textarea
          value={bulkText}
          onChange={e => setBulkText(e.target.value)}
          rows={5}
          placeholder={"1.2.3.4:8080:user:pass\n5.6.7.8:3128:user2:pass2"}
          className="w-full border rounded-lg px-3 py-2 font-mono text-sm resize-none"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-app-dim">{bulkText.split('\n').filter(l => l.trim()).length} proxies entered</span>
          <button
            onClick={handleBulkImport}
            disabled={bulkImportMutation.isPending || !bulkText.trim()}
            className="flex items-center gap-2 bg-hermes text-white px-4 py-2 rounded-lg hover:bg-green-700 text-sm"
          >
            <Upload size={16} />
            {bulkImportMutation.isPending ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>

      {/* Proxy Table */}
      <div className="bg-app-surface rounded shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-app-base">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Label</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Host:Port</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Type</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Country</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Speed</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Assigned</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-app-muted">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {proxies.map(proxy => (
              <tr key={proxy.id} className="hover:bg-app-base">
                <td className="px-4 py-3 text-sm font-medium">{proxy.label || proxy.name || '—'}</td>
                <td className="px-4 py-3 text-sm font-mono text-app-muted">{proxy.host}:{proxy.port}</td>
                <td className="px-4 py-3">
                  <span className="text-xs bg-app-elevated text-app-muted px-2 py-0.5 rounded-full uppercase">{proxy.type || 'HTTP'}</span>
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className="flex items-center gap-1">
                    <Globe size={12} className="text-app-dim" />
                    {proxy.country || '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm">
                  {proxy.speed ? (
                    <span className="flex items-center gap-1">
                      <Wifi size={12} className={proxy.speed < 500 ? 'text-hermes' : proxy.speed < 2000 ? 'text-yellow-500' : 'text-red-500'} />
                      {proxy.speed}ms
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-3">
                  <span className="flex items-center gap-1.5">
                    {statusIcon(proxy.status)}
                    <span className="text-sm capitalize">{proxy.status || 'unknown'}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-app-muted">
                  {proxy.assigned_accounts?.length > 0 ? (
                    <span className="text-xs bg-blue-50 text-info px-2 py-0.5 rounded-full">
                      {proxy.assigned_accounts.length} account{proxy.assigned_accounts.length > 1 ? 's' : ''}
                    </span>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <button
                    onClick={() => testMutation.mutate(proxy.id)}
                    disabled={testMutation.isPending && testMutation.variables === proxy.id}
                    className="text-app-dim hover:text-info inline-flex items-center gap-1 text-sm"
                    title="Test proxy"
                  >
                    {testMutation.isPending && testMutation.variables === proxy.id ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Zap size={14} />
                    )}
                  </button>
                  <button
                    onClick={() => { if (confirm('Delete this proxy?')) deleteMutation.mutate(proxy.id) }}
                    className="text-app-dim hover:text-red-600"
                  >
                    <Trash2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
            {proxies.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-app-dim">No proxies configured</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
