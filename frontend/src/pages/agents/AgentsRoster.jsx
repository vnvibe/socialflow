/**
 * /agents — Agent Roster redesigned as accordion by campaign
 *
 * Each campaign = collapsible section showing nicks grouped by role.
 * Each nick row: avatar, status dot, role (editable), current job (5s poll),
 * today's job stats, Hermes score, actions.
 *
 * Click nick → SlidePanel with 7-day activity chart, last 10 jobs,
 * pilot memories, pause/health actions.
 */
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, ChevronRight, Play, Pause, Plus, X, ArrowRightLeft } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import DenseStat from '../../components/hermes/DenseStat'
import AgentStatusDot from '../../components/hermes/AgentStatusDot'
import HermesScoreBadge from '../../components/hermes/HermesScoreBadge'
import SlidePanel from '../../components/hermes/SlidePanel'
import JobRow from '../../components/hermes/JobRow'

const asArray = (d) => Array.isArray(d) ? d
  : Array.isArray(d?.items) ? d.items
  : Array.isArray(d?.data) ? d.data
  : Array.isArray(d?.results) ? d.results
  : []

const ROLE_COLORS = {
  scout:     'text-info',
  nurture:   'text-hermes',
  connect:   'text-warn',
  post:      'text-app-primary',
  interact:  'text-hermes',
  monitor:   'text-info',
  default:   'text-app-muted',
}

const ROLE_LABELS = {
  scout:    'Scout',
  nurture:  'Nurture',
  connect:  'Connect',
  post:     'Post',
  interact: 'Interact',
  monitor:  'Monitor',
}

const ROLE_OPTIONS = ['scout', 'nurture', 'connect', 'post', 'interact', 'monitor']

function formatAgo(ts) {
  if (!ts) return '—'
  const sec = Math.round((Date.now() - new Date(ts).getTime()) / 1000)
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  if (sec < 86400) return `${Math.round(sec / 3600)}h`
  return `${Math.round(sec / 86400)}d`
}

// ─── Inline role select (click to edit) ────────────────────
function RoleSelect({ currentRole, onChange, disabled }) {
  const [editing, setEditing] = useState(false)
  if (editing && !disabled) {
    return (
      <select
        autoFocus
        value={currentRole || ''}
        onChange={(e) => {
          onChange(e.target.value)
          setEditing(false)
        }}
        onBlur={() => setEditing(false)}
        className="bg-app-elevated text-app-primary text-xs font-mono-ui px-1 py-0.5"
        style={{ border: '1px solid var(--border-bright)' }}
      >
        {ROLE_OPTIONS.map((r) => (
          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
        ))}
      </select>
    )
  }
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        if (!disabled) setEditing(true)
      }}
      className={`font-mono-ui text-xs ${ROLE_COLORS[currentRole] || ROLE_COLORS.default} ${disabled ? 'cursor-default' : 'hover:underline'}`}
    >
      {ROLE_LABELS[currentRole] || '—'}
    </button>
  )
}

// ─── Single nick row inside campaign accordion ────────────
function NickRow({ nick, role, campaignId, runningJob, todayStats, onSelect, onRemove, onRoleChange, campaigns }) {
  const [transferOpen, setTransferOpen] = useState(false)

  const status = runningJob ? 'busy'
    : !nick.is_active ? 'offline'
    : nick.status === 'healthy' ? 'online'
    : nick.status === 'at_risk' ? 'idle'
    : 'error'

  return (
    <div
      className="flex items-center gap-4 px-4 py-3 hover-row cursor-pointer"
      style={{ borderBottom: '1px solid var(--border)' }}
      onClick={() => onSelect(nick)}
    >
      {/* Status dot */}
      <AgentStatusDot status={status} pulse={!!runningJob} size="lg" />

      {/* Name + username */}
      <div className="min-w-0 flex-1">
        <div className="text-app-primary text-sm truncate">{nick.username || nick.id.slice(0, 8)}</div>
        <div className="text-app-muted text-[10px] font-mono-ui">
          {nick.id.slice(0, 8)} · {formatAgo(nick.updated_at)}
        </div>
      </div>

      {/* Role */}
      <div className="w-20" onClick={(e) => e.stopPropagation()}>
        {role ? (
          <RoleSelect
            currentRole={role}
            onChange={(newRole) => onRoleChange(nick.id, newRole)}
          />
        ) : (
          <span className="text-app-dim font-mono-ui text-xs">—</span>
        )}
      </div>

      {/* Current job */}
      <div className="w-48 font-mono-ui text-xs">
        {runningJob ? (
          <>
            <div className="text-info truncate">→ {runningJob.payload?.action || runningJob.type}</div>
            <div className="text-app-dim text-[10px]">
              started {formatAgo(runningJob.started_at)}
            </div>
          </>
        ) : nick.status === 'checkpoint' ? (
          <span className="text-danger">⚠ checkpoint — cần xử lý</span>
        ) : nick.status === 'at_risk' ? (
          <span className="text-warn">at risk</span>
        ) : !nick.is_active ? (
          <span className="text-app-dim">disabled</span>
        ) : (
          <span className="text-app-dim">idle</span>
        )}
      </div>

      {/* Today stats */}
      <div className="w-24 text-right font-mono-ui text-xs">
        <div className="text-app-primary">{todayStats?.total || 0} jobs</div>
        {(todayStats?.failed || 0) > 0 ? (
          <div className="text-danger text-[10px]">{todayStats.failed} fail</div>
        ) : (
          <div className="text-app-dim text-[10px]">0 fail</div>
        )}
      </div>

      {/* Hermes score */}
      <div onClick={(e) => e.stopPropagation()}>
        <HermesScoreBadge score={todayStats?.avg_score} />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={() => setTransferOpen(!transferOpen)}
          title="Chuyển campaign"
          className="text-app-muted hover:text-info p-1"
        >
          <ArrowRightLeft size={14} />
        </button>
        <button
          onClick={() => onRemove(nick.id)}
          title="Remove khỏi campaign"
          className="text-app-muted hover:text-danger p-1"
        >
          <X size={14} />
        </button>
      </div>

      {/* Transfer dropdown */}
      {transferOpen && (
        <div
          className="absolute right-4 top-12 z-20 bg-app-elevated font-mono-ui text-xs"
          style={{ border: '1px solid var(--border-bright)', minWidth: 200 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-2 text-[10px] uppercase text-app-muted" style={{ borderBottom: '1px solid var(--border)' }}>
            Chuyển sang
          </div>
          {campaigns.filter(c => c.id !== campaignId).map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setTransferOpen(false)
                toast.info(`Transfer logic TBD: ${nick.username} → ${c.name}`)
              }}
              className="w-full text-left px-3 py-2 hover-row text-app-primary"
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Single campaign accordion section ─────────────────────
function CampaignSection({ campaign, accounts, runningJobs, todayStatsByAcc, campaigns, onRoleChange, onRemoveFromRole, onSelect }) {
  const [expanded, setExpanded] = useState(true)
  const nav = useNavigate()

  const roles = campaign.campaign_roles || []
  // Map account_id → role_type for this campaign
  const accountRoles = {}
  roles.forEach(r => {
    (r.account_ids || []).forEach(accId => {
      accountRoles[accId] = r.role_type
    })
  })
  const assignedAccountIds = Object.keys(accountRoles)
  const assignedAccounts = accounts.filter(a => assignedAccountIds.includes(a.id))

  const totalJobs = assignedAccountIds.reduce((sum, id) => sum + (todayStatsByAcc[id]?.total || 0), 0)
  const avgScore = (() => {
    const scores = assignedAccountIds.map(id => todayStatsByAcc[id]?.avg_score).filter(s => s > 0)
    if (scores.length === 0) return null
    return scores.reduce((a, b) => a + b, 0) / scores.length
  })()

  const isRunning = ['active', 'running'].includes(campaign.status)
  const statusColor = isRunning ? 'text-hermes'
    : campaign.status === 'paused' ? 'text-warn'
    : 'text-app-muted'

  return (
    <div className="mb-4" style={{ border: '1px solid var(--border)' }}>
      {/* Header (always visible) */}
      <div
        className="flex items-center gap-4 px-4 py-3 cursor-pointer bg-app-elevated"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={16} className="text-app-muted" /> : <ChevronRight size={16} className="text-app-muted" />}
        <span className="text-lg">🎯</span>
        <div className="flex-1 min-w-0">
          <div className="text-app-primary truncate" onClick={(e) => {
            e.stopPropagation()
            nav(`/campaigns/${campaign.id}`)
          }}>
            {campaign.name || '(unnamed)'}
          </div>
        </div>
        <span className={`font-mono-ui text-[11px] uppercase tracking-wider ${statusColor}`}>
          ● {campaign.status || 'draft'}
        </span>
        <span className="font-mono-ui text-xs text-app-muted">
          {assignedAccounts.length} nicks
        </span>
        <span className="font-mono-ui text-xs text-app-muted">
          · {totalJobs} jobs hôm nay
        </span>
        {avgScore !== null && (
          <span className="font-mono-ui text-xs">
            · <span className="text-app-muted">score </span>
            <span className={avgScore >= 4 ? 'text-hermes' : avgScore >= 3 ? 'text-warn' : 'text-danger'}>
              {avgScore.toFixed(1)}
            </span>
          </span>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            nav(`/campaigns/${campaign.id}`)
          }}
          className="btn-ghost"
          style={{ fontSize: 11 }}
        >
          {isRunning ? 'MANAGE' : 'OPEN'}
        </button>
      </div>

      {/* Body */}
      {expanded && (
        <div className="relative">
          {assignedAccounts.length === 0 ? (
            <div className="px-4 py-6 text-center text-app-muted font-mono-ui text-xs">
              No nicks assigned. <button
                onClick={() => nav(`/campaigns/${campaign.id}/edit`)}
                className="text-hermes underline"
              >
                Edit campaign
              </button>
            </div>
          ) : (
            assignedAccounts.map((nick) => (
              <NickRow
                key={`${campaign.id}-${nick.id}`}
                nick={nick}
                role={accountRoles[nick.id]}
                campaignId={campaign.id}
                campaigns={campaigns}
                runningJob={runningJobs.find(j => j.payload?.account_id === nick.id && j.payload?.campaign_id === campaign.id)}
                todayStats={todayStatsByAcc[nick.id]}
                onSelect={onSelect}
                onRemove={(accId) => onRemoveFromRole(campaign.id, accId)}
                onRoleChange={(accId, newRole) => onRoleChange(campaign.id, accId, newRole)}
              />
            ))
          )}

          {/* Add nick button */}
          <div
            className="px-4 py-2 text-right"
            style={{ borderTop: '1px solid var(--border)' }}
          >
            <button
              onClick={() => nav(`/campaigns/${campaign.id}/edit`)}
              className="btn-ghost inline-flex items-center gap-1"
              style={{ fontSize: 11 }}
            >
              <Plus size={12} /> THÊM NICK
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Unassigned nicks section ──────────────────────────────
function UnassignedSection({ nicks, runningJobs, todayStatsByAcc, onSelect }) {
  const [expanded, setExpanded] = useState(false)

  if (nicks.length === 0) return null

  return (
    <div className="mb-4" style={{ border: '1px solid var(--border)' }}>
      <div
        className="flex items-center gap-4 px-4 py-3 cursor-pointer bg-app-elevated"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={16} className="text-app-muted" /> : <ChevronRight size={16} className="text-app-muted" />}
        <span className="text-lg">📦</span>
        <div className="flex-1 text-app-primary">
          Chưa gán campaign
        </div>
        <span className="font-mono-ui text-xs text-app-muted">
          {nicks.length} nicks
        </span>
      </div>

      {expanded && nicks.map((nick) => (
        <NickRow
          key={`unassigned-${nick.id}`}
          nick={nick}
          role={null}
          campaignId={null}
          campaigns={[]}
          runningJob={runningJobs.find(j => j.payload?.account_id === nick.id)}
          todayStats={todayStatsByAcc[nick.id]}
          onSelect={onSelect}
          onRemove={() => {}}
          onRoleChange={() => {}}
        />
      ))}
    </div>
  )
}

// ─── Nick detail slide-out panel ───────────────────────────
function NickDetailPanel({ nick, onClose }) {
  const { data: memories = [] } = useQuery({
    queryKey: ['ai-memory', nick?.id],
    enabled: !!nick,
    queryFn: async () => {
      // Direct DB query via API would need a new endpoint. For now use /ai-hermes/feedback/recent
      // and filter by account_id client-side, or create /agent-jobs/memory/:account_id.
      // Fall back gracefully.
      try {
        const res = await api.get(`/ai-hermes/feedback/recent?limit=50`)
        return asArray(res.data?.feedback).filter(f => f.account_id === nick.id)
      } catch {
        return []
      }
    },
  })

  const { data: recentJobs = [] } = useQuery({
    queryKey: ['nick-jobs', nick?.id],
    enabled: !!nick,
    queryFn: async () => {
      try {
        const res = await api.get(`/jobs?limit=50`)
        return asArray(res.data).filter(j => j.payload?.account_id === nick.id).slice(0, 10)
      } catch {
        return []
      }
    },
    refetchInterval: 10000,
  })

  // 7-day bar chart data
  const last7Days = useMemo(() => {
    const days = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      d.setHours(0, 0, 0, 0)
      const nextD = new Date(d)
      nextD.setDate(nextD.getDate() + 1)
      const count = recentJobs.filter(j => {
        const jt = new Date(j.created_at)
        return jt >= d && jt < nextD
      }).length
      days.push({
        label: d.toLocaleDateString('vi-VN', { weekday: 'short' }).slice(0, 2),
        count,
      })
    }
    return days
  }, [recentJobs])

  const maxCount = Math.max(1, ...last7Days.map(d => d.count))

  if (!nick) return null

  return (
    <SlidePanel
      open={!!nick}
      onClose={onClose}
      title={nick.username || nick.id.slice(0, 8)}
      width={560}
    >
      <div className="p-4 font-mono-ui text-xs">
        {/* Status card */}
        <div className="flex items-center gap-3 mb-4 p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <AgentStatusDot
            status={nick.is_active ? (nick.status === 'healthy' ? 'online' : 'error') : 'offline'}
            size="lg"
          />
          <div className="flex-1">
            <div className="text-app-primary text-sm">{nick.username}</div>
            <div className="text-app-muted text-[10px]">{nick.id}</div>
          </div>
          <div className="text-right">
            <div className={
              nick.status === 'healthy' ? 'text-hermes' :
              nick.status === 'at_risk' ? 'text-warn' :
              nick.status === 'checkpoint' ? 'text-danger' : 'text-app-muted'
            }>
              {nick.status || '—'}
            </div>
            <div className="text-app-dim text-[10px]">last seen {formatAgo(nick.updated_at)}</div>
          </div>
        </div>

        {/* 7-day activity */}
        <div className="mb-4">
          <div className="text-[10px] uppercase text-app-muted mb-2">7 ngày gần nhất</div>
          <div
            className="flex items-end gap-1 h-20 p-2"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            {last7Days.map((d, i) => (
              <div key={i} className="flex-1 flex flex-col items-center justify-end gap-1">
                <div
                  className="w-full bg-hermes"
                  style={{ height: `${(d.count / maxCount) * 100}%`, minHeight: d.count > 0 ? 2 : 0 }}
                />
                <div className="text-[9px] text-app-muted">{d.label}</div>
                <div className="text-[9px] text-app-primary">{d.count}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Last 10 jobs */}
        <div className="mb-4">
          <div className="text-[10px] uppercase text-app-muted mb-2">
            10 jobs gần nhất ({recentJobs.length})
          </div>
          <div style={{ border: '1px solid var(--border)' }}>
            {recentJobs.length === 0 ? (
              <div className="p-3 text-app-muted text-center">No jobs yet</div>
            ) : (
              recentJobs.map(j => <JobRow key={j.id} job={j} />)
            )}
          </div>
        </div>

        {/* Hermes memory about this nick */}
        <div className="mb-4">
          <div className="text-[10px] uppercase text-app-muted mb-2">
            Hermes đã học ({memories.length})
          </div>
          <div style={{ border: '1px solid var(--border)' }}>
            {memories.length === 0 ? (
              <div className="p-3 text-app-muted text-center">
                Chưa có memory — Hermes sẽ học sau 5-10 successful actions
              </div>
            ) : (
              memories.slice(0, 10).map((m, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 px-3 py-2"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <HermesScoreBadge score={m.score} />
                  <div className="flex-1 min-w-0">
                    <div className="text-app-muted text-[10px]">
                      {m.task_type} · {m.reason || '—'}
                    </div>
                    <div className="text-app-primary text-xs truncate">
                      {m.output_preview}
                    </div>
                  </div>
                  <span className="text-app-dim text-[10px]">{formatAgo(m.ts * 1000)}</span>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            className="btn-ghost"
            onClick={() => {
              toast.info('Pause nick: TBD')
            }}
          >
            {nick.is_active ? 'PAUSE NICK' : 'RESUME NICK'}
          </button>
          <button
            className="btn-ghost"
            onClick={async () => {
              try {
                await api.post(`/accounts/${nick.id}/check-health`)
                toast.success('Health check queued')
              } catch (e) {
                toast.error(e.response?.data?.error || e.message)
              }
            }}
          >
            HEALTH CHECK
          </button>
          <a
            href={`/accounts/${nick.id}`}
            className="btn-ghost"
          >
            FULL DETAIL
          </a>
        </div>
      </div>
    </SlidePanel>
  )
}

// ─── Main page ─────────────────────────────────────────────
export default function AgentsRoster() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState(null)

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => asArray((await api.get('/accounts')).data),
    refetchInterval: 30000,
  })

  const { data: campaigns = [] } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => asArray((await api.get('/campaigns')).data),
    refetchInterval: 30000,
  })

  // Poll running jobs every 5s
  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', 'live'],
    queryFn: async () => asArray((await api.get('/jobs?limit=100')).data),
    refetchInterval: 5000,
  })

  const runningJobs = jobs.filter(j => ['claimed', 'running'].includes(j.status))

  // Compute today stats per account (client-side aggregation)
  const todayStatsByAcc = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const stats = {}
    for (const j of jobs) {
      const accId = j.payload?.account_id
      if (!accId) continue
      if (new Date(j.created_at) < today) continue
      if (!stats[accId]) stats[accId] = { total: 0, done: 0, failed: 0, avg_score: 0, scoresSum: 0, scoresCount: 0 }
      stats[accId].total++
      if (j.status === 'done') stats[accId].done++
      if (j.status === 'failed') stats[accId].failed++
      const score = j.result?.hermes_score
      if (typeof score === 'number') {
        stats[accId].scoresSum += score
        stats[accId].scoresCount++
      }
    }
    // Compute avg
    for (const id in stats) {
      if (stats[id].scoresCount > 0) {
        stats[id].avg_score = stats[id].scoresSum / stats[id].scoresCount
      }
    }
    return stats
  }, [jobs])

  // Assigned account ids across all campaigns
  const assignedIds = useMemo(() => {
    const ids = new Set()
    for (const c of campaigns) {
      for (const r of (c.campaign_roles || [])) {
        for (const accId of (r.account_ids || [])) {
          ids.add(accId)
        }
      }
    }
    return ids
  }, [campaigns])

  const unassignedNicks = accounts.filter(a => !assignedIds.has(a.id))

  // Mutations
  const changeRole = useMutation({
    mutationFn: async ({ campaignId, accountId, newRole }) => {
      // Find current role, remove from old, add to new.
      // This needs an API endpoint ideally. For now call PUT /campaigns/:id with updated roles.
      const campaign = campaigns.find(c => c.id === campaignId)
      if (!campaign) throw new Error('Campaign not found')

      const updatedRoles = (campaign.campaign_roles || []).map(r => {
        let ids = r.account_ids || []
        if (r.role_type !== newRole) {
          ids = ids.filter(id => id !== accountId)
        } else if (!ids.includes(accountId)) {
          ids = [...ids, accountId]
        }
        return { ...r, account_ids: ids }
      })

      await api.put(`/campaigns/${campaignId}`, { campaign_roles: updatedRoles })
    },
    onSuccess: () => {
      toast.success('Role updated')
      qc.invalidateQueries({ queryKey: ['campaigns'] })
    },
    onError: (err) => {
      toast.error(`Role change failed: ${err.response?.data?.error || err.message}`)
    },
  })

  const removeFromCampaign = useMutation({
    mutationFn: async ({ campaignId, accountId }) => {
      const campaign = campaigns.find(c => c.id === campaignId)
      if (!campaign) throw new Error('Campaign not found')
      const updatedRoles = (campaign.campaign_roles || []).map(r => ({
        ...r,
        account_ids: (r.account_ids || []).filter(id => id !== accountId),
      }))
      await api.put(`/campaigns/${campaignId}`, { campaign_roles: updatedRoles })
    },
    onSuccess: () => {
      toast.success('Nick removed from campaign')
      qc.invalidateQueries({ queryKey: ['campaigns'] })
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || err.message)
    },
  })

  // Top stats
  const activeNicks = accounts.filter(a => a.is_active).length
  const busyNow = runningJobs.length
  const todayTotal = Object.values(todayStatsByAcc).reduce((s, st) => s + st.total, 0)
  const todayFailed = Object.values(todayStatsByAcc).reduce((s, st) => s + st.failed, 0)

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Top stats */}
        <div
          className="flex items-center gap-8 px-6 py-4"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <div className="font-mono-ui text-[10px] uppercase text-app-muted">Agents</div>
            <div className="text-app-primary text-lg mt-1">Roster by campaign</div>
          </div>
          <div className="flex-1" />
          <DenseStat value={accounts.length} label="Total nicks" />
          <DenseStat value={activeNicks} label="Active" color="hermes" />
          <DenseStat value={busyNow} label="Busy now" color="hermes" />
          <DenseStat value={todayTotal} label="Jobs today" />
          <DenseStat value={todayFailed} label="Failed today" color={todayFailed > 0 ? 'danger' : 'primary'} />
        </div>

        {/* Accordion body */}
        <div className="flex-1 overflow-auto p-6">
          {campaigns.map((c) => (
            <CampaignSection
              key={c.id}
              campaign={c}
              accounts={accounts}
              runningJobs={runningJobs}
              todayStatsByAcc={todayStatsByAcc}
              campaigns={campaigns}
              onSelect={setSelected}
              onRoleChange={(campaignId, accountId, newRole) => changeRole.mutate({ campaignId, accountId, newRole })}
              onRemoveFromRole={(campaignId, accountId) => removeFromCampaign.mutate({ campaignId, accountId })}
            />
          ))}

          <UnassignedSection
            nicks={unassignedNicks}
            runningJobs={runningJobs}
            todayStatsByAcc={todayStatsByAcc}
            onSelect={setSelected}
          />

          {campaigns.length === 0 && accounts.length > 0 && (
            <div className="text-center p-8 text-app-muted font-mono-ui">
              No campaigns yet. <a href="/campaigns/new" className="text-hermes underline">Create one</a>
            </div>
          )}
        </div>
      </div>

      <NickDetailPanel nick={selected} onClose={() => setSelected(null)} />
    </>
  )
}
