import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PenSquare, ExternalLink, CheckCircle, Clock, XCircle, Loader } from 'lucide-react'
import api from '../../../lib/api'
import { format } from 'date-fns'

const JOB_STATUS = {
  done:      { label: 'Done',    color: 'bg-green-100 text-green-700' },
  running:   { label: 'Running', color: 'bg-blue-100 text-blue-700' },
  pending:   { label: 'Pending', color: 'bg-yellow-100 text-yellow-700' },
  failed:    { label: 'Failed',  color: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Cancelled', color: 'bg-gray-100 text-gray-600' },
}

export default function ContentSection({ campaignId, campaign, accountIds }) {
  const [dateFilter, setDateFilter] = useState('today')

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['campaign-content', campaignId, dateFilter],
    queryFn: async () => {
      if (!accountIds.length) return []
      const { data } = await api.get('/analytics/history', {
        params: { limit: 200 },
      })
      let filtered = (data || []).filter(h => accountIds.includes(h.account_id))

      const now = new Date()
      if (dateFilter === 'today') {
        const todayStr = now.toISOString().split('T')[0]
        filtered = filtered.filter(h => h.published_at?.startsWith(todayStr))
      } else if (dateFilter === '7days') {
        const cutoff = new Date(now - 7 * 86400000).toISOString()
        filtered = filtered.filter(h => h.published_at >= cutoff)
      } else if (dateFilter === '30days') {
        const cutoff = new Date(now - 30 * 86400000).toISOString()
        filtered = filtered.filter(h => h.published_at >= cutoff)
      }

      return filtered
    },
    enabled: accountIds.length > 0,
  })

  const { data: contents = [] } = useQuery({
    queryKey: ['campaign-contents', campaignId],
    queryFn: async () => {
      if (!campaign?.content_ids?.length) return []
      const { data } = await api.get('/content')
      return (data || []).filter(c => campaign.content_ids.includes(c.id))
    },
    enabled: (campaign?.content_ids?.length || 0) > 0,
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Noi dung & Bai dang</h2>
        <a
          href="/content/new"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          <PenSquare size={14} /> Tao noi dung
        </a>
      </div>

      {/* Date Filter */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          { key: 'today', label: 'Hom nay' },
          { key: '7days', label: '7 ngay' },
          { key: '30days', label: '30 ngay' },
          { key: 'all', label: 'Tat ca' },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setDateFilter(f.key)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              dateFilter === f.key ? 'bg-white text-gray-900 shadow-sm rounded-md' : 'text-gray-500 hover:text-gray-700 rounded-md transition-colors'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Content Templates */}
      {contents.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-600 mb-3">Mau noi dung ({contents.length})</h3>
          <div className="grid gap-3">
            {contents.map(c => (
              <div key={c.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <p className="text-sm text-gray-900 line-clamp-2">{c.caption || '(Khong co caption)'}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                  <span>{c.post_type || 'post'}</span>
                  <span>{c.spin_mode || 'none'}</span>
                  {c.hashtags?.length > 0 && <span>{c.hashtags.length} hashtags</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Publish History */}
      <div>
        <h3 className="text-sm font-semibold text-gray-600 mb-3">Lich su dang ({history.length})</h3>
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-[1fr_100px_80px_120px] gap-2 px-4 py-2.5 bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <div>Noi dung</div>
            <div>Target</div>
            <div>Status</div>
            <div>Thoi gian</div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader size={20} className="animate-spin text-purple-600" />
            </div>
          ) : history.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">Chua co bai dang</div>
          ) : (
            history.slice(0, 50).map(h => {
              const statusCfg = JOB_STATUS[h.status] || JOB_STATUS.pending
              return (
                <div key={h.id} className="grid grid-cols-[1fr_100px_80px_120px] gap-2 px-4 py-2.5 border-b border-gray-100 hover:bg-gray-50 transition-colors items-center text-sm">
                  <div className="min-w-0">
                    <p className="text-gray-600 truncate text-xs">{(h.final_caption || '').substring(0, 80) || '...'}</p>
                  </div>
                  <div className="text-xs text-gray-500 truncate">{h.target_name || h.target_type || '?'}</div>
                  <div>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
                      {statusCfg.label}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {h.published_at ? format(new Date(h.published_at), 'dd/MM HH:mm') : '--'}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
