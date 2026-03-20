import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  RefreshCw, TrendingUp, ExternalLink, Play, Eye,
  Search, Globe, Facebook, Loader2, Trash2, Copy,
  ThumbsUp, MessageCircle, Share2, Clock, History,
  PenLine, ImagePlus, Send, ArrowRight, Sparkles, X,
  ArrowLeft, RotateCw
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

// ── Trends tab config ──
const regions = [
  { value: 'VN', label: 'Vietnam' },
  { value: 'US', label: 'United States' },
  { value: 'GB', label: 'United Kingdom' },
  { value: 'JP', label: 'Japan' },
  { value: 'KR', label: 'South Korea' },
  { value: 'TH', label: 'Thailand' },
  { value: 'ID', label: 'Indonesia' },
  { value: 'PH', label: 'Philippines' }
]

const sourceBadge = {
  youtube: { label: 'YouTube', cls: 'bg-red-100 text-red-700' },
  reddit: { label: 'Reddit', cls: 'bg-orange-100 text-orange-700' },
  tiktok: { label: 'TikTok', cls: 'bg-gray-800 text-white' },
  google: { label: 'Google', cls: 'bg-blue-100 text-blue-700' },
  twitter: { label: 'Twitter', cls: 'bg-sky-100 text-sky-700' },
  vnexpress: { label: 'VnExpress', cls: 'bg-emerald-100 text-emerald-700' },
  voz: { label: 'Voz', cls: 'bg-violet-100 text-violet-700' },
  tinhte: { label: 'Tinh tế', cls: 'bg-amber-100 text-amber-700' },
}

const sourceFilters = [
  { value: '', label: 'Tất cả' },
  { value: 'vnexpress', label: 'VnExpress' },
  { value: 'tinhte', label: 'Tinh tế' },
  { value: 'voz', label: 'Voz' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'reddit', label: 'Reddit' },
]

// ── Image generation config ──
const aiModels = [
  { value: 'fal-ai/flux/schnell', label: 'Flux Schnell', tag: 'nhanh' },
  { value: 'fal-ai/flux/dev', label: 'Flux Dev', tag: '' },
  { value: 'fal-ai/flux-pro/v1.1', label: 'Flux Pro 1.1', tag: 'chất lượng' },
  { value: 'fal-ai/flux.2/dev', label: 'Flux 2 Dev', tag: 'mới' },
  { value: 'fal-ai/nano-banana-2', label: 'Nano 2', tag: 'siêu nhanh' },
  { value: 'fal-ai/nano-banana-pro', label: 'Nano Pro', tag: '' },
  { value: 'fal-ai/recraft-v3', label: 'Recraft V3', tag: '' },
  { value: 'fal-ai/recraft-v4', label: 'Recraft V4', tag: 'mới' },
  { value: 'fal-ai/ideogram/v3', label: 'Ideogram V3', tag: '' },
  { value: 'fal-ai/qwen-image-max', label: 'Qwen Image Max', tag: '' },
]

const aiSizes = [
  { value: 'landscape_4_3', label: '4:3 ngang' },
  { value: 'landscape_16_9', label: '16:9 ngang' },
  { value: 'square', label: 'Vuông' },
  { value: 'square_hd', label: 'Vuông HD' },
  { value: 'portrait_4_3', label: '4:3 dọc' },
  { value: 'portrait_16_9', label: '16:9 dọc' },
]

// ── Research: auto-detect source from URL ──
function detectSource(url) {
  if (!url) return { source: 'unknown', type: null, label: '' }
  const u = url.toLowerCase()
  if (u.includes('facebook.com') || u.includes('fb.com') || u.includes('fb.watch')) {
    if (u.includes('/groups/')) return { source: 'facebook', type: 'group', label: 'Nhóm Facebook' }
    if (u.includes('/profile.php') || u.match(/facebook\.com\/[a-z0-9.]+\/?$/i)) return { source: 'facebook', type: 'profile', label: 'Trang cá nhân' }
    if (u.includes('/watch') || u.includes('/reel') || u.includes('/videos')) return { source: 'facebook', type: 'page', label: 'Video Facebook' }
    if (u.includes('/posts/') || u.includes('/permalink/') || u.includes('story_fbid')) return { source: 'facebook', type: 'post', label: 'Bài viết Facebook' }
    return { source: 'facebook', type: 'page', label: 'Facebook' }
  }
  return { source: 'web', type: 'web', label: 'Website' }
}

// ══════════════════════════════════════
// Trends Tab
// ══════════════════════════════════════
function TrendsTab() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [region, setRegion] = useState('VN')
  const [activeSource, setActiveSource] = useState('')

  const sourcesParam = activeSource ? `&sources=${activeSource}` : ''
  const { data: trendsData, isLoading } = useQuery({
    queryKey: ['trends', region, activeSource],
    queryFn: () => api.get(`/trends?region=${region}${sourcesParam}`).then(r => r.data)
  })
  const trends = trendsData?.trends || trendsData || []

  const refreshMutation = useMutation({
    mutationFn: () => api.post('/trends/refresh', { region }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trends'] })
      toast.success('Đã làm mới xu hướng')
    },
    onError: () => toast.error('Lỗi khi làm mới')
  })

  const maxScore = Math.max(...trends.map(t => t.score || 0), 1)

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <select
          value={region}
          onChange={e => setRegion(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          {regions.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          <RefreshCw size={16} className={refreshMutation.isPending ? 'animate-spin' : ''} />
          Làm mới
        </button>
      </div>

      {/* Source filter tabs */}
      <div className="flex flex-wrap gap-1.5 mb-5">
        {sourceFilters.map(sf => (
          <button
            key={sf.value}
            onClick={() => setActiveSource(sf.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
              activeSource === sf.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {sf.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>
      ) : trends.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <TrendingUp size={48} className="mx-auto mb-3 text-gray-300" />
          <p>Không có xu hướng nào cho khu vực này</p>
          <button onClick={() => refreshMutation.mutate()} className="text-blue-600 hover:underline text-sm mt-2">Làm mới</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {trends.map((trend, idx) => (
            <div key={trend.id || idx} className="bg-white rounded-xl shadow overflow-hidden hover:shadow-md transition-shadow">
              {(trend.thumbnail_url || trend.thumbnail) && (
                <div className="relative aspect-video bg-gray-100">
                  <img src={trend.thumbnail_url || trend.thumbnail} alt="" className="w-full h-full object-cover" />
                  {trend.view_count && (
                    <span className="absolute bottom-2 right-2 flex items-center gap-1 text-xs bg-black/70 text-white px-2 py-0.5 rounded">
                      <Eye size={10} /> {trend.view_count.toLocaleString()}
                    </span>
                  )}
                </div>
              )}
              <div className="p-4">
                <h3 className="font-semibold text-gray-900 line-clamp-2">{trend.keyword || trend.title}</h3>
                {trend.description && (
                  <p className="text-xs text-gray-500 line-clamp-2 mt-1">{trend.description}</p>
                )}
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                    <div className="flex items-center gap-2">
                      {trend.category && (
                        <span className="px-1.5 py-0.5 bg-gray-100 rounded text-[10px]">{trend.category}</span>
                      )}
                      {trend.published_at && (
                        <span className="flex items-center gap-0.5"><Clock size={10} /> {new Date(trend.published_at).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })}</span>
                      )}
                    </div>
                    <span className="font-mono">{trend.score?.toFixed(1)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div
                      className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all"
                      style={{ width: `${Math.max((trend.score / maxScore) * 100, 5)}%` }}
                    />
                  </div>
                </div>
                {trend.sources?.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {trend.sources.map((src, i) => {
                      const badge = sourceBadge[src] || { label: src, cls: 'bg-gray-100 text-gray-600' }
                      return <span key={i} className={`text-[10px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    })}
                  </div>
                )}
                <div className="flex items-center justify-between mt-4 pt-3 border-t">
                  <button
                    onClick={() => navigate(`/content/new?topic=${encodeURIComponent(trend.keyword || trend.title)}`)}
                    className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    <Play size={14} /> Tạo nội dung
                  </button>
                  {trend.url && (
                    <a href={trend.url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-600">
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
}

// ══════════════════════════════════════
// Research Tab
// ══════════════════════════════════════
function ResearchTab() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [url, setUrl] = useState('')
  const [activeResult, setActiveResult] = useState(null)
  const [resultSource, setResultSource] = useState('facebook')
  const [showHistory, setShowHistory] = useState(false)

  // Editor mode
  const [editingPost, setEditingPost] = useState(null) // { post, source }
  const [editorTab, setEditorTab] = useState('rewrite') // 'rewrite' | 'image'
  const [rewrittenText, setRewrittenText] = useState('')
  const [generatedImage, setGeneratedImage] = useState(null)
  const [aiModel, setAiModel] = useState('fal-ai/flux/schnell')
  const [aiSize, setAiSize] = useState('landscape_4_3')

  const detected = detectSource(url)

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['research-history'],
    queryFn: () => api.get('/research').then(r => r.data),
  })

  const researchMutation = useMutation({
    mutationFn: async () => {
      if (detected.source === 'facebook') {
        return api.post('/research/facebook', { url, max_posts: 1 }).then(r => r.data)
      }
      return api.post('/research/web', { url, max_pages: 1 }).then(r => r.data)
    },
    onSuccess: (data) => {
      toast.success(`Đã thu thập ${data.count} kết quả!`)
      setActiveResult(data)
      setResultSource(detected.source)
      queryClient.invalidateQueries({ queryKey: ['research-history'] })
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Nghiên cứu thất bại')
    },
  })

  const loadResultMutation = useMutation({
    mutationFn: (id) => api.get(`/research/${id}`).then(r => r.data),
    onSuccess: (data) => {
      setActiveResult({ results: data.results, count: data.result_count })
      setResultSource(data.source)
      setUrl(data.source_url)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/research/${id}`),
    onSuccess: () => {
      toast.success('Đã xoá')
      queryClient.invalidateQueries({ queryKey: ['research-history'] })
    },
  })

  // AI mutations for editor
  const rewriteMutation = useMutation({
    mutationFn: async (text) => {
      const res = await api.post('/ai/caption', {
        reference_caption: text,
        style: 'viral',
        language: 'vi',
        max_length: 2000,
        include_emoji: false,
        include_cta: true,
      })
      return res.data.caption || res.data.result || res.data.text
    },
    onSuccess: (rewritten) => {
      setRewrittenText(rewritten)
      toast.success('Đã viết lại nội dung!')
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Viết lại thất bại')
    },
  })

  const generateImageMutation = useMutation({
    mutationFn: async (text) => {
      const promptRes = await api.post('/ai/image-prompt', { caption: text })
      const prompt = promptRes.data.prompt || promptRes.data.result
      const imgRes = await api.post('/ai/generate-image', { prompt, model: aiModel, image_size: aiSize })
      return imgRes.data
    },
    onSuccess: (image) => {
      setGeneratedImage(image)
      toast.success('Đã tạo ảnh!')
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Tạo ảnh thất bại')
    },
  })

  const openEditor = (post, source) => {
    setEditingPost({ post, source })
    setEditorTab('rewrite')
    setRewrittenText('')
    setGeneratedImage(null)
  }

  const closeEditor = () => {
    setEditingPost(null)
    setRewrittenText('')
    setGeneratedImage(null)
  }

  const sendToPublish = () => {
    const text = rewrittenText || editingPost?.post?.text || ''
    const payload = { caption: text }
    if (generatedImage?.media_id) payload.media_id = generatedImage.media_id
    sessionStorage.setItem('publish_prefill', JSON.stringify(payload))
    navigate('/publish')
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!url.trim()) return toast.error('Nhập URL cần nghiên cứu')
    researchMutation.mutate()
  }

  const copyText = (text) => {
    navigator.clipboard.writeText(text)
    toast.success('Đã copy!')
  }

  // ════════════════════════════════
  // EDITOR MODE
  // ════════════════════════════════
  if (editingPost) {
    const { post, source } = editingPost
    const originalText = post.text || post.heading || ''
    const displayText = rewrittenText || originalText

    return (
      <div className="space-y-4">
        {/* Editor header */}
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={closeEditor}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 font-medium shrink-0"
          >
            <ArrowLeft size={16} /> <span className="hidden sm:inline">Quay lại kết quả</span><span className="sm:hidden">Quay lại</span>
          </button>
          {rewrittenText && (
            <button
              onClick={sendToPublish}
              className="flex items-center gap-1.5 px-4 sm:px-5 py-2 sm:py-2.5 text-sm font-medium rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Send size={15} />
              <span className="hidden sm:inline">Đăng bài</span>
              <ArrowRight size={15} />
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* LEFT: Original content */}
          <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
            <div className="px-5 py-3 bg-gray-50 border-b flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Nội dung gốc</span>
              <div className="flex items-center gap-2">
                {post.url && (
                  <a href={post.url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-blue-500">
                    <ExternalLink size={13} />
                  </a>
                )}
                <button onClick={() => copyText(originalText)} className="text-gray-400 hover:text-gray-600" title="Copy">
                  <Copy size={13} />
                </button>
              </div>
            </div>
            <div className="p-4 sm:p-5 max-h-[60vh] lg:max-h-[calc(100vh-320px)] overflow-y-auto">
              {/* Author info for facebook */}
              {source === 'facebook' && (
                <div className="flex items-center gap-3 mb-4 pb-3 border-b">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 font-bold">
                    {(post.author || '?')[0]}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-800">{post.author || 'Ẩn danh'}</p>
                    <div className="flex items-center gap-3 text-[11px] text-gray-400">
                      {post.date && <span>{new Date(post.date).toLocaleString('vi-VN')}</span>}
                      <span className="flex items-center gap-0.5"><ThumbsUp size={10} /> {post.likes || 0}</span>
                      <span className="flex items-center gap-0.5"><MessageCircle size={10} /> {post.comments || 0}</span>
                      <span className="flex items-center gap-0.5"><Share2 size={10} /> {post.shares || 0}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Web title */}
              {source === 'web' && post.title && (
                <h3 className="text-base font-semibold text-gray-800 mb-3">{post.title}</h3>
              )}

              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{originalText}</p>

              {/* Original media */}
              {post.media && (
                <div className="mt-4">
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block">Ảnh gốc</span>
                  <img src={post.media} alt="" className="rounded-xl max-h-64 object-cover" />
                </div>
              )}
              {post.images?.length > 0 && (
                <div className="mt-4 flex gap-2 flex-wrap">
                  {post.images.slice(0, 6).map((img, i) => (
                    <img key={i} src={img} alt="" className="w-24 h-24 rounded-lg object-cover" />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Tabbed editor workspace */}
          <div className="bg-white rounded-2xl shadow-sm border overflow-hidden">
            {/* Tab bar */}
            <div className="flex border-b">
              <button
                onClick={() => setEditorTab('rewrite')}
                className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
                  editorTab === 'rewrite'
                    ? 'text-amber-700 border-b-2 border-amber-500 bg-amber-50/50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <PenLine size={15} />
                Viết lại nội dung
                {rewrittenText && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
              </button>
              <button
                onClick={() => setEditorTab('image')}
                className={`flex-1 flex items-center justify-center gap-2 py-3.5 text-sm font-medium transition-colors ${
                  editorTab === 'image'
                    ? 'text-purple-700 border-b-2 border-purple-500 bg-purple-50/50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <ImagePlus size={15} />
                Tạo ảnh minh họa
                {generatedImage && <span className="w-2 h-2 rounded-full bg-emerald-500" />}
              </button>
            </div>

            {/* Tab content */}
            {editorTab === 'rewrite' ? (
              <div>
                {/* Rewrite toolbar */}
                <div className="px-4 sm:px-5 py-3 bg-gray-50 border-b flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500 hidden sm:inline">AI sẽ viết lại nội dung theo phong cách mới</span>
                  <div className="flex items-center gap-2">
                    {rewrittenText && (
                      <button onClick={() => copyText(rewrittenText)} className="text-gray-400 hover:text-gray-600" title="Copy">
                        <Copy size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => rewriteMutation.mutate(originalText)}
                      disabled={rewriteMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:bg-amber-400 transition-colors"
                    >
                      {rewriteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />}
                      {rewrittenText ? 'Viết lại lần nữa' : 'Bắt đầu viết lại'}
                    </button>
                  </div>
                </div>

                {/* Rewrite content */}
                <div className="p-4 sm:p-5">
                  {rewriteMutation.isPending ? (
                    <div className="flex flex-col items-center justify-center py-16 text-amber-500">
                      <Loader2 size={28} className="animate-spin mb-3" />
                      <p className="text-sm font-medium">AI đang viết lại nội dung...</p>
                    </div>
                  ) : rewrittenText ? (
                    <textarea
                      value={rewrittenText}
                      onChange={e => setRewrittenText(e.target.value)}
                      className="w-full text-sm text-gray-800 leading-relaxed border rounded-xl p-4 min-h-[300px] focus:outline-none focus:ring-2 focus:ring-amber-300 resize-y"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                      <PenLine size={32} className="mb-3 text-gray-300" />
                      <p className="text-sm font-medium text-gray-500">Bấm "Bắt đầu viết lại"</p>
                      <p className="text-xs mt-1">AI sẽ soạn nội dung mới, bạn chỉnh sửa sau</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div>
                {/* Image toolbar with model + size */}
                <div className="px-4 sm:px-5 py-3 bg-gray-50 border-b">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2 sm:gap-3">
                    <div className="flex-1 min-w-0">
                      <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Model</label>
                      <select
                        value={aiModel}
                        onChange={e => setAiModel(e.target.value)}
                        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                      >
                        {aiModels.map(m => (
                          <option key={m.value} value={m.value}>
                            {m.label}{m.tag ? ` (${m.tag})` : ''}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <div className="flex-1 sm:w-36">
                        <label className="block text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Kích thước</label>
                        <select
                          value={aiSize}
                          onChange={e => setAiSize(e.target.value)}
                          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                        >
                          {aiSizes.map(s => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-end">
                        <button
                          onClick={() => generateImageMutation.mutate(rewrittenText || originalText)}
                          disabled={generateImageMutation.isPending}
                          className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:bg-purple-400 transition-colors whitespace-nowrap"
                        >
                          {generateImageMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                          {generatedImage ? 'Tạo lại' : 'Tạo ảnh'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Image content */}
                <div className="p-4 sm:p-5">
                  {generateImageMutation.isPending ? (
                    <div className="flex flex-col items-center justify-center py-16 text-purple-500">
                      <Loader2 size={28} className="animate-spin mb-3" />
                      <p className="text-sm font-medium">AI đang tạo ảnh minh họa...</p>
                      <p className="text-xs text-purple-400 mt-1">{aiModels.find(m => m.value === aiModel)?.label}</p>
                    </div>
                  ) : generatedImage ? (
                    <div>
                      <img
                        src={generatedImage.url || generatedImage.image_url}
                        alt=""
                        className="rounded-xl w-full max-h-80 object-cover"
                      />
                      <p className="text-xs text-gray-400 mt-2 text-center">
                        {aiModels.find(m => m.value === aiModel)?.label} &middot; {aiSizes.find(s => s.value === aiSize)?.label}
                      </p>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                      <ImagePlus size={32} className="mb-3 text-gray-300" />
                      <p className="text-sm font-medium text-gray-500">Chọn model, kích thước rồi bấm "Tạo ảnh"</p>
                      <p className="text-xs mt-1">AI tạo ảnh dựa trên nội dung bài viết</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom publish bar (sticky) */}
        {rewrittenText && (
          <div className="sticky bottom-0 bg-white rounded-2xl shadow-lg border p-3 sm:p-4 flex items-center justify-between gap-3">
            <div className="text-xs sm:text-sm text-gray-500 min-w-0">
              <Sparkles size={14} className="inline mr-1 text-emerald-500" />
              <span className="hidden sm:inline">Nội dung đã sẵn sàng</span>
              <span className="sm:hidden">Sẵn sàng</span>
              {generatedImage && <span className="ml-1.5 text-purple-500">+ ảnh</span>}
            </div>
            <button
              onClick={sendToPublish}
              className="flex items-center gap-1.5 px-4 sm:px-6 py-2 sm:py-2.5 text-sm font-semibold rounded-xl bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm shrink-0"
            >
              <Send size={15} />
              <span className="hidden sm:inline">Chuyển sang đăng bài</span>
              <span className="sm:hidden">Đăng bài</span>
              <ArrowRight size={15} />
            </button>
          </div>
        )}
      </div>
    )
  }

  // ════════════════════════════════
  // LIST MODE (search + results)
  // ════════════════════════════════
  return (
    <div className="space-y-5">
      {/* ── Search bar ── */}
      <div className="bg-white rounded-2xl shadow-sm border p-3 sm:p-4">
        <form onSubmit={handleSubmit} className="flex flex-wrap sm:flex-nowrap items-center gap-2 sm:gap-3">
          <div className="relative flex-1">
            <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="url"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="Dán link Facebook hoặc website cần nghiên cứu..."
              className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent focus:bg-white transition-all"
              required
            />
            {url.trim() && (
              <span className={`absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                detected.source === 'facebook' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
              }`}>
                {detected.source === 'facebook' ? <Facebook size={10} /> : <Globe size={10} />}
                {detected.label}
              </span>
            )}
          </div>
          <button
            type="submit"
            disabled={researchMutation.isPending}
            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-400 transition-colors shrink-0"
          >
            {researchMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
            {researchMutation.isPending ? 'Đang thu thập...' : 'Nghiên cứu'}
          </button>
          {history.length > 0 && (
            <button
              type="button"
              onClick={() => setShowHistory(!showHistory)}
              className={`flex items-center gap-1.5 px-3 py-3 rounded-xl text-sm border transition-colors shrink-0 ${
                showHistory ? 'bg-gray-100 text-gray-700 border-gray-300' : 'text-gray-400 border-gray-200 hover:text-gray-600 hover:border-gray-300'
              }`}
              title="Lịch sử nghiên cứu"
            >
              <History size={16} />
            </button>
          )}
        </form>

        {researchMutation.isPending && (
          <div className="mt-3 flex items-center gap-3 px-2">
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full animate-pulse" style={{ width: '60%' }} />
            </div>
            <span className="text-xs text-gray-400 shrink-0">Apify đang chạy, 1-3 phút...</span>
          </div>
        )}

        {!url.trim() && !activeResult && !showHistory && (
          <p className="text-xs text-gray-400 mt-2 px-1">Facebook (group, page, profile, bài viết) &amp; website</p>
        )}

        {showHistory && (
          <div className="mt-3 border-t pt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lịch sử nghiên cứu</span>
              <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600"><X size={14} /></button>
            </div>
            {historyLoading ? (
              <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-gray-400" /></div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {history.map(item => (
                  <div
                    key={item.id}
                    className="group flex items-center gap-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 cursor-pointer transition-colors"
                    onClick={() => { loadResultMutation.mutate(item.id); setShowHistory(false) }}
                  >
                    {item.source === 'facebook' ? <Facebook size={12} className="text-blue-500 shrink-0" /> : <Globe size={12} className="text-green-500 shrink-0" />}
                    <span className="text-xs text-gray-700 max-w-[200px] truncate">{item.source_url}</span>
                    <span className="text-[10px] text-gray-400">{new Date(item.created_at).toLocaleDateString('vi-VN')}</span>
                    <button
                      onClick={e => { e.stopPropagation(); if (confirm('Xoá?')) deleteMutation.mutate(item.id) }}
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition-opacity"
                    ><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Empty state ── */}
      {!activeResult && !researchMutation.isPending && (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400">
          <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-4">
            <Search size={32} className="text-gray-300" />
          </div>
          <p className="text-base font-medium text-gray-500">Dán URL và bấm Nghiên cứu</p>
          <p className="text-sm mt-1">Hệ thống sẽ thu thập nội dung bài viết cho bạn</p>
          {history.length > 0 && (
            <button onClick={() => setShowHistory(true)} className="mt-4 flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium">
              <History size={14} /> Xem lịch sử ({history.length})
            </button>
          )}
        </div>
      )}

      {/* ── Results list ── */}
      {activeResult && activeResult.results?.length === 0 && (
        <div className="text-center py-16"><p className="text-gray-400">Không tìm thấy dữ liệu từ URL này</p></div>
      )}

      {activeResult && activeResult.results?.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-600">
              {activeResult.count} kết quả
              <span className="text-gray-400 font-normal ml-2">{resultSource === 'facebook' ? 'Facebook' : 'Website'}</span>
            </span>
            <button onClick={() => setActiveResult(null)} className="text-xs text-gray-400 hover:text-gray-600">Xoá kết quả</button>
          </div>

          {activeResult.results.map((item, idx) => {
            const isFb = resultSource === 'facebook'
            const text = item.text || item.heading || ''
            return (
              <div key={idx} className="bg-white rounded-2xl shadow-sm border hover:shadow-md transition-shadow overflow-hidden">
                <div className="p-5">
                  <div className="flex items-start gap-4">
                    {/* Left: content preview */}
                    <div className="flex-1 min-w-0">
                      {isFb ? (
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-xs font-bold shrink-0">
                            {(item.author || '?')[0]}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-gray-800">{item.author || 'Ẩn danh'}</p>
                            <div className="flex items-center gap-2 text-[11px] text-gray-400">
                              {item.date && <span>{new Date(item.date).toLocaleString('vi-VN')}</span>}
                              <span><ThumbsUp size={9} className="inline" /> {item.likes || 0}</span>
                              <span><MessageCircle size={9} className="inline" /> {item.comments || 0}</span>
                              <span><Share2 size={9} className="inline" /> {item.shares || 0}</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <h3 className="text-sm font-semibold text-gray-800 mb-1">{item.title || item.url}</h3>
                      )}
                      <p className="text-sm text-gray-600 line-clamp-3 whitespace-pre-wrap">{text}</p>
                    </div>

                    {/* Right: thumbnail */}
                    {(item.media || item.images?.[0]) && (
                      <img
                        src={item.media || item.images[0]}
                        alt=""
                        className="w-24 h-24 rounded-xl object-cover shrink-0"
                      />
                    )}
                  </div>
                </div>

                {/* Action bar */}
                <div className="flex items-center gap-2 px-5 py-3 bg-gray-50 border-t">
                  <button
                    onClick={() => openEditor(item, resultSource)}
                    className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 text-white hover:bg-amber-600 transition-colors"
                  >
                    <PenLine size={14} />
                    Soạn lại & Đăng bài
                  </button>
                  <button onClick={() => copyText(text)} className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
                    <Copy size={13} /> Copy
                  </button>
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
                      <ExternalLink size={13} /> Mở gốc
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════
// Main: Tabbed page
// ══════════════════════════════════════
export default function TrendCenter() {
  const [tab, setTab] = useState('trends')

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Xu hướng & Nghiên cứu</h1>
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          <button
            onClick={() => setTab('trends')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === 'trends' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <TrendingUp size={16} />
            Xu hướng
          </button>
          <button
            onClick={() => setTab('research')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              tab === 'research' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            <Search size={16} />
            Nghiên cứu
          </button>
        </div>
      </div>

      {tab === 'trends' && <TrendsTab />}
      {tab === 'research' && <ResearchTab />}
    </div>
  )
}
