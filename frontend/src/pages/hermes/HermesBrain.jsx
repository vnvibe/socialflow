/**
 * /hermes — Hermes Brain page.
 * Left: skills list with scores.
 * Right: selected skill detail + recent outputs.
 * Bottom: live call feed.
 */
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '../../lib/api'
import SkillCard from '../../components/hermes/SkillCard'
import HermesScoreBadge from '../../components/hermes/HermesScoreBadge'
import DenseStat from '../../components/hermes/DenseStat'

function formatAgo(ts) {
  if (!ts) return '—'
  const sec = Math.round((Date.now() - (typeof ts === 'number' ? ts * 1000 : new Date(ts).getTime())) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.round(sec / 60)}m ago`
  return `${Math.round(sec / 3600)}h ago`
}

export default function HermesBrain() {
  const [selected, setSelected] = useState(null)

  const { data: perf } = useQuery({
    queryKey: ['hermes', 'performance'],
    queryFn: async () => (await api.get('/ai-hermes/performance')).data,
    refetchInterval: 15000,
  })

  const { data: status } = useQuery({
    queryKey: ['hermes', 'status'],
    queryFn: async () => (await api.get('/ai-hermes/status')).data,
    refetchInterval: 10000,
  })

  const { data: feedback } = useQuery({
    queryKey: ['hermes', 'feedback'],
    queryFn: async () => (await api.get('/ai-hermes/feedback/recent?limit=30')).data,
    refetchInterval: 15000,
  })

  const skills = perf?.skills || []
  const recentCalls = perf?.recent_calls || []
  const recentFeedback = feedback?.feedback || []

  const activeSkill = selected || skills[0]

  return (
    <div className="flex flex-col h-full">
      {/* Header stats */}
      <div
        className="flex items-center gap-8 px-6 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <div className="font-mono-ui text-[10px] uppercase text-app-muted">Hermes Brain</div>
          <div className="text-app-primary text-lg mt-1">Skill performance + learning metrics</div>
        </div>
        <div className="flex-1" />
        <DenseStat value={status?.total_calls || 0} label="Total calls" />
        <DenseStat value={status?.calls_last_hour || 0} label="Last hour" />
        <DenseStat value={(status?.avg_score || 0).toFixed(1)} label="Avg score" color={status?.avg_score >= 4 ? 'hermes' : 'warn'} />
        <DenseStat value={status?.active_agents || 0} label="Agents" />
        <DenseStat value={status?.total_errors || 0} label="Errors" color={status?.total_errors > 0 ? 'danger' : 'primary'} />
      </div>

      {/* Body: 2 columns */}
      <div className="flex-1 flex min-h-0">
        {/* Left: skills list */}
        <div
          className="w-80 flex flex-col"
          style={{ borderRight: '1px solid var(--border)' }}
        >
          <div
            className="px-3 py-2 font-mono-ui text-[10px] uppercase tracking-wider text-app-muted"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            Skills ({skills.length})
          </div>
          <div className="flex-1 overflow-y-auto">
            {skills.length === 0 && (
              <div className="p-4 text-app-muted text-xs font-mono-ui">
                No skill data yet. Trigger some agent jobs to populate.
              </div>
            )}
            {skills.map((s) => (
              <SkillCard
                key={s.task_type}
                skill={s}
                isActive={activeSkill?.task_type === s.task_type}
                onClick={() => setSelected(s)}
              />
            ))}
          </div>
        </div>

        {/* Right: skill detail */}
        <div className="flex-1 flex flex-col min-w-0">
          {activeSkill ? (
            <>
              <div
                className="px-6 py-4"
                style={{ borderBottom: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono-ui text-xl text-app-primary">{activeSkill.task_type}</span>
                  <HermesScoreBadge score={activeSkill.avg_score} size="lg" showLabel />
                </div>
                <div className="flex gap-6 mt-4">
                  <div>
                    <div className="text-[10px] uppercase text-app-muted font-mono-ui">Calls</div>
                    <div className="font-mono-ui text-lg text-app-primary mt-0.5">{activeSkill.count}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-app-muted font-mono-ui">Errors</div>
                    <div className={`font-mono-ui text-lg mt-0.5 ${activeSkill.errors > 0 ? 'text-danger' : 'text-app-primary'}`}>
                      {activeSkill.errors}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-app-muted font-mono-ui">Avg latency</div>
                    <div className="font-mono-ui text-lg text-app-primary mt-0.5">{activeSkill.avg_latency_ms}ms</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase text-app-muted font-mono-ui">Examples</div>
                    <div className="font-mono-ui text-lg text-app-primary mt-0.5">{activeSkill.examples}</div>
                  </div>
                </div>
              </div>

              {/* Recent outputs for this skill */}
              <div className="flex-1 overflow-y-auto">
                <div
                  className="px-6 py-2 font-mono-ui text-[10px] uppercase tracking-wider text-app-muted"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  Recent outputs ({recentFeedback.filter(f => f.task_type === activeSkill.task_type).length})
                </div>
                {recentFeedback
                  .filter(f => f.task_type === activeSkill.task_type)
                  .slice(0, 20)
                  .map((fb, i) => (
                    <div
                      key={i}
                      className="px-6 py-3"
                      style={{ borderBottom: '1px solid var(--border)' }}
                    >
                      <div className="flex items-center gap-3 mb-1">
                        <HermesScoreBadge score={fb.score} />
                        <span className="text-[10px] font-mono-ui text-app-muted">
                          {fb.account_id ? fb.account_id.slice(0, 8) : '—'}
                        </span>
                        <span className="text-[10px] font-mono-ui text-app-dim">
                          {formatAgo(fb.ts)}
                        </span>
                        {fb.reason && (
                          <span className="text-[10px] font-mono-ui text-app-muted">
                            · {fb.reason}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-app-primary font-mono-ui line-clamp-2">
                        {fb.output_preview}
                      </div>
                    </div>
                  ))}
                {recentFeedback.filter(f => f.task_type === activeSkill.task_type).length === 0 && (
                  <div className="p-6 text-app-muted text-xs font-mono-ui">
                    No feedback examples yet for {activeSkill.task_type}.
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-6 text-app-muted">Select a skill to view details.</div>
          )}
        </div>
      </div>

      {/* Bottom: live call feed */}
      <div
        className="h-56 flex flex-col"
        style={{ borderTop: '1px solid var(--border-bright)' }}
      >
        <div
          className="px-3 py-2 font-mono-ui text-[10px] uppercase tracking-wider text-app-muted flex items-center gap-2"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span className="w-1 h-1 rounded-full bg-hermes hermes-pulse" />
          Live call feed · last {recentCalls.length}
        </div>
        <div className="flex-1 overflow-y-auto font-mono-ui text-[11px]">
          {recentCalls.slice().reverse().map((c, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-3 py-1.5"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <span className={c.ok ? 'text-hermes' : 'text-danger'}>{c.ok ? 'OK' : 'FAIL'}</span>
              <span className="w-32 truncate text-app-primary">{c.task_type}</span>
              <span className="w-16 text-right text-app-muted">{c.latency_ms}ms</span>
              <span className="flex-1 truncate text-app-muted">{c.prompt}</span>
              <span className="text-app-dim">{formatAgo(c.ts)}</span>
            </div>
          ))}
          {recentCalls.length === 0 && (
            <div className="p-4 text-app-muted">No calls recorded yet.</div>
          )}
        </div>
      </div>
    </div>
  )
}
