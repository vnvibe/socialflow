/**
 * SkillCard — left-column entry in /hermes Brain page.
 * Shows skill name + call count + avg score.
 */
import HermesScoreBadge from './HermesScoreBadge'

export default function SkillCard({ skill, isActive, onClick }) {
  const name = skill.task_type || skill.name || '?'
  const calls = skill.count ?? skill.calls ?? 0
  const avgScore = skill.avg_score ?? 0
  const errors = skill.errors ?? 0

  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-3 font-mono-ui hover-row"
      style={{
        background: isActive ? 'var(--bg-hover)' : 'transparent',
        borderLeft: isActive ? '2px solid var(--hermes)' : '2px solid transparent',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-app-primary">{name}</span>
        <HermesScoreBadge score={avgScore} />
      </div>
      <div className="flex items-center gap-3 mt-1 text-[10px] text-app-muted">
        <span>{calls} calls</span>
        {errors > 0 && <span className="text-danger">{errors} err</span>}
        {skill.avg_latency_ms > 0 && <span>{skill.avg_latency_ms}ms</span>}
      </div>
    </button>
  )
}
