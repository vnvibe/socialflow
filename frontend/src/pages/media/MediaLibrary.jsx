import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Upload, Download, Trash2, Film, Image, Music, Play, Clock, CheckCircle, AlertCircle, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const tabs = [
  { key: 'all', label: 'All' },
  { key: 'video', label: 'Videos', icon: Film },
  { key: 'image', label: 'Images', icon: Image },
  { key: 'music', label: 'Music', icon: Music }
]

const statusConfig = {
  pending: { icon: Clock, label: 'Pending', cls: 'bg-yellow-100 text-yellow-700' },
  processing: { icon: Loader2, label: 'Processing', cls: 'bg-blue-100 text-blue-700' },
  done: { icon: CheckCircle, label: 'Done', cls: 'bg-green-100 text-green-700' },
  error: { icon: AlertCircle, label: 'Error', cls: 'bg-red-100 text-red-700' }
}

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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['media'] }); toast.success('Upload complete') },
    onError: () => toast.error('Upload failed')
  })

  const downloadUrlMutation = useMutation({
    mutationFn: (url) => api.post('/media/download-url', { url }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media'] })
      setShowDownload(false)
      setDownloadUrl('')
      toast.success('Download started')
    },
    onError: () => toast.error('Download failed')
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/media/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['media'] }); toast.success('Deleted') },
    onError: () => toast.error('Failed to delete')
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
        <h1 className="text-2xl font-bold text-gray-900">Media Library</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowDownload(true)} className="flex items-center gap-2 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50">
            <Download size={18} /> Download URL
          </button>
          <button onClick={() => fileInputRef.current?.click()} disabled={uploadMutation.isPending} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
            {uploadMutation.isPending ? <Loader2 size={18} className="animate-spin" /> : <Upload size={18} />}
            {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
          </button>
          <input ref={fileInputRef} type="file" accept="video/*,image/*,audio/*" onChange={handleFileChange} className="hidden" />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        {tabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key ? 'bg-white shadow text-gray-900' : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.icon && <tab.icon size={14} />}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Media Grid */}
      {filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Film size={48} className="mx-auto mb-3 text-gray-300" />
          <p>No media files yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filtered.map(item => {
            const status = statusConfig[item.processing_status] || statusConfig.pending
            const StatusIcon = status.icon
            return (
              <div key={item.id} className="bg-white rounded-xl shadow overflow-hidden group">
                <div className="relative aspect-video bg-gray-100">
                  {item.thumbnail_url ? (
                    <img src={item.thumbnail_url} alt={item.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {item.type === 'video' && <Film size={32} className="text-gray-300" />}
                      {item.type === 'image' && <Image size={32} className="text-gray-300" />}
                      {item.type === 'music' && <Music size={32} className="text-gray-300" />}
                    </div>
                  )}

                  {/* Type badge */}
                  <span className="absolute top-2 left-2 text-xs px-2 py-0.5 rounded-full bg-black/60 text-white capitalize">
                    {item.type}
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
                    onClick={() => { if (confirm('Delete this media?')) deleteMutation.mutate(item.id) }}
                    className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                <div className="p-3">
                  <h3 className="text-sm font-medium text-gray-900 truncate">{item.title || item.original_filename || 'Untitled'}</h3>
                  <div className="flex items-center justify-between mt-2">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${status.cls}`}>
                      <StatusIcon size={10} className={item.processing_status === 'processing' ? 'animate-spin' : ''} /> {status.label}
                    </span>
                    {item.file_size && (
                      <span className="text-xs text-gray-400">{(item.file_size / 1024 / 1024).toFixed(1)} MB</span>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Download URL Modal */}
      {showDownload && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowDownload(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Download from URL</h2>
            <input
              placeholder="https://example.com/video.mp4"
              value={downloadUrl}
              onChange={e => setDownloadUrl(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowDownload(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => downloadUrlMutation.mutate(downloadUrl)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                disabled={downloadUrlMutation.isPending || !downloadUrl.trim()}
              >
                {downloadUrlMutation.isPending ? 'Downloading...' : 'Download'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
