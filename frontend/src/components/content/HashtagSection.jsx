import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Hash, Bookmark, Trash2, FolderOpen, X, Loader, Sparkles } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

/**
 * HashtagSection — Hashtag input + AI generate + Hashtag Library (DB-backed)
 *
 * Props:
 *   value: string (comma-separated hashtags)
 *   onChange: (value: string) => void
 *   onAiGenerate: () => void
 *   isGenerating: boolean
 *   compact: boolean (optional, smaller UI for sidebar)
 */
export default function HashtagSection({ value, onChange, onAiGenerate, isGenerating, compact, aiSuggestions = [], onClearAiSuggestions }) {
  const [showLibrary, setShowLibrary] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [showSaveForm, setShowSaveForm] = useState(false)
  const queryClient = useQueryClient()

  // Fetch presets from database
  const { data: library = [], isLoading: isLoadingLibrary } = useQuery({
    queryKey: ['hashtag-presets'],
    queryFn: () => api.get('/ai/hashtag-presets').then(r => r.data),
    staleTime: 60_000, // 1 min
  })

  // Save preset mutation
  const saveMutation = useMutation({
    mutationFn: (preset) => api.post('/ai/hashtag-presets', preset).then(r => r.data),
    onSuccess: (newPreset) => {
      queryClient.invalidateQueries({ queryKey: ['hashtag-presets'] })
      setPresetName('')
      setShowSaveForm(false)
      toast.success(`Đã lưu bộ hashtag "${newPreset.name}"`)
    },
    onError: () => toast.error('Không thể lưu hashtag'),
  })

  // Delete preset mutation
  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/ai/hashtag-presets/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hashtag-presets'] })
      toast.success('Đã xóa')
    },
    onError: () => toast.error('Không thể xóa'),
  })

  const currentTags = value.split(/[,\s]+/).filter(Boolean).map(t => t.replace(/^#/, ''))

  const handleSavePreset = () => {
    if (!presetName.trim() || currentTags.length === 0) return
    saveMutation.mutate({ name: presetName.trim(), tags: currentTags })
  }

  const handleApplyPreset = (preset) => {
    const existing = new Set(currentTags.map(t => t.toLowerCase()))
    const newTags = preset.tags.filter(t => !existing.has(t.toLowerCase()))
    const merged = [...currentTags, ...newTags]
    onChange(merged.join(', '))
    toast.success(`Áp dụng "${preset.name}" (+${newTags.length} mới)`)
  }

  const handleReplacePreset = (preset) => {
    onChange(preset.tags.join(', '))
    toast.success(`Đã thay bằng "${preset.name}"`)
  }

  const handleDeletePreset = (id) => {
    deleteMutation.mutate(id)
  }

  const handleRemoveTag = (idx) => {
    const updated = currentTags.filter((_, i) => i !== idx)
    onChange(updated.join(', '))
  }

  return (
    <div className="bg-white rounded-xl shadow p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className={`font-semibold text-gray-900 ${compact ? 'text-sm' : ''}`}>Hashtag</h3>
        <div className="flex items-center gap-1.5">
          {/* Library toggle */}
          <button
            onClick={() => setShowLibrary(!showLibrary)}
            className={`flex items-center gap-1 text-${compact ? 'xs' : 'sm'} px-${compact ? '2' : '3'} py-1 rounded-lg transition-colors ${
              showLibrary ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-600 hover:bg-amber-100'
            }`}
          >
            <FolderOpen size={compact ? 11 : 13} />
            {compact ? '' : 'Đã lưu'}
            {library.length > 0 && (
              <span className={`text-[10px] px-1 rounded-full ${showLibrary ? 'bg-white/20' : 'bg-amber-200'}`}>
                {library.length}
              </span>
            )}
          </button>

          {/* Save current tags */}
          {currentTags.length > 0 && (
            <button
              onClick={() => setShowSaveForm(!showSaveForm)}
              className={`flex items-center gap-1 text-${compact ? 'xs' : 'sm'} px-${compact ? '2' : '3'} py-1 rounded-lg transition-colors ${
                showSaveForm ? 'bg-green-600 text-white' : 'bg-green-50 text-green-600 hover:bg-green-100'
              }`}
              title="Lưu bộ hashtag hiện tại"
            >
              <Bookmark size={compact ? 11 : 13} />
              Lưu
            </button>
          )}

          {/* AI generate */}
          <button
            onClick={onAiGenerate}
            disabled={isGenerating}
            className={`flex items-center gap-1 text-${compact ? 'xs' : 'sm'} bg-purple-50 text-purple-600 px-${compact ? '2' : '3'} py-1 rounded-lg hover:bg-purple-100 disabled:opacity-50`}
          >
            <Hash size={compact ? 12 : 14} />
            {isGenerating ? 'Đang tạo...' : 'AI gợi ý'}
          </button>
        </div>
      </div>

      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Nhập hashtag, cách nhau bằng dấu phẩy. VD: banhmi, saigon, amthuc"
        className="w-full border rounded-lg px-3 py-2 text-sm"
      />
      <p className="text-xs text-gray-400 mt-1">Không cần nhập dấu #, hệ thống tự thêm</p>

      {/* Current tags preview — click to remove */}
      {currentTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {currentTags.map((tag, i) => (
            <span
              key={i}
              className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full cursor-pointer hover:bg-red-50 hover:text-red-500 hover:line-through transition-colors"
              onClick={() => handleRemoveTag(i)}
              title="Click để xóa"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* AI Suggestions */}
      {aiSuggestions.length > 0 && (
        <div className="mt-3 p-3 bg-purple-50 rounded-lg border border-purple-100">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-purple-700 flex items-center gap-1">
              <Sparkles size={12} className="inline" /> AI Đề xuất (click để thêm)
            </span>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => {
                  const existing = new Set(currentTags.map(t => t.toLowerCase()))
                  const newTags = aiSuggestions.filter(t => !existing.has(t.toLowerCase()))
                  if (newTags.length > 0) {
                    onChange([...currentTags, ...newTags].join(', '))
                  }
                  onClearAiSuggestions?.()
                }}
                className="text-[10px] px-2 py-0.5 rounded bg-purple-200 text-purple-700 hover:bg-purple-300 font-medium"
              >
                Thêm tất cả
              </button>
              <button onClick={onClearAiSuggestions} className="text-purple-400 hover:text-purple-600">
                <X size={14} />
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {aiSuggestions.map((tag, i) => {
              const cleanTag = tag.replace(/^#/, '').trim()
              const isActive = currentTags.some(t => t.toLowerCase() === cleanTag.toLowerCase())
              if (isActive) return null
              return (
                <button
                  key={i}
                  onClick={() => {
                    const newTags = [...currentTags, cleanTag]
                    onChange(newTags.join(', '))
                  }}
                  className="text-xs px-2 py-0.5 rounded-full border bg-white text-purple-600 border-purple-200 hover:bg-purple-100 transition-colors"
                >
                  +{cleanTag}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Save preset form */}
      {showSaveForm && (
        <div className="mt-3 flex items-center gap-2 p-2.5 bg-green-50 rounded-lg border border-green-200">
          <Bookmark size={14} className="text-green-500 flex-shrink-0" />
          <input
            value={presetName}
            onChange={e => setPresetName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSavePreset()}
            placeholder="Tên bộ hashtag (VD: Ẩm thực, Marketing...)"
            className="flex-1 border border-green-200 rounded px-2.5 py-1.5 text-sm focus:ring-1 focus:ring-green-400"
            autoFocus
          />
          <button
            onClick={handleSavePreset}
            disabled={!presetName.trim() || currentTags.length === 0 || saveMutation.isPending}
            className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:opacity-40 font-medium"
          >
            {saveMutation.isPending ? <Loader size={14} className="animate-spin" /> : 'Lưu'}
          </button>
          <button onClick={() => { setShowSaveForm(false); setPresetName('') }} className="text-gray-400 hover:text-gray-600">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Hashtag library */}
      {showLibrary && (
        <div className="mt-3 border border-amber-200 rounded-lg bg-amber-50/50 overflow-hidden">
          <div className="px-3 py-2 bg-amber-100/50 border-b border-amber-200">
            <span className="text-xs font-medium text-amber-700">Thư viện Hashtag ({library.length} bộ)</span>
          </div>
          {isLoadingLibrary ? (
            <div className="flex items-center justify-center py-6 gap-2 text-gray-400">
              <Loader size={14} className="animate-spin" />
              <span className="text-xs">Đang tải...</span>
            </div>
          ) : library.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-6">
              Chưa lưu bộ hashtag nào. Tạo hashtag rồi bấm "Lưu" để lưu lại.
            </p>
          ) : (
            <div className="max-h-52 overflow-y-auto divide-y divide-amber-100">
              {library.map(preset => (
                <div key={preset.id} className="px-3 py-2.5 hover:bg-amber-50 group">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-medium text-gray-800">{preset.name}</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleApplyPreset(preset)}
                        className="text-[11px] px-2 py-0.5 rounded bg-blue-100 text-blue-600 hover:bg-blue-200 font-medium"
                        title="Gộp thêm vào hashtag hiện tại"
                      >
                        + Gộp
                      </button>
                      <button
                        onClick={() => handleReplacePreset(preset)}
                        className="text-[11px] px-2 py-0.5 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 font-medium"
                        title="Thay thế toàn bộ"
                      >
                        Dùng
                      </button>
                      <button
                        onClick={() => handleDeletePreset(preset.id)}
                        disabled={deleteMutation.isPending}
                        className="text-gray-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 disabled:opacity-30"
                        title="Xóa bộ hashtag"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {preset.tags.slice(0, 10).map((tag, i) => (
                      <span key={i} className="text-[10px] bg-white text-gray-500 px-1.5 py-0.5 rounded-full border border-gray-200">#{tag}</span>
                    ))}
                    {preset.tags.length > 10 && (
                      <span className="text-[10px] text-gray-400">+{preset.tags.length - 10}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
