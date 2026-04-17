/**
 * ProactiveAlerts — polls /notifications every 10s and fires a react-hot-toast
 * for any unread level='urgent' notification we haven't shown yet.
 *
 * Click the toast → navigates to /agents?repair={account_id} so AgentsRoster
 * opens the CookieRepairModal for that nick automatically.
 *
 * Mounted in TopBar so it follows the user across the whole app.
 */
import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { AlertTriangle } from 'lucide-react'
import api from '../../lib/api'

// Soft "knock" sound (2-tone chirp) — we synthesize via Web Audio so no asset file.
function playAlertSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc1 = ctx.createOscillator()
    const g1 = ctx.createGain()
    osc1.type = 'sine'; osc1.frequency.value = 880
    g1.gain.setValueAtTime(0.001, ctx.currentTime)
    g1.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01)
    g1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3)
    osc1.connect(g1).connect(ctx.destination)
    osc1.start(); osc1.stop(ctx.currentTime + 0.3)
    const osc2 = ctx.createOscillator()
    const g2 = ctx.createGain()
    osc2.type = 'sine'; osc2.frequency.value = 1318
    g2.gain.setValueAtTime(0.001, ctx.currentTime + 0.15)
    g2.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.16)
    g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)
    osc2.connect(g2).connect(ctx.destination)
    osc2.start(ctx.currentTime + 0.15); osc2.stop(ctx.currentTime + 0.5)
  } catch {
    // Audio context unavailable (browser policy before user gesture) — silent.
  }
}

export default function ProactiveAlerts() {
  const nav = useNavigate()
  // seenIds survives re-renders but not page reload (localStorage keeps it across reloads)
  const seenIds = useRef(new Set(
    JSON.parse(localStorage.getItem('proactive-alerts-seen') || '[]')
  ))

  const { data } = useQuery({
    queryKey: ['proactive-notifications'],
    queryFn: async () => (await api.get('/notifications?limit=10&level=urgent&is_read=false')).data,
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  })

  useEffect(() => {
    const rows = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
    if (!rows.length) return

    const newOnes = rows.filter(n => !seenIds.current.has(n.id))
    if (!newOnes.length) return

    for (const n of newOnes) {
      seenIds.current.add(n.id)
      const accountId = n.data?.account_id || n.data?.target_id || null
      toast.custom((t) => (
        <div
          onClick={() => {
            toast.dismiss(t.id)
            if (accountId) nav(`/agents?repair=${accountId}`)
            else nav('/agents')
          }}
          className="max-w-md rounded-xl shadow-xl cursor-pointer"
          style={{
            background: '#fef2f2',
            border: '2px solid #dc2626',
            color: '#7f1d1d',
            padding: '14px 18px',
          }}
        >
          <div className="flex items-start gap-3">
            <AlertTriangle size={20} className="shrink-0 mt-0.5" style={{ color: '#dc2626' }} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{n.title || 'Cảnh báo khẩn'}</div>
              {n.body && (
                <div className="text-xs mt-1 opacity-90 line-clamp-3">{n.body}</div>
              )}
              {accountId && (
                <div className="text-xs mt-2 font-medium" style={{ color: '#dc2626' }}>
                  Click để sửa cookie →
                </div>
              )}
            </div>
          </div>
        </div>
      ), { duration: 15000, id: `alert-${n.id}` })
    }

    playAlertSound()
    // Persist seen IDs — keep only last 500 to bound storage
    const arr = [...seenIds.current]
    localStorage.setItem('proactive-alerts-seen', JSON.stringify(arr.slice(-500)))
  }, [data, nav])

  return null
}
