import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, Trash2, Play, ChevronDown, ChevronUp, Shield, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../../lib/api'

const ROLE_ICONS = { scout: '🔍', nurture: '💚', connect: '🤝', post: '✍️', custom: '⚙️' }
const ROLE_TYPES = ['scout', 'nurture', 'connect', 'post', 'custom']

export default function NicksSection({ campaignId, campaign, accountIds }) {
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(null)

  const roles = campaign?.campaign_roles || []

  // Fetch accounts for display
  const { data: allAccounts = [] } = useQuery({
    queryKey: ['accounts-list'],
    queryFn: () => api.get('/accounts').then(r => r.data || []),
  })

  const accountMap = {}
  for (const a of allAccounts) accountMap[a.id] = a

  const deleteMut = useMutation({
    mutationFn: (roleId) => api.delete(`/campaigns/${campaignId}/roles/${roleId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] }); toast.success('Da xoa role') },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-app-primary">Nhan vat & Roles</h2>
        <button
          onClick={() => window.location.href = `/campaigns/${campaignId}/edit`}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-info text-white rounded-lg hover:opacity-90 transition-colors text-sm font-medium"
        >
          <Plus size={14} /> Them Role
        </button>
      </div>

      {roles.length === 0 ? (
        <div className="text-center py-12 bg-app-surface rounded border border-app-border">
          <Users size={40} className="mx-auto text-app-muted mb-3" />
          <p className="text-app-muted text-sm">Chua co role nao</p>
        </div>
      ) : (
        <div className="space-y-3">
          {roles.map(role => {
            const isOpen = expanded === role.id
            const accounts = (role.account_ids || []).map(id => accountMap[id]).filter(Boolean)
            const plan = role.parsed_plan || []

            return (
              <div key={role.id} className="bg-app-surface rounded border border-app-border overflow-hidden">
                {/* Role Header */}
                <div
                  className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-app-base transition-colors"
                  onClick={() => setExpanded(isOpen ? null : role.id)}
                >
                  <span className="text-xl">{ROLE_ICONS[role.role_type] || '⚙️'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-app-primary">{role.name}</h3>
                      <span className="text-xs px-2 py-0.5 bg-app-elevated text-app-muted rounded-full">{role.role_type}</span>
                    </div>
                    <p className="text-xs text-app-muted truncate mt-0.5">{role.mission || 'Khong co mo ta'}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-xs text-app-muted">
                      <Users size={12} className="inline mr-1" />{accounts.length} nicks
                    </span>
                    <span className="text-xs text-app-muted">{plan.length} steps</span>
                    {isOpen ? <ChevronUp size={16} className="text-app-muted" /> : <ChevronDown size={16} className="text-app-muted" />}
                  </div>
                </div>

                {/* Expanded Content */}
                {isOpen && (
                  <div className="border-t border-app-border px-5 py-4 space-y-4">
                    {/* Assigned Accounts */}
                    <div>
                      <h4 className="text-xs font-semibold text-app-muted uppercase tracking-wider mb-2">Tai khoan</h4>
                      <div className="flex flex-wrap gap-2">
                        {accounts.map(acc => (
                          <div key={acc.id} className="flex items-center gap-2 px-3 py-1.5 bg-app-elevated rounded-lg text-sm text-app-muted">
                            <span className={`w-2 h-2 rounded-full ${acc.status === 'alive' ? 'bg-hermes' : 'bg-app-muted'}`} />
                            <span className="font-medium">{acc.username}</span>
                          </div>
                        ))}
                        {accounts.length === 0 && <p className="text-xs text-app-muted">Chua gan tai khoan</p>}
                      </div>
                    </div>

                    {/* Parsed Plan */}
                    {plan.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-app-muted uppercase tracking-wider mb-2">Ke hoach</h4>
                        <div className="space-y-1.5">
                          {plan.map((step, i) => (
                            <div key={i} className="flex items-start gap-2 text-sm">
                              <span className="w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-xs flex items-center justify-center shrink-0 mt-0.5">
                                {i + 1}
                              </span>
                              <span className="text-app-muted">{step.description || step.action}</span>
                              {(step.count_min || step.count_max) && (
                                <span className="text-xs text-app-muted shrink-0">
                                  ({step.count_min || 0}-{step.count_max || step.count_min || 0}/run)
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t border-app-border">
                      <button
                        onClick={() => { if (confirm('Xoa role nay?')) deleteMut.mutate(role.id) }}
                        className="flex items-center gap-1 px-3 py-1.5 text-xs text-red-700 bg-red-50  rounded-lg hover:bg-red-100 transition-colors"
                      >
                        <Trash2 size={12} /> Xoa
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
