import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Rss, Plus, Trash2, RefreshCw, ExternalLink, Heart,
  MessageCircle, Share2, Search, X, Loader, ToggleLeft, ToggleRight,
  Globe, Users,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import { formatDistanceToNow } from 'date-fns'
import { vi } from 'date-fns/locale'

export default function MonitoringWall() {
  const queryClient = useQueryClient()
  const [showAddModal, setShowAddModal] = useState(false)
  const [filterSourceId, setFilterSourceId] = useState(null)
  const [searchText, setSearchText] = useState('')
  const [page, setPage] = useState(1)

  // Sources
  const { data: sources = [] } = useQuery({
    queryKey: ['monitoring-sources'],
    queryFn: () => api.get('/monitoring/sources').then(r => r.data),
  })

  // Wall posts
  const { data: wallData, isLoading: wallLoading } = useQuery({
    queryKey: ['monitoring-wall', filterSourceId, searchText, page],
    queryFn: () => {
      const params = new URLSearchParams({ page, limit: 50 })
      if (filterSourceId) params.set('source_id', filterSourceId)
      if (searchText.trim()) params.set('search', searchText.trim())
      return api.get(`/monitoring/wall?${params}`).then(r => r.data)
    },
    refetchInterval: 60000,
  })

  const posts = wallData?.data || []
  const totalPosts = wallData?.total || 0

  // Mutations
  const deleteMut = useMutation({
    mutationFn: (id) => api.delete(`/monitoring/sources/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitoring-sources'] })
      queryClient.invalidateQueries({ queryKey: ['monitoring-wall'] })
      toast.success('Da xoa nguon')
    },
  })

  const toggleMut = useMutation({
    mutationFn: ({ id, is_active }) => api.put(`/monitoring/sources/${id}`, { is_active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['monitoring-sources'] })
      toast.success('Da cap nhat')
    },
  })

  const fetchNowMut = useMutation({
    mutationFn: (id) => api.post(`/monitoring/sources/${id}/fetch-now`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['monitoring-wall'] })
      toast.success(res.data.message || 'Da fetch xong')
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi fetch'),
  })

  return (
    <div>
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Rss size={24} className="text-orange-500" />
          <h1 className="text-2xl font-bold text-gray-900">Nguon tin</h1>
          <span className="text-sm text-gray-500">({sources.length} nguon)</span>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          <Plus size={16} />
          Them nguon
        </button>
      </div>

      {/* Sources chips */}
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          <button
            onClick={() => { setFilterSourceId(null); setPage(1) }}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              !filterSourceId ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Tat ca
          </button>
          {sources.map(s => (
            <div key={s.id} className="flex items-center gap-1">
              <button
                onClick={() => { setFilterSourceId(s.id === filterSourceId ? null : s.id); setPage(1) }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  s.id === filterSourceId ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {s.source_type === 'group' ? <Users size={12} /> : <Globe size={12} />}
                {s.name || s.fb_source_id}
                {!s.is_active && <span className="text-xs opacity-60">(off)</span>}
              </button>
              <div className="flex gap-0.5">
                <button
                  onClick={() => toggleMut.mutate({ id: s.id, is_active: !s.is_active })}
                  className="p-1 text-gray-400 hover:text-blue-500"
                  title={s.is_active ? 'Tat' : 'Bat'}
                >
                  {s.is_active ? <ToggleRight size={14} className="text-green-500" /> : <ToggleLeft size={14} />}
                </button>
                <button
                  onClick={() => fetchNowMut.mutate(s.id)}
                  disabled={fetchNowMut.isPending}
                  className="p-1 text-gray-400 hover:text-orange-500"
                  title="Fetch ngay"
                >
                  <RefreshCw size={14} className={fetchNowMut.isPending ? 'animate-spin' : ''} />
                </button>
                <button
                  onClick={() => { if (confirm('Xoa nguon nay?')) deleteMut.mutate(s.id) }}
                  className="p-1 text-gray-400 hover:text-red-500"
                  title="Xoa"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Tim kiem bai viet..."
          value={searchText}
          onChange={(e) => { setSearchText(e.target.value); setPage(1) }}
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        {searchText && (
          <button onClick={() => setSearchText('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X size={14} />
          </button>
        )}
      </div>

      {/* Posts wall */}
      {wallLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader className="animate-spin text-blue-500" size={32} />
        </div>
      ) : posts.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <Rss size={48} className="mx-auto mb-4 opacity-30" />
          <p className="text-lg">Chua co bai viet nao</p>
          <p className="text-sm mt-1">Them nguon va fetch de bat dau theo doi</p>
        </div>
      ) : (
        <div className="space-y-4">
          {posts.map(post => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPosts > 50 && (
        <div className="flex justify-center gap-2 mt-6">
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

      {/* Add modal */}
      {showAddModal && (
        <AddSourceModal onClose={() => setShowAddModal(false)} />
      )}
    </div>
  )
}

function PostCard({ post }) {
  const source = post.monitored_sources
  const timeAgo = post.fetched_at
    ? formatDistanceToNow(new Date(post.fetched_at), { addSuffix: true, locale: vi })
    : ''

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-sm transition-shadow">
      {/* Source + time */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {source?.avatar_url ? (
            <img src={source.avatar_url} className="w-8 h-8 rounded-full object-cover" alt="" />
          ) : (
            <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
              {source?.source_type === 'group' ? <Users size={14} className="text-gray-500" /> : <Globe size={14} className="text-gray-500" />}
            </div>
          )}
          <div>
            <p className="text-sm font-medium text-gray-900">{source?.name || source?.fb_source_id || 'Unknown'}</p>
            {post.author_name && (
              <p className="text-xs text-gray-500">{post.author_name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{timeAgo}</span>
          {post.post_url && (
            <a href={post.post_url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-500">
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>

      {/* Content */}
      <p className="text-sm text-gray-800 whitespace-pre-line leading-relaxed">
        {post.content_text?.length > 300
          ? post.content_text.substring(0, 300) + '...'
          : post.content_text}
      </p>

      {/* Image */}
      {post.image_url && (
        <img
          src={post.image_url}
          className="mt-3 rounded-lg max-h-64 object-cover w-full"
          loading="lazy"
          alt=""
        />
      )}

      {/* Engagement */}
      <div className="flex items-center gap-4 mt-3 pt-3 border-t border-gray-100">
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <Heart size={12} /> {post.reactions || 0}
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <MessageCircle size={12} /> {post.comments || 0}
        </span>
        <span className="flex items-center gap-1 text-xs text-gray-500">
          <Share2 size={12} /> {post.shares || 0}
        </span>
      </div>
    </div>
  )
}

function AddSourceModal({ onClose }) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!url.trim()) return toast.error('Nhap URL Facebook')

    // Extract fb_source_id from URL
    let fbSourceId = url.trim()
    let sourceType = 'page'

    // Parse URL
    try {
      const u = new URL(url.includes('http') ? url : `https://${url}`)
      const path = u.pathname.replace(/\/$/, '')

      if (path.includes('/groups/')) {
        sourceType = 'group'
        const match = path.match(/\/groups\/([^/]+)/)
        if (match) fbSourceId = match[1]
      } else {
        // Page: /pagename or /profile.php?id=123
        const match = path.match(/^\/([^/]+)$/)
        if (match && match[1] !== 'profile.php') {
          fbSourceId = match[1]
        }
        const idParam = u.searchParams.get('id')
        if (idParam) fbSourceId = idParam
      }
    } catch {
      // Not a URL — use as-is (could be page ID/name)
    }

    setLoading(true)
    try {
      await api.post('/monitoring/sources', {
        source_type: sourceType,
        fb_source_id: fbSourceId,
        name: name.trim() || null,
        url: url.includes('facebook.com') ? url.trim() : null,
      })
      queryClient.invalidateQueries({ queryKey: ['monitoring-sources'] })
      toast.success('Da them nguon')
      onClose()
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
              placeholder="https://www.facebook.com/pagename hoac groups/123456"
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
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Huy
            </button>
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
