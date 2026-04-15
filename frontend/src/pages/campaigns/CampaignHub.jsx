/**
 * /campaigns/:id — Campaign Hub (Hermes-redesigned)
 *
 * 5 tabs: Overview | Agents | Execution | Content | Data
 * Dense header with Hermes plan summary, campaign status, live stats.
 * Existing section components are reused as tab bodies (no logic rewrite).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Play, Pause, Edit, Loader, Brain, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import DenseStat from '../../components/hermes/DenseStat'
import HermesCaller from '../../components/hermes/HermesCaller'
import JobRow from '../../components/hermes/JobRow'
import HermesScoreBadge from '../../components/hermes/HermesScoreBadge'

const asArray = (d) => Array.isArray(d) ? d
  : Array.isArray(d?.items) ? d.items
  : Array.isArray(d?.data) ? d.data
  : []

// ─── Tab: Overview ─────────────────────────────────────────
function OverviewTab({ campaign, campaignId }) {
  const nav = useNavigate()
  const { data: kpi } = useQuery({
    queryKey: ['campaigns', campaignId, 'kpi'],
    queryFn: async () => {
      try { return (await api.get(`/campaigns/${campaignId}/kpi-today`)).data } catch { return null }
    },
    refetchInterval: 60000,
  })

  const roles = campaign?.campaign_roles || []
  const totalNicks = roles.reduce((s, r) => s + (r.account_ids?.length || 0), 0)

  const hctx = campaign?.hermes_context || {}

  return (
    <div className="overflow-auto p-6 font-mono-ui">
      {/* Empty state — prompt to configure Hermes */}
      {!campaign?.goal && !hctx.product_name && (
        <div
          className="mb-6 p-4 flex items-center gap-4"
          style={{ background: 'var(--hermes-dim)', border: '1px solid var(--hermes-fade)' }}
        >
          <span className="text-2xl">🧠</span>
          <div className="flex-1">
            <div className="text-app-primary text-sm">Hermes chưa có context cho campaign này</div>
            <div className="text-app-muted text-xs mt-0.5">
              Set goal + product info để Hermes hiểu rõ chiến dịch + gen comment chất lượng cao hơn
            </div>
          </div>
          <button
            onClick={() => nav(`/campaigns/${campaignId}/hermes`)}
            className="btn-hermes whitespace-nowrap"
          >
            Cài đặt Hermes
          </button>
        </div>
      )}

      {/* Goal (Hermes-readable) */}
      {campaign?.goal && (
        <div className="mb-6">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-app-muted mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-hermes hermes-pulse" />
            Mục tiêu cho Hermes
          </div>
          <div
            className="p-4 text-sm text-app-primary leading-relaxed"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--hermes-fade)' }}
          >
            {campaign.goal}
          </div>
        </div>
      )}

      {/* Product info (Hermes context) */}
      {(hctx.product_name || hctx.key_features || hctx.tone) && (
        <div className="mb-6">
          <div className="text-[10px] uppercase tracking-wider text-app-muted mb-2">
            Thông tin sản phẩm (Hermes context)
          </div>
          <div className="p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            {hctx.product_name && (
              <div className="mb-2 text-app-primary text-sm">
                <span className="text-app-muted">Sản phẩm: </span>
                <span className="text-hermes">{hctx.product_name}</span>
                {hctx.price && <span className="text-app-muted ml-2">· {hctx.price}</span>}
              </div>
            )}
            {Array.isArray(hctx.key_features) && hctx.key_features.length > 0 && (
              <div className="text-xs text-app-muted mb-1">
                Điểm mạnh: <span className="text-app-primary">{hctx.key_features.join(' · ')}</span>
              </div>
            )}
            {hctx.target_audience && (
              <div className="text-xs text-app-muted mb-1">
                Đối tượng: <span className="text-app-primary">{hctx.target_audience}</span>
              </div>
            )}
            {hctx.tone && (
              <div className="text-xs text-app-muted mb-1">
                Tone: <span className="text-app-primary">{hctx.tone}</span>
              </div>
            )}
            {Array.isArray(hctx.avoid) && hctx.avoid.length > 0 && (
              <div className="text-xs text-app-muted mb-1">
                Tránh: <span className="text-warn">{hctx.avoid.join(', ')}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mission */}
      <div className="mb-6">
        <div className="text-[10px] uppercase tracking-wider text-app-muted mb-2">Mission</div>
        <div
          className="p-4 text-sm text-app-primary leading-relaxed"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          {campaign?.mission || campaign?.description || 'No mission description.'}
        </div>
      </div>

      {/* Topic + Brand */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-app-muted mb-2">Topic</div>
          <div
            className="p-3 text-sm text-app-primary"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            {campaign?.topic || '—'}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-app-muted mb-2">Brand / Product</div>
          <div
            className="p-3 text-sm text-app-primary"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            {campaign?.brand_config?.brand_name || campaign?.product_name || '—'}
          </div>
        </div>
      </div>

      {/* Roles breakdown */}
      <div className="mb-6">
        <div className="text-[10px] uppercase tracking-wider text-app-muted mb-2">
          Roles ({roles.length}) · {totalNicks} agents assigned
        </div>
        {roles.length === 0 ? (
          <div
            className="p-4 text-sm text-app-muted"
            style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
          >
            No roles configured yet.
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border)' }}>
            {roles.map((r) => (
              <div
                key={r.id}
                className="flex items-center gap-4 px-4 py-2 text-xs"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <span className="flex-1 text-app-primary truncate">
                  {r.role_type || r.name || 'unnamed'}
                </span>
                <span className="text-app-muted">{r.account_ids?.length || 0} nicks</span>
                <span className={r.is_active ? 'text-hermes' : 'text-app-muted'}>
                  ● {r.is_active ? 'active' : 'paused'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* KPI today */}
      {kpi?.rows?.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wider text-app-muted mb-2">
            KPI today
          </div>
          <div style={{ border: '1px solid var(--border)' }}>
            {kpi.rows.slice(0, 10).map((row, i) => (
              <div
                key={i}
                className="flex items-center gap-4 px-4 py-2 text-xs"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <span className="flex-1 text-app-primary truncate">
                  {row.nick_name || row.account_id?.slice(0, 8)}
                </span>
                <span className="text-app-muted">
                  likes {row.done_likes || 0}/{row.target_likes || 0}
                </span>
                <span className="text-app-muted">
                  comments {row.done_comments || 0}/{row.target_comments || 0}
                </span>
                <span className={row.kpi_met ? 'text-hermes' : 'text-app-muted'}>
                  {row.kpi_met ? '✓ met' : '...'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Tab: Agents (campaign roles + accounts) ───────────────
function AgentsTab({ campaign }) {
  const roles = campaign?.campaign_roles || []
  const allAccountIds = [...new Set(roles.flatMap(r => r.account_ids || []))]

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', 'all'],
    queryFn: async () => asArray((await api.get('/accounts')).data),
  })

  const assignedAccounts = accounts.filter(a => allAccountIds.includes(a.id))

  return (
    <div className="overflow-auto p-6 font-mono-ui">
      <div className="text-[10px] uppercase tracking-wider text-app-muted mb-3">
        Assigned agents ({assignedAccounts.length})
      </div>
      {assignedAccounts.length === 0 ? (
        <div
          className="p-6 text-sm text-app-muted text-center"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          No agents assigned to this mission yet. Edit campaign to assign nicks to roles.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)' }}>
          {assignedAccounts.map((acc) => {
            const accRoles = roles.filter(r => r.account_ids?.includes(acc.id))
            return (
              <div
                key={acc.id}
                className="flex items-center gap-4 px-4 py-3 text-xs"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <span className="flex-1 text-app-primary truncate">
                  {acc.username || acc.id.slice(0, 8)}
                </span>
                <span className="text-app-muted truncate max-w-[200px]">
                  {accRoles.map(r => r.role_type || r.name).filter(Boolean).join(', ') || '—'}
                </span>
                <span className={
                  acc.status === 'healthy' ? 'text-hermes' :
                  acc.status === 'at_risk' ? 'text-warn' :
                  acc.status === 'checkpoint' ? 'text-danger' : 'text-app-muted'
                }>
                  ● {acc.status || '—'}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Content (campaign posts + content queue) ─────────
function ContentTab({ campaignId }) {
  const { data: content = [] } = useQuery({
    queryKey: ['campaigns', campaignId, 'content'],
    queryFn: async () => {
      try {
        const res = await api.get(`/content?campaign_id=${campaignId}&limit=30`)
        return asArray(res.data)
      } catch {
        return []
      }
    },
  })

  return (
    <div className="overflow-auto p-6 font-mono-ui">
      <div className="text-[10px] uppercase tracking-wider text-app-muted mb-3">
        Content items ({content.length})
      </div>
      {content.length === 0 ? (
        <div
          className="p-6 text-sm text-app-muted text-center"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          No content drafts or posts for this mission.
        </div>
      ) : (
        <div className="space-y-2">
          {content.map((c) => (
            <div
              key={c.id}
              className="p-3"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-3 mb-1 text-[10px] uppercase text-app-muted">
                <span>{c.type || 'post'}</span>
                <span>·</span>
                <span className={c.status === 'published' ? 'text-hermes' : 'text-app-muted'}>
                  {c.status || '—'}
                </span>
              </div>
              <div className="text-xs text-app-primary line-clamp-2">
                {c.caption || c.body || c.title || '(no text)'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Data (leads + opportunities) ─────────────────────
function DataTab({ campaignId }) {
  const { data: leads = [] } = useQuery({
    queryKey: ['campaigns', campaignId, 'leads'],
    queryFn: async () => {
      try {
        const res = await api.get(`/leads?campaign_id=${campaignId}&limit=50`)
        return asArray(res.data)
      } catch {
        return []
      }
    },
  })

  return (
    <div className="overflow-auto p-6 font-mono-ui">
      <div className="text-[10px] uppercase tracking-wider text-app-muted mb-3">
        Leads collected ({leads.length})
      </div>
      {leads.length === 0 ? (
        <div
          className="p-6 text-sm text-app-muted text-center"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
        >
          No leads yet. Run discovery + opportunity react to collect.
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)' }}>
          {leads.map((lead) => (
            <div
              key={lead.id}
              className="flex items-center gap-4 px-4 py-2 text-xs"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <span className="flex-1 text-app-primary truncate">
                {lead.name || lead.fb_user_id || '—'}
              </span>
              <span className="text-app-muted truncate max-w-[200px]">
                {lead.source || lead.origin || '—'}
              </span>
              <span className={
                lead.status === 'connected' ? 'text-hermes' :
                lead.status === 'blocked' ? 'text-danger' : 'text-app-muted'
              }>
                {lead.status || '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Tab: Execution (live job feed for this campaign) ──────
function ExecutionTab({ campaignId }) {
  const { data: jobs = [] } = useQuery({
    queryKey: ['campaigns', campaignId, 'jobs'],
    queryFn: async () => {
      const res = await api.get(`/jobs?limit=30`)
      const all = asArray(res.data)
      // Filter by campaign_id in payload
      return all.filter(j => j.payload?.campaign_id === campaignId)
    },
    refetchInterval: 3000,
  })

  const running = jobs.filter(j => ['claimed', 'running'].includes(j.status)).length
  const pending = jobs.filter(j => j.status === 'pending').length
  const done = jobs.filter(j => j.status === 'done').length
  const failed = jobs.filter(j => j.status === 'failed').length

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-8 px-6 py-3"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <DenseStat value={running} label="Running" color="hermes" />
        <DenseStat value={pending} label="Queued" />
        <DenseStat value={done} label="Done" color="hermes" />
        <DenseStat value={failed} label="Failed" color={failed > 0 ? 'danger' : 'primary'} />
      </div>
      <div className="flex-1 overflow-auto">
        {jobs.length === 0 ? (
          <div className="p-8 text-center text-app-muted font-mono-ui text-xs">
            No jobs for this campaign yet.
          </div>
        ) : (
          jobs.map(job => <JobRow key={job.id} job={job} />)
        )}
      </div>
    </div>
  )
}

// ─── Tabs config ───────────────────────────────────────────
const TABS = [
  { key: 'overview',  label: 'Overview' },
  { key: 'agents',    label: 'Agents' },
  { key: 'execution', label: 'Execution' },
  { key: 'content',   label: 'Content' },
  { key: 'data',      label: 'Data' },
]

// ─── Hermes Review modal ───────────────────────────────────
function HermesReviewModal({ campaign, accounts, jobs, onClose }) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const runReview = async () => {
    setLoading(true)
    setError(null)
    try {
      // Aggregate stats client-side
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayJobs = jobs.filter(j => new Date(j.created_at) >= today)
      const stats = {
        total_jobs_today: todayJobs.length,
        failed: todayJobs.filter(j => j.status === 'failed').length,
        done: todayJobs.filter(j => j.status === 'done').length,
        running: todayJobs.filter(j => ['claimed', 'running'].includes(j.status)).length,
      }
      // Per-nick stats
      const roleMap = {}
      for (const r of (campaign.campaign_roles || [])) {
        for (const accId of (r.account_ids || [])) {
          roleMap[accId] = r.role_type
        }
      }
      const nickStats = []
      const seenAccIds = new Set()
      for (const accId of Object.keys(roleMap)) {
        seenAccIds.add(accId)
        const acc = accounts.find(a => a.id === accId)
        if (!acc) continue
        const accJobs = todayJobs.filter(j => j.payload?.account_id === accId)
        const failed = accJobs.filter(j => j.status === 'failed').length
        nickStats.push({
          account_id: accId,
          username: acc.username || accId.slice(0, 8),
          role: roleMap[accId],
          status: acc.status,
          jobs_today: accJobs.length,
          failed,
        })
      }

      const res = await api.post('/ai-hermes/campaign-review', {
        campaign_id: campaign.id,
        current_stats: stats,
        nick_stats: nickStats,
      })
      setResult(res.data)
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.detail || err.message
      setError(msg)
      toast.error(`Review thất bại: ${msg}`)
    } finally {
      setLoading(false)
    }
  }

  // Auto-trigger on mount
  useState(() => { runReview() })

  const PRIORITY_COLOR = {
    high: 'text-danger',
    medium: 'text-warn',
    low: 'text-app-muted',
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={onClose}
    >
      <div
        className="bg-app-surface w-full max-w-3xl max-h-[80vh] flex flex-col font-mono-ui"
        style={{ border: '1px solid var(--border-bright)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            <Brain size={16} className="text-hermes" />
            <span className="text-app-primary text-sm uppercase tracking-wider">Hermes Review</span>
          </div>
          <button onClick={onClose} className="text-app-muted hover:text-app-primary p-1">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading && (
            <div className="flex items-center gap-3 text-app-muted">
              <Loader size={16} className="animate-spin text-hermes" />
              <span className="text-sm">Hermes đang phân tích chiến dịch...</span>
            </div>
          )}

          {error && (
            <div className="p-3 text-sm text-danger" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.4)' }}>
              ⚠ {error}
              {error.includes('no goal') && (
                <div className="mt-2 text-xs text-app-muted">
                  Vào Edit campaign → tab "Mục tiêu" để thiết lập trước.
                </div>
              )}
            </div>
          )}

          {result && (
            <>
              <div className="mb-4 p-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                <div className="text-[10px] uppercase text-app-muted mb-1">Tóm tắt</div>
                <div className="text-app-primary text-sm">{result.summary}</div>
                <div className="text-app-dim text-[10px] mt-2">latency {result.latency_ms}ms</div>
              </div>

              <div className="text-[10px] uppercase text-app-muted mb-2">
                Đề xuất ({result.recommendations?.length || 0})
              </div>

              {(result.recommendations || []).map((rec, i) => (
                <div
                  key={i}
                  className="mb-2 p-3"
                  style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                >
                  <div className="flex items-center gap-3 mb-1 text-xs">
                    <span className={`uppercase ${PRIORITY_COLOR[rec.priority] || 'text-app-muted'}`}>
                      ● {rec.priority || 'normal'}
                    </span>
                    <span className="text-app-primary">{rec.account_id}</span>
                    <span className="text-app-muted">→</span>
                    <span className={
                      rec.action === 'increase' ? 'text-hermes' :
                      rec.action === 'fix_checkpoint' ? 'text-danger' :
                      rec.action === 'pause' ? 'text-warn' :
                      'text-info'
                    }>
                      {rec.action} {rec.task_type}
                    </span>
                  </div>
                  <div className="text-xs text-app-muted">{rec.reason}</div>
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => toast.info(`TODO: apply "${rec.action}" — manual edit campaign for now`)}
                      className="btn-ghost"
                      style={{ fontSize: 10 }}
                    >
                      Áp dụng
                    </button>
                  </div>
                </div>
              ))}

              {result.recommendations?.length === 0 && (
                <div className="text-app-muted text-sm">Không có đề xuất.</div>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={runReview} disabled={loading} className="btn-ghost">
            {loading ? 'Đang phân tích...' : 'Phân tích lại'}
          </button>
          <button onClick={onClose} className="btn-ghost">Đóng</button>
        </div>
      </div>
    </div>
  )
}

// ─── Main ──────────────────────────────────────────────────
export default function CampaignHub() {
  const { id } = useParams()
  const nav = useNavigate()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'overview'
  const [reviewOpen, setReviewOpen] = useState(false)

  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaigns', id],
    queryFn: async () => (await api.get(`/campaigns/${id}`)).data,
    refetchInterval: 30000,
  })

  const { data: allAccounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => asArray((await api.get('/accounts')).data),
    refetchInterval: 60000,
  })

  const { data: allJobs = [] } = useQuery({
    queryKey: ['jobs', 'campaign-review', id],
    queryFn: async () => {
      const res = await api.get('/jobs?limit=200')
      return asArray(res.data).filter(j => j.payload?.campaign_id === id)
    },
    enabled: !!campaign,
    refetchInterval: 30000,
  })

  const toggleStatus = useMutation({
    mutationFn: async (newStatus) => {
      await api.put(`/campaigns/${id}`, { status: newStatus })
    },
    onSuccess: (_, newStatus) => {
      toast.success(`Campaign ${newStatus === 'running' ? 'started' : 'paused'}`)
      qc.invalidateQueries({ queryKey: ['campaigns', id] })
      qc.invalidateQueries({ queryKey: ['campaigns'] })
    },
    onError: (err) => toast.error(err.response?.data?.error || err.message),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader className="animate-spin text-hermes" size={20} />
      </div>
    )
  }

  if (!campaign) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-app-muted font-mono-ui">
        <span>Campaign not found</span>
        <button onClick={() => nav('/campaigns')} className="btn-ghost mt-4">
          ← Back to missions
        </button>
      </div>
    )
  }

  const status = campaign.status || 'draft'
  const statusColor = {
    active: 'text-hermes',
    running: 'text-hermes',
    paused: 'text-warn',
    draft: 'text-app-muted',
  }[status] || 'text-app-muted'

  const isRunning = status === 'running' || status === 'active'
  const rolesCount = campaign.campaign_roles?.length ?? campaign.roles_count ?? 0
  const nicksCount = (campaign.campaign_roles || []).reduce(
    (sum, r) => sum + (r.account_ids?.length || 0), 0
  )

  return (
    <div className="flex flex-col h-full">
      {/* ─── Header ─── */}
      <div
        className="px-6 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => nav('/campaigns')}
            className="text-app-muted hover:text-app-primary"
            title="Back to missions"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-mono-ui text-[10px] uppercase tracking-wider text-app-muted">
              Mission
            </div>
            <div className="text-app-primary text-lg truncate mt-0.5">
              {campaign.name || 'Untitled'}
            </div>
          </div>
          <span className={`font-mono-ui text-[11px] uppercase tracking-wider ${statusColor}`}>
            ● {status}
          </span>
          {isRunning ? (
            <button
              onClick={() => toggleStatus.mutate('paused')}
              disabled={toggleStatus.isPending}
              className="btn-ghost"
            >
              <Pause size={14} /> PAUSE
            </button>
          ) : (
            <button
              onClick={() => toggleStatus.mutate('running')}
              disabled={toggleStatus.isPending}
              className="btn-hermes"
            >
              <Play size={14} /> START
            </button>
          )}
          <button
            onClick={() => setReviewOpen(true)}
            className="btn-hermes flex items-center gap-1"
            title="Hermes phân tích chiến dịch"
          >
            <Brain size={14} /> HERMES REVIEW
          </button>
          <button
            onClick={() => nav(`/campaigns/${id}/edit`)}
            className="btn-ghost"
            title="Edit campaign"
          >
            <Edit size={14} />
          </button>
        </div>

        {/* Plan summary (if present) */}
        {(campaign.mission || campaign.description || campaign.plan_summary) && (
          <div className="mt-3">
            <HermesCaller taskType="ai_pilot" />
            <div className="text-[12px] text-app-muted mt-1 line-clamp-2">
              {campaign.mission || campaign.description || campaign.plan_summary}
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className="flex items-center gap-8 mt-4">
          <DenseStat value={rolesCount} label="Roles" />
          <DenseStat value={nicksCount} label="Agents" color="hermes" />
          <DenseStat value={campaign.total_posts ?? 0} label="Posts" />
          <DenseStat value={campaign.total_comments ?? 0} label="Comments" />
          <DenseStat value={campaign.total_leads ?? 0} label="Leads" />
        </div>
      </div>

      {/* ─── Tabs ─── */}
      <div
        className="flex items-center px-6 font-mono-ui text-[11px] uppercase tracking-wider"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setParams({ tab: t.key })}
            className={`px-4 py-2.5 ${tab === t.key ? 'text-hermes' : 'text-app-muted hover:text-app-primary'}`}
            style={{
              borderBottom: tab === t.key ? '2px solid var(--hermes)' : '2px solid transparent',
              marginBottom: '-1px',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Tab body ─── */}
      <div className="flex-1 overflow-hidden min-h-0">
        {tab === 'overview'  && <OverviewTab campaign={campaign} campaignId={id} />}
        {tab === 'agents'    && <AgentsTab campaign={campaign} />}
        {tab === 'execution' && <ExecutionTab campaignId={id} />}
        {tab === 'content'   && <ContentTab campaignId={id} />}
        {tab === 'data'      && <DataTab campaignId={id} />}
      </div>

      {reviewOpen && (
        <HermesReviewModal
          campaign={campaign}
          accounts={allAccounts}
          jobs={allJobs}
          onClose={() => setReviewOpen(false)}
        />
      )}
    </div>
  )
}
