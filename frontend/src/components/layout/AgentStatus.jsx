import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, RefreshCw, X, Terminal, Loader2, Globe, Monitor, AlertTriangle, CheckCircle2, Circle } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

export default function AgentStatus() {
  const [showModal, setShowModal] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [settingExecutor, setSettingExecutor] = useState(false)
  const queryClient = useQueryClient()

  const { data, refetch, isRefetching } = useQuery({
    queryKey: ['agent-status'],
    queryFn: () => api.get('/agent/status').then(r => r.data),
    refetchInterval: 30000,
    retry: false,
  })

  const online = data?.online ?? null
  const agents = data?.agents || []
  const preferredId = data?.preferredExecutorId
  const extensions = agents.filter(a => a.platform === 'chrome-extension')
  const desktopAgents = agents.filter(a => a.platform !== 'chrome-extension')
  const bothOnline = extensions.length > 0 && desktopAgents.length > 0

  // Status button label + icon
  let StatusIcon = Terminal
  let statusLabel = `Agent (${agents.length})`
  if (online) {
    if (preferredId) {
      const pref = agents.find(a => a.agent_id === preferredId)
      if (pref?.platform === 'chrome-extension') { StatusIcon = Globe; statusLabel = 'Extension' }
      else if (pref) { StatusIcon = Monitor; statusLabel = 'Agent' }
    } else if (extensions.length > 0 && desktopAgents.length === 0) {
      StatusIcon = Globe; statusLabel = 'Extension'
    } else if (desktopAgents.length > 0 && extensions.length === 0) {
      StatusIcon = Monitor; statusLabel = 'Agent'
    } else if (bothOnline) {
      statusLabel = 'Ext + Agent'
    }
  }

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

  const handleRecheck = async () => {
    const result = await refetch()
    if (result.data?.online) {
      toast.success('Đã kết nối!')
    } else {
      toast.error('Vẫn chưa có executor nào chạy')
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
      {/* Status button */}
      <button
        onClick={() => setShowModal(true)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
          online
            ? bothOnline && !preferredId
              ? 'text-yellow-700 bg-yellow-50 hover:bg-yellow-100'
              : 'text-hermes bg-green-50 hover:bg-green-100'
            : 'text-red-700 bg-red-50 hover:bg-red-100'
        }`}
      >
        {online
          ? bothOnline && !preferredId
            ? <AlertTriangle size={13} className="text-yellow-500" />
            : <span className="w-2 h-2 rounded-full bg-hermes" />
          : <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
        }
        {online && <StatusIcon size={12} />}
        {online ? statusLabel : 'Offline'}
      </button>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowModal(false)}>
          <div className="bg-app-surface rounded p-6 w-full max-w-md " onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${online ? 'bg-green-100' : 'bg-red-100'}`}>
                  <Terminal className={`w-4 h-4 ${online ? 'text-hermes' : 'text-red-600'}`} />
                </div>
                <h2 className="text-lg font-bold text-app-primary">
                  {online ? 'Executor đang chạy' : 'Chưa có executor'}
                </h2>
              </div>
              <button onClick={() => setShowModal(false)} className="text-app-dim hover:text-app-muted">
                <X size={20} />
              </button>
            </div>

            {online ? (
              /* ── ONLINE: show executors ── */
              <div className="space-y-4">
                {/* Warning khi cả 2 online */}
                {bothOnline && !preferredId && (
                  <div className="flex items-start gap-2.5 bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                    <AlertTriangle size={15} className="text-yellow-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-yellow-800">Cả hai đang online</p>
                      <p className="text-xs text-yellow-600 mt-0.5">Chọn 1 cái để tránh xung đột nhận job.</p>
                    </div>
                  </div>
                )}

                {/* Extension list */}
                {extensions.map(a => {
                  const isActive = preferredId === a.agent_id || (!preferredId && !bothOnline)
                  return (
                    <div key={a.agent_id} className={`flex items-center gap-3 rounded border-2 px-4 py-3 ${isActive && !bothOnline ? 'border-green-300 bg-green-50' : preferredId === a.agent_id ? 'border-blue-400 bg-blue-50' : 'border-app-border bg-app-base'}`}>
                      <div className="w-9 h-9 rounded-lg bg-purple-100 flex items-center justify-center shrink-0">
                        <Globe size={18} className="text-purple-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-app-primary">Chrome Extension</p>
                        <p className="text-xs text-app-dim">Chạy trong trình duyệt</p>
                      </div>
                      <span className="w-2 h-2 rounded-full bg-hermes shrink-0" />
                      {bothOnline && (
                        <button
                          onClick={() => handleSetExecutor(preferredId === a.agent_id ? null : a.agent_id)}
                          disabled={settingExecutor}
                          className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                            preferredId === a.agent_id
                              ? 'bg-info text-white hover:opacity-90'
                              : 'bg-app-surface border border-app-border text-app-muted hover:border-blue-400 hover:text-blue-600'
                          }`}
                        >
                          {settingExecutor ? <Loader2 size={11} className="animate-spin" /> : preferredId === a.agent_id ? <><CheckCircle2 size={11} /> Đang dùng</> : <><Circle size={11} /> Chọn</>}
                        </button>
                      )}
                    </div>
                  )
                })}

                {/* Desktop Agent list */}
                {desktopAgents.map(a => {
                  const isActive = preferredId === a.agent_id || (!preferredId && !bothOnline)
                  return (
                    <div key={a.agent_id} className={`flex items-center gap-3 rounded border-2 px-4 py-3 ${isActive && !bothOnline ? 'border-green-300 bg-green-50' : preferredId === a.agent_id ? 'border-blue-400 bg-blue-50' : 'border-app-border bg-app-base'}`}>
                      <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                        <Monitor size={18} className="text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-app-primary">Desktop Agent</p>
                        <p className="text-xs text-app-dim truncate">{a.hostname}</p>
                      </div>
                      <span className="w-2 h-2 rounded-full bg-hermes shrink-0" />
                      {bothOnline && (
                        <button
                          onClick={() => handleSetExecutor(preferredId === a.agent_id ? null : a.agent_id)}
                          disabled={settingExecutor}
                          className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 ${
                            preferredId === a.agent_id
                              ? 'bg-info text-white hover:opacity-90'
                              : 'bg-app-surface border border-app-border text-app-muted hover:border-blue-400 hover:text-blue-600'
                          }`}
                        >
                          {settingExecutor ? <Loader2 size={11} className="animate-spin" /> : preferredId === a.agent_id ? <><CheckCircle2 size={11} /> Đang dùng</> : <><Circle size={11} /> Chọn</>}
                        </button>
                      )}
                    </div>
                  )
                })}

                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-app-dim">Cập nhật mỗi 15s</p>
                  <button
                    onClick={handleRecheck}
                    disabled={isRefetching}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-app-border text-app-muted rounded-lg hover:bg-app-base disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={isRefetching ? 'animate-spin' : ''} />
                    {isRefetching ? 'Đang kiểm tra...' : 'Làm mới'}
                  </button>
                </div>
              </div>
            ) : (
              /* ── OFFLINE: setup guide ── */
              <div className="space-y-4">
                <p className="text-sm text-app-muted">
                  Cần có executor để đăng bài, fetch dữ liệu, kiểm tra tài khoản...
                </p>
                <p className="text-sm font-medium text-app-primary">Tuỳ chọn:</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-3 bg-purple-50 border border-purple-200 rounded-lg px-4 py-3">
                    <Globe size={18} className="text-purple-500 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-app-primary">Chrome Extension</p>
                      <p className="text-xs text-app-muted">Cài addon vào trình duyệt, đăng nhập SocialFlow</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                    <Monitor size={18} className="text-blue-500 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold text-app-primary">Desktop Agent</p>
                      <p className="text-xs text-app-muted">Tải file ZIP, chạy SocialFlow.bat</p>
                    </div>
                  </div>
                </div>
                <button
                  onClick={handleDownload}
                  disabled={downloading}
                  className="w-full flex items-center justify-center gap-2 bg-info text-white px-4 py-2.5 rounded-lg hover:opacity-90 disabled:opacity-50 text-sm font-medium"
                >
                  {downloading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  {downloading ? 'Đang đóng gói...' : 'Tải Desktop Agent'}
                </button>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-app-dim">Đã chạy rồi?</p>
                  <button
                    onClick={handleRecheck}
                    disabled={isRefetching}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50"
                  >
                    <RefreshCw size={12} className={isRefetching ? 'animate-spin' : ''} />
                    {isRefetching ? 'Kiểm tra...' : 'Kiểm tra lại'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}
