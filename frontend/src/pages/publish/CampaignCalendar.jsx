import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Calendar, Clock, CheckCircle, XCircle, AlertCircle, Loader } from 'lucide-react'
import api from '../../lib/api'

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  claimed: 'bg-blue-100 text-blue-700 border-blue-200',
  running: 'bg-blue-100 text-blue-700 border-blue-200',
  done: 'bg-green-100 text-green-700 border-green-200',
  success: 'bg-green-100 text-green-700 border-green-200',
  failed: 'bg-red-100 text-red-700 border-red-200',
  cancelled: 'bg-gray-100 text-gray-500 border-gray-200',
}

const STATUS_DOTS = {
  pending: 'bg-yellow-400',
  claimed: 'bg-blue-400',
  running: 'bg-blue-500',
  done: 'bg-green-500',
  success: 'bg-green-500',
  failed: 'bg-red-500',
  cancelled: 'bg-gray-400',
}

function getMonthDays(year, month) {
  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const days = []

  // Previous month padding
  const prevMonthDays = new Date(year, month, 0).getDate()
  for (let i = firstDay - 1; i >= 0; i--) {
    days.push({ day: prevMonthDays - i, current: false, date: new Date(year, month - 1, prevMonthDays - i) })
  }

  // Current month
  for (let d = 1; d <= daysInMonth; d++) {
    days.push({ day: d, current: true, date: new Date(year, month, d) })
  }

  // Next month padding
  const remaining = 42 - days.length
  for (let d = 1; d <= remaining; d++) {
    days.push({ day: d, current: false, date: new Date(year, month + 1, d) })
  }

  return days
}

export default function CampaignCalendar() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [selectedDay, setSelectedDay] = useState(null)
  const [view, setView] = useState('month') // 'month' | 'week'

  const year = currentDate.getFullYear()
  const month = currentDate.getMonth()

  // Calculate date range for API query
  const startOfMonth = new Date(year, month, 1)
  const endOfMonth = new Date(year, month + 1, 0, 23, 59, 59)

  const { data: events = [], isLoading } = useQuery({
    queryKey: ['calendar-events', year, month],
    queryFn: () => api.get('/campaigns/calendar', {
      params: {
        start: startOfMonth.toISOString(),
        end: endOfMonth.toISOString(),
      }
    }).then(r => r.data),
    refetchInterval: 30000,
  })

  const days = useMemo(() => getMonthDays(year, month), [year, month])

  // Group events by day
  const eventsByDay = useMemo(() => {
    const map = {}
    for (const event of events) {
      const d = new Date(event.start)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!map[key]) map[key] = []
      map[key].push(event)
    }
    return map
  }, [events])

  const navigate = (delta) => {
    setCurrentDate(new Date(year, month + delta, 1))
    setSelectedDay(null)
  }

  const today = new Date()
  const isToday = (date) =>
    date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear()

  const getDayEvents = (date) => {
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    return eventsByDay[key] || []
  }

  const selectedDayEvents = selectedDay ? getDayEvents(selectedDay) : []

  const monthName = currentDate.toLocaleDateString('en', { month: 'long', year: 'numeric' })

  // Stats
  const stats = useMemo(() => {
    const s = { total: events.length, done: 0, pending: 0, failed: 0 }
    for (const e of events) {
      if (e.status === 'done' || e.status === 'success') s.done++
      else if (e.status === 'failed') s.failed++
      else s.pending++
    }
    return s
  }, [events])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Calendar</h1>
          <p className="text-sm text-gray-500 mt-1">Post schedule and history overview</p>
        </div>
        <div className="flex items-center gap-4">
          {/* Stats */}
          <div className="flex items-center gap-3 text-sm">
            <span className="flex items-center gap-1 text-green-600">
              <CheckCircle className="w-4 h-4" /> {stats.done}
            </span>
            <span className="flex items-center gap-1 text-yellow-600">
              <Clock className="w-4 h-4" /> {stats.pending}
            </span>
            <span className="flex items-center gap-1 text-red-600">
              <XCircle className="w-4 h-4" /> {stats.failed}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <ChevronLeft className="w-5 h-5 text-gray-600" />
          </button>
          <h2 className="text-lg font-semibold text-gray-900">{monthName}</h2>
          <button onClick={() => navigate(1)} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <ChevronRight className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
            <div key={d} className="text-center text-xs font-medium text-gray-500 py-2">{d}</div>
          ))}
        </div>

        {/* Calendar grid */}
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <Loader className="w-6 h-6 animate-spin text-blue-500" />
          </div>
        ) : (
          <div className="grid grid-cols-7 gap-px bg-gray-100 rounded-lg overflow-hidden">
            {days.map((day, i) => {
              const dayEvents = getDayEvents(day.date)
              const isSelected = selectedDay &&
                day.date.getDate() === selectedDay.getDate() &&
                day.date.getMonth() === selectedDay.getMonth()

              return (
                <button
                  key={i}
                  onClick={() => setSelectedDay(day.date)}
                  className={`min-h-[80px] p-1.5 text-left transition-colors ${
                    day.current ? 'bg-white' : 'bg-gray-50'
                  } ${isSelected ? 'ring-2 ring-blue-500 ring-inset' : ''} hover:bg-blue-50`}
                >
                  <span className={`text-xs font-medium ${
                    isToday(day.date)
                      ? 'bg-blue-600 text-white w-6 h-6 rounded-full flex items-center justify-center'
                      : day.current ? 'text-gray-700' : 'text-gray-400'
                  }`}>
                    {day.day}
                  </span>

                  {/* Event dots */}
                  {dayEvents.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {dayEvents.slice(0, 3).map((e, j) => (
                        <div key={j} className={`h-1.5 rounded-full ${STATUS_DOTS[e.status] || 'bg-gray-300'}`} />
                      ))}
                      {dayEvents.length > 3 && (
                        <span className="text-[10px] text-gray-400">+{dayEvents.length - 3}</span>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Selected day detail */}
      {selectedDay && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h3 className="font-semibold text-gray-900 mb-3">
            {selectedDay.toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
            <span className="text-sm font-normal text-gray-500 ml-2">
              ({selectedDayEvents.length} event{selectedDayEvents.length !== 1 ? 's' : ''})
            </span>
          </h3>

          {selectedDayEvents.length === 0 ? (
            <p className="text-sm text-gray-400 py-4 text-center">No events on this day</p>
          ) : (
            <div className="space-y-2">
              {selectedDayEvents
                .sort((a, b) => new Date(a.start) - new Date(b.start))
                .map((event) => (
                <div
                  key={event.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border ${STATUS_COLORS[event.status] || 'bg-gray-50 border-gray-200'}`}
                >
                  <div className="shrink-0 mt-0.5">
                    {(event.status === 'done' || event.status === 'success') && <CheckCircle className="w-4 h-4 text-green-600" />}
                    {event.status === 'failed' && <XCircle className="w-4 h-4 text-red-600" />}
                    {event.status === 'pending' && <Clock className="w-4 h-4 text-yellow-600" />}
                    {(event.status === 'running' || event.status === 'claimed') && <Loader className="w-4 h-4 text-blue-600 animate-spin" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{event.title}</span>
                      <span className="text-xs text-gray-500">
                        {new Date(event.start).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    {event.target_name && (
                      <p className="text-xs mt-0.5 opacity-75">{event.target_name}</p>
                    )}
                    {event.caption_preview && (
                      <p className="text-xs mt-1 opacity-60 truncate">{event.caption_preview}</p>
                    )}
                    {event.error && (
                      <p className="text-xs mt-1 text-red-600">{event.error}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
