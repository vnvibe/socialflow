import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Upload, Shield, Globe, Lock, Loader, RefreshCw, Send, UsersRound, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import useAgentGuard from '../../hooks/useAgentGuard'

const typeBadge = {
  public: { icon: Globe, label: 'Công khai', cls: 'bg-green-100 text-hermes' },
  closed: { icon: Lock, label: 'Riêng tư', cls: 'bg-yellow-100 text-yellow-700' },
  secret: { icon: Shield, label: 'Bí mật', cls: 'bg-red-100 text-red-700' }
}

function parseGroupInput(input) {
  const trimmed = input.trim()
  if (!trimmed) return null
  const urlMatch = trimmed.match(/facebook\.com\/groups\/([^/?&#\s]+)/)
  if (urlMatch) {
    return { fb_group_id: urlMatch[1], url: trimmed.startsWith('http') ? trimmed : `https://${trimmed}` }
  }
  if (/^\d+$/.test(trimmed)) return { fb_group_id: trimmed, url: `https://www.facebook.com/groups/${trimmed}` }
  if (/^[\w.-]+$/.test(trimmed)) return { fb_group_id: trimmed, url: `https://www.facebook.com/groups/${trimmed}` }
  return { fb_group_id: trimmed, url: null }
}

export default function GroupList() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [showAdd, setShowAdd] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [form, setForm] = useState({ account_id: '', input: '', name: '' })
  const [bulkAccountId, setBulkAccountId] = useState('')
  const [bulkText, setBulkText] = useState('')
  const [resolving, setResolving] = useState(false)
  const [selected, setSelected] = useState(new Set())
  const [filterAccountId, setFilterAccountId] = useState('')
  const { requireAgent } = useAgentGuard()

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get('/groups').then(r => r.data),
    refetchInterval: 5000,
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data)
  })

  const addMutation = useMutation({
    mutationFn: async (data) => {
      const res = await api.post('/groups', data)
      try { await api.post('/groups/resolve', { account_id: data.account_id, group_ids: [res.data.id] }) } catch {}
      return res
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      setShowAdd(false)
      setForm({ account_id: '', input: '', name: '' })
      toast.success('Đã thêm nhóm! Đang tải thông tin...')
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Không thể thêm nhóm')
  })

  const bulkAddMutation = useMutation({
    mutationFn: async ({ account_id, groups: groupList }) => {
      const res = await api.post('/groups/bulk-add', { account_id, groups: groupList })
      const addedIds = res.data.groups?.map(g => g.id).filter(Boolean)
      if (addedIds?.length) { try { await api.post('/groups/resolve', { account_id, group_ids: addedIds }) } catch {} }
      return res
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      setShowBulk(false)
      setBulkText('')
      setBulkAccountId('')
      toast.success(`Đã thêm ${res.data.imported} nhóm! Đang tải thông tin...`)
    },
    onError: (err) => toast.error(err.response?.data?.error || 'Thêm hàng loạt thất bại')
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/groups/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['groups'] }); toast.success('Đã xoá!') },
    onError: () => toast.error('Không thể xoá')
  })

  // Bulk delete
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const handleBulkDelete = async () => {
    if (selected.size === 0) return
    if (!confirm(`Bạn có chắc muốn xoá ${selected.size} nhóm đã chọn?`)) return
    setBulkDeleting(true)
    try {
      await Promise.all([...selected].map(id => api.delete(`/groups/${id}`)))
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      toast.success(`Đã xoá ${selected.size} nhóm!`)
      setSelected(new Set())
    } catch {
      toast.error('Một số nhóm không thể xoá')
    } finally {
      setBulkDeleting(false)
    }
  }

  const toggleSelect = (id) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selected.size === filteredGroups.length) setSelected(new Set())
    else setSelected(new Set(filteredGroups.map(g => g.id)))
  }

  const handleAdd = () => {
    if (!form.account_id) return toast.error('Chọn tài khoản trước')
    const parsed = parseGroupInput(form.input)
    if (!parsed) return toast.error('Nhập URL hoặc Group ID')
    addMutation.mutate({ account_id: form.account_id, fb_group_id: parsed.fb_group_id, name: form.name || parsed.fb_group_id, url: parsed.url })
  }

  const handleBulkAdd = () => {
    if (!bulkAccountId) return toast.error('Chọn tài khoản trước')
    const lines = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length === 0) return toast.error('Nhập ít nhất 1 URL/ID')
    const groupList = lines.map(line => { const parsed = parseGroupInput(line); return parsed ? { fb_group_id: parsed.fb_group_id, url: parsed.url } : null }).filter(Boolean)
    if (groupList.length === 0) return toast.error('Không nhận dạng được URL/ID nào')
    bulkAddMutation.mutate({ account_id: bulkAccountId, groups: groupList })
  }

  const handleResolveAll = () => requireAgent(async () => {
    const unresolved = groups.filter(g => !g.name || g.name === g.fb_group_id)
    if (unresolved.length === 0) return toast('Tất cả nhóm đã có tên')
    const byAccount = {}
    for (const g of unresolved) { if (!byAccount[g.account_id]) byAccount[g.account_id] = []; byAccount[g.account_id].push(g.id) }
    setResolving(true)
    try {
      for (const [accId, ids] of Object.entries(byAccount)) { await api.post('/groups/resolve', { account_id: accId, group_ids: ids }) }
      toast.success(`Đang cập nhật tên cho ${unresolved.length} nhóm...`)
    } catch (err) { toast.error(err.response?.data?.error || 'Cập nhật tên thất bại') }
    finally { setResolving(false) }
  })

  const defaultAccountId = accounts.length === 1 ? accounts[0].id : ''
  const filteredGroups = filterAccountId ? groups.filter(g => g.account_id === filterAccountId) : groups

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-app-primary">Quản lý nhóm</h1>
          {accounts.length > 1 && (
            <select
              value={filterAccountId}
              onChange={e => { setFilterAccountId(e.target.value); setSelected(new Set()) }}
              className="border border-app-border rounded-lg px-3 py-1.5 text-sm bg-app-surface focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Tất cả ({groups.length})</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>
                  {a.username || a.fb_user_id} ({groups.filter(g => g.account_id === a.id).length})
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex gap-2">
          {selected.size > 0 && (
            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
              className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 size={16} />
              {bulkDeleting ? 'Đang xoá...' : `Xoá ${selected.size} đã chọn`}
            </button>
          )}
          <button onClick={handleResolveAll} disabled={resolving}
            className="flex items-center gap-2 border border-orange-300 text-orange-700 px-4 py-2 rounded-lg hover:bg-orange-50 disabled:opacity-50"
            title="Tự động tải tên và thông tin cho các nhóm chưa có tên">
            {resolving ? <Loader size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            Cập nhật tên nhóm
          </button>
          <button onClick={() => { setShowBulk(true); setBulkAccountId(defaultAccountId) }} className="flex items-center gap-2 border border-app-border px-4 py-2 rounded-lg hover:bg-app-base">
            <Upload size={18} /> Thêm hàng loạt
          </button>
          <button onClick={() => { setShowAdd(true); setForm(f => ({ ...f, account_id: defaultAccountId })) }} className="flex items-center gap-2 bg-info text-white px-4 py-2 rounded-lg hover:opacity-90">
            <Plus size={18} /> Thêm nhóm
          </button>
        </div>
      </div>

      <div className="bg-app-surface rounded shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-app-base">
            <tr>
              <th className="px-3 py-3 w-10">
                <input type="checkbox" checked={filteredGroups.length > 0 && selected.size === filteredGroups.length} onChange={toggleSelectAll}
                  className="rounded border-app-border text-info focus:ring-blue-500" />
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Tên nhóm</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Tài khoản</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Loại nhóm</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Thành viên</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted" title="Bạn có quyền admin trong nhóm này không">Là admin?</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-app-muted">Đăng lần cuối</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-app-muted">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {filteredGroups.map(group => {
              const badge = typeBadge[group.group_type] || typeBadge.public
              const BadgeIcon = badge.icon
              const hasName = group.name && group.name !== group.fb_group_id
              return (
                <tr key={group.id} className={`hover:bg-app-base ${selected.has(group.id) ? 'bg-blue-50' : ''}`}>
                  <td className="px-3 py-3">
                    <input type="checkbox" checked={selected.has(group.id)} onChange={() => toggleSelect(group.id)}
                      className="rounded border-app-border text-info focus:ring-blue-500" />
                  </td>
                  <td className="px-4 py-3 font-medium">
                    <a href={group.url || `https://www.facebook.com/groups/${group.fb_group_id}`} target="_blank" rel="noopener noreferrer"
                      className="hover:text-info hover:underline inline-flex items-center gap-1">
                      {hasName ? group.name : <span className="text-app-dim italic">{group.fb_group_id || '—'}</span>}
                      <ExternalLink size={12} className="text-app-dim shrink-0" />
                    </a>
                  </td>
                  <td className="px-4 py-3 text-sm">{group.accounts?.username || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>
                      <BadgeIcon size={12} /> {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-app-muted">{group.member_count ? group.member_count.toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${group.is_admin ? 'bg-blue-100 text-info' : 'bg-app-elevated text-app-muted'}`}>
                      {group.is_admin ? 'Có' : 'Không'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-app-muted">
                    {group.last_posted_at ? new Date(group.last_posted_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => navigate(`/publish?type=group&accountId=${group.account_id}&groupId=${group.id}`)}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-green-50 text-hermes hover:bg-green-100"
                        title="Đăng bài vào nhóm này">
                        <Send size={12} /> Đăng bài
                      </button>
                      <button
                        onClick={() => { if (confirm('Bạn có chắc muốn xoá nhóm này?')) deleteMutation.mutate(group.id) }}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-app-dim hover:text-red-600 hover:bg-red-50">
                        <Trash2 size={12} /> Xoá
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
            {filteredGroups.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center">
                  <UsersRound size={40} className="mx-auto mb-3 text-app-dim" />
                  <p className="text-app-muted mb-2">Chưa có nhóm nào</p>
                  <p className="text-sm text-app-dim mb-3">Thêm nhóm Facebook để đăng bài tự động</p>
                  <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 bg-info text-white px-4 py-2 rounded-lg hover:opacity-90 text-sm">
                    <Plus size={16} /> Thêm nhóm đầu tiên
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-app-surface rounded p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Thêm nhóm</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-app-primary mb-1">Tài khoản</label>
                <select value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                  <option value="">Chọn tài khoản Facebook</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.username}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-app-primary mb-1">Group URL hoặc ID</label>
                <input placeholder="https://facebook.com/groups/123456 hoặc 123456" value={form.input}
                  onChange={e => setForm({ ...form, input: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
                {form.input && parseGroupInput(form.input) && (
                  <p className="text-xs text-hermes mt-1">ID: {parseGroupInput(form.input).fb_group_id}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-app-primary mb-1">Tên nhóm (để trống, hệ thống tự tìm)</label>
                <input placeholder="Để trống, Agent sẽ tự tìm tên nhóm" value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 border rounded-lg hover:bg-app-base">Huỷ</button>
              <button onClick={handleAdd} disabled={addMutation.isPending || !form.input}
                className="px-4 py-2 bg-info text-white rounded-lg hover:opacity-90 disabled:bg-blue-400">
                {addMutation.isPending ? 'Đang thêm...' : 'Thêm nhóm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showBulk && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowBulk(false)}>
          <div className="bg-app-surface rounded p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Thêm nhóm hàng loạt</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-app-primary mb-1">Tài khoản</label>
                <select value={bulkAccountId} onChange={e => setBulkAccountId(e.target.value)} className="w-full border rounded-lg px-3 py-2">
                  <option value="">Chọn tài khoản Facebook</option>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.username}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-app-primary mb-1">URLs hoặc IDs (mỗi dòng 1 nhóm)</label>
                <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={8}
                  placeholder={"https://facebook.com/groups/123456\nhttps://facebook.com/groups/789012\n987654321"}
                  className="w-full border rounded-lg px-3 py-2 font-mono text-sm resize-none" />
              </div>
              <p className="text-xs text-app-muted">
                {bulkText.split('\n').filter(l => l.trim()).length} nhóm đã nhập — Agent sẽ tự tìm tên & thông tin sau khi thêm
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowBulk(false)} className="px-4 py-2 border rounded-lg hover:bg-app-base">Huỷ</button>
              <button onClick={handleBulkAdd} disabled={bulkAddMutation.isPending || !bulkAccountId}
                className="px-4 py-2 bg-info text-white rounded-lg hover:opacity-90 disabled:bg-blue-400">
                {bulkAddMutation.isPending ? 'Đang thêm...' : 'Thêm tất cả'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
