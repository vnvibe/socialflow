import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Sparkles, Hash, Save, Image, Film, X, Eye, Wand2, Loader, Send, ArrowLeft, CheckCircle, ImagePlus, ChevronDown, ChevronUp, Clock, Loader2, AlertCircle, ExternalLink, RotateCcw, Trash2, PauseCircle, History, Edit2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import ContentPublishModal from '../../components/content/ContentPublishModal'
import HashtagSection from '../../components/content/HashtagSection'
import JobEditTargetModal from '../../components/content/JobEditTargetModal'

const privacyOptions = [
  { value: 'PUBLIC', label: 'Công khai' },
  { value: 'FRIENDS', label: 'Bạn bè' },
  { value: 'ONLY_ME', label: 'Chỉ mình tôi' }
]

const spinModes = [
  { value: 'none', label: 'Không' },
  { value: 'basic', label: 'Cơ bản' },
  { value: 'ai', label: 'AI' }
]

const stylePresets = [
  { value: 'casual', label: 'Thân mật', emoji: '😊' },
  { value: 'professional', label: 'Chuyên nghiệp', emoji: '💼' },
  { value: 'viral', label: 'Viral', emoji: '🔥' },
  { value: 'educational', label: 'Giáo dục', emoji: '📚' },
  { value: 'story', label: 'Kể chuyện', emoji: '📖' },
  { value: 'promotional', label: 'Quảng cáo', emoji: '🎯' },
]

const niches = [
  'general', 'fitness', 'food', 'tech', 'beauty', 'education',
  'travel', 'fashion', 'business', 'health', 'gaming', 'music',
]

const nicheLabels = {
  general: 'Tổng hợp', fitness: 'Thể hình', food: 'Ẩm thực', tech: 'Công nghệ',
  beauty: 'Làm đẹp', education: 'Giáo dục', travel: 'Du lịch', fashion: 'Thời trang',
  business: 'Kinh doanh', health: 'Sức khoẻ', gaming: 'Game', music: 'Âm nhạc',
}

const aiImageModels = [
  { value: 'fal-ai/flux/schnell', label: 'Flux Schnell (nhanh)' },
  { value: 'fal-ai/flux/dev', label: 'Flux Dev' },
  { value: 'fal-ai/flux-pro/v1.1', label: 'Flux Pro 1.1' },
  { value: 'fal-ai/flux.2/dev', label: 'Flux 2 Dev (mới)' },
  { value: 'fal-ai/nano-banana-2', label: 'Nano 2 (siêu nhanh)' },
  { value: 'fal-ai/nano-banana-pro', label: 'Nano Pro (Gemini)' },
  { value: 'fal-ai/recraft-v3', label: 'Recraft V3' },
  { value: 'fal-ai/recraft-v4', label: 'Recraft V4 (mới)' },
  { value: 'fal-ai/ideogram/v3', label: 'Ideogram V3' },
  { value: 'fal-ai/qwen-image-max', label: 'Qwen Image Max' },
]

const aiImageSizes = [
  { value: 'landscape_4_3', label: '4:3 ngang' },
  { value: 'landscape_16_9', label: '16:9 ngang' },
  { value: 'square', label: 'Vuông' },
  { value: 'square_hd', label: 'Vuông HD' },
  { value: 'portrait_4_3', label: '4:3 dọc' },
]

// Map models to their allowed specific aspect ratios
const MODEL_ALLOWED_SIZES = {
  'fal-ai/flux/schnell': ['square', 'square_hd', 'landscape_4_3', 'landscape_16_9', 'portrait_4_3', 'portrait_16_9'],
  'fal-ai/flux/dev': ['square', 'square_hd', 'landscape_4_3', 'landscape_16_9', 'portrait_4_3', 'portrait_16_9'],
  'fal-ai/flux-pro/v1.1': ['square', 'square_hd', 'landscape_4_3', 'landscape_16_9', 'portrait_4_3', 'portrait_16_9'],
  'fal-ai/flux.2/dev': ['square', 'square_hd', 'landscape_4_3', 'landscape_16_9', 'portrait_4_3', 'portrait_16_9'],
  'fal-ai/nano-banana-2': ['square', 'landscape_16_9', 'portrait_16_9', 'landscape_4_3', 'portrait_4_3'],
  'fal-ai/nano-banana-pro': ['square', 'landscape_16_9', 'portrait_16_9', 'landscape_4_3', 'portrait_4_3'],
  'fal-ai/recraft-v3': ['square', 'landscape_16_9', 'portrait_16_9', 'landscape_4_3', 'portrait_4_3'],
  'fal-ai/recraft-v4': ['square', 'landscape_16_9', 'portrait_16_9', 'landscape_4_3', 'portrait_4_3'],
  'fal-ai/ideogram/v3': ['square', 'landscape_16_9', 'portrait_16_9', 'landscape_4_3', 'portrait_4_3'],
  'fal-ai/qwen-image-max': ['square', 'landscape_16_9', 'portrait_16_9', 'landscape_4_3', 'portrait_4_3'],
}

export default function ContentComposer() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('edit')
  const prefillTopic = searchParams.get('topic')
  const prefillMediaId = searchParams.get('media_id')
  const prefillCaption = searchParams.get('caption')
  const prefillHashtags = searchParams.get('hashtags')
  const prefillPostType = searchParams.get('post_type')

  const [form, setForm] = useState({
    media_id: prefillMediaId || '',
    caption: prefillCaption || (prefillTopic ? `Viết về: ${prefillTopic}` : ''),
    hashtags: prefillHashtags || '',
    privacy: 'PUBLIC',
    spin_mode: 'none',
    post_type: prefillPostType || 'post'
  })
  const [aiStyle, setAiStyle] = useState('casual')
  const [aiNiche, setAiNiche] = useState('general')
  const [aiLang, setAiLang] = useState('vi')
  const [showPostSave, setShowPostSave] = useState(false)
  const [savedContentId, setSavedContentId] = useState(null)
  const [savedContent, setSavedContent] = useState(null)
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [editingJob, setEditingJob] = useState(null)

  // Media Grid Filters
  const [mediaSearch, setMediaSearch] = useState('')
  const [mediaFilter, setMediaFilter] = useState('all') // all, ai, uploaded

  // AI Image state
  const [showAiImage, setShowAiImage] = useState(false)
  const [aiImagePrompt, setAiImagePrompt] = useState('')
  const [aiImageModel, setAiImageModel] = useState('fal-ai/flux/schnell')
  const [aiImageSize, setAiImageSize] = useState('landscape_4_3')

  // Dynamically restrict aspect ratio based on AI model
  const availableSizes = MODEL_ALLOWED_SIZES[aiImageModel] || aiImageSizes.map(s => s.value)
  useEffect(() => {
    if (!availableSizes.includes(aiImageSize)) {
      setAiImageSize(availableSizes.includes('square') ? 'square' : availableSizes[0])
    }
  }, [aiImageModel, availableSizes, aiImageSize])

  const { data: mediaList = [] } = useQuery({
    queryKey: ['media'],
    queryFn: () => api.get('/media').then(r => r.data)
  })

  // Load existing content for editing
  const { data: editData } = useQuery({
    queryKey: ['content', editId],
    queryFn: () => api.get(`/content/${editId}`).then(r => r.data),
    enabled: !!editId,
  })

  useEffect(() => {
    if (!editData) return
    setForm({
      media_id: editData.media_id || '',
      caption: editData.caption || '',
      hashtags: editData.hashtags?.join(', ') || '',
      privacy: editData.privacy || 'PUBLIC',
      spin_mode: editData.spin_mode || 'none',
      post_type: editData.post_type || 'post'
    })
  }, [editData])

  const saveMutation = useMutation({
    mutationFn: (data) => {
      const payload = {
        ...data,
        media_id: data.media_id || null,
        hashtags: data.hashtags.split(/[,\s]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean)
      }
      return editId ? api.put(`/content/${editId}`, payload) : api.post('/content', payload)
    },
    onSuccess: async (res) => {
      toast.success(editId ? 'Đã cập nhật nội dung' : 'Đã lưu nội dung')
      const id = res.data?.id || editId
      setSavedContentId(id)
      setSavedContent({ ...form, id })
      
      // Auto-save hashtags to presets if there are any
      if (form.hashtags.trim()) {
        const currentTags = form.hashtags.split(/[,\s]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean)
        const presetName = form.caption.slice(0, 20).trim() || 'Bài viết mới'
        try {
          await api.post('/ai/hashtag-presets', { name: presetName, tags: currentTags })
          queryClient.invalidateQueries({ queryKey: ['hashtag-presets'] })
        } catch (e) {
          // Silent fail for auto-save
        }
      }

      setShowPostSave(true)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Không thể lưu')
  })

  const captionAiMutation = useMutation({
    mutationFn: (opts = {}) => api.post('/ai/caption', {
      topic: form.caption || prefillTopic || 'nội dung chung',
      style: aiStyle,
      language: aiLang,
      niche: aiNiche !== 'general' ? aiNiche : undefined,
      include_cta: true,
      include_emoji: true,
      ...opts,
    }),
    onSuccess: (res) => {
      setForm(prev => ({ ...prev, caption: res.data.caption }))
      toast.success('AI đã viết nội dung!')
    },
    onError: () => toast.error('Tạo nội dung thất bại — kiểm tra Cài đặt AI')
  })

  const improveAiMutation = useMutation({
    mutationFn: () => api.post('/ai/caption', {
      topic: 'cải thiện nội dung hiện tại',
      style: aiStyle,
      language: aiLang,
      niche: aiNiche !== 'general' ? aiNiche : undefined,
      reference_caption: form.caption,
      include_cta: true,
      include_emoji: true,
    }),
    onSuccess: (res) => {
      setForm(prev => ({ ...prev, caption: res.data.caption }))
      toast.success('Đã cải thiện nội dung!')
    },
    onError: () => toast.error('Cải thiện thất bại — kiểm tra Cài đặt AI')
  })

  const [aiSuggestedHashtags, setAiSuggestedHashtags] = useState([])

  const hashtagAiMutation = useMutation({
    mutationFn: () => api.post('/ai/hashtags', { caption: form.caption }),
    onSuccess: (res) => {
      setAiSuggestedHashtags(res.data.hashtags || [])
      toast.success('AI đã gợi ý hashtag!')
    },
    onError: () => toast.error('Gợi ý hashtag thất bại — kiểm tra Cài đặt AI')
  })

  // AI Image Generation
  const aiImageMutation = useMutation({
    mutationFn: ({ prompt, model, image_size }) =>
      api.post('/ai/generate-image', { prompt, model, image_size }),
    onSuccess: (res) => {
      const { id } = res.data
      setForm(prev => ({ ...prev, media_id: id }))
      queryClient.invalidateQueries({ queryKey: ['media'] })
      setShowAiImage(false)
      setAiImagePrompt('')
      toast.success('Đã tạo ảnh AI!')
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Tạo ảnh thất bại — kiểm tra Cài đặt AI (fal.ai)')
  })

  // Retry failed job
  const retryMutation = useMutation({
    mutationFn: (jobId) => api.post(`/jobs/${jobId}/retry`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['content', editId] }); toast.success('Đã thử lại') },
    onError: () => toast.error('Không thể thử lại'),
  })

  // Cancel pending jobs
  const cancelJobsMutation = useMutation({
    mutationFn: async (jobs) => {
      const pendingJobs = jobs.filter(j => j.status === 'pending')
      for (const job of pendingJobs) {
        await api.post(`/jobs/${job.id}/cancel`)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content', editId] })
      toast.success('Đã tạm dừng đăng bài, bạn có thể chỉnh sửa')
    },
    onError: () => toast.error('Không thể tạm dừng')
  })

  // Delete content
  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/content/${editId}`),
    onSuccess: () => {
      toast.success('Đã xóa bài viết')
      navigate('/content')
    },
    onError: () => toast.error('Không thể xóa')
  })

  // Auto-generate image prompt from caption (dedicated endpoint)
  const autoPromptMutation = useMutation({
    mutationFn: () => api.post('/ai/image-prompt', { caption: form.caption }),
    onSuccess: (res) => {
      setAiImagePrompt(res.data.prompt || '')
      toast.success('Đã tạo prompt ảnh!')
    },
    onError: () => toast.error('Không tạo được prompt')
  })

  // Compute locked state (cannot edit if currently publishing)
  const isLocked = editData?.publish_jobs?.some(j => ['pending', 'claimed', 'running'].includes(j.status)) || false

  // Filter publish jobs to only show the latest attempt per target (removes duplicates from "Thử lại")
  const displayJobs = useMemo(() => {
    if (!editData?.publish_jobs) return []
    const seen = new Set()
    return editData.publish_jobs.filter(job => {
      const targetId = job.target_name || job.id
      const accountId = job.account_name || 'none'
      const key = `${job.type}-${accountId}-${targetId}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [editData?.publish_jobs])

  // Resolve selected media
  const listMatch = mediaList.find(m => m.id === form.media_id)
  const selectedMedia = listMatch || (editData?.media?.id === form.media_id ? editData.media : null)

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/content')} className="p-1.5 rounded-lg hover:bg-app-elevated transition-colors">
            <ArrowLeft size={20} className="text-app-muted" />
          </button>
          <h1 className="text-2xl font-bold text-app-primary">{editId ? 'Chỉnh sửa nội dung' : 'Tạo nội dung mới'}</h1>
        </div>
        {editId && (
          <button
            onClick={() => { if (window.confirm("Bạn có chắc muốn xóa bài viết này không? Không thể hoàn tác.")) deleteMutation.mutate() }}
            disabled={deleteMutation.isPending || isLocked}
            className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg disabled:opacity-50 transition-colors"
            title="Xóa bài"
          >
            <Trash2 size={16} />
            <span className="hidden sm:inline">Xóa</span>
          </button>
        )}
        <button
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending || isLocked}
          className="flex items-center gap-2 bg-info text-white px-4 py-2 rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          <Save size={18} />
          {saveMutation.isPending ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>

      {isLocked && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded flex items-start gap-3 text-sm mb-6">
          <AlertCircle size={18} className="text-yellow-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Nội dung này đang bị khóa</p>
            <p className="mt-1">Bài viết đang trong quá trình đăng hoặc đã đăng thành công nên không thể chỉnh sửa. Để sửa nội dung, vui lòng tạm dừng quá trình đăng ở khung trạng thái bên phải.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Form */}
        <div className="lg:col-span-2 space-y-4">
          {/* Media Selector */}
          <div className="bg-app-surface rounded shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-app-primary">Ảnh / Video</h3>
              <button
                onClick={() => setShowAiImage(!showAiImage)}
                disabled={isLocked}
                className={`flex items-center gap-1.5 text-sm px-3 py-1 rounded-lg transition-colors ${
                  showAiImage ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-600 hover:bg-purple-100'
                } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <ImagePlus size={14} />
                Tạo ảnh AI
                {showAiImage ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
            </div>

            {selectedMedia ? (
              <div className="flex items-center gap-3 p-3 bg-app-base rounded-lg">
                <div className="w-16 h-16 bg-app-hover rounded-lg overflow-hidden flex items-center justify-center shrink-0">
                  {(selectedMedia.thumbnail_url || selectedMedia.url || selectedMedia.original_path) ? (
                    <img src={selectedMedia.thumbnail_url || selectedMedia.url || selectedMedia.original_path} alt="" className="w-full h-full object-cover" />
                  ) : selectedMedia.type === 'video' ? (
                    <Film size={24} className="text-app-dim" />
                  ) : (
                    <Image size={24} className="text-app-dim" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{selectedMedia.title || selectedMedia.original_filename || 'Ảnh'}</p>
                  <p className="text-xs text-app-muted">{selectedMedia.type === 'video' ? 'Video' : selectedMedia.type === 'image' ? 'Ảnh' : selectedMedia.source_type === 'generated' ? 'AI Generated' : 'Media'}</p>
                </div>
                <button onClick={() => setForm(prev => ({ ...prev, media_id: '' }))} disabled={isLocked} className="text-app-dim hover:text-app-muted disabled:opacity-50 disabled:cursor-not-allowed">
                  <X size={18} />
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    placeholder="Tìm ảnh..."
                    value={mediaSearch}
                    onChange={e => setMediaSearch(e.target.value)}
                    disabled={isLocked}
                    className="flex-1 border border-app-border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-blue-500 bg-app-base bg-opacity-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                  <div className="flex bg-app-elevated p-1 rounded-lg shrink-0">
                    <button onClick={() => setMediaFilter('all')} disabled={isLocked} className={`text-xs px-2 py-1 rounded transition-colors ${mediaFilter === 'all' ? 'bg-app-surface shadow text-app-primary' : 'text-app-muted hover:text-app-primary'} ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}>Tất cả</button>
                    <button onClick={() => setMediaFilter('ai')} disabled={isLocked} className={`text-xs px-2 py-1 rounded transition-colors ${mediaFilter === 'ai' ? 'bg-app-surface shadow text-app-primary' : 'text-app-muted hover:text-app-primary'} ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}>AI & Mẫu</button>
                    <button onClick={() => setMediaFilter('uploaded')} disabled={isLocked} className={`text-xs px-2 py-1 rounded transition-colors ${mediaFilter === 'uploaded' ? 'bg-app-surface shadow text-app-primary' : 'text-app-muted hover:text-app-primary'} ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}>Tải lên</button>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2 max-h-[40vh] overflow-y-auto">
                  {mediaList
                    .filter(m => mediaFilter === 'all' || (mediaFilter === 'ai' && m.source_type === 'generated') || (mediaFilter === 'uploaded' && m.source_type !== 'generated'))
                    .filter(m => !mediaSearch || m.title?.toLowerCase().includes(mediaSearch.toLowerCase()) || m.original_filename?.toLowerCase().includes(mediaSearch.toLowerCase()))
                    .map(m => (
                      <button
                        key={m.id}
                        onClick={() => setForm(prev => ({ ...prev, media_id: m.id }))}
                        disabled={isLocked}
                        className={`aspect-square bg-app-elevated rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all relative disabled:opacity-50 disabled:cursor-not-allowed ${form.media_id === m.id ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
                      >
                        {(m.thumbnail_url || m.url || m.original_path) ? (
                          <img src={m.thumbnail_url || m.url || m.original_path} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            {m.type === 'video' ? <Film size={20} className="text-app-dim" /> : <Image size={20} className="text-app-dim" />}
                          </div>
                        )}
                        <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate">{m.title || m.original_filename}</span>
                      </button>
                    ))}
                  {mediaList.length === 0 && (
                    <p className="col-span-4 text-sm text-app-dim text-center py-4">
                      Chưa có tìm thấy ảnh/video nào. <a href="/media" className="text-info hover:underline">Tải lên tại Thư viện</a>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* AI Image Generation Panel */}
            {showAiImage && (
              <div className="mt-3 border border-purple-200 rounded-lg p-3 bg-purple-50/50 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-medium text-app-primary">Mô tả ảnh (prompt)</label>
                    <button
                      onClick={() => autoPromptMutation.mutate()}
                      disabled={autoPromptMutation.isPending || !form.caption || isLocked}
                      className="text-[11px] px-2 py-0.5 rounded bg-purple-100 text-purple-600 hover:bg-purple-200 disabled:opacity-40"
                    >
                      {autoPromptMutation.isPending ? <Loader size={10} className="animate-spin inline" /> : <Sparkles size={10} className="inline" />}
                      {' '}Tự tạo từ nội dung
                    </button>
                  </div>
                  <textarea
                    value={aiImagePrompt}
                    onChange={e => setAiImagePrompt(e.target.value)}
                    rows={2}
                    placeholder="VD: A vibrant photo of Vietnamese street food with colorful ingredients..."
                    disabled={isLocked}
                    className="w-full border border-purple-200 rounded-lg px-3 py-2 text-sm resize-none focus:ring-1 focus:ring-purple-400 focus:border-purple-400 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-app-muted mb-1 block">Model</label>
                    <select
                      value={aiImageModel}
                      onChange={e => setAiImageModel(e.target.value)}
                      disabled={isLocked}
                      className="w-full border rounded-lg px-2 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {aiImageModels.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-app-muted mb-1 block">Kích thước</label>
                    <select
                      value={aiImageSize}
                      onChange={e => setAiImageSize(e.target.value)}
                      disabled={isLocked}
                      className="w-full border rounded-lg px-2 py-1.5 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {aiImageSizes.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                </div>

                <button
                  onClick={() => aiImageMutation.mutate({ prompt: aiImagePrompt, model: aiImageModel, image_size: aiImageSize })}
                  disabled={aiImageMutation.isPending || !aiImagePrompt.trim() || isLocked}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium"
                >
                  {aiImageMutation.isPending ? (
                    <><Loader size={14} className="animate-spin" /> Đang tạo ảnh...</>
                  ) : (
                    <><ImagePlus size={14} /> Tạo ảnh</>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* AI Style Presets */}
          <div className="bg-app-surface rounded shadow p-4">
            <h3 className="font-semibold text-app-primary mb-3">Phong cách AI</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-app-muted mb-1.5">Phong cách</label>
                <div className="flex flex-wrap gap-1.5">
                  {stylePresets.map(s => (
                    <button
                      key={s.value}
                      onClick={() => setAiStyle(s.value)}
                      disabled={isLocked}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        aiStyle === s.value
                          ? 'bg-purple-600 text-white'
                          : 'bg-app-elevated text-app-muted hover:bg-app-hover'
                      } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {s.emoji} {s.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-app-muted mb-1">Lĩnh vực</label>
                  <select value={aiNiche} onChange={e => setAiNiche(e.target.value)}
                    disabled={isLocked}
                    className="w-full border rounded-lg px-3 py-1.5 text-sm disabled:opacity-50 disabled:cursor-not-allowed">
                    {niches.map(n => <option key={n} value={n}>{nicheLabels[n] || n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-app-muted mb-1">Ngôn ngữ</label>
                  <div className="flex gap-1">
                    <button onClick={() => setAiLang('vi')}
                      disabled={isLocked}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${aiLang === 'vi' ? 'bg-info text-white' : 'bg-app-elevated text-app-muted'} ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}>
                      Tiếng Việt
                    </button>
                    <button onClick={() => setAiLang('en')}
                      disabled={isLocked}
                      className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium ${aiLang === 'en' ? 'bg-info text-white' : 'bg-app-elevated text-app-muted'} ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}>
                      Tiếng Anh
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Caption */}
          <div className="bg-app-surface rounded shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-app-primary">Nội dung bài viết</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-app-dim">{form.caption.length} ký tự</span>
                {form.caption.length > 0 && (
                  <button
                    onClick={() => improveAiMutation.mutate()}
                    disabled={improveAiMutation.isPending || isLocked}
                    className="flex items-center gap-1 text-sm bg-amber-50 text-amber-600 px-3 py-1 rounded-lg hover:bg-amber-100 disabled:opacity-50"
                  >
                    {improveAiMutation.isPending ? <Loader size={14} className="animate-spin" /> : <Wand2 size={14} />}
                    {improveAiMutation.isPending ? 'Đang cải thiện...' : 'Cải thiện'}
                  </button>
                )}
                <button
                  onClick={() => captionAiMutation.mutate()}
                  disabled={captionAiMutation.isPending || isLocked}
                  className="flex items-center gap-1 text-sm bg-purple-50 text-purple-600 px-3 py-1 rounded-lg hover:bg-purple-100 disabled:opacity-50"
                >
                  {captionAiMutation.isPending ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {captionAiMutation.isPending ? 'Đang tạo...' : 'AI viết nội dung'}
                </button>
              </div>
            </div>
            <textarea
              value={form.caption}
              onChange={e => setForm(prev => ({ ...prev, caption: e.target.value }))}
              rows={6}
              placeholder="Viết nội dung bài viết tại đây..."
              disabled={isLocked}
              className="w-full border rounded-lg px-3 py-2 resize-none text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Hashtags */}
          <div className="bg-app-surface rounded shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-app-primary">Hashtag</h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setForm(prev => ({ ...prev, hashtags: savedContent?.hashtags?.join(', ') || '' }))}
                  disabled={isLocked || !savedContent?.hashtags?.length}
                  className="text-xs px-2 py-1 rounded bg-orange-50 text-orange-600 hover:bg-orange-100 font-medium disabled:opacity-50 flex items-center gap-1"
                >
                  <History size={12} /> Đã lưu ({savedContent?.hashtags?.length || 0})
                </button>
                <button
                  onClick={() => hashtagAiMutation.mutate()}
                  disabled={hashtagAiMutation.isPending || !form.caption || isLocked}
                  className="flex items-center gap-1 text-sm bg-purple-50 text-purple-600 px-3 py-1 rounded-lg hover:bg-purple-100 disabled:opacity-50"
                >
                  {hashtagAiMutation.isPending ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  {hashtagAiMutation.isPending ? 'Đang tạo...' : 'AI gợi ý'}
                </button>
              </div>
            </div>

            {aiSuggestedHashtags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-2 bg-purple-50/50 border border-purple-100 rounded-lg mb-3">
                <span className="text-[10px] text-purple-500 font-medium w-full mb-1">AI Gợi ý (nhấn để thêm):</span>
                {aiSuggestedHashtags.filter(tag => !form.hashtags.includes(tag.replace(/^#/, ''))).map(tag => (
                  <button
                    key={tag}
                    onClick={() => setForm(prev => ({ ...prev, hashtags: prev.hashtags + (prev.hashtags ? ' ' : '') + tag }))}
                    disabled={isLocked}
                    className="text-[11px] px-2 py-0.5 rounded-full bg-app-surface border border-purple-200 text-purple-700 hover:bg-purple-100 hover:border-purple-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {tag}
                  </button>
                ))}
                {aiSuggestedHashtags.filter(tag => !form.hashtags.includes(tag.replace(/^#/, ''))).length === 0 && (
                  <span className="text-xs text-app-muted italic">Đã thêm tất cả gợi ý.</span>
                )}
              </div>
            )}

            <input
              type="text"
              placeholder="Ví dụ: thuonghieu, khuyenmai"
              value={form.hashtags}
              disabled={isLocked}
              onChange={e => setForm({ ...form, hashtags: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          {/* Settings */}
          <div className="bg-app-surface rounded shadow p-4">
            <h3 className="font-semibold text-app-primary mb-3">Cài đặt</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-app-muted mb-1">Quyền riêng tư</label>
                <select
                  value={form.privacy}
                  onChange={e => setForm(prev => ({ ...prev, privacy: e.target.value }))}
                  disabled={isLocked}
                  className="w-full border rounded-lg px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {privacyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-app-muted mb-1">Biến thể</label>
                <select
                  value={form.spin_mode}
                  onChange={e => setForm(prev => ({ ...prev, spin_mode: e.target.value }))}
                  disabled={isLocked}
                  className="w-full border rounded-lg px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {spinModes.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-app-muted mb-1">Kiểu bài</label>
                <select
                  value={form.post_type}
                  onChange={e => setForm(prev => ({ ...prev, post_type: e.target.value }))}
                  disabled={isLocked}
                  className="w-full border rounded-lg px-3 py-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <option value="post">Bài viết</option>
                  <option value="reel">Reel</option>
                  <option value="story">Story</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Publish Status + Preview */}
        <div className="space-y-4">
          {/* Publish Status — always visible when editing */}
          {editId && (
            <div className="bg-app-surface rounded shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-app-primary flex items-center gap-2">
                  <Send size={15} className="text-info" />
                  Trạng thái đăng
                </h3>
                <button
                  onClick={() => setShowPublishModal(true)}
                  disabled={isLocked}
                  className="text-xs px-3 py-1 rounded-lg bg-green-50 text-hermes hover:bg-green-100 font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send size={11} /> Đăng bài
                </button>
              </div>

              {displayJobs.length > 0 ? (
                <div className="space-y-4">
                  {displayJobs.map(job => {
                    const isFailed = job.status === 'failed'
                    const isDone = job.status === 'done'
                    const isPending = job.status === 'pending'
                    const isRunning = job.status === 'running' || job.status === 'claimed'
                    return (
                      <div key={job.id} className={`flex items-center gap-2 p-2.5 rounded-lg border text-xs ${
                        isDone ? 'bg-green-50 border-green-200' : isFailed ? 'bg-red-50 border-red-200' : isPending ? 'bg-yellow-50 border-yellow-200' : 'bg-blue-50 border-blue-200'
                      }`}>
                        {/* Status icon */}
                        {isDone && <CheckCircle size={14} className="text-hermes flex-shrink-0" />}
                        {isFailed && <AlertCircle size={14} className="text-red-500 flex-shrink-0" />}
                        {isPending && <Clock size={14} className="text-yellow-500 flex-shrink-0" />}
                        {isRunning && <Loader2 size={14} className="text-info animate-spin flex-shrink-0" />}

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-app-primary truncate max-w-[220px]" title={`${job.account_name || 'User'} ➔ ${job.target_name || 'Target'}`}>
                              {job.type === 'post_profile' ? (
                                job.account_name || 'Cá nhân'
                              ) : (
                                <>
                                  <span className="text-app-dim font-normal">Từ: {job.account_name || 'Tài khoản'} ➔ </span>
                                  {job.target_name || 'Nơi đăng'}
                                </>
                              )}
                            </span>
                            <span className="text-app-dim text-[10px]">({job.type_label})</span>
                            {(isPending || isFailed) && (
                              <button 
                                onClick={() => setEditingJob(job)} 
                                className="text-info hover:text-info bg-blue-50 hover:bg-blue-100 p-1 rounded transition-colors"
                                title="Đổi nơi đăng"
                              >
                                <Edit2 size={12} />
                              </button>
                            )}
                          </div>
                          {isFailed && job.error_message && (
                            <p className="text-red-500 mt-0.5 truncate" title={job.error_message}>{job.error_message}</p>
                          )}
                          {isDone && job.finished_at && (
                            <p className="text-app-dim mt-0.5">{new Date(job.finished_at).toLocaleString('vi-VN')}</p>
                          )}
                          {(isPending || isRunning) && (
                            <div className="mt-2 text-right">
                               <button 
                                onClick={() => cancelJobsMutation.mutate([job])}
                                disabled={cancelJobsMutation.isPending}
                                className="inline-flex items-center gap-1 text-[11px] font-medium text-red-600 hover:text-red-700 bg-red-100/50 hover:bg-red-100 px-2 py-1 rounded transition-colors"
                              >
                                <PauseCircle size={12} /> Tạm dừng
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        {isDone && job.post_url && (
                          <a href={job.post_url} target="_blank" rel="noopener noreferrer"
                            className="flex items-center gap-1 px-2 py-1 rounded bg-green-100 text-hermes hover:bg-green-200 flex-shrink-0 font-medium"
                          >
                            <ExternalLink size={10} /> Xem
                          </a>
                        )}
                        {isFailed && (
                          <button
                            onClick={() => retryMutation.mutate(job.id)}
                            disabled={retryMutation.isPending}
                            className="flex items-center gap-1 px-2 py-1 rounded bg-orange-100 text-orange-700 hover:bg-orange-200 flex-shrink-0 font-medium"
                          >
                            <RotateCcw size={10} /> Thử lại
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-app-dim text-center py-3">Chưa đăng bài nào</p>
              )}
            </div>
          )}

          {/* Preview */}
          <div className="bg-app-surface rounded shadow p-4 sticky top-4">
            <div className="flex items-center gap-2 mb-3">
              <Eye size={16} className="text-app-muted" />
              <h3 className="font-semibold text-app-primary">Xem trước</h3>
            </div>
            <div className="border rounded-lg overflow-hidden">
              <div className="flex items-center gap-3 p-3 border-b">
                <div className="w-10 h-10 bg-app-hover rounded-full" />
                <div>
                  <p className="text-sm font-semibold">Trang của bạn</p>
                  <p className="text-xs text-app-dim">Vừa xong &middot; {form.privacy === 'PUBLIC' ? 'Công khai' : form.privacy === 'FRIENDS' ? 'Bạn bè' : 'Chỉ mình tôi'}</p>
                </div>
              </div>
              <div className="p-3">
                <p className="text-sm whitespace-pre-wrap">{form.caption || <span className="text-app-dim italic">Nội dung sẽ hiện ở đây...</span>}</p>
                {form.hashtags && (
                  <p className="text-sm text-info mt-2">
                    {form.hashtags.split(/[,\s]+/).filter(Boolean).map(t => `#${t.replace(/^#/, '')}`).join(' ')}
                  </p>
                )}
              </div>
              {selectedMedia && (
                <div className="bg-app-elevated aspect-video">
                  {(selectedMedia.thumbnail_url || selectedMedia.url || selectedMedia.original_path) ? (
                    <img src={selectedMedia.thumbnail_url || selectedMedia.url || selectedMedia.original_path} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-app-dim">
                      {selectedMedia.type === 'video' ? <Film size={48} /> : <Image size={48} />}
                    </div>
                  )}
                </div>
              )}
              <div className="flex border-t p-2 text-xs text-app-muted justify-around">
                <span>Thích</span>
                <span>Bình luận</span>
                <span>Chia sẻ</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="text-xs bg-app-elevated text-app-muted px-2 py-0.5 rounded-full">{form.post_type === 'post' ? 'Bài viết' : form.post_type === 'reel' ? 'Reel' : 'Story'}</span>
              <span className="text-xs bg-app-elevated text-app-muted px-2 py-0.5 rounded-full">Biến thể: {form.spin_mode === 'none' ? 'Không' : form.spin_mode === 'basic' ? 'Cơ bản' : 'AI'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Post-save dialog */}
      {showPostSave && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-app-surface rounded w-full max-w-sm  p-6 text-center">
            <CheckCircle size={48} className="mx-auto mb-3 text-hermes" />
            <h3 className="font-semibold text-app-primary text-lg mb-1">Nội dung đã được lưu!</h3>
            <p className="text-sm text-app-muted mb-6">Bạn muốn đăng bài ngay hay quay lại danh sách?</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { setShowPostSave(false); setShowPublishModal(true) }}
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-info text-white rounded-lg hover:opacity-90 font-medium"
              >
                <Send size={16} /> Đăng bài ngay
              </button>
              <button
                onClick={() => navigate('/content')}
                className="w-full px-4 py-2.5 border border-app-border text-app-muted rounded-lg hover:bg-app-base"
              >
                Về danh sách
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Publish modal */}
      {showPublishModal && (savedContentId || editId) && (
        <ContentPublishModal
          contentId={savedContentId || editId}
          content={savedContent || editData}
          onClose={() => { setShowPublishModal(false) }}
        />
      )}

      {editingJob && (
        <JobEditTargetModal
          job={editingJob}
          onClose={() => setEditingJob(null)}
        />
      )}
    </div>
  )
}
