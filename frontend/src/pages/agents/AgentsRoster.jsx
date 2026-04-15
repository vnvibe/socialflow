/**
 * /agents — Agent Roster (dense table, replaces /accounts).
 * Row click → slide-out panel.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../../lib/api'
import AgentStatusDot from '../../components/hermes/AgentStatusDot'
import HermesScoreBadge from '../../components/hermes/HermesScoreBadge'
import SlidePanel from '../../components/hermes/SlidePanel'
import DenseStat from '../../components/hermes/DenseStat'

function formatAge(createdAt) {
  if (!createdAt) return '—'
  const days = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000)
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  return `${Math.floor(days / 30)}mo`
}

function formatLastSeen(ts) {
  if (!ts) return 'never'
  const sec = Math.round((Date.now() - new Date(ts).getTime()) / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86400) return `${Math.round(sec / 3600)}h`
  return `${Math.round(sec / 86400)}d`
}

export default function AgentsRoster() {
  const [selected, setSelected] = useState(null)

  const { data: accounts = [], refetch } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data || [],
    refetchInterval: 30000,
  })

  // Jobs to know who's busy
  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', 'running'],
    queryFn: async () => (await api.get('/jobs?status=running&limit=50')).data || [],
    refetchInterval: 5000,
  })

  const runningMap = {}
  jobs.forEach(j => {
    if (j.payload?.account_id) runningMap[j.payload.account_id] = j
  })

  const activeCount = accounts.filter(a => a.is_active).length
  const healthyCount = accounts.filter(a => a.status === 'healthy').length
  const atRiskCount = accounts.filter(a => a.status === 'at_risk' || a.status === 'checkpoint').length

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Top bar */}
        <div
          className="flex items-center gap-8 px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <div className="font-mono-ui text-[10px] uppercase text-app-muted">Agents</div>
            <div className="text-app-primary text-lg mt-1">Roster ({accounts.length})</div>
          </div>
          <div className="flex-1" />
          <DenseStat value={activeCount} label="Active" color="hermes" />
          <DenseStat value={healthyCount} label="Healthy" />
          <DenseStat value={atRiskCount} label="At risk" color={atRiskCount > 0 ? 'warn' : 'primary'} />
          <DenseStat value={Object.keys(runningMap).length} label="Busy now" color="hermes" />
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto">
          <table className="w-full font-mono-ui text-xs">
            <thead className="sticky top-0 bg-app-base" style={{ borderBottom: '1px solid var(--border-bright)' }}>
              <tr className="text-app-muted text-[10px] uppercase tracking-wider">
                <th className="text-left px-3 py-2 w-8"></th>
                <th className="text-left px-3 py-2">Username</th>
                <th className="text-left px-3 py-2 w-24">Status</th>
                <th className="text-left px-3 py-2 w-16">Age</th>
                <th className="text-left px-3 py-2 w-32">Current job</th>
                <th className="text-left px-3 py-2 w-20">Budget</th>
                <th className="text-left px-3 py-2 w-20">Last seen</th>
              </tr>
            </thead>
            <tbody className="row-divider">
              {accounts.map((acc) => {
                const running = runningMap[acc.id]
                const likeUsed = acc.daily_budget?.like?.used || 0
                const likeMax = acc.daily_budget?.like?.max || 0
                return (
                  <tr
                    key={acc.id}
                    onClick={() => setSelected(acc)}
                    className="hover-row cursor-pointer"
                  >
                    <td className="px-3 py-2">
                      <AgentStatusDot
                        status={running ? 'busy' : !acc.is_active ? 'offline' : acc.status === 'healthy' ? 'online' : 'error'}
                        pulse={!!running}
                      />
                    </td>
                    <td className="px-3 py-2 text-app-primary truncate max-w-[200px]">
                      {acc.username || acc.id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2">
                      <span className={
                        acc.status === 'healthy' ? 'text-hermes' :
                        acc.status === 'at_risk' ? 'text-warn' :
                        acc.status === 'checkpoint' ? 'text-danger' :
                        'text-app-muted'
                      }>
                        {acc.status || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-app-muted">{formatAge(acc.created_at)}</td>
                    <td className="px-3 py-2">
                      {running ? (
                        <span className="text-info truncate block max-w-[150px]">{running.type}</span>
                      ) : (
                        <span className="text-app-dim">idle</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-app-muted">
                      {likeMax > 0 ? `${likeUsed}/${likeMax}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-app-dim">
                      {formatLastSeen(acc.updated_at)}
                    </td>
                  </tr>
                )
              })}
              {accounts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-8 text-center text-app-muted">
                    No agents. <a href="/accounts" className="text-hermes underline">Add one</a>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Slide-out panel */}
      <SlidePanel
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.username || 'Agent'}
        width={520}
      >
        {selected && (
          <div className="p-4 font-mono-ui text-xs">
            <div className="flex items-center gap-3 mb-4">
              <AgentStatusDot
                status={selected.is_active ? (selected.status === 'healthy' ? 'online' : 'error') : 'offline'}
                size="lg"
              />
              <div>
                <div className="text-app-primary text-sm">{selected.username}</div>
                <div className="text-app-muted text-[10px]">{selected.id}</div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <div className="text-[10px] uppercase text-app-muted">Status</div>
                <div className="text-app-primary mt-1">{selected.status || '—'}</div>
              </div>
              <div className="p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <div className="text-[10px] uppercase text-app-muted">Age</div>
                <div className="text-app-primary mt-1">{formatAge(selected.created_at)}</div>
              </div>
              <div className="p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <div className="text-[10px] uppercase text-app-muted">Active hours</div>
                <div className="text-app-primary mt-1">
                  {selected.active_hours_start ?? 0}h — {selected.active_hours_end ?? 24}h
                </div>
              </div>
              <div className="p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <div className="text-[10px] uppercase text-app-muted">Proxy</div>
                <div className="text-app-primary mt-1 truncate">
                  {selected.proxy_id ? selected.proxy_id.slice(0, 8) : 'none'}
                </div>
              </div>
            </div>

            <div className="mb-4">
              <div className="text-[10px] uppercase text-app-muted mb-2">Daily budget</div>
              <div className="space-y-1">
                {Object.entries(selected.daily_budget || {}).filter(([k]) => k !== 'reset_at').map(([action, b]) => (
                  <div key={action} className="flex items-center gap-3 py-1" style={{ borderBottom: '1px solid var(--border)' }}>
                    <span className="w-24 text-app-muted">{action}</span>
                    <div className="flex-1 h-1.5" style={{ background: 'var(--bg-elevated)' }}>
                      <div
                        className="h-full bg-hermes"
                        style={{ width: `${Math.min(100, ((b.used || 0) / (b.max || 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-app-primary tabular-nums">
                      {b.used || 0}/{b.max || 0}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex gap-2 mt-6">
              <a href={`/accounts/${selected.id}`} className="btn-ghost">OPEN DETAIL</a>
              <button className="btn-ghost">HEALTH CHECK</button>
            </div>
          </div>
        )}
      </SlidePanel>
    </>
  )
}
