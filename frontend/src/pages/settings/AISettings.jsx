import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, CheckCircle, AlertCircle, Loader2, Save, Zap, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const providerList = [
  {
    key: 'openai', name: 'OpenAI', color: 'bg-hermes',
    models: [
      { value: 'gpt-4o', label: 'GPT-4o (mới nhất)' },
      { value: 'gpt-4o-mini', label: 'GPT-4o Mini (rẻ, nhanh)' },
      { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
      { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo (rẻ nhất)' },
    ]
  },
  {
    key: 'deepseek', name: 'DeepSeek', color: 'bg-info',
    models: [
      { value: 'deepseek-chat', label: 'DeepSeek V3 (deepseek-chat)' },
      { value: 'deepseek-reasoner', label: 'DeepSeek R1 (reasoning)' },
    ]
  },
  {
    key: 'anthropic', name: 'Anthropic', color: 'bg-orange-500',
    models: [
      { value: 'claude-sonnet-4-20250514', label: 'Claude Sonnet 4' },
      { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (rẻ, nhanh)' },
    ]
  },
  {
    key: 'gemini', name: 'Gemini', color: 'bg-purple-500',
    models: [
      { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (mới nhất)' },
      { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
      { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
    ]
  },
  {
    key: 'groq', name: 'Groq', color: 'bg-red-500',
    models: [
      { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B (mạnh)' },
      { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B' },
      { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B (nhanh nhất)' },
    ]
  },
  {
    key: 'kimi', name: 'Kimi', color: 'bg-cyan-500',
    models: [
      { value: 'moonshot-v1-8k', label: 'Moonshot V1 8K' },
      { value: 'moonshot-v1-32k', label: 'Moonshot V1 32K' },
      { value: 'moonshot-v1-128k', label: 'Moonshot V1 128K (long context)' },
    ]
  },
  {
    key: 'minimax', name: 'MiniMax', color: 'bg-pink-500',
    models: [
      { value: 'abab6.5-chat', label: 'ABAB 6.5 Chat' },
      { value: 'abab5.5-chat', label: 'ABAB 5.5 Chat' },
    ]
  },
  {
    key: 'fal', name: 'fal.ai (Image)', color: 'bg-yellow-500',
    models: [
      { value: 'fal-ai/flux/schnell', label: 'Flux Schnell (nhanh)' },
      { value: 'fal-ai/flux/dev', label: 'Flux Dev' },
      { value: 'fal-ai/flux-pro/v1.1', label: 'Flux Pro 1.1' },
      { value: 'fal-ai/flux.2/dev', label: 'Flux 2 Dev (mới)' },
      { value: 'fal-ai/nano-banana-2', label: 'Nano 2 (siêu nhanh)' },
      { value: 'fal-ai/nano-banana-pro', label: 'Nano Pro (Gemini)' },
      { value: 'fal-ai/recraft-v3', label: 'Recraft V3' },
      { value: 'fal-ai/recraft-v4', label: 'Recraft V4 (mới)' },
      { value: 'fal-ai/ideogram/v3', label: 'Ideogram V3' },
      { value: 'fal-ai/qwen-image-max', label: 'Qwen Image Max' },
    ]
  }
]

const functions = [
  { key: 'caption_gen', label: 'Tạo caption' },
  { key: 'hashtag_gen', label: 'Tạo hashtag' },
  { key: 'spin_text', label: 'Spin text' },
  { key: 'content_analysis', label: 'Phân tích nội dung' },
  { key: 'trend_analysis', label: 'Phân tích xu hướng' },
  { key: 'relevance_review', label: 'AI Review (Feed scan)' },
  { key: 'content_ideas', label: 'Gợi ý ý tưởng' },
  { key: 'image_gen', label: 'Tạo ảnh AI' },
]

export default function AISettings() {
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState({})
  const [showKeys, setShowKeys] = useState({})
  const [testResults, setTestResults] = useState({})
  const [showAddProvider, setShowAddProvider] = useState(false)

  const { data: savedSettings, isLoading } = useQuery({
    queryKey: ['ai-settings'],
    queryFn: () => api.get('/ai/settings').then(r => r.data)
  })

  useEffect(() => {
    if (savedSettings) {
      setSettings(savedSettings)
    }
  }, [savedSettings])

  const saveMutation = useMutation({
    mutationFn: (data) => api.put('/ai/settings', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ai-settings'] }); toast.success('Đã lưu') },
    onError: () => toast.error('Lưu thất bại')
  })

  const testMutation = useMutation({
    mutationFn: ({ provider, api_key, model }) => api.post('/ai/test', { provider, api_key, model }),
    onSuccess: (res, vars) => {
      setTestResults(prev => ({ ...prev, [vars.provider]: { success: true, message: res.data.response || 'Kết nối thành công' } }))
      toast.success(`${vars.provider} OK`)
    },
    onError: (err, vars) => {
      setTestResults(prev => ({ ...prev, [vars.provider]: { success: false, message: err.response?.data?.error || 'Kết nối thất bại' } }))
      toast.error(`${vars.provider} thất bại`)
    }
  })

  const updateProvider = (providerKey, field, value) => {
    setSettings(prev => ({
      ...prev,
      providers: {
        ...prev.providers,
        [providerKey]: {
          ...prev.providers?.[providerKey],
          [field]: value
        }
      }
    }))
  }

  const removeProvider = (providerKey) => {
    setSettings(prev => {
      const newProviders = { ...prev.providers }
      delete newProviders[providerKey]
      return { ...prev, providers: newProviders }
    })
  }

  const updateDefault = (funcKey, field, value) => {
    setSettings(prev => ({
      ...prev,
      defaults: {
        ...prev.defaults,
        [funcKey]: {
          ...prev.defaults?.[funcKey],
          [field]: value
        }
      }
    }))
  }

  const toggleKeyVisibility = (key) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // Get list of enabled/configured providers
  const configuredProviderKeys = Object.keys(settings.providers || {})
  const availableToAdd = providerList.filter(p => !configuredProviderKeys.includes(p.key))

  const handleTestProvider = (providerKey) => {
    const ps = settings.providers?.[providerKey]
    if (!ps?.api_key || ps.api_key.endsWith('...')) {
      toast.error('Nhập API key trước khi test')
      return
    }
    testMutation.mutate({
      provider: providerKey,
      api_key: ps.api_key,
      model: ps.model
    })
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-info" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-lg font-semibold text-app-primary">AI Providers</h2>
        <button
          onClick={() => saveMutation.mutate(settings)}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-info text-white px-4 py-2 rounded-lg hover:opacity-90"
        >
          <Save size={18} />
          {saveMutation.isPending ? 'Đang lưu...' : 'Lưu tất cả'}
        </button>
      </div>

      {/* Configured Providers */}
      <div className="space-y-4 mb-6">
        {configuredProviderKeys.map(key => {
          const info = providerList.find(p => p.key === key) || { key, name: key, color: 'bg-app-muted', models: [] }
          const ps = settings.providers?.[key] || {}
          const testResult = testResults[key]

          return (
            <div key={key} className="bg-app-surface rounded shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${info.color}`} />
                  <h3 className="font-semibold text-app-primary">{info.name}</h3>
                  {ps.enabled && <span className="text-xs bg-green-100 text-hermes px-2 py-0.5 rounded-full">Active</span>}
                </div>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div className={`relative w-10 h-5 rounded-full transition-colors ${ps.enabled ? 'bg-info' : 'bg-app-hover'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-app-surface rounded-full shadow transition-transform ${ps.enabled ? 'translate-x-5' : ''}`} />
                    </div>
                    <input type="checkbox" checked={ps.enabled || false} onChange={e => updateProvider(key, 'enabled', e.target.checked)} className="sr-only" />
                  </label>
                  <button
                    onClick={() => handleTestProvider(key)}
                    disabled={testMutation.isPending && testMutation.variables?.provider === key}
                    className="flex items-center gap-1 text-sm border rounded-lg px-3 py-1.5 hover:bg-app-base"
                  >
                    {testMutation.isPending && testMutation.variables?.provider === key ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                    Test
                  </button>
                  <button onClick={() => removeProvider(key)} className="text-red-400 hover:text-red-600" title="Xóa provider">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {/* API Key */}
                <div>
                  <label className="block text-xs text-app-muted mb-1">API Key</label>
                  <div className="relative">
                    <input
                      type={showKeys[key] ? 'text' : 'password'}
                      value={ps.api_key || ''}
                      onChange={e => updateProvider(key, 'api_key', e.target.value)}
                      placeholder={`${info.name} API Key`}
                      className="w-full border rounded-lg px-3 py-2 pr-10 text-sm font-mono"
                    />
                    <button onClick={() => toggleKeyVisibility(key)} className="absolute right-2 top-1/2 -translate-y-1/2 text-app-dim hover:text-app-muted">
                      {showKeys[key] ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {/* Model Select */}
                <div>
                  <label className="block text-xs text-app-muted mb-1">Model mặc định</label>
                  <select
                    value={ps.model || ''}
                    onChange={e => updateProvider(key, 'model', e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                  >
                    <option value="">-- Chọn model --</option>
                    {info.models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                </div>
              </div>

              {testResult && (
                <div className={`flex items-center gap-2 mt-3 text-sm ${testResult.success ? 'text-hermes' : 'text-red-600'}`}>
                  {testResult.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  <span className="truncate">{testResult.message}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add Provider */}
      {availableToAdd.length > 0 && (
        <div className="mb-8">
          {!showAddProvider ? (
            <button onClick={() => setShowAddProvider(true)} className="flex items-center gap-2 text-sm text-info hover:text-blue-800 border border-dashed border-blue-300 rounded-lg px-4 py-2 w-full justify-center hover:bg-blue-50">
              <Plus size={16} /> Thêm provider
            </button>
          ) : (
            <div className="bg-app-surface rounded shadow p-4">
              <p className="text-sm font-medium text-app-primary mb-3">Chọn provider để thêm:</p>
              <div className="flex flex-wrap gap-2">
                {availableToAdd.map(p => (
                  <button
                    key={p.key}
                    onClick={() => {
                      setSettings(prev => ({
                        ...prev,
                        providers: {
                          ...prev.providers,
                          [p.key]: { enabled: true, api_key: '', model: '' }
                        }
                      }))
                      setShowAddProvider(false)
                    }}
                    className="flex items-center gap-2 border rounded-lg px-3 py-2 text-sm hover:bg-app-base"
                  >
                    <div className={`w-2.5 h-2.5 rounded-full ${p.color}`} />
                    {p.name}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowAddProvider(false)} className="text-xs text-app-dim mt-2 hover:text-app-muted">Hủy</button>
            </div>
          )}
        </div>
      )}

      {/* Default per Function */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-app-primary">Model mặc định theo chức năng</h2>
        <p className="text-sm text-app-muted">Chọn provider + model riêng cho từng chức năng. Để trống sẽ dùng provider đầu tiên đang bật.</p>
        <div className="bg-app-surface rounded shadow p-4">
          <div className="space-y-4">
            {functions.map(fn => {
              const fnDefault = settings.defaults?.[fn.key] || {}
              const selectedProvider = providerList.find(p => p.key === fnDefault.provider)

              return (
                <div key={fn.key} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                  <label className="text-sm font-medium text-app-primary sm:w-48 shrink-0">{fn.label}</label>
                  <div className="flex gap-2 flex-1">
                    <select
                      value={fnDefault.provider || ''}
                      onChange={e => updateDefault(fn.key, 'provider', e.target.value)}
                      className="border rounded-lg px-3 py-2 text-sm flex-1"
                    >
                      <option value="">Auto</option>
                      {configuredProviderKeys
                        .filter(k => settings.providers?.[k]?.enabled)
                        .map(k => {
                          const info = providerList.find(p => p.key === k)
                          return <option key={k} value={k}>{info?.name || k}</option>
                        })}
                    </select>
                    <select
                      value={fnDefault.model || ''}
                      onChange={e => updateDefault(fn.key, 'model', e.target.value)}
                      className="border rounded-lg px-3 py-2 text-sm flex-1"
                      disabled={!fnDefault.provider}
                    >
                      <option value="">Model mặc định</option>
                      {selectedProvider?.models.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                    </select>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
