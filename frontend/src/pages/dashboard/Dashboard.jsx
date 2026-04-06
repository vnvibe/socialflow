import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Users, Clock, LayoutGrid, List, ChevronRight,
  Loader, Wifi, WifiOff, Zap, UserCheck, Send as SendIcon,
  Database,
} from 'lucide-react'
import api from '../../lib/api'

function getAvatarUrl(avatarUrl, fbUserId) {
  if (avatarUrl) return avatarUrl
  if (fbUserId && fbUserId !== '0') return `https://graph.facebook.com/${fbUserId}/picture?type=large`
  return null
}

function formatTime(isoStr) {
  if (!isoStr) return '--'
  const d = new Date(isoStr)
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
}

function TimeUntil({ scheduledAt }) {
  const [label, setLabel] = useState('')

  useEffect(() => {
    function calc() {
      if (!scheduledAt) { setLabel(''); return }
      const diff = new Date(scheduledAt) - Date.now()
      if (diff <= 0) { setLabel('Now'); return }
      const m = Math.floor(diff / 60000)
      const h = Math.floor(m / 60)
      if (h > 0) setLabel(`${h}h ${m % 60}m`)
      else setLabel(`${m}m`)
    }
    calc()
    const t = setInterval(calc, 30000)
    return () => clearInterval(t)
  }, [scheduledAt])

  if (!label) return null
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold">
      <Clock size={12} /> {label}
    </span>
  )
}

function StatusDot({ status }) {
  const alive = status === 'alive'
  return (
    <span
      className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${
        alive ? 'bg-green-500' : 'bg-gray-300'
      }`}
      title={alive ? 'Active' : 'Inactive'}
    />
  )
}

function AccountCard({ account, onClick }) {
  const avatar = getAvatarUrl(account.avatar_url, account.fb_user_id)

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-lg hover:border-blue-200 transition-all cursor-pointer group"
    >
      {/* Header: avatar + name + status */}
      <div className="flex items-start gap-3 mb-4">
        <div className="relative shrink-0">
          {avatar ? (
            <img
              src={avatar}
              alt={account.username}
              className="w-12 h-12 rounded-full object-cover border-2 border-gray-100"
              onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
            />
          ) : null}
          <div
            className={`w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 items-center justify-center text-white font-bold text-lg ${avatar ? 'hidden' : 'flex'}`}
          >
            {(account.username || '?')[0].toUpperCase()}
          </div>
          <StatusDot status={account.status} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-bold text-gray-900 truncate">{account.username}</h3>
          <p className="text-xs text-gray-500 truncate mt-0.5">
            {account.role_description || account.campaign_roles?.[0]?.mission || 'Chua co nhiem vu'}
          </p>
        </div>
      </div>

      {/* Routine counts */}
      <div className="flex gap-3 mb-4">
        <div className="flex-1 bg-blue-50 rounded-lg py-2.5 text-center">
          <p className="text-lg font-bold text-blue-700">{account.total_routines || 0}</p>
          <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wider">Routines</p>
        </div>
        <div className="flex-1 bg-green-50 rounded-lg py-2.5 text-center">
          <p className="text-lg font-bold text-green-700">{account.active_routines || 0}</p>
          <p className="text-[10px] font-semibold text-green-500 uppercase tracking-wider">Active</p>
        </div>
      </div>

      {/* Next scheduled + expand */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <Clock size={12} />
          <span>Next:</span>
          <span className="font-semibold text-gray-600">
            {formatTime(account.next_scheduled_at)}
          </span>
        </div>
        <button className="flex items-center gap-1 text-xs text-gray-400 group-hover:text-blue-600 transition-colors">
          <ChevronRight size={14} />
          <span>Xem {account.total_routines || 0} routines</span>
        </button>
      </div>
    </div>
  )
}

function AccountRow({ account, onClick }) {
  const avatar = getAvatarUrl(account.avatar_url, account.fb_user_id)

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg border border-gray-200 px-4 py-3 hover:shadow-md hover:border-blue-200 transition-all cursor-pointer flex items-center gap-4"
    >
      <div className="relative shrink-0">
        {avatar ? (
          <img
            src={avatar}
            alt={account.username}
            className="w-10 h-10 rounded-full object-cover border border-gray-100"
            onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex' }}
          />
        ) : null}
        <div
          className={`w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 items-center justify-center text-white font-bold ${avatar ? 'hidden' : 'flex'}`}
        >
          {(account.username || '?')[0].toUpperCase()}
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <StatusDot status={account.status} />
          <span className="text-sm font-semibold text-gray-900 truncate">{account.username}</span>
        </div>
        <p className="text-xs text-gray-500 truncate">
          {account.role_description || account.campaign_roles?.[0]?.mission || 'Chua co nhiem vu'}
        </p>
      </div>
      <div className="flex items-center gap-4 text-xs text-gray-500 shrink-0">
        <span className="font-semibold text-blue-600">{account.total_routines || 0} routines</span>
        <span className="font-semibold text-green-600">{account.active_routines || 0} active</span>
        <span>Next: {formatTime(account.next_scheduled_at)}</span>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [viewMode, setViewMode] = useState('grid')

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-v2'],
    queryFn: () => api.get('/analytics/dashboard-v2').then(r => r.data),
    refetchInterval: 30000,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 text-sm">Khong the tai du lieu. Vui long thu lai.</p>
      </div>
    )
  }

  const { agent, nextTask, accounts = [], stats = {} } = data || {}
  const now = new Date()
  const timeStr = now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className="space-y-6">
      {/* Top Bar: Agent Status + Next Task */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex flex-col lg:flex-row lg:items-center gap-4">
          {/* Agent status */}
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${agent?.online ? 'bg-green-100' : 'bg-red-100'}`}>
              {agent?.online ? <Wifi size={18} className="text-green-600" /> : <WifiOff size={18} className="text-red-600" />}
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">
                {agent?.online ? 'May chay' : 'May nghi'}
              </p>
              <p className="text-xs text-gray-400">
                Thoi gian hien tai: {timeStr}
              </p>
            </div>
          </div>

          {/* Next task */}
          {nextTask && (
            <div className="flex-1 flex items-center gap-3 lg:justify-center">
              <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Next Scheduled Task</span>
              <p className="text-sm font-semibold text-gray-800">{nextTask.description}</p>
              <span className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-bold rounded uppercase">
                {nextTask.type?.includes('page') ? 'Page' : nextTask.type?.includes('group') ? 'Group' : 'Task'}
              </span>
              <TimeUntil scheduledAt={nextTask.scheduled_at} />
            </div>
          )}

          {/* View toggle */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:bg-gray-100'}`}
            >
              <List size={18} />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-gray-200 text-gray-700' : 'text-gray-400 hover:bg-gray-100'}`}
            >
              <LayoutGrid size={18} />
            </button>
            <button
              onClick={() => navigate('/campaigns/new')}
              className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors ml-2"
            >
              <Zap size={14} />
              Tao Nhan vat Task
            </button>
          </div>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
            <Users size={16} className="text-blue-600" />
          </div>
          <div>
            <p className="text-lg font-bold text-gray-900">{accounts.length}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Nhan vat</p>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-purple-50 flex items-center justify-center">
            <Database size={16} className="text-purple-600" />
          </div>
          <div>
            <p className="text-lg font-bold text-gray-900">{stats.total_leads || 0}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Leads</p>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
            <SendIcon size={16} className="text-green-600" />
          </div>
          <div>
            <p className="text-lg font-bold text-gray-900">{stats.friend_sent || 0}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Friend Sent</p>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-3 flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center">
            <UserCheck size={16} className="text-orange-600" />
          </div>
          <div>
            <p className="text-lg font-bold text-gray-900">{stats.connected || 0}</p>
            <p className="text-[10px] text-gray-500 uppercase tracking-wider">Connected</p>
          </div>
        </div>
      </div>

      {/* Account Cards */}
      {accounts.length === 0 ? (
        <div className="text-center py-16">
          <Users size={48} className="mx-auto text-gray-300 mb-3" />
          <p className="text-gray-500 text-sm">Chua co nhan vat nao</p>
          <button
            onClick={() => navigate('/accounts')}
            className="mt-3 text-blue-600 hover:underline text-sm"
          >
            Them tai khoan dau tien
          </button>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {accounts.map(acc => (
            <AccountCard
              key={acc.id}
              account={acc}
              onClick={() => navigate(`/accounts/${acc.id}`)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {accounts.map(acc => (
            <AccountRow
              key={acc.id}
              account={acc}
              onClick={() => navigate(`/accounts/${acc.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
