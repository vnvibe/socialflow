import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Database, Crosshair, UserPlus, ChevronLeft, ChevronRight, Loader, Search } from 'lucide-react'
import api from '../../../lib/api'
import { format } from 'date-fns'

// Shared AI Type Badge
function AITypeBadge({ type }) {
  if (!type) return <span className="text-xs text-gray-600">--</span>
  const config = {
    potential_buyer: { label: 'Khach', color: 'bg-green-100 text-green-700' },
    competitor:      { label: 'Doi thu', color: 'bg-red-100 text-red-700' },
    irrelevant:      { label: 'Khong lq', color: 'bg-gray-100 text-gray-500' },
    spam:            { label: 'Spam', color: 'bg-red-100 text-red-700' },
    unknown:         { label: '?', color: 'bg-yellow-100 text-yellow-700' },
  }
  const c = config[type] || config.unknown
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${c.color}`}>{c.label}</span>
}

function ScoreBadge({ score }) {
  if (score === null || score === undefined) return <span className="text-xs text-gray-600">--</span>
  const color = score >= 7 ? 'text-green-600' : score >= 4 ? 'text-yellow-600' : 'text-red-500'
  return <span className={`text-xs font-bold ${color}`}>{score}/10</span>
}

const LEAD_STATUS = {
  discovered:  { label: 'Discovered',  color: 'bg-blue-100 text-blue-700' },
  friend_sent: { label: 'Friend Sent', color: 'bg-yellow-100 text-yellow-700' },
  followed:    { label: 'Followed',    color: 'bg-green-100 text-green-700' },
  connected:   { label: 'Connected',   color: 'bg-emerald-100 text-emerald-700' },
  skipped:     { label: 'Skipped',     color: 'bg-gray-100 text-gray-600' },
}

const TARGET_STATUS = {
  pending:  { color: 'bg-yellow-100 text-yellow-700' },
  assigned: { color: 'bg-blue-100 text-blue-700' },
  done:     { color: 'bg-green-100 text-green-700' },
  failed:   { color: 'bg-red-100 text-red-700' },
  skip:     { color: 'bg-gray-100 text-gray-600' },
}

const FRIEND_STATUS = {
  sent:           { color: 'bg-blue-100 text-blue-700' },
  accepted:       { color: 'bg-green-100 text-green-700' },
  declined:       { color: 'bg-red-100 text-red-700' },
  cancelled:      { color: 'bg-orange-100 text-orange-700' },
  already_friend: { color: 'bg-gray-100 text-gray-600' },
}

const SUB_TABS = [
  { key: 'targets', label: 'Target Queue', icon: Crosshair },
  { key: 'friends', label: 'Friend Log', icon: UserPlus },
  { key: 'leads',   label: 'Leads Pipeline', icon: Database },
]

export default function DataCenterSection({ campaignId, accountIds }) {
  const [subTab, setSubTab] = useState('targets')
  const [leadsPage, setLeadsPage] = useState(1)
  const [leadsSearch, setLeadsSearch] = useState('')

  // Target Queue
  const { data: targetsData } = useQuery({
    queryKey: ['campaign-targets', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/targets?limit=50`).then(r => r.data),
    enabled: subTab === 'targets',
  })

  // Friend Log
  const { data: friendsData } = useQuery({
    queryKey: ['campaign-friends', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/friend-log?limit=50`).then(r => r.data),
    enabled: subTab === 'friends',
  })

  // Campaign-scoped Leads
  const { data: leadsData, isLoading: leadsLoading } = useQuery({
    queryKey: ['campaign-leads', campaignId, leadsPage, leadsSearch],
    queryFn: () => {
      const params = new URLSearchParams({ page: leadsPage, limit: 50 })
      if (leadsSearch) params.set('search', leadsSearch)
      return api.get(`/campaigns/${campaignId}/leads?${params}`).then(r => r.data)
    },
    enabled: subTab === 'leads',
  })

  const targets = targetsData?.data || targetsData || []
  const friends = friendsData?.data || friendsData || []
  const leads = leadsData?.data || []
  const leadsStats = leadsData?.stats || {}

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-bold text-gray-900">Data Center</h2>

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        {SUB_TABS.map(t => (
          <button key={t.key} onClick={() => setSubTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              subTab === t.key ? 'bg-white text-gray-900 shadow-sm rounded-md' : 'text-gray-500 hover:text-gray-700 rounded-md transition-colors'
            }`}>
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {/* ══════ TARGET QUEUE ══════ */}
      {subTab === 'targets' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-[1fr_100px_60px_70px_80px] gap-2 px-4 py-2.5 bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase">
            <div>Target</div>
            <div>Nguon</div>
            <div>Score</div>
            <div>AI Type</div>
            <div>Status</div>
          </div>
          {targets.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">Chua co target</div>
          ) : targets.map((t, i) => {
            const st = TARGET_STATUS[t.status] || TARGET_STATUS.pending
            return (
              <div key={t.id || i} className="grid grid-cols-[1fr_100px_60px_70px_80px] gap-2 px-4 py-2.5 border-b border-gray-100 text-sm items-center hover:bg-gray-50 transition-colors">
                <div className="truncate text-gray-900">{t.fb_user_name || t.fb_user_id || '?'}</div>
                <div className="truncate text-xs text-gray-500">{t.source_group_name || '-'}</div>
                <ScoreBadge score={t.ai_score || Math.round(t.active_score || 0)} />
                <AITypeBadge type={t.ai_type} />
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{t.status}</span>
              </div>
            )
          })}
          {targetsData?.total > 50 && (
            <div className="px-4 py-2 text-xs text-gray-500 bg-gray-50 border-b">
              Hien {targets.length}/{targetsData.total}
            </div>
          )}
        </div>
      )}

      {/* ══════ FRIEND LOG ══════ */}
      {subTab === 'friends' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="grid grid-cols-[1fr_60px_70px_80px_100px] gap-2 px-4 py-2.5 bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase">
            <div>Target</div>
            <div>Score</div>
            <div>AI Type</div>
            <div>Status</div>
            <div>Gui luc</div>
          </div>
          {friends.length === 0 ? (
            <div className="text-center py-12 text-gray-500 text-sm">Chua co friend request</div>
          ) : friends.map((f, i) => {
            const st = FRIEND_STATUS[f.status] || FRIEND_STATUS.sent
            return (
              <div key={f.id || i} className="grid grid-cols-[1fr_60px_70px_80px_100px] gap-2 px-4 py-2.5 border-b border-gray-100 text-sm items-center hover:bg-gray-50 transition-colors">
                <div className="truncate text-gray-900">{f.target_name || f.target_fb_id || '?'}</div>
                <ScoreBadge score={f.ai_score} />
                <AITypeBadge type={f.ai_type} />
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{f.status}</span>
                <div className="text-xs text-gray-500">
                  {f.sent_at ? format(new Date(f.sent_at), 'dd/MM HH:mm') : '-'}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ══════ LEADS PIPELINE ══════ */}
      {subTab === 'leads' && (
        <div className="space-y-3">
          {/* Stats */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
              <p className="text-xl font-bold text-gray-900">{leadsStats.total || 0}</p>
              <p className="text-[10px] text-gray-500 uppercase">Total</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
              <p className="text-xl font-bold text-blue-600">{leadsStats.by_status?.discovered || 0}</p>
              <p className="text-[10px] text-gray-500 uppercase">Discovered</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
              <p className="text-xl font-bold text-yellow-600">{leadsStats.by_status?.friend_sent || 0}</p>
              <p className="text-[10px] text-gray-500 uppercase">Friend Sent</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
              <p className="text-xl font-bold text-green-600">{leadsStats.by_status?.connected || 0}</p>
              <p className="text-[10px] text-gray-500 uppercase">Connected</p>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-3 text-center">
              <p className="text-xl font-bold text-green-600">{leadsStats.by_type?.potential_buyer || 0}</p>
              <p className="text-[10px] text-gray-500 uppercase">Buyers</p>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input type="text" value={leadsSearch} onChange={e => { setLeadsSearch(e.target.value); setLeadsPage(1) }}
              placeholder="Tim theo ten, UID..."
              className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm" />
          </div>

          {/* Leads Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="grid grid-cols-[1fr_60px_70px_90px_90px_90px] gap-2 px-4 py-2.5 bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase">
              <div>Name / UID</div>
              <div>Score</div>
              <div>AI Type</div>
              <div>Status</div>
              <div>Source</div>
              <div>Discovered</div>
            </div>
            {leadsLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader size={20} className="animate-spin text-purple-600" />
              </div>
            ) : leads.length === 0 ? (
              <div className="text-center py-12 text-gray-500 text-sm">
                Chua co lead nao. Chay campaign de thu thap.
              </div>
            ) : leads.map((l, i) => {
              const statusCfg = LEAD_STATUS[l.status] || LEAD_STATUS.discovered
              return (
                <div key={l.id || i} className="grid grid-cols-[1fr_60px_70px_90px_90px_90px] gap-2 px-4 py-2.5 border-b border-gray-100 text-sm items-center hover:bg-gray-50 transition-colors">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{l.name || l.fb_uid}</p>
                    <p className="text-xs text-gray-500 truncate">{l.fb_uid}</p>
                  </div>
                  <ScoreBadge score={l.score} />
                  <AITypeBadge type={l.ai_type} />
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>{statusCfg.label}</span>
                  <div className="text-xs text-gray-500 truncate">{l.source || '-'}</div>
                  <div className="text-xs text-gray-500">
                    {l.discovered_at ? format(new Date(l.discovered_at), 'dd/MM HH:mm') : '-'}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Pagination */}
          {leadsData?.pages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">Trang {leadsPage}/{leadsData.pages} ({leadsData.total})</span>
              <div className="flex gap-1">
                <button disabled={leadsPage <= 1} onClick={() => setLeadsPage(p => p - 1)}
                  className="px-2 py-1 text-xs bg-gray-50 border border-gray-200 text-gray-300 rounded disabled:opacity-30">&laquo;</button>
                <button disabled={leadsPage >= leadsData.pages} onClick={() => setLeadsPage(p => p + 1)}
                  className="px-2 py-1 text-xs bg-gray-50 border border-gray-200 text-gray-300 rounded disabled:opacity-30">&raquo;</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
