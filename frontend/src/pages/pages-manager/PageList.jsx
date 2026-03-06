import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Inbox, Trash2, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

export default function PageList() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ account_id: '', fb_page_id: '', name: '' })

  const { data: pages = [], isLoading } = useQuery({
    queryKey: ['fanpages'],
    queryFn: () => api.get('/fanpages').then(r => r.data)
  })

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then(r => r.data)
  })

  const addMutation = useMutation({
    mutationFn: (data) => api.post('/fanpages', data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fanpages'] }); setShowAdd(false); setForm({ account_id: '', fb_page_id: '', name: '' }); toast.success('Page added') },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to add page')
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/fanpages/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fanpages'] }); toast.success('Deleted') },
    onError: () => toast.error('Failed to delete')
  })

  const fetchInboxMutation = useMutation({
    mutationFn: (id) => api.post(`/fanpages/${id}/fetch-inbox`),
    onSuccess: (res) => toast.success(`Fetched ${res.data.fetched} messages`),
    onError: () => toast.error('Failed to fetch inbox')
  })

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Fanpages</h1>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
          <Plus size={18} /> Add Page
        </button>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">FB Page ID</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Account</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Fans</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Inbox</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Last Inbox Check</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {pages.map(page => (
              <tr key={page.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{page.name || '—'}</td>
                <td className="px-4 py-3 text-sm text-gray-500 font-mono">{page.fb_page_id}</td>
                <td className="px-4 py-3 text-sm">{page.accounts?.username || '—'}</td>
                <td className="px-4 py-3 text-sm">{page.fan_count?.toLocaleString() || '—'}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${page.inbox_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {page.inbox_enabled ? 'ON' : 'OFF'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {page.last_inbox_check ? new Date(page.last_inbox_check).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 text-right space-x-2">
                  <Link to={`/pages/${page.id}/inbox`} className="text-blue-600 hover:underline text-sm inline-flex items-center gap-1"><Inbox size={14} /> Inbox</Link>
                  <button onClick={() => fetchInboxMutation.mutate(page.id)} disabled={fetchInboxMutation.isPending} className="text-gray-500 hover:text-blue-600" title="Fetch Inbox"><RefreshCw size={14} className={fetchInboxMutation.isPending ? 'animate-spin' : ''} /></button>
                  <button onClick={() => { if (confirm('Delete this page?')) deleteMutation.mutate(page.id) }} className="text-gray-400 hover:text-red-600"><Trash2 size={14} /></button>
                </td>
              </tr>
            ))}
            {pages.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No fanpages yet</td></tr>}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Add Fanpage</h2>
            <div className="space-y-3">
              <select value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                <option value="">Select account</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.username}</option>)}
              </select>
              <input placeholder="FB Page ID" value={form.fb_page_id} onChange={e => setForm({ ...form, fb_page_id: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
              <input placeholder="Page name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => addMutation.mutate(form)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700" disabled={addMutation.isPending || !form.account_id || !form.fb_page_id}>
                {addMutation.isPending ? 'Adding...' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
