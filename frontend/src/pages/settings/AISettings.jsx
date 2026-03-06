import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, CheckCircle, AlertCircle, Loader2, Save, Zap } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const providers = [
  { key: 'openai', name: 'OpenAI', color: 'bg-green-500' },
  { key: 'deepseek', name: 'Deepseek', color: 'bg-blue-500' },
  { key: 'anthropic', name: 'Anthropic', color: 'bg-orange-500' },
  { key: 'gemini', name: 'Gemini', color: 'bg-purple-500' },
  { key: 'groq', name: 'Groq', color: 'bg-red-500' },
  { key: 'kimi', name: 'Kimi', color: 'bg-cyan-500' },
  { key: 'minimax', name: 'MiniMax', color: 'bg-pink-500' }
]

const functions = [
  { key: 'caption_gen', label: 'Caption Generation' },
  { key: 'hashtag_gen', label: 'Hashtag Generation' },
  { key: 'spin_text', label: 'Text Spinning' },
  { key: 'content_analysis', label: 'Content Analysis' },
  { key: 'trend_analysis', label: 'Trend Analysis' }
]

export default function AISettings() {
  const queryClient = useQueryClient()
  const [settings, setSettings] = useState({})
  const [showKeys, setShowKeys] = useState({})
  const [testResults, setTestResults] = useState({})

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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['ai-settings'] }); toast.success('Settings saved') },
    onError: () => toast.error('Failed to save')
  })

  const testMutation = useMutation({
    mutationFn: (provider) => api.post('/ai/test', { provider }),
    onSuccess: (res, provider) => {
      setTestResults(prev => ({ ...prev, [provider]: { success: true, message: res.data.message || 'Connection successful' } }))
      toast.success(`${provider} test passed`)
    },
    onError: (err, provider) => {
      setTestResults(prev => ({ ...prev, [provider]: { success: false, message: err.response?.data?.message || 'Connection failed' } }))
      toast.error(`${provider} test failed`)
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

  const updateDefaultModel = (funcKey, value) => {
    setSettings(prev => ({
      ...prev,
      default_models: {
        ...prev.default_models,
        [funcKey]: value
      }
    }))
  }

  const toggleKeyVisibility = (key) => {
    setShowKeys(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">AI Settings</h1>
        <button
          onClick={() => saveMutation.mutate(settings)}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          <Save size={18} />
          {saveMutation.isPending ? 'Saving...' : 'Save All'}
        </button>
      </div>

      {/* Providers */}
      <div className="space-y-4 mb-8">
        <h2 className="text-lg font-semibold text-gray-900">API Providers</h2>
        {providers.map(provider => {
          const providerSettings = settings.providers?.[provider.key] || {}
          const testResult = testResults[provider.key]
          return (
            <div key={provider.key} className="bg-white rounded-xl shadow p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className={`w-3 h-3 rounded-full ${provider.color}`} />
                  <h3 className="font-semibold text-gray-900">{provider.name}</h3>
                </div>
                <div className="flex items-center gap-3">
                  {/* Enable toggle */}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div className={`relative w-10 h-5 rounded-full transition-colors ${providerSettings.enabled ? 'bg-blue-600' : 'bg-gray-300'}`}>
                      <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${providerSettings.enabled ? 'translate-x-5' : ''}`} />
                    </div>
                    <input
                      type="checkbox"
                      checked={providerSettings.enabled || false}
                      onChange={e => updateProvider(provider.key, 'enabled', e.target.checked)}
                      className="sr-only"
                    />
                    <span className="text-sm text-gray-600">{providerSettings.enabled ? 'Enabled' : 'Disabled'}</span>
                  </label>

                  {/* Test button */}
                  <button
                    onClick={() => testMutation.mutate(provider.key)}
                    disabled={testMutation.isPending}
                    className="flex items-center gap-1 text-sm border rounded-lg px-3 py-1.5 hover:bg-gray-50"
                  >
                    {testMutation.isPending && testMutation.variables === provider.key ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Zap size={14} />
                    )}
                    Test
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showKeys[provider.key] ? 'text' : 'password'}
                    value={providerSettings.api_key || ''}
                    onChange={e => updateProvider(provider.key, 'api_key', e.target.value)}
                    placeholder={`${provider.name} API Key`}
                    className="w-full border rounded-lg px-3 py-2 pr-10 text-sm font-mono"
                  />
                  <button
                    onClick={() => toggleKeyVisibility(provider.key)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showKeys[provider.key] ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Test result */}
              {testResult && (
                <div className={`flex items-center gap-2 mt-2 text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                  {testResult.success ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
                  {testResult.message}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Default Models */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Default Model per Function</h2>
        <div className="bg-white rounded-xl shadow p-4">
          <div className="space-y-4">
            {functions.map(fn => (
              <div key={fn.key} className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700">{fn.label}</label>
                <select
                  value={settings.default_models?.[fn.key] || ''}
                  onChange={e => updateDefaultModel(fn.key, e.target.value)}
                  className="w-64 border rounded-lg px-3 py-2 text-sm"
                >
                  <option value="">Auto (use enabled provider)</option>
                  {providers.filter(p => settings.providers?.[p.key]?.enabled).map(p => (
                    <option key={p.key} value={p.key}>{p.name}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
