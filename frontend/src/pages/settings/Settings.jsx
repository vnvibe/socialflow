import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Wifi, WifiOff, Monitor, Download, Loader2, Globe, CheckCircle2, AlertTriangle, Circle } from 'lucide-react'
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

function ExecutorCard({ executor, isPreferred, bothOnline, onSelect, disabled }) {
  const isExtension = executor.platform === 'chrome-extension'
  const Icon = isExtension ? Globe : Monitor
  const label = isExtension ? 'Chrome Extension' : 'Desktop Agent'
  const sublabel = isExtension ? 'Chạy trong trình duyệt' : executor.hostname

  return (
    <div className={`flex items-center gap-4 rounded-xl border-2 px-4 py-3 transition-all ${
      isPreferred
        ? 'border-blue-500 bg-blue-50'
        : 'border-gray-200 bg-gray-50'
    }`}>
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
        isExtension ? 'bg-purple-100' : 'bg-blue-100'
      }`}>
        <Icon size={18} className={isExtension ? 'text-purple-600' : 'text-blue-600'} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-gray-800">{label}</span>
          <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" title="Online" />
        </div>
        <p className="text-xs text-gray-400 truncate">{sublabel}</p>
      </div>
      <span className="text-xs text-gray-400 shrink-0">
        {new Date(executor.last_seen).toLocaleTimeString()}
      </span>
      {bothOnline && (
        <button
          onClick={() => onSelect(isPreferred ? null : executor.agent_id)}
          disabled={disabled}
          className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            isPreferred
              ? 'bg-blue-600 text-white hover:bg-blue-700'
              : 'bg-white border border-gray-300 text-gray-600 hover:border-blue-400 hover:text-blue-600'
          } disabled:opacity-50`}
        >
          {disabled ? (
            <Loader2 size={12} className="animate-spin" />
          ) : isPreferred ? (
            <><CheckCircle2 size={12} /> Đang dùng</>
          ) : (
            <><Circle size={12} /> Chọn</>
          )}
        </button>
      )}
    </div>
  )
}

function UserAgentTab() {
  const [downloading, setDownloading] = useState(false)
  const [settingExecutor, setSettingExecutor] = useState(false)
  const queryClient = useQueryClient()

  const { data: agentStatus, isLoading: statusLoading } = useQuery({
    queryKey: ['agent-status'],
    queryFn: () => api.get('/agent/status').then(r => r.data),
    refetchInterval: 10000,
  })

  const handleSetExecutor = async (executorId) => {
    setSettingExecutor(true)
    try {
      await api.put('/agent/executor', { executorId })
      await queryClient.invalidateQueries({ queryKey: ['agent-status'] })
      toast.success(executorId ? 'Đã chọn executor' : 'Đặt lại tự động')
    } catch {
      toast.error('Không thể lưu cài đặt')
    } finally {
      setSettingExecutor(false)
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
      toast.success('Tải agent thành công!')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Không thể tải agent')
    } finally {
      setDownloading(false)
    }
  }

  const agents = agentStatus?.agents || []
  const preferredId = agentStatus?.preferredExecutorId
  const extensions = agents.filter(a => a.platform === 'chrome-extension')
  const desktopAgents = agents.filter(a => a.platform !== 'chrome-extension')
  const bothOnline = extensions.length > 0 && desktopAgents.length > 0
  const isOnline = agents.length > 0

  // Determine active executor label for header
  let activeLabel = null
  if (isOnline) {
    if (preferredId) {
      const pref = agents.find(a => a.agent_id === preferredId)
      if (pref) activeLabel = pref.platform === 'chrome-extension' ? 'Chrome Extension' : `Agent (${pref.hostname})`
    } else if (extensions.length > 0 && desktopAgents.length === 0) {
      activeLabel = 'Chrome Extension'
    } else if (desktopAgents.length > 0 && extensions.length === 0) {
      activeLabel = `Agent (${desktopAgents[0].hostname})`
    }
  }

  return (
    <div className="space-y-6">
      {/* Status header */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Executor</h2>
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          {statusLoading ? (
            <div className="flex items-center gap-2 text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" /> Đang kiểm tra...
            </div>
          ) : !isOnline ? (
            <div className="flex items-center gap-2 text-red-500">
              <WifiOff size={18} />
              <span className="font-medium text-sm">Không có executor nào đang chạy</span>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-green-600">
                <Wifi size={18} />
                <span className="font-medium text-sm">
                  {activeLabel ? `Đang dùng: ${activeLabel}` : `Online (${agents.length})`}
                </span>
              </div>

              {/* Warning: both online, no preference set */}
              {bothOnline && !preferredId && (
                <div className="flex items-start gap-3 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <AlertTriangle size={16} className="text-yellow-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-yellow-800">Cả hai đang online</p>
                    <p className="text-xs text-yellow-600 mt-0.5">Extension và Agent cùng nhận job. Chọn 1 cái để tránh xung đột.</p>
                  </div>
                </div>
              )}

              {/* Extension list */}
              {extensions.length > 0 && (
                <div className="space-y-2">
                  {extensions.map((a) => (
                    <ExecutorCard
                      key={a.agent_id}
                      executor={a}
                      isPreferred={preferredId === a.agent_id || (!preferredId && !bothOnline)}
                      bothOnline={bothOnline}
                      onSelect={handleSetExecutor}
                      disabled={settingExecutor}
                    />
                  ))}
                </div>
              )}

              {/* Agent list */}
              {desktopAgents.length > 0 && (
                <div className="space-y-2">
                  {desktopAgents.map((a) => (
                    <ExecutorCard
                      key={a.agent_id}
                      executor={a}
                      isPreferred={preferredId === a.agent_id || (!preferredId && !bothOnline)}
                      bothOnline={bothOnline}
                      onSelect={handleSetExecutor}
                      disabled={settingExecutor}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Download Agent */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Tải Desktop Agent</h2>
        <div className="bg-white rounded-xl shadow p-6 space-y-4">
          <p className="text-sm text-gray-600">
            Agent chạy trên máy tính, xử lý tự động: đăng bài, crawl dữ liệu, bình luận qua trình duyệt.
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
