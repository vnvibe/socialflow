import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Trash2, Film, Image, Edit2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const spinBadge = {
  none: { label: 'No Spin', cls: 'bg-gray-100 text-gray-600' },
  basic: { label: 'Basic', cls: 'bg-yellow-100 text-yellow-700' },
  ai: { label: 'AI', cls: 'bg-purple-100 text-purple-700' }
}

const typeBadge = {
  post: { label: 'Post', cls: 'bg-blue-100 text-blue-700' },
  reel: { label: 'Reel', cls: 'bg-pink-100 text-pink-700' },
  story: { label: 'Story', cls: 'bg-orange-100 text-orange-700' }
}

export default function ContentList() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const { data: contents = [], isLoading } = useQuery({
    queryKey: ['content'],
    queryFn: () => api.get('/content').then(r => r.data)
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/content/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['content'] }); toast.success('Deleted') },
    onError: () => toast.error('Failed to delete')
  })

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Content</h1>
        <Link to="/content/new" className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
          <Plus size={18} /> New Content
        </Link>
      </div>

      {contents.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Edit2 size={48} className="mx-auto mb-3 text-gray-300" />
          <p>No content yet</p>
          <Link to="/content/new" className="text-blue-600 hover:underline text-sm mt-2 inline-block">Create your first content</Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {contents.map(item => {
            const spin = spinBadge[item.spin_mode] || spinBadge.none
            const ptype = typeBadge[item.post_type] || typeBadge.post
            return (
              <div key={item.id} className="bg-white rounded-xl shadow overflow-hidden group">
                {/* Thumbnail */}
                <div
                  className="relative aspect-video bg-gray-100 cursor-pointer"
                  onClick={() => navigate(`/content/new?edit=${item.id}`)}
                >
                  {item.media?.thumbnail_url ? (
                    <img src={item.media.thumbnail_url} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      {item.media?.type === 'video' ? <Film size={32} className="text-gray-300" /> : <Image size={32} className="text-gray-300" />}
                    </div>
                  )}

                  {/* Badges */}
                  <div className="absolute top-2 left-2 flex gap-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ptype.cls}`}>{ptype.label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${spin.cls}`}>{spin.label}</span>
                  </div>

                  {/* Delete */}
                  <button
                    onClick={(e) => { e.stopPropagation(); if (confirm('Delete this content?')) deleteMutation.mutate(item.id) }}
                    className="absolute top-2 right-2 p-1 rounded-full bg-black/50 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-600"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* Content info */}
                <div className="p-3" onClick={() => navigate(`/content/new?edit=${item.id}`)} role="button">
                  <p className="text-sm text-gray-800 line-clamp-2">{item.caption || <span className="text-gray-400 italic">No caption</span>}</p>

                  {item.hashtags?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {item.hashtags.slice(0, 5).map((tag, i) => (
                        <span key={i} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">#{tag}</span>
                      ))}
                      {item.hashtags.length > 5 && <span className="text-[10px] text-gray-400">+{item.hashtags.length - 5}</span>}
                    </div>
                  )}

                  <p className="text-xs text-gray-400 mt-2">{new Date(item.created_at).toLocaleDateString()}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
