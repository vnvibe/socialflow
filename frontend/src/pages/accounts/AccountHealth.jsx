import { useQuery } from '@tanstack/react-query'
import { Activity, Shield, AlertTriangle, Clock, Wifi } from 'lucide-react'
import api from '../../lib/api'

const STATUS_CONFIG = {
  healthy:    { label: 'Khoe', color: 'bg-green-100 text-green-700' },
  checkpoint: { label: 'Checkpoint', color: 'bg-red-100 text-red-700' },
  expired:    { label: 'Het han', color: 'bg-orange-100 text-orange-700' },
  disabled:   { label: 'Tat', color: 'bg-gray-100 text-gray-500' },
  unknown:    { label: 'Chua kiem', color: 'bg-gray-100 text-gray-400' },
}

function BudgetBar({ label, used, max }) {
  if (!max) return null
  const pct = Math.min((used / max) * 100, 100)
  const color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-green-500'
  return (
    <div className="flex items-center gap-2" title={`${label}: ${used}/${max}`}>
      <span className="text-[10px] text-gray-400 w-8">{label}</span>
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-[10px] text-gray-500 w-10 text-right">{used}/{max}</span>
    </div>
  )
}

export default function AccountHealth() {
  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['account-health'],
    queryFn: () => api.get('/accounts/health-summary').then(r => r.data),
    refetchInterval: 30000,
  })

  if (isLoading) return <div className="text-center py-8 text-gray-500">Dang tai...</div>

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Activity size={24} className="text-blue-600" />
        <h1 className="text-2xl font-bold text-gray-900">Suc khoe Nick</h1>
      </div>

      {accounts.length === 0 ? (
        <div className="text-center py-12 text-gray-400">Khong co nick nao</div>
      ) : (
        <div className="grid gap-4">
          {accounts.map(a => {
            const status = STATUS_CONFIG[a.status] || STATUS_CONFIG.unknown
            const budget = a.daily_budget || {}
            const hasIssue = a.failure_count_24h > 0 || a.status === 'checkpoint' || a.status === 'expired'

            return (
              <div key={a.id} className={`bg-white rounded-xl border p-4 ${hasIssue ? 'border-red-200' : 'border-gray-200'}`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${status.color}`}>
                      {(a.username || '?')[0].toUpperCase()}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-gray-900">{a.username || a.fb_user_id}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${status.color}`}>
                          {status.label}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-gray-400 mt-0.5">
                        <span>{a.nick_age_days || 0} ngay tuoi</span>
                        {a.proxy_label && (
                          <span className="flex items-center gap-0.5"><Wifi size={8} /> {a.proxy_label}</span>
                        )}
                        {a.proxy_country && <span>{a.proxy_country}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs">
                    {a.failure_count_24h > 0 && (
                      <div className="flex items-center gap-1 text-red-500">
                        <AlertTriangle size={12} />
                        <span>{a.failure_count_24h} loi/24h</span>
                      </div>
                    )}
                    {a.last_error_type && (
                      <span className="text-[10px] text-red-400">{a.last_error_type}</span>
                    )}
                    <div className="text-gray-400">
                      <span>{a.posts_today || 0}/{a.max_daily_posts || 10} bai</span>
                    </div>
                  </div>
                </div>

                {/* Budget bars */}
                {Object.keys(budget).length > 1 && (
                  <div className="mt-3 grid grid-cols-3 gap-x-4 gap-y-1.5">
                    {budget.like && <BudgetBar label="Like" used={budget.like.used || 0} max={budget.like.max || 80} />}
                    {budget.comment && <BudgetBar label="Cmt" used={budget.comment.used || 0} max={budget.comment.max || 25} />}
                    {budget.friend_request && <BudgetBar label="FR" used={budget.friend_request.used || 0} max={budget.friend_request.max || 15} />}
                    {budget.join_group && <BudgetBar label="Join" used={budget.join_group.used || 0} max={budget.join_group.max || 3} />}
                    {budget.post && <BudgetBar label="Post" used={budget.post.used || 0} max={budget.post.max || 5} />}
                    {budget.scan && <BudgetBar label="Scan" used={budget.scan.used || 0} max={budget.scan.max || 10} />}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
