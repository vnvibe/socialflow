import { useState, useRef } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { X, Send, Clock, Sparkles, Loader, Image, Hash, Link2, FileText, ImagePlus, Upload, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import useAgentGuard from '../../hooks/useAgentGuard'

const targetLabel = { page: 'Trang', group: 'Nhóm', profile: 'Trang cá nhân' }

export default function QuickPost({ accountId, target, onClose }) {
  const [inputBrief, setInputBrief] = useState('')
  const [referenceUrl, setReferenceUrl] = useState('')
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [mediaId, setMediaId] = useState(null)
  const [uploadFile, setUploadFile] = useState(null)
  const [scheduledAt, setScheduledAt] = useState('')
  const [showSchedule, setShowSchedule] = useState(false)
  const [generatingCaption, setGeneratingCaption] = useState(false)
  const [generatingHashtags, setGeneratingHashtags] = useState(false)
  const [showMediaPicker, setShowMediaPicker] = useState(false)
  const [imagePrompt, setImagePrompt] = useState('')
  const [generatingImage, setGeneratingImage] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [postMethod, setPostMethod] = useState(() => {
    // Default: Graph API for pages with access_token, Cookie for others
    if (target.type === 'page' && target.postingMethod === 'access_token') return 'graph'
    return 'cookie'
  })
  const fileInputRef = useRef(null)
  // Jobs queue to DB, agent picks up when online - no need to check agent status

  const { data: mediaList = [] } = useQuery({
    queryKey: ['media-quick'],
    queryFn: () => api.get('/media?limit=20').then(r => r.data),
    enabled: showMediaPicker,
  })

  const postMutation = useMutation({
    mutationFn: (data) => {
      if (postMethod === 'graph' && target.type === 'page' && target.postingMethod === 'access_token') {
        const media = mediaList.find(m => m.id === data.media_id)
        const mediaUrl = media?.url || media?.processed_path || media?.original_path
        const mediaType = media?.type === 'video' ? 'video' : (media ? 'photo' : 'text')
        return api.post(`/fanpages/${target.id}/post-direct`, {
          caption: data.caption, media_url: mediaUrl, media_type: mediaType,
        })
      }
      return api.post(`/accounts/${accountId}/quick-post`, data)
    },
    onSuccess: () => {
      toast.success(
        postMethod === 'graph'
          ? 'Da dang truc tiep qua Graph API!'
          : (scheduledAt ? 'Da hen gio dang bai!' : 'Da them vao hang doi! Agent se dang.')
      )
      onClose()
    },
    onError: (err) => {
      if (err.response?.status === 503) toast.error('Da them vao hang doi — Agent se xu ly khi online.')
      else toast.error(err.response?.data?.error || 'Khong the dang bai')
    },
  })

  const [confirmNoMedia, setConfirmNoMedia] = useState(false)

  const handleSubmit = () => {
    if (!caption.trim() && !mediaId) {
      toast.error('Nhap noi dung hoac chon anh/video')
      return
    }
    // Warn if no media attached
    if (!mediaId && !confirmNoMedia) {
      setConfirmNoMedia(true)
      toast('Chua co anh/video dinh kem. Bam Dang lan nua de xac nhan.', { icon: '⚠️', duration: 4000 })
      return
    }
    setConfirmNoMedia(false)
    const doPost = () => {
      const hashtagArray = hashtags.split(/[,\s#]+/).filter(h => h.trim()).map(h => h.trim())
      postMutation.mutate({
        target_type: target.type,
        target_id: target.type !== 'profile' ? target.id : null,
        caption: caption.trim(),
        hashtags: hashtagArray,
        media_id: mediaId,
        scheduled_at: showSchedule && scheduledAt ? new Date(scheduledAt).toISOString() : null,
      })
    }
    doPost()
  }

  // === AI Handlers ===

  const handleAICaption = async () => {
    if (!inputBrief.trim() && !caption.trim()) {
      toast.error('Nhap thong tin dau vao truoc')
      return
    }
    setGeneratingCaption(true)
    try {
      const body = { topic: target.name || 'general', style: 'casual', language: 'vi' }
      if (inputBrief.trim()) {
        body.input_brief = inputBrief.trim()
        if (referenceUrl.trim()) body.reference_url = referenceUrl.trim()
      }
      if (caption.trim() && !inputBrief.trim()) {
        body.reference_caption = caption.trim()
      }
      const res = await api.post('/ai/caption', body)
      if (res.data?.caption) {
        setCaption(res.data.caption)
        if (res.data.hashtags?.length) setHashtags(res.data.hashtags.join(' '))
        toast.success('AI da viet noi dung' + (res.data.hashtags?.length ? ' + hashtag!' : '!'))
      }
    } catch {
      toast.error('AI viet that bai')
    } finally {
      setGeneratingCaption(false)
    }
  }

  const handleAIHashtags = async () => {
    if (!caption.trim()) { toast.error('Viet noi dung truoc'); return }
    setGeneratingHashtags(true)
    try {
      const res = await api.post('/ai/hashtags', { caption })
      if (res.data?.hashtags) {
        setHashtags(res.data.hashtags.join(' '))
        toast.success('AI da goi y hashtag!')
      }
    } catch { toast.error('AI goi y that bai') }
    finally { setGeneratingHashtags(false) }
  }

  const handleAIImage = async () => {
    setGeneratingImage(true)
    try {
      let prompt = imagePrompt.trim()
      if (!prompt && caption.trim()) {
        const r = await api.post('/ai/image-prompt', { caption: caption.trim() })
        prompt = r.data?.prompt || ''
        setImagePrompt(prompt)
      }
      if (!prompt) { toast.error('Nhap prompt hoac viet noi dung truoc'); setGeneratingImage(false); return }
      const res = await api.post('/ai/generate-image', { prompt })
      if (res.data?.media_id) { setMediaId(res.data.media_id); toast.success('Da tao anh AI!') }
    } catch (err) { toast.error(err.response?.data?.error || 'Tao anh that bai') }
    finally { setGeneratingImage(false) }
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadFile(file)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await api.post('/media/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
      if (res.data?.id) { setMediaId(res.data.id); toast.success('Da tai len!') }
    } catch { toast.error('Tai len that bai') }
  }

  const selectedMedia = mediaList.find(m => m.id === mediaId)
  const canSubmit = caption.trim() || mediaId

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-app-surface w-full sm:rounded sm:max-w-lg sm:mx-4  max-h-[95vh] sm:max-h-[90vh] flex flex-col rounded-t-2xl">

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-app-border shrink-0">
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-app-primary text-base">Dang bai</h3>
            <p className="text-xs text-app-muted truncate">
              {targetLabel[target.type]}: <span className="font-medium text-app-primary">{target.name}</span>
            </p>
          </div>
          {/* Cookie / Graph API toggle */}
          {target.type === 'page' && target.postingMethod === 'access_token' && (
            <div
              onClick={() => setPostMethod(prev => prev === 'graph' ? 'cookie' : 'graph')}
              className="flex items-center gap-1.5 cursor-pointer select-none mr-2"
              title={postMethod === 'graph' ? 'Dang qua Graph API (nhanh, khong can Agent)' : 'Dang qua Cookie (can Agent chay)'}
            >
              <span className={`text-xs font-medium ${postMethod === 'cookie' ? 'text-orange-600' : 'text-app-dim'}`}>Cookie</span>
              <div className={`relative w-9 h-5 rounded-full transition-colors ${postMethod === 'graph' ? 'bg-info' : 'bg-orange-500'}`}>
                <div className={`absolute top-0.5 w-4 h-4 bg-app-surface rounded-full shadow transition-transform ${postMethod === 'graph' ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </div>
              <span className={`text-xs font-medium ${postMethod === 'graph' ? 'text-blue-600' : 'text-app-dim'}`}>Graph</span>
            </div>
          )}
          <button onClick={onClose} className="p-2 -mr-2 rounded-full hover:bg-app-elevated shrink-0">
            <X className="w-5 h-5 text-app-dim" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

          {/* === STEP 1: Thong tin dau vao === */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-100 text-purple-600 text-xs font-bold shrink-0">1</div>
              <h4 className="text-sm font-semibold text-app-primary">Thong tin dau vao</h4>
            </div>
            <p className="text-xs text-app-muted mb-2 ml-7">Nhap y tuong, thong tin san pham, hoac link bai viet. AI se viet noi dung chuyen nghiep tu day.</p>
            <textarea
              value={inputBrief}
              onChange={(e) => setInputBrief(e.target.value)}
              placeholder="VD: Gioi thieu dich vu hosting gia re, SSD NVMe, uptime 99.9%, ho tro 24/7..."
              rows={3}
              className="w-full rounded border border-app-border px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-500 focus:border-purple-500 resize-none bg-app-base placeholder:text-app-dim"
            />
            <div className="flex items-center gap-2 mt-2">
              <Link2 className="w-3.5 h-3.5 text-app-dim shrink-0" />
              <input
                type="url"
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
                placeholder="Link tham khao (tuy chon)"
                className="flex-1 rounded-lg border border-app-border px-3 py-1.5 text-xs focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-app-base"
              />
            </div>
            <button
              onClick={handleAICaption}
              disabled={generatingCaption || !inputBrief.trim()}
              className="mt-3 w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:bg-app-hover disabled:text-app-muted transition-colors"
            >
              {generatingCaption ? <Loader className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generatingCaption ? 'Dang viet...' : 'AI Viet bai'}
            </button>
          </section>

          {/* === STEP 2: Noi dung bai viet === */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs font-bold shrink-0">2</div>
                <h4 className="text-sm font-semibold text-app-primary">Noi dung bai viet</h4>
              </div>
              {caption.trim() && (
                <button
                  onClick={handleAICaption}
                  disabled={generatingCaption}
                  className="text-xs text-purple-600 hover:text-purple-700 disabled:text-app-dim flex items-center gap-1"
                >
                  {generatingCaption ? <Loader className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                  Viet lai
                </button>
              )}
            </div>
            <textarea
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Noi dung se duoc AI gen tu buoc 1, hoac nhap truc tiep..."
              rows={5}
              className="w-full rounded border border-app-border px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
            />
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs text-app-dim">{caption.length} ky tu</span>
              {caption.trim() && (
                <button
                  onClick={handleAIHashtags}
                  disabled={generatingHashtags}
                  className="text-xs text-purple-600 hover:text-purple-700 disabled:text-app-dim flex items-center gap-1"
                >
                  {generatingHashtags ? <Loader className="w-3 h-3 animate-spin" /> : <Hash className="w-3 h-3" />}
                  AI gen hashtag
                </button>
              )}
            </div>
            {hashtags && (
              <input
                type="text"
                value={hashtags}
                onChange={(e) => setHashtags(e.target.value)}
                placeholder="hashtag1 hashtag2 ..."
                className="mt-2 w-full rounded-lg border border-app-border px-3 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-blue-50 text-blue-700"
              />
            )}
          </section>

          {/* === STEP 3: Anh / Video === */}
          <section>
            <div className="flex items-center gap-2 mb-2">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-green-100 text-hermes text-xs font-bold shrink-0">3</div>
              <h4 className="text-sm font-semibold text-app-primary">Anh / Video</h4>
              <span className="text-xs text-app-dim">(tuy chon)</span>
            </div>

            {/* Selected media preview */}
            {(selectedMedia || uploadFile) && (
              <div className="flex items-center gap-3 p-3 bg-green-50 rounded mb-3">
                <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center text-hermes text-xs font-medium shrink-0">
                  {selectedMedia?.type === 'video' ? 'Video' : 'Anh'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-app-primary truncate">{uploadFile?.name || selectedMedia?.title || 'Media'}</p>
                  <p className="text-xs text-app-muted">{selectedMedia?.type === 'video' ? 'Video' : 'Anh'}</p>
                </div>
                <button onClick={() => { setMediaId(null); setUploadFile(null) }} className="text-app-dim hover:text-red-500 p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Action buttons */}
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleAIImage}
                disabled={generatingImage || (!caption.trim() && !imagePrompt.trim())}
                className="flex flex-col items-center gap-1.5 p-3 rounded border border-app-border hover:border-purple-300 hover:bg-purple-50 disabled:opacity-40 transition-colors"
              >
                {generatingImage ? <Loader className="w-5 h-5 text-purple-500 animate-spin" /> : <ImagePlus className="w-5 h-5 text-purple-500" />}
                <span className="text-xs text-app-muted font-medium">Tao AI</span>
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center gap-1.5 p-3 rounded border border-app-border hover:border-blue-300 hover:bg-blue-50 transition-colors"
              >
                <Upload className="w-5 h-5 text-blue-500" />
                <span className="text-xs text-app-muted font-medium">Tai len</span>
              </button>
              <button
                onClick={() => setShowMediaPicker(!showMediaPicker)}
                className="flex flex-col items-center gap-1.5 p-3 rounded border border-app-border hover:border-green-300 hover:bg-green-50 transition-colors"
              >
                <Image className="w-5 h-5 text-hermes" />
                <span className="text-xs text-app-muted font-medium">Thu vien</span>
              </button>
            </div>
            <input ref={fileInputRef} type="file" accept="image/*,video/*" className="hidden" onChange={handleFileUpload} />

            {/* Image prompt — visible when no caption */}
            {!caption.trim() && !selectedMedia && (
              <div className="mt-2">
                <input
                  type="text"
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  placeholder="Nhap prompt cho anh AI (bat buoc neu chua co noi dung)"
                  className="w-full rounded-lg border border-app-border px-3 py-2 text-xs focus:ring-2 focus:ring-purple-500 focus:border-purple-500 bg-app-base"
                />
              </div>
            )}
            {/* Editable prompt after gen */}
            {imagePrompt && caption.trim() && (
              <div className="mt-2">
                <input
                  type="text"
                  value={imagePrompt}
                  onChange={(e) => setImagePrompt(e.target.value)}
                  className="w-full rounded-lg border border-app-border px-3 py-2 text-xs text-app-muted bg-app-base focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                />
                <p className="text-xs text-app-dim mt-0.5">Chinh sua prompt truoc khi tao anh</p>
              </div>
            )}

            {/* Media picker dropdown */}
            {showMediaPicker && (
              <div className="mt-2 max-h-36 overflow-y-auto border border-app-border rounded p-2 space-y-1">
                {mediaList.length === 0 ? (
                  <p className="text-xs text-app-dim text-center py-4">Chua co media nao.</p>
                ) : mediaList.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => { setMediaId(m.id); setShowMediaPicker(false) }}
                    className={`w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors ${
                      mediaId === m.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-app-base'
                    }`}
                  >
                    <div className="w-8 h-8 bg-app-elevated rounded flex items-center justify-center text-app-dim text-xs shrink-0">
                      {m.type === 'video' ? 'V' : 'A'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-app-primary truncate">{m.title || m.id.slice(0, 8)}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* === Advanced: Schedule === */}
          <section>
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm text-app-muted hover:text-app-primary transition-colors w-full"
            >
              {showAdvanced ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              <Clock className="w-4 h-4" />
              <span>Hen gio dang</span>
            </button>
            {showAdvanced && (
              <div className="mt-2 ml-6">
                <label className="flex items-center gap-2 mb-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showSchedule}
                    onChange={(e) => setShowSchedule(e.target.checked)}
                    className="rounded border-app-border text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm text-app-primary">Bat hen gio</span>
                </label>
                {showSchedule && (
                  <input
                    type="datetime-local"
                    value={scheduledAt}
                    onChange={(e) => setScheduledAt(e.target.value)}
                    min={new Date().toISOString().slice(0, 16)}
                    className="w-full rounded-lg border border-app-border px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                )}
              </div>
            )}
          </section>
        </div>

        {/* Footer — sticky */}
        <div className="px-4 py-3 border-t border-app-border flex items-center gap-3 shrink-0 bg-app-surface sm:rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2.5 text-sm rounded border border-app-border text-app-muted hover:bg-app-base transition-colors">
            Huy
          </button>
          <button
            onClick={handleSubmit}
            disabled={postMutation.isPending || !canSubmit}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded bg-info text-white hover:opacity-90 disabled:bg-app-hover disabled:text-app-muted transition-colors"
          >
            {postMutation.isPending ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            {postMutation.isPending ? 'Dang xu ly...' : showSchedule && scheduledAt ? 'Hen gio' : 'Dang ngay'}
          </button>
        </div>
      </div>
    </div>
  )
}
