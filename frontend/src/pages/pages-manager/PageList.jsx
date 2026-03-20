import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Inbox, Trash2, RefreshCw, Send, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

export default function PageList() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ account_id: '', fb_page_id: '', name: '' })
  const [selected, setSelected] = useState(new Set())

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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fanpages'] }); setShowAdd(false); setForm({ account_id: '', fb_page_id: '', name: '' }); toast.success('Đã thêm trang!') },
    onError: (err) => toast.error(err.response?.data?.message || 'Không thể thêm trang')
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/fanpages/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fanpages'] }); toast.success('Đã xoá!') },
    onError: () => toast.error('Không thể xoá')
  })

  const fetchInboxMutation = useMutation({
    mutationFn: (id) => api.post(`/fanpages/${id}/fetch-inbox`),
    onSuccess: (res) => toast.success(`Đã tải ${res.data.fetched} tin nhắn mới`),
    onError: () => toast.error('Không thể tải hộp thư')
  })

  const updateMethodMutation = useMutation({
    mutationFn: ({ id, posting_method }) => api.put(`/fanpages/${id}`, { posting_method }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['fanpages'] }); toast.success('Đã cập nhật phương thức đăng bài') },
    onError: () => toast.error('Không thể cập nhật')
  })

  // Bulk delete
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const handleBulkDelete = async () => {
    if (selected.size === 0) return
    if (!confirm(`Bạn có chắc muốn xoá ${selected.size} trang đã chọn?`)) return
    setBulkDeleting(true)
    try {
      await Promise.all([...selected].map(id => api.delete(`/fanpages/${id}`)))
      queryClient.invalidateQueries({ queryKey: ['fanpages'] })
      toast.success(`Đã xoá ${selected.size} trang!`)
      setSelected(new Set())
    } catch {
      toast.error('Một số trang không thể xoá')
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
    if (selected.size === pages.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(pages.map(p => p.id)))
    }
  }

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Quản lý Fanpage</h1>
        <div className="flex items-center gap-2">
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
          <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
            <Plus size={18} /> Thêm trang
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-3 py-3 w-10">
                <input
                  type="checkbox"
                  checked={pages.length > 0 && selected.size === pages.length}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              </th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Tên trang</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Tài khoản</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Lượt thích</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Đăng bài</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Hộp thư</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Kiểm tra lần cuối</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {pages.map(page => (
              <tr key={page.id} className={`hover:bg-gray-50 ${selected.has(page.id) ? 'bg-blue-50' : ''}`}>
                <td className="px-3 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(page.id)}
                    onChange={() => toggleSelect(page.id)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </td>
                <td className="px-4 py-3 font-medium">
                  <a href={`https://www.facebook.com/${page.fb_page_id}`} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                    {page.name || '—'}
                  </a>
                </td>
                <td className="px-4 py-3 text-sm">{page.accounts?.username || '—'}</td>
                <td className="px-4 py-3 text-sm">{page.fan_count?.toLocaleString() || '—'}</td>
                <td className="px-4 py-3">
                  <select
                    value={page.posting_method || 'auto'}
                    onChange={e => updateMethodMutation.mutate({ id: page.id, posting_method: e.target.value })}
                    className={`text-xs px-2 py-1 rounded-md border cursor-pointer ${
                      page.posting_method === 'access_token' ? 'bg-green-50 border-green-300 text-green-700' :
                      page.posting_method === 'cookie' ? 'bg-orange-50 border-orange-300 text-orange-700' :
                      'bg-gray-50 border-gray-300 text-gray-600'
                    }`}
                  >
                    <option value="auto">Auto</option>
                    <option value="access_token">API Token</option>
                    <option value="cookie">Cookie</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${page.inbox_enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {page.inbox_enabled ? 'Đang bật' : 'Tắt'}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-gray-500">
                  {page.last_inbox_check ? new Date(page.last_inbox_check).toLocaleString() : '—'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => navigate(`/publish?type=page&accountId=${page.account_id}&pageId=${page.id}`)}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-green-50 text-green-600 hover:bg-green-100"
                      title="Đăng bài lên trang này"
                    >
                      <Send size={12} /> Đăng bài
                    </button>
                    <Link to="/inbox" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-blue-50 text-blue-600 hover:bg-blue-100">
                      <Inbox size={12} /> Hộp thư
                    </Link>
                    <button
                      onClick={() => fetchInboxMutation.mutate(page.id)}
                      disabled={fetchInboxMutation.isPending}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-gray-500 hover:bg-gray-100"
                      title="Lấy tin nhắn mới từ Facebook"
                    >
                      <RefreshCw size={12} className={fetchInboxMutation.isPending ? 'animate-spin' : ''} /> Tải mới
                    </button>
                    <button
                      onClick={() => { if (confirm('Bạn có chắc muốn xoá trang này?')) deleteMutation.mutate(page.id) }}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={12} /> Xoá
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {pages.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-12 text-center">
                  <FileText size={40} className="mx-auto mb-3 text-gray-300" />
                  <p className="text-gray-500 mb-2">Chưa có fanpage nào</p>
                  <p className="text-sm text-gray-400 mb-3">Thêm fanpage để bắt đầu quản lý hộp thư và đăng bài</p>
                  <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm">
                    <Plus size={16} /> Thêm fanpage đầu tiên
                  </button>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Thêm Fanpage</h2>
            <div className="space-y-3">
              <select value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })} className="w-full border rounded-lg px-3 py-2">
                <option value="">Chọn tài khoản Facebook</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.username}</option>)}
              </select>
              <div>
                <input placeholder="ID trang Facebook (VD: 123456789)" value={form.fb_page_id} onChange={e => setForm({ ...form, fb_page_id: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
                <p className="text-xs text-gray-400 mt-1">Xem ID tại URL trang Facebook: facebook.com/[page-id]</p>
              </div>
              <input placeholder="Tên trang (để trống sẽ tự tìm)" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border rounded-lg px-3 py-2" />
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Huỷ</button>
              <button onClick={() => addMutation.mutate(form)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700" disabled={addMutation.isPending || !form.account_id || !form.fb_page_id}>
                {addMutation.isPending ? 'Đang thêm...' : 'Thêm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
