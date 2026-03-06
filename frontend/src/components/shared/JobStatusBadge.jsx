import { Clock, Play, CheckCircle, XCircle, Ban, Loader } from 'lucide-react'

const statusConfig = {
  pending: {
    color: 'bg-yellow-100 text-yellow-700',
    icon: Clock,
    pulse: false,
  },
  claimed: {
    color: 'bg-blue-100 text-blue-700',
    icon: Play,
    pulse: false,
  },
  running: {
    color: 'bg-blue-100 text-blue-700',
    icon: Loader,
    pulse: true,
  },
  done: {
    color: 'bg-green-100 text-green-700',
    icon: CheckCircle,
    pulse: false,
  },
  failed: {
    color: 'bg-red-100 text-red-700',
    icon: XCircle,
    pulse: false,
  },
  cancelled: {
    color: 'bg-gray-100 text-gray-500',
    icon: Ban,
    pulse: false,
  },
}

export default function JobStatusBadge({ status }) {
  const config = statusConfig[status] || statusConfig.pending
  const Icon = config.icon

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${
        config.color
      } ${config.pulse ? 'animate-pulse' : ''}`}
    >
      <Icon className="w-3.5 h-3.5" />
      {status}
    </span>
  )
}
