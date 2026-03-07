import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Ban,
  HelpCircle,
  Loader,
} from 'lucide-react'

const healthConfig = {
  healthy: {
    color: 'bg-green-100 text-green-700',
    icon: CheckCircle,
  },
  checking: {
    color: 'bg-blue-100 text-blue-700',
    icon: Loader,
    animate: true,
  },
  checkpoint: {
    color: 'bg-yellow-100 text-yellow-700',
    icon: AlertTriangle,
  },
  expired: {
    color: 'bg-red-100 text-red-700',
    icon: XCircle,
  },
  disabled: {
    color: 'bg-gray-100 text-gray-500',
    icon: Ban,
  },
  unknown: {
    color: 'bg-gray-100 text-gray-500',
    icon: HelpCircle,
  },
}

export default function HealthBadge({ status }) {
  const config = healthConfig[status] || healthConfig.unknown
  const Icon = config.icon

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${config.color}`}
    >
      <Icon className={`w-3.5 h-3.5 ${config.animate ? 'animate-spin' : ''}`} />
      {status || 'unknown'}
    </span>
  )
}
