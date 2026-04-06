import { useState } from 'react'
import { X, Save, Smile, Coffee, Briefcase, Laugh } from 'lucide-react'

const PERSONAS = [
  { value: 'friendly', label: 'Than thien', emoji: '😊', desc: 'Comment am ap, than thien', icon: Smile },
  { value: 'casual', label: 'Thoai mai', emoji: '😎', desc: 'Ngan gon, thoai mai, cool', icon: Coffee },
  { value: 'professional', label: 'Chuyen nghiep', emoji: '💼', desc: 'Lich su, trang trong', icon: Briefcase },
  { value: 'funny', label: 'Hai huoc', emoji: '😂', desc: 'Vui ve, dua nhieu', icon: Laugh },
]

const DAY_LABELS = [
  { value: 1, label: 'T2' }, { value: 2, label: 'T3' }, { value: 3, label: 'T4' },
  { value: 4, label: 'T5' }, { value: 5, label: 'T6' }, { value: 6, label: 'T7' },
  { value: 0, label: 'CN' },
]

export default function NurtureSettingsModal({ profile, onClose, onSave }) {
  const [persona, setPersona] = useState(profile.persona || 'friendly')
  const [dailyReacts, setDailyReacts] = useState(profile.daily_reacts || 15)
  const [dailyComments, setDailyComments] = useState(profile.daily_comments || 3)
  const [dailyStories, setDailyStories] = useState(profile.daily_story_views || 5)
  const [dailySessions, setDailySessions] = useState(profile.daily_feed_scrolls || 3)
  const [activeHoursStart, setActiveHoursStart] = useState(profile.active_hours?.start ?? 7)
  const [activeHoursEnd, setActiveHoursEnd] = useState(profile.active_hours?.end ?? 23)
  const [activeDays, setActiveDays] = useState(profile.active_days || [1, 2, 3, 4, 5, 6, 0])
  const [sessionGap, setSessionGap] = useState(profile.min_session_gap_minutes || 60)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave({
        persona,
        daily_reacts: dailyReacts,
        daily_comments: dailyComments,
        daily_story_views: dailyStories,
        daily_feed_scrolls: dailySessions,
        active_hours: { start: activeHoursStart, end: activeHoursEnd },
        active_days: activeDays,
        min_session_gap_minutes: sessionGap,
      })
    } finally {
      setSaving(false)
    }
  }

  const toggleDay = (day) => {
    const next = activeDays.includes(day) ? activeDays.filter(d => d !== day) : [...activeDays, day].sort()
    if (next.length > 0) setActiveDays(next)
  }

  const accName = profile.account?.username || 'Unknown'

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-bold text-gray-900">Cai dat nuoi nick</h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        <p className="text-xs text-gray-500 mb-4">Nick: <span className="text-purple-600 font-medium">{accName}</span></p>

        <div className="space-y-5">
          {/* Persona */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-2 block">Phong cach comment</label>
            <div className="grid grid-cols-2 gap-2">
              {PERSONAS.map(p => (
                <button
                  key={p.value}
                  onClick={() => setPersona(p.value)}
                  className={`flex items-center gap-2 p-3 rounded-xl border-2 transition-all text-left ${
                    persona === p.value
                      ? 'border-purple-300 bg-purple-50'
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <span className="text-xl">{p.emoji}</span>
                  <div>
                    <p className="text-xs font-medium text-gray-900">{p.label}</p>
                    <p className="text-[10px] text-gray-500">{p.desc}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Daily Targets */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-3 block">Muc tieu hang ngay</label>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">Sessions/ngay</span>
                  <span className="text-xs text-purple-600 font-bold">{dailySessions}</span>
                </div>
                <input type="range" min={1} max={10} value={dailySessions} onChange={e => setDailySessions(parseInt(e.target.value))} className="w-full" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">React/ngay</span>
                  <span className="text-xs text-pink-600 font-bold">{dailyReacts}</span>
                </div>
                <input type="range" min={1} max={50} value={dailyReacts} onChange={e => setDailyReacts(parseInt(e.target.value))} className="w-full" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">Comment/ngay</span>
                  <span className="text-xs text-blue-600 font-bold">{dailyComments}</span>
                </div>
                <input type="range" min={0} max={10} value={dailyComments} onChange={e => setDailyComments(parseInt(e.target.value))} className="w-full" />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">Story views/ngay</span>
                  <span className="text-xs text-purple-600 font-bold">{dailyStories}</span>
                </div>
                <input type="range" min={0} max={20} value={dailyStories} onChange={e => setDailyStories(parseInt(e.target.value))} className="w-full" />
              </div>
            </div>
          </div>

          {/* Active Hours */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-2 block">Gio hoat dong</label>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <span className="text-[10px] text-gray-500 block mb-1">Tu</span>
                <select value={activeHoursStart} onChange={e => setActiveHoursStart(parseInt(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                  {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}
                </select>
              </div>
              <span className="text-gray-400 mt-4">—</span>
              <div className="flex-1">
                <span className="text-[10px] text-gray-500 block mb-1">Den</span>
                <select value={activeHoursEnd} onChange={e => setActiveHoursEnd(parseInt(e.target.value))}
                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm">
                  {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}:00</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Active Days */}
          <div>
            <label className="text-xs font-medium text-gray-500 mb-2 block">Ngay hoat dong</label>
            <div className="flex gap-1.5">
              {DAY_LABELS.map(d => (
                <button key={d.value} onClick={() => toggleDay(d.value)}
                  className={`w-9 h-9 rounded-full text-xs font-medium transition-colors ${
                    activeDays.includes(d.value) ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                  }`}>
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {/* Session Gap */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-medium text-gray-500">Khoang cach giua cac session</label>
              <span className="text-xs text-purple-600 font-bold">{sessionGap} phut</span>
            </div>
            <input type="range" min={15} max={480} step={15} value={sessionGap}
              onChange={e => setSessionGap(parseInt(e.target.value))} className="w-full" />
            <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
              <span>15 phut</span>
              <span>8 gio</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-gray-200">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700">Huy</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-50">
            <Save size={14} /> {saving ? 'Dang luu...' : 'Luu cai dat'}
          </button>
        </div>
      </div>
    </div>
  )
}
