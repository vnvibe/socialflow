import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Sparkles, Hash, Save, Image, Film, X, Eye } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const privacyOptions = [
  { value: 'PUBLIC', label: 'Public' },
  { value: 'FRIENDS', label: 'Friends' },
  { value: 'ONLY_ME', label: 'Only Me' }
]

const spinModes = [
  { value: 'none', label: 'None' },
  { value: 'basic', label: 'Basic' },
  { value: 'ai', label: 'AI' }
]

export default function ContentComposer() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const editId = searchParams.get('edit')
  const prefillTopic = searchParams.get('topic')

  const [form, setForm] = useState({
    media_id: '',
    caption: prefillTopic ? `Write about: ${prefillTopic}` : '',
    hashtags: '',
    privacy: 'PUBLIC',
    spin_mode: 'none',
    post_type: 'post'
  })

  const { data: mediaList = [] } = useQuery({
    queryKey: ['media'],
    queryFn: () => api.get('/media').then(r => r.data)
  })

  // Load existing content for editing
  useQuery({
    queryKey: ['content', editId],
    queryFn: () => api.get(`/content/${editId}`).then(r => r.data),
    enabled: !!editId,
    onSuccess: (data) => {
      setForm({
        media_id: data.media_id || '',
        caption: data.caption || '',
        hashtags: data.hashtags?.join(', ') || '',
        privacy: data.privacy || 'PUBLIC',
        spin_mode: data.spin_mode || 'none',
        post_type: data.post_type || 'post'
      })
    }
  })

  const saveMutation = useMutation({
    mutationFn: (data) => {
      const payload = {
        ...data,
        hashtags: data.hashtags.split(/[,\s]+/).map(t => t.replace(/^#/, '').trim()).filter(Boolean)
      }
      return editId ? api.put(`/content/${editId}`, payload) : api.post('/content', payload)
    },
    onSuccess: () => {
      toast.success(editId ? 'Content updated' : 'Content saved')
      navigate('/content')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to save')
  })

  const captionAiMutation = useMutation({
    mutationFn: () => api.post('/ai/caption', { topic: form.caption || 'general', media_id: form.media_id }),
    onSuccess: (res) => {
      setForm(prev => ({ ...prev, caption: res.data.caption }))
      toast.success('Caption generated')
    },
    onError: () => toast.error('Failed to generate caption')
  })

  const hashtagAiMutation = useMutation({
    mutationFn: () => api.post('/ai/hashtags', { caption: form.caption }),
    onSuccess: (res) => {
      setForm(prev => ({ ...prev, hashtags: res.data.hashtags?.join(', ') || '' }))
      toast.success('Hashtags generated')
    },
    onError: () => toast.error('Failed to generate hashtags')
  })

  const selectedMedia = mediaList.find(m => m.id === form.media_id)

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{editId ? 'Edit Content' : 'New Content'}</h1>
        <button
          onClick={() => saveMutation.mutate(form)}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          <Save size={18} />
          {saveMutation.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Form */}
        <div className="lg:col-span-2 space-y-4">
          {/* Media Selector */}
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Media</h3>
            {selectedMedia ? (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="w-16 h-16 bg-gray-200 rounded-lg overflow-hidden flex items-center justify-center shrink-0">
                  {selectedMedia.thumbnail_url ? (
                    <img src={selectedMedia.thumbnail_url} alt="" className="w-full h-full object-cover" />
                  ) : selectedMedia.type === 'video' ? (
                    <Film size={24} className="text-gray-400" />
                  ) : (
                    <Image size={24} className="text-gray-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{selectedMedia.title || selectedMedia.original_filename}</p>
                  <p className="text-xs text-gray-500 capitalize">{selectedMedia.type}</p>
                </div>
                <button onClick={() => setForm(prev => ({ ...prev, media_id: '' }))} className="text-gray-400 hover:text-gray-600">
                  <X size={18} />
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                {mediaList.map(m => (
                  <button
                    key={m.id}
                    onClick={() => setForm(prev => ({ ...prev, media_id: m.id }))}
                    className="aspect-square bg-gray-100 rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all relative"
                  >
                    {m.thumbnail_url ? (
                      <img src={m.thumbnail_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {m.type === 'video' ? <Film size={20} className="text-gray-400" /> : <Image size={20} className="text-gray-400" />}
                      </div>
                    )}
                    <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] px-1 py-0.5 truncate">{m.title || m.original_filename}</span>
                  </button>
                ))}
                {mediaList.length === 0 && <p className="col-span-4 text-sm text-gray-400 text-center py-4">No media available</p>}
              </div>
            )}
          </div>

          {/* Caption */}
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Caption</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">{form.caption.length} chars</span>
                <button
                  onClick={() => captionAiMutation.mutate()}
                  disabled={captionAiMutation.isPending}
                  className="flex items-center gap-1 text-sm bg-purple-50 text-purple-600 px-3 py-1 rounded-lg hover:bg-purple-100"
                >
                  <Sparkles size={14} />
                  {captionAiMutation.isPending ? 'Generating...' : 'AI Caption'}
                </button>
              </div>
            </div>
            <textarea
              value={form.caption}
              onChange={e => setForm(prev => ({ ...prev, caption: e.target.value }))}
              rows={6}
              placeholder="Write your caption here..."
              className="w-full border rounded-lg px-3 py-2 resize-none text-sm"
            />
          </div>

          {/* Hashtags */}
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Hashtags</h3>
              <button
                onClick={() => hashtagAiMutation.mutate()}
                disabled={hashtagAiMutation.isPending}
                className="flex items-center gap-1 text-sm bg-purple-50 text-purple-600 px-3 py-1 rounded-lg hover:bg-purple-100"
              >
                <Hash size={14} />
                {hashtagAiMutation.isPending ? 'Generating...' : 'AI Hashtags'}
              </button>
            </div>
            <input
              value={form.hashtags}
              onChange={e => setForm(prev => ({ ...prev, hashtags: e.target.value }))}
              placeholder="tag1, tag2, tag3"
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            {form.hashtags && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {form.hashtags.split(/[,\s]+/).filter(Boolean).map((tag, i) => (
                  <span key={i} className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">#{tag.replace(/^#/, '')}</span>
                ))}
              </div>
            )}
          </div>

          {/* Settings */}
          <div className="bg-white rounded-xl shadow p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Privacy</label>
                <select
                  value={form.privacy}
                  onChange={e => setForm(prev => ({ ...prev, privacy: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  {privacyOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Spin Mode</label>
                <select
                  value={form.spin_mode}
                  onChange={e => setForm(prev => ({ ...prev, spin_mode: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  {spinModes.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Post Type</label>
                <select
                  value={form.post_type}
                  onChange={e => setForm(prev => ({ ...prev, post_type: e.target.value }))}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="post">Post</option>
                  <option value="reel">Reel</option>
                  <option value="story">Story</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Post Preview */}
        <div>
          <div className="bg-white rounded-xl shadow p-4 sticky top-4">
            <div className="flex items-center gap-2 mb-3">
              <Eye size={16} className="text-gray-500" />
              <h3 className="font-semibold text-gray-900">Post Preview</h3>
            </div>
            <div className="border rounded-lg overflow-hidden">
              {/* Preview header */}
              <div className="flex items-center gap-3 p-3 border-b">
                <div className="w-10 h-10 bg-gray-200 rounded-full" />
                <div>
                  <p className="text-sm font-semibold">Your Page</p>
                  <p className="text-xs text-gray-400">Just now &middot; {form.privacy === 'PUBLIC' ? 'Public' : form.privacy === 'FRIENDS' ? 'Friends' : 'Only me'}</p>
                </div>
              </div>

              {/* Preview caption */}
              <div className="p-3">
                <p className="text-sm whitespace-pre-wrap">{form.caption || <span className="text-gray-400 italic">Your caption will appear here...</span>}</p>
                {form.hashtags && (
                  <p className="text-sm text-blue-600 mt-2">
                    {form.hashtags.split(/[,\s]+/).filter(Boolean).map(t => `#${t.replace(/^#/, '')}`).join(' ')}
                  </p>
                )}
              </div>

              {/* Preview media */}
              {selectedMedia && (
                <div className="bg-gray-100 aspect-video">
                  {selectedMedia.thumbnail_url ? (
                    <img src={selectedMedia.thumbnail_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400">
                      {selectedMedia.type === 'video' ? <Film size={48} /> : <Image size={48} />}
                    </div>
                  )}
                </div>
              )}

              {/* Preview footer */}
              <div className="flex border-t p-2 text-xs text-gray-500 justify-around">
                <span>Like</span>
                <span>Comment</span>
                <span>Share</span>
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">{form.post_type}</span>
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full capitalize">Spin: {form.spin_mode}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
