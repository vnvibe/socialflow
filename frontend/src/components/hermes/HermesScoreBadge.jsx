/**
 * HermesScoreBadge — shows a Hermes quality score with color coding.
 * Green ≥ 4, Yellow ≥ 3, Red < 3. Mono font for numbers.
 */
export default function HermesScoreBadge({ score, size = 'sm', showLabel = false }) {
  const value = typeof score === 'number' ? score : parseFloat(score)
  const hasScore = !isNaN(value)

  const color = !hasScore ? 'text-app-dim' : value >= 4 ? 'text-hermes' : value >= 3 ? 'text-warn' : 'text-danger'
  const bg = !hasScore ? 'transparent' : value >= 4 ? 'var(--hermes-dim)' : value >= 3 ? 'rgba(249,115,22,0.12)' : 'rgba(239,68,68,0.12)'
  const border = !hasScore ? 'var(--border)' : value >= 4 ? 'var(--hermes-fade)' : value >= 3 ? 'rgba(249,115,22,0.4)' : 'rgba(239,68,68,0.4)'

  const sizeClass = size === 'lg'
    ? 'text-sm px-2 py-1'
    : 'text-xs px-1.5 py-0.5'

  return (
    <span
      className={`inline-flex items-center gap-1 font-mono-ui ${sizeClass} ${color}`}
      style={{ background: bg, border: `1px solid ${border}` }}
      title={hasScore ? `Hermes score: ${value}` : 'No Hermes score yet'}
    >
      {showLabel && <span className="text-[10px] text-app-muted uppercase">H</span>}
      {hasScore ? value.toFixed(1) : '—'}
    </span>
  )
}
