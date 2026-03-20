import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'

/**
 * Hook to check if agent is online before performing agent-dependent actions.
 * Reads from the cached ['agent-status'] query (polled by AgentStatus component).
 *
 * Usage:
 *   const { requireAgent } = useAgentGuard()
 *   const handleClick = () => requireAgent(() => { mutation.mutate(...) })
 */
export default function useAgentGuard() {
  const queryClient = useQueryClient()

  const requireAgent = (callback) => {
    const status = queryClient.getQueryData(['agent-status'])
    if (!status?.online) {
      toast.error('Agent chưa chạy! Khởi động agent trước khi thực hiện.', {
        duration: 5000,
        id: 'agent-offline-guard',
      })
      return false
    }
    return callback()
  }

  const isAgentOnline = () => {
    const status = queryClient.getQueryData(['agent-status'])
    return status?.online ?? false
  }

  return { requireAgent, isAgentOnline }
}
