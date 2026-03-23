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
    label: 'Hoat dong',
  },
  checking: {
    color: 'bg-blue-100 text-blue-700',
    icon: Loader,
    animate: true,
    label: 'Dang kiem tra',
  },
  checkpoint: {
    color: 'bg-yellow-100 text-yellow-700',
    icon: AlertTriangle,
    label: 'Checkpoint',
  },
  dead: {
    color: 'bg-red-100 text-red-700',
    icon: XCircle,
    label: 'Cookie het han',
  },
  expired: {
    color: 'bg-red-100 text-red-700',
    icon: XCircle,
    label: 'Het han',
  },
  disabled: {
    color: 'bg-gray-100 text-gray-500',
    icon: Ban,
    label: 'Vo hieu hoa',
  },
  unknown: {
    color: 'bg-gray-100 text-gray-500',
    icon: HelpCircle,
    label: 'Chua kiem tra',
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
      {config.label || status || 'unknown'}
    </span>
  )
}
