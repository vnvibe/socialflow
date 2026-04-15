/**
 * JobRow — single row in a live job feed.
 * handler | account | status dot | duration | result preview
 */
import AgentStatusDot from './AgentStatusDot'

const STATUS_COLORS = {
  pending:   'text-app-muted',
  claimed:   'text-info',
  running:   'text-info',
  done:      'text-hermes',
  failed:    'text-danger',
  cancelled: 'text-app-muted',
}

const STATUS_DOT = {
  pending:   'idle',
  claimed:   'busy',
  running:   'busy',
  done:      'online',
  failed:    'error',
  cancelled: 'offline',
}

function formatAgo(ts) {
  if (!ts) return '—'
  const sec = Math.round((Date.now() - new Date(ts).getTime()) / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86400) return `${Math.round(sec / 3600)}h`
  return `${Math.round(sec / 86400)}d`
}

function formatDuration(job) {
  if (job.finished_at && job.started_at) {
    const ms = new Date(job.finished_at) - new Date(job.started_at)
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.round(ms / 60000)}m`
  }
  if (job.started_at) {
    return formatAgo(job.started_at)
  }
  return '—'
}

// Extract the most relevant URL from a job's result payload
function extractResultUrl(job) {
  const r = job.result
  if (!r || typeof r !== 'object') return null
  return r.post_url || r.group_url || r.profile_url || r.url || null
}

function extractResultPreview(job) {
  const r = job.result
  if (!r || typeof r !== 'object') return null
  const text = r.comment_text || r.caption || r.reply || r.comment || null
  if (!text || typeof text !== 'string') return null
  return text.substring(0, 60) + (text.length > 60 ? '...' : '')
}

export default function JobRow({ job, onClick }) {
  const status = job.status || 'pending'
  const handler = job.payload?.action || job.type || '?'
  const accountId = job.payload?.account_id
  const accTag = accountId ? accountId.slice(0, 8) : '—'
  const resultUrl = extractResultUrl(job)
  const preview = extractResultPreview(job)

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-3 px-3 py-2 font-mono-ui text-xs hover-row cursor-pointer"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <AgentStatusDot status={STATUS_DOT[status] || 'offline'} pulse={status === 'running'} />
      <span className="flex-1 truncate text-app-primary">
        {handler}
        {preview && (
          <span className="text-app-muted ml-2 font-normal">"{preview}"</span>
        )}
      </span>
      <span className="text-app-muted w-20 truncate">{accTag}</span>
      <span className={`w-16 text-right ${STATUS_COLORS[status]}`}>{status}</span>
      <span className="w-12 text-right text-app-muted">{formatDuration(job)}</span>
      <span className="w-10 text-right text-app-dim">{formatAgo(job.created_at)}</span>
      {resultUrl ? (
        <a
          href={resultUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="text-info hover:text-hermes text-[10px] whitespace-nowrap"
          title={resultUrl}
        >
          Xem ↗
        </a>
      ) : (
        <span className="w-10" />
      )}
    </div>
  )
}
