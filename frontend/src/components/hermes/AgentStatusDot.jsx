/**
 * AgentStatusDot — status indicator for agent/nick.
 * online=green (pulse), idle=yellow, offline=grey, error=red.
 */
export default function AgentStatusDot({ status = 'offline', pulse = false, size = 'sm' }) {
  const colors = {
    online:  'bg-hermes',
    idle:    'bg-yellow-500',
    offline: 'bg-neutral-600',
    error:   'bg-red-500',
    busy:    'bg-info',
  }
  const cls = colors[status] || colors.offline
  const sizeCls = size === 'lg' ? 'w-2.5 h-2.5' : 'w-1.5 h-1.5'
  const animate = pulse && (status === 'online' || status === 'busy') ? 'hermes-pulse' : ''
  return (
    <span
      className={`inline-block rounded-full ${cls} ${sizeCls} ${animate}`}
      title={status}
    />
  )
}
