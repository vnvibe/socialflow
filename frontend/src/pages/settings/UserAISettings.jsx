import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Save, Loader2, Zap, CheckCircle, AlertCircle, Plus, Trash2, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const providerList = [
  {
    key: 'openai', name: 'OpenAI', color: 'bg-green-500',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    ]
  },
  {
    key: 'deepseek', name: 'DeepSeek', color: 'bg-blue-500',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek V3' },
      { value: 'deepseek-reasoner', label: 'DeepSeek R1' },
    ]
  },
  {
    key: 'anthropic', name: 'Anthropic', color: 'bg-orange-500',
    models: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ]
  },
  {
    key: 'gemini', name: 'Gemini', color: 'bg-purple-500',
    models: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
    ]
  },
  {
    key: 'groq', name: 'Groq', color: 'bg-red-500',
    models: [
      { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B' },
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B' },
    ]
  },
  {
    key: 'fal', name: 'fal.ai (Ảnh)', color: 'bg-yellow-500',
    models: [
      { value: 'fal-ai/flux/schnell', label: 'Flux Schnell' },
      { value: 'fal-ai/flux/dev', label: 'Flux Dev' },
      { value: 'fal-ai/flux-pro/v1.1', label: 'Flux Pro 1.1' },
    ]
  }
]

export default function UserAISettings() {
  const queryClient = useQueryClient()
  const [providers, setProviders] = useState({})
  const [showKeys, setShowKeys] = useState({})
  const [testResults, setTestResults] = useState({})
  const [showAdd, setShowAdd] = useState(false)

  // Get user's own settings
  const { data: userSettings, isLoading: loadingUser } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user-settings').then(r => r.data)
  })

  // Get effective config (merged admin + user)
  const { data: effective } = useQuery({
    queryKey: ['user-settings-effective'],
    queryFn: () => api.get('/user-settings/ai-effective').then(r => r.data)
  })

  useEffect(() => {
    if (userSettings?.ai_providers) {
      setProviders(userSettings.ai_providers)
    }
  }, [userSettings])

  const saveMutation = useMutation({
    mutationFn: (ai_providers) => api.put('/user-settings', { ai_providers }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-settings'] })
      queryClient.invalidateQueries({ queryKey: ['user-settings-effective'] })
      toast.success('Đã lưu cài đặt AI')
    },
    onError: () => toast.error('Lưu thất bại')
  })

  const testMutation = useMutation({
    mutationFn: ({ provider, api_key, model }) => api.post('/user-settings/test-ai', { provider, api_key, model }),
    onSuccess: (res, vars) => {
      setTestResults(prev => ({ ...prev, [vars.provider]: { success: true, message: 'Kết nối thành công!' } }))
      toast.success(`${vars.provider} OK`)
    },
    onError: (err, vars) => {
      setTestResults(prev => ({ ...prev, [vars.provider]: { success: false, message: err.response?.data?.error || 'Thất bại' } }))
      toast.error(`${vars.provider} lỗi`)
    }
  })

  const updateProvider = (key, field, value) => {
    setProviders(prev => ({
      ...prev,
      [key]: { ...prev[key], [field]: value }
    }))
  }

  const removeProvider = (key) => {
    setProviders(prev => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  if (loadingUser) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>

  const configuredKeys = Object.keys(providers)
  const availableToAdd = providerList.filter(p => !configuredKeys.includes(p.key))

  // Build effective display
  const effectiveProviders = effective?.providers || {}

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">API Key AI của bạn</h2>
          <p className="text-sm text-gray-500 mt-1">Thêm API key riêng để ghi đè cài đặt hệ thống. Để trống = dùng mặc định.</p>
        </div>
        <button
          onClick={() => saveMutation.mutate(Object.keys(providers).length > 0 ? providers : null)}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          <Save size={18} />
          {saveMutation.isPending ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>

      {/* System defaults info */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-6">
        <div className="flex items-start gap-2">
          <Info size={16} className="text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-medium text-blue-800">Cài đặt mặc định hệ thống</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {Object.entries(effectiveProviders).map(([key, val]) => {
                const info = providerList.find(p => p.key === key)
                return (
                  <span
                    key={key}
                    className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${
                      val.source === 'user'
                        ? 'bg-green-100 text-green-700 border border-green-300'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${info?.color || 'bg-gray-400'}`} />
                    {info?.name || key}
                    {val.source === 'user' && <span className="font-medium">(của bạn)</span>}
                    {val.source === 'admin' && val.enabled && <CheckCircle size={10} className="text-green-500" />}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      {/* User's own providers */}
      <div className="space-y-4 mb-6">
        {configuredKeys.map(key => {
          const info = providerList.find(p => p.key === key) || { key, name: key, color: 'bg-gray-500', models: [] }
          const ps = providers[key] || {}
          const testResult = testResults[key]

          return (
            <div key={key} className="bg-white rounded-xl shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${info.color}`} />
                  <h3 className="font-semibold text-gray-900">{info.name}</h3>
                  <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full">Key riêng</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      if (!ps.api_key || ps.api_key.endsWith('...')) {
                        toast.error('Nhập API key trước')
                        return
                      }
                      testMutation.mutate({ provider: key, api_key: ps.api_key, model: ps.model })
                    }}
                    disabled={testMutation.isPending && testMutation.variables?.provider === key}
                    className="flex items-center gap-1 text-sm border rounded-lg px-3 py-1.5 hover:bg-gray-50"
                  >
                    {testMutation.isPending && testMutation.variables?.provider === key
                      ? <Loader2 size={14} className="animate-spin" />
                      : <Zap size={14} />
                    }
                    Test
                  </button>
                  <button
                    onClick={() => { if (confirm('Xoá provider này? Sẽ dùng lại mặc định hệ thống.')) removeProvider(key) }}
                    className="text-red-400 hover:text-red-600"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">API Key</label>
                  <div className="relative">
                    <input
                      type={showKeys[key] ? 'text' : 'password'}
                      value={ps.api_key || ''}
                      onChange={e => updateProvider(key, 'api_key', e.target.value)}
                      placeholder={`${info.name} API Key`}
                      className="w-full border rounded-lg px-3 py-2 pr-10 text-sm font-mono"
                    />
                    <button
                      onClick={() => setShowKeys(prev => ({ ...prev, [key]: !prev[key] }))}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showKeys[key] ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Model</label>
                  <select
                    value={ps.model || ''}
                    onChange={e => updateProvider(key, 'model', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">Model mặc định</option>
                    {info.models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>

              {testResult && (
                <div className={`flex items-center gap-2 mt-3 text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                  {testResult.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add provider */}
      {availableToAdd.length > 0 && (
        <div>
          {!showAdd ? (
            <button
              onClick={() => setShowAdd(true)}
              className="flex items-center gap-2 text-sm text-blue-600 hover:text-blue-800 border border-dashed border-blue-300 rounded-lg px-4 py-2 w-full justify-center hover:bg-blue-50"
            >
              <Plus size={16} /> Thêm API key riêng
            </button>
          ) : (
            <div className="bg-white rounded-xl shadow p-4">
              <p className="text-sm font-medium text-gray-700 mb-3">Chọn provider:</p>
              <div className="flex flex-wrap gap-2">
                {availableToAdd.map(p => (
                  <button
                    key={p.key}
                    onClick={() => {
                      setProviders(prev => ({
                        ...prev,
                        [p.key]: { enabled: true, api_key: '', model: '' }
                      }))
                      setShowAdd(false)
                    }}
                    className="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm hover:bg-gray-50"
                  >
                    <div className={`w-2.5 h-2.5 rounded-full ${p.color}`} />
                    {p.name}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowAdd(false)} className="text-xs text-gray-400 mt-2 hover:text-gray-600">Hủy</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
