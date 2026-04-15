/**
 * DenseStat — big mono number with tiny label underneath.
 * Use in command-center dashboards.
 */
export default function DenseStat({ value, label, trend, color = 'primary' }) {
  const colorClass = color === 'hermes' ? 'text-hermes'
    : color === 'warn' ? 'text-warn'
    : color === 'danger' ? 'text-danger'
    : 'text-app-primary'

  const displayValue = typeof value === 'number'
    ? (value >= 10000 ? `${(value / 1000).toFixed(1)}K` : value.toLocaleString())
    : (value ?? '—')

  return (
    <div className="flex flex-col">
      <span className={`font-mono-ui text-2xl font-semibold leading-none ${colorClass}`}>
        {displayValue}
      </span>
      <span className="text-[10px] uppercase tracking-wider text-app-muted mt-1 font-mono-ui">
        {label}
      </span>
      {trend !== undefined && (
        <span className={`text-[10px] font-mono-ui mt-0.5 ${trend > 0 ? 'text-hermes' : trend < 0 ? 'text-danger' : 'text-app-muted'}`}>
          {trend > 0 ? '↑' : trend < 0 ? '↓' : '→'} {Math.abs(trend)}%
        </span>
      )}
    </div>
  )
}
