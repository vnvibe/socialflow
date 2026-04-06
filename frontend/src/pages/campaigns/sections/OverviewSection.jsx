import { useQuery } from '@tanstack/react-query'
import { Users, Clock, CheckCircle, XCircle, UserPlus, TrendingUp, Loader, Wifi, WifiOff, Sparkles, AlertTriangle as AlertTri } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../../../lib/api'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'

function StatCard({ title, value, icon: Icon, color }) {
  const colorMap = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-green-600',
    yellow: 'bg-yellow-100 text-yellow-600',
    red: 'bg-red-100 text-red-500',
    purple: 'bg-purple-100 text-purple-600',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value ?? '-'}</p>
        </div>
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${colorMap[color] || colorMap.blue}`}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </div>
  )
}

function NickCard({ account }) {
  const avatar = account.avatar_url || (account.fb_user_id ? `https://graph.facebook.com/${account.fb_user_id}/picture?type=large` : null)
  const alive = account.status === 'alive'

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:bg-gray-50 transition-all">
      <div className="flex items-start gap-3 mb-3">
        <div className="relative shrink-0">
          {avatar ? (
            <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover border border-gray-200"
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }} />
          ) : null}
          <div className={`w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 items-center justify-center text-gray-900 font-bold ${avatar ? 'hidden' : 'flex'}`}>
            {(account.username || '?')[0].toUpperCase()}
          </div>
          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${alive ? 'bg-green-500' : 'bg-gray-500'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900 truncate">{account.username}</p>
          <p className="text-xs text-gray-500 truncate">{account.role_name || 'Chua gan role'}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex-1 bg-blue-50 rounded-lg py-1.5 text-center">
          <p className="text-sm font-bold text-blue-700">{account.total_routines || 0}</p>
          <p className="text-[9px] font-semibold text-blue-600 uppercase">Routines</p>
        </div>
        <div className="flex-1 bg-green-50 rounded-lg py-1.5 text-center">
          <p className="text-sm font-bold text-green-700">{account.active_routines || 0}</p>
          <p className="text-[9px] font-semibold text-green-600 uppercase">Active</p>
        </div>
      </div>
    </div>
  )
}

const CONFIDENCE_BADGE = {
  high:   { label: 'Cao', color: 'bg-green-100 text-green-700' },
  medium: { label: 'Trung bình', color: 'bg-yellow-100 text-yellow-700' },
  low:    { label: 'Thấp', color: 'bg-gray-100 text-gray-500' },
}

function PostStrategyWidget({ strategy }) {
  if (!strategy) return null

  // Empty state
  if (!strategy.has_data) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={16} className="text-purple-500" />
          <h3 className="text-sm font-semibold text-gray-900">Chiến lược đăng bài</h3>
        </div>
        <p className="text-xs text-gray-400">{strategy.message || `Cần ít nhất ${strategy.min_posts || 5} bài đã đăng để AI phân tích chiến lược`}</p>
      </div>
    )
  }

  const ai = strategy.ai_strategy
  const conf = ai?.confidence ? (CONFIDENCE_BADGE[ai.confidence] || CONFIDENCE_BADGE.low) : null

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-purple-500" />
          <h3 className="text-sm font-semibold text-gray-900">Chiến lược đăng bài</h3>
          {conf && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${conf.color}`}>
              Độ tin cậy: {conf.label}
            </span>
          )}
        </div>
        {strategy.strategy_updated_at && (
          <span className="text-[10px] text-gray-400">
            Cập nhật {formatDistanceToNow(new Date(strategy.strategy_updated_at), { locale: vi, addSuffix: true })}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Best Hours — mini bar chart */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Giờ tốt nhất ({strategy.total_posts} bài/30 ngày)</p>
          <div className="flex items-end gap-0.5 h-12">
            {Array.from({ length: 24 }, (_, h) => {
              const hourData = (strategy.hour_stats || []).find(s => s.hour === h)
              const engagement = hourData ? (hourData.avg_reactions + hourData.avg_comments) : 0
              const maxEng = Math.max(1, ...(strategy.hour_stats || []).map(s => s.avg_reactions + s.avg_comments))
              const pct = Math.max(2, (engagement / maxEng) * 100)
              const isRecommended = (strategy.best_hours || []).includes(h)
              return (
                <div
                  key={h}
                  className={`flex-1 rounded-t transition-all ${isRecommended ? 'bg-purple-500' : engagement > 0 ? 'bg-gray-200' : 'bg-gray-100'}`}
                  style={{ height: `${pct}%` }}
                  title={`${h}h: ${hourData?.avg_reactions || 0} reactions, ${hourData?.avg_comments || 0} comments (${hourData?.post_count || 0} posts)`}
                />
              )
            })}
          </div>
          <div className="flex justify-between text-[9px] text-gray-400 mt-0.5">
            <span>0h</span><span>6h</span><span>12h</span><span>18h</span><span>23h</span>
          </div>
          {strategy.best_hours?.length > 0 && (
            <p className="text-[10px] text-purple-600 mt-1">
              Khuyên: {strategy.best_hours.map(h => `${h}h`).join(', ')}
              {strategy.best_days?.length > 0 && ` · Ngày tốt: ${strategy.best_days.join(', ')}`}
            </p>
          )}
        </div>

        {/* Best & Avoid Groups */}
        <div>
          <p className="text-xs font-medium text-gray-500 mb-2">Nhóm hiệu quả</p>
          {(strategy.group_stats || []).length === 0 ? (
            <p className="text-[10px] text-gray-400">Chưa đủ dữ liệu per-group</p>
          ) : (
            <div className="space-y-1.5">
              {strategy.group_stats.slice(0, 3).map((g, i) => (
                <div key={g.group_id || i} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-gray-400 w-3">{i + 1}</span>
                  <span className="text-xs text-gray-900 truncate flex-1">{g.group_name}</span>
                  <span className="text-[10px] text-green-600">{g.avg_reactions} ❤️ {g.avg_comments} 💬</span>
                </div>
              ))}
              {/* Avoid groups from AI */}
              {ai?.avoid_groups?.length > 0 && (
                <div className="mt-1 pt-1 border-t border-gray-100">
                  <p className="text-[10px] text-red-400 font-medium">Nên tránh:</p>
                  {ai.avoid_groups.map((gId, i) => (
                    <span key={i} className="text-[10px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded mr-1">{gId.slice(0, 12)}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* AI Content Suggestion */}
      {ai?.content_suggestion && (
        <div className="mt-3 bg-purple-50 rounded-lg px-3 py-2">
          <p className="text-[10px] font-medium text-purple-700 mb-0.5">💡 Gợi ý nội dung</p>
          <p className="text-xs text-purple-900">{ai.content_suggestion}</p>
        </div>
      )}
    </div>
  )
}

export default function OverviewSection({ campaignId, campaign, accountIds }) {
  const { data: stats } = useQuery({
    queryKey: ['campaign-stats', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/stats`).then(r => r.data),
    refetchInterval: 10000,
  })

  const { data: report } = useQuery({
    queryKey: ['campaign-report', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/report`).then(r => r.data),
  })

  // Build nick cards from campaign roles + accounts
  const { data: accountsData } = useQuery({
    queryKey: ['campaign-accounts', campaignId],
    queryFn: async () => {
      if (!accountIds.length) return []
      const { data } = await api.get('/accounts')
      const allAccounts = data || []
      return allAccounts.filter(a => accountIds.includes(a.id)).map(a => {
        const roles = (campaign.campaign_roles || []).filter(r => (r.account_ids || []).includes(a.id))
        return {
          ...a,
          role_name: roles.map(r => r.name).join(', ') || null,
          total_routines: roles.length,
          active_routines: roles.filter(r => r.is_active).length,
        }
      })
    },
    enabled: accountIds.length > 0,
  })

  // Post strategy data
  const { data: strategy } = useQuery({
    queryKey: ['post-strategy', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/post-strategy`).then(r => r.data),
  })

  const accounts = accountsData || []
  const isRunning = campaign.status === 'running' || campaign.is_active
  const daily = report?.daily || []

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Queue Pending" value={stats?.pending ?? '-'} icon={Clock} color="yellow" />
        <StatCard title="Queue Done" value={stats?.done ?? '-'} icon={CheckCircle} color="green" />
        <StatCard title="Friends Sent" value={stats?.friends_sent ?? '-'} icon={UserPlus} color="blue" />
        <StatCard title="Jobs Failed" value={stats?.failed ?? '-'} icon={XCircle} color="red" />
      </div>

      {/* Campaign Info */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-gray-500 text-xs">Trang thai</p>
            <div className="flex items-center gap-2 mt-1">
              {isRunning ? <Wifi size={14} className="text-green-600" /> : <WifiOff size={14} className="text-gray-500" />}
              <span className="font-semibold text-gray-900">{isRunning ? 'Dang chay' : 'Tam dung'}</span>
            </div>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Tong so lan chay</p>
            <p className="font-semibold mt-1 text-gray-900">{campaign.total_runs || 0}</p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Lan chay cuoi</p>
            <p className="font-semibold mt-1 text-gray-900">
              {campaign.last_run_at ? formatDistanceToNow(new Date(campaign.last_run_at), { addSuffix: true, locale: vi }) : '--'}
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Nicks / Roles</p>
            <p className="font-semibold mt-1 text-gray-900">{accountIds.length} nicks / {campaign.campaign_roles?.length || 0} roles</p>
          </div>
        </div>
      </div>

      {/* Daily Activity Chart */}
      {daily.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Hoat dong 14 ngay</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }} />
              <Bar dataKey="jobs_done" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Done" />
              <Bar dataKey="jobs_failed" fill="#ef4444" radius={[4, 4, 0, 0]} name="Failed" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Post Strategy Widget */}
      <PostStrategyWidget strategy={strategy} />

      {/* Nick Cards */}
      {accounts.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Nhan vat ({accounts.length})</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {accounts.map(acc => (
              <NickCard key={acc.id} account={acc} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
