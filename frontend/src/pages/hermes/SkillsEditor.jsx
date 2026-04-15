/**
 * SkillsEditor — tab inside HermesBrain.
 * List skills on left, textarea editor on right.
 * PUT /ai-hermes/skills/:name → hot-reload server.py's SKILLS dict.
 */
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../../lib/api'
import toast from 'react-hot-toast'

function SkillRow({ skill, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-3 font-mono-ui hover-row"
      style={{
        background: isActive ? 'var(--bg-hover)' : 'transparent',
        borderLeft: isActive ? '2px solid var(--hermes)' : '2px solid transparent',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div className="text-sm text-app-primary">{skill.task_type}</div>
      <div className="flex items-center gap-3 mt-1 text-[10px] text-app-muted">
        <span>{skill.content_length} ch</span>
        {skill.editable ? <span className="text-hermes">editable</span> : <span className="text-warn">read-only</span>}
      </div>
    </button>
  )
}

export default function SkillsEditor() {
  const qc = useQueryClient()
  const [selected, setSelected] = useState(null)
  const [draft, setDraft] = useState('')
  const [isDirty, setIsDirty] = useState(false)

  const { data: listData } = useQuery({
    queryKey: ['hermes', 'skills'],
    queryFn: async () => (await api.get('/ai-hermes/skills')).data,
  })

  const { data: detail } = useQuery({
    queryKey: ['hermes', 'skills', selected],
    enabled: !!selected,
    queryFn: async () => (await api.get(`/ai-hermes/skills/${selected}`)).data,
  })

  useEffect(() => {
    if (detail?.content !== undefined) {
      setDraft(detail.content)
      setIsDirty(false)
    }
  }, [detail])

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.put(`/ai-hermes/skills/${selected}`, { content: draft })
      return res.data
    },
    onSuccess: () => {
      toast.success(`Saved ${selected} — hot-reloaded`)
      setIsDirty(false)
      qc.invalidateQueries({ queryKey: ['hermes', 'skills'] })
      qc.invalidateQueries({ queryKey: ['hermes', 'skills', selected] })
    },
    onError: (err) => {
      const msg = err.response?.data?.error || err.message
      toast.error(`Save failed: ${msg}`)
    },
  })

  const reload = useMutation({
    mutationFn: async () => {
      const res = await api.post('/ai-hermes/skills/reload')
      return res.data
    },
    onSuccess: () => {
      toast.success('All skills reloaded from disk')
      qc.invalidateQueries({ queryKey: ['hermes', 'skills'] })
    },
    onError: (err) => {
      toast.error(`Reload failed: ${err.response?.data?.error || err.message}`)
    },
  })

  const skills = Array.isArray(listData?.skills) ? listData.skills : []
  const activeSkill = selected || skills[0]?.task_type

  useEffect(() => {
    if (!selected && skills.length > 0) {
      setSelected(skills[0].task_type)
    }
  }, [skills, selected])

  return (
    <div className="flex-1 flex min-h-0">
      {/* Left: skill list */}
      <div
        className="w-72 flex flex-col"
        style={{ borderRight: '1px solid var(--border)' }}
      >
        <div
          className="px-3 py-2 font-mono-ui text-[10px] uppercase tracking-wider text-app-muted flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <span>Skills ({skills.length})</span>
          <button
            onClick={() => reload.mutate()}
            disabled={reload.isPending}
            className="text-[10px] text-app-muted hover:text-hermes"
            title="Reload all skills from disk"
          >
            ↻ Reload
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {skills.length === 0 && (
            <div className="p-4 text-app-muted text-xs font-mono-ui">Loading...</div>
          )}
          {skills.map((s) => (
            <SkillRow
              key={s.task_type}
              skill={s}
              isActive={activeSkill === s.task_type}
              onClick={() => setSelected(s.task_type)}
            />
          ))}
        </div>
      </div>

      {/* Right: editor */}
      <div className="flex-1 flex flex-col min-w-0">
        {!detail && (
          <div className="flex items-center justify-center h-full text-app-muted font-mono-ui text-xs">
            Select a skill to edit.
          </div>
        )}
        {detail && (
          <>
            {/* Header */}
            <div
              className="px-6 py-3 flex items-center justify-between"
              style={{ borderBottom: '1px solid var(--border)' }}
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono-ui text-sm text-app-primary">{detail.task_type}</div>
                <div className="font-mono-ui text-[10px] text-app-muted mt-0.5 truncate">
                  {detail.file_path}
                </div>
                {detail.aliases?.length > 0 && (
                  <div className="font-mono-ui text-[10px] text-app-dim mt-0.5">
                    aliases: {detail.aliases.join(', ')}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {isDirty && (
                  <span className="font-mono-ui text-[10px] uppercase text-warn">● unsaved</span>
                )}
                <button
                  onClick={() => {
                    setDraft(detail.content)
                    setIsDirty(false)
                  }}
                  className="btn-ghost"
                  disabled={!isDirty}
                >
                  Reset
                </button>
                <button
                  onClick={() => save.mutate()}
                  className="btn-hermes"
                  disabled={!isDirty || save.isPending}
                >
                  {save.isPending ? 'Saving...' : 'Save + Hot-reload'}
                </button>
              </div>
            </div>

            {/* Textarea */}
            <textarea
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setIsDirty(e.target.value !== detail.content)
              }}
              className="flex-1 w-full px-6 py-4 bg-app-base text-app-primary resize-none outline-none"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '13px',
                lineHeight: '1.7',
                border: 'none',
              }}
              spellCheck={false}
              placeholder="Skill prompt content..."
            />

            {/* Footer stats */}
            <div
              className="px-6 py-2 flex items-center gap-4 font-mono-ui text-[10px] text-app-muted uppercase tracking-wider"
              style={{ borderTop: '1px solid var(--border)' }}
            >
              <span>{draft.length} chars</span>
              <span>{draft.split('\n').length} lines</span>
              <span className="flex-1" />
              <span>{detail.editable ? 'editable' : 'read-only'}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
