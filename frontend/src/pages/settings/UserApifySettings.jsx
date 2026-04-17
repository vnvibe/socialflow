import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Eye, EyeOff, Save, Loader2, Plus, Trash2, ChevronDown, ChevronRight, AlertCircle, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

export default function UserApifySettings() {
  const queryClient = useQueryClient()
  const [keys, setKeys] = useState([])
  const [showKeys, setShowKeys] = useState({})
  const [expandedIdx, setExpandedIdx] = useState(null)

  const { data: userSettings, isLoading } = useQuery({
    queryKey: ['user-settings'],
    queryFn: () => api.get('/user-settings').then(r => r.data)
  })

  useEffect(() => {
    if (userSettings?.apify_config?.keys) {
      setKeys(userSettings.apify_config.keys)
    }
  }, [userSettings])

  const saveMutation = useMutation({
    mutationFn: (apify_config) => api.put('/user-settings', { apify_config }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['user-settings'] })
      toast.success('Đã lưu Apify config')
    },
    onError: () => toast.error('Lưu thất bại')
  })

  const addKey = () => {
    const newIdx = keys.length
    setKeys(prev => [...prev, { key: '', label: '', disabled: false }])
    setExpandedIdx(newIdx)
  }

  const removeKey = (idx) => {
    setKeys(prev => prev.filter((_, i) => i !== idx))
    if (expandedIdx === idx) setExpandedIdx(null)
  }

  const updateKey = (idx, field, value) => {
    setKeys(prev => prev.map((k, i) => i === idx ? { ...k, [field]: value } : k))
  }

  const handleSave = () => {
    const validKeys = keys.filter(k => k.key.trim())
    if (validKeys.length === 0) {
      saveMutation.mutate(null) // Remove user config, fall back to admin
    } else {
      saveMutation.mutate({ keys: validKeys, current_index: 0 })
    }
  }

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-info" /></div>

  const hasOwnKeys = keys.some(k => k.key.trim() && !k.key.endsWith('...'))

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <div>
          <h2 className="text-lg font-semibold text-app-primary">Apify API Key</h2>
          <p className="text-sm text-app-muted mt-1">Thêm API key Apify riêng. Để trống = dùng mặc định hệ thống.</p>
        </div>
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-info text-white px-4 py-2 rounded-lg hover:opacity-90"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save size={18} />}
          Lưu
        </button>
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-200 rounded p-4 mb-6">
        <div className="flex items-start gap-2">
          <Info size={16} className="text-info mt-0.5 shrink-0" />
          <p className="text-sm text-blue-800">
            {hasOwnKeys
              ? 'Bạn đang dùng API key riêng. Hệ thống sẽ ưu tiên key của bạn.'
              : 'Bạn đang dùng API key mặc định của hệ thống. Thêm key riêng nếu muốn tách biệt.'
            }
          </p>
        </div>
      </div>

      <div className="bg-app-surface rounded shadow divide-y">
        {keys.length === 0 && (
          <p className="text-sm text-app-dim text-center py-8">Chưa có API key riêng. Bấm "Thêm key" để thêm.</p>
        )}

        {keys.map((entry, idx) => {
          const isExpanded = expandedIdx === idx
          const keyPreview = entry.key ? entry.key.substring(0, 12) + '...' : 'Chưa nhập'
          return (
            <div key={idx}>
              <div
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-app-base"
                onClick={() => setExpandedIdx(isExpanded ? null : idx)}
              >
                {isExpanded ? <ChevronDown size={16} className="text-app-dim" /> : <ChevronRight size={16} className="text-app-dim" />}
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-medium text-app-primary">{entry.label || `Key ${idx + 1}`}</span>
                  <span className="text-xs text-app-dim font-mono ml-2">{keyPreview}</span>
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); if (confirm('Xoá key này?')) removeKey(idx) }}
                  className="p-1.5 text-app-dim hover:text-red-500 hover:bg-red-50 rounded-md"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 pt-1 space-y-3 border-t border-app-border bg-app-base/50">
                  <div>
                    <label className="block text-xs font-medium text-app-muted mb-1">Tên gợi nhớ</label>
                    <input
                      type="text"
                      value={entry.label}
                      onChange={e => updateKey(idx, 'label', e.target.value)}
                      placeholder={`Account ${idx + 1}`}
                      className="w-full border rounded-md px-2.5 py-1.5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-app-muted mb-1">API Key</label>
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
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-app-dim"
                      >
                        {showKeys[idx] ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}

        <div className="p-4">
          <button
            onClick={addKey}
            className="w-full flex items-center justify-center gap-2 py-2.5 border-2 border-dashed border-app-border rounded-lg text-sm text-app-muted hover:text-info hover:border-blue-300"
          >
            <Plus size={16} /> Thêm key
          </button>
        </div>

        <div className="px-4 py-3">
          <p className="text-xs text-app-dim">
            Lấy API key tại{' '}
            <a href="https://console.apify.com/account/integrations" target="_blank" rel="noopener noreferrer" className="text-info hover:underline">
              Apify Console
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}
