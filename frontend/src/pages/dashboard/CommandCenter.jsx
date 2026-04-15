/**
 * /dashboard — Command Center.
 * 3-column: Active agents | Live job feed | Hermes stats.
 */
import { useQuery } from '@tanstack/react-query'
import api from '../../lib/api'
import DenseStat from '../../components/hermes/DenseStat'
import AgentStatusDot from '../../components/hermes/AgentStatusDot'
import JobRow from '../../components/hermes/JobRow'
import HermesScoreBadge from '../../components/hermes/HermesScoreBadge'

function Col({ title, children, extra }) {
  return (
    <div className="flex flex-col min-h-0" style={{ borderRight: '1px solid var(--border)' }}>
      <div
        className="px-3 py-2 flex items-center justify-between font-mono-ui text-[10px] uppercase tracking-wider text-app-muted"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span>{title}</span>
        {extra}
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  )
}

export default function CommandCenter() {
  // Accounts
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => (await api.get('/accounts')).data || [],
    refetchInterval: 30000,
  })

  // Live jobs (pending + claimed + running + recent done)
  const { data: jobs = [] } = useQuery({
    queryKey: ['jobs', 'recent'],
    queryFn: async () => (await api.get('/jobs?limit=25')).data || [],
    refetchInterval: 3000,
  })

  // Hermes performance
  const { data: perf } = useQuery({
    queryKey: ['hermes', 'performance'],
    queryFn: async () => (await api.get('/ai-hermes/performance')).data,
    refetchInterval: 10000,
  })

  // Job stats
  const { data: jobStats } = useQuery({
    queryKey: ['jobs', 'stats'],
    queryFn: async () => (await api.get('/jobs/stats')).data,
    refetchInterval: 15000,
  })

  const activeAccounts = accounts.filter(a => a.is_active)
  const runningJobs = jobs.filter(j => ['claimed', 'running'].includes(j.status))
  const pendingJobs = jobs.filter(j => j.status === 'pending')

  return (
    <div className="flex flex-col h-full">
      {/* Top stat row */}
      <div
        className="flex items-center gap-8 px-6 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <div className="font-mono-ui text-[10px] uppercase text-app-muted">Command Center</div>
          <div className="text-app-primary text-lg mt-1">Live operations</div>
        </div>
        <div className="flex-1" />
        <DenseStat value={activeAccounts.length} label="Agents online" color="hermes" />
        <DenseStat value={runningJobs.length} label="Jobs running" color="hermes" />
        <DenseStat value={pendingJobs.length} label="Queued" />
        <DenseStat value={jobStats?.done_today || 0} label="Done today" />
        <DenseStat value={jobStats?.failed_today || 0} label="Failed" color={jobStats?.failed_today > 0 ? 'danger' : 'primary'} />
      </div>

      {/* 3 columns */}
      <div className="flex-1 grid grid-cols-3 min-h-0">
        {/* Col 1: Active agents */}
        <Col title={`Agents (${activeAccounts.length})`}>
          {activeAccounts.length === 0 && (
            <div className="p-4 text-app-muted text-xs font-mono-ui">No active agents.</div>
          )}
          {activeAccounts.map((acc) => {
            const currentJob = runningJobs.find(j => j.payload?.account_id === acc.id)
            return (
              <div
                key={acc.id}
                className="flex items-center gap-3 px-3 py-2 font-mono-ui text-xs hover-row"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <AgentStatusDot
                  status={currentJob ? 'busy' : acc.status === 'healthy' ? 'online' : 'error'}
                  pulse={!!currentJob}
                />
                <span className="flex-1 truncate text-app-primary">{acc.username || acc.id.slice(0, 8)}</span>
                {currentJob && (
                  <span className="text-info text-[10px] truncate max-w-[100px]">
                    {currentJob.type}
                  </span>
                )}
                <span className="text-app-muted text-[10px]">{acc.status}</span>
              </div>
            )
          })}
        </Col>

        {/* Col 2: Live job feed */}
        <Col title={`Jobs (live · 3s poll)`}>
          {jobs.length === 0 && (
            <div className="p-4 text-app-muted text-xs font-mono-ui">No jobs.</div>
          )}
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </Col>

        {/* Col 3: Hermes stats */}
        <Col title="Hermes Brain">
          {!perf && (
            <div className="p-4 text-app-muted text-xs font-mono-ui">Loading...</div>
          )}
          {perf && (
            <>
              <div
                className="px-3 py-2 text-[10px] uppercase text-app-muted font-mono-ui"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                Skills ({perf.skills?.length || 0})
              </div>
              {(perf.skills || []).map((s) => (
                <div
                  key={s.task_type}
                  className="flex items-center gap-3 px-3 py-2 font-mono-ui text-xs hover-row"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <span className="flex-1 truncate text-app-primary">{s.task_type}</span>
                  <span className="text-app-muted text-[10px]">{s.count} calls</span>
                  <HermesScoreBadge score={s.avg_score} />
                </div>
              ))}
              {perf.skills?.length === 0 && (
                <div className="p-4 text-app-muted text-xs font-mono-ui">
                  No Hermes calls yet.
                </div>
              )}
            </>
          )}
        </Col>
      </div>
    </div>
  )
}
