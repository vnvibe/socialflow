import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Save, Loader2, Mic, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

// Quick presets — click to fill the form with a starting point.
// Admin can then tweak each field.
const PRESETS = {
  'tech_25_male': {
    persona_label: 'Thanh niên IT 25 tuổi',
    tone: 'casual, hơi sarcasm, thích tranh luận kỹ thuật',
    slang_level: 'high',
    emoji_freq: 'low',
    vocab_examples: ['mình', 'bro', 'k', 'ko', 'nma', 'chứ', 'ờm', 'ai như mình'],
    banned_phrases: ['kính gửi', 'em xin', 'ạ', 'dạ vâng'],
    interests: ['lập trình', 'gaming', 'crypto', 'gym', 'F1'],
    writing_quirks: 'Hay viết tắt "k" thay "không", không dùng dấu chấm cuối câu, đôi khi xuống dòng giữa câu',
  },
  'mom_35_female': {
    persona_label: 'Mẹ bỉm 35 tuổi',
    tone: 'thân thiện, ấm áp, hay quan tâm hỏi han',
    slang_level: 'low',
    emoji_freq: 'medium',
    vocab_examples: ['các mẹ', 'mom', 'baby nhà mình', 'ơi', 'nha', 'ạ'],
    banned_phrases: ['vc', 'vl', 'đm', 'dmm'],
    interests: ['nuôi con', 'bỉm sữa', 'nấu ăn', 'mua sắm online', 'gia đình'],
    writing_quirks: 'Hay gọi "các mẹ ơi", kết câu bằng "nha", "ạ"; dùng emoji ❤️ 🥰',
  },
  'student_20': {
    persona_label: 'Sinh viên 20 tuổi',
    tone: 'năng động, vô tư, hay đùa',
    slang_level: 'high',
    emoji_freq: 'high',
    vocab_examples: ['t', 'mày', 'tau', 'đm chứ', 'vcl', 'cay vl', 'sml', 'oke'],
    banned_phrases: ['kính gửi', 'trân trọng'],
    interests: ['học hành', 'meme', 'idol Kpop', 'phim', 'cafe'],
    writing_quirks: 'Hay dùng "t" thay "tao/tôi", emoji 😂 🥲 nhiều',
  },
  'office_30_neutral': {
    persona_label: 'Nhân viên văn phòng 30 tuổi',
    tone: 'lịch sự, trung tính, có phần dè dặt',
    slang_level: 'low',
    emoji_freq: 'low',
    vocab_examples: ['mình', 'bạn', 'theo mình', 'thực ra'],
    banned_phrases: ['vc', 'vl', 'đm', 'tau', 'mày'],
    interests: ['công việc', 'tài chính cá nhân', 'du lịch', 'ẩm thực'],
    writing_quirks: 'Câu đầy đủ chủ ngữ vị ngữ, có dấu chấm câu, không emoji vớ vẩn',
  },
  'business_40_male': {
    persona_label: 'Anh kinh doanh 40 tuổi',
    tone: 'chững chạc, thực dụng, đi thẳng vấn đề',
    slang_level: 'low',
    emoji_freq: 'none',
    vocab_examples: ['anh', 'em', 'theo kinh nghiệm', 'thực tế là', 'cái này'],
    banned_phrases: ['vc', 'vl', 'mày', 'tau', 'idol', 'oke'],
    interests: ['kinh doanh', 'đầu tư', 'bất động sản', 'xe hơi', 'thể thao'],
    writing_quirks: 'Xưng "anh", gọi đối phương "em" hoặc "bạn"; câu ngắn, súc tích',
  },
}

const TONE_OPTIONS = ['casual', 'formal', 'friendly', 'sarcastic', 'thân thiện', 'lịch sự', 'năng động', 'chững chạc']
const SLANG_LEVELS = [
  { value: 'none', label: 'Không' },
  { value: 'low', label: 'Ít' },
  { value: 'medium', label: 'Vừa' },
  { value: 'high', label: 'Nhiều' },
]
const EMOJI_LEVELS = [
  { value: 'none', label: 'Không' },
  { value: 'low', label: 'Hiếm' },
  { value: 'medium', label: 'Đôi khi' },
  { value: 'high', label: 'Thường xuyên' },
]

export default function VoiceProfileEditor({ accountId, accountName, onClose }) {
  const queryClient = useQueryClient()
  const [profile, setProfile] = useState({
    persona_label: '',
    tone: '',
    slang_level: 'medium',
    emoji_freq: 'low',
    vocab_examples: [],
    banned_phrases: [],
    interests: [],
    writing_quirks: '',
  })
  const [presetName, setPresetName] = useState('')
  const [vocabInput, setVocabInput] = useState('')
  const [bannedInput, setBannedInput] = useState('')
  const [interestInput, setInterestInput] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['voice-profile', accountId],
    queryFn: () => api.get(`/accounts/${accountId}/voice-profile`).then(r => r.data),
    enabled: !!accountId,
  })

  useEffect(() => {
    if (data?.voice_profile) {
      setProfile({
        persona_label: data.voice_profile.persona_label || '',
        tone: data.voice_profile.tone || '',
        slang_level: data.voice_profile.slang_level || 'medium',
        emoji_freq: data.voice_profile.emoji_freq || 'low',
        vocab_examples: data.voice_profile.vocab_examples || [],
        banned_phrases: data.voice_profile.banned_phrases || [],
        interests: data.voice_profile.interests || [],
        writing_quirks: data.voice_profile.writing_quirks || '',
      })
      setPresetName(data.preset_name || '')
    }
  }, [data])

  const saveMutation = useMutation({
    mutationFn: (body) => api.put(`/accounts/${accountId}/voice-profile`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voice-profile', accountId] })
      toast.success('Đã lưu phong cách viết')
      if (onClose) onClose()
    },
    onError: (err) => toast.error(`Lưu thất bại: ${err.response?.data?.error || err.message}`),
  })

  const applyPreset = (key) => {
    const preset = PRESETS[key]
    if (!preset) return
    setProfile({ ...preset })
    setPresetName(key)
  }

  const addToList = (field, input, setInput) => {
    const v = input.trim()
    if (!v) return
    if (profile[field].includes(v)) return
    setProfile({ ...profile, [field]: [...profile[field], v] })
    setInput('')
  }

  const removeFromList = (field, idx) => {
    setProfile({ ...profile, [field]: profile[field].filter((_, i) => i !== idx) })
  }

  const handleSave = () => {
    saveMutation.mutate({ voice_profile: profile, preset_name: presetName || null })
  }

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <Mic size={18} className="text-info" />
        <h3 className="font-semibold text-app-primary">Phong cách viết — {accountName}</h3>
      </div>
      <p className="text-xs text-app-muted">
        Hermes dùng thông tin này để comment/caption/reply cho nick này khác với các nick khác — chống FB cluster và trông tự nhiên hơn.
      </p>

      {/* Quick presets */}
      <div>
        <label className="block text-xs text-app-muted mb-1">Mẫu nhanh (click để áp dụng)</label>
        <div className="flex flex-wrap gap-2">
          {Object.entries(PRESETS).map(([key, p]) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className={`text-xs px-3 py-1.5 rounded border ${
                presetName === key
                  ? 'border-info bg-info/10 text-info'
                  : 'border-app-border text-app-muted hover:bg-app-elevated'
              }`}
            >
              {p.persona_label}
            </button>
          ))}
        </div>
      </div>

      {/* Persona label */}
      <div>
        <label className="block text-xs text-app-muted mb-1">Nhãn persona</label>
        <input
          type="text"
          value={profile.persona_label}
          onChange={e => setProfile({ ...profile, persona_label: e.target.value })}
          placeholder="VD: Thanh niên IT 25 tuổi"
          className="w-full border rounded px-3 py-2 text-sm bg-app-base"
        />
      </div>

      {/* Tone */}
      <div>
        <label className="block text-xs text-app-muted mb-1">Giọng văn</label>
        <input
          type="text"
          list="tone-options"
          value={profile.tone}
          onChange={e => setProfile({ ...profile, tone: e.target.value })}
          placeholder="VD: casual, hơi sarcasm"
          className="w-full border rounded px-3 py-2 text-sm bg-app-base"
        />
        <datalist id="tone-options">
          {TONE_OPTIONS.map(t => <option key={t} value={t} />)}
        </datalist>
      </div>

      {/* Slang + Emoji */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-app-muted mb-1">Mức slang</label>
          <select
            value={profile.slang_level}
            onChange={e => setProfile({ ...profile, slang_level: e.target.value })}
            className="w-full border rounded px-3 py-2 text-sm bg-app-base"
          >
            {SLANG_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-app-muted mb-1">Tần suất emoji</label>
          <select
            value={profile.emoji_freq}
            onChange={e => setProfile({ ...profile, emoji_freq: e.target.value })}
            className="w-full border rounded px-3 py-2 text-sm bg-app-base"
          >
            {EMOJI_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
      </div>

      {/* Vocab examples */}
      <TagListField
        label="Từ ngữ ưa dùng"
        placeholder="Thêm từ rồi Enter (vd: bro, k, mình)"
        items={profile.vocab_examples}
        input={vocabInput}
        setInput={setVocabInput}
        onAdd={() => addToList('vocab_examples', vocabInput, setVocabInput)}
        onRemove={(i) => removeFromList('vocab_examples', i)}
      />

      {/* Banned phrases */}
      <TagListField
        label="Cấm tuyệt đối"
        placeholder="Thêm cụm cấm (vd: kính gửi, em xin)"
        items={profile.banned_phrases}
        input={bannedInput}
        setInput={setBannedInput}
        onAdd={() => addToList('banned_phrases', bannedInput, setBannedInput)}
        onRemove={(i) => removeFromList('banned_phrases', i)}
        danger
      />

      {/* Interests */}
      <TagListField
        label="Sở thích / chủ đề quan tâm"
        placeholder="Thêm chủ đề (vd: lập trình, gym)"
        items={profile.interests}
        input={interestInput}
        setInput={setInterestInput}
        onAdd={() => addToList('interests', interestInput, setInterestInput)}
        onRemove={(i) => removeFromList('interests', i)}
      />

      {/* Writing quirks */}
      <div>
        <label className="block text-xs text-app-muted mb-1">Đặc điểm riêng (free text)</label>
        <textarea
          value={profile.writing_quirks}
          onChange={e => setProfile({ ...profile, writing_quirks: e.target.value })}
          rows={3}
          placeholder='VD: Hay viết tắt "k" thay "không", không dấu chấm cuối câu'
          className="w-full border rounded px-3 py-2 text-sm bg-app-base resize-none"
        />
      </div>

      <div className="flex justify-end gap-2 pt-2 border-t border-app-border">
        {onClose && (
          <button onClick={onClose} className="px-4 py-2 text-sm border rounded hover:bg-app-elevated">
            Hủy
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={saveMutation.isPending}
          className="flex items-center gap-2 bg-info text-white px-4 py-2 rounded text-sm hover:opacity-90 disabled:opacity-50"
        >
          {saveMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
          Lưu phong cách
        </button>
      </div>
    </div>
  )
}

function TagListField({ label, placeholder, items, input, setInput, onAdd, onRemove, danger }) {
  return (
    <div>
      <label className="block text-xs text-app-muted mb-1">{label}</label>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); onAdd() } }}
          placeholder={placeholder}
          className="flex-1 border rounded px-3 py-2 text-sm bg-app-base"
        />
        <button
          onClick={onAdd}
          className="px-3 py-2 border rounded text-sm hover:bg-app-elevated"
        >
          <Plus size={14} />
        </button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {items.map((item, i) => (
            <span
              key={i}
              className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded ${
                danger
                  ? 'bg-red-100 text-red-700 border border-red-200'
                  : 'bg-app-elevated text-app-primary border border-app-border'
              }`}
            >
              {item}
              <button onClick={() => onRemove(i)} className="hover:opacity-70">
                <X size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
