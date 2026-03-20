import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, Check, RefreshCw, X, Terminal } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

export default function AgentStatus() {
  const [showModal, setShowModal] = useState(false)
  const [copied, setCopied] = useState(false)

  const { data, refetch, isRefetching } = useQuery({
    queryKey: ['agent-status'],
    queryFn: () => api.get('/agent/status').then(r => r.data),
    refetchInterval: 15000,
    retry: false,
  })

  const online = data?.online ?? null

  const handleRecheck = async () => {
    const result = await refetch()
    if (result.data?.online) {
      toast.success('Agent đã kết nối!')
      setShowModal(false)
    } else {
      toast.error('Agent vẫn chưa chạy')
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText('cd socialflow-agent && npm start')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
        {online ? 'Agent' : 'Agent offline'}
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

            <p className="text-sm text-gray-600 mb-4">
              Để sử dụng các tính năng tự động (fetch trang/nhóm, đăng bài, kiểm tra tài khoản...), bạn cần khởi động Agent.
            </p>

            <div className="mb-4">
              <p className="text-xs font-medium text-gray-500 mb-2">Mở terminal và chạy lệnh:</p>
              <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-4 py-3">
                <code className="flex-1 text-sm text-green-400 font-mono">cd socialflow-agent && npm start</code>
                <button
                  onClick={handleCopy}
                  className="text-gray-400 hover:text-white transition-colors"
                  title="Sao chép"
                >
                  {copied ? <Check size={16} className="text-green-400" /> : <Copy size={16} />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm border rounded-lg hover:bg-gray-50"
              >
                Đóng
              </button>
              <button
                onClick={handleRecheck}
                disabled={isRefetching}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                <RefreshCw size={14} className={isRefetching ? 'animate-spin' : ''} />
                {isRefetching ? 'Đang kiểm tra...' : 'Kiểm tra lại'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
