import { useState, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Save, Loader2, CheckCircle, AlertCircle, Plus, Trash2, ChevronDown, ChevronRight, Download, Monitor, Wifi, WifiOff } from 'lucide-react'
import toast from 'react-hot-toast'
import useAuthStore from '../../store/auth.store'
import api from '../../lib/api'
import AISettings from './AISettings'
import ProxyManager from './ProxyManager'
import UserManager from './UserManager'
import FacebookSettings from './FacebookSettings'

const tabs = [
  { key: 'ai', label: 'AI' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'storage', label: 'Lưu trữ (R2)' },
  { key: 'apify', label: 'Apify' },
  { key: 'proxies', label: 'Proxy' },
  { key: 'users', label: 'Người dùng' },
  { key: 'agent', label: 'Agent' },
]

function StorageTab() {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({
    account_id: '',
    access_key_id: '',
    secret_access_key: '',
    bucket: '',
    public_url: ''
  })
  const [showSecret, setShowSecret] = useState(false)

  const { data: settingData, isLoading } = useQuery({
    queryKey: ['system-settings', 'r2_storage'],
    queryFn: () => api.get('/system-settings/r2_storage').then(r => r.data),
  })

  useEffect(() => {
    if (settingData?.value && Object.keys(settingData.value).length > 0) {
      setForm({
        account_id: settingData.value.account_id || '',
        access_key_id: settingData.value.access_key_id || '',
        secret_access_key: settingData.value.secret_access_key || '',
        bucket: settingData.value.bucket || '',
        public_url: settingData.value.public_url || ''
      })
    }
  }, [settingData])

  const saveMutation = useMutation({
    mutationFn: (value) => api.put('/system-settings/r2_storage', { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings', 'r2_storage'] })
      toast.success('R2 config saved')
    },
    onError: () => toast.error('Failed to save R2 config')
  })

  const testMutation = useMutation({
    mutationFn: (value) => api.post('/system-settings/test-r2', { value }),
    onSuccess: (res) => {
      toast.success(res.data.message || 'Kết nối thành công!')
    },
    onError: (err) => {
      toast.error(err.response?.data?.error || 'Lỗi kết nối')
    }
  })

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
  }

  const fields = [
    { key: 'account_id', label: 'Account ID', placeholder: 'Cloudflare Account ID' },
    { key: 'access_key_id', label: 'Access Key ID', placeholder: 'R2 Access Key ID' },
    { key: 'secret_access_key', label: 'Secret Access Key', placeholder: 'R2 Secret Access Key', secret: true },
    { key: 'bucket', label: 'Bucket', placeholder: 'socialflow' },
    { key: 'public_url', label: 'Public URL', placeholder: 'https://pub-xxx.r2.dev' },
  ]

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Cloudflare R2 Storage</h2>
          <p className="text-sm text-gray-500 mt-1">Cấu hình lưu trữ media cho hệ thống</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => testMutation.mutate(form)}
            disabled={testMutation.isPending || saveMutation.isPending}
            className="flex items-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200"
          >
            {testMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle size={18} />}
            Kiểm tra kết nối
          </button>
          <button
            onClick={() => saveMutation.mutate(form)}
            disabled={saveMutation.isPending || testMutation.isPending}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
          >
            {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save size={18} />}
            Lưu
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow p-6 space-y-4">
        {fields.map(field => (
          <div key={field.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
            <div className="relative">
              <input
                type={field.secret && !showSecret ? 'password' : 'text'}
                value={form[field.key]}
                onChange={e => setForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                className="w-full border rounded-lg px-3 py-2 text-sm font-mono pr-10"
              />
              {field.secret && (
                <button
                  onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showSecret ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              )}
            </div>
          </div>
        ))}

        <div className="pt-2 border-t">
          <p className="text-xs text-gray-400">
            Tạo R2 bucket tại{' '}
            <a href="https://dash.cloudflare.com" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
              Cloudflare Dashboard
            </a>
            {' '}→ R2 Object Storage → Create bucket → Manage R2 API Tokens
          </p>
        </div>
      </div>
    </div>
  )
}

function ApifyTab() {
  const queryClient = useQueryClient()
  const [keys, setKeys] = useState([])
  const [showKeys, setShowKeys] = useState({})
  const [expandedIdx, setExpandedIdx] = useState(null)

  const { data: settingData, isLoading } = useQuery({
    queryKey: ['system-settings', 'apify'],
    queryFn: () => api.get('/system-settings/apify').then(r => r.data).catch(() => ({ value: { keys: [], current_index: 0 } })),
  })

  useEffect(() => {
    if (settingData?.value?.keys) {
      setKeys(settingData.value.keys)
    }
  }, [settingData])

  const saveMutation = useMutation({
    mutationFn: (value) => api.put('/system-settings/apify', { value }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['system-settings', 'apify'] })
      toast.success('Đã lưu Apify config!')
    },
    onError: () => toast.error('Không thể lưu Apify config')
  })

  const addKey = () => {
    const newIdx = keys.length
    setKeys(prev => [...prev, { key: '', label: '', disabled: false, last_error: null, disabled_at: null }])
    setExpandedIdx(newIdx)
  }

  const removeKey = (idx) => {
    setKeys(prev => prev.filter((_, i) => i !== idx))
    if (expandedIdx === idx) setExpandedIdx(null)
    else if (expandedIdx > idx) setExpandedIdx(expandedIdx - 1)
  }

  const updateKey = (idx, field, value) => {
    setKeys(prev => prev.map((k, i) => i === idx ? { ...k, [field]: value } : k))
  }

  const toggleKeyDisabled = (idx) => {
    setKeys(prev => prev.map((k, i) => i === idx ? { ...k, disabled: !k.disabled, last_error: null, disabled_at: null } : k))
  }

  const handleSave = () => {
    const validKeys = keys.filter(k => k.key.trim())
    saveMutation.mutate({ keys: validKeys, current_index: settingData?.value?.current_index || 0 })
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>
  }

  const activeCount = keys.filter(k => !k.disabled && k.key.trim()).length

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Apify</h2>
          <p className="text-sm text-gray-500 mt-1">
            Quản lý nhiều API key — tự động xoay khi hết lượt free
            <span className="ml-2 text-xs text-blue-600">({activeCount} key hoạt động)</span>
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save size={18} />}
          Lưu
        </button>
      </div>

      <div className="bg-white rounded-xl shadow divide-y">
        {keys.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">Chưa có API key nào. Bấm "Thêm key" để bắt đầu.</p>
        )}

        {keys.map((entry, idx) => {
          const isExpanded = expandedIdx === idx
          const keyPreview = entry.key ? entry.key.substring(0, 12) + '...' : 'Chưa nhập key'
          return (
            <div key={idx} className={entry.disabled ? 'bg-red-50/50' : ''}>
              {/* Collapsed row */}
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              >
                {isExpanded
                  ? <ChevronDown size={16} className="text-gray-400 shrink-0" />
                  : <ChevronRight size={16} className="text-gray-400 shrink-0" />
                }
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 truncate">
                      {entry.label || `Key ${idx + 1}`}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      entry.disabled ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
                    }`}>
                      {entry.disabled ? 'Tắt' : 'OK'}
                    </span>
                    {entry.last_error && (
                      <AlertCircle size={12} className="text-red-400 shrink-0" />
                    )}
                  </div>
                  <span className="text-xs text-gray-400 font-mono">{keyPreview}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                  <button
                    onClick={() => toggleKeyDisabled(idx)}
                    className={`text-xs px-2 py-1 rounded-md ${entry.disabled ? 'bg-red-100 text-red-600 hover:bg-red-200' : 'bg-green-100 text-green-600 hover:bg-green-200'}`}
                    title={entry.disabled ? 'Bấm để bật lại' : 'Bấm để tắt'}
                  >
                    {entry.disabled ? 'Bật lại' : 'Tắt'}
                  </button>
                  <button
                    onClick={() => { if (confirm('Xoá key này?')) removeKey(idx) }}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md"
                    title="Xoá key"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* Expanded detail */}
              {isExpanded && (
                <div className="px-4 pb-4 pt-1 space-y-3 border-t border-gray-100 bg-gray-50/50">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Tên gợi nhớ</label>
                    <input
                      type="text"
                      value={entry.label}
                      onChange={e => updateKey(idx, 'label', e.target.value)}
                      placeholder={`Account ${idx + 1}`}
                      className="w-full border rounded-md px-2.5 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">API Key</label>
                    <div className="relative">
                      <input
                        type={showKeys[idx] ? 'text' : 'password'}
                        value={entry.key}
                        onChange={e => updateKey(idx, 'key', e.target.value)}
                        placeholder="apify_api_xxxxxxxxxxxxxxxx"
                        className="w-full border rounded-md px-2.5 py-1.5 text-sm font-mono pr-10"
                      />
                      <button
                        onClick={() => setShowKeys(prev => ({ ...prev, [idx]: !prev[idx] }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {showKeys[idx] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                  {entry.last_error && (
                    <div className="flex items-start gap-1.5 text-xs text-red-500 bg-red-50 rounded-md p-2">
                      <AlertCircle size={12} className="mt-0.5 shrink-0" />
                      <div>
                        <span>{entry.last_error}</span>
                        {entry.disabled_at && (
                          <p className="text-gray-400 mt-0.5">
                            Tắt lúc {new Date(entry.disabled_at).toLocaleString()} — tự bật lại sau 24h
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* Add key button */}
        <div className="p-4">
          <button
            onClick={addKey}
            className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-colors"
          >
            <Plus size={16} /> Thêm key
          </button>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 space-y-1">
          <p className="text-xs text-gray-400">
            Lấy API key tại{' '}
            <a href="https://console.apify.com/account/integrations" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline">
              Apify Console
            </a>
            {' '}→ Account → Integrations → API token
          </p>
          <p className="text-xs text-gray-400">
            Hệ thống tự động chuyển sang key tiếp theo khi hết lượt free. Key bị tắt sẽ tự bật lại sau 24h.
          </p>
        </div>
      </div>
    </div>
  )
}

function AgentTab() {
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
                    <span className="text-xs text-gray-400">Không có agent nào đang chạy</span>
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
            Tải agent để chạy trên máy tính hoặc VPS. Agent xử lý tự động: đăng bài, crawl dữ liệu, bình luận qua trình duyệt.
          </p>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-2 bg-gray-100 text-gray-700 px-5 py-3 rounded-lg hover:bg-gray-200 disabled:opacity-50 font-medium border border-gray-200"
            >
              {downloading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download size={20} />}
              {downloading ? 'Đang đóng gói...' : 'Tải ZIP (nhẹ, cần Node.js)'}
            </button>
          </div>

          <div className="border-t pt-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-800">Cách 1: File EXE (khuyên dùng)</h3>
            <div className="text-sm text-gray-600 space-y-2">
              <p>Build exe trên máy admin, gửi cho user:</p>
              <div className="bg-gray-900 text-gray-100 rounded-lg p-3 font-mono text-xs space-y-1">
                <div><span className="text-green-400">$</span> cd socialflow-agent</div>
                <div><span className="text-green-400">$</span> npm run build</div>
                <div className="text-gray-500"># Output: dist/SocialFlow Agent-win32-x64/</div>
              </div>
              <div className="flex gap-2 mt-2">
                <span className="bg-blue-100 text-blue-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                <span>Gửi folder <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">SocialFlow Agent-win32-x64</code> cho user</span>
              </div>
              <div className="flex gap-2">
                <span className="bg-blue-100 text-blue-700 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                <span>User double-click <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">SocialFlow Agent.exe</code> — chạy ngay!</span>
              </div>
              <div className="bg-green-50 border border-green-200 rounded-lg p-3 mt-2">
                <p className="text-xs text-green-700">
                  Credentials nhúng sẵn trong exe. User không cần cài đặt gì — click là chạy. Lần đầu tự tải Chromium.
                </p>
              </div>
            </div>

            <h3 className="text-sm font-semibold text-gray-800 mt-4">Cách 2: File ZIP (nhẹ hơn)</h3>
            <div className="text-sm text-gray-600 space-y-2">
              <div className="flex gap-2">
                <span className="bg-gray-200 text-gray-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">1</span>
                <span>Giải nén file ZIP</span>
              </div>
              <div className="flex gap-2">
                <span className="bg-gray-200 text-gray-600 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold shrink-0">2</span>
                <span>Double-click <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">SocialFlow.bat</code> — tự cài Node.js + dependencies</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function AdminSettings() {
  const isAdmin = useAuthStore((s) => s.profile?.role === 'admin')
  const [activeTab, setActiveTab] = useState('ai')

  if (!isAdmin) return <Navigate to="/dashboard" />

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Cài đặt hệ thống</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {tabs.map(tab => (
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

      {/* Tab content */}
      {activeTab === 'facebook' && <FacebookSettings />}
      {activeTab === 'ai' && <AISettings />}
      {activeTab === 'storage' && <StorageTab />}
      {activeTab === 'apify' && <ApifyTab />}
      {activeTab === 'proxies' && <ProxyManager />}
      {activeTab === 'users' && <UserManager />}
      {activeTab === 'agent' && <AgentTab />}
    </div>
  )
}
