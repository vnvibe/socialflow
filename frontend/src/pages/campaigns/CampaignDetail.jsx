import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate } from 'react-router-dom'
import { Target, ArrowLeft, Play, Pause, Edit, BarChart3, Users, UserPlus, Crosshair, CheckCircle, XCircle, Clock } from 'lucide-react'
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
  { key: 'overview', label: 'Tong quan', icon: BarChart3 },
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
    refetchInterval: 10000,
  })

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
          <Target size={24} className="text-blue-600" />
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
          {role.parsed_plan && (
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
