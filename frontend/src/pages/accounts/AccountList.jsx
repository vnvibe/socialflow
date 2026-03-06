import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus,
  Upload,
  Loader,
  X,
  Search,
  Activity,
  Eye,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import HealthBadge from '../../components/accounts/HealthBadge'
import ProxyBadge from '../../components/shared/ProxyBadge'

export default function AccountList() {
  const [showAddModal, setShowAddModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [search, setSearch] = useState('')

  const queryClient = useQueryClient()

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then((r) => r.data),
  })

  const filtered = accounts.filter(
    (a) =>
      a.username?.toLowerCase().includes(search.toLowerCase()) ||
      a.fb_user_id?.toLowerCase().includes(search.toLowerCase())
  )

  const healthCheckMutation = useMutation({
    mutationFn: (id) => api.post(`/accounts/${id}/check-health`),
    onSuccess: () => {
      toast.success('Health check started')
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError: () => toast.error('Health check failed'),
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowBulkModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <Upload className="w-4 h-4" />
            Bulk Import
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Account
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search accounts..."
          className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-300 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Loader className="w-6 h-6 animate-spin text-blue-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border border-gray-200">
          <p className="text-gray-500 text-sm">No accounts found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Username
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    FB User ID
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Browser
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Proxy
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Status
                  </th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">
                    Posts Today
                  </th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((account) => (
                  <tr key={account.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      {account.username}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {account.fb_user_id}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {account.browser_type || 'N/A'}
                    </td>
                    <td className="px-4 py-3">
                      <ProxyBadge proxy={account.proxy} />
                    </td>
                    <td className="px-4 py-3">
                      <HealthBadge status={account.status} />
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {account.posts_today ?? 0}/{account.max_daily_posts ?? '?'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => healthCheckMutation.mutate(account.id)}
                          disabled={healthCheckMutation.isPending}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                        >
                          <Activity className="w-3.5 h-3.5" />
                          Check
                        </button>
                        <Link
                          to={`/accounts/${account.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Account Modal */}
      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false)
            queryClient.invalidateQueries({ queryKey: ['accounts'] })
          }}
        />
      )}

      {/* Bulk Import Modal */}
      {showBulkModal && (
        <BulkImportModal
          onClose={() => setShowBulkModal(false)}
          onSuccess={() => {
            setShowBulkModal(false)
            queryClient.invalidateQueries({ queryKey: ['accounts'] })
          }}
        />
      )}
    </div>
  )
}

function AddAccountModal({ onClose, onSuccess }) {
  const [cookieString, setCookieString] = useState('')
  const [browserType, setBrowserType] = useState('chromium')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!cookieString.trim()) {
      toast.error('Cookie string is required')
      return
    }

    setLoading(true)
    try {
      await api.post('/accounts', {
        cookie_string: cookieString.trim(),
        browser_type: browserType,
      })
      toast.success('Account added successfully')
      onSuccess()
    } catch (err) {
      toast.error(
        err.response?.data?.detail || 'Failed to add account'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Add Account</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Cookie String
            </label>
            <textarea
              value={cookieString}
              onChange={(e) => setCookieString(e.target.value)}
              rows={5}
              placeholder="Paste the Facebook cookie string here..."
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y font-mono"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Browser Type
            </label>
            <select
              value={browserType}
              onChange={(e) => setBrowserType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="chromium">Chromium</option>
              <option value="firefox">Firefox</option>
              <option value="hidemyacc">HideMyAcc</option>
              <option value="gologin">GoLogin</option>
            </select>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400 transition-colors"
            >
              {loading && <Loader className="w-4 h-4 animate-spin" />}
              {loading ? 'Adding...' : 'Add Account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function BulkImportModal({ onClose, onSuccess }) {
  const [cookies, setCookies] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const lines = cookies
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)

    if (lines.length === 0) {
      toast.error('Please enter at least one cookie string')
      return
    }

    setLoading(true)
    try {
      const res = await api.post('/accounts/bulk-import', { cookies: lines })
      const count = res.data?.imported ?? lines.length
      toast.success(`Imported ${count} account(s)`)
      onSuccess()
    } catch (err) {
      toast.error(
        err.response?.data?.detail || 'Bulk import failed'
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Bulk Import</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Cookie Strings (one per line)
            </label>
            <textarea
              value={cookies}
              onChange={(e) => setCookies(e.target.value)}
              rows={8}
              placeholder={"Paste cookie strings here, one per line...\ncookie_string_1\ncookie_string_2\ncookie_string_3"}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y font-mono"
            />
            <p className="text-xs text-gray-500 mt-1">
              {cookies.split('\n').filter((l) => l.trim()).length} cookie(s)
              entered
            </p>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400 transition-colors"
            >
              {loading && <Loader className="w-4 h-4 animate-spin" />}
              {loading ? 'Importing...' : 'Import All'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
