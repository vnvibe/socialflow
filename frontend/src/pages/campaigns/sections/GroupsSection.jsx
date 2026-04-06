import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { UsersRound, Plus, Trash2, Search, RefreshCw, Star, Loader, PlusCircle, MinusCircle, CheckCircle, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../../lib/api'

const TYPE_BADGE = {
  public: 'bg-green-100 text-green-700',
  closed: 'bg-yellow-100 text-yellow-700',
  secret: 'bg-red-100 text-red-700',
}

export default function GroupsSection({ campaignId, campaign, accountIds }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [addInput, setAddInput] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [tagFilter, setTagFilter] = useState('')

  const topicKey = (campaign?.topic || '').toLowerCase().trim().replace(/\s+/g, '_').slice(0, 50)

  const { data: campaignGroups = [], isLoading } = useQuery({
    queryKey: ['campaign-groups', campaignId],
    queryFn: () => api.get(`/campaigns/${campaignId}/groups`).then(r => r.data || []),
  })

  const { data: allGroups = [], isLoading: allLoading } = useQuery({
    queryKey: ['all-account-groups', accountIds.join(',')],
    queryFn: async () => {
      if (!accountIds.length) return []
      const results = []
      const seen = new Set()
      for (const accId of accountIds) {
        try {
          const { data } = await api.get(`/accounts/${accId}/groups`)
          for (const g of (data || [])) {
            if (!seen.has(g.fb_group_id)) {
              seen.add(g.fb_group_id)
              results.push(g)
            }
          }
        } catch {}
      }
      return results
    },
    enabled: showAll && accountIds.length > 0,
  })

  const assignMut = useMutation({
    mutationFn: ({ groupId, action }) => api.put(`/campaigns/${campaignId}/groups/${groupId}`, { action }),
    onSuccess: (_, { action }) => {
      queryClient.invalidateQueries({ queryKey: ['campaign-groups', campaignId] })
      toast.success(action === 'add' ? 'Da them nhom vao campaign' : 'Da go nhom khoi campaign')
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi'),
  })

  const bulkAddMut = useMutation({
    mutationFn: async (lines) => {
      const urls = lines.split('\n').map(l => l.trim()).filter(Boolean)
      if (!urls.length) throw new Error('Khong co URL')
      return api.post('/groups/bulk-add', { urls, account_id: accountIds[0] })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign-groups', campaignId] })
      queryClient.invalidateQueries({ queryKey: ['all-account-groups'] })
      toast.success('Da them nhom')
      setShowAdd(false)
      setAddInput('')
    },
    onError: (err) => toast.error(err.response?.data?.error || err.message),
  })

  const reviewMut = useMutation({
    mutationFn: ({ groupId, approved }) => api.put(`/campaigns/${campaignId}/groups/${groupId}/review`, { approved }),
    onSuccess: (_, { approved }) => {
      queryClient.invalidateQueries({ queryKey: ['campaign-groups', campaignId] })
      queryClient.invalidateQueries({ queryKey: ['all-account-groups'] })
      toast.success(approved ? 'Da duyet group' : 'Da tu choi group')
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi'),
  })

  const groups = showAll ? allGroups : campaignGroups
  const campaignGroupIds = new Set(campaignGroups.map(g => g.id))
  const allTags = [...new Set(groups.flatMap(g => g.tags || []).filter(Boolean))]

  const filtered = groups.filter(g => {
    if (search && !(g.name || '').toLowerCase().includes(search.toLowerCase()) && !(g.fb_group_id || '').includes(search)) return false
    if (tagFilter && !(g.tags || []).includes(tagFilter)) return false
    return true
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">
          Nhom Facebook ({showAll ? `${allGroups.length} tat ca` : `${campaignGroups.length} campaign`})
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAll(!showAll)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              showAll ? 'border-purple-200 bg-purple-100 text-purple-700' : 'border-gray-200 text-gray-500 hover:bg-gray-100'
            }`}
          >
            {showAll ? 'Tat ca nhom' : 'Campaign only'}
          </button>
          <button
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ['campaign-groups', campaignId] })
              queryClient.invalidateQueries({ queryKey: ['all-account-groups'] })
            }}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-100 disabled:opacity-50"
          >
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            {isLoading ? 'Dang tai...' : 'Refresh'}
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={14} /> Them nhom
          </button>
        </div>
      </div>

      {/* Add Panel */}
      {showAdd && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <p className="text-xs text-gray-500 mb-2">Moi dong 1 URL hoac ID nhom</p>
          <textarea
            value={addInput} onChange={e => setAddInput(e.target.value)} rows={4}
            className="w-full border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 px-3 py-2 text-sm font-mono"
            placeholder="https://facebook.com/groups/123456"
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-sm text-gray-500">Huy</button>
            <button onClick={() => bulkAddMut.mutate(addInput)} disabled={bulkAddMut.isPending}
              className="px-4 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm disabled:opacity-50">
              {bulkAddMut.isPending ? 'Dang them...' : 'Them'}
            </button>
          </div>
        </div>
      )}

      {/* Tag Filter Pills */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          <button
            onClick={() => setTagFilter('')}
            className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              !tagFilter ? 'bg-purple-600 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-100'
            }`}
          >
            Tat ca ({groups.length})
          </button>
          {allTags.map(tag => {
            const count = groups.filter(g => (g.tags || []).includes(tag)).length
            return (
              <button
                key={tag}
                onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                  tagFilter === tag ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-300 hover:bg-purple-100'
                }`}
              >
                #{tag} ({count})
              </button>
            )
          })}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Tim theo ten, ID, tag..."
          className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-[1fr_80px_50px_70px_150px_80px_60px] gap-2 px-4 py-2.5 bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase tracking-wider">
          <div>Tên nhóm</div>
          <div>AI Score</div>
          <div>Risk</div>
          <div>Loại</div>
          <div>AI Nhận xét</div>
          <div>Tags</div>
          <div>Review</div>
        </div>

        {isLoading || (showAll && allLoading) ? (
          <div className="flex items-center justify-center py-12">
            <Loader size={20} className="animate-spin text-purple-600" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-sm">
            {showAll ? 'Chua co nhom nao' : 'Chua co nhom nao trong campaign. Bam "Tat ca nhom" de gan.'}
          </div>
        ) : (
          filtered.slice(0, 100).map(g => {
            const aiEval = g.ai_relevance?.[topicKey]
            const score = aiEval?.score
            const tier = aiEval?.tier || (score >= 8 ? 'tier1_potential' : score >= 5 ? 'tier2_prospect' : score !== undefined ? 'tier3_irrelevant' : null)
            const tierConfig = {
              tier1_potential: { label: 'Tiem nang', color: 'bg-green-100 text-green-700' },
              tier2_prospect: { label: 'Trien vong', color: 'bg-blue-100 text-blue-700' },
              tier3_irrelevant: { label: 'Khong PH', color: 'bg-gray-100 text-gray-500' },
            }
            const tierCfg = tierConfig[tier] || null
            const inCampaign = campaignGroupIds.has(g.id)

            const isBlacklisted = g.skip_until && new Date(g.skip_until) > new Date()
            const riskLevel = g.ai_risk_level
            const RISK_BADGE = {
              low: 'bg-green-100 text-green-700',
              medium: 'bg-yellow-100 text-yellow-700',
              high: 'bg-red-100 text-red-700',
            }

            return (
              <div key={g.id} className={`grid grid-cols-[1fr_80px_50px_70px_150px_80px_60px] gap-2 px-4 py-2.5 border-b border-gray-100 hover:bg-gray-50 transition-colors items-center text-sm ${
                g.user_approved === false ? 'opacity-40' : isBlacklisted ? 'opacity-50 bg-red-50/30' : ''
              }`}>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 truncate">{g.name || g.fb_group_id}</p>
                  <div className="flex items-center gap-2">
                    {g.account_username && <span className="text-[10px] text-gray-400">{g.account_username}</span>}
                    <span className="text-[10px] text-gray-400">{g.member_count?.toLocaleString() || '?'} members</span>
                    {isBlacklisted && (
                      <span className="text-[9px] text-red-500 font-medium">Blacklist đến {new Date(g.skip_until).toLocaleDateString('vi-VN')}</span>
                    )}
                  </div>
                </div>
                <div className="text-xs" title={aiEval?.reason || ''}>
                  {isBlacklisted ? (
                    <span className="text-[10px] text-red-400 font-medium">Chặn</span>
                  ) : tierCfg ? (
                    <div className="flex flex-col gap-0.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${tierCfg.color}`}>{tierCfg.label}</span>
                      <span className="text-gray-500 text-[10px]">{g.ai_join_score || score}/10</span>
                    </div>
                  ) : '--'}
                </div>
                <div>
                  {riskLevel ? (
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${RISK_BADGE[riskLevel] || 'bg-gray-100 text-gray-500'}`}>
                      {riskLevel === 'low' ? 'Thấp' : riskLevel === 'medium' ? 'TB' : riskLevel === 'high' ? 'Cao' : riskLevel}
                    </span>
                  ) : <span className="text-[10px] text-gray-300">--</span>}
                </div>
                <div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_BADGE[g.group_type] || 'bg-gray-100 text-gray-500'}`}>
                    {g.group_type || '?'}
                  </span>
                </div>
                <div className="text-[11px] text-gray-600 leading-tight">
                  {g.ai_note || aiEval?.note || aiEval?.reason || <span className="text-gray-300">Chua danh gia</span>}
                  {aiEval?.sample_topics?.length > 0 && (
                    <div className="flex gap-1 mt-0.5 flex-wrap">
                      {aiEval.sample_topics.slice(0, 3).map((t, i) => (
                        <span key={i} className="text-[9px] bg-gray-100 text-gray-500 px-1 rounded">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-0.5">
                  {(g.tags || []).slice(0, 2).map(tag => (
                    <button key={tag} onClick={() => setTagFilter(tag)}
                      className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-50 text-purple-600 hover:bg-purple-100 cursor-pointer">
                      #{tag}
                    </button>
                  ))}
                  {!g.tags?.length && <span className="text-[10px] text-gray-300">--</span>}
                </div>
                <div className="flex items-center gap-1">
                  {g.user_approved === true ? (
                    <span className="text-[10px] text-green-600 font-medium">Duyet</span>
                  ) : g.user_approved === false ? (
                    <span className="text-[10px] text-red-500 font-medium">Tu choi</span>
                  ) : (
                    <>
                      <button
                        onClick={() => reviewMut.mutate({ groupId: g.id, approved: true })}
                        className="p-0.5 text-gray-300 hover:text-green-600 transition-colors"
                        title="Duyet group nay"
                      >
                        <CheckCircle size={14} />
                      </button>
                      <button
                        onClick={() => reviewMut.mutate({ groupId: g.id, approved: false })}
                        className="p-0.5 text-gray-300 hover:text-red-500 transition-colors"
                        title="Tu choi group nay"
                      >
                        <XCircle size={14} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
