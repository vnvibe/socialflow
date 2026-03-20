import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Wifi, WifiOff, Monitor, Download, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import useAuthStore from '../../store/auth.store'
import AdminSettings from './AdminSettings'
import UserAISettings from './UserAISettings'
import UserApifySettings from './UserApifySettings'
import FacebookSettings from './FacebookSettings'
import ProxyManager from './ProxyManager'
import api from '../../lib/api'

// User tabs
const userTabs = [
  { key: 'ai', label: 'AI' },
  { key: 'facebook', label: 'Facebook API' },
  { key: 'apify', label: 'Apify' },
  { key: 'proxies', label: 'Proxy' },
  { key: 'agent', label: 'Agent' },
]

export default function Settings() {
  const profile = useAuthStore((s) => s.profile)
  const isAdmin = profile?.role === 'admin'

  if (isAdmin) {
    return <AdminSettings />
  }

  return <UserSettings />
}

function UserSettings() {
  const [activeTab, setActiveTab] = useState('ai')

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Cài đặt</h1>
      <p className="text-sm text-gray-500 mb-6">
        Cấu hình API key riêng cho tài khoản của bạn. Để trống sẽ dùng cài đặt mặc định của hệ thống.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {userTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'ai' && <UserAISettings />}
      {activeTab === 'facebook' && <FacebookSettings />}
      {activeTab === 'apify' && <UserApifySettings />}
      {activeTab === 'proxies' && <ProxyManager />}
      {activeTab === 'agent' && <UserAgentTab />}
    </div>
  )
}

function UserAgentTab() {
  const [downloading, setDownloading] = useState(false)

  const { data: agentStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['agent-status'],
    queryFn: () => api.get('/agent/status').then(r => r.data),
    refetchInterval: 10000,
  })

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
      toast.success('Tải agent thành công!')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Không thể tải agent')
    } finally {
      setDownloading(false)
    }
  }

  const isOnline = agentStatus?.online
  const agents = agentStatus?.agents || []

  return (
    <div className="space-y-6">
      {/* Agent Status */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Trạng thái Agent</h2>
        <div className="bg-white rounded-xl shadow p-6">
          {statusLoading ? (
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Đang kiểm tra...
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                {isOnline ? (
                  <div className="flex items-center gap-2 text-green-600">
                    <Wifi size={20} />
                    <span className="font-medium">Online</span>
                    <span className="text-xs text-gray-400">({agents.length} agent)</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-red-500">
                    <WifiOff size={20} />
                    <span className="font-medium">Offline</span>
                    <span className="text-xs text-gray-400">Chưa có agent nào đang chạy</span>
                  </div>
                )}
              </div>
              {agents.length > 0 && (
                <div className="space-y-2">
                  {agents.map((a, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm bg-gray-50 rounded-lg px-4 py-2">
                      <Monitor size={16} className="text-gray-400" />
                      <span className="font-mono text-gray-700">{a.agent_id}</span>
                      {a.hostname && <span className="text-gray-400">({a.hostname})</span>}
                      <span className="text-xs text-gray-400 ml-auto">
                        {new Date(a.last_seen).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Download Agent */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Tải Agent</h2>
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <p className="text-sm text-gray-600">
            Agent chạy trên máy tính của bạn, xử lý tự động: đăng bài, crawl dữ liệu, bình luận qua trình duyệt.
          </p>

          <button
            onClick={handleDownload}
            disabled={downloading}
            className="flex items-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium text-base"
          >
            {downloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download size={20} />}
            {downloading ? 'Đang đóng gói...' : 'Tải Agent'}
          </button>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
            <div className="flex items-start gap-3">
              <span className="bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">1</span>
              <span className="text-sm text-gray-700">Giải nén file ZIP</span>
            </div>
            <div className="flex items-start gap-3">
              <span className="bg-blue-600 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">2</span>
              <span className="text-sm text-gray-700">Mở thư mục, chạy <strong>SocialFlow.bat</strong></span>
            </div>
            <p className="text-xs text-blue-600 mt-2 pl-9">Lần đầu sẽ tự cài đặt (2-3 phút). Sau đó mở lại là chạy ngay.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
