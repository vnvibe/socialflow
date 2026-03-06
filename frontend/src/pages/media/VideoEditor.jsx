import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Play, Loader2, CheckCircle, AlertCircle, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const positionOptions = [
  { value: 'top-left', label: 'Top Left' },
  { value: 'top-center', label: 'Top Center' },
  { value: 'top-right', label: 'Top Right' },
  { value: 'center', label: 'Center' },
  { value: 'bottom-left', label: 'Bottom Left' },
  { value: 'bottom-center', label: 'Bottom Center' },
  { value: 'bottom-right', label: 'Bottom Right' }
]

const statusConfig = {
  pending: { icon: null, label: 'Pending', cls: 'bg-yellow-100 text-yellow-700' },
  processing: { icon: Loader2, label: 'Processing...', cls: 'bg-blue-100 text-blue-700' },
  done: { icon: CheckCircle, label: 'Done', cls: 'bg-green-100 text-green-700' },
  error: { icon: AlertCircle, label: 'Error', cls: 'bg-red-100 text-red-700' }
}

export default function VideoEditor() {
  const { id } = useParams()
  const queryClient = useQueryClient()

  const [config, setConfig] = useState({
    watermark_text: '',
    watermark_position: 'bottom-right',
    watermark_opacity: 0.7,
    music_id: '',
    subtitle_enabled: false
  })

  const { data: media, isLoading } = useQuery({
    queryKey: ['media', id],
    queryFn: () => api.get(`/media/${id}`).then(r => r.data),
    refetchInterval: (query) => {
      const d = query.state.data
      return d?.processing_status === 'processing' ? 3000 : false
    }
  })

  const { data: musicList = [] } = useQuery({
    queryKey: ['media-music'],
    queryFn: () => api.get('/media').then(r => r.data.filter(m => m.type === 'music'))
  })

  useEffect(() => {
    if (media?.config) {
      setConfig(prev => ({
        ...prev,
        watermark_text: media.config.watermark_text || '',
        watermark_position: media.config.watermark_position || 'bottom-right',
        watermark_opacity: media.config.watermark_opacity ?? 0.7,
        music_id: media.config.music_id || '',
        subtitle_enabled: media.config.subtitle_enabled || false
      }))
    }
  }, [media?.config])

  const saveMutation = useMutation({
    mutationFn: (data) => api.put(`/media/${id}`, { config: data }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['media', id] }); toast.success('Config saved') },
    onError: () => toast.error('Failed to save')
  })

  const processMutation = useMutation({
    mutationFn: () => api.post(`/media/${id}/process`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['media', id] })
      toast.success('Processing started')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to start processing')
  })

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  if (!media) return <div className="text-center py-12 text-gray-400">Media not found</div>

  const videoUrl = media.processed_path || media.original_path
  const status = statusConfig[media.processing_status] || statusConfig.pending
  const StatusIcon = status.icon

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <Link to="/media" className="text-gray-500 hover:text-gray-700"><ArrowLeft size={20} /></Link>
        <h1 className="text-2xl font-bold text-gray-900">Video Editor</h1>
        <span className={`inline-flex items-center gap-1 text-sm px-3 py-1 rounded-full ${status.cls}`}>
          {StatusIcon && <StatusIcon size={14} className={media.processing_status === 'processing' ? 'animate-spin' : ''} />}
          {status.label}
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Video Preview */}
        <div className="lg:col-span-2">
          <div className="bg-black rounded-xl overflow-hidden">
            {videoUrl ? (
              <video controls className="w-full aspect-video" src={videoUrl} />
            ) : (
              <div className="w-full aspect-video flex items-center justify-center text-gray-500">
                <div className="text-center">
                  <Play size={48} className="mx-auto mb-2" />
                  <p>No video available</p>
                </div>
              </div>
            )}
          </div>
          <div className="mt-4 bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold text-gray-900">{media.title || media.original_filename || 'Untitled'}</h3>
            <div className="flex gap-4 mt-2 text-sm text-gray-500">
              {media.duration && <span>Duration: {Math.floor(media.duration / 60)}:{Math.floor(media.duration % 60).toString().padStart(2, '0')}</span>}
              {media.file_size && <span>Size: {(media.file_size / 1024 / 1024).toFixed(1)} MB</span>}
              {media.resolution && <span>Resolution: {media.resolution}</span>}
            </div>
          </div>
        </div>

        {/* Config Panel */}
        <div className="space-y-4">
          {/* Watermark */}
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Watermark</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Text</label>
                <input
                  value={config.watermark_text}
                  onChange={e => setConfig({ ...config, watermark_text: e.target.value })}
                  placeholder="Your watermark text"
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Position</label>
                <select
                  value={config.watermark_position}
                  onChange={e => setConfig({ ...config, watermark_position: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  {positionOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Opacity: {Math.round(config.watermark_opacity * 100)}%</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={config.watermark_opacity}
                  onChange={e => setConfig({ ...config, watermark_opacity: parseFloat(e.target.value) })}
                  className="w-full"
                />
              </div>
            </div>
          </div>

          {/* Music */}
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Background Music</h3>
            <select
              value={config.music_id}
              onChange={e => setConfig({ ...config, music_id: e.target.value })}
              className="w-full border rounded-lg px-3 py-2 text-sm"
            >
              <option value="">No music</option>
              {musicList.map(m => (
                <option key={m.id} value={m.id}>{m.title || m.original_filename}</option>
              ))}
            </select>
          </div>

          {/* Subtitle */}
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Subtitle</h3>
            <label className="flex items-center gap-3 cursor-pointer">
              <div className={`relative w-11 h-6 rounded-full transition-colors ${config.subtitle_enabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
                <div className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config.subtitle_enabled ? 'translate-x-5' : ''}`} />
              </div>
              <input
                type="checkbox"
                checked={config.subtitle_enabled}
                onChange={e => setConfig({ ...config, subtitle_enabled: e.target.checked })}
                className="sr-only"
              />
              <span className="text-sm text-gray-700">{config.subtitle_enabled ? 'Enabled' : 'Disabled'}</span>
            </label>
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2">
            <button
              onClick={() => saveMutation.mutate(config)}
              disabled={saveMutation.isPending}
              className="w-full flex items-center justify-center gap-2 border border-gray-300 px-4 py-2.5 rounded-lg hover:bg-gray-50"
            >
              <Save size={16} />
              {saveMutation.isPending ? 'Saving...' : 'Save Config'}
            </button>
            <button
              onClick={() => processMutation.mutate()}
              disabled={processMutation.isPending || media.processing_status === 'processing'}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2.5 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {media.processing_status === 'processing' ? (
                <><Loader2 size={16} className="animate-spin" /> Processing...</>
              ) : (
                <><Play size={16} /> Process Video</>
              )}
            </button>
          </div>

          {media.processing_error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-700">{media.processing_error}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
