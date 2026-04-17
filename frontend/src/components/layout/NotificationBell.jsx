import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Bell, AlertTriangle, Key, XCircle, Info, AlertCircle, Check } from 'lucide-react'
import api from '../../lib/api'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'

const TYPE_CONFIG = {
  checkpoint:      { icon: AlertTriangle, color: 'text-red-500', bg: 'bg-red-50' },
  session_expired: { icon: Key,           color: 'text-orange-500', bg: 'bg-orange-50' },
  cookie_expired:  { icon: Key,           color: 'text-orange-500', bg: 'bg-orange-50' },
  campaign_error:  { icon: XCircle,       color: 'text-red-500', bg: 'bg-red-50' },
  job_failed:      { icon: XCircle,       color: 'text-red-500', bg: 'bg-red-50' },
  campaign_complete: { icon: Check,       color: 'text-hermes', bg: 'bg-green-50' },
  daily_budget_hit:  { icon: AlertCircle, color: 'text-yellow-500', bg: 'bg-yellow-50' },
  info:            { icon: Info,          color: 'text-blue-500', bg: 'bg-blue-50' },
}

const LEVEL_BORDER = {
  urgent: 'border-l-red-500',
  warning: 'border-l-yellow-500',
  info: 'border-l-blue-500',
}

export default function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef(null)
  const queryClient = useQueryClient()

  // Unread count (poll every 30s)
  const { data: countData } = useQuery({
    queryKey: ['notifications-count'],
    queryFn: () => api.get('/notifications/unread-count').then(r => r.data),
    refetchInterval: 30000,
  })
  const unreadCount = countData?.count || 0

  // Full list (only when open)
  const { data: notifData } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications?limit=20').then(r => r.data),
    enabled: isOpen,
    refetchInterval: isOpen ? 15000 : false,
  })
  const notifications = notifData?.data || []

  // Mark single read
  const readMut = useMutation({
    mutationFn: (id) => api.put(`/notifications/${id}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-count'] })
    },
  })

  // Mark all read
  const readAllMut = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] })
      queryClient.invalidateQueries({ queryKey: ['notifications-count'] })
    },
  })

  // Close on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    if (isOpen) document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-app-dim hover:text-app-muted transition-colors"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[10px] font-bold rounded-full px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-80 bg-app-surface rounded border border-app-border  z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-app-border">
            <h3 className="font-semibold text-app-primary text-sm">Thong bao</h3>
            {unreadCount > 0 && (
              <button
                onClick={() => readAllMut.mutate()}
                className="text-xs text-blue-600 hover:underline"
              >
                Doc tat ca
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="text-center py-8 text-app-dim text-sm">
                Khong co thong bao
              </div>
            ) : (
              notifications.map(n => {
                const config = TYPE_CONFIG[n.type] || TYPE_CONFIG.info
                const Icon = config.icon
                const borderColor = LEVEL_BORDER[n.level] || LEVEL_BORDER.info

                return (
                  <div
                    key={n.id}
                    onClick={() => { if (!n.is_read) readMut.mutate(n.id) }}
                    className={`px-4 py-3 border-b border-gray-50 border-l-3 cursor-pointer hover:bg-app-base transition-colors ${borderColor} ${
                      n.is_read ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${config.bg}`}>
                        <Icon size={14} className={config.color} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-app-primary truncate">{n.title}</p>
                        {n.body && <p className="text-xs text-app-muted mt-0.5 line-clamp-2">{n.body}</p>}
                        <p className="text-[10px] text-app-dim mt-1">
                          {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: vi })}
                        </p>
                      </div>
                      {!n.is_read && (
                        <div className="w-2 h-2 rounded-full bg-info flex-shrink-0 mt-1.5" />
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
