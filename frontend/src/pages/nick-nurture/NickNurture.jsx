import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Sprout, Play, Pause, Settings, Plus, Loader,
  Heart, MessageCircle, Eye, Clock, Activity, Shield,
  Trash2, CheckCircle, XCircle, AlertTriangle,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import NurtureSettingsModal from './NurtureSettingsModal'

const PHASE_CONFIG = {
  week1: { color: 'from-red-500 to-red-600', ring: 'text-red-400', label: 'Tuan 1' },
  week2: { color: 'from-orange-500 to-orange-600', ring: 'text-orange-400', label: 'Tuan 2' },
  week3: { color: 'from-yellow-500 to-yellow-600', ring: 'text-yellow-400', label: 'Tuan 3' },
  week4: { color: 'from-blue-500 to-blue-600', ring: 'text-blue-400', label: 'Tuan 4' },
  mature: { color: 'from-green-500 to-green-600', ring: 'text-green-400', label: 'Truong thanh' },
}

const PERSONA_LABELS = {
  friendly: '😊 Than thien',
  casual: '😎 Thoai mai',
  professional: '💼 Chuyen nghiep',
  funny: '😂 Hai huoc',
}

function HealthRing({ score, size = 48 }) {
  const radius = (size - 6) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const color = score >= 80 ? '#4ade80' : score >= 50 ? '#facc15' : '#f87171'

  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={3} />
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth={3}
        strokeDasharray={circumference} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`}
        className="transition-all duration-500" />
      <text x={size/2} y={size/2} textAnchor="middle" dy="0.35em"
        className="text-xs font-bold" fill="#1f2937">{score}</text>
    </svg>
  )
}

function ProgressBar({ value, max, color = 'bg-purple-500' }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="flex-1 bg-gray-200 rounded-full h-1.5">
      <div className={`${color} h-1.5 rounded-full transition-all duration-300`} style={{ width: `${pct}%` }} />
    </div>
  )
}

const NICK_ACTION_CFG = {
  react: { label: 'React', color: 'bg-pink-100 text-pink-700' },
  comment: { label: 'Comment', color: 'bg-blue-100 text-blue-700' },
  story_view: { label: 'Story', color: 'bg-purple-100 text-purple-700' },
  feed_browse: { label: 'Browse', color: 'bg-gray-100 text-gray-600' },
  session_start: { label: 'Bắt đầu', color: 'bg-green-100 text-green-700' },
  session_end: { label: 'Kết thúc', color: 'bg-green-100 text-green-700' },
  error: { label: 'Lỗi', color: 'bg-red-100 text-red-700' },
  like: { label: 'Like', color: 'bg-pink-100 text-pink-700' },
}

function NickActivityLog({ accountId }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['nurture-activity-nick', accountId],
    queryFn: () => api.get(`/nurture/activity?account_id=${accountId}&limit=20`).then(r => r.data || []),
    enabled: !!accountId,
  })

  if (isLoading) return <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 text-center py-3">Đang tải...</div>
  if (!logs.length) return <div className="mt-3 pt-3 border-t border-gray-100 text-xs text-gray-400 text-center py-3">Chưa có hoạt động</div>

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <p className="text-[10px] font-medium text-gray-400 uppercase tracking-wider mb-2">Nhật ký gần đây</p>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {logs.map((log, i) => {
          const cfg = NICK_ACTION_CFG[log.action_type] || { label: log.action_type, color: 'bg-gray-100 text-gray-600' }
          const isFailed = log.result_status === 'failed'
          const d = log.details || {}
          return (
            <div key={log.id || i} className="flex items-center gap-2 text-xs">
              <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium ${isFailed ? 'bg-red-100 text-red-700' : cfg.color}`}>
                {cfg.label}
              </span>
              <span className="flex-1 text-gray-500 truncate">
                {d.comment_text || d.category || d.error || log.target_name || ''}
              </span>
              <span className="text-[10px] text-gray-400 shrink-0">
                {log.created_at ? formatDistanceToNow(new Date(log.created_at), { locale: vi, addSuffix: true }) : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function NurtureCard({ profile, jobStatus, onRun, onStop, onToggle, onSettings, onDelete, isExpanded, onToggleExpand }) {
  const acc = profile.account || {}
  const phase = PHASE_CONFIG[profile.phase] || PHASE_CONFIG.mature
  const avatar = acc.avatar_url || (acc.fb_user_id ? `https://graph.facebook.com/${acc.fb_user_id}/picture?type=large` : null)
  const isHealthy = acc.status === 'alive' || acc.status === 'healthy'
  const isRunning = jobStatus === 'running' || jobStatus === 'claimed'
  const isPending = jobStatus === 'pending'
  const isBusy = isRunning || isPending

  // Check if this nick is also in an AI Pilot campaign
  const inCampaign = profile.campaign_count > 0

  return (
    <div className={`bg-white rounded-xl border p-4 hover:shadow-md transition-all ${
      isRunning ? 'border-green-300 ring-1 ring-green-200' : isPending ? 'border-yellow-300' : 'border-gray-200'
    }`}>
      <div className="flex items-start gap-3 mb-3">
        {/* Avatar */}
        <div className="relative shrink-0">
          {avatar ? (
            <img src={avatar} alt="" className="w-11 h-11 rounded-full object-cover border border-gray-200"
              onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }} />
          ) : null}
          <div className={`w-11 h-11 rounded-full bg-gradient-to-br from-purple-500 to-blue-600 items-center justify-center text-white font-bold text-sm ${avatar ? 'hidden' : 'flex'}`}>
            {(acc.username || '?')[0].toUpperCase()}
          </div>
          <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
            isRunning ? 'bg-green-500 animate-pulse' : profile.enabled && isHealthy ? 'bg-green-500' : 'bg-gray-300'
          }`} />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-gray-900 truncate">{acc.username || 'Unknown'}</p>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full bg-gradient-to-r ${phase.color} text-white font-medium`}>
              {phase.label}
            </span>
            {/* Job status badge */}
            {isRunning && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 font-medium flex items-center gap-1">
                <Loader size={8} className="animate-spin" /> Dang chay
              </span>
            )}
            {isPending && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-yellow-100 text-yellow-700 font-medium flex items-center gap-1">
                <Clock size={8} /> Cho
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[10px] text-gray-500">{profile.age_days || 0}d</span>
            <span className="text-[10px] text-gray-300">·</span>
            <span className="text-[10px] text-gray-500">{PERSONA_LABELS[profile.persona] || profile.persona}</span>
            {inCampaign && (
              <>
                <span className="text-[10px] text-gray-300">·</span>
                <span className="text-[10px] text-orange-500 font-medium" title="Nick nay cung dang chay AI Pilot campaign">AI Pilot</span>
              </>
            )}
          </div>
        </div>

        {/* Health Ring */}
        <HealthRing score={profile.health_score || 100} size={40} />
      </div>

      {/* Progress Bars */}
      <div className="space-y-1.5 mb-3">
        <div className="flex items-center gap-2 text-[10px]">
          <Heart size={10} className="text-pink-400 shrink-0" />
          <span className="w-8 text-gray-500">React</span>
          <ProgressBar value={profile.today_reacts} max={profile.daily_reacts} color="bg-pink-500" />
          <span className="w-10 text-right text-gray-400">{profile.today_reacts}/{profile.daily_reacts}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <MessageCircle size={10} className="text-blue-400 shrink-0" />
          <span className="w-8 text-gray-500">Cmt</span>
          <ProgressBar value={profile.today_comments} max={profile.daily_comments} color="bg-blue-500" />
          <span className="w-10 text-right text-gray-400">{profile.today_comments}/{profile.daily_comments}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <Eye size={10} className="text-purple-400 shrink-0" />
          <span className="w-8 text-gray-500">Story</span>
          <ProgressBar value={profile.today_stories} max={profile.daily_story_views} color="bg-purple-500" />
          <span className="w-10 text-right text-gray-400">{profile.today_stories}/{profile.daily_story_views}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {/* Enable toggle */}
          <button
            onClick={() => onToggle(profile.id, !profile.enabled)}
            className={`relative w-8 h-4 rounded-full transition-colors ${profile.enabled ? 'bg-purple-600' : 'bg-gray-300'}`}
          >
            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform ${profile.enabled ? 'left-4' : 'left-0.5'}`} />
          </button>
          <span className="text-[10px] text-gray-500 ml-1">
            {profile.last_session_at ? formatDistanceToNow(new Date(profile.last_session_at), { addSuffix: true, locale: vi }) : 'Chua chay'}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isBusy ? (
            <button onClick={() => onStop(profile.account_id)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-red-600 bg-red-50 rounded-lg hover:bg-red-100 transition-colors" title="Dung">
              <Pause size={12} /> Dung
            </button>
          ) : (
            <button onClick={() => onRun(profile.id)}
              className="flex items-center gap-1 px-2 py-1 text-xs text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors" title="Chay ngay">
              <Play size={12} /> Chay
            </button>
          )}
          <button onClick={() => onSettings(profile)}
            className="p-1.5 text-gray-400 hover:bg-gray-100 rounded-lg transition-colors" title="Cai dat">
            <Settings size={14} />
          </button>
          <button onClick={() => onDelete(profile.id)}
            className="p-1.5 text-gray-500 hover:text-red-400 rounded-lg transition-colors" title="Xoa">
            <Trash2 size={12} />
          </button>
          <button onClick={onToggleExpand}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg transition-colors" title="Nhật ký">
            {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      </div>

      {/* Expandable: per-nick activity log */}
      {isExpanded && <NickActivityLog accountId={acc.id} />}
    </div>
  )
}

export default function NickNurture() {
  const queryClient = useQueryClient()
  const [settingsProfile, setSettingsProfile] = useState(null)
  const [showAddPicker, setShowAddPicker] = useState(false)
  const [expandedNick, setExpandedNick] = useState(null)

  // Nurture profiles
  const { data: profiles = [], isLoading } = useQuery({
    queryKey: ['nurture-profiles'],
    queryFn: () => api.get('/nurture/profiles').then(r => r.data),
    refetchInterval: 15000,
  })

  // Stats
  const { data: stats } = useQuery({
    queryKey: ['nurture-stats'],
    queryFn: () => api.get('/nurture/stats').then(r => r.data),
    refetchInterval: 30000,
  })

  // All accounts (for add picker)
  const { data: allAccounts = [] } = useQuery({
    queryKey: ['accounts-list'],
    queryFn: () => api.get('/accounts').then(r => r.data || []),
    enabled: showAddPicker,
  })

  // Active nurture jobs (to show running/pending state)
  const { data: nurtureJobs = [] } = useQuery({
    queryKey: ['nurture-jobs'],
    queryFn: () => api.get('/nurture/jobs').then(r => r.data || []).catch(() => []),
    refetchInterval: 5000,
  })

  // Build job status map: account_id -> status
  const jobStatusMap = {}
  for (const j of nurtureJobs) {
    const accId = j.payload?.account_id
    if (accId) jobStatusMap[accId] = j.status
  }

  // Job ID map for cancel
  const jobIdMap = {}
  for (const j of nurtureJobs) {
    const accId = j.payload?.account_id
    if (accId) jobIdMap[accId] = j.id
  }

  // Activity log
  const { data: activity = [] } = useQuery({
    queryKey: ['nurture-activity'],
    queryFn: () => api.get('/nurture/activity?limit=100').then(r => r.data || []),
    refetchInterval: 10000,
  })

  const profileAccountIds = new Set(profiles.map(p => p.account_id))
  const availableAccounts = allAccounts.filter(a => !profileAccountIds.has(a.id) && a.is_active)

  // Mutations
  const createMut = useMutation({
    mutationFn: (account_id) => api.post('/nurture/profiles', { account_id }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nurture-profiles'] }); toast.success('Da them nick') },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi'),
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, enabled }) => api.put(`/nurture/profiles/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['nurture-profiles'] }),
  })

  const stopMut = useMutation({
    mutationFn: (accountId) => {
      const jobId = jobIdMap[accountId]
      if (!jobId) return Promise.resolve()
      return api.post(`/nurture/jobs/${jobId}/cancel`)
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nurture-jobs'] }); toast.success('Da dung') },
    onError: (err) => toast.error(err.response?.data?.error || 'Khong the dung'),
  })

  const runMut = useMutation({
    mutationFn: (id) => api.post(`/nurture/profiles/${id}/run`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nurture-jobs'] }); queryClient.invalidateQueries({ queryKey: ['nurture-profiles'] }); toast.success('Da tao job nuoi nick') },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi'),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/nurture/profiles/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nurture-profiles'] }); toast.success('Da xoa') },
  })

  const bulkEnableMut = useMutation({
    mutationFn: () => api.post('/nurture/bulk-enable'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nurture-profiles'] }); toast.success('Da bat tat ca') },
  })

  const bulkDisableMut = useMutation({
    mutationFn: () => api.post('/nurture/bulk-disable'),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['nurture-profiles'] }); toast.success('Da tat tat ca') },
  })

  const ACTION_ICONS = {
    react: { icon: Heart, color: 'text-pink-400' },
    comment: { icon: MessageCircle, color: 'text-blue-400' },
    story_view: { icon: Eye, color: 'text-purple-400' },
    feed_browse: { icon: Activity, color: 'text-gray-400' },
    session_start: { icon: Play, color: 'text-green-400' },
    session_end: { icon: CheckCircle, color: 'text-green-400' },
    error: { icon: XCircle, color: 'text-red-400' },
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Sprout size={24} className="text-green-600" />
          <h1 className="text-2xl font-bold text-gray-900">Nuoi Nick</h1>
          <span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">
            {profiles.filter(p => p.enabled).length}/{profiles.length} active
          </span>
        </div>
        <div className="flex items-center gap-2">
          {profiles.length > 0 && (
            <>
              <button onClick={() => bulkEnableMut.mutate()}
                className="px-3 py-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors">
                Bat tat ca
              </button>
              <button onClick={() => bulkDisableMut.mutate()}
                className="px-3 py-1.5 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors">
                Tat tat ca
              </button>
            </>
          )}
          <button onClick={() => setShowAddPicker(!showAddPicker)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            <Plus size={14} /> Them nick
          </button>
        </div>
      </div>

      {/* Add Picker */}
      {showAddPicker && (
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <p className="text-xs text-gray-500 mb-2">Chon nick de bat dau nuoi:</p>
          {availableAccounts.length === 0 ? (
            <p className="text-xs text-gray-500 italic">Tat ca nick da duoc them hoac khong co nick active.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {availableAccounts.map(a => (
                <button key={a.id} onClick={() => { createMut.mutate(a.id); setShowAddPicker(false) }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 text-gray-600 border border-gray-200 rounded-lg text-xs hover:bg-gray-100 transition-colors">
                  <Plus size={10} /> {a.username || a.fb_user_id}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Info banner: Nuôi Nick vs AI Pilot */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 mb-4 flex items-start gap-2">
        <AlertTriangle size={14} className="text-blue-500 mt-0.5 shrink-0" />
        <div className="text-xs text-blue-700">
          <p className="font-medium mb-0.5">Nuoi Nick ≠ AI Pilot</p>
          <p className="text-blue-600">
            <strong>Nuoi Nick</strong>: Luot feed ca nhan, like/comment bai <strong>ban be</strong>, xem story — gia lap nguoi dung that.
            {' '}<strong>AI Pilot</strong>: Tuong tac trong <strong>group</strong> theo chien dich (like, comment, ket ban, dang bai).
            {' '}Hai he thong doc lap, co the chay song song tren cung 1 nick.
          </p>
        </div>
      </div>

      {/* Stats Summary */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Sessions</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{stats.today_sessions || 0}</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                <Activity size={14} className="text-green-600" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Reacts</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{stats.today_reacts || 0}</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-pink-50 flex items-center justify-center">
                <Heart size={14} className="text-pink-600" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Comments</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{stats.today_comments || 0}</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                <MessageCircle size={14} className="text-blue-600" />
              </div>
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[10px] text-gray-400 uppercase tracking-wider">Avg Health</p>
                <p className="text-xl font-bold text-gray-900 mt-0.5">{stats.avg_health || 0}%</p>
              </div>
              <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
                <Shield size={14} className="text-purple-600" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Profile Cards */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader size={24} className="animate-spin text-purple-400" />
        </div>
      ) : profiles.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-xl border border-gray-200">
          <Sprout size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 mb-2">Chua co nick nao duoc nuoi</p>
          <button onClick={() => setShowAddPicker(true)}
            className="text-purple-400 hover:underline text-sm">Them nick dau tien</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-6">
          {profiles.map(p => (
            <NurtureCard
              key={p.id}
              profile={p}
              jobStatus={jobStatusMap[p.account_id]}
              isExpanded={expandedNick === p.account_id}
              onToggleExpand={() => setExpandedNick(expandedNick === p.account_id ? null : p.account_id)}
              onRun={(id) => runMut.mutate(id)}
              onStop={(accountId) => stopMut.mutate(accountId)}
              onToggle={(id, enabled) => toggleMut.mutate({ id, enabled })}
              onSettings={(profile) => setSettingsProfile(profile)}
              onDelete={(id) => { if (confirm('Xoa nurture profile nay?')) deleteMut.mutate(id) }}
            />
          ))}
        </div>
      )}

      {/* Detailed Activity Log */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
            <Activity size={14} className="text-gray-500" /> Nhat ky hoat dong
          </h3>
          <span className="text-xs text-gray-400">{activity.length} entries</span>
        </div>

        {activity.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">Chua co hoat dong nao</div>
        ) : (
          <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
            {activity.map((a, i) => {
              const cfg = ACTION_ICONS[a.action_type] || ACTION_ICONS.feed_browse
              const Icon = cfg.icon
              const accName = a.nurture_profiles?.accounts?.username || '?'
              const accAvatar = a.nurture_profiles?.accounts?.avatar_url
              const isFailed = a.result_status === 'failed'
              const isSession = a.action_type === 'session_start' || a.action_type === 'session_end'
              const d = a.details || {}

              return (
                <div key={a.id || i} className={`px-4 py-3 hover:bg-gray-50 transition-colors ${isSession ? 'bg-gray-50/50' : ''}`}>
                  {/* Main row */}
                  <div className="flex items-center gap-2.5">
                    {/* Icon */}
                    <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isFailed ? 'bg-red-50' : isSession ? 'bg-gray-100' :
                      a.action_type === 'react' ? 'bg-pink-50' :
                      a.action_type === 'comment' ? 'bg-blue-50' :
                      a.action_type === 'story_view' ? 'bg-purple-50' : 'bg-gray-50'
                    }`}>
                      <Icon size={13} className={isFailed ? 'text-red-500' : cfg.color} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-gray-900">{accName}</span>
                        <span className="text-gray-300">·</span>
                        <span className={`text-xs font-medium ${
                          a.action_type === 'react' ? 'text-pink-600' :
                          a.action_type === 'comment' ? 'text-blue-600' :
                          a.action_type === 'story_view' ? 'text-purple-600' :
                          a.action_type === 'session_start' ? 'text-green-600' :
                          a.action_type === 'session_end' ? 'text-gray-500' :
                          a.action_type === 'error' ? 'text-red-600' :
                          'text-gray-500'
                        }`}>
                          {a.action_type === 'react' ? 'Liked bai ban be' :
                           a.action_type === 'comment' ? 'Comment bai ban be' :
                           a.action_type === 'story_view' ? 'Xem story' :
                           a.action_type === 'feed_browse' ? 'Luot feed' :
                           a.action_type === 'session_start' ? 'Bat dau session' :
                           a.action_type === 'session_end' ? 'Ket thuc session' :
                           a.action_type === 'error' ? 'Loi' :
                           a.action_type}
                        </span>
                        {isFailed && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full font-medium">FAILED</span>
                        )}
                        {a.result_status === 'skipped' && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-yellow-100 text-yellow-600 rounded-full font-medium">SKIPPED</span>
                        )}
                      </div>
                    </div>

                    {/* Timestamp */}
                    <span className="text-[11px] text-gray-400 shrink-0">
                      {a.created_at ? formatDistanceToNow(new Date(a.created_at), { addSuffix: true, locale: vi }) : ''}
                    </span>
                  </div>

                  {/* Detail rows */}
                  {(d.comment_text || d.category || d.post_text || d.scrolls || d.reacts || d.error || d.duration) && (
                    <div className="ml-9 mt-1.5 space-y-1">
                      {/* Comment text */}
                      {d.comment_text && (
                        <div className="flex items-start gap-1.5">
                          <MessageCircle size={10} className="text-gray-400 mt-0.5 shrink-0" />
                          <p className="text-xs text-gray-600">
                            "{d.comment_text}"
                            {d.category && (
                              <span className="ml-1.5 text-purple-500 text-[10px] font-medium">#{d.category}</span>
                            )}
                          </p>
                        </div>
                      )}

                      {/* Post text preview */}
                      {d.post_text && !d.comment_text && (
                        <p className="text-[11px] text-gray-400 truncate">Bai viet: "{d.post_text}"</p>
                      )}

                      {/* Session summary */}
                      {a.action_type === 'session_end' && (
                        <div className="flex items-center gap-3 text-[11px] text-gray-500">
                          {d.reacts !== undefined && <span>👍 {d.reacts} reacts</span>}
                          {d.comments !== undefined && <span>💬 {d.comments} comments</span>}
                          {d.stories !== undefined && <span>👁 {d.stories} stories</span>}
                          {d.duration && <span>⏱ {d.duration}s</span>}
                        </div>
                      )}

                      {/* Session start info */}
                      {a.action_type === 'session_start' && (
                        <div className="flex items-center gap-3 text-[11px] text-gray-500">
                          {d.persona && <span>🎭 {d.persona}</span>}
                          {d.age_days !== undefined && <span>📅 {d.age_days} ngay tuoi</span>}
                        </div>
                      )}

                      {/* Feed browse details */}
                      {a.action_type === 'feed_browse' && d.scrolls && (
                        <p className="text-[11px] text-gray-400">Scroll {d.scrolls} lan</p>
                      )}

                      {/* Error details */}
                      {d.error && (
                        <div className="flex items-start gap-1.5">
                          <XCircle size={10} className="text-red-400 mt-0.5 shrink-0" />
                          <p className="text-xs text-red-500">{d.error}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {settingsProfile && (
        <NurtureSettingsModal
          profile={settingsProfile}
          onClose={() => setSettingsProfile(null)}
          onSave={async (updates) => {
            await api.put(`/nurture/profiles/${settingsProfile.id}`, updates)
            queryClient.invalidateQueries({ queryKey: ['nurture-profiles'] })
            setSettingsProfile(null)
            toast.success('Da luu cai dat')
          }}
        />
      )}
    </div>
  )
}
