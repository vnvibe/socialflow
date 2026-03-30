import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { Target, ArrowLeft, Play, Pause, Edit, BarChart3, Users, UserPlus, Crosshair, CheckCircle, XCircle, Clock, FileBarChart, TrendingUp, Timer, AlertTriangle, ScrollText, RefreshCw, Loader } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import { formatDistanceToNow, format } from 'date-fns'
import { vi } from 'date-fns/locale'

const STATUS_CONFIG = {
  idle:      { label: 'Chua chay', color: 'bg-gray-100 text-gray-600' },
  running:   { label: 'Dang chay', color: 'bg-green-100 text-green-700' },
  paused:    { label: 'Tam dung',  color: 'bg-yellow-100 text-yellow-700' },
  completed: { label: 'Hoan thanh', color: 'bg-blue-100 text-blue-700' },
  error:     { label: 'Loi',       color: 'bg-red-100 text-red-700' },
}

const TABS = [
  { key: 'overview', label: 'Tổng quan', icon: BarChart3 },
  { key: 'activity', label: 'Nhật ký', icon: ScrollText },
  { key: 'report', label: 'Báo cáo', icon: FileBarChart },
  { key: 'roles', label: 'Roles', icon: Users },
  { key: 'targets', label: 'Target Queue', icon: Crosshair },
  { key: 'friends', label: 'Friend Log', icon: UserPlus },
]

export default function CampaignDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('overview')

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.get(`/campaigns/${id}`).then(r => r.data),
  })

  const { data: stats } = useQuery({
    queryKey: ['campaign-stats', id],
    queryFn: () => api.get(`/campaigns/${id}/stats`).then(r => r.data),
    refetchInterval: activeTab === 'overview' ? 10000 : false,
  })

  const { data: report, isLoading: reportLoading } = useQuery({
    queryKey: ['campaign-report', id],
    queryFn: () => api.get(`/campaigns/${id}/report`).then(r => r.data),
    enabled: activeTab === 'report',
  })

  const { data: activityData, isLoading: activityLoading, refetch: refetchActivity } = useQuery({
    queryKey: ['campaign-activity', id],
    queryFn: () => api.get(`/campaigns/${id}/activity?limit=50`).then(r => r.data),
    enabled: activeTab === 'activity',
    refetchInterval: activeTab === 'activity' ? 5000 : false,
  })

  // Detail log is now self-contained in DetailLogView component

  const { data: targetsData } = useQuery({
    queryKey: ['campaign-targets', id],
    queryFn: () => api.get(`/campaigns/${id}/targets?limit=50`).then(r => r.data),
    enabled: activeTab === 'targets',
  })

  const { data: friendsData } = useQuery({
    queryKey: ['campaign-friends', id],
    queryFn: () => api.get(`/campaigns/${id}/friend-log?limit=50`).then(r => r.data),
    enabled: activeTab === 'friends',
  })

  const startMut = useMutation({
    mutationFn: () => api.post(`/campaigns/${id}/start`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaign', id] }); toast.success('Da bat dau') },
  })
  const stopMut = useMutation({
    mutationFn: () => api.post(`/campaigns/${id}/stop`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaign', id] }); toast.success('Da tam dung') },
  })

  if (isLoading) return <div className="text-center py-12 text-gray-500">Dang tai...</div>
  if (!campaign) return <div className="text-center py-12 text-gray-500">Khong tim thay</div>

  const status = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.idle
  const isRunning = campaign.status === 'running' || campaign.is_active

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/campaigns')} className="p-1.5 text-gray-400 hover:text-gray-600">
            <ArrowLeft size={20} />
          </button>
          <Target size={24} className="text-purple-600" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{campaign.name}</h1>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${status.color}`}>
                {status.label}
              </span>
            </div>
            {campaign.topic && <p className="text-sm text-gray-500">Chu de: {campaign.topic}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRunning ? (
            <button onClick={() => stopMut.mutate()} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-yellow-700 bg-yellow-50 rounded-lg hover:bg-yellow-100">
              <Pause size={16} /> Tam dung
            </button>
          ) : (
            <button onClick={() => startMut.mutate()} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100">
              <Play size={16} /> Bat dau
            </button>
          )}
          <button onClick={() => navigate(`/campaigns/${id}/edit`)} className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100">
            <Edit size={16} /> Sua
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {TABS.map(tab => {
          const Icon = tab.icon
          return (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.key ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
              }`}>
              <Icon size={14} /> {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && <OverviewTab campaign={campaign} stats={stats} />}
      {activeTab === 'activity' && <ActivityTab data={activityData} loading={activityLoading} onRefresh={refetchActivity} campaignId={id} />}
      {activeTab === 'report' && <ReportTab report={report} loading={reportLoading} />}
      {activeTab === 'roles' && <RolesTab campaign={campaign} />}
      {activeTab === 'targets' && <TargetsTab data={targetsData} />}
      {activeTab === 'friends' && <FriendsTab data={friendsData} />}
    </div>
  )
}

function StatCard({ title, value, icon: Icon, color }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
        </div>
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  )
}

function OverviewTab({ campaign, stats }) {
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard title="Queue Pending" value={stats?.queue?.pending || 0} icon={Clock} color="bg-yellow-100 text-yellow-700" />
        <StatCard title="Queue Done" value={stats?.queue?.done || 0} icon={CheckCircle} color="bg-green-100 text-green-700" />
        <StatCard title="Friends Sent" value={stats?.friends?.sent || 0} icon={UserPlus} color="bg-blue-100 text-blue-700" />
        <StatCard title="Jobs Failed" value={stats?.jobs?.failed || 0} icon={XCircle} color="bg-red-100 text-red-700" />
      </div>
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Thong tin</h3>
        <div className="grid grid-cols-2 gap-y-2 text-sm">
          <span className="text-gray-500">Da chay:</span>
          <span>{campaign.total_runs || 0} lan</span>
          <span className="text-gray-500">Lan chay cuoi:</span>
          <span>{campaign.last_run_at ? formatDistanceToNow(new Date(campaign.last_run_at), { addSuffix: true, locale: vi }) : 'Chua chay'}</span>
          <span className="text-gray-500">Roles:</span>
          <span>{campaign.campaign_roles?.length || 0}</span>
          <span className="text-gray-500">Nick stagger:</span>
          <span>{campaign.nick_stagger_seconds || 60}s</span>
          <span className="text-gray-500">Role stagger:</span>
          <span>{campaign.role_stagger_minutes || 30} phut</span>
        </div>
      </div>
    </div>
  )
}

function RolesTab({ campaign }) {
  const ROLE_ICONS = { scout: '🔍', nurture: '💚', connect: '🤝', post: '✍️', custom: '⚙️' }
  return (
    <div className="space-y-3">
      {(campaign.campaign_roles || []).map(role => (
        <div key={role.id} className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-2">
            <span>{ROLE_ICONS[role.role_type] || '⚙️'}</span>
            <h3 className="font-semibold text-gray-900">{role.name}</h3>
            <span className="text-xs text-gray-400">({role.role_type})</span>
            <span className="text-xs text-gray-400">• {(role.account_ids || []).length} nicks</span>
          </div>
          {role.mission && <p className="text-sm text-gray-600 mb-2">{role.mission}</p>}
          {Array.isArray(role.parsed_plan) && role.parsed_plan.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-2 space-y-1">
              {role.parsed_plan.map((step, i) => (
                <div key={i} className="text-xs text-gray-600 flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">{i + 1}</span>
                  {step.action} — {step.description || `${step.count_min}-${step.count_max}`}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function TargetsTab({ data }) {
  const targets = data?.data || []
  const STATUS_COLORS = { pending: 'text-yellow-600', assigned: 'text-blue-600', done: 'text-green-600', failed: 'text-red-600', skip: 'text-gray-400' }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-gray-500">User</th>
            <th className="text-left px-4 py-3 font-medium text-gray-500">Nguon</th>
            <th className="text-left px-4 py-3 font-medium text-gray-500">Score</th>
            <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
          </tr>
        </thead>
        <tbody>
          {targets.map(t => (
            <tr key={t.id} className="border-b last:border-0 hover:bg-gray-50">
              <td className="px-4 py-2.5">{t.fb_user_name || t.fb_user_id}</td>
              <td className="px-4 py-2.5 text-gray-500">{t.source_group_name || '-'}</td>
              <td className="px-4 py-2.5">{Math.round(t.active_score)}</td>
              <td className={`px-4 py-2.5 font-medium ${STATUS_COLORS[t.status] || 'text-gray-400'}`}>{t.status}</td>
            </tr>
          ))}
          {targets.length === 0 && (
            <tr><td colSpan={4} className="text-center py-8 text-gray-400">Chua co target nao</td></tr>
          )}
        </tbody>
      </table>
      {data?.total > 50 && <p className="text-xs text-gray-400 px-4 py-2">Hien {targets.length}/{data.total}</p>}
    </div>
  )
}

function ReportTab({ report, loading }) {
  const [section, setSection] = useState('overview')
  if (loading) return <div className="text-center py-12 text-gray-400"><Loader className="animate-spin inline mr-2" size={16} />Đang tải báo cáo...</div>
  if (!report) return <div className="text-center py-12 text-gray-400">Không có dữ liệu</div>

  const s = report.summary
  const hasData = s.total_jobs > 0 || s.total_activities > 0
  const fmtDur = (sec) => sec < 60 ? `${sec}s` : sec < 3600 ? `${Math.round(sec / 60)}m` : `${Math.floor(sec / 3600)}h ${Math.round((sec % 3600) / 60)}m`
  const fmtDate = (d) => d ? format(new Date(d), 'dd/MM HH:mm') : '-'
  const chartData = (report.daily || []).map(d => ({ ...d, date: d.date.slice(5) }))

  const SECTIONS = [
    { key: 'overview', label: 'Tổng quan' },
    { key: 'nicks', label: 'Theo Nick' },
    { key: 'comments', label: `Comments (${report.recent_comments?.length || 0})` },
    { key: 'likes', label: `Likes (${report.recent_likes?.length || 0})` },
    { key: 'groups', label: `Nhóm (${report.groups_joined?.length || 0})` },
    { key: 'errors', label: `Lỗi (${report.checkpoint_events?.length || 0})` },
  ]

  const exportCSV = () => {
    const rows = [['Thời gian', 'Nick', 'Hành động', 'Nhóm/Đối tượng', 'Nội dung', 'Link bài', 'Kết quả']]
    const all = [
      ...(report.recent_comments || []).map(c => [fmtDate(c.created_at), c.account_name, 'Comment', c.group_name, c.comment_text || '', c.post_url || '', 'OK']),
      ...(report.recent_likes || []).map(l => [fmtDate(l.created_at), l.account_name, 'Like', l.group_name, '', l.post_url || '', 'OK']),
      ...(report.groups_joined || []).map(g => [fmtDate(g.created_at), g.account_name, 'Join Group', g.group_name, `${g.member_count || '?'} members`, g.group_url || '', 'OK']),
      ...(report.checkpoint_events || []).map(e => [fmtDate(e.created_at), e.account_name || '-', e.event_type, e.target || e.type || '-', e.error || e.error_message || '', '', 'FAIL']),
    ]
    rows.push(...all)
    const escapeCell = (v) => {
      const s = String(v ?? '')
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = rows.map(r => r.map(escapeCell).join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `campaign-report-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
  }

  const ACTION_ICONS = { like: '👍', comment: '💬', join_group: '🏠', friend_request: '🤝', visit_group: '👁️', scan: '🔍', browse: '📱', post: '✍️' }

  return (
    <div className="space-y-4">
      {/* Section nav + export */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
          {SECTIONS.map(sec => (
            <button key={sec.key} onClick={() => setSection(sec.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${section === sec.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
              {sec.label}
            </button>
          ))}
        </div>
        <button onClick={exportCSV} className="flex items-center gap-1 px-3 py-1.5 text-xs border rounded-lg hover:bg-gray-50">
          📥 Xuất CSV
        </button>
      </div>

      {/* === OVERVIEW === */}
      {section === 'overview' && <>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard title="Tổng hoạt động" value={s.total_activities || 0} icon={BarChart3} color="bg-blue-100 text-blue-700" />
          <StatCard title="Tỉ lệ thành công" value={`${s.success_rate}%`} icon={TrendingUp} color="bg-green-100 text-green-700" />
          <StatCard title="Kết bạn" value={`${s.friends_sent} (${s.accept_rate}% chấp nhận)`} icon={UserPlus} color="bg-indigo-100 text-indigo-700" />
          <StatCard title="Thời gian TB" value={fmtDur(s.avg_job_duration_sec)} icon={Timer} color="bg-orange-100 text-orange-700" />
        </div>

        {/* Action summary pills */}
        {report.action_summary && (
          <div className="bg-white rounded-xl border p-4">
            <h3 className="font-semibold text-gray-900 text-sm mb-3">Tổng hợp theo loại</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(report.action_summary).map(([type, counts]) => (
                <div key={type} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                  <span className="text-lg">{ACTION_ICONS[type] || '•'}</span>
                  <div>
                    <p className="text-xs font-medium text-gray-700 capitalize">{type.replace(/_/g, ' ')}</p>
                    <p className="text-sm font-bold">{counts.success}<span className="text-xs text-gray-400 font-normal">/{counts.total}</span>
                      {counts.failed > 0 && <span className="text-xs text-red-400 ml-1">({counts.failed} lỗi)</span>}
                    </p>
                    {counts.skipped > 0 && <p className="text-[10px] text-gray-400">+{counts.skipped} bỏ qua</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chart */}
        {hasData && chartData.length > 0 && (
          <div className="bg-white rounded-xl border p-5">
            <h3 className="font-semibold text-gray-900 text-sm mb-4">Hoạt động 14 ngày qua</h3>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} barGap={2}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="jobs_done" name="Thành công" fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="jobs_failed" name="Thất bại" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </>}

      {/* === PER-NICK BREAKDOWN === */}
      {section === 'nicks' && (
        <div className="space-y-3">
          {(report.nick_actions || []).map(nick => (
            <div key={nick.account_id} className="bg-white rounded-xl border overflow-hidden">
              <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
                <span className="font-semibold text-sm">👤 {nick.account_name}</span>
                <span className="text-[10px] text-gray-400 font-mono">{nick.account_id?.slice(0, 8)}</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 p-3">
                {Object.entries(nick.actions || {}).map(([type, c]) => (
                  <div key={type} className="flex items-center gap-2 p-2 rounded-lg bg-gray-50">
                    <span>{ACTION_ICONS[type] || '•'}</span>
                    <div>
                      <p className="text-[10px] text-gray-500 capitalize">{type.replace(/_/g, ' ')}</p>
                      <p className="text-sm font-bold text-green-600">{c.success}<span className="text-gray-400 font-normal text-xs">/{c.total}</span>
                        {c.skipped > 0 && <span className="text-yellow-500 text-xs ml-1">⏭️{c.skipped}</span>}
                        {c.failed > 0 && <span className="text-red-400 text-xs ml-1">❌{c.failed}</span>}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {(!report.nick_actions?.length) && <div className="text-center py-8 text-gray-400">Chưa có dữ liệu</div>}
        </div>
      )}

      {/* === COMMENTS with links === */}
      {section === 'comments' && (
        <div className="bg-white rounded-xl border divide-y">
          {(report.recent_comments || []).map((c, i) => (
            <div key={i} className="px-4 py-2.5 hover:bg-gray-50">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="text-sm">💬</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {c.group_url
                        ? <a href={c.group_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline font-medium truncate max-w-[200px]">{c.group_name}</a>
                        : <span className="text-xs font-medium text-gray-700 truncate max-w-[200px]">{c.group_name}</span>}
                      <span className="text-[10px] text-gray-300">•</span>
                      <span className="text-[10px] text-gray-400">{c.account_name}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">"{c.comment_text}"</p>
                    {c.post_url && <a href={c.post_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline">🔗 Xem bài viết</a>}
                  </div>
                </div>
                <span className="text-[10px] text-gray-300 flex-shrink-0">{fmtDate(c.created_at)}</span>
              </div>
            </div>
          ))}
          {!report.recent_comments?.length && <div className="text-center py-8 text-gray-400">Chưa có comment nào</div>}
        </div>
      )}

      {/* === LIKES with links === */}
      {section === 'likes' && (
        <div className="bg-white rounded-xl border divide-y">
          {(report.recent_likes || []).map((l, i) => (
            <div key={i} className="px-4 py-2 hover:bg-gray-50 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span>👍</span>
                {l.group_url
                  ? <a href={l.group_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline truncate max-w-[200px]">{l.group_name}</a>
                  : <span className="text-xs text-gray-700 truncate max-w-[200px]">{l.group_name}</span>}
                <span className="text-[10px] text-gray-400">{l.account_name}</span>
                {l.post_url && <a href={l.post_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline">🔗</a>}
              </div>
              <span className="text-[10px] text-gray-300 flex-shrink-0">{fmtDate(l.created_at)}</span>
            </div>
          ))}
          {!report.recent_likes?.length && <div className="text-center py-8 text-gray-400">Chưa có like nào</div>}
        </div>
      )}

      {/* === GROUPS JOINED === */}
      {section === 'groups' && (
        <div className="bg-white rounded-xl border divide-y">
          {(report.groups_joined || []).map((g, i) => (
            <div key={i} className="px-4 py-2.5 hover:bg-gray-50 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span>🏠</span>
                {g.group_url
                  ? <a href={g.group_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline font-medium">{g.group_name}</a>
                  : <span className="text-xs font-medium text-gray-700">{g.group_name}</span>}
                {g.member_count && <span className="text-[10px] text-gray-400">({g.member_count.toLocaleString()} thành viên)</span>}
                <span className="text-[10px] text-gray-400">{g.account_name}</span>
              </div>
              <span className="text-[10px] text-gray-300 flex-shrink-0">{fmtDate(g.created_at)}</span>
            </div>
          ))}
          {!report.groups_joined?.length && <div className="text-center py-8 text-gray-400">Chưa join nhóm nào</div>}
        </div>
      )}

      {/* === ERRORS & CHECKPOINTS === */}
      {section === 'errors' && (
        <div className="bg-white rounded-xl border divide-y">
          {(report.checkpoint_events || []).map((e, i) => (
            <div key={i} className="px-4 py-3 hover:bg-red-50/30">
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${e.event_type === 'job_error' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                  {e.event_type === 'job_error' ? '❌ JOB' : '⚠️ ACTION'}
                </span>
                {e.account_name && <span className="text-xs text-gray-500">{e.account_name}</span>}
                {e.action && <span className="text-[10px] text-gray-400">{e.action}</span>}
                {e.target && <span className="text-[10px] text-gray-400 truncate max-w-[150px]">{e.target}</span>}
              </div>
              <p className="text-xs text-red-600 line-clamp-2">{e.error || e.error_message}</p>
              <span className="text-[10px] text-gray-300">{fmtDate(e.created_at)}</span>
            </div>
          ))}
          {!report.checkpoint_events?.length && <div className="text-center py-8 text-green-500">✅ Không có lỗi nào</div>}
        </div>
      )}

      {!hasData && (
        <div className="bg-white rounded-xl border p-12 text-center">
          <FileBarChart size={48} className="mx-auto mb-3 text-gray-300" />
          <p className="text-gray-500">Chưa có dữ liệu báo cáo.</p>
          <p className="text-sm text-gray-400 mt-1">Chạy campaign để bắt đầu thu thập.</p>
        </div>
      )}
    </div>
  )
}

const JOB_STATUS = {
  pending:  { label: 'Chờ', color: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  running:  { label: 'Đang chạy', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500 animate-pulse' },
  done:     { label: 'Xong', color: 'bg-green-100 text-green-700', dot: 'bg-green-500' },
  failed:   { label: 'Lỗi', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  cancelled:{ label: 'Hủy', color: 'bg-gray-100 text-gray-400', dot: 'bg-gray-300' },
}

const JOB_TYPE_LABELS = {
  campaign_nurture: '💚 Nurture',
  campaign_scout: '🔍 Scout',
  campaign_connect: '🤝 Connect',
  campaign_post: '✍️ Post',
  campaign_discover_groups: '🌐 Tìm nhóm',
  campaign_scan_members: '👥 Scan thành viên',
  campaign_send_friend_request: '🤝 Kết bạn',
  campaign_interact_profile: '👤 Tương tác',
}

function ActivityTab({ data, loading, onRefresh, campaignId }) {
  const [filter, setFilter] = useState(null)
  const [viewMode, setViewMode] = useState('jobs') // 'jobs' or 'details'

  if (loading && !data) return <div className="text-center py-12 text-gray-400"><Loader className="animate-spin inline mr-2" size={16} />Đang tải nhật ký...</div>

  const activities = data?.data || []
  const filtered = filter ? activities.filter(a => a.status === filter) : activities
  const counts = data?.counts || {}

  return (
    <div className="space-y-4">
      {/* View mode toggle + refresh */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          <button onClick={() => setViewMode('jobs')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'jobs' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
            Jobs
          </button>
          <button onClick={() => setViewMode('details')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'details' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>
            Chi tiết
          </button>
        </div>
        <button onClick={onRefresh} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
          <RefreshCw size={12} /> Làm mới
        </button>
      </div>

      {viewMode === 'details' && <DetailLogView campaignId={campaignId} />}

      {viewMode === 'jobs' && <>
      {/* Filter pills */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => setFilter(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${!filter ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            Tất cả ({activities.length})
          </button>
          {['running', 'done', 'failed', 'pending'].map(s => {
            const cfg = JOB_STATUS[s]
            const count = activities.filter(a => a.status === s).length
            if (count === 0) return null
            return (
              <button key={s} onClick={() => setFilter(filter === s ? null : s)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${filter === s ? 'bg-gray-900 text-white' : `${cfg.color} hover:opacity-80`}`}>
                {cfg.label} ({count})
              </button>
            )
          })}
        </div>
        <button onClick={onRefresh} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
          <RefreshCw size={12} /> Làm mới
        </button>
      </div>

      {/* Activity entries */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <ScrollText size={32} className="mx-auto mb-2 opacity-50" />
            Chưa có hoạt động nào
          </div>
        )}
        {filtered.map(entry => {
          const status = JOB_STATUS[entry.status] || JOB_STATUS.pending
          const duration = entry.started_at && entry.finished_at
            ? Math.round((new Date(entry.finished_at) - new Date(entry.started_at)) / 1000)
            : null

          return (
            <div key={entry.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  {/* Status dot */}
                  <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${status.dot}`} />
                  <div className="min-w-0 flex-1">
                    {/* Main line: type + account */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">
                        {JOB_TYPE_LABELS[entry.type] || entry.type}
                      </span>
                      <span className="text-xs text-gray-400">•</span>
                      <span className="text-xs text-gray-500">{entry.account_name}</span>
                      {entry.role_name !== '-' && (
                        <>
                          <span className="text-xs text-gray-400">•</span>
                          <span className="text-xs text-purple-500">{entry.role_name}</span>
                        </>
                      )}
                    </div>
                    {/* Summary or error */}
                    {entry.status === 'done' && entry.summary && !entry.summary.startsWith('⏭️') && (
                      <p className="text-xs text-green-600 mt-0.5">✓ {entry.summary}</p>
                    )}
                    {entry.status === 'done' && entry.summary?.startsWith('⏭️') && (
                      <p className="text-xs text-yellow-600 mt-0.5">{entry.summary}</p>
                    )}
                    {entry.status === 'done' && !entry.summary && (
                      <p className="text-xs text-gray-400 mt-0.5">Hoàn thành (không có dữ liệu)</p>
                    )}
                    {entry.status === 'failed' && entry.error_message && (
                      <p className="text-xs text-red-500 mt-0.5 line-clamp-2">✗ {entry.error_message}</p>
                    )}
                    {entry.status === 'running' && (
                      <p className="text-xs text-blue-500 mt-0.5 flex items-center gap-1">
                        <Loader size={10} className="animate-spin" /> Đang thực hiện...
                        {entry.attempt > 1 && ` (lần ${entry.attempt})`}
                      </p>
                    )}
                  </div>
                </div>
                {/* Right: time + duration */}
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-gray-400">
                    {entry.created_at ? format(new Date(entry.created_at), 'dd/MM HH:mm:ss') : ''}
                  </p>
                  {duration != null && (
                    <p className="text-[10px] text-gray-300">{duration}s</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      </>}

      {/* Auto-refresh indicator */}
      <p className="text-center text-[10px] text-gray-300">Tự động cập nhật mỗi 5 giây</p>
    </div>
  )
}

const ACTION_ICONS = {
  like: '👍', comment: '💬', join_group: '🏠', leave_group: '🚪', friend_request: '🤝',
  post: '✍️', visit_group: '👁️', visit_profile: '👤', scan: '🔍',
}
const ACTION_LABELS = {
  like: 'Like', comment: 'Comment', join_group: 'Tham gia nhóm', leave_group: 'Rời nhóm', friend_request: 'Kết bạn',
  post: 'Đăng bài', visit_group: 'Xem nhóm', visit_profile: 'Xem profile', scan: 'Scan',
}

function DetailLogView({ campaignId }) {
  const [actionFilter, setActionFilter] = useState(null)
  const [accountFilter, setAccountFilter] = useState(null)
  const [dateFilter, setDateFilter] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [entries, setEntries] = useState([])
  const [summary, setSummary] = useState({})
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(false)
  const latestTs = useRef(null)
  const PER_PAGE = 30

  // Fetch page data
  const fetchPage = useCallback(async (page, action, account, date) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ limit: PER_PAGE, page })
      if (action) params.set('action_type', action)
      if (account) params.set('account_id', account)
      if (date) {
        params.set('date_from', `${date}T00:00:00`)
        params.set('date_to', `${date}T23:59:59`)
      }
      const res = await api.get(`/campaigns/${campaignId}/activity-log?${params}`)
      const d = res.data
      setEntries(d.data || [])
      setSummary(d.summary || {})
      setTotal(d.total || 0)
      setTotalPages(d.total_pages || 1)
      if (d.accounts?.length) setAccounts(d.accounts)
      // Track latest timestamp for polling (page 1 only, no filters)
      if (page === 1 && !action && !account && d.data?.[0]?.created_at) {
        latestTs.current = d.data[0].created_at
      }
    } catch {}
    setLoading(false)
  }, [campaignId])

  // Initial load
  useEffect(() => {
    fetchPage(1, null, null, '')
    setCurrentPage(1)
    setActionFilter(null)
    setAccountFilter(null)
    setDateFilter('')
  }, [campaignId, fetchPage])

  // Poll for new entries (page 1 only, no filters)
  useEffect(() => {
    if (currentPage !== 1 || actionFilter || accountFilter || dateFilter) return
    const timer = setInterval(async () => {
      if (!latestTs.current) return
      try {
        const res = await api.get(`/campaigns/${campaignId}/activity-log?after=${latestTs.current}&limit=20`)
        const fresh = res.data?.data || []
        if (fresh.length > 0) {
          setEntries(prev => {
            const ids = new Set(prev.map(e => e.id))
            const newOnes = fresh.filter(e => !ids.has(e.id))
            return newOnes.length ? [...newOnes, ...prev].slice(0, PER_PAGE) : prev
          })
          if (fresh[0].created_at > latestTs.current) latestTs.current = fresh[0].created_at
          if (res.data?.summary) setSummary(res.data.summary)
          if (res.data?.total) setTotal(res.data.total)
        }
      } catch {}
    }, 10000)
    return () => clearInterval(timer)
  }, [campaignId, currentPage, actionFilter, accountFilter, dateFilter])

  // Handle filter/page change
  const changePage = (p) => { setCurrentPage(p); fetchPage(p, actionFilter, accountFilter, dateFilter) }
  const changeAction = (a) => { const v = actionFilter === a ? null : a; setActionFilter(v); setCurrentPage(1); fetchPage(1, v, accountFilter, dateFilter) }
  const changeAccount = (id) => { const v = accountFilter === id ? null : id; setAccountFilter(v); setCurrentPage(1); fetchPage(1, actionFilter, v, dateFilter) }
  const changeDate = (d) => { setDateFilter(d); setCurrentPage(1); fetchPage(1, actionFilter, accountFilter, d) }

  if (!entries.length && !total && !loading) return <div className="text-center py-8 text-gray-400">Chưa có dữ liệu chi tiết. Chạy campaign để bắt đầu ghi log.</div>

  return (
    <div className="space-y-3">
      {/* Filters row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Action filter pills */}
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={() => changeAction(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium ${!actionFilter ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            Tất cả ({total})
          </button>
          {Object.entries(summary).map(([type, counts]) => (
            <button key={type} onClick={() => changeAction(type)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${actionFilter === type ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {ACTION_ICONS[type] || '•'} {ACTION_LABELS[type] || type} ({counts.total})
            </button>
          ))}
        </div>
        {/* Nick + Date filters */}
        <div className="flex gap-2 items-center">
          {accounts.length > 0 && (
            <select value={accountFilter || ''} onChange={e => changeAccount(e.target.value || null)}
              className="text-xs border rounded-lg px-2 py-1.5 bg-white text-gray-600">
              <option value="">Tất cả nick</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          )}
          <input type="date" value={dateFilter} onChange={e => changeDate(e.target.value)}
            className="text-xs border rounded-lg px-2 py-1.5 bg-white text-gray-600" />
        </div>
      </div>

      {/* Detail entries */}
      <div className="bg-white rounded-xl border border-gray-200 divide-y">
        {loading && !entries.length && (
          <div className="text-center py-8 text-gray-400"><Loader className="animate-spin inline mr-1" size={14} /> Đang tải...</div>
        )}
        {!loading && entries.length === 0 && (
          <div className="text-center py-8 text-gray-400">Không có hoạt động</div>
        )}
        {entries.map(entry => (
          <div key={entry.id} className="px-4 py-2.5 hover:bg-gray-50 transition-colors">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="text-sm">{ACTION_ICONS[entry.action_type] || '•'}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium text-gray-700">{ACTION_LABELS[entry.action_type] || entry.action_type}</span>
                    {entry.target_name && (
                      entry.target_url
                        ? <a href={entry.target_url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline truncate max-w-[200px]">{entry.target_name}</a>
                        : <span className="text-xs text-gray-500 truncate max-w-[200px]">{entry.target_name}</span>
                    )}
                    <span className="text-[10px] text-gray-300">•</span>
                    <span className="text-[10px] text-gray-400">{entry.account_name}</span>
                  </div>
                  {entry.result_status === 'failed' && (
                    <p className="text-[10px] text-red-400 mt-0.5 truncate">{entry.details?.error}</p>
                  )}
                  {entry.details?.comment_text && (
                    <p className="text-[10px] text-gray-400 mt-0.5 truncate">"{entry.details.comment_text}"</p>
                  )}
                  {(entry.action_type === 'like' || entry.action_type === 'comment') && (
                    entry.details?.post_url
                      ? <a href={entry.details.post_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-500 hover:underline">↗ xem bài</a>
                      : entry.target_url
                        ? <a href={entry.target_url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-gray-400 hover:underline">↗ xem nhóm</a>
                        : null
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {entry.result_status === 'success' && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                {entry.result_status === 'failed' && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                {entry.result_status === 'skipped' && <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />}
                <span className="text-[10px] text-gray-300">{entry.created_at ? format(new Date(entry.created_at), 'dd/MM HH:mm:ss') : ''}</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => changePage(Math.max(1, currentPage - 1))} disabled={currentPage <= 1}
            className="px-2 py-1 text-xs rounded border disabled:opacity-30 hover:bg-gray-50">←</button>
          {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
            let p
            if (totalPages <= 7) p = i + 1
            else if (currentPage <= 4) p = i + 1
            else if (currentPage >= totalPages - 3) p = totalPages - 6 + i
            else p = currentPage - 3 + i
            return (
              <button key={p} onClick={() => changePage(p)}
                className={`px-2.5 py-1 text-xs rounded border ${p === currentPage ? 'bg-gray-900 text-white border-gray-900' : 'hover:bg-gray-50'}`}>
                {p}
              </button>
            )
          })}
          <button onClick={() => changePage(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages}
            className="px-2 py-1 text-xs rounded border disabled:opacity-30 hover:bg-gray-50">→</button>
        </div>
      )}

      <p className="text-center text-[10px] text-gray-300">
        {total} hoạt động{currentPage === 1 && !actionFilter && !accountFilter ? ' • Tự động cập nhật' : ''}
      </p>
    </div>
  )
}

function FriendsTab({ data }) {
  const friends = data?.data || []
  const STATUS_COLORS = { sent: 'text-blue-600', accepted: 'text-green-600', declined: 'text-red-600', already_friend: 'text-gray-400' }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="text-left px-4 py-3 font-medium text-gray-500">Target</th>
            <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
            <th className="text-left px-4 py-3 font-medium text-gray-500">Gui luc</th>
          </tr>
        </thead>
        <tbody>
          {friends.map(f => (
            <tr key={f.id} className="border-b last:border-0 hover:bg-gray-50">
              <td className="px-4 py-2.5">{f.target_name || f.target_fb_id}</td>
              <td className={`px-4 py-2.5 font-medium ${STATUS_COLORS[f.status] || 'text-gray-400'}`}>{f.status}</td>
              <td className="px-4 py-2.5 text-gray-500">{f.sent_at ? format(new Date(f.sent_at), 'dd/MM HH:mm') : '-'}</td>
            </tr>
          ))}
          {friends.length === 0 && (
            <tr><td colSpan={3} className="text-center py-8 text-gray-400">Chua co friend request nao</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
