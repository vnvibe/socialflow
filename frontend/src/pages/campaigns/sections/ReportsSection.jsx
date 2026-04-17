import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileBarChart, Download, Loader } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../../../lib/api'

const REPORT_TABS = [
  { key: 'overview', label: 'Tong quan' },
  { key: 'nicks', label: 'Nicks' },
  { key: 'comments', label: 'Comments' },
  { key: 'likes', label: 'Likes' },
  { key: 'groups', label: 'Groups' },
  { key: 'ads', label: 'Quang cao' },
  { key: 'errors', label: 'Errors' },
]

export default function ReportsSection({ campaignId }) {
  const [reportTab, setReportTab] = useState('overview')
  const [dateFilter, setDateFilter] = useState('7days')

  const getDateFrom = () => {
    if (dateFilter === 'today') return new Date(new Date().setHours(0,0,0,0)).toISOString()
    if (dateFilter === '3days') return new Date(Date.now() - 3 * 86400000).toISOString()
    if (dateFilter === '7days') return new Date(Date.now() - 7 * 86400000).toISOString()
    if (dateFilter === '30days') return new Date(Date.now() - 30 * 86400000).toISOString()
    return null
  }

  const { data: report, isLoading } = useQuery({
    queryKey: ['campaign-report', campaignId, dateFilter],
    queryFn: () => {
      const dateFrom = getDateFrom()
      const params = dateFrom ? `?date_from=${dateFrom}` : ''
      return api.get(`/campaigns/${campaignId}/report${params}`).then(r => r.data)
    },
  })

  // Phase 4: Ads tab data
  const [adGroupFilter, setAdGroupFilter] = useState('')
  const { data: adReport } = useQuery({
    queryKey: ['campaign-ad-report', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/ad-report`).then(r => r.data),
  })

  const handleExport = async () => {
    try {
      const res = await api.get(`/campaigns/${campaignId}/report/csv`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `campaign-report-${campaignId.slice(0, 8)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
    } catch {
      // CSV export may not exist yet
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-12"><Loader size={20} className="animate-spin text-purple-600" /></div>
  }

  const summary = report?.summary || {}
  const daily = report?.daily || []
  const nickActions = report?.nick_actions || []
  const actionSummary = report?.action_summary || {}
  const comments = report?.recent_comments || []
  const likes = report?.recent_likes || []
  const groups = report?.groups_joined || []
  const errors = report?.checkpoint_events || []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-app-primary">Bao cao</h2>
        <button onClick={handleExport} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-app-muted border border-app-border rounded-lg hover:bg-app-elevated">
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* Date Filter */}
      <div className="flex gap-1 bg-app-elevated rounded-lg p-1 w-fit">
        {[
          { key: 'today', label: 'Hom nay' },
          { key: '3days', label: '3 ngay' },
          { key: '7days', label: '7 ngay' },
          { key: '30days', label: '30 ngay' },
          { key: 'all', label: 'Tat ca' },
        ].map(f => (
          <button key={f.key} onClick={() => setDateFilter(f.key)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              dateFilter === f.key ? 'bg-app-surface text-app-primary  rounded-md' : 'text-app-muted hover:text-app-primary rounded-md transition-colors'
            }`}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Report sub-tabs */}
      <div className="flex gap-1 overflow-x-auto">
        {REPORT_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setReportTab(t.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              reportTab === t.key ? 'bg-info text-white' : 'bg-app-elevated text-app-muted hover:bg-app-elevated'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {reportTab === 'overview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-app-surface rounded border border-app-border p-4 text-center">
              <p className="text-2xl font-bold">{summary.total_jobs || 0}</p>
              <p className="text-xs text-app-muted">Total Jobs</p>
            </div>
            <div className="bg-app-surface rounded border border-app-border p-4 text-center">
              <p className="text-2xl font-bold text-hermes">{summary.success_rate ? `${Math.round(summary.success_rate)}%` : '-'}</p>
              <p className="text-xs text-app-muted">Success Rate</p>
            </div>
            <div className="bg-app-surface rounded border border-app-border p-4 text-center">
              <p className="text-2xl font-bold text-blue-600">{summary.friends_sent || 0}</p>
              <p className="text-xs text-app-muted">Friends Sent</p>
            </div>
            <div className="bg-app-surface rounded border border-app-border p-4 text-center">
              <p className="text-2xl font-bold text-purple-600">{summary.accept_rate ? `${Math.round(summary.accept_rate)}%` : '-'}</p>
              <p className="text-xs text-app-muted">Accept Rate</p>
            </div>
          </div>

          {/* Action Summary Pills */}
          {Object.keys(actionSummary).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(actionSummary).map(([action, data]) => (
                <div key={action} className="bg-app-elevated border border-app-border rounded-lg px-3 py-2 text-xs">
                  <span className="font-semibold text-app-muted">{action}</span>
                  <span className="text-hermes ml-2">✓{data.success || 0}</span>
                  {data.failed > 0 && <span className="text-red-500 ml-1">✗{data.failed}</span>}
                  <span className="text-app-muted ml-1">/{data.total || 0}</span>
                </div>
              ))}
            </div>
          )}

          {/* Daily Chart */}
          {daily.length > 0 && (
            <div className="bg-app-surface rounded border border-app-border p-5">
              <h3 className="text-sm font-semibold text-app-primary mb-3">Hoat dong theo ngay</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#9ca3af' }} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: '12px' }} />
                  <Bar dataKey="jobs_done" fill="#3b82f6" name="Done" radius={[3,3,0,0]} />
                  <Bar dataKey="jobs_failed" fill="#ef4444" name="Failed" radius={[3,3,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      {/* Nicks */}
      {reportTab === 'nicks' && (
        <div className="space-y-3">
          {nickActions.length === 0 ? (
            <div className="text-center py-12 text-app-muted text-sm">Chua co du lieu</div>
          ) : (
            nickActions.map((n, i) => (
              <div key={i} className="bg-app-surface rounded border border-app-border p-4">
                <h4 className="text-sm font-semibold text-app-primary mb-2">{n.account_name || n.account_id?.slice(0, 8)}</h4>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(n.actions || {}).map(([action, data]) => (
                    <span key={action} className="text-xs bg-app-elevated rounded px-2 py-1">
                      {action}: <span className="text-hermes">{data.success || 0}</span>/{data.total || 0}
                    </span>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Comments */}
      {reportTab === 'comments' && (
        <div className="bg-app-surface rounded border border-app-border overflow-hidden">
          {comments.length === 0 ? (
            <div className="text-center py-12 text-app-muted text-sm">Chua co comment</div>
          ) : comments.map((c, i) => (
            <div key={i} className="px-4 py-3 border-b border-app-border">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-app-primary">{c.account_name || '?'}</span>
                <span className="text-app-muted">→</span>
                <span className="text-app-muted">{c.group_name || c.source_name || '?'}</span>
                {c.ai_generated && <span className="text-xs text-purple-600">🤖 AI</span>}
              </div>
              <p className="text-xs text-app-muted mt-1">"{(c.comment_text || '').substring(0, 150)}"</p>
              {c.post_url && (
                <a href={c.post_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline mt-0.5 inline-block">
                  Xem bai viet
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Likes */}
      {reportTab === 'likes' && (
        <div className="bg-app-surface rounded border border-app-border overflow-hidden">
          {likes.length === 0 ? (
            <div className="text-center py-12 text-app-muted text-sm">Chua co like</div>
          ) : likes.map((l, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2.5 border-b border-app-border text-sm">
              <span className="text-app-primary">{l.account_name || '?'}</span>
              <span className="text-app-muted">→</span>
              <span className="text-app-muted truncate">{l.group_name || l.target_name || '?'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Groups Joined */}
      {reportTab === 'groups' && (
        <div className="bg-app-surface rounded border border-app-border overflow-hidden">
          {groups.length === 0 ? (
            <div className="text-center py-12 text-app-muted text-sm">Chua co nhom</div>
          ) : groups.map((g, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5 border-b border-app-border text-sm">
              <span className="font-medium text-app-primary">{g.name || g.fb_group_id || '?'}</span>
              <span className="text-xs text-app-muted">{g.member_count?.toLocaleString() || '?'} members</span>
            </div>
          ))}
        </div>
      )}

      {/* Ads (Phase 4) */}
      {reportTab === 'ads' && (
        <div className="space-y-4">
          {/* Stats cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-app-surface rounded border border-app-border p-4 text-center">
              <p className="text-2xl font-bold text-orange-600">{adReport?.total_opportunities || 0}</p>
              <p className="text-xs text-app-muted">Tong co hoi</p>
            </div>
            <div className="bg-app-surface rounded border border-app-border p-4 text-center">
              <p className="text-2xl font-bold text-hermes">{adReport?.total_acted || 0}</p>
              <p className="text-xs text-app-muted">Da tuong tac</p>
            </div>
            <div className="bg-app-surface rounded border border-app-border p-4 text-center">
              <p className="text-2xl font-bold text-purple-600">{adReport?.success_rate || 0}%</p>
              <p className="text-xs text-app-muted">Ti le thanh cong</p>
            </div>
          </div>

          {/* Group filter */}
          {adReport?.by_group?.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setAdGroupFilter('')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${!adGroupFilter ? 'bg-orange-600 text-white' : 'bg-app-elevated text-app-muted'}`}>
                Tat ca ({adReport.by_group.reduce((s, g) => s + g.opportunities, 0)})
              </button>
              {adReport.by_group.slice(0, 8).map(g => (
                <button key={g.group_fb_id} onClick={() => setAdGroupFilter(g.group_fb_id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${adGroupFilter === g.group_fb_id ? 'bg-orange-600 text-white' : 'bg-app-elevated text-app-muted hover:bg-app-hover'}`}>
                  {(g.group_name || '?').substring(0, 25)} ({g.acted}/{g.opportunities})
                </button>
              ))}
            </div>
          )}

          {/* Recent table */}
          <div className="bg-app-surface rounded border border-app-border overflow-hidden">
            {(!adReport?.recent || adReport.recent.length === 0) ? (
              <div className="text-center py-12 text-app-muted text-sm">Chua co tuong tac quang cao nao</div>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-app-base text-xs text-app-muted">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Group</th>
                    <th className="text-left px-3 py-2 font-medium">Bai viet</th>
                    <th className="text-left px-3 py-2 font-medium">Comment da post</th>
                    <th className="text-left px-3 py-2 font-medium">Nick</th>
                    <th className="text-left px-3 py-2 font-medium">Thoi gian</th>
                  </tr>
                </thead>
                <tbody>
                  {adReport.recent
                    .filter(r => !adGroupFilter || r.group_name === (adReport.by_group.find(g => g.group_fb_id === adGroupFilter)?.group_name))
                    .map(r => (
                    <tr key={r.id} className="border-t border-app-border">
                      <td className="px-3 py-2 text-xs text-app-primary">{(r.group_name || '?').substring(0, 30)}</td>
                      <td className="px-3 py-2 text-xs text-app-muted max-w-xs">
                        <div className="truncate">{r.post_preview}</div>
                        {r.post_url && <a href={r.post_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline text-[10px]">Xem</a>}
                      </td>
                      <td className="px-3 py-2 text-xs text-app-primary max-w-xs"><div className="truncate">{r.comment_posted || '-'}</div></td>
                      <td className="px-3 py-2 text-xs text-app-muted">{r.nick_name || '-'}</td>
                      <td className="px-3 py-2 text-xs text-app-muted">{r.acted_at ? new Date(r.acted_at).toLocaleString('vi-VN') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Errors */}
      {reportTab === 'errors' && (
        <div className="bg-app-surface rounded border border-app-border overflow-hidden">
          {errors.length === 0 ? (
            <div className="text-center py-12 text-app-muted text-sm">Khong co loi</div>
          ) : errors.map((e, i) => (
            <div key={i} className="px-4 py-2.5 border-b border-app-border">
              <div className="flex items-center gap-2 text-sm">
                <span className="text-red-500 font-medium">{e.type || e.action || 'Error'}</span>
                <span className="text-app-muted">{e.account_name || '?'}</span>
              </div>
              <p className="text-xs text-app-muted mt-0.5">{e.error_message || e.details || '?'}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
