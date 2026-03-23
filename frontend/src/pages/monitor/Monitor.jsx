import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Eye, Search, Plus, Trash2, Play, Pause, RefreshCw, Heart,
  MessageCircle, Share2, Users, ExternalLink, Clock, Loader,
  X, Check, Star, TrendingUp, BarChart3, Filter, Rss, Globe,
  ToggleLeft, ToggleRight, Reply, CheckCircle, XCircle, Timer,
  UserCircle,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'
import ReplyModal from '../../components/monitor/ReplyModal'
import useAgentGuard from '../../hooks/useAgentGuard'

const tabs = [
  { key: 'wall', label: 'Nguon tin', icon: Rss },
  { key: 'posts', label: 'Bai viet', icon: MessageCircle },
  { key: 'engagement', label: 'Tuong tac', icon: TrendingUp },
]

export default function Monitor() {
  const [activeTab, setActiveTab] = useState('wall')
  const [filterAccountId, setFilterAccountId] = useState(() => localStorage.getItem('monitor_account') || '')
  const { requireAgent, isAgentOnline } = useAgentGuard()

  // Fetch FB accounts for filter dropdown
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data),
  })

  const effectiveAccountId = filterAccountId || (accounts.length > 0 ? accounts[0].id : '')

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Eye size={24} className="text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Theo doi</h1>
        </div>
        <div className="flex items-center gap-3">
          {accounts.length > 0 && (
            <div className="flex items-center gap-1.5">
              <UserCircle size={16} className="text-gray-400" />
              <select
                value={filterAccountId}
                onChange={e => {
                  setFilterAccountId(e.target.value)
                  localStorage.setItem('monitor_account', e.target.value)
                }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Tat ca tai khoan</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>
                    {a.username || a.fb_user_id}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit overflow-x-auto">
        {tabs.map(tab => {
          const Icon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                activeTab === tab.key ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      {activeTab === 'wall' && <WallTab filterAccountId={filterAccountId} effectiveAccountId={effectiveAccountId} requireAgent={requireAgent} accounts={accounts} />}
      {activeTab === 'keywords' && <KeywordsTab filterAccountId={filterAccountId} />}
      {activeTab === 'posts' && <PostsTab filterAccountId={filterAccountId} />}
      {activeTab === 'groups' && <GroupsTab filterAccountId={filterAccountId} />}
      {activeTab === 'engagement' && <EngagementTab filterAccountId={filterAccountId} />}
    </div>
  )
}

// ==========================================
// TAB 0: WALL (MONITORED SOURCES + POSTS)
// ==========================================
function WallTab({ filterAccountId, effectiveAccountId, requireAgent, accounts = [] }) {
  const queryClient = useQueryClient()
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedSourceId, setSelectedSourceId] = useState(null) // null = show all
  const [searchText, setSearchText] = useState('')
  const [fetchingSourceId, setFetchingSourceId] = useState(null)
  const [replyPost, setReplyPost] = useState(null)
  const [expandedPosts, setExpandedPosts] = useState({})
  const [lightboxImg, setLightboxImg] = useState(null)
  const [page, setPage] = useState(1)

  // Sources — filter by account if selected
  const { data: sources = [] } = useQuery({
    queryKey: ['monitoring-sources', filterAccountId],
    queryFn: () => {
      const params = filterAccountId ? `?account_id=${filterAccountId}` : ''
      return api.get(`/monitoring/sources${params}`).then(r => r.data)
    },
  })

  // Load posts from DB — wall only shows last 24h
  const wallParams = new URLSearchParams({ page, limit: 50 })
  wallParams.set('from_date', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
  if (selectedSourceId) wallParams.set('source_id', selectedSourceId)
  if (searchText.trim()) wallParams.set('search', searchText.trim())

  const { data: wallData, isLoading: wallLoading } = useQuery({
    queryKey: ['monitoring-wall', selectedSourceId, searchText, page],
    queryFn: () => api.get(`/monitoring/wall?${wallParams}`).then(r => r.data),
    keepPreviousData: true,
  })

  // Comment logs — track which posts have been replied to (persisted in DB)
  const cmtLogsUrl = filterAccountId
    ? `/monitoring/comment-logs?limit=200&account_id=${filterAccountId}`
    : '/monitoring/comment-logs?limit=200'
  const { data: commentLogs = [] } = useQuery({
    queryKey: ['comment-logs', filterAccountId],
    queryFn: () => api.get(cmtLogsUrl).then(r => r.data),
    refetchInterval: 15000, // poll every 15s for status updates
  })

  // Map fb_post_id → latest comment log
  const commentLogMap = {}
  for (const log of commentLogs) {
    const pid = log.fb_post_id
    if (!pid) continue
    if (!commentLogMap[pid] || new Date(log.created_at) > new Date(commentLogMap[pid].created_at)) {
      commentLogMap[pid] = log
    }
  }

  // Retry a failed comment job
  const retryCommentMut = useMutation({
    mutationFn: async (log) => {
      // Create new job with same payload
      const jobRes = await api.post('/jobs', {
        type: 'comment_post',
        payload: {
          account_id: log.account_id,
          post_url: log.post_url,
          fb_post_id: log.fb_post_id,
          comment_text: log.comment_text,
          source_name: log.source_name,
        },
      })
      // Reset log: clear error, link to new job_id
      await api.put(`/monitoring/comment-logs/${log.id}`, {
        status: 'pending',
        job_id: jobRes.data?.id,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comment-logs'] })
      toast.success('Da tao lai job comment')
    },
    onError: () => toast.error('Loi retry'),
  })

  // Dismiss/cancel a comment log
  const dismissCommentMut = useMutation({
    mutationFn: async (logId) => {
      const log = commentLogs.find(l => l.id === logId)
      // If job is still pending, cancel it too
      if (log?.job_id && log.status === 'pending') {
        await api.post(`/jobs/${log.job_id}/cancel`).catch(() => {})
      }
      await api.put(`/monitoring/comment-logs/${logId}`, { status: 'dismissed' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comment-logs'] })
      toast.success('Da huy comment')
    },
  })

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/monitoring/sources/${id}`),
    onSuccess: (_, id) => {
      if (selectedSourceId === id) setSelectedSourceId(null)
      queryClient.invalidateQueries({ queryKey: ['monitoring-sources'] })
      queryClient.invalidateQueries({ queryKey: ['monitoring-wall'] })
      toast.success('Da xoa nguon')
    },
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }) => api.put(`/monitoring/sources/${id}`, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['monitoring-sources'] }),
  })

  // Fetch posts for a source → API uses source's linked account automatically
  const fetchSource = async (sourceId) => {
    setFetchingSourceId(sourceId)
    try {
      const res = await api.post(`/monitoring/sources/${sourceId}/fetch-now`)
      const posts = res.data.posts || []
      queryClient.invalidateQueries({ queryKey: ['monitoring-sources'] })
      queryClient.invalidateQueries({ queryKey: ['monitoring-wall'] })
      toast.success(`Da fetch ${posts.length} bai viet`)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Loi fetch')
    } finally {
      setFetchingSourceId(null)
    }
  }

  // Fetch all active sources
  const fetchAllSources = async () => {
    const active = sources.filter(s => s.is_active)
    if (active.length === 0) return
    for (const s of active) {
      await fetchSource(s.id)
    }
  }

  // Bookmark IDs from DB (per-user)
  const { data: bookmarkIds = [] } = useQuery({
    queryKey: ['bookmark-ids'],
    queryFn: () => api.get('/monitoring/bookmark-ids').then(r => r.data),
  })
  const starredPosts = {}
  for (const id of bookmarkIds) starredPosts[id] = true

  // Save post to DB on user interaction (click link)
  const savePostOnInteraction = async (post) => {
    try {
      await api.post('/monitoring/save-post', {
        source_id: post.source_id,
        fb_post_id: post.fb_post_id,
        author_name: post.author_name,
        content_text: post.content_text,
        post_url: post.post_url,
        image_url: post.image_url,
        reactions: post.reactions,
        comments: post.comments,
        shares: post.shares,
        posted_at: post.posted_at,
      })
    } catch { /* silent — best effort */ }
  }

  // Star/unstar a post — saves bookmark per-user in DB
  const toggleStarPost = async (post) => {
    const isStarred = starredPosts[post.fb_post_id]
    try {
      if (isStarred) {
        await api.delete(`/monitoring/bookmark/${post.fb_post_id}`)
        toast.success('Da bo luu')
      } else {
        await savePostOnInteraction(post)
        await api.post('/monitoring/bookmark', { fb_post_id: post.fb_post_id })
        toast.success('Da luu bai viet')
      }
      queryClient.invalidateQueries({ queryKey: ['bookmark-ids'] })
    } catch { toast.error('Loi luu bai viet') }
  }

  // --- Data from DB — enrich with source info for ReplyModal compatibility ---
  const displayPosts = (wallData?.data || []).map(p => ({
    ...p,
    source_name: p.monitored_sources?.name || p.monitored_sources?.fb_source_id || null,
    source_type: p.monitored_sources?.source_type || 'page',
  }))
  const totalPosts = wallData?.total || 0
  const selectedSource = sources.find(s => s.id === selectedSourceId)

  // Format engagement numbers nicely
  const fmtNum = (n) => {
    if (!n) return '0'
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
    return String(n)
  }

  return (
    <div>
      {/* Header actions */}
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">
          {sources.length} nguon · {totalPosts} bai viet
        </p>
        <div className="flex gap-2">
          {sources.length > 0 && (
            <button
              onClick={fetchAllSources}
              disabled={!!fetchingSourceId}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border border-gray-300 hover:bg-gray-50 disabled:opacity-50"
            >
              <RefreshCw size={14} className={fetchingSourceId ? 'animate-spin' : ''} />
              Fetch tat ca
            </button>
          )}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700"
          >
            <Plus size={14} /> Them nguon
          </button>
        </div>
      </div>

      {/* Sources chips */}
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          <button
            onClick={() => { setSelectedSourceId(null); setSearchText(''); setPage(1) }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              !selectedSourceId ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Tat ca
          </button>
          {sources.map(s => {
            const isSelected = s.id === selectedSourceId
            const acctName = s.accounts?.username || s.accounts?.fb_user_id
            return (
              <div key={s.id} className="flex items-center gap-0.5">
                <button
                  onClick={() => {
                    if (isSelected) { setSelectedSourceId(null); setSearchText('') }
                    else { setSelectedSourceId(s.id); setSearchText(''); setPage(1) }
                  }}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    isSelected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {s.source_type === 'group' ? <Users size={10} /> : <Globe size={10} />}
                  {s.name || s.fb_source_id}
                  {acctName && <span className="opacity-60 text-[10px]">({acctName})</span>}
                  {!s.is_active && <span className="opacity-60">(off)</span>}
                </button>
                <select
                  value={s.fetch_interval_minutes || 60}
                  onChange={(e) => {
                    const val = parseInt(e.target.value)
                    api.put(`/monitoring/sources/${s.id}`, { fetch_interval_minutes: val })
                      .then(() => {
                        queryClient.invalidateQueries({ queryKey: ['monitoring-sources'] })
                        toast.success(val === 0 ? 'Da tat tu dong fetch' : `Tu dong fetch moi ${val} phut`)
                      })
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="text-[10px] border rounded px-0.5 py-0.5 bg-white text-gray-500 w-12"
                  title="Tu dong fetch"
                >
                  <option value="0">OFF</option>
                  <option value="15">15p</option>
                  <option value="30">30p</option>
                  <option value="60">1h</option>
                  <option value="120">2h</option>
                  <option value="240">4h</option>
                  <option value="480">8h</option>
                </select>
                <button onClick={() => toggleMut.mutate({ id: s.id, is_active: !s.is_active })} className="p-0.5 text-gray-400 hover:text-blue-500" title={s.is_active ? 'Tat' : 'Bat'}>
                  {s.is_active ? <ToggleRight size={12} className="text-green-500" /> : <ToggleLeft size={12} />}
                </button>
                <button onClick={() => fetchSource(s.id)} disabled={fetchingSourceId === s.id} className="p-0.5 text-gray-400 hover:text-orange-500" title="Fetch ngay">
                  <RefreshCw size={12} className={fetchingSourceId === s.id ? 'animate-spin' : ''} />
                </button>
                <button onClick={() => { if (confirm('Xoa nguon nay?')) deleteMut.mutate(s.id) }} className="p-0.5 text-gray-400 hover:text-red-500" title="Xoa">
                  <Trash2 size={12} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Search bar */}
      <div className="relative mb-4">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder={selectedSource ? `Tim trong "${selectedSource.name || selectedSource.fb_source_id}"...` : 'Tim kiem bai viet...'}
          value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setPage(1) }}
          className="w-full pl-9 pr-8 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        {searchText && (
          <button onClick={() => setSearchText('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Posts wall — from DB */}
      {wallLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader className="animate-spin text-blue-500" size={28} />
        </div>
      ) : displayPosts.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Rss size={40} className="mx-auto mb-3 opacity-50" />
          {sources.length === 0 ? (
            <>
              <p>Chua co nguon nao</p>
              <p className="text-xs mt-1">Them nguon Facebook (page/group) de bat dau theo doi</p>
            </>
          ) : searchText.trim() ? (
            <>
              <p>Khong tim thay bai viet</p>
              <p className="text-xs mt-1">Thu tu khoa khac hoac xoa bo loc</p>
            </>
          ) : (
            <>
              <p>Chua co bai viet nao</p>
              <p className="text-xs mt-1">Nhan <RefreshCw size={12} className="inline" /> de fetch bai viet</p>
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {displayPosts.map((post, idx) => (
            <div key={post.fb_post_id || idx} className="bg-white rounded-xl shadow p-4 flex flex-col">
              {/* Source + time */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center shrink-0">
                    {post.source_type === 'group' ? <Users size={12} className="text-gray-500" /> : <Globe size={12} className="text-gray-500" />}
                  </div>
                  <div>
                    <span className="text-sm font-medium text-gray-900">{post.source_name || '—'}</span>
                    {post.author_name && <span className="text-xs text-gray-500 ml-1.5">· {post.author_name}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {post.posted_at && <span className="text-xs text-gray-400">{formatDistanceToNow(new Date(post.posted_at), { addSuffix: true, locale: vi })}</span>}
                  {post.post_url && (
                    <a
                      href={post.post_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-blue-500"
                      onClick={() => savePostOnInteraction(post)}
                    >
                      <ExternalLink size={12} />
                    </a>
                  )}
                </div>
              </div>
              {/* Content — expandable */}
              <div className="flex-1">
                <p className={`text-sm text-gray-800 whitespace-pre-line leading-relaxed ${expandedPosts[post.fb_post_id] ? '' : 'line-clamp-3'}`}>{post.content_text}</p>
                {post.content_text?.length > 200 && (
                  <button
                    onClick={() => setExpandedPosts(prev => ({ ...prev, [post.fb_post_id]: !prev[post.fb_post_id] }))}
                    className="text-xs text-blue-600 hover:underline mt-0.5"
                  >
                    {expandedPosts[post.fb_post_id] ? 'Thu gon' : 'Xem them'}
                  </button>
                )}
              </div>
              {/* Image — clickable lightbox */}
              {post.image_url && (
                <img
                  src={post.image_url}
                  className="mt-2 rounded-lg max-h-52 object-cover w-full cursor-pointer hover:opacity-90 transition-opacity"
                  loading="lazy"
                  alt=""
                  onClick={() => setLightboxImg(post.image_url)}
                />
              )}
              {/* Engagement — formatted */}
              <div className="flex items-center gap-4 mt-2 pt-2 border-t border-gray-100">
                <span className="flex items-center gap-1 text-xs text-gray-500" title={`${post.reactions || 0} reactions`}>
                  <Heart size={12} className="text-red-400" /> {fmtNum(post.reactions)}
                </span>
                <span className="flex items-center gap-1 text-xs text-gray-500" title={`${post.comments || 0} comments`}>
                  <MessageCircle size={12} className="text-blue-400" /> {fmtNum(post.comments)}
                </span>
                <span className="flex items-center gap-1 text-xs text-gray-500" title={`${post.shares || 0} shares`}>
                  <Share2 size={12} className="text-green-400" /> {fmtNum(post.shares)}
                </span>
                {(() => {
                  const log = commentLogMap[post.fb_post_id]
                  if (!log) return null
                  const s = log.status
                  if (s === 'dismissed') {
                    return (
                      <span className="flex items-center gap-1 text-xs">
                        <XCircle size={12} className="text-gray-400" />
                        <span className="text-gray-400 font-medium">Da huy</span>
                        <button onClick={() => retryCommentMut.mutate(log)} className="text-blue-600 hover:underline ml-0.5" title="Dang lai">Dang lai</button>
                      </span>
                    )
                  }
                  if (s === 'failed') {
                    return (
                      <span className="flex items-center gap-1 text-xs">
                        <XCircle size={12} className="text-red-500" />
                        <span className="text-red-500 font-medium" title={log.error_message || 'That bai'}>Loi</span>
                        <button onClick={() => retryCommentMut.mutate(log)} className="text-blue-600 hover:underline ml-0.5" title="Thu lai">Retry</button>
                        <button onClick={() => dismissCommentMut.mutate(log.id)} className="text-gray-400 hover:text-gray-600" title="Bo qua"><X size={10} /></button>
                      </span>
                    )
                  }
                  if (s === 'done') {
                    return (
                      <span className="flex items-center gap-1 text-xs font-medium text-green-600" title="Da comment thanh cong">
                        <CheckCircle size={12} /> Da cmt
                      </span>
                    )
                  }
                  // pending
                  return (
                    <span className="flex items-center gap-1 text-xs">
                      <Timer size={12} className="text-yellow-600 animate-pulse" />
                      <span className="text-yellow-600 font-medium">Cho...</span>
                      <button onClick={() => dismissCommentMut.mutate(log.id)} className="text-gray-400 hover:text-red-500 ml-0.5" title="Huy comment"><X size={10} /></button>
                    </span>
                  )
                })()}
                <button
                  onClick={() => toggleStarPost(post)}
                  className={`flex items-center gap-1 text-xs ml-auto transition-colors ${starredPosts[post.fb_post_id] ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500'}`}
                  title={starredPosts[post.fb_post_id] ? 'Bo theo doi' : 'Theo doi bai viet'}
                >
                  <Star size={12} fill={starredPosts[post.fb_post_id] ? 'currentColor' : 'none'} />
                </button>
                <button
                  onClick={() => setReplyPost(post)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 transition-colors"
                  title="Tra loi bai viet"
                >
                  <Reply size={12} /> Tra loi
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPosts > 50 && (
        <div className="flex justify-center gap-2 mt-4">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50"
          >
            Truoc
          </button>
          <span className="px-3 py-1.5 text-sm text-gray-600">
            Trang {page} / {Math.ceil(totalPosts / 50)}
          </span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={page * 50 >= totalPosts}
            className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50"
          >
            Sau
          </button>
        </div>
      )}

      {/* Add source modal */}
      {showAddModal && <AddSourceModal onClose={() => setShowAddModal(false)} onCreated={(id) => fetchSource(id)} accounts={accounts} />}

      {/* Reply modal */}
      {replyPost && <ReplyModal post={replyPost} onClose={() => setReplyPost(null)} />}

      {/* Image lightbox */}
      {lightboxImg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setLightboxImg(null)}>
          <button onClick={() => setLightboxImg(null)} className="absolute top-4 right-4 text-white/80 hover:text-white"><X size={24} /></button>
          <img src={lightboxImg} className="max-w-[90vw] max-h-[90vh] rounded-lg object-contain" alt="" />
        </div>
      )}
    </div>
  )
}

function AddSourceModal({ onClose, onCreated, accounts = [] }) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [accountId, setAccountId] = useState(accounts.length > 0 ? accounts[0].id : '')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!url.trim()) return toast.error('Nhap URL Facebook')
    if (!accountId) return toast.error('Chon tai khoan Facebook')

    let fbSourceId = url.trim()
    let sourceType = 'page'

    try {
      const u = new URL(url.includes('http') ? url : `https://${url}`)
      const path = u.pathname.replace(/\/$/, '')
      if (path.includes('/groups/')) {
        sourceType = 'group'
        const match = path.match(/\/groups\/([^/]+)/)
        if (match) fbSourceId = match[1]
      } else {
        const match = path.match(/^\/([^/]+)$/)
        if (match && match[1] !== 'profile.php') fbSourceId = match[1]
        const idParam = u.searchParams.get('id')
        if (idParam) fbSourceId = idParam
      }
    } catch { /* use as-is */ }

    setLoading(true)
    try {
      const res = await api.post('/monitoring/sources', {
        source_type: sourceType,
        fb_source_id: fbSourceId,
        name: name.trim() || null,
        url: url.includes('facebook.com') ? url.trim() : null,
        account_id: accountId,
      })
      queryClient.invalidateQueries({ queryKey: ['monitoring-sources'] })
      toast.success('Da them nguon, dang fetch...')
      onClose()
      if (res.data?.id && onCreated) onCreated(res.data.id)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Loi them nguon')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">Them nguon theo doi</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tai khoan Facebook *</label>
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {accounts.length === 0 && <option value="">Chua co tai khoan</option>}
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.username || a.fb_user_id}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">Tai khoan se dung cookie de fetch du lieu.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">URL Facebook *</label>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://www.facebook.com/pagename hoac groups/123"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
            />
            <p className="text-xs text-gray-400 mt-1">Ho tro page va group. Tu dong nhan dang loai.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Ten (tuy chon)</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="VD: Hoi cho mua ban"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Huy</button>
            <button
              type="submit"
              disabled={loading || !accountId}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
            >
              {loading && <Loader size={14} className="animate-spin" />}
              Them nguon
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ==========================================
// TAB 1: KEYWORDS MANAGEMENT
// ==========================================
function KeywordsTab({ filterAccountId }) {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [newKeyword, setNewKeyword] = useState({ keyword: '', scan_type: 'group_posts', account_id: '', cron_expression: '0 */6 * * *', time_window_hours: 24, topics: '' })

  const { data: allKeywords = [], isLoading } = useQuery({
    queryKey: ['monitor-keywords'],
    queryFn: () => api.get('/monitor/keywords').then(r => r.data),
  })

  // Filter by selected account
  const keywords = filterAccountId
    ? allKeywords.filter(kw => kw.account_id === filterAccountId)
    : allKeywords

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (data) => {
      // Parse topics string into array
      const payload = { ...data }
      if (payload.topics) {
        payload.topics = payload.topics.split(',').map(t => t.trim()).filter(Boolean)
      } else {
        delete payload.topics
      }
      return api.post('/monitor/keywords', payload)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitor-keywords'] })
      toast.success('Da tao tu khoa!')
      setShowAdd(false)
      setNewKeyword({ keyword: '', scan_type: 'group_posts', account_id: '', cron_expression: '0 */6 * * *', time_window_hours: 24, topics: '' })
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/monitor/keywords/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['monitor-keywords'] }); toast.success('Da xoa') },
  })

  const toggleMutation = useMutation({
    mutationFn: ({ id, is_active }) => api.put(`/monitor/keywords/${id}`, { is_active }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['monitor-keywords'] }) },
  })

  const scanNowMutation = useMutation({
    mutationFn: (id) => api.post(`/monitor/keywords/${id}/scan-now`),
    onSuccess: (res) => toast.success(res.data.message || 'Da tao job quet'),
    onError: (err) => toast.error(err.response?.data?.error || 'Khong the quet'),
  })

  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-gray-500">{keywords.length} tu khoa</p>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-700">
          <Plus size={14} /> Them tu khoa
        </button>
      </div>

      {/* Add keyword form */}
      {showAdd && (
        <div className="bg-blue-50 rounded-xl p-4 mb-4 border border-blue-200">
          <h3 className="font-medium text-sm mb-3">Tu khoa moi</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tu khoa</label>
              <input
                value={newKeyword.keyword}
                onChange={e => setNewKeyword(prev => ({ ...prev, keyword: e.target.value }))}
                placeholder="VD: mua ban, tuyen dung, ..."
                className="w-full border rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Loai quet</label>
              <select
                value={newKeyword.scan_type}
                onChange={e => setNewKeyword(prev => ({ ...prev, scan_type: e.target.value }))}
                className="w-full border rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="group_posts">Quet bai theo tu khoa</option>
                <option value="group_feed">Quet feed group (AI)</option>
                <option value="discover_groups">Tim group moi</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Tai khoan</label>
              <select
                value={newKeyword.account_id}
                onChange={e => setNewKeyword(prev => ({ ...prev, account_id: e.target.value }))}
                className="w-full border rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">-- Chon --</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.username || a.fb_user_id}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Lich quet (cron)</label>
              <select
                value={newKeyword.cron_expression}
                onChange={e => setNewKeyword(prev => ({ ...prev, cron_expression: e.target.value }))}
                className="w-full border rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="0 */2 * * *">Moi 2 gio</option>
                <option value="0 */6 * * *">Moi 6 gio</option>
                <option value="0 */12 * * *">Moi 12 gio</option>
                <option value="0 9 * * *">Moi ngay 9h</option>
                <option value="0 9,18 * * *">9h va 18h</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Moc thoi gian (gio)</label>
              <input
                type="number"
                value={newKeyword.time_window_hours}
                onChange={e => setNewKeyword(prev => ({ ...prev, time_window_hours: parseInt(e.target.value) || 24 }))}
                className="w-full border rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            {newKeyword.scan_type === 'group_feed' && (
              <div className="md:col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Chu de AI review (cach nhau boi dau phay)</label>
                <input
                  value={newKeyword.topics}
                  onChange={e => setNewKeyword(prev => ({ ...prev, topics: e.target.value }))}
                  placeholder="VD: mua ban, bat dong san, tuyen dung"
                  className="w-full border rounded-lg px-3 py-1.5 text-sm"
                />
                <p className="text-xs text-gray-400 mt-0.5">AI se danh gia bai viet co lien quan den cac chu de nay khong (score 1-5)</p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button onClick={() => setShowAdd(false)} className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Huy</button>
            <button
              onClick={() => createMutation.mutate(newKeyword)}
              disabled={!newKeyword.keyword || !newKeyword.account_id || createMutation.isPending}
              className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {createMutation.isPending ? 'Dang tao...' : 'Tao'}
            </button>
          </div>
        </div>
      )}

      {/* Keywords list */}
      <div className="space-y-3">
        {keywords.map(kw => (
          <div key={kw.id} className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${kw.is_active ? 'bg-green-500' : 'bg-gray-300'}`} />
                <div>
                  <span className="font-medium text-gray-900">{kw.keyword}</span>
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${
                    kw.scan_type === 'group_feed' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {kw.scan_type === 'group_posts' ? 'Quet bai' : kw.scan_type === 'group_feed' ? 'Feed AI' : 'Tim group'}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => scanNowMutation.mutate(kw.id)}
                  disabled={scanNowMutation.isPending}
                  className="p-1.5 rounded hover:bg-blue-50 text-blue-600" title="Quet ngay"
                >
                  <RefreshCw size={14} className={scanNowMutation.isPending ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={() => toggleMutation.mutate({ id: kw.id, is_active: !kw.is_active })}
                  className="p-1.5 rounded hover:bg-gray-100" title={kw.is_active ? 'Tam dung' : 'Bat lai'}
                >
                  {kw.is_active ? <Pause size={14} className="text-yellow-500" /> : <Play size={14} className="text-green-500" />}
                </button>
                <button
                  onClick={() => { if (confirm('Xoa tu khoa nay?')) deleteMutation.mutate(kw.id) }}
                  className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Xoa"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
              <span>TK: {kw.accounts?.username || '—'}</span>
              <span>Cron: {kw.cron_expression}</span>
              <span>Moc: {kw.time_window_hours}h</span>
              <span>Da quet: {kw.total_scans} lan</span>
              {kw.last_scan_at && <span>Lan cuoi: {new Date(kw.last_scan_at).toLocaleString('vi')}</span>}
              {kw.next_scan_at && <span>Tiep: {new Date(kw.next_scan_at).toLocaleString('vi')}</span>}
            </div>
          </div>
        ))}
        {keywords.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <Search size={40} className="mx-auto mb-3 opacity-50" />
            <p>Chua co tu khoa nao. Them tu khoa de bat dau theo doi.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ==========================================
// TAB 2: DISCOVERED POSTS
// ==========================================
function PostsTab({ filterAccountId }) {
  const [searchText, setSearchText] = useState('')
  const [page, setPage] = useState(1)
  const [collapsedGroups, setCollapsedGroups] = useState({})

  const queryParams = new URLSearchParams({ page, limit: 200 })
  if (searchText) queryParams.set('search', searchText)

  const { data: postsData = { data: [] }, isLoading } = useQuery({
    queryKey: ['all-posts', searchText, page],
    queryFn: () => api.get(`/monitoring/saved?${queryParams.toString()}`).then(r => r.data),
  })

  const posts = postsData.data || postsData || []
  const totalPosts = postsData.total || posts.length

  // Group posts by source
  const grouped = {}
  for (const post of posts) {
    const key = post.monitored_sources?.name || post.monitored_sources?.fb_source_id || post.fb_source_id || 'Khac'
    if (!grouped[key]) grouped[key] = { posts: [], type: post.monitored_sources?.source_type || 'page' }
    grouped[key].posts.push(post)
  }
  const groupNames = Object.keys(grouped)

  const toggleGroup = (name) => {
    setCollapsedGroups(prev => ({ ...prev, [name]: !prev[name] }))
  }

  // Format engagement numbers
  const fmtNum = (n) => {
    if (!n) return '0'
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
    return String(n)
  }

  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchText}
              onChange={e => { setSearchText(e.target.value); setPage(1) }}
              placeholder="Tim kiem bai viet..."
              className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
            />
          </div>
        </div>
        <span className="text-sm text-gray-500">{totalPosts} bai viet · {groupNames.length} nhom</span>
      </div>

      {posts.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <MessageCircle size={32} className="mx-auto mb-3 text-gray-300" />
          <p className="text-sm">Chua co bai viet nao</p>
          <p className="text-xs mt-1">Fetch du lieu tu tab Nguon tin truoc</p>
        </div>
      )}

      {/* Posts grouped by source */}
      <div className="space-y-4">
        {groupNames.map(name => {
          const group = grouped[name]
          const isCollapsed = collapsedGroups[name]
          return (
            <div key={name} className="bg-white rounded-xl shadow overflow-hidden">
              {/* Group header */}
              <button
                onClick={() => toggleGroup(name)}
                className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {group.type === 'group' ? <Users size={14} className="text-blue-500" /> : <Globe size={14} className="text-green-500" />}
                  <span className="font-medium text-sm text-gray-900">{name}</span>
                  <span className="text-xs text-gray-400 bg-gray-200 px-1.5 py-0.5 rounded-full">{group.posts.length}</span>
                </div>
                <span className="text-gray-400 text-xs">{isCollapsed ? '▸' : '▾'}</span>
              </button>

              {/* Posts in group */}
              {!isCollapsed && (
                <div className="divide-y divide-gray-100">
                  {group.posts.map(post => (
                    <div key={post.id} className="px-4 py-3 hover:bg-gray-50">
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-medium text-sm text-gray-900">{post.author_name || 'Unknown'}</span>
                            {post.posted_at && (
                              <span className="text-xs text-gray-400">
                                {formatDistanceToNow(new Date(post.posted_at), { addSuffix: true, locale: vi })}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-700 line-clamp-3 mb-1">{post.content_text}</p>
                          <div className="flex items-center gap-4 text-xs text-gray-500">
                            <span className="flex items-center gap-1"><Heart size={12} /> {fmtNum(post.reactions)}</span>
                            <span className="flex items-center gap-1"><MessageCircle size={12} /> {fmtNum(post.comments)}</span>
                            <span className="flex items-center gap-1"><Share2 size={12} /> {fmtNum(post.shares)}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 ml-3">
                          {post.post_url && (
                            <a href={post.post_url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-gray-100 text-gray-400">
                              <ExternalLink size={14} />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPosts > 200 && (
        <div className="flex items-center justify-center gap-3 mt-6">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1} className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50">Truoc</button>
          <span className="text-sm text-gray-500">Trang {page} / {Math.ceil(totalPosts / 200)}</span>
          <button onClick={() => setPage(p => p + 1)} disabled={page * 200 >= totalPosts} className="px-3 py-1.5 rounded-lg border text-sm disabled:opacity-50">Tiep</button>
        </div>
      )}
    </div>
  )
}

// ==========================================
// TAB 3: DISCOVERED GROUPS
// ==========================================
function GroupsTab({ filterAccountId }) {
  const queryClient = useQueryClient()
  const [filterKeywordId, setFilterKeywordId] = useState('')

  const { data: keywords = [] } = useQuery({
    queryKey: ['monitor-keywords'],
    queryFn: () => api.get('/monitor/keywords').then(r => r.data),
  })

  const queryParams = new URLSearchParams()
  if (filterKeywordId) queryParams.set('keyword_id', filterKeywordId)
  queryParams.set('limit', '100')

  const { data: groupsData = { data: [] }, isLoading } = useQuery({
    queryKey: ['monitor-groups', filterKeywordId],
    queryFn: () => api.get(`/monitor/groups?${queryParams.toString()}`).then(r => r.data),
  })

  const deleteGroupMutation = useMutation({
    mutationFn: (id) => api.delete(`/monitor/groups/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['monitor-groups'] }); toast.success('Da xoa') },
  })

  const groups = groupsData.data || groupsData || []

  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4">
        <select
          value={filterKeywordId}
          onChange={e => setFilterKeywordId(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Tat ca tu khoa</option>
          {keywords.filter(k => k.scan_type === 'discover_groups').map(kw => (
            <option key={kw.id} value={kw.id}>{kw.keyword}</option>
          ))}
        </select>
        <span className="text-sm text-gray-500">{groups.length} nhom</span>
      </div>

      {/* Groups grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {groups.map(group => (
          <div key={group.id} className="bg-white rounded-xl shadow p-4">
            <div className="flex items-start justify-between mb-2">
              <a href={group.url || `https://www.facebook.com/groups/${group.fb_group_id}`} target="_blank" rel="noopener noreferrer"
                className="font-medium text-sm text-gray-900 line-clamp-2 hover:text-blue-600 hover:underline">
                {group.name || group.fb_group_id}
              </a>
              <button
                onClick={() => deleteGroupMutation.mutate(group.id)}
                className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500 shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="space-y-1 text-xs text-gray-500">
              {group.member_count > 0 && (
                <span className="flex items-center gap-1"><Users size={12} /> {group.member_count.toLocaleString()} thanh vien</span>
              )}
              <span className={`inline-block px-1.5 py-0.5 rounded ${group.group_type === 'private' ? 'bg-orange-50 text-orange-600' : 'bg-green-50 text-green-600'}`}>
                {group.group_type === 'private' ? 'Rieng tu' : 'Cong khai'}
              </span>
              {group.description && <p className="text-gray-600 line-clamp-2 mt-1">{group.description}</p>}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <a href={group.url || `https://www.facebook.com/groups/${group.fb_group_id}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800">
                <ExternalLink size={12} /> Xem group
              </a>
              {group.scan_keywords?.keyword && (
                <span className="text-xs bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded ml-auto">{group.scan_keywords.keyword}</span>
              )}
            </div>
          </div>
        ))}
        {groups.length === 0 && (
          <div className="col-span-full text-center py-12 text-gray-400">
            <Users size={40} className="mx-auto mb-3 opacity-50" />
            <p>Chua co nhom moi. Them tu khoa loai "Tim group" de bat dau.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ==========================================
// TAB 4: ENGAGEMENT
// ==========================================
function EngagementTab({ filterAccountId }) {
  const queryClient = useQueryClient()
  const [sourceType, setSourceType] = useState('')
  const [days, setDays] = useState(7)
  const [cmtFilter, setCmtFilter] = useState('')
  const [cmtAccountFilter, setCmtAccountFilter] = useState('')

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data),
  })

  // Comment logs from DB — load all (no limit)
  const { data: commentLogs = [] } = useQuery({
    queryKey: ['comment-logs'],
    queryFn: () => api.get('/monitoring/comment-logs?limit=9999').then(r => r.data),
  })

  // Huy comment pending/failed
  const cancelLogMut = useMutation({
    mutationFn: async (logId) => {
      const log = commentLogs.find(l => l.id === logId)
      if (log?.job_id && log.status === 'pending') {
        await api.post(`/jobs/${log.job_id}/cancel`).catch(() => {})
      }
      await api.put(`/monitoring/comment-logs/${logId}`, { status: 'dismissed' })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comment-logs'] })
      toast.success('Da huy')
    },
  })

  // Exclude dismissed, then filter by account + status
  const activeLogs = commentLogs.filter(l => l.status !== 'dismissed')
  const accountFilteredLogs = cmtAccountFilter ? activeLogs.filter(l => l.account_id === cmtAccountFilter) : activeLogs
  const filteredLogs = cmtFilter ? accountFilteredLogs.filter(l => l.status === cmtFilter) : accountFilteredLogs
  const cmtStats = {
    total: accountFilteredLogs.length,
    done: accountFilteredLogs.filter(l => l.status === 'done').length,
    failed: accountFilteredLogs.filter(l => l.status === 'failed').length,
    pending: accountFilteredLogs.filter(l => l.status === 'pending').length,
  }

  const { data: summary, isLoading } = useQuery({
    queryKey: ['engagement-summary', sourceType, days],
    queryFn: () => {
      const params = new URLSearchParams({ days })
      if (sourceType) params.set('source_type', sourceType)
      return api.get(`/monitor/engagement/summary?${params.toString()}`).then(r => r.data)
    },
  })

  const checkNowMutation = useMutation({
    mutationFn: (account_id) => api.post('/monitor/engagement/check-now', { account_id, source_type: sourceType || undefined }),
    onSuccess: (res) => toast.success(res.data.message || 'Da tao job'),
    onError: (err) => toast.error(err.response?.data?.error || 'Loi'),
  })

  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={sourceType}
          onChange={e => setSourceType(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Tat ca</option>
          <option value="own_post">Bai cua minh</option>
          <option value="discovered_post">Bai da quet</option>
        </select>
        <select
          value={days}
          onChange={e => setDays(parseInt(e.target.value))}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value={1}>24 gio qua</option>
          <option value={3}>3 ngay</option>
          <option value={7}>7 ngay</option>
          <option value={14}>14 ngay</option>
          <option value={30}>30 ngay</option>
        </select>
        <div className="flex items-center gap-2 ml-auto">
          <select id="check-account" className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Chon TK</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.username || a.fb_user_id}</option>)}
          </select>
          <button
            onClick={() => {
              const el = document.getElementById('check-account')
              if (!el?.value) return toast.error('Chon tai khoan')
              checkNowMutation.mutate(el.value)
            }}
            disabled={checkNowMutation.isPending}
            className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            <RefreshCw size={14} className={checkNowMutation.isPending ? 'animate-spin' : ''} />
            Check ngay
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <SummaryCard icon={<BarChart3 className="text-blue-500" />} label="Tong bai" value={summary.total_posts} />
            <SummaryCard icon={<Heart className="text-red-500" />} label="Reactions" value={summary.total_reactions} />
            <SummaryCard icon={<MessageCircle className="text-green-500" />} label="Comments" value={summary.total_comments} />
            <SummaryCard icon={<Share2 className="text-purple-500" />} label="Shares" value={summary.total_shares} />
          </div>

          {/* Top posts */}
          {summary.top_posts?.length > 0 && (
            <div className="bg-white rounded-xl shadow">
              <div className="px-4 py-3 border-b">
                <h3 className="font-semibold text-sm text-gray-900">Top bai viet ({days} ngay)</h3>
              </div>
              <div className="divide-y">
                {summary.top_posts.map((post, i) => (
                  <div key={post.id || i} className="px-4 py-3 flex items-center gap-4">
                    <span className="text-lg font-bold text-gray-300 w-6 text-center">{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-700 truncate">{post.fb_post_id}</p>
                      <span className="text-xs text-gray-500">{post.source_type === 'own_post' ? 'Bai cua minh' : 'Bai da quet'}</span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-500 shrink-0">
                      <span className="flex items-center gap-1"><Heart size={12} className="text-red-400" /> {post.reactions}</span>
                      <span className="flex items-center gap-1"><MessageCircle size={12} className="text-green-400" /> {post.comments}</span>
                      <span className="flex items-center gap-1"><Share2 size={12} className="text-purple-400" /> {post.shares}</span>
                      <span className="font-medium text-gray-700">= {post.total}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summary.total_posts === 0 && (
            <div className="text-center py-12 text-gray-400">
              <TrendingUp size={40} className="mx-auto mb-3 opacity-50" />
              <p>Chua co du lieu tuong tac. Dang bai hoac quet group de bat dau.</p>
            </div>
          )}
        </>
      )}

      {/* Comment logs — persistent history */}
      <div className="bg-white rounded-xl shadow mt-6">
        <div className="px-4 py-3 border-b flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-sm text-gray-900">Lich su comment</h3>
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <span>{cmtStats.total} tong</span>
              {cmtStats.done > 0 && <span className="text-green-600">· {cmtStats.done} TC</span>}
              {cmtStats.failed > 0 && <span className="text-red-500">· {cmtStats.failed} loi</span>}
              {cmtStats.pending > 0 && <span className="text-yellow-600">· {cmtStats.pending} cho</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={cmtAccountFilter}
              onChange={e => setCmtAccountFilter(e.target.value)}
              className="border rounded px-2 py-0.5 text-xs bg-white"
            >
              <option value="">Tat ca nick</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.username || a.fb_user_id}</option>
              ))}
            </select>
            <div className="flex gap-1">
              {['', 'done', 'failed', 'pending'].map(f => (
                <button
                  key={f}
                  onClick={() => setCmtFilter(f)}
                  className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                    cmtFilter === f ? 'bg-blue-100 text-blue-700' : 'text-gray-500 hover:bg-gray-100'
                  }`}
                >
                  {f === '' ? 'Tat ca' : f === 'done' ? 'Thanh cong' : f === 'failed' ? 'Loi' : 'Cho'}
                </button>
              ))}
            </div>
          </div>
        </div>
        {filteredLogs.length === 0 ? (
          <div className="px-4 py-8 text-center text-gray-400 text-sm">
            {commentLogs.length === 0 ? 'Chua co comment nao. Dung "Tra loi" tren bai viet de bat dau.' : 'Khong co comment nao voi bo loc nay.'}
          </div>
        ) : (
          <div className="divide-y max-h-96 overflow-y-auto">
            {filteredLogs.map(log => (
              <div key={log.id} className="px-4 py-3 flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                  (log.status === 'done' && !log.error_message) ? 'bg-green-500' : (log.status === 'failed' || log.error_message) ? 'bg-red-500' : 'bg-yellow-500'
                }`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-gray-700 truncate">{log.source_name || 'Facebook'}</span>
                    <span className="text-xs text-gray-400">·</span>
                    <span className="text-xs text-gray-400">{log.accounts?.username || '—'}</span>
                    {log.post_url && (
                      <a href={log.post_url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-500 shrink-0">
                        <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                  <p className="text-sm text-gray-800 line-clamp-2">{log.comment_text}</p>
                  <div className="flex items-center gap-2 mt-1">
                    {(() => {
                      const isDismissed = log.status === 'dismissed'
                      const isFailed = log.status === 'failed' || log.error_message
                      const isDone = log.status === 'done' && !log.error_message
                      return (
                        <>
                          <span className={`text-xs font-medium ${isDone ? 'text-green-600' : isDismissed ? 'text-gray-400' : isFailed ? 'text-red-500' : 'text-yellow-600'}`}>
                            {isDone ? 'Thanh cong' : isDismissed ? 'Da huy' : isFailed ? 'That bai' : 'Dang cho...'}
                          </span>
                          {log.error_message && <span className="text-xs text-red-400 truncate max-w-[200px]" title={log.error_message}>{log.error_message}</span>}
                          {(isFailed || isDismissed) && (
                            <button onClick={() => {
                              api.post('/jobs', {
                                type: 'comment_post',
                                payload: { account_id: log.account_id, post_url: log.post_url, fb_post_id: log.fb_post_id, comment_text: log.comment_text, source_name: log.source_name },
                              }).then(res => {
                                api.put(`/monitoring/comment-logs/${log.id}`, { status: 'pending', error_message: null, job_id: res.data.id })
                                queryClient.invalidateQueries({ queryKey: ['comment-logs'] })
                                toast.success('Da tao lai job')
                              }).catch(() => toast.error('Loi tao job'))
                            }} className="text-xs text-blue-600 hover:underline">Dang lai</button>
                          )}
                          {!isDone && !isDismissed && (
                            <button onClick={() => cancelLogMut.mutate(log.id)} className="text-xs text-gray-400 hover:text-red-500">Huy</button>
                          )}
                        </>
                      )
                    })()}
                    <span className="text-xs text-gray-400 ml-auto shrink-0">
                      {new Date(log.created_at).toLocaleString('vi')}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ==========================================
// SHARED COMPONENTS
// ==========================================
function SummaryCard({ icon, label, value }) {
  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center">
          {icon}
        </div>
        <div>
          <p className="text-xs text-gray-500">{label}</p>
          <p className="text-xl font-bold text-gray-900">{(value || 0).toLocaleString()}</p>
        </div>
      </div>
    </div>
  )
}

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-12">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  )
}

