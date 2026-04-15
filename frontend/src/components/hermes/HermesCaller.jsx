/**
 * HermesCaller — small tag shown above any AI-generated output.
 * Makes it obvious that Hermes produced this text.
 */
export default function HermesCaller({ taskType, score, source = 'hermes', latencyMs }) {
  return (
    <div className="inline-flex items-center gap-2 font-mono-ui text-[10px] uppercase tracking-wider text-app-muted">
      <span className="hermes-pulse inline-block w-1 h-1 rounded-full bg-hermes" />
      <span className="text-hermes">AI: {source}</span>
      {taskType && <span>· {taskType}</span>}
      {score !== undefined && <span>· score {score}</span>}
      {latencyMs !== undefined && <span>· {latencyMs}ms</span>}
    </div>
  )
}
