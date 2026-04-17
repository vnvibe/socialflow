import { useQuery } from '@tanstack/react-query'
import { Users, Clock, CheckCircle, XCircle, UserPlus, TrendingUp, Loader, Wifi, WifiOff, Sparkles, AlertTriangle as AlertTri } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../../../lib/api'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'

function StatCard({ title, value, icon: Icon, color }) {
  const colorMap = {
    blue: 'bg-blue-100 text-blue-600',
    green: 'bg-green-100 text-hermes',
    yellow: 'bg-yellow-100 text-yellow-600',
    red: 'bg-red-100 text-red-500',
    purple: 'bg-purple-100 text-purple-600',
  }
  return (
    <div className="bg-app-surface rounded border border-app-border p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-app-muted uppercase tracking-wider">{title}</p>
          <p className="text-2xl font-bold text-app-primary mt-1">{value ?? '-'}</p>
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
    <div className="bg-app-surface rounded border border-app-border p-4 hover:bg-app-base transition-all">
      <div className="flex items-start gap-3 mb-3">
        <div className="relative shrink-0">
          {avatar ? (
            <img src={avatar} alt="" className="w-10 h-10 rounded-full object-cover border border-app-border"
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }} />
          ) : null}
          <div className={`w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 items-center justify-center text-app-primary font-bold ${avatar ? 'hidden' : 'flex'}`}>
            {(account.username || '?')[0].toUpperCase()}
          </div>
          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${alive ? 'bg-hermes' : 'bg-app-muted'}`} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-app-primary truncate">{account.username}</p>
          <p className="text-xs text-app-muted truncate">{account.role_name || 'Chua gan role'}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <div className="flex-1 bg-blue-50 rounded-lg py-1.5 text-center">
          <p className="text-sm font-bold text-blue-700">{account.total_routines || 0}</p>
          <p className="text-[9px] font-semibold text-blue-600 uppercase">Routines</p>
        </div>
        <div className="flex-1 bg-green-50 rounded-lg py-1.5 text-center">
          <p className="text-sm font-bold text-hermes">{account.active_routines || 0}</p>
          <p className="text-[9px] font-semibold text-hermes uppercase">Active</p>
        </div>
      </div>
    </div>
  )
}

const CONFIDENCE_BADGE = {
  high:   { label: 'Cao', color: 'bg-green-100 text-hermes' },
  medium: { label: 'Trung bình', color: 'bg-yellow-100 text-yellow-700' },
  low:    { label: 'Thấp', color: 'bg-app-elevated text-app-muted' },
}

function PostStrategyWidget({ strategy }) {
  if (!strategy) return null

  // Empty state
  if (!strategy.has_data) {
    return (
      <div className="bg-app-surface rounded border border-app-border p-5">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles size={16} className="text-purple-500" />
          <h3 className="text-sm font-semibold text-app-primary">Chiến lược đăng bài</h3>
        </div>
        <p className="text-xs text-app-dim">{strategy.message || `Cần ít nhất ${strategy.min_posts || 5} bài đã đăng để AI phân tích chiến lược`}</p>
      </div>
    )
  }

  const ai = strategy.ai_strategy
  const conf = ai?.confidence ? (CONFIDENCE_BADGE[ai.confidence] || CONFIDENCE_BADGE.low) : null

  return (
    <div className="bg-app-surface rounded border border-app-border p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Sparkles size={16} className="text-purple-500" />
          <h3 className="text-sm font-semibold text-app-primary">Chiến lược đăng bài</h3>
          {conf && (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${conf.color}`}>
              Độ tin cậy: {conf.label}
            </span>
          )}
        </div>
        {strategy.strategy_updated_at && (
          <span className="text-[10px] text-app-dim">
            Cập nhật {formatDistanceToNow(new Date(strategy.strategy_updated_at), { locale: vi, addSuffix: true })}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Best Hours — mini bar chart */}
        <div>
          <p className="text-xs font-medium text-app-muted mb-2">Giờ tốt nhất ({strategy.total_posts} bài/30 ngày)</p>
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
                  className={`flex-1 rounded-t transition-all ${isRecommended ? 'bg-purple-500' : engagement > 0 ? 'bg-app-hover' : 'bg-app-elevated'}`}
                  style={{ height: `${pct}%` }}
                  title={`${h}h: ${hourData?.avg_reactions || 0} reactions, ${hourData?.avg_comments || 0} comments (${hourData?.post_count || 0} posts)`}
                />
              )
            })}
          </div>
          <div className="flex justify-between text-[9px] text-app-dim mt-0.5">
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
          <p className="text-xs font-medium text-app-muted mb-2">Nhóm hiệu quả</p>
          {(strategy.group_stats || []).length === 0 ? (
            <p className="text-[10px] text-app-dim">Chưa đủ dữ liệu per-group</p>
          ) : (
            <div className="space-y-1.5">
              {strategy.group_stats.slice(0, 3).map((g, i) => (
                <div key={g.group_id || i} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-app-dim w-3">{i + 1}</span>
                  <span className="text-xs text-app-primary truncate flex-1">{g.group_name}</span>
                  <span className="text-[10px] text-hermes">{g.avg_reactions} ❤️ {g.avg_comments} 💬</span>
                </div>
              ))}
              {/* Avoid groups from AI */}
              {ai?.avoid_groups?.length > 0 && (
                <div className="mt-1 pt-1 border-t border-app-border">
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

  // Phase 11: KPI today
  const { data: kpiToday } = useQuery({
    queryKey: ['campaign-kpi-today', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/kpi-today`).then(r => r.data),
    refetchInterval: 30000,
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

  // Phase 17: latest ops_monitor for status widget
  const { data: lastOpsMonitor } = useQuery({
    queryKey: ['last-ops-monitor', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/activity-log`, {
      params: { action_type: 'ops_monitor', limit: 1 },
    }).then(r => {
      const rows = r.data?.data || (Array.isArray(r.data) ? r.data : [])
      return rows[0] || null
    }),
    refetchInterval: 60000,
  })

  // Phase 17: latest daily_plan for today_focus
  const { data: lastDailyPlan } = useQuery({
    queryKey: ['last-daily-plan', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/activity-log`, {
      params: { action_type: 'daily_plan', limit: 1 },
    }).then(r => {
      const rows = r.data?.data || (Array.isArray(r.data) ? r.data : [])
      return rows[0] || null
    }),
  })

  // Post strategy data
  const { data: strategy } = useQuery({
    queryKey: ['post-strategy', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/post-strategy`).then(r => r.data),
  })

  const accounts = accountsData || []
  const isRunning = campaign.status === 'running' || campaign.is_active
  const daily = report?.activity_daily || report?.daily || []

  return (
    <div className="space-y-6">
      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Queue Pending" value={stats?.queue?.pending ?? '-'} icon={Clock} color="yellow" />
        <StatCard title="Jobs Done" value={stats?.jobs?.done ?? '-'} icon={CheckCircle} color="green" />
        <StatCard title="Friends Sent" value={stats?.friends?.sent ?? '-'} icon={UserPlus} color="blue" />
        <StatCard title="Jobs Failed" value={stats?.jobs?.failed ?? '-'} icon={XCircle} color="red" />
      </div>

      {/* Campaign Info */}
      <div className="bg-app-surface rounded border border-app-border p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-app-muted text-xs">Trang thai</p>
            <div className="flex items-center gap-2 mt-1">
              {isRunning ? <Wifi size={14} className="text-hermes" /> : <WifiOff size={14} className="text-app-muted" />}
              <span className="font-semibold text-app-primary">{isRunning ? 'Dang chay' : 'Tam dung'}</span>
            </div>
          </div>
          <div>
            <p className="text-app-muted text-xs">Tong so lan chay</p>
            <p className="font-semibold mt-1 text-app-primary">{campaign.total_runs || 0}</p>
          </div>
          <div>
            <p className="text-app-muted text-xs">Lan chay cuoi</p>
            <p className="font-semibold mt-1 text-app-primary">
              {campaign.last_run_at ? formatDistanceToNow(new Date(campaign.last_run_at), { addSuffix: true, locale: vi }) : '--'}
            </p>
          </div>
          <div>
            <p className="text-app-muted text-xs">Nicks / Roles</p>
            <p className="font-semibold mt-1 text-app-primary">{accountIds.length} nicks / {campaign.campaign_roles?.length || 0} roles</p>
          </div>
        </div>
      </div>

      {/* Daily Activity Chart — from activity_log (likes/comments/joins) */}
      {daily.length > 0 && (
        <div className="bg-app-surface rounded border border-app-border p-5">
          <h3 className="text-sm font-semibold text-app-primary mb-4">Hoạt động 14 ngày</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }} />
              <Bar dataKey="likes" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Likes" stackId="a" />
              <Bar dataKey="comments" fill="#22c55e" radius={[4, 4, 0, 0]} name="Comments" stackId="a" />
              <Bar dataKey="joins" fill="#a855f7" radius={[4, 4, 0, 0]} name="Joins" stackId="a" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Phase 17: Ops Status widget */}
      {(lastOpsMonitor || lastDailyPlan) && (
        <div className="bg-app-surface rounded border border-app-border p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-app-primary flex items-center gap-2">
              <span>🤖</span> AI Ops
            </h3>
            {lastOpsMonitor && (
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                lastOpsMonitor.result_status === 'critical' ? 'bg-red-100 text-red-700' :
                lastOpsMonitor.result_status === 'warning' ? 'bg-yellow-100 text-yellow-700' :
                'bg-green-100 text-hermes'
              }`}>
                {lastOpsMonitor.result_status === 'critical' ? '🚨 Critical' :
                 lastOpsMonitor.result_status === 'warning' ? '⚠️ Warning' : '✅ Good'}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            {lastOpsMonitor?.details?.analysis?.headline && (
              <div className="col-span-1 sm:col-span-2">
                <p className="text-app-muted text-[10px]">Last monitor</p>
                <p className="text-app-primary font-medium">{lastOpsMonitor.details.analysis.headline}</p>
                <p className="text-[10px] text-app-dim mt-0.5">
                  {lastOpsMonitor.created_at ? formatDistanceToNow(new Date(lastOpsMonitor.created_at), { locale: vi, addSuffix: true }) : ''}
                </p>
              </div>
            )}
            {lastDailyPlan?.details?.plan?.today_focus && (
              <div>
                <p className="text-app-muted text-[10px]">Today focus</p>
                <p className="text-blue-700 font-medium">{lastDailyPlan.details.plan.today_focus}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Phase 11: KPI Today */}
      {kpiToday?.rows?.length > 0 && (
        <div className="bg-app-surface rounded border border-app-border p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-app-primary">KPI hôm nay</h3>
            <span className="text-[11px] text-app-muted">
              Like {kpiToday.kpi_config?.daily_likes || 0} · Cmt {kpiToday.kpi_config?.daily_comments || 0} ·
              FR {kpiToday.kpi_config?.daily_friend_requests || 0} · Join {kpiToday.kpi_config?.daily_group_joins || 0}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-app-muted">
                <tr className="border-b border-app-border">
                  <th className="text-left px-2 py-1.5 font-medium">Nick</th>
                  <th className="text-center px-2 py-1.5 font-medium">Like</th>
                  <th className="text-center px-2 py-1.5 font-medium">Cmt</th>
                  <th className="text-center px-2 py-1.5 font-medium">FR</th>
                  <th className="text-center px-2 py-1.5 font-medium">Join</th>
                  <th className="text-left px-2 py-1.5 font-medium w-32">Tổng</th>
                  <th className="text-center px-2 py-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {kpiToday.rows.map(r => {
                  const cell = (done, tgt) => (
                    <span className={tgt > 0 && done >= tgt ? 'text-hermes font-semibold' : 'text-app-primary'}>
                      {done}/{tgt}
                    </span>
                  )
                  return (
                    <tr key={r.id} className="border-b border-gray-50">
                      <td className="px-2 py-1.5 text-app-primary">{r.username}</td>
                      <td className="text-center px-2 py-1.5">{cell(r.done_likes, r.target_likes)}</td>
                      <td className="text-center px-2 py-1.5">{cell(r.done_comments, r.target_comments)}</td>
                      <td className="text-center px-2 py-1.5">{cell(r.done_friend_requests, r.target_friend_requests)}</td>
                      <td className="text-center px-2 py-1.5">{cell(r.done_group_joins, r.target_group_joins)}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 bg-app-elevated rounded-full overflow-hidden">
                            <div
                              className={`h-full ${r.kpi_met ? 'bg-hermes' : 'bg-info'} transition-all`}
                              style={{ width: `${Math.min(100, r.progress_pct)}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-app-muted w-8 text-right">{r.progress_pct}%</span>
                        </div>
                      </td>
                      <td className="text-center px-2 py-1.5">
                        {r.kpi_met
                          ? <span className="text-[10px] text-hermes font-semibold">✓ Met</span>
                          : r.total_done > 0
                            ? <span className="text-[10px] text-blue-600">In progress</span>
                            : <span className="text-[10px] text-app-dim">Chưa</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Post Strategy Widget */}
      <PostStrategyWidget strategy={strategy} />

      {/* Nick Cards */}
      {accounts.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-app-primary mb-3">Nhan vat ({accounts.length})</h3>
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
