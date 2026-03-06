import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Shield, UserCheck, UserX } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const roleBadge = {
  admin: { label: 'Admin', cls: 'bg-red-100 text-red-700', icon: Shield },
  manager: { label: 'Manager', cls: 'bg-blue-100 text-blue-700', icon: UserCheck },
  user: { label: 'User', cls: 'bg-gray-100 text-gray-600', icon: UserCheck }
}

export default function UserManager() {
  const queryClient = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ email: '', password: '', role: 'user' })

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => api.get('/users').then(r => r.data)
  })

  const addUserMutation = useMutation({
    mutationFn: (data) => api.post('/users', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      setShowAdd(false)
      setForm({ email: '', password: '', role: 'user' })
      toast.success('User created')
    },
    onError: (err) => toast.error(err.response?.data?.message || 'Failed to create user')
  })

  const toggleStatusMutation = useMutation({
    mutationFn: ({ id, disabled }) => api.put(`/users/${id}`, { disabled }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] })
      toast.success('User updated')
    },
    onError: () => toast.error('Failed to update user')
  })

  if (isLoading) return <div className="flex justify-center py-12"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
        <button onClick={() => setShowAdd(true)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
          <Plus size={18} /> Add User
        </button>
      </div>

      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-6">
        <p className="text-sm text-yellow-700">User management is handled through Supabase Auth. This interface provides a simplified view for basic operations.</p>
      </div>

      <div className="bg-white rounded-xl shadow overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Username</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Email</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Role</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Status</th>
              <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Created At</th>
              <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map(user => {
              const role = roleBadge[user.role] || roleBadge.user
              const RoleIcon = role.icon
              const isDisabled = user.disabled || user.status === 'disabled'
              return (
                <tr key={user.id} className={`hover:bg-gray-50 ${isDisabled ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3 font-medium">{user.username || user.display_name || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{user.email}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${role.cls}`}>
                      <RoleIcon size={12} /> {role.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                      isDisabled ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                    }`}>
                      {isDisabled ? <UserX size={12} /> : <UserCheck size={12} />}
                      {isDisabled ? 'Disabled' : 'Active'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleStatusMutation.mutate({ id: user.id, disabled: !isDisabled })}
                      disabled={toggleStatusMutation.isPending}
                      className={`text-sm px-3 py-1 rounded-lg border ${
                        isDisabled ? 'text-green-600 border-green-200 hover:bg-green-50' : 'text-red-600 border-red-200 hover:bg-red-50'
                      }`}
                    >
                      {isDisabled ? 'Enable' : 'Disable'}
                    </button>
                  </td>
                </tr>
              )
            })}
            {users.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No users found</td></tr>}
          </tbody>
        </table>
      </div>

      {/* Add User Modal */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowAdd(false)}>
          <div className="bg-white rounded-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold mb-4">Add User</h2>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-700">This will create a new user through Supabase Auth.</p>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="user@example.com"
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="Min 8 characters"
                  className="w-full border rounded-lg px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2"
                >
                  <option value="user">User</option>
                  <option value="manager">Manager</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setShowAdd(false)} className="px-4 py-2 border rounded-lg hover:bg-gray-50">Cancel</button>
              <button
                onClick={() => addUserMutation.mutate(form)}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                disabled={addUserMutation.isPending || !form.email || !form.password}
              >
                {addUserMutation.isPending ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
