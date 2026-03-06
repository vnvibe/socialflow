import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Play, Square, Trash2, Calendar, Users, FileText, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

export default function CampaignManager() {
  const queryClient = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    name: '',
    target_ids: [],
    content_ids: [],
    schedule_type: 'interval',
    interval_minutes: 60,
    cron_expression: '',
    spin_mode: 'none'
  })

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.get('/campaigns').then(r => r.data)
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get('/groups').then(r => r.data)
  })

  const { data: fanpages = [] } = useQuery({
    queryKey: ['fanpages'],
    queryFn: () => api.get('/fanpages').then(r => r.data)
  })

  const { data: contents = [] } = useQuery({
    queryKey: ['content'],
    queryFn: () => api.get('/content').then(r => r.data)
  })

  const createMutation = useMutation({
    mutationFn: (data) => api.post('/campaigns', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] })
      setShowForm(false)
      setForm({ name: '', target_ids: [], content_ids: [], schedule_type: 'interval', interval_minutes: 60, cron_expression: '', spin_mode: 'none' })
      toast.success('Campaign created')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create')
  })

  const startMutation = useMutation({
    mutationFn: (id) => api.post(`/campaigns/${id}/start`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Campaign started') },
    onError: () => toast.error('Failed to start')
  })

  const stopMutation = useMutation({
    mutationFn: (id) => api.post(`/campaigns/${id}/stop`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Campaign stopped') },
    onError: () => toast.error('Failed to stop')
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/campaigns/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Deleted') },
    onError: () => toast.error('Failed to delete')
  })

  const targets = [...groups.map(g => ({ id: g.id, name: g.name || g.fb_group_id, type: 'group' })), ...fanpages.map(p => ({ id: p.id, name: p.name || p.fb_page_id, type: 'page' }))]

  const toggleTarget = (id) => {
    setForm(prev => ({
      ...prev,
      target_ids: prev.target_ids.includes(id) ? prev.target_ids.filter(t => t !== id) : [...prev.target_ids, id]
    }))
  }

  const toggleContent = (id) => {
    setForm(prev => ({
      ...prev,
      content_ids: prev.content_ids.includes(id) ? prev.content_ids.filter(c => c !== id) : [...prev.content_ids, id]
    }))
  }

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
          <Plus size={18} /> New Campaign
        </button>
      </div>

      {campaigns.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Calendar size={48} className="mx-auto mb-3 text-gray-300" />
          <p>No campaigns yet</p>
        </div>
      ) : (
        <div className="space-y-4">
          {campaigns.map(campaign => (
            <div key={campaign.id} className="bg-white rounded-xl shadow p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-gray-900 text-lg">{campaign.name}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${campaign.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {campaign.status === 'active' ? 'Active' : 'Inactive'}
                    </span>
                  </div>

                  <div className="flex items-center gap-6 mt-3 text-sm text-gray-500">
                    <span className="flex items-center gap-1">
                      <Users size={14} />
                      {campaign.targets_count ?? campaign.target_ids?.length ?? 0} targets
                    </span>
                    <span className="flex items-center gap-1">
                      <FileText size={14} />
                      {campaign.contents_count ?? campaign.content_ids?.length ?? 0} contents
                    </span>
                    <span className="flex items-center gap-1">
                      <Calendar size={14} />
                      {campaign.schedule_type === 'interval'
                        ? `Every ${campaign.interval_minutes}m`
                        : campaign.cron_expression || '—'}
                    </span>
                    <span className="flex items-center gap-1">
                      <RefreshCw size={14} />
                      Spin: {campaign.spin_mode || 'none'}
                    </span>
                  </div>

                  <div className="flex items-center gap-6 mt-2 text-xs text-gray-400">
                    <span>Last run: {campaign.last_run ? new Date(campaign.last_run).toLocaleString() : 'Never'}</span>
                    <span>Next run: {campaign.next_run ? new Date(campaign.next_run).toLocaleString() : '—'}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {campaign.status === 'active' ? (
                    <button
                      onClick={() => stopMutation.mutate(campaign.id)}
                      disabled={stopMutation.isPending}
                      className="flex items-center gap-1 bg-red-50 text-red-600 px-3 py-2 rounded-lg hover:bg-red-100 text-sm"
                    >
                      <Square size={14} /> Stop
                    </button>
                  ) : (
                    <button
                      onClick={() => startMutation.mutate(campaign.id)}
                      disabled={startMutation.isPending}
                      className="flex items-center gap-1 bg-green-50 text-green-600 px-3 py-2 rounded-lg hover:bg-green-100 text-sm"
                    >
                      <Play size={14} /> Start
                    </button>
                  )}
                  <button
                    onClick={() => { if (confirm('Delete this campaign?')) deleteMutation.mutate(campaign.id) }}
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 overflow-y-auto py-8" onClick={() => setShowForm(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl m-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">New Campaign</h2>
            <div className="space-y-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name</label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="My Campaign"
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>

              {/* Target selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Targets ({form.target_ids.length} selected)</label>
                <div className="border rounded-lg max-h-40 overflow-y-auto p-2 space-y-1">
                  {targets.length === 0 && <p className="text-sm text-gray-400 p-2">No targets available</p>}
                  {targets.map(t => (
                    <label key={t.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.target_ids.includes(t.id)}
                        onChange={() => toggleTarget(t.id)}
                        className="rounded"
                      />
                      <span className="text-sm">{t.name}</span>
                      <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full capitalize">{t.type}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Content selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contents ({form.content_ids.length} selected)</label>
                <div className="border rounded-lg max-h-40 overflow-y-auto p-2 space-y-1">
                  {contents.length === 0 && <p className="text-sm text-gray-400 p-2">No content available</p>}
                  {contents.map(c => (
                    <label key={c.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-gray-50 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.content_ids.includes(c.id)}
                        onChange={() => toggleContent(c.id)}
                        className="rounded"
                      />
                      <span className="text-sm truncate">{c.caption?.slice(0, 60) || 'Untitled'}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Schedule */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Schedule Type</label>
                  <select
                    value={form.schedule_type}
                    onChange={e => setForm({ ...form, schedule_type: e.target.value })}
                    className="w-full border rounded-lg px-3 py-2"
                  >
                    <option value="interval">Interval</option>
                    <option value="cron">Cron</option>
                  </select>
                </div>
                {form.schedule_type === 'interval' ? (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Interval (minutes)</label>
                    <input
                      type="number"
                      value={form.interval_minutes}
                      onChange={e => setForm({ ...form, interval_minutes: parseInt(e.target.value) || 60 })}
                      min={1}
                      className="w-full border rounded-lg px-3 py-2"
                    />
                  </div>
                ) : (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Cron Expression</label>
                    <input
                      value={form.cron_expression}
                      onChange={e => setForm({ ...form, cron_expression: e.target.value })}
                      placeholder="0 */2 * * *"
                      className="w-full border rounded-lg px-3 py-2 font-mono text-sm"
                    />
                  </div>
                )}
              </div>

              {/* Spin mode */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Spin Mode</label>
                <select
                  value={form.spin_mode}
                  onChange={e => setForm({ ...form, spin_mode: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="none">None</option>
                  <option value="basic">Basic</option>
                  <option value="ai">AI</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowForm(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => createMutation.mutate(form)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                disabled={createMutation.isPending || !form.name}
              >
                {createMutation.isPending ? 'Creating...' : 'Create Campaign'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
