import { Link } from 'react-router-dom'
import { Monitor, Clock } from 'lucide-react'
import HealthBadge from './HealthBadge'
import ProxyBadge from '../shared/ProxyBadge'

function formatDate(dateStr) {
  if (!dateStr) return 'Never'
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AccountCard({ account }) {
  const {
    id,
    username,
    fb_user_id,
    status,
    browser_type,
    proxy,
    posts_today,
    max_daily_posts,
    last_used_at,
  } = account

  return (
    <Link
      to={`/accounts/${id}`}
      className="block bg-app-surface rounded border border-app-border p-5 hover: transition-shadow"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-app-primary">{username}</h3>
          <p className="text-xs text-app-muted mt-0.5">ID: {fb_user_id}</p>
        </div>
        <HealthBadge status={status} />
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-app-muted">
          <Monitor className="w-4 h-4 text-app-dim" />
          <span>{browser_type || 'N/A'}</span>
        </div>

        <div className="flex items-center gap-2">
          <ProxyBadge proxy={proxy} />
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-app-border">
          <span className="text-xs text-app-muted">
            Posts: {posts_today ?? 0}/{max_daily_posts ?? '?'}
          </span>
          <span className="flex items-center gap-1 text-xs text-app-dim">
            <Clock className="w-3 h-3" />
            {formatDate(last_used_at)}
          </span>
        </div>
      </div>
    </Link>
  )
}
