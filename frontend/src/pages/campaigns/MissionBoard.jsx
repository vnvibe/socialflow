/**
 * /campaigns — Mission Board.
 * Card grid showing campaigns with Hermes plan summary.
 */
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import api from '../../lib/api'
import DenseStat from '../../components/hermes/DenseStat'
import HermesCaller from '../../components/hermes/HermesCaller'

const STATUS_COLOR = {
  active:  'text-hermes',
  running: 'text-hermes',
  paused:  'text-warn',
  draft:   'text-app-muted',
  done:    'text-info',
  archived: 'text-app-dim',
}

function CampaignCard({ campaign, onClick }) {
  const plan = campaign.plan_summary || campaign.description || campaign.mission || ''
  const status = campaign.status || 'draft'
  const rolesCount = campaign.roles_count ?? campaign.role_count ?? 0
  const nicksCount = campaign.nicks_count ?? campaign.assigned_accounts_count ?? 0
  const todayPosts = campaign.posts_today ?? 0
  const todayComments = campaign.comments_today ?? 0

  return (
    <div
      onClick={onClick}
      className="cursor-pointer p-4 bg-app-surface hover:bg-app-hover transition-colors"
      style={{
        border: '1px solid var(--border)',
        borderLeft: status === 'active' || status === 'running' ? '2px solid var(--hermes)' : '1px solid var(--border)',
      }}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0 flex-1">
          <div className="text-app-primary truncate font-ui">{campaign.name}</div>
          <div className="text-[10px] font-mono-ui text-app-muted uppercase tracking-wider mt-0.5">
            {campaign.topic || campaign.mission?.substring(0, 60) || '—'}
          </div>
        </div>
        <span className={`font-mono-ui text-[10px] uppercase tracking-wider ${STATUS_COLOR[status] || 'text-app-muted'}`}>
          ● {status}
        </span>
      </div>

      {plan && (
        <div className="mb-3">
          <HermesCaller taskType="ai_pilot" />
          <div className="text-[11px] text-app-muted mt-1 line-clamp-2">{plan.substring(0, 200)}</div>
        </div>
      )}

      <div className="flex items-center gap-4 mt-4 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
        <div className="font-mono-ui text-xs">
          <span className="text-app-muted">agents </span>
          <span className="text-app-primary">{nicksCount}</span>
        </div>
        <div className="font-mono-ui text-xs">
          <span className="text-app-muted">roles </span>
          <span className="text-app-primary">{rolesCount}</span>
        </div>
        <div className="flex-1" />
        <div className="font-mono-ui text-xs">
          <span className="text-app-muted">today </span>
          <span className="text-hermes">{todayPosts + todayComments}</span>
        </div>
      </div>
    </div>
  )
}

export default function MissionBoard() {
  const nav = useNavigate()

  const { data: campaigns = [] } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => (await api.get('/campaigns')).data || [],
    refetchInterval: 30000,
  })

  const active = campaigns.filter(c => c.status === 'active' || c.status === 'running').length
  const paused = campaigns.filter(c => c.status === 'paused').length
  const drafts = campaigns.filter(c => c.status === 'draft').length

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-8 px-6 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <div className="font-mono-ui text-[10px] uppercase text-app-muted">Missions</div>
          <div className="text-app-primary text-lg mt-1">Campaign board ({campaigns.length})</div>
        </div>
        <div className="flex-1" />
        <DenseStat value={active} label="Active" color="hermes" />
        <DenseStat value={paused} label="Paused" color="warn" />
        <DenseStat value={drafts} label="Drafts" />
        <button
          onClick={() => nav('/campaigns/new')}
          className="btn-hermes"
        >
          + New mission
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {campaigns.length === 0 ? (
          <div className="text-center text-app-muted py-12">
            <div className="text-sm mb-2">No campaigns yet</div>
            <button onClick={() => nav('/campaigns/new')} className="btn-hermes">
              Create first mission
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {campaigns.map(c => (
              <CampaignCard
                key={c.id}
                campaign={c}
                onClick={() => nav(`/campaigns/${c.id}`)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
