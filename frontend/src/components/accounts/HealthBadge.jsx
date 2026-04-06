import {
  CheckCircle,
  AlertTriangle,
  XCircle,
  Ban,
  HelpCircle,
  Loader,
  ShieldAlert,
} from 'lucide-react'

const healthConfig = {
  healthy: {
    color: 'bg-green-100 text-green-700',
    icon: CheckCircle,
    label: 'Hoạt động',
  },
  checking: {
    color: 'bg-blue-100 text-blue-700',
    icon: Loader,
    animate: true,
    label: 'Đang kiểm tra',
  },
  checkpoint: {
    color: 'bg-yellow-100 text-yellow-700',
    icon: AlertTriangle,
    label: 'Checkpoint',
  },
  at_risk: {
    color: 'bg-orange-100 text-orange-700',
    icon: ShieldAlert,
    label: 'Cảnh báo',
  },
  expired: {
    color: 'bg-red-100 text-red-700',
    icon: XCircle,
    label: 'Hết hạn',
  },
  dead: {
    color: 'bg-red-100 text-red-700',
    icon: XCircle,
    label: 'Hết hạn',
  },
  disabled: {
    color: 'bg-gray-100 text-gray-500',
    icon: Ban,
    label: 'Vô hiệu hóa',
  },
  unknown: {
    color: 'bg-gray-100 text-gray-500',
    icon: HelpCircle,
    label: 'Chưa kiểm tra',
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
