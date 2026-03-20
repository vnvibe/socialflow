import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, RefreshCw, X, Terminal, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

export default function AgentStatus() {
  const [showModal, setShowModal] = useState(false)
  const [downloading, setDownloading] = useState(false)

  const { data, refetch, isRefetching } = useQuery({
    queryKey: ['agent-status'],
    queryFn: () => api.get('/agent/status').then(r => r.data),
    refetchInterval: 15000,
    retry: false,
  })

  const online = data?.online ?? null
  const agentCount = data?.agents?.length || 0

  const handleRecheck = async () => {
    const result = await refetch()
    if (result.data?.online) {
      toast.success('Agent đã kết nối!')
      setShowModal(false)
    } else {
      toast.error('Agent vẫn chưa chạy')
    }
  }

  const handleDownload = async () => {
    setDownloading(true)
    try {
      const res = await api.get('/agent/download', { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'socialflow-agent.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      window.URL.revokeObjectURL(url)
      toast.success('Đang tải agent...')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Không thể tải agent')
    } finally {
      setDownloading(false)
    }
  }

  if (online === null) return null

  return (
    <>
      <button
        onClick={() => !online && setShowModal(true)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          online
            ? 'text-green-700 bg-green-50'
            : 'text-red-700 bg-red-50 hover:bg-red-100 cursor-pointer'
        }`}
      >
        <span className={`w-2 h-2 rounded-full ${online ? 'bg-green-500' : 'bg-red-500 animate-pulse'}`} />
        {online ? `Agent (${agentCount})` : 'Agent offline'}
      </button>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center">
                  <Terminal className="w-4 h-4 text-red-600" />
                </div>
                <h2 className="text-lg font-bold text-gray-900">Agent chưa chạy</h2>
              </div>
              <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <p className="text-sm text-gray-600 mb-5">
              Agent cần chạy trên máy tính để đăng bài, fetch nhóm/trang, kiểm tra tài khoản...
            </p>

            {/* Download button */}
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium mb-4"
            >
              {downloading ? <Loader2 size={18} className="animate-spin" /> : <Download size={18} />}
              {downloading ? 'Đang đóng gói...' : 'Tải Agent về máy'}
            </button>

            {/* Simple steps */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2 mb-4">
              <div className="flex items-center gap-3 text-sm">
                <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                <span className="text-gray-700">Giải nén file ZIP</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                <span className="text-gray-700">Chạy <strong>SocialFlow.bat</strong></span>
              </div>
              <p className="text-xs text-gray-400 pl-8">Lần đầu tự cài đặt. Lỗi tự khởi động lại.</p>
            </div>

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400">Đã chạy agent rồi?</p>
              <button
                onClick={handleRecheck}
                disabled={isRefetching}
                className="flex items-center gap-2 px-4 py-2 text-sm border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50"
              >
                <RefreshCw size={14} className={isRefetching ? 'animate-spin' : ''} />
                {isRefetching ? 'Kiểm tra...' : 'Kiểm tra lại'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
