import { useQueryClient } from '@tanstack/react-query'

/**
 * Hook to check agent status. Does NOT block actions — jobs queue to DB,
 * agent picks up when online.
 *
 * Usage:
 *   const { requireAgent, isAgentOnline } = useAgentGuard()
 *   requireAgent(() => { mutation.mutate(...) }) // always runs callback
 */
export default function useAgentGuard() {
  const queryClient = useQueryClient()

  // Always execute callback — jobs are queued to DB, agent processes when online
  const requireAgent = (callback) => {
    return callback()
  }

  const isAgentOnline = () => {
    const status = queryClient.getQueryData(['agent-status'])
    return status?.online ?? false
  }

  return { requireAgent, isAgentOnline }
}
