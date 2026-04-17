import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Trash2, Film, Image as ImageIcon, Edit2, Send, CheckCircle, Clock, AlertCircle, Loader2, Minus, RefreshCw, XCircle, Play, Trash, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

// Vietnamese config tables for Badges
const spinBadge = {
  none: { label: 'Không Spin', cls: 'bg-app-elevated text-app-primary border-app-border' },
  basic: { label: 'Spin Cơ bản', cls: 'bg-yellow-100 text-yellow-800 border-yellow-200' },
  ai: { label: 'AI Spin', cls: 'bg-purple-100 text-purple-800 border-purple-200' }
}

const typeBadge = {
  post: { label: 'Bài viết', cls: 'bg-blue-100 text-blue-800 border-blue-200' },
  reel: { label: 'Reel', cls: 'bg-pink-100 text-pink-800 border-pink-200' },
  story: { label: 'Story', cls: 'bg-orange-100 text-orange-800 border-orange-200' }
}

const getStatusBadge = (status) => {
  switch (status) {
    case 'done':
      return { label: 'Đã xong', cls: 'bg-green-100 text-hermes border-green-200', icon: CheckCircle }
    case 'running':
    case 'claimed':
      return { label: 'Đang đăng', cls: 'bg-blue-100 text-info border-blue-200', icon: Loader2 }
    case 'pending':
      return { label: 'Chờ đăng', cls: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: Clock }
    case 'failed':
      return { label: 'Lỗi đăng', cls: 'bg-red-100 text-red-700 border-red-200', icon: AlertCircle }
    default:
      return { label: 'Bản nháp', cls: 'bg-app-elevated text-app-muted border-app-border', icon: Edit2 }
  }
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['content'] }); toast.success('Đã xóa nội dung') },
    onError: () => toast.error('Không thể xóa nội dung này')
  })

  // Job Actions
  const cancelJobMutation = useMutation({
    mutationFn: (jobId) => api.post(`/jobs/${jobId}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content'] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Đã tạm dừng xuất bản')
    },
    onError: () => toast.error('Không thể tạm dừng lúc này')
  })

  const retryJobMutation = useMutation({
    mutationFn: (jobId) => api.post(`/jobs/${jobId}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content'] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Đã xếp lịch đăng lại')
    },
    onError: () => toast.error('Lỗi khi xếp lịch lại')
  })

  const deleteJobMutation = useMutation({
    mutationFn: (jobId) => api.delete(`/jobs/${jobId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content'] })
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Đã xóa lịch đăng mục tiêu này')
    },
    onError: () => toast.error('Không thể xóa lịch đăng này')
  })

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-app-primary">Danh sách nội dung</h1>
          <p className="text-sm text-app-muted mt-1">Quản lý và theo dõi các bài viết đã thiết kế của bạn.</p>
        </div>
        <Link to="/publish" className="flex items-center gap-2 bg-info text-white px-4 py-2.5 rounded hover:opacity-90  font-medium transition-colors">
          <Plus size={18} /> Tạo nội dung mới
        </Link>
      </div>

      {contents.length === 0 ? (
        <div className="text-center py-20 bg-app-surface rounded border border-app-border ">
          <div className="w-16 h-16 bg-blue-50 text-info rounded-full flex items-center justify-center mx-auto mb-4">
            <Edit2 size={32} />
          </div>
          <h3 className="text-lg font-medium text-app-primary mb-1">Chưa có nội dung nào</h3>
          <p className="text-app-muted text-sm mb-4">Hãy tạo một bài đăng tuyệt vời để đăng lên các Trang của bạn.</p>
          <Link to="/content/new" className="text-info font-medium hover:underline text-sm inline-flex items-center gap-1">
            <Plus size={16} /> Bắt đầu ngay
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {contents.map(item => {
            const spin = spinBadge[item.spin_mode] || spinBadge.none
            const ptype = typeBadge[item.post_type] || typeBadge.post
            const statusCfg = getStatusBadge(item.publish_status)
            const StatusIcon = statusCfg.icon
            
            // Deduplicate jobs to show only the latest per target
            const displayJobs = []
            if (item.publish_jobs && item.publish_jobs.length > 0) {
              const seen = new Set()
              item.publish_jobs.forEach(job => {
                const targetId = job.target_name || job.id
                const accountId = job.account_name || 'none'
                const key = `${job.type}-${accountId}-${targetId}`
                if (!seen.has(key)) {
                  seen.add(key)
                  displayJobs.push(job)
                }
              })
            }

            const mediaUrl = item.media?.thumbnail_url || item.media?.url || item.media?.original_path
            const hasMedia = !!mediaUrl

            return (
              <div key={item.id} className="bg-app-surface rounded  border border-app-border overflow-hidden group hover: transition-shadow flex flex-col md:flex-row min-h-[160px]">
                {/* Thumbnail Header (Left side on desktop) */}
                <div
                  className="relative w-full md:w-56 shrink-0 bg-gradient-to-br from-blue-50 to-indigo-50 border-b md:border-b-0 md:border-r border-app-border cursor-pointer overflow-hidden aspect-video md:aspect-auto"
                  onClick={() => navigate(`/content/new?edit=${item.id}`)}
                >
                  {/* Fallback placeholder (also used when image fails) */}
                  <div className={`fallback-icon absolute inset-0 flex flex-col items-center justify-center text-indigo-300 transition-opacity ${hasMedia ? 'hidden' : ''}`}>
                    {item.media?.type === 'video' ? <Film size={40} strokeWidth={1.5} /> : <ImageIcon size={40} strokeWidth={1.5} />}
                  </div>

                  {hasMedia && (
                    <img
                      src={mediaUrl}
                      alt=""
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none'
                        const fallback = e.currentTarget.parentElement?.querySelector('.fallback-icon')
                        if (fallback) fallback.classList.remove('hidden')
                      }}
                    />
                  )}

                  {/* Top Left Badges: Publish Status */}
                  <div className="absolute top-2.5 left-2.5 flex flex-col gap-1.5 items-start">
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border  backdrop-blur-md ${statusCfg.cls}`}>
                      <StatusIcon size={12} className={item.publish_status === 'running' || item.publish_status === 'claimed' ? 'animate-spin' : ''} />
                      {statusCfg.label}
                    </span>
                  </div>

                  {/* Actions Overlay */}
                  <div className="absolute top-2.5 right-2.5 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); navigate(`/content/new?edit=${item.id}`) }}
                      className="p-1.5 rounded-lg bg-app-surface/90 text-app-primary hover:text-info hover:bg-app-surface  transition-colors"
                      title="Chỉnh sửa hoặc Đăng ngay"
                    >
                      <Send size={14} />
                    </button>
                    <button
                      onClick={(e) => { 
                        e.stopPropagation(); 
                        if (confirm('Bạn có chắc chắn muốn xóa bản nháp nội dung này không?')) deleteMutation.mutate(item.id) 
                      }}
                      className="p-1.5 rounded-lg bg-app-surface/90 text-app-primary hover:text-red-600 hover:bg-app-surface  transition-colors"
                      title="Xóa nội dung"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>

                {/* Content Body (Middle) */}
                <div className="p-4 flex-1 flex flex-col border-b md:border-b-0 border-app-border" onClick={() => navigate(`/content/new?edit=${item.id}`)} role="button">
                  <div className="flex gap-1.5 mb-2.5">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${ptype.cls}`}>{ptype.label}</span>
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${spin.cls}`}>{spin.label}</span>
                  </div>

                  <p className="text-sm text-app-primary line-clamp-3 mb-3 flex-1 relative pr-4">
                    {item.caption || <span className="text-app-dim italic font-light">Không có mô tả chi tiết</span>}
                  </p>

                  <div className="flex flex-col sm:flex-row sm:items-end justify-between mt-auto gap-3">
                    {item.hashtags?.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {item.hashtags.slice(0, 5).map((tag, i) => (
                          <span key={i} className="text-[10px] font-medium bg-app-elevated text-app-muted px-1.5 py-0.5 rounded-md hover:bg-blue-50 hover:text-info transition-colors">#{tag}</span>
                        ))}
                        {item.hashtags.length > 5 && <span className="text-[10px] text-app-dim font-medium self-center">+{item.hashtags.length - 5}</span>}
                      </div>
                    )}
                    <span className="text-[10px] text-app-dim font-medium shrink-0 ml-auto">{new Date(item.created_at).toLocaleDateString('vi-VN')}</span>
                  </div>
                </div>
                
                {/* Status Column (Right Side) */}
                <div className="w-full md:w-72 lg:w-80 shrink-0 bg-app-base p-4 border-l border-app-border flex flex-col overflow-y-auto max-h-[220px] md:max-h-[300px]">
                  <h4 className="text-[11px] font-bold text-app-muted uppercase tracking-wider mb-2 flex items-center gap-1 shrink-0">
                    <Send size={12} /> Nơi xuất bản
                  </h4>
                  
                  {displayJobs.length > 0 ? (
                    <div className="flex flex-col gap-2">
                       {displayJobs.map(job => {
                         const isFailed = job.status === 'failed'
                         const isDone = job.status === 'done'
                         const isPending = job.status === 'pending'
                         const isRunning = job.status === 'running' || job.status === 'claimed'
                         const isCancelled = job.status === 'cancelled'
                         
                         return (
                           <div key={job.id} className={`group/job p-2 rounded-lg border text-xs flex flex-col gap-1 transition-colors relative ${
                             isDone ? 'bg-green-50/50 border-green-200 hover:bg-green-50' : 
                             isFailed ? 'bg-red-50/50 border-red-200 hover:bg-red-50 cursor-pointer' : 
                             isPending ? 'bg-yellow-50/50 border-yellow-200 hover:bg-yellow-50' : 
                             isCancelled ? 'bg-app-elevated/80 border-app-border hover:bg-app-elevated' :
                             'bg-blue-50/50 border-blue-200 hover:bg-blue-50'
                           }`}>
                             <div className="flex items-start gap-1.5 pr-14">
                               {isDone && <CheckCircle size={14} className="text-hermes shrink-0 mt-0.5" />}
                               {isFailed && <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />}
                               {isPending && <Clock size={14} className="text-yellow-500 shrink-0 mt-0.5" />}
                               {isRunning && <Loader2 size={14} className="text-info animate-spin shrink-0 mt-0.5" />}
                               {isCancelled && <XCircle size={14} className="text-app-dim shrink-0 mt-0.5" />}
                               
                                 <div className={`font-medium truncate leading-tight mt-[1px] ${isCancelled ? 'text-app-muted line-through' : 'text-app-primary'}`} title={`${job.account_name || 'User'} ➔ ${job.target_name || 'Target'}`}>
                                    {job.type === 'post_profile' ? (
                                      job.account_name || 'Trang cá nhân'
                                    ) : (
                                      <>
                                        {job.type === 'post_page' && <span className="font-semibold text-[10px] bg-blue-100 text-info px-1 py-0.5 rounded-[4px] mr-1.5 align-text-bottom">Fanpage</span>}
                                        {job.type === 'post_page_graph' && <span className="font-semibold text-[10px] bg-green-100 text-hermes px-1 py-0.5 rounded-[4px] mr-1.5 align-text-bottom">API</span>}
                                        {job.type === 'post_group' && <span className="font-semibold text-[10px] bg-purple-100 text-purple-700 px-1 py-0.5 rounded-[4px] mr-1.5 align-text-bottom">Group</span>}
                                        {job.target_name || 'Nơi đăng'}
                                      </>
                                    )}
                                 </div>
                                 {isDone && job.post_url && (
                                   <a href={job.post_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center text-info hover:text-info mt-0.5" title="Xem bài đăng">
                                     <ExternalLink size={12} />
                                   </a>
                                 )}
                                 <div className="text-[10px] text-app-dim mt-[2px] truncate">
                                    Từ: {job.account_name || 'Tài khoản'}
                                 </div>
                             </div>
                             {isFailed && job.error_message && (
                               <div className="text-[11px] text-red-600/90 pl-[22px] line-clamp-2" title={job.error_message}>
                                 Lỗi: {job.error_message}
                               </div>
                             )}
                             {isCancelled && (
                               <div className="text-[11px] text-app-muted pl-[22px]">Đã tạm dừng / Hủy</div>
                             )}

                             {/* Job Actions Hover Bar */}
                             <div className={`absolute top-1 right-1 flex gap-0.5 ${isRunning ? 'opacity-100' : 'opacity-0 group-hover/job:opacity-100'} transition-opacity bg-app-surface/80 backdrop-blur-sm rounded-md  border border-app-border p-0.5 z-10`}>
                               {(isPending || isRunning) && (
                                 <button onClick={(e) => { e.stopPropagation(); cancelJobMutation.mutate(job.id) }} className="p-1 rounded text-app-muted hover:bg-yellow-50 hover:text-yellow-600" title="Tạm dừng/Hủy">
                                   <XCircle size={12} />
                                 </button>
                               )}
                               {(isFailed || isCancelled) && (
                                 <button onClick={(e) => { e.stopPropagation(); retryJobMutation.mutate(job.id) }} className="p-1 rounded text-app-muted hover:bg-blue-50 hover:text-info" title={isCancelled ? "Tiếp tục đăng" : "Thử đăng lại"}>
                                   {isCancelled ? <Play size={12} /> : <RefreshCw size={12} />}
                                 </button>
                               )}
                               {(isFailed || isPending || isCancelled) && (
                                 <button onClick={(e) => { e.stopPropagation(); if(confirm('Bạn có chắc chắn muốn xóa lịch đăng này?')) deleteJobMutation.mutate(job.id) }} className="p-1 rounded text-app-muted hover:bg-red-50 hover:text-red-600" title="Xóa">
                                   <Trash size={12} />
                                 </button>
                               )}
                             </div>
                           </div>
                         )
                       })}
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-center px-4 py-6">
                       <span className="w-8 h-8 rounded-full bg-app-elevated flex items-center justify-center text-app-dim mb-2 mt-auto">
                         <Minus size={16} />
                       </span>
                       <p className="text-xs text-app-muted tracking-tight font-medium mb-auto">Chưa có đánh dấu xuất bản nào</p>
                    </div>
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
