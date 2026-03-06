import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Upload, Shield, Globe, Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const typeBadge = {
  public: { icon: Globe, label: 'Public', cls: 'bg-green-100 text-green-700' },
  closed: { icon: Lock, label: 'Closed', cls: 'bg-yellow-100 text-yellow-700' },
  secret: { icon: Shield, label: 'Secret', cls: 'bg-red-100 text-red-700' }
}

export default function GroupList() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [form, setForm] = useState({ account_id: '', fb_group_id: '', name: '', type: 'public' })
  const [bulkText, setBulkText] = useState('')

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['groups'],
    queryFn: () => api.get('/groups').then(r => r.data)
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data)
  })

  const addMutation = useMutation({
    mutationFn: (data) => api.post('/groups', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      setShowAdd(false)
      setForm({ account_id: '', fb_group_id: '', name: '', type: 'public' })
      toast.success('Group added')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add group')
  })

  const bulkAddMutation = useMutation({
    mutationFn: (data) => api.post('/groups/bulk-add', data),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['groups'] })
      setShowBulk(false)
      setBulkText('')
      toast.success(`Added ${res.data.added} groups`)
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Bulk add failed')
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/groups/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['groups'] }); toast.success('Deleted') },
    onError: () => toast.error('Failed to delete')
  })

  const handleBulkAdd = () => {
    const ids = bulkText.split('\n').map(l => l.trim()).filter(Boolean)
    if (ids.length === 0) return toast.error('Enter at least one group ID')
    bulkAddMutation.mutate({ group_ids: ids })
  }

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Groups</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowBulk(true)} className="flex items-center gap-2 border border-gray-300 px-4 py-2 rounded-lg hover:bg-gray-50">
            <Upload size={18} /> Bulk Add
          </button>
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
            <Plus size={18} /> Add Group
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">FB Group ID</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Account</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Type</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Admin?</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Last Posted</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {groups.map(group => {
              const badge = typeBadge[group.type] || typeBadge.public
              const BadgeIcon = badge.icon
              return (
                <tr key={group.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium">{group.name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-500 font-mono">{group.fb_group_id}</td>
                  <td className="px-4 py-3 text-sm">{group.accounts?.username || '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>
                      <BadgeIcon size={12} /> {badge.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${group.is_admin ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                      {group.is_admin ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {group.last_posted_at ? new Date(group.last_posted_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { if (confirm('Delete this group?')) deleteMutation.mutate(group.id) }} className="text-gray-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
            {groups.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No groups yet</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Add Group Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Add Group</h2>
            <div className="space-y-3">
              <select value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                <option value="">Select account</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.username}</option>)}
              </select>
              <input placeholder="FB Group ID" value={form.fb_group_id} onChange={e => setForm({ ...form, fb_group_id: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <input placeholder="Group name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                <option value="public">Public</option>
                <option value="closed">Closed</option>
                <option value="secret">Secret</option>
              </select>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => addMutation.mutate(form)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700" disabled={addMutation.isPending || !form.fb_group_id}>
                {addMutation.isPending ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Add Modal */}
      {showBulk && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowBulk(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Bulk Add Groups</h2>
            <p className="text-sm text-gray-500 mb-3">Enter one Facebook Group ID per line</p>
            <textarea
              value={bulkText}
              onChange={e => setBulkText(e.target.value)}
              rows={8}
              placeholder={"123456789\n987654321\n..."}
              className="w-full border rounded-lg px-3 py-2 font-mono text-sm resize-none"
            />
            <p className="text-xs text-gray-400 mt-1">{bulkText.split('\n').filter(l => l.trim()).length} IDs entered</p>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowBulk(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={handleBulkAdd} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700" disabled={bulkAddMutation.isPending}>
                {bulkAddMutation.isPending ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
