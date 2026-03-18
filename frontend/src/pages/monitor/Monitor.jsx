import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Eye, Search, Plus, Trash2, Play, Pause, RefreshCw, Heart,
  MessageCircle, Share2, Users, ExternalLink, Clock, Loader,
  X, Check, Star, TrendingUp, BarChart3, Filter, Rss, Globe,
  ToggleLeft, ToggleRight,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'

const tabs = [
  { key: 'wall', label: 'Nguon tin', icon: Rss },
  { key: 'keywords', label: 'Tu khoa', icon: Search },
  { key: 'posts', label: 'Bai viet', icon: MessageCircle },
  { key: 'groups', label: 'Nhom moi', icon: Users },
  { key: 'engagement', label: 'Tuong tac', icon: TrendingUp },
]

export default function Monitor() {
  const [activeTab, setActiveTab] = useState('wall')

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Eye size={24} className="text-blue-600" />
          <h1 className="text-2xl font-bold text-gray-900">Theo doi</h1>
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
      {activeTab === 'wall' && <WallTab />}
      {activeTab === 'keywords' && <KeywordsTab />}
      {activeTab === 'posts' && <PostsTab />}
      {activeTab === 'groups' && <GroupsTab />}
      {activeTab === 'engagement' && <EngagementTab />}
    </div>
  )
}

// ==========================================
// localStorage helpers for cached posts
// ==========================================
const CACHE_KEY = 'monitoring_posts_cache'
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

function getCachedPosts() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return {}
    const cache = JSON.parse(raw)
    // Clean expired entries
    const now = Date.now()
    for (const sourceId of Object.keys(cache)) {
      if (cache[sourceId].fetchedAt && now - cache[sourceId].fetchedAt > 24 * 60 * 60 * 1000) {
        delete cache[sourceId]
      }
    }
    return cache
  } catch { return {} }
}

function setCachedPosts(sourceId, newPosts) {
  const cache = getCachedPosts()
  // Merge: keep existing posts + add new ones (dedupe by fb_post_id)
  const existing = cache[sourceId]?.posts || []
  const existingIds = new Set(existing.map(p => p.fb_post_id))
  const merged = [...existing]
  for (const post of newPosts) {
    if (post.fb_post_id && !existingIds.has(post.fb_post_id)) {
      merged.push(post)
    } else if (post.fb_post_id) {
      // Update existing post with fresh data (engagement counts may change)
      const idx = merged.findIndex(p => p.fb_post_id === post.fb_post_id)
      if (idx >= 0) merged[idx] = post
    }
  }
  // Sort by posted_at desc
  merged.sort((a, b) => {
    if (a.posted_at && b.posted_at) return new Date(b.posted_at) - new Date(a.posted_at)
    return 0
  })
  cache[sourceId] = { posts: merged, fetchedAt: Date.now() }
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch { /* quota exceeded */ }
}

function isCacheFresh(sourceId) {
  const cache = getCachedPosts()
  if (!cache[sourceId]) return false
  return Date.now() - cache[sourceId].fetchedAt < CACHE_TTL
}

function getAllCachedPosts() {
  const cache = getCachedPosts()
  const all = []
  for (const sourceId of Object.keys(cache)) {
    for (const post of (cache[sourceId].posts || [])) {
      all.push({ ...post, _cachedSourceId: sourceId })
    }
  }
  // Sort by posted_at desc, fallback to content order
  all.sort((a, b) => {
    if (a.posted_at && b.posted_at) return new Date(b.posted_at) - new Date(a.posted_at)
    return 0
  })
  return all
}

function removeCachedSource(sourceId) {
  const cache = getCachedPosts()
  delete cache[sourceId]
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)) } catch {}
}

// ==========================================
// TAB 0: WALL (MONITORED SOURCES + POSTS)
// ==========================================
function WallTab() {
  const queryClient = useQueryClient()
  const [showAddModal, setShowAddModal] = useState(false)
  const [selectedSourceId, setSelectedSourceId] = useState(null) // null = show all
  const [searchText, setSearchText] = useState('')
  const [cachedPosts, setCachedPostsState] = useState(() => getAllCachedPosts())
  const [fetchingSourceId, setFetchingSourceId] = useState(null)

  // Sources
  const { data: sources = [] } = useQuery({
    queryKey: ['monitoring-sources'],
    queryFn: () => api.get('/monitoring/sources').then(r => r.data),
  })

  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/monitoring/sources/${id}`),
    onSuccess: (_, id) => {
      removeCachedSource(id)
      setCachedPostsState(getAllCachedPosts())
      if (selectedSourceId === id) setSelectedSourceId(null)
      queryClient.invalidateQueries({ queryKey: ['monitoring-sources'] })
      toast.success('Da xoa nguon')
    },
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }) => api.put(`/monitoring/sources/${id}`, { is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['monitoring-sources'] }),
  })

  // Fetch posts for a source → save to localStorage
  const fetchSource = async (sourceId) => {
    setFetchingSourceId(sourceId)
    try {
      const res = await api.post(`/monitoring/sources/${sourceId}/fetch-now`)
      const posts = res.data.posts || []
      setCachedPosts(sourceId, posts)
      setCachedPostsState(getAllCachedPosts())
      // Refresh sources list to pick up auto-detected name
      queryClient.invalidateQueries({ queryKey: ['monitoring-sources'] })
      toast.success(`Da fetch ${posts.length} bai viet`)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Loi fetch')
    } finally {
      setFetchingSourceId(null)
    }
  }

  // Auto-fetch sources that don't have fresh cache (skip already-cached)
  const fetchAllStale = async () => {
    const stale = sources.filter(s => s.is_active && !isCacheFresh(s.id))
    if (stale.length === 0) {
      toast.success('Tat ca nguon deu con moi (cache < 1h)')
      return
    }
    for (const s of stale) {
      await fetchSource(s.id)
    }
  }

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

  // --- Filtering logic ---
  const now = Date.now()
  const isSearching = searchText.trim().length > 0 && selectedSourceId
  // Default: 24h posts. When searching within a source: 30 days
  const timeWindowMs = isSearching ? 30 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000

  let displayPosts = cachedPosts.filter(p => {
    if (!p.posted_at) return true
    return now - new Date(p.posted_at).getTime() < timeWindowMs
  })

  // Filter by selected source
  if (selectedSourceId) {
    displayPosts = displayPosts.filter(p => p.source_id === selectedSourceId)
  }

  // Search only applies when a source is selected
  if (isSearching) {
    const q = searchText.trim().toLowerCase()
    displayPosts = displayPosts.filter(p =>
      (p.content_text || '').toLowerCase().includes(q) ||
      (p.author_name || '').toLowerCase().includes(q)
    )
  }

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
          {sources.length} nguon · {displayPosts.length} bai
          {selectedSourceId && !isSearching && ' (24h)'}
          {isSearching && ' (30 ngay)'}
        </p>
        <div className="flex gap-2">
          {sources.length > 0 && (
            <button
              onClick={fetchAllStale}
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
            onClick={() => { setSelectedSourceId(null); setSearchText('') }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
              !selectedSourceId ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Tat ca
          </button>
          {sources.map(s => {
            const isSelected = s.id === selectedSourceId
            const hasFreshCache = isCacheFresh(s.id)
            return (
              <div key={s.id} className="flex items-center gap-0.5">
                <button
                  onClick={() => {
                    if (isSelected) { setSelectedSourceId(null); setSearchText('') }
                    else { setSelectedSourceId(s.id); setSearchText('') }
                  }}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    isSelected ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {s.source_type === 'group' ? <Users size={10} /> : <Globe size={10} />}
                  {s.name || s.fb_source_id}
                  {!s.is_active && <span className="opacity-60">(off)</span>}
                  {hasFreshCache && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                </button>
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

      {/* Search bar — only visible when a source is selected */}
      {selectedSourceId && (
        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={`Tim trong "${selectedSource?.name || selectedSource?.fb_source_id || ''}" (30 ngay)...`}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full pl-9 pr-8 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
          {searchText && (
            <button onClick={() => setSearchText('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {/* Posts wall — from localStorage cache */}
      {displayPosts.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <Rss size={40} className="mx-auto mb-3 opacity-50" />
          {sources.length === 0 ? (
            <>
              <p>Chua co nguon nao</p>
              <p className="text-xs mt-1">Them nguon Facebook (page/group) de bat dau theo doi</p>
            </>
          ) : isSearching ? (
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
          {displayPosts.slice(0, 50).map((post, idx) => (
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
              {/* Content */}
              <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed line-clamp-3 flex-1">{post.content_text}</p>
              {/* Image */}
              {post.image_url && (
                <img src={post.image_url} className="mt-2 rounded-lg max-h-52 object-cover w-full" loading="lazy" alt="" />
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
              </div>
            </div>
          ))}
          {displayPosts.length > 50 && (
            <p className="text-center text-xs text-gray-400 py-2">Hien thi 50 / {displayPosts.length} bai viet. Chon nguon va tim kiem de thu hep.</p>
          )}
        </div>
      )}

      {/* Add source modal */}
      {showAddModal && <AddSourceModal onClose={() => setShowAddModal(false)} onCreated={(id) => fetchSource(id)} />}
    </div>
  )
}

function AddSourceModal({ onClose, onCreated }) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!url.trim()) return toast.error('Nhap URL Facebook')

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
      })
      queryClient.invalidateQueries({ queryKey: ['monitoring-sources'] })
      toast.success('Da them nguon, dang fetch...')
      onClose()
      // Auto-fetch the new source
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
              disabled={loading}
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
function KeywordsTab() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [newKeyword, setNewKeyword] = useState({ keyword: '', scan_type: 'group_posts', account_id: '', cron_expression: '0 */6 * * *', time_window_hours: 24, topics: '' })

  const { data: keywords = [], isLoading } = useQuery({
    queryKey: ['monitor-keywords'],
    queryFn: () => api.get('/monitor/keywords').then(r => r.data),
  })

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
function PostsTab() {
  const queryClient = useQueryClient()
  const [searchText, setSearchText] = useState('')
  const [filterKeywordId, setFilterKeywordId] = useState('')
  const [followingOnly, setFollowingOnly] = useState(false)
  const [minScore, setMinScore] = useState('')
  const [sortBy, setSortBy] = useState('discovered_at')

  const { data: keywords = [] } = useQuery({
    queryKey: ['monitor-keywords'],
    queryFn: () => api.get('/monitor/keywords').then(r => r.data),
  })

  const queryParams = new URLSearchParams()
  if (searchText) queryParams.set('search', searchText)
  if (filterKeywordId) queryParams.set('keyword_id', filterKeywordId)
  if (followingOnly) queryParams.set('following_only', 'true')
  if (minScore) queryParams.set('min_score', minScore)
  if (sortBy !== 'discovered_at') queryParams.set('sort_by', sortBy)
  queryParams.set('limit', '100')

  const { data: postsData = { data: [] }, isLoading } = useQuery({
    queryKey: ['monitor-posts', searchText, filterKeywordId, followingOnly, minScore, sortBy],
    queryFn: () => api.get(`/monitor/posts?${queryParams.toString()}`).then(r => r.data),
  })

  const followMutation = useMutation({
    mutationFn: (id) => api.post(`/monitor/posts/${id}/follow`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['monitor-posts'] }),
  })

  const deletePostMutation = useMutation({
    mutationFn: (id) => api.delete(`/monitor/posts/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['monitor-posts'] }); toast.success('Da xoa') },
  })

  const posts = postsData.data || postsData || []

  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="Tim kiem noi dung..."
              className="w-full border rounded-lg pl-9 pr-3 py-2 text-sm"
            />
          </div>
        </div>
        <select
          value={filterKeywordId}
          onChange={e => setFilterKeywordId(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Tat ca tu khoa</option>
          {keywords.map(kw => <option key={kw.id} value={kw.id}>{kw.keyword}</option>)}
        </select>
        <select
          value={minScore}
          onChange={e => setMinScore(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">Moi diem</option>
          <option value="3">⭐ 3+</option>
          <option value="4">⭐ 4+</option>
          <option value="5">⭐ 5</option>
        </select>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="discovered_at">Moi nhat</option>
          <option value="relevance">Lien quan nhat</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input type="checkbox" checked={followingOnly} onChange={e => setFollowingOnly(e.target.checked)} className="rounded text-blue-600" />
          <Star size={14} className="text-yellow-500" />
          Theo doi
        </label>
        <span className="text-sm text-gray-500">{posts.length} bai</span>
      </div>

      {/* Posts feed */}
      <div className="space-y-3">
        {posts.map(post => (
          <div key={post.id} className="bg-white rounded-xl shadow p-4">
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm text-gray-900">{post.author_name || 'Unknown'}</span>
                  {post.group_name && (
                    <span className="text-xs text-gray-500">trong <span className="font-medium">{post.group_name}</span></span>
                  )}
                  {post.relevance_score != null && (
                    <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                      post.relevance_score >= 5 ? 'bg-green-100 text-green-700' :
                      post.relevance_score >= 4 ? 'bg-blue-100 text-blue-700' :
                      post.relevance_score >= 3 ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-500'
                    }`}>
                      ⭐ {post.relevance_score}/5
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-700 line-clamp-3 mb-1">{post.content_text}</p>
                {post.ai_summary && (
                  <p className="text-xs text-purple-600 italic mb-1">AI: {post.ai_summary}</p>
                )}
                <div className="flex items-center gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1"><Heart size={12} /> {post.reactions || 0}</span>
                  <span className="flex items-center gap-1"><MessageCircle size={12} /> {post.comments || 0}</span>
                  <span className="flex items-center gap-1"><Share2 size={12} /> {post.shares || 0}</span>
                  {post.posted_at && <span className="flex items-center gap-1"><Clock size={12} /> {new Date(post.posted_at).toLocaleString('vi')}</span>}
                  {post.scan_keywords?.keyword && (
                    <span className="bg-purple-50 text-purple-600 px-1.5 py-0.5 rounded">{post.scan_keywords.keyword}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 ml-3">
                {post.post_url && (
                  <a href={post.post_url} target="_blank" rel="noopener noreferrer" className="p-1.5 rounded hover:bg-gray-100 text-gray-400">
                    <ExternalLink size={14} />
                  </a>
                )}
                <button
                  onClick={() => followMutation.mutate(post.id)}
                  className={`p-1.5 rounded hover:bg-yellow-50 ${post.is_following ? 'text-yellow-500' : 'text-gray-400'}`}
                  title={post.is_following ? 'Bo theo doi' : 'Theo doi'}
                >
                  <Star size={14} fill={post.is_following ? 'currentColor' : 'none'} />
                </button>
                <button
                  onClick={() => deletePostMutation.mutate(post.id)}
                  className="p-1.5 rounded hover:bg-red-50 text-gray-400 hover:text-red-500"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {posts.length === 0 && (
          <div className="text-center py-12 text-gray-400">
            <MessageCircle size={40} className="mx-auto mb-3 opacity-50" />
            <p>Chua co bai viet nao. Them tu khoa va quet de tim bai.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ==========================================
// TAB 3: DISCOVERED GROUPS
// ==========================================
function GroupsTab() {
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
function EngagementTab() {
  const [sourceType, setSourceType] = useState('')
  const [days, setDays] = useState(7)

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data),
  })

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
