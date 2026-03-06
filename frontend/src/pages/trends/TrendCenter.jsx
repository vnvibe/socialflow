import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { RefreshCw, TrendingUp, ExternalLink, Play, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const regions = [
  { value: 'VN', label: 'Vietnam' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'JP', label: 'Japan' },
  { value: 'KR', label: 'South Korea' },
  { value: 'TH', label: 'Thailand' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'PH', label: 'Philippines' }
]

const sourceBadge = {
  youtube: { label: 'YouTube', cls: 'bg-red-100 text-red-700' },
  reddit: { label: 'Reddit', cls: 'bg-orange-100 text-orange-700' },
  tiktok: { label: 'TikTok', cls: 'bg-gray-800 text-white' },
  google: { label: 'Google', cls: 'bg-blue-100 text-blue-700' },
  twitter: { label: 'Twitter', cls: 'bg-sky-100 text-sky-700' }
}

export default function TrendCenter() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [region, setRegion] = useState('VN')

  const { data: trends = [], isLoading } = useQuery({
    queryKey: ['trends', region],
    queryFn: () => api.get(`/trends?region=${region}`).then(r => r.data)
  })

  const refreshMutation = useMutation({
    mutationFn: () => api.post('/trends/refresh', { region }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trends', region] })
      toast.success('Trends refreshed')
    },
    onError: () => toast.error('Failed to refresh')
  })

  const maxScore = Math.max(...trends.map(t => t.score || 0), 1)

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Trend Center</h1>
        <div className="flex items-center gap-3">
          <select
            value={region}
            onChange={e => setRegion(e.target.value)}
            className="border rounded-lg px-3 py-2 text-sm"
          >
            {regions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <button
            onClick={() => refreshMutation.mutate()}
            disabled={refreshMutation.isPending}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            <RefreshCw size={16} className={refreshMutation.isPending ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>
      ) : trends.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <TrendingUp size={48} className="mx-auto mb-3 text-gray-300" />
          <p>No trends found for this region</p>
          <button onClick={() => refreshMutation.mutate()} className="text-blue-600 hover:underline text-sm mt-2">Refresh trends</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trends.map((trend, idx) => (
            <div key={trend.id || idx} className="bg-white rounded-xl shadow overflow-hidden hover:shadow-md transition-shadow">
              {/* Thumbnail */}
              {trend.thumbnail && (
                <div className="relative aspect-video bg-gray-100">
                  <img src={trend.thumbnail} alt="" className="w-full h-full object-cover" />
                  {trend.view_count && (
                    <span className="absolute bottom-2 right-2 flex items-center gap-1 text-xs bg-black/70 text-white px-2 py-0.5 rounded">
                      <Eye size={10} /> {trend.view_count.toLocaleString()}
                    </span>
                  )}
                </div>
              )}

              <div className="p-4">
                {/* Keyword / Title */}
                <h3 className="font-semibold text-gray-900 line-clamp-2">{trend.keyword || trend.title}</h3>

                {/* Score bar */}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <span>Score</span>
                    <span className="font-mono">{trend.score?.toLocaleString()}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all"
                      style={{ width: `${Math.max((trend.score / maxScore) * 100, 5)}%` }}
                    />
                  </div>
                </div>

                {/* Sources */}
                {trend.sources?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {trend.sources.map((src, i) => {
                      const badge = sourceBadge[src] || { label: src, cls: 'bg-gray-100 text-gray-600' }
                      return (
                        <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                      )
                    })}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t">
                  <button
                    onClick={() => navigate(`/content/new?topic=${encodeURIComponent(trend.keyword || trend.title)}`)}
                    className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    <Play size={14} /> Create Content
                  </button>
                  {trend.url && (
                    <a href={trend.url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600">
                      <ExternalLink size={14} />
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
