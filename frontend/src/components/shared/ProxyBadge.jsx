import { Globe } from 'lucide-react'

export default function ProxyBadge({ proxy }) {
  if (!proxy) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
        <Globe className="w-3.5 h-3.5" />
        No proxy
      </span>
    )
  }

  const isActive = proxy.is_active !== false
  const label = `${proxy.host}:${proxy.port}`

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-600">
      <span
        className={`w-2 h-2 rounded-full shrink-0 ${
          isActive ? 'bg-green-500' : 'bg-red-500'
        }`}
      />
      {label}
    </span>
  )
}
