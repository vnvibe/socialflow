import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Upload, Download, Trash2, Film, Image, Music, Play, Clock, CheckCircle, AlertCircle, Loader2, PenSquare, Plus } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const tabs = [
  { key: 'all', label: 'Tất cả' },
  { key: 'video', label: 'Video', icon: Film },
  { key: 'image', label: 'Hình ảnh', icon: Image },
  { key: 'music', label: 'Âm nhạc', icon: Music }
]

const statusConfig = {
  pending: { icon: Clock, label: 'Chờ xử lý', cls: 'bg-yellow-100 text-yellow-700' },
  processing: { icon: Loader2, label: 'Đang xử lý', cls: 'bg-blue-100 text-info' },
  done: { icon: CheckCircle, label: 'Hoàn thành', cls: 'bg-green-100 text-hermes' },
  error: { icon: AlertCircle, label: 'Lỗi', cls: 'bg-red-100 text-red-700' }
}

const typeLabel = { video: 'Video', image: 'Ảnh', music: 'Nhạc' }

export default function MediaLibrary() {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState('all')
  const [showDownload, setShowDownload] = useState(false)
  const [downloadUrl, setDownloadUrl] = useState('')
  const fileInputRef = useRef(null)

  const { data: media = [], isLoading } = useQuery({
    queryKey: ['media'],
    queryFn: () => api.get('/media').then(r => r.data)
  })

  const uploadMutation = useMutation({
    mutationFn: (file) => {
      const formData = new FormData()
      formData.append('file', file)
      return api.post('/media/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['media'] }); toast.success('Đã tải lên thành công') },
    onError: () => toast.error('Tải lên thất bại')
  })

  const downloadUrlMutation = useMutation({
    mutationFn: (url) => api.post('/media/download-url', { url }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media'] })
      setShowDownload(false)
      setDownloadUrl('')
      toast.success('Đã bắt đầu tải về')
    },
    onError: () => toast.error('Tải về thất bại')
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/media/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['media'] }); toast.success('Đã xoá') },
    onError: () => toast.error('Không thể xoá')
  })

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    if (file) uploadMutation.mutate(file)
    e.target.value = ''
  }

  const filtered = activeTab === 'all' ? media : media.filter(m => m.type === activeTab)

  const formatDuration = (seconds) => {
    if (!seconds) return ''
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-app-primary">Thư viện</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowDownload(true)} className="flex items-center gap-2 border border-app-border px-4 py-2 rounded-lg hover:bg-app-base">
            <Download size={18} /> Tải từ URL
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending} className="flex items-center gap-2 bg-info text-white px-4 py-2 rounded-lg hover:opacity-90">
            {uploadMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {uploadMutation.isPending ? 'Đang tải lên...' : 'Tải lên'}
          </button>
          <input ref={fileInputRef} type="file" accept="video/*,image/*,audio/*" onChange={handleFileChange} className="hidden" />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-6 bg-app-elevated rounded-lg p-1 w-fit">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key ? 'bg-app-surface shadow text-app-primary' : 'text-app-muted hover:text-app-primary'
            }`}
          >
            {tab.icon && <tab.icon size={14} />}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Media Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <Film size={48} className="mx-auto mb-3 text-app-dim" />
          <p className="text-app-muted mb-2">Chưa có file media nào</p>
          <p className="text-sm text-app-dim mb-4">Tải lên ảnh, video hoặc nhạc để bắt đầu tạo nội dung</p>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-2 bg-info text-white px-4 py-2 rounded-lg hover:opacity-90 text-sm"
          >
            <Plus size={16} /> Tải lên file đầu tiên
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map(item => {
            const status = statusConfig[item.processing_status] || statusConfig.pending
            const StatusIcon = status.icon
            const isDone = item.processing_status === 'done'
            return (
              <div key={item.id} className="bg-app-surface rounded shadow overflow-hidden group">
                <div className="relative aspect-video bg-app-elevated">
                  {(item.thumbnail_url || item.url || item.original_path) ? (
                    <img src={item.thumbnail_url || item.url || item.original_path} alt={item.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {item.type === 'video' && <Film size={32} className="text-app-dim" />}
                      {item.type === 'image' && <Image size={32} className="text-app-dim" />}
                      {item.type === 'music' && <Music size={32} className="text-app-dim" />}
                    </div>
                  )}

                  {/* Type badge */}
                  <span className="absolute top-2 left-2 text-xs px-2 py-0.5 rounded-full bg-black/60 text-white">
                    {typeLabel[item.type] || item.type}
                  </span>

                  {/* Duration */}
                  {item.duration && (
                    <span className="absolute bottom-2 right-2 text-xs px-1.5 py-0.5 rounded bg-black/70 text-white font-mono">
                      {formatDuration(item.duration)}
                    </span>
                  )}

                  {/* Play overlay for videos */}
                  {item.type === 'video' && (
                    <Link to={`/media/${item.id}/edit`} className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/30 transition-colors">
                      <Play size={36} className="text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                    </Link>
                  )}

                  {/* Delete button */}
                  <button
                    onClick={() => { if (confirm('Bạn có chắc muốn xoá file này?')) deleteMutation.mutate(item.id) }}
                    className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                <div className="p-3">
                  <h3 className="text-sm font-medium text-app-primary truncate">{item.title || item.original_filename || 'Chưa đặt tên'}</h3>
                  <div className="flex items-center justify-between mt-2">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${status.cls}`}>
                      <StatusIcon size={10} className={item.processing_status === 'processing' ? 'animate-spin' : ''} /> {status.label}
                    </span>
                    {item.file_size && (
                      <span className="text-xs text-app-dim">{(item.file_size / 1024 / 1024).toFixed(1)} MB</span>
                    )}
                  </div>

                  {/* Create content link — only for done items */}
                  {isDone && (
                    <Link
                      to={`/content/new?media_id=${item.id}`}
                      className="flex items-center gap-1 text-xs text-info hover:text-info mt-2"
                    >
                      <PenSquare size={12} /> Tạo nội dung
                    </Link>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Download URL Modal */}
      {showDownload && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowDownload(false)}>
          <div className="bg-app-surface rounded p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Tải từ đường dẫn</h2>
            <input
              placeholder="https://example.com/video.mp4"
              value={downloadUrl}
              onChange={e => setDownloadUrl(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            />
            <p className="text-xs text-app-dim mt-1">Hỗ trợ link video từ TikTok, YouTube, Facebook...</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowDownload(false)} className="px-4 py-2 border rounded-lg hover:bg-app-base">Huỷ</button>
              <button
                onClick={() => downloadUrlMutation.mutate(downloadUrl)}
                className="px-4 py-2 bg-info text-white rounded-lg hover:opacity-90"
                disabled={downloadUrlMutation.isPending || !downloadUrl.trim()}
              >
                {downloadUrlMutation.isPending ? 'Đang tải...' : 'Tải về'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
