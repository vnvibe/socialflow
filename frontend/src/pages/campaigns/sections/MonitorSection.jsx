import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Eye, ScrollText, MessageCircle, Clock, CheckCircle, XCircle,
  Loader, RefreshCw, ThumbsUp, UserPlus, Users, Search,
  ExternalLink, AlertTriangle, Bot, Filter, Brain, ChevronDown, ChevronUp,
} from 'lucide-react'
import api from '../../../lib/api'
import { format, formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'

const ACTION_ICONS = {
  like: ThumbsUp, comment: MessageCircle, visit_group: Eye,
  join_group: Users, friend_request: UserPlus, send_friend_request: UserPlus,
  browse: Eye, ai_filter: Bot, ai_evaluate_posts: Bot,
  comment_rejected: XCircle, scan_members: Search, post: ScrollText,
}

const ACTION_LABELS = {
  like: 'Like', comment: 'Comment', visit_group: 'Vao nhom',
  join_group: 'Tham gia nhom', friend_request: 'Ket ban',
  send_friend_request: 'Gui ket ban', browse: 'Luot web',
  ai_filter: 'AI Filter', ai_evaluate_posts: 'AI Danh gia',
  comment_rejected: 'Comment bi tu choi', scan_members: 'Scan thanh vien',
  post: 'Dang bai',
}

const STATUS_COLORS = {
  success: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle },
  failed: { bg: 'bg-red-100', text: 'text-red-700', icon: XCircle },
  skipped: { bg: 'bg-yellow-100', text: 'text-yellow-700', icon: AlertTriangle },
  done: { bg: 'bg-green-100', text: 'text-green-700', icon: CheckCircle },
}

const JOB_STATUS = {
  running: { color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  done: { color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  failed: { color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  pending: { color: 'bg-yellow-100 text-yellow-700', dot: 'bg-yellow-500' },
  cancelled: { color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
}

const SUB_TABS = [
  { key: 'details', label: 'Nhật ký chi tiết', icon: ScrollText },
  { key: 'jobs', label: 'Jobs', icon: Clock },
  { key: 'engagement', label: 'Tương tác', icon: MessageCircle },
  { key: 'ai_pilot', label: 'AI Pilot', icon: Brain },
]

const AI_ASSESSMENT = {
  good:    { label: 'Tốt', color: 'bg-green-100 text-green-700' },
  warning: { label: 'Cảnh báo', color: 'bg-yellow-100 text-yellow-700' },
  critical:{ label: 'Nghiêm trọng', color: 'bg-red-100 text-red-700' },
}

const AI_ACTION_ICONS = {
  increase: '↑', decrease: '↓', pause: '⏸', resume: '▶',
  reduce: '↓', activate: '▶', maintain: '≡', skip: '≡',
}

export default function MonitorSection({ campaignId, campaign }) {
  const [subTab, setSubTab] = useState('details')
  const [actionFilter, setActionFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('today')
  const [detailPage, setDetailPage] = useState(1)
  const [refreshing, setRefreshing] = useState(false)

  // Build date range from filter
  const getDateRange = () => {
    const now = new Date()
    if (dateFilter === 'today') return { from: new Date(now.setHours(0,0,0,0)).toISOString() }
    if (dateFilter === '3days') return { from: new Date(Date.now() - 3 * 86400000).toISOString() }
    if (dateFilter === '7days') return { from: new Date(Date.now() - 7 * 86400000).toISOString() }
    if (dateFilter === '30days') return { from: new Date(Date.now() - 30 * 86400000).toISOString() }
    return {}
  }

  // Jobs list
  const { data: activityRes, isLoading: jobsLoading, refetch: refetchJobs } = useQuery({
    queryKey: ['campaign-activity', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/activity?limit=50`).then(r => r.data),
    refetchInterval: subTab === 'jobs' ? 5000 : false,
  })
  const jobs = Array.isArray(activityRes) ? activityRes : (activityRes?.data || [])
  const jobCounts = activityRes?.counts || {}

  // Detail activity log
  const dateRange = getDateRange()
  const { data: detailRes, isLoading: detailLoading, refetch: refetchDetail } = useQuery({
    queryKey: ['campaign-detail-log', campaignId, detailPage, actionFilter, statusFilter, dateFilter],
    queryFn: () => api.get(`/campaigns/${campaignId}/activity-log`, {
      params: {
        page: detailPage, limit: 30,
        ...(actionFilter && { action_type: actionFilter }),
        ...(statusFilter && { result_status: statusFilter }),
        ...(dateRange.from && { date_from: dateRange.from }),
      },
    }).then(r => r.data),
    enabled: subTab === 'details',
    refetchInterval: subTab === 'details' ? 10000 : false,
  })
  const detailLogs = Array.isArray(detailRes) ? detailRes : (detailRes?.data || [])
  const detailTotal = detailRes?.total || detailLogs.length
  const detailSummary = detailRes?.summary || {}
  const detailPages = detailRes?.totalPages || Math.ceil(detailTotal / 30)

  // Engagement data
  const { data: report } = useQuery({
    queryKey: ['campaign-report', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/report`).then(r => r.data),
    enabled: subTab === 'engagement',
  })

  // AI Pilot decisions
  const { data: aiPilotRes, isLoading: aiPilotLoading } = useQuery({
    queryKey: ['ai-pilot-decisions', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/activity-log`, {
      params: { action_type: 'ai_control', limit: 20 },
    }).then(r => r.data),
    enabled: subTab === 'ai_pilot',
    refetchInterval: 30000,
  })
  const aiPilotLogs = (aiPilotRes?.data || (Array.isArray(aiPilotRes) ? aiPilotRes : []))
  const [expandedPilot, setExpandedPilot] = useState(null)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">Theo doi & Nhat ky</h2>
        <button
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true)
            try { await Promise.all([refetchJobs(), refetchDetail()]) } finally { setRefreshing(false) }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Dang tai...' : 'Refresh'}
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              subTab === t.key ? 'bg-white text-gray-900 shadow-sm rounded-md' : 'text-gray-500 hover:text-gray-700 rounded-md transition-colors'
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* Date Filter */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {[
          { key: 'today', label: 'Hom nay' },
          { key: '3days', label: '3 ngay' },
          { key: '7days', label: '7 ngay' },
          { key: '30days', label: '30 ngay' },
          { key: 'all', label: 'Tat ca' },
        ].map(f => (
          <button key={f.key} onClick={() => { setDateFilter(f.key); setDetailPage(1) }}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              dateFilter === f.key ? 'bg-white text-gray-900 shadow-sm rounded-md' : 'text-gray-500 hover:text-gray-700 rounded-md transition-colors'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* ══════ DETAIL LOG TAB ══════ */}
      {subTab === 'details' && (
        <div className="space-y-3">
          {/* Action summary pills */}
          {Object.keys(detailSummary).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(detailSummary).map(([action, data]) => {
                const Icon = ACTION_ICONS[action] || Eye
                return (
                  <button
                    key={action}
                    onClick={() => { setActionFilter(actionFilter === action ? '' : action); setDetailPage(1) }}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      actionFilter === action
                        ? 'border-purple-200 bg-purple-100 text-purple-700'
                        : 'border-gray-200 bg-gray-100 text-gray-600 hover:bg-gray-100'
                    }`}
                  >
                    <Icon size={12} />
                    <span>{ACTION_LABELS[action] || action}</span>
                    <span className="text-green-600">{data.success || 0}</span>
                    {data.failed > 0 && <span className="text-red-500">{data.failed}</span>}
                    <span className="text-gray-500">({data.total})</span>
                  </button>
                )
              })}
            </div>
          )}

          {/* Filters */}
          <div className="flex gap-2">
            <select
              value={actionFilter}
              onChange={e => { setActionFilter(e.target.value); setDetailPage(1) }}
              className="border border-gray-300 rounded-lg bg-white text-gray-700"
            >
              <option value="">Tat ca action</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={e => { setStatusFilter(e.target.value); setDetailPage(1) }}
              className="border border-gray-300 rounded-lg bg-white text-gray-700"
            >
              <option value="">Tat ca status</option>
              <option value="success">Thanh cong</option>
              <option value="failed">That bai</option>
              <option value="skipped">Bo qua</option>
            </select>
            <div className="flex-1" />
            <span className="text-xs text-gray-500 self-center">{detailTotal} entries</span>
          </div>

          {/* Detail Log List — grouped by date */}
          <div className="space-y-3">
            {detailLoading ? (
              <div className="flex items-center justify-center py-12 bg-white rounded-xl border border-gray-200">
                <Loader size={20} className="animate-spin text-purple-600" />
              </div>
            ) : detailLogs.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm bg-white rounded-xl border border-gray-200">Chua co log</div>
            ) : (
              Object.entries(
                detailLogs.reduce((groups, log) => {
                  const d = log.created_at ? format(new Date(log.created_at), 'dd/MM/yyyy') : 'Khong ro'
                  ;(groups[d] = groups[d] || []).push(log)
                  return groups
                }, {})
              ).map(([dateKey, logs]) => {
                const today = format(new Date(), 'dd/MM/yyyy')
                const yesterday = format(new Date(Date.now() - 86400000), 'dd/MM/yyyy')
                const dateLabel = dateKey === today ? 'Hom nay' : dateKey === yesterday ? 'Hom qua' : dateKey

                return (
                  <div key={dateKey}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-xs font-semibold text-gray-500 uppercase">{dateLabel}</span>
                      <div className="flex-1 h-px bg-gray-200" />
                      <span className="text-xs text-gray-400">{logs.length} entries</span>
                    </div>
                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                      {logs.map((log, i) => {
                const ActionIcon = ACTION_ICONS[log.action_type] || Eye
                const statusCfg = STATUS_COLORS[log.result_status] || STATUS_COLORS.done
                const StatusIcon = statusCfg.icon

                return (
                  <div key={log.id || i} className="px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50">
                    {/* Row 1: Action + Status + Target + Account + Time */}
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${statusCfg.bg}`}>
                        <ActionIcon size={14} className={statusCfg.text} />
                      </div>
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span className="text-sm font-medium text-gray-900">
                          {ACTION_LABELS[log.action_type] || log.action_type}
                        </span>
                        <StatusIcon size={12} className={statusCfg.text} />
                        <span className="text-gray-500 mx-1">&rarr;</span>
                        {log.target_url ? (
                          <a href={log.target_url} target="_blank" rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline truncate">
                            {log.target_name || log.target_url}
                          </a>
                        ) : (
                          <span className="text-sm text-gray-600 truncate">{log.target_name || ''}</span>
                        )}
                      </div>
                      {log.account_name && (
                        <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full shrink-0">
                          {log.account_name}
                        </span>
                      )}
                      <span className="text-xs text-gray-500 shrink-0">
                        {log.created_at ? format(new Date(log.created_at), 'HH:mm:ss') : '--'}
                      </span>
                    </div>

                    {/* Row 2: Details (conditional) */}
                    {log.details && Object.keys(log.details).length > 0 && (
                      <div className="ml-9 mt-1.5 space-y-1">
                        {/* Comment text */}
                        {log.details.comment_text && (
                          <div className="flex items-start gap-1.5">
                            <MessageCircle size={11} className="text-gray-500 mt-0.5 shrink-0" />
                            <p className="text-xs text-gray-600">
                              "{log.details.comment_text}"
                              {log.details.ai_generated !== undefined && (
                                <span className={`ml-1.5 ${log.details.ai_generated ? 'text-purple-600' : 'text-gray-500'}`}>
                                  {log.details.ai_generated ? '🤖 AI' : '📝 Template'}
                                </span>
                              )}
                            </p>
                          </div>
                        )}

                        {/* Post URL */}
                        {log.details.post_url && (
                          <div className="flex items-center gap-1.5">
                            <ExternalLink size={11} className="text-gray-500 shrink-0" />
                            <a href={log.details.post_url} target="_blank" rel="noopener noreferrer"
                              className="text-xs text-blue-600 hover:underline truncate">
                              {log.details.post_url.replace('https://www.facebook.com/', '')}
                            </a>
                          </div>
                        )}

                        {/* Post author */}
                        {log.details.post_author && (
                          <div className="flex items-center gap-1.5">
                            <Users size={11} className="text-gray-500 shrink-0" />
                            <span className="text-xs text-gray-500">Bai cua: {log.details.post_author}</span>
                          </div>
                        )}

                        {/* Engagement counts */}
                        {(log.details.reactions !== undefined || log.details.comments !== undefined) && (
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            {log.details.reactions !== undefined && (
                              <span>👍 {log.details.reactions}</span>
                            )}
                            {log.details.comments !== undefined && (
                              <span>💬 {log.details.comments}</span>
                            )}
                          </div>
                        )}

                        {/* AI evaluation details */}
                        {log.details.total_eligible !== undefined && (
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Bot size={11} className="text-gray-500 shrink-0" />
                            <span>
                              Eligible: {log.details.total_eligible} bai
                              {log.details.selected !== undefined && ` → Chon: ${log.details.selected}`}
                            </span>
                          </div>
                        )}

                        {/* AI filter details */}
                        {log.details.submitted !== undefined && (
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <Filter size={11} className="text-gray-500 shrink-0" />
                            <span>
                              {log.details.accepted}/{log.details.submitted} nhom phu hop
                              {log.details.method && ` (${log.details.method})`}
                            </span>
                          </div>
                        )}

                        {/* Reason */}
                        {log.details.reason && !log.details.comment_text && (
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle size={11} className="text-yellow-600 shrink-0" />
                            <span className="text-xs text-yellow-700">{log.details.reason}</span>
                          </div>
                        )}

                        {/* Error */}
                        {log.details.error && (
                          <div className="flex items-center gap-1.5">
                            <XCircle size={11} className="text-red-500 shrink-0" />
                            <span className="text-xs text-red-700">{log.details.error}</span>
                          </div>
                        )}

                        {/* Language/skip info */}
                        {log.details.lang && (
                          <span className="text-xs text-gray-500">Ngon ngu: {log.details.lang} | VN: {log.details.vi_posts}/{log.details.total_posts}</span>
                        )}
                      </div>
                    )}
                  </div>
                )
                      })}
                    </div>
                  </div>
                )
              })
            )}
          </div>

          {/* Pagination */}
          {detailPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Trang {detailPage}/{detailPages} ({detailTotal} entries)</span>
              <div className="flex gap-1">
                <button
                  disabled={detailPage <= 1}
                  onClick={() => setDetailPage(1)}
                  className="px-2 py-1 text-xs bg-gray-50 border border-gray-200 text-gray-600 rounded disabled:opacity-30"
                >
                  ««
                </button>
                <button
                  disabled={detailPage <= 1}
                  onClick={() => setDetailPage(p => p - 1)}
                  className="px-2 py-1 text-xs bg-gray-50 border border-gray-200 text-gray-600 rounded disabled:opacity-30"
                >
                  «
                </button>
                <button
                  disabled={detailPage >= detailPages}
                  onClick={() => setDetailPage(p => p + 1)}
                  className="px-2 py-1 text-xs bg-gray-50 border border-gray-200 text-gray-600 rounded disabled:opacity-30"
                >
                  »
                </button>
                <button
                  disabled={detailPage >= detailPages}
                  onClick={() => setDetailPage(detailPages)}
                  className="px-2 py-1 text-xs bg-gray-50 border border-gray-200 text-gray-600 rounded disabled:opacity-30"
                >
                  »»
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══════ JOBS TAB ══════ */}
      {subTab === 'jobs' && (
        <div className="space-y-3">
          {/* Job status counts */}
          {Object.keys(jobCounts).length > 0 && (
            <div className="flex gap-3">
              {Object.entries(jobCounts).map(([status, count]) => {
                const cfg = JOB_STATUS[status] || JOB_STATUS.pending
                return (
                  <div key={status} className={`px-3 py-1.5 rounded-lg text-xs font-medium ${cfg.color}`}>
                    <span className={`inline-block w-2 h-2 rounded-full ${cfg.dot} mr-1.5`} />
                    {status}: {count}
                  </div>
                )
              })}
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {jobsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader size={20} className="animate-spin text-purple-600" />
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">Chua co job</div>
            ) : (
              jobs.map((job, i) => {
                const st = JOB_STATUS[job.status] || JOB_STATUS.pending
                return (
                  <div key={job.id || i} className="px-4 py-3 border-b border-gray-100 hover:bg-gray-50">
                    <div className="flex items-center gap-3">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${st.dot}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900">{job.type}</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${st.color}`}>{job.status}</span>
                          {job.role_name && job.role_name !== '-' && (
                            <span className="text-xs text-purple-600">{job.role_name}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-gray-500">
                          <span>{job.account_name}</span>
                          {job.topic && <span className="text-gray-500">topic: {job.topic}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs text-gray-500">
                          {job.finished_at || job.created_at
                            ? formatDistanceToNow(new Date(job.finished_at || job.created_at), { addSuffix: true, locale: vi })
                            : '--'}
                        </p>
                        {job.started_at && job.finished_at && (
                          <p className="text-[10px] text-gray-500">
                            {Math.round((new Date(job.finished_at) - new Date(job.started_at)) / 1000)}s
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Job summary */}
                    {job.summary && (
                      <p className="text-xs text-gray-500 mt-1 ml-5">{job.summary}</p>
                    )}
                    {job.error_message && (
                      <p className="text-xs text-red-500 mt-1 ml-5">⚠️ {job.error_message}</p>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* ══════ ENGAGEMENT TAB ══════ */}
      {subTab === 'engagement' && (
        <div className="space-y-4">
          {/* Summary cards */}
          {report?.summary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                <p className="text-xl font-bold text-blue-600">{report.summary.total_activities || 0}</p>
                <p className="text-[10px] text-gray-500 uppercase">Tong tuong tac</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                <p className="text-xl font-bold text-green-600">{report.summary.success_rate ? `${Math.round(report.summary.success_rate)}%` : '-'}</p>
                <p className="text-[10px] text-gray-500 uppercase">Thanh cong</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                <p className="text-xl font-bold text-purple-600">{report.summary.friends_sent || 0}</p>
                <p className="text-[10px] text-gray-500 uppercase">Friend Sent</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
                <p className="text-xl font-bold text-orange-600">{report.summary.accept_rate ? `${Math.round(report.summary.accept_rate)}%` : '-'}</p>
                <p className="text-[10px] text-gray-500 uppercase">Accept Rate</p>
              </div>
            </div>
          )}

          {/* Recent Comments */}
          <div>
            <h3 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
              <MessageCircle size={14} /> Comments ({(report?.recent_comments || []).length})
            </h3>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {(report?.recent_comments || []).length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">Chua co comment</div>
              ) : (
                (report?.recent_comments || []).slice(0, 20).map((c, i) => (
                  <div key={i} className="px-4 py-3 border-b border-gray-100">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium text-gray-600">{c.account_name || '?'}</span>
                      <span className="text-gray-500">&rarr;</span>
                      <span className="text-gray-500 truncate flex-1">{c.group_name || c.source_name || '?'}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${c.ai_generated ? 'bg-purple-50 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>
                        {c.ai_generated ? '🤖 AI' : '📝 Template'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1 bg-gray-50 rounded px-2 py-1.5">
                      "{(c.comment_text || '').substring(0, 200)}"
                    </p>
                    {c.post_url && (
                      <a href={c.post_url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline mt-1 inline-flex items-center gap-1">
                        <ExternalLink size={10} /> Xem bai viet
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recent Likes */}
          <div>
            <h3 className="text-sm font-semibold text-gray-600 mb-2 flex items-center gap-1.5">
              <ThumbsUp size={14} /> Likes ({(report?.recent_likes || []).length})
            </h3>
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              {(report?.recent_likes || []).length === 0 ? (
                <div className="text-center py-8 text-gray-500 text-sm">Chua co like</div>
              ) : (
                (report?.recent_likes || []).slice(0, 20).map((l, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-100 text-sm">
                    <ThumbsUp size={12} className="text-blue-600 shrink-0" />
                    <span className="font-medium text-gray-600">{l.account_name || '?'}</span>
                    <span className="text-gray-500">&rarr;</span>
                    <span className="text-gray-500 truncate">{l.group_name || l.target_name || '?'}</span>
                    {l.post_url && (
                      <a href={l.post_url} target="_blank" rel="noopener noreferrer" className="shrink-0">
                        <ExternalLink size={12} className="text-blue-600" />
                      </a>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* AI Pilot Tab */}
      {subTab === 'ai_pilot' && (
        <div className="space-y-3">
          {aiPilotLoading ? (
            <div className="flex items-center justify-center py-16"><Loader size={24} className="animate-spin text-blue-500" /></div>
          ) : aiPilotLogs.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Brain size={48} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">AI Pilot chưa đưa quyết định nào</p>
              <p className="text-xs mt-1">Campaign cần chạy ít nhất 3 lần để AI Pilot bắt đầu đánh giá</p>
              <p className="text-xs text-gray-300 mt-0.5">Đã chạy: {campaign?.total_runs || 0} lần (trigger mỗi 3 lần)</p>
            </div>
          ) : (
            aiPilotLogs.map((log, idx) => {
              const d = log.details || {}
              const assessment = AI_ASSESSMENT[d.assessment] || AI_ASSESSMENT[log.result_status] || { label: d.assessment || log.result_status || '?', color: 'bg-gray-100 text-gray-600' }
              const isExpanded = expandedPilot === idx

              return (
                <div key={log.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  {/* Header */}
                  <button
                    onClick={() => setExpandedPilot(isExpanded ? null : idx)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <Brain size={16} className="text-purple-500" />
                      <span className="text-sm font-medium text-gray-900">
                        Run #{d.run_number || '?'}
                      </span>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${assessment.color}`}>
                        {assessment.label}
                      </span>
                      <span className="text-xs text-gray-400">
                        {d.applied_count || 0} điều chỉnh áp dụng
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-400">
                        {log.created_at ? formatDistanceToNow(new Date(log.created_at), { locale: vi, addSuffix: true }) : ''}
                      </span>
                      {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    </div>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-4 pb-4 border-t border-gray-100 pt-3 space-y-3">
                      {/* Recommendation */}
                      {d.recommendation && (
                        <div className="bg-blue-50 rounded-lg px-3 py-2">
                          <p className="text-xs font-medium text-blue-700 mb-0.5">Đề xuất</p>
                          <p className="text-sm text-blue-900">{d.recommendation}</p>
                        </div>
                      )}

                      {/* Adjustments */}
                      {d.adjustments?.length > 0 && (
                        <div>
                          <p className="text-xs font-medium text-gray-500 mb-1.5">Điều chỉnh ({d.adjustments.length})</p>
                          <div className="space-y-1.5">
                            {d.adjustments.map((adj, i) => (
                              <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg px-3 py-2">
                                <span className="text-lg leading-none mt-0.5">{AI_ACTION_ICONS[adj.action] || '•'}</span>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-mono text-gray-500">{(adj.role_id || '').slice(0, 8)}</span>
                                    <span className="text-xs font-medium text-gray-900">{adj.action}</span>
                                    {adj.field && <span className="text-[10px] text-gray-400">{adj.field}={adj.new_value ?? adj.value}</span>}
                                  </div>
                                  {adj.reason && <p className="text-xs text-gray-500 mt-0.5">{adj.reason}</p>}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Meta */}
                      <div className="flex items-center gap-4 text-[10px] text-gray-400">
                        <span>Activities phân tích: {d.activity_count || '?'}</span>
                        <span>Thời gian: {log.created_at ? format(new Date(log.created_at), 'dd/MM HH:mm', { locale: vi }) : ''}</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}
