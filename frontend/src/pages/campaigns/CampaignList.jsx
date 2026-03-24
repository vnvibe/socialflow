import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Target, Plus, Play, Pause, Trash2, Eye, Users, Clock, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'

const STATUS_CONFIG = {
  idle:      { label: 'Chua chay', color: 'bg-gray-100 text-gray-600' },
  running:   { label: 'Dang chay', color: 'bg-green-100 text-green-700' },
  paused:    { label: 'Tam dung',  color: 'bg-yellow-100 text-yellow-700' },
  completed: { label: 'Hoan thanh', color: 'bg-blue-100 text-blue-700' },
  error:     { label: 'Loi',       color: 'bg-red-100 text-red-700' },
}

export default function CampaignList() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ['campaigns'],
    queryFn: () => api.get('/campaigns').then(r => r.data),
  })

  const startMut = useMutation({
    mutationFn: (id) => api.post(`/campaigns/${id}/start`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Chien dich da bat dau') },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi'),
  })

  const stopMut = useMutation({
    mutationFn: (id) => api.post(`/campaigns/${id}/stop`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Da tam dung') },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi'),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/campaigns/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaigns'] }); toast.success('Da xoa') },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi'),
  })

  const filtered = campaigns.filter(c =>
    !search || (c.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.topic || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Target size={24} className="text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Chien Dich</h1>
        </div>
        <button
          onClick={() => navigate('/campaigns/new')}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} /> Tao moi
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4 max-w-sm">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Tim chien dich..."
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Dang tai...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Target size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500">Chua co chien dich nao</p>
          <button
            onClick={() => navigate('/campaigns/new')}
            className="mt-3 text-blue-600 hover:underline text-sm"
          >
            Tao chien dich dau tien
          </button>
        </div>
      ) : (
        <div className="grid gap-4">
          {filtered.map(c => {
            const status = STATUS_CONFIG[c.status] || STATUS_CONFIG.idle
            const roleCount = c.campaign_roles?.length || 0
            const nickCount = (c.campaign_roles || []).reduce((sum, r) => sum + (r.account_ids?.length || 0), 0)
            const isRunning = c.status === 'running' || c.is_active

            return (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{c.name}</h3>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                        {status.label}
                      </span>
                    </div>
                    {c.topic && (
                      <p className="text-sm text-gray-500 mb-2">Chu de: {c.topic}</p>
                    )}
                    <div className="flex items-center gap-4 text-xs text-gray-400">
                      {roleCount > 0 && (
                        <span className="flex items-center gap-1">
                          <Users size={12} /> {roleCount} roles, {nickCount} nicks
                        </span>
                      )}
                      {c.last_run_at && (
                        <span className="flex items-center gap-1">
                          <Clock size={12} /> {formatDistanceToNow(new Date(c.last_run_at), { addSuffix: true, locale: vi })}
                        </span>
                      )}
                      {c.total_runs > 0 && (
                        <span>Da chay {c.total_runs} lan</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isRunning ? (
                      <button onClick={() => stopMut.mutate(c.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-yellow-700 bg-yellow-50 rounded-lg hover:bg-yellow-100">
                        <Pause size={14} /> Dung
                      </button>
                    ) : (
                      <button onClick={() => startMut.mutate(c.id)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100">
                        <Play size={14} /> Chay
                      </button>
                    )}
                    <button onClick={() => navigate(`/campaigns/${c.id}`)} className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
                      <Eye size={14} /> Chi tiet
                    </button>
                    <button
                      onClick={() => { if (confirm('Xoa chien dich nay?')) deleteMut.mutate(c.id) }}
                      className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
