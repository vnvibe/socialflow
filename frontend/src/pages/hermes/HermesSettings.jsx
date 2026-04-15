/**
 * /hermes/settings — 5 sections for configuring Hermes
 *   1. Model & Provider — switch provider/model, test API key
 *   2. Skills — list + edit + create + delete
 *   3. Quality Gate — threshold, max retry
 *   4. Fallback chain — drag-reorder, timeout
 *   5. Memory & Learning — toggles, nuclear deletes
 *
 * All saves: optimistic + toast (VN language).
 */
import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { Plus, Trash2, GripVertical, AlertTriangle, Check, Loader } from 'lucide-react'
import api from '../../lib/api'
import SkillsEditor from './SkillsEditor'

const asArray = (d) => Array.isArray(d) ? d
  : Array.isArray(d?.items) ? d.items
  : Array.isArray(d?.data) ? d.data
  : []

// ───────────────────────────────────────────────────────────
// SECTION 1: Model & Provider
// ───────────────────────────────────────────────────────────
function ModelSection() {
  const qc = useQueryClient()
  const { data: cfgData, isLoading } = useQuery({
    queryKey: ['hermes', 'config'],
    queryFn: async () => (await api.get('/ai-hermes/config')).data,
  })

  const providers = cfgData?.providers || {}
  const cfg = cfgData?.config || {}
  const [form, setForm] = useState({
    provider: 'deepseek', model: '', api_key: '', base_url: '',
    max_tokens: 500, temperature: 0.7,
  })
  const [testing, setTesting] = useState(null) // null | 'pending' | result object

  useEffect(() => {
    if (cfg && !isLoading) {
      setForm(f => ({
        provider: cfg.provider || 'deepseek',
        model: cfg.model || '',
        api_key: '', // always blank; user enters new or leaves empty
        base_url: cfg.base_url || '',
        max_tokens: cfg.max_tokens ?? 500,
        temperature: cfg.temperature ?? 0.7,
      }))
    }
  }, [cfgData])

  const modelOptions = providers[form.provider]?.models || []
  // Auto-set base_url when provider changes. Model: keep user-typed value if it
  // looks custom (contains /), otherwise default to first preset.
  useEffect(() => {
    if (providers[form.provider]) {
      setForm(f => {
        const keepModel = f.model && (f.model.includes('/') || modelOptions.includes(f.model))
        return {
          ...f,
          base_url: providers[f.provider].base_url,
          model: keepModel ? f.model : modelOptions[0] || '',
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.provider, providers])

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        provider: form.provider,
        model: form.model,
        base_url: form.base_url,
        max_tokens: parseInt(form.max_tokens),
        temperature: parseFloat(form.temperature),
      }
      if (form.api_key && form.api_key.length > 10) payload.api_key = form.api_key
      await api.put('/ai-hermes/config', payload)
    },
    onSuccess: () => {
      toast.success('Đã lưu cài đặt model')
      qc.invalidateQueries({ queryKey: ['hermes', 'config'] })
    },
    onError: (err) => toast.error(`Lỗi: ${err.response?.data?.error || err.message}`),
  })

  const testConnection = async () => {
    if (!form.api_key) {
      toast.error('Nhập API key để test')
      return
    }
    setTesting('pending')
    try {
      const res = await api.post('/ai-hermes/config/test', {
        provider: form.provider,
        model: form.model,
        api_key: form.api_key,
        base_url: form.base_url,
      })
      setTesting(res.data)
      if (res.data.ok) {
        toast.success(`Kết nối OK (${res.data.latency_ms}ms)`)
      } else {
        toast.error(`Test thất bại: ${res.data.error}`)
      }
    } catch (err) {
      setTesting({ ok: false, error: err.message })
      toast.error(`Test lỗi: ${err.message}`)
    }
  }

  if (isLoading) return <div className="p-6 text-app-muted font-mono-ui">Đang tải cấu hình...</div>

  return (
    <div className="p-6 font-mono-ui max-w-2xl">
      <h2 className="text-app-primary text-base mb-1">1. Model & Provider</h2>
      <p className="text-app-muted text-xs mb-6">Chọn nhà cung cấp LLM và thông số cho Hermes.</p>

      <div className="space-y-4">
        {/* Provider */}
        <div>
          <label className="block text-[10px] uppercase text-app-muted mb-1">Provider</label>
          <select
            value={form.provider}
            onChange={(e) => setForm(f => ({ ...f, provider: e.target.value }))}
            className="w-full px-3 py-2 bg-app-elevated text-app-primary text-sm"
            style={{ border: '1px solid var(--border-bright)' }}
          >
            {Object.keys(providers).map(p => (
              <option key={p} value={p}>{providers[p].label || p}</option>
            ))}
          </select>
          <div className="text-[10px] text-app-muted mt-1 font-mono-ui">
            {providers[form.provider]?.base_url}
          </div>
        </div>

        {/* Model — datalist cho gợi ý + type tuỳ ý */}
        <div>
          <label className="block text-[10px] uppercase text-app-muted mb-1">
            Model <span className="text-app-dim">(chọn preset hoặc gõ model ID bất kỳ)</span>
          </label>
          <input
            type="text"
            list="model-options"
            value={form.model}
            onChange={(e) => setForm(f => ({ ...f, model: e.target.value }))}
            placeholder="vd: nousresearch/hermes-3-llama-3.1-70b"
            className="w-full px-3 py-2 bg-app-elevated text-app-primary text-sm font-mono-ui"
            style={{ border: '1px solid var(--border-bright)' }}
          />
          <datalist id="model-options">
            {modelOptions.map(m => (
              <option key={m} value={m} />
            ))}
          </datalist>
          {modelOptions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {modelOptions.slice(0, 6).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setForm(f => ({ ...f, model: m }))}
                  className={`text-[10px] px-2 py-0.5 font-mono-ui ${
                    form.model === m ? 'text-hermes' : 'text-app-muted hover:text-app-primary'
                  }`}
                  style={{
                    background: form.model === m ? 'var(--hermes-dim)' : 'var(--bg-elevated)',
                    border: '1px solid ' + (form.model === m ? 'var(--hermes-fade)' : 'var(--border)'),
                  }}
                >
                  {m}
                </button>
              ))}
              {modelOptions.length > 6 && (
                <span className="text-[10px] text-app-dim self-center ml-1">
                  +{modelOptions.length - 6} khác (gõ tên)
                </span>
              )}
            </div>
          )}
        </div>

        {/* API Key */}
        <div>
          <label className="block text-[10px] uppercase text-app-muted mb-1">
            API Key {cfgData?.api_key_set && <span className="text-hermes">(đã set)</span>}
          </label>
          <div className="flex gap-2">
            <input
              type="password"
              value={form.api_key}
              onChange={(e) => setForm(f => ({ ...f, api_key: e.target.value }))}
              placeholder={cfgData?.api_key_set ? 'Để trống nếu không đổi' : 'sk-...'}
              className="flex-1 px-3 py-2 bg-app-elevated text-app-primary text-sm"
              style={{ border: '1px solid var(--border-bright)' }}
            />
            <button
              onClick={testConnection}
              disabled={testing === 'pending' || !form.api_key}
              className="btn-ghost whitespace-nowrap"
            >
              {testing === 'pending' ? <Loader size={12} className="animate-spin" /> : 'Test kết nối'}
            </button>
          </div>
          {testing && testing !== 'pending' && (
            <div className={`mt-2 text-xs ${testing.ok ? 'text-hermes' : 'text-danger'}`}>
              {testing.ok
                ? `✓ OK (${testing.latency_ms}ms) · "${testing.response_preview}"`
                : `✗ ${testing.error}`}
            </div>
          )}
        </div>

        {/* Base URL */}
        <div>
          <label className="block text-[10px] uppercase text-app-muted mb-1">Base URL</label>
          <input
            type="text"
            value={form.base_url}
            onChange={(e) => setForm(f => ({ ...f, base_url: e.target.value }))}
            className="w-full px-3 py-2 bg-app-elevated text-app-primary text-sm"
            style={{ border: '1px solid var(--border-bright)' }}
          />
        </div>

        {/* Max tokens + Temperature */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] uppercase text-app-muted mb-1">Max tokens</label>
            <input
              type="number"
              min={50}
              max={8000}
              value={form.max_tokens}
              onChange={(e) => setForm(f => ({ ...f, max_tokens: parseInt(e.target.value) || 500 }))}
              className="w-full px-3 py-2 bg-app-elevated text-app-primary text-sm"
              style={{ border: '1px solid var(--border-bright)' }}
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase text-app-muted mb-1">
              Temperature: <span className="text-hermes">{form.temperature.toFixed(2)}</span>
            </label>
            <input
              type="range" min={0} max={2} step={0.05}
              value={form.temperature}
              onChange={(e) => setForm(f => ({ ...f, temperature: parseFloat(e.target.value) }))}
              className="w-full"
            />
          </div>
        </div>

        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="btn-hermes"
        >
          {save.isPending ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────
// SECTION 2: Skills (reuse SkillsEditor + Create + Delete)
// ───────────────────────────────────────────────────────────
function SkillsSection() {
  const qc = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [newSkill, setNewSkill] = useState({ task_type: '', content: '' })

  const create = useMutation({
    mutationFn: async () => {
      await api.post('/ai-hermes/skills', newSkill)
    },
    onSuccess: () => {
      toast.success(`Đã tạo skill ${newSkill.task_type}`)
      setCreateOpen(false)
      setNewSkill({ task_type: '', content: '' })
      qc.invalidateQueries({ queryKey: ['hermes', 'skills'] })
    },
    onError: (err) => toast.error(`Lỗi: ${err.response?.data?.error || err.message}`),
  })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <h2 className="text-app-primary text-base">2. Skills</h2>
          <p className="text-app-muted text-xs mt-0.5 font-mono-ui">Chỉnh sửa prompt của từng skill. Lưu = hot-reload không restart.</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn-hermes flex items-center gap-1">
          <Plus size={12} /> TẠO SKILL MỚI
        </button>
      </div>

      <SkillsEditor />

      {/* Create modal */}
      {createOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50"
          style={{ background: 'rgba(0,0,0,0.6)' }}
          onClick={() => setCreateOpen(false)}
        >
          <div
            className="bg-app-surface p-6 font-mono-ui w-full max-w-2xl"
            style={{ border: '1px solid var(--border-bright)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-app-primary text-base mb-4">Tạo skill mới</h3>
            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-[10px] uppercase text-app-muted mb-1">
                  Task type (snake_case, 3-40 chars)
                </label>
                <input
                  type="text"
                  value={newSkill.task_type}
                  onChange={(e) => setNewSkill(s => ({ ...s, task_type: e.target.value.toLowerCase() }))}
                  placeholder="e.g. product_answer"
                  className="w-full px-3 py-2 bg-app-elevated text-app-primary"
                  style={{ border: '1px solid var(--border-bright)' }}
                />
              </div>
              <div>
                <label className="block text-[10px] uppercase text-app-muted mb-1">Prompt content</label>
                <textarea
                  rows={12}
                  value={newSkill.content}
                  onChange={(e) => setNewSkill(s => ({ ...s, content: e.target.value }))}
                  placeholder="You are..."
                  className="w-full px-3 py-2 bg-app-elevated text-app-primary resize-none"
                  style={{ border: '1px solid var(--border-bright)', fontFamily: 'var(--font-mono)', fontSize: 12 }}
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setCreateOpen(false)} className="btn-ghost">Hủy</button>
                <button
                  onClick={() => create.mutate()}
                  disabled={!newSkill.task_type || newSkill.content.length < 10 || create.isPending}
                  className="btn-hermes"
                >
                  {create.isPending ? 'Đang tạo...' : 'Tạo'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ───────────────────────────────────────────────────────────
// SECTION 3: Quality Gate
// ───────────────────────────────────────────────────────────
function QualityGateSection() {
  const qc = useQueryClient()
  const { data: cfgData } = useQuery({
    queryKey: ['hermes', 'config'],
    queryFn: async () => (await api.get('/ai-hermes/config')).data,
  })
  const cfg = cfgData?.config || {}
  const [threshold, setThreshold] = useState(6)
  const [maxRetry, setMaxRetry] = useState(2)

  useEffect(() => {
    if (cfg.quality_gate_threshold !== undefined) setThreshold(cfg.quality_gate_threshold)
    if (cfg.quality_gate_max_retry !== undefined) setMaxRetry(cfg.quality_gate_max_retry)
  }, [cfgData])

  const save = useMutation({
    mutationFn: async () => {
      await api.put('/ai-hermes/config', {
        quality_gate_threshold: threshold,
        quality_gate_max_retry: maxRetry,
      })
    },
    onSuccess: () => {
      toast.success('Đã lưu Quality Gate')
      qc.invalidateQueries({ queryKey: ['hermes', 'config'] })
    },
    onError: (err) => toast.error(`Lỗi: ${err.response?.data?.error || err.message}`),
  })

  return (
    <div className="p-6 font-mono-ui max-w-2xl">
      <h2 className="text-app-primary text-base mb-1">3. Quality Gate</h2>
      <p className="text-app-muted text-xs mb-6">Ngưỡng chất lượng để chấp nhận comment. Thấp hơn = dễ pass, cao hơn = chặt.</p>

      <div className="space-y-4">
        <div>
          <label className="block text-[10px] uppercase text-app-muted mb-1">
            Điểm tối thiểu: <span className="text-hermes">{threshold}</span>/10
          </label>
          <input
            type="range" min={1} max={10} step={1}
            value={threshold}
            onChange={(e) => setThreshold(parseInt(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-[10px] uppercase text-app-muted mb-1">Max retry khi reject</label>
          <input
            type="number" min={0} max={5}
            value={maxRetry}
            onChange={(e) => setMaxRetry(parseInt(e.target.value) || 0)}
            className="w-24 px-3 py-2 bg-app-elevated text-app-primary text-sm"
            style={{ border: '1px solid var(--border-bright)' }}
          />
        </div>
        <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-hermes">
          {save.isPending ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────
// SECTION 4: Fallback chain
// ───────────────────────────────────────────────────────────
function FallbackSection() {
  const qc = useQueryClient()
  const { data: cfgData } = useQuery({
    queryKey: ['hermes', 'config'],
    queryFn: async () => (await api.get('/ai-hermes/config')).data,
  })
  const cfg = cfgData?.config || {}
  const [chain, setChain] = useState(['hermes', 'deepseek', 'openai', 'gemini'])
  const [timeoutMs, setTimeoutMs] = useState(3000)
  const [dragIdx, setDragIdx] = useState(null)

  useEffect(() => {
    if (Array.isArray(cfg.fallback_chain)) setChain(cfg.fallback_chain)
    if (cfg.fallback_timeout_ms !== undefined) setTimeoutMs(cfg.fallback_timeout_ms)
  }, [cfgData])

  const save = useMutation({
    mutationFn: async () => {
      await api.put('/ai-hermes/config', {
        fallback_chain: chain,
        fallback_timeout_ms: timeoutMs,
      })
    },
    onSuccess: () => {
      toast.success('Đã lưu fallback chain')
      qc.invalidateQueries({ queryKey: ['hermes', 'config'] })
    },
    onError: (err) => toast.error(`Lỗi: ${err.response?.data?.error || err.message}`),
  })

  const reorder = (fromIdx, toIdx) => {
    if (fromIdx === toIdx) return
    const arr = [...chain]
    const [item] = arr.splice(fromIdx, 1)
    arr.splice(toIdx, 0, item)
    setChain(arr)
  }

  return (
    <div className="p-6 font-mono-ui max-w-2xl">
      <h2 className="text-app-primary text-base mb-1">4. Fallback chain</h2>
      <p className="text-app-muted text-xs mb-6">Nếu provider đầu fail, thử tiếp theo thứ tự. Kéo thả để sắp xếp.</p>

      <div className="space-y-2 mb-4">
        {chain.map((name, i) => (
          <div
            key={name}
            draggable
            onDragStart={() => setDragIdx(i)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragIdx !== null) reorder(dragIdx, i)
              setDragIdx(null)
            }}
            className="flex items-center gap-3 px-3 py-2 bg-app-elevated cursor-move"
            style={{ border: '1px solid var(--border-bright)' }}
          >
            <GripVertical size={14} className="text-app-muted" />
            <span className="text-app-muted text-[10px] w-4">{i + 1}.</span>
            <span className="flex-1 text-app-primary">{name}</span>
            {i === 0 && <span className="text-[10px] text-hermes">PRIMARY</span>}
          </div>
        ))}
      </div>

      <div className="mb-4">
        <label className="block text-[10px] uppercase text-app-muted mb-1">
          Timeout (ms) trước khi chuyển sang fallback
        </label>
        <input
          type="number" min={500} max={30000}
          value={timeoutMs}
          onChange={(e) => setTimeoutMs(parseInt(e.target.value) || 3000)}
          className="w-32 px-3 py-2 bg-app-elevated text-app-primary text-sm"
          style={{ border: '1px solid var(--border-bright)' }}
        />
      </div>

      <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-hermes">
        {save.isPending ? 'Đang lưu...' : 'Lưu'}
      </button>
    </div>
  )
}

// ───────────────────────────────────────────────────────────
// SECTION 5: Memory & Learning
// ───────────────────────────────────────────────────────────
function MemorySection() {
  const qc = useQueryClient()
  const { data: cfgData } = useQuery({
    queryKey: ['hermes', 'config'],
    queryFn: async () => (await api.get('/ai-hermes/config')).data,
  })
  const cfg = cfgData?.config || {}
  const [fewshot, setFewshot] = useState(true)
  const [memory, setMemory] = useState(true)
  const [minScore, setMinScore] = useState(4)
  const [confirmText, setConfirmText] = useState('')
  const [nickId, setNickId] = useState('')

  useEffect(() => {
    if (cfg.fewshot_enabled !== undefined) setFewshot(cfg.fewshot_enabled)
    if (cfg.memory_enabled !== undefined) setMemory(cfg.memory_enabled)
    if (cfg.fewshot_min_score !== undefined) setMinScore(cfg.fewshot_min_score)
  }, [cfgData])

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => asArray((await api.get('/accounts')).data),
  })

  const save = useMutation({
    mutationFn: async () => {
      await api.put('/ai-hermes/config', {
        fewshot_enabled: fewshot,
        memory_enabled: memory,
        fewshot_min_score: minScore,
      })
    },
    onSuccess: () => {
      toast.success('Đã lưu cài đặt học')
      qc.invalidateQueries({ queryKey: ['hermes', 'config'] })
    },
    onError: (err) => toast.error(`Lỗi: ${err.response?.data?.error || err.message}`),
  })

  const deleteAllFeedback = useMutation({
    mutationFn: async () => {
      await api.delete('/ai-hermes/feedback?confirm=XOAHET')
    },
    onSuccess: (res) => {
      toast.success(`Đã xoá ${res?.data?.deleted_rows || 0} feedback`)
      setConfirmText('')
    },
    onError: (err) => toast.error(`Lỗi: ${err.response?.data?.error || err.message}`),
  })

  const deleteNickMemory = useMutation({
    mutationFn: async () => {
      await api.delete(`/ai-hermes/memory?account_id=${encodeURIComponent(nickId)}`)
    },
    onSuccess: (res) => {
      toast.success(`Đã xoá ${res?.data?.deleted_rows || 0} memory cho nick`)
      setNickId('')
    },
    onError: (err) => toast.error(`Lỗi: ${err.response?.data?.error || err.message}`),
  })

  return (
    <div className="p-6 font-mono-ui max-w-2xl">
      <h2 className="text-app-primary text-base mb-1">5. Memory & Learning</h2>
      <p className="text-app-muted text-xs mb-6">Bật/tắt các cơ chế học của Hermes, xoá dữ liệu đã tích luỹ.</p>

      <div className="space-y-4 mb-8">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={fewshot}
            onChange={(e) => setFewshot(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm text-app-primary">Bật few-shot injection (top-3 past high-score vào prompt)</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={memory}
            onChange={(e) => setMemory(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-sm text-app-primary">Bật per-nick memory (inject từ ai_pilot_memory)</span>
        </div>
        <div>
          <label className="block text-[10px] uppercase text-app-muted mb-1">
            Min score để lưu example: <span className="text-hermes">{minScore}</span>/5
          </label>
          <input
            type="range" min={1} max={5}
            value={minScore}
            onChange={(e) => setMinScore(parseInt(e.target.value))}
            className="w-full max-w-xs"
          />
        </div>
        <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-hermes">
          {save.isPending ? 'Đang lưu...' : 'Lưu'}
        </button>
      </div>

      {/* Danger zone */}
      <div className="p-4 mt-6" style={{ border: '1px solid rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.06)' }}>
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle size={14} className="text-danger" />
          <span className="text-danger text-sm uppercase tracking-wider">Danger zone</span>
        </div>

        {/* Xoá feedback store */}
        <div className="mb-4">
          <div className="text-app-primary text-sm mb-1">Xoá toàn bộ feedback store</div>
          <p className="text-app-muted text-xs mb-2">Sẽ xoá hết past examples Hermes đã học. Không thể undo.</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder='Nhập "XOAHET" để xác nhận'
              className="flex-1 px-3 py-2 bg-app-elevated text-app-primary text-sm"
              style={{ border: '1px solid var(--border-bright)' }}
            />
            <button
              onClick={() => deleteAllFeedback.mutate()}
              disabled={confirmText !== 'XOAHET' || deleteAllFeedback.isPending}
              className="px-3 py-2 font-mono-ui text-xs uppercase"
              style={{
                background: confirmText === 'XOAHET' ? 'rgba(239,68,68,0.2)' : 'var(--bg-elevated)',
                color: confirmText === 'XOAHET' ? 'var(--danger)' : 'var(--text-muted)',
                border: '1px solid rgba(239,68,68,0.4)',
                cursor: confirmText === 'XOAHET' ? 'pointer' : 'not-allowed',
              }}
            >
              <Trash2 size={12} className="inline mr-1" />
              XOÁ HẾT
            </button>
          </div>
        </div>

        {/* Xoá memory 1 nick */}
        <div>
          <div className="text-app-primary text-sm mb-1">Xoá memory 1 nick</div>
          <p className="text-app-muted text-xs mb-2">Reset per-nick memory. Nick sẽ bắt đầu học lại từ đầu.</p>
          <div className="flex gap-2">
            <select
              value={nickId}
              onChange={(e) => setNickId(e.target.value)}
              className="flex-1 px-3 py-2 bg-app-elevated text-app-primary text-sm"
              style={{ border: '1px solid var(--border-bright)' }}
            >
              <option value="">Chọn nick...</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.username || a.id.slice(0, 8)} ({a.status})
                </option>
              ))}
            </select>
            <button
              onClick={() => {
                if (!nickId) return
                if (confirm(`Xác nhận xoá memory cho ${accounts.find(a => a.id === nickId)?.username}?`)) {
                  deleteNickMemory.mutate()
                }
              }}
              disabled={!nickId || deleteNickMemory.isPending}
              className="px-3 py-2 font-mono-ui text-xs uppercase"
              style={{
                background: nickId ? 'rgba(239,68,68,0.2)' : 'var(--bg-elevated)',
                color: nickId ? 'var(--danger)' : 'var(--text-muted)',
                border: '1px solid rgba(239,68,68,0.4)',
                cursor: nickId ? 'pointer' : 'not-allowed',
              }}
            >
              <Trash2 size={12} className="inline mr-1" />
              XOÁ
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────────────────────────────────────────
// Main page
// ───────────────────────────────────────────────────────────
const SECTIONS = [
  { key: 'model',    label: '1. Model' },
  { key: 'skills',   label: '2. Skills' },
  { key: 'quality',  label: '3. Quality Gate' },
  { key: 'fallback', label: '4. Fallback' },
  { key: 'memory',   label: '5. Memory' },
]

export default function HermesSettings() {
  const [section, setSection] = useState('model')

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center gap-8 px-6 py-4"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div>
          <div className="font-mono-ui text-[10px] uppercase text-app-muted">Hermes settings</div>
          <div className="text-app-primary text-lg mt-1">Cài đặt AI brain</div>
        </div>
      </div>

      {/* Tab bar */}
      <div
        className="flex items-center px-6 font-mono-ui text-[11px] uppercase tracking-wider"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`px-4 py-2.5 ${section === s.key ? 'text-hermes' : 'text-app-muted hover:text-app-primary'}`}
            style={{
              borderBottom: section === s.key ? '2px solid var(--hermes)' : '2px solid transparent',
              marginBottom: '-1px',
            }}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {section === 'model'    && <ModelSection />}
        {section === 'skills'   && <SkillsSection />}
        {section === 'quality'  && <QualityGateSection />}
        {section === 'fallback' && <FallbackSection />}
        {section === 'memory'   && <MemorySection />}
      </div>
    </div>
  )
}
