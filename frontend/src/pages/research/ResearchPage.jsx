import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, Globe, Facebook, Loader2, Trash2, ChevronDown, ChevronRight,
  ThumbsUp, MessageCircle, Share2, ExternalLink, Copy, PenSquare, Clock
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const sourceTypes = [
  { key: 'facebook', label: 'Facebook', icon: Facebook, color: 'blue', placeholder: 'https://www.facebook.com/groups/...' },
  { key: 'web', label: 'Website', icon: Globe, color: 'green', placeholder: 'https://example.com/article...' },
]

const fbTypes = [
  { key: 'group', label: 'Nhóm (Group)' },
  { key: 'profile', label: 'Trang cá nhân (Profile)' },
  { key: 'page', label: 'Fanpage' },
]

export default function ResearchPage() {
  const queryClient = useQueryClient()
  const [source, setSource] = useState('facebook')
  const [url, setUrl] = useState('')
  const [fbType, setFbType] = useState('group')
  const [maxPosts, setMaxPosts] = useState(20)
  const [activeResult, setActiveResult] = useState(null)
  const [expandedItems, setExpandedItems] = useState({})

  const { data: history = [], isLoading: historyLoading } = useQuery({
    queryKey: ['research-history'],
    queryFn: () => api.get('/research').then(r => r.data),
  })

  const researchMutation = useMutation({
    mutationFn: async () => {
      if (source === 'facebook') {
        return api.post('/research/facebook', { url, type: fbType, max_posts: maxPosts }).then(r => r.data)
      }
      return api.post('/research/web', { url, max_pages: 5 }).then(r => r.data)
    },
    onSuccess: (data) => {
      toast.success(`Đã thu thập ${data.count} kết quả!`)
      setActiveResult(data)
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
      setSource(data.source)
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

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!url.trim()) return toast.error('Nhập URL cần nghiên cứu')
    researchMutation.mutate()
  }

  const copyText = (text) => {
    navigator.clipboard.writeText(text)
    toast.success('Đã copy!')
  }

  const toggleExpand = (idx) => {
    setExpandedItems(prev => ({ ...prev, [idx]: !prev[idx] }))
  }

  const currentSource = sourceTypes.find(s => s.key === source)

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Nghiên cứu</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Input + History */}
        <div className="space-y-4">
          {/* Research form */}
          <div className="bg-white rounded-xl shadow p-5">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Thu thập dữ liệu</h2>

            {/* Source tabs */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 mb-4">
              {sourceTypes.map(s => (
                <button
                  key={s.key}
                  onClick={() => setSource(s.key)}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors ${
                    source === s.key ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  <s.icon size={14} />
                  {s.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              {source === 'facebook' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Loại nguồn</label>
                  <select
                    value={fbType}
                    onChange={e => setFbType(e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    {fbTypes.map(t => (
                      <option key={t.key} value={t.key}>{t.label}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">URL</label>
                <input
                  type="url"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  placeholder={currentSource.placeholder}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  required
                />
              </div>

              {source === 'facebook' && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Số bài tối đa</label>
                  <input
                    type="number"
                    value={maxPosts}
                    onChange={e => setMaxPosts(parseInt(e.target.value) || 10)}
                    min={1}
                    max={100}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  />
                </div>
              )}

              <button
                type="submit"
                disabled={researchMutation.isPending}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:bg-blue-400 transition-colors"
              >
                {researchMutation.isPending ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Đang thu thập...
                  </>
                ) : (
                  <>
                    <Search size={16} />
                    Bắt đầu nghiên cứu
                  </>
                )}
              </button>

              {researchMutation.isPending && (
                <p className="text-xs text-gray-400 text-center">
                  Apify đang chạy, có thể mất 1-5 phút...
                </p>
              )}
            </form>
          </div>

          {/* History */}
          <div className="bg-white rounded-xl shadow">
            <div className="px-4 py-3 border-b">
              <h2 className="text-sm font-semibold text-gray-700">Lịch sử nghiên cứu</h2>
            </div>
            <div className="max-h-[400px] overflow-y-auto divide-y">
              {historyLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 size={20} className="animate-spin text-gray-400" />
                </div>
              ) : history.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">Chưa có nghiên cứu nào</p>
              ) : (
                history.map(item => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                    onClick={() => loadResultMutation.mutate(item.id)}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                      item.source === 'facebook' ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'
                    }`}>
                      {item.source === 'facebook' ? <Facebook size={14} /> : <Globe size={14} />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{item.source_url}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-gray-400">{item.result_count} kết quả</span>
                        <span className="text-xs text-gray-300">&middot;</span>
                        <span className="text-xs text-gray-400 flex items-center gap-1">
                          <Clock size={10} />
                          {new Date(item.created_at).toLocaleDateString('vi-VN')}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={e => {
                        e.stopPropagation()
                        if (confirm('Xoá nghiên cứu này?')) deleteMutation.mutate(item.id)
                      }}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded-md hover:bg-red-50"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Right: Results */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-xl shadow">
            <div className="px-5 py-4 border-b flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">
                Kết quả
                {activeResult && (
                  <span className="ml-2 text-xs font-normal text-gray-400">({activeResult.count} mục)</span>
                )}
              </h2>
            </div>

            <div className="max-h-[calc(100vh-220px)] overflow-y-auto">
              {!activeResult ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <Search size={40} className="mb-3 text-gray-300" />
                  <p className="text-sm">Nhập URL và bấm "Bắt đầu nghiên cứu"</p>
                  <p className="text-xs mt-1">Hoặc chọn từ lịch sử bên trái</p>
                </div>
              ) : activeResult.results?.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-12">Không tìm thấy dữ liệu</p>
              ) : source === 'facebook' ? (
                /* Facebook results */
                <div className="divide-y">
                  {activeResult.results.map((post, idx) => (
                    <div key={idx} className="p-4">
                      {/* Header */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 text-xs font-bold">
                            {(post.author || '?')[0]}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-800">{post.author || 'Ẩn danh'}</p>
                            {post.date && (
                              <p className="text-xs text-gray-400">{new Date(post.date).toLocaleString('vi-VN')}</p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          {post.url && (
                            <a href={post.url} target="_blank" rel="noopener noreferrer" className="p-1.5 text-gray-400 hover:text-blue-500 rounded-md hover:bg-blue-50">
                              <ExternalLink size={14} />
                            </a>
                          )}
                          <button
                            onClick={() => copyText(post.text)}
                            className="p-1.5 text-gray-400 hover:text-green-500 rounded-md hover:bg-green-50"
                            title="Copy nội dung"
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Content */}
                      {post.text && (
                        <div
                          className="cursor-pointer"
                          onClick={() => toggleExpand(idx)}
                        >
                          <p className={`text-sm text-gray-700 whitespace-pre-wrap ${!expandedItems[idx] && post.text.length > 200 ? 'line-clamp-3' : ''}`}>
                            {post.text}
                          </p>
                          {post.text.length > 200 && (
                            <button className="text-xs text-blue-500 mt-1">
                              {expandedItems[idx] ? 'Thu gọn' : 'Xem thêm...'}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Media */}
                      {post.media && (
                        <div className="mt-2">
                          <img src={post.media} alt="" className="rounded-lg max-h-48 object-cover" />
                        </div>
                      )}

                      {/* Stats */}
                      <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
                        <span className="flex items-center gap-1">
                          <ThumbsUp size={12} /> {(post.likes || 0).toLocaleString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <MessageCircle size={12} /> {(post.comments || 0).toLocaleString()}
                        </span>
                        <span className="flex items-center gap-1">
                          <Share2 size={12} /> {(post.shares || 0).toLocaleString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                /* Web results */
                <div className="divide-y">
                  {activeResult.results.map((page, idx) => (
                    <div key={idx} className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="text-sm font-medium text-gray-800">{page.title || page.url}</h3>
                          {page.description && (
                            <p className="text-xs text-gray-500 mt-1">{page.description}</p>
                          )}
                          {page.heading && (
                            <p className="text-xs text-blue-600 mt-1 font-medium">{page.heading}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <a href={page.url} target="_blank" rel="noopener noreferrer" className="p-1.5 text-gray-400 hover:text-blue-500 rounded-md hover:bg-blue-50">
                            <ExternalLink size={14} />
                          </a>
                          <button
                            onClick={() => copyText(page.text)}
                            className="p-1.5 text-gray-400 hover:text-green-500 rounded-md hover:bg-green-50"
                            title="Copy nội dung"
                          >
                            <Copy size={14} />
                          </button>
                        </div>
                      </div>

                      {page.text && (
                        <div
                          className="mt-2 cursor-pointer"
                          onClick={() => toggleExpand(idx)}
                        >
                          <p className={`text-xs text-gray-600 whitespace-pre-wrap ${!expandedItems[idx] ? 'line-clamp-4' : ''}`}>
                            {page.text}
                          </p>
                          {page.text.length > 300 && (
                            <button className="text-xs text-blue-500 mt-1">
                              {expandedItems[idx] ? 'Thu gọn' : 'Xem thêm...'}
                            </button>
                          )}
                        </div>
                      )}

                      {page.images?.length > 0 && (
                        <div className="flex gap-2 mt-2 overflow-x-auto">
                          {page.images.slice(0, 4).map((img, i) => (
                            <img key={i} src={img} alt="" className="w-16 h-16 rounded object-cover shrink-0" />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
