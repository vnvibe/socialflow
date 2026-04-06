import { useState, useRef, useCallback, useEffect } from 'react'
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
  Pencil,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  ScanSearch,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import useAgentGuard from '../../hooks/useAgentGuard'
import HealthBadge from '../../components/accounts/HealthBadge'
import ProxyBadge from '../../components/shared/ProxyBadge'

export default function AccountList() {
  const [showAddModal, setShowAddModal] = useState(false)
  const [showBulkModal, setShowBulkModal] = useState(false)
  const [search, setSearch] = useState('')
  const [editAccount, setEditAccount] = useState(null)

  // Fetch All state: { accountId: { jobId, status, error } }
  const [fetchJobs, setFetchJobs] = useState({})
  const [fetchingAll, setFetchingAll] = useState(false)
  const pollRef = useRef(null)

  const queryClient = useQueryClient()
  const { requireAgent } = useAgentGuard()

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api.get('/accounts').then((r) => r.data),
    refetchInterval: 5000,
  })

  const filtered = accounts.filter(
    (a) =>
      a.username?.toLowerCase().includes(search.toLowerCase()) ||
      a.fb_user_id?.toLowerCase().includes(search.toLowerCase())
  )

  const healthCheckMutation = useMutation({
    mutationFn: (id) => api.post(`/accounts/${id}/check-health`),
    onSuccess: () => {
      toast.success('Check queued - agent is processing...')
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError: (err) => {
      if (err.response?.status === 503) {
        toast.error('Agent offline! Start the SocialFlow Agent first.')
      } else {
        toast.error(err.response?.data?.error || 'Health check failed')
      }
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/accounts/${id}`),
    onSuccess: () => {
      toast.success('Account deleted')
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError: () => toast.error('Delete failed'),
  })

  const handleDelete = (account) => {
    if (window.confirm(`Delete account "${account.username}"?`)) {
      deleteMutation.mutate(account.id)
    }
  }

  // --- Fetch All Accounts ---
  const activeFetchCount = Object.values(fetchJobs).filter(j => ['pending', 'claimed', 'running'].includes(j.status)).length
  const doneFetchCount = Object.values(fetchJobs).filter(j => j.status === 'done').length
  const failedFetchCount = Object.values(fetchJobs).filter(j => j.status === 'failed').length
  const totalFetchCount = Object.keys(fetchJobs).length

  const pollFetchJobs = useCallback(async () => {
    setFetchJobs(prev => {
      const activeJobs = Object.entries(prev).filter(([, j]) => ['pending', 'claimed', 'running'].includes(j.status))
      if (activeJobs.length === 0) {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
        setFetchingAll(false)
        return prev
      }
      // Poll each active job
      Promise.all(activeJobs.map(([accId, j]) =>
        api.get(`/jobs/${j.jobId}`).then(r => ({ accId, data: r.data })).catch(() => null)
      )).then(results => {
        setFetchJobs(current => {
          const next = { ...current }
          let anyDone = false
          for (const r of results) {
            if (!r) continue
            next[r.accId] = { ...next[r.accId], status: r.data.status, error: r.data.error_message }
            if (r.data.status === 'done' || r.data.status === 'failed') anyDone = true
          }
          // Check if all done
          const stillActive = Object.values(next).some(j => ['pending', 'claimed', 'running'].includes(j.status))
          if (!stillActive) {
            if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
            setFetchingAll(false)
            queryClient.invalidateQueries({ queryKey: ['accounts'] })
            queryClient.invalidateQueries({ queryKey: ['fanpages'] })
            queryClient.invalidateQueries({ queryKey: ['groups'] })
          }
          return next
        })
      })
      return prev
    })
  }, [queryClient])

  useEffect(() => { return () => { if (pollRef.current) clearInterval(pollRef.current) } }, [])

  const handleFetchAll = () => requireAgent(async () => {
    const activeAccounts = accounts.filter(a => a.is_active !== false)
    if (activeAccounts.length === 0) return toast.error('No active accounts')

    setFetchingAll(true)
    const jobs = {}

    for (const account of activeAccounts) {
      try {
        const res = await api.post(`/accounts/${account.id}/fetch-all`)
        jobs[account.id] = { jobId: res.data.job_id, status: 'pending', error: null }
      } catch (err) {
        jobs[account.id] = { jobId: null, status: 'failed', error: err.response?.data?.error || err.message }
      }
    }

    setFetchJobs(jobs)
    toast.success(`Queued fetch for ${Object.values(jobs).filter(j => j.jobId).length}/${activeAccounts.length} accounts`)

    // Start polling
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(pollFetchJobs, 3000)
  })

  const getFetchStatus = (accountId) => fetchJobs[accountId] || null

  const dismissFetchAll = () => {
    setFetchJobs({})
    setFetchingAll(false)
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={handleFetchAll}
            disabled={fetchingAll || accounts.length === 0}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-emerald-300 text-emerald-700 hover:bg-emerald-50 disabled:opacity-50 transition-colors"
          >
            {fetchingAll ? <Loader className="w-4 h-4 animate-spin" /> : <ScanSearch className="w-4 h-4" />}
            {fetchingAll ? 'Fetching...' : 'Fetch All'}
          </button>
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

      {/* Fetch All Progress Banner */}
      {totalFetchCount > 0 && (
        <div className={`rounded-xl border p-4 ${
          activeFetchCount > 0 ? 'bg-blue-50 border-blue-200' :
          failedFetchCount > 0 && doneFetchCount === 0 ? 'bg-red-50 border-red-200' :
          'bg-emerald-50 border-emerald-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {activeFetchCount > 0 ? (
                <Loader className="w-5 h-5 text-blue-500 animate-spin" />
              ) : failedFetchCount > 0 && doneFetchCount === 0 ? (
                <XCircle className="w-5 h-5 text-red-500" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              )}
              <div>
                <p className="text-sm font-medium text-gray-900">
                  {activeFetchCount > 0
                    ? `Fetching pages & groups... (${doneFetchCount + failedFetchCount}/${totalFetchCount} done)`
                    : `Fetch complete — ${doneFetchCount} success, ${failedFetchCount} failed`
                  }
                </p>
                {activeFetchCount > 0 && (
                  <div className="w-48 h-1.5 bg-blue-100 rounded-full mt-1.5 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full transition-all duration-500"
                      style={{ width: `${Math.round(((doneFetchCount + failedFetchCount) / totalFetchCount) * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
            {activeFetchCount === 0 && (
              <button onClick={dismissFetchAll} className="p-1 rounded-lg hover:bg-white/50 text-gray-500">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

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
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Username</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">FB User ID</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Browser</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Proxy</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Posts Today</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((account) => (
                  <tr key={account.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">
                      <div className="flex items-center gap-2">
                        {account.avatar_url ? (
                          <img src={account.avatar_url} alt="" className="w-7 h-7 rounded-full object-cover" />
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs text-gray-500">
                            {(account.username || '?')[0].toUpperCase()}
                          </div>
                        )}
                        {account.username}
                        {(() => {
                          const fs = getFetchStatus(account.id)
                          if (!fs) return null
                          if (['pending', 'claimed', 'running'].includes(fs.status))
                            return <RefreshCw className="w-3.5 h-3.5 text-blue-500 animate-spin" />
                          if (fs.status === 'done')
                            return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                          if (fs.status === 'failed')
                            return <XCircle className="w-3.5 h-3.5 text-red-500" title={fs.error || 'Failed'} />
                          return null
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">{account.fb_user_id}</td>
                    <td className="px-4 py-3 text-gray-500">{account.browser_type || 'chromium'}</td>
                    <td className="px-4 py-3">
                      <ProxyBadge proxy={account.proxies} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <HealthBadge status={account.status} />
                        {(account.status === 'dead' || account.status === 'checkpoint') && (
                          <button
                            onClick={() => setEditAccount(account)}
                            className="text-[10px] text-orange-600 hover:text-orange-700 font-medium underline"
                          >
                            Cap nhat cookie
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {account.posts_today ?? 0}/{account.max_daily_posts ?? 10}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => requireAgent(() => healthCheckMutation.mutate(account.id))}
                          disabled={healthCheckMutation.isPending || account.status === 'checking'}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                        >
                          {account.status === 'checking' ? (
                            <Loader className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Activity className="w-3.5 h-3.5" />
                          )}
                          {account.status === 'checking' ? 'Checking...' : 'Check'}
                        </button>
                        <button
                          onClick={() => setEditAccount(account)}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 transition-colors"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(account)}
                          disabled={deleteMutation.isPending}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Delete
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

      {editAccount && (
        <EditAccountModal
          account={editAccount}
          onClose={() => setEditAccount(null)}
          onSuccess={() => {
            setEditAccount(null)
            queryClient.invalidateQueries({ queryKey: ['accounts'] })
          }}
        />
      )}

      {showAddModal && (
        <AddAccountModal
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false)
            queryClient.invalidateQueries({ queryKey: ['accounts'] })
          }}
        />
      )}

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

/* ---- Helpers ---- */

function parseCookieInput(raw) {
  const trimmed = raw.trim()
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed)
      if (Array.isArray(arr) && arr.length > 0 && arr[0].name && arr[0].value) {
        return arr.map((c) => `${c.name}=${c.value}`).join('; ')
      }
    } catch {}
  }
  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed)
      if (obj.name && obj.value) return `${obj.name}=${obj.value}`
    } catch {}
  }
  return trimmed
}

function parseProxyString(str) {
  if (!str.trim()) return null
  const parts = str.trim().split(':')
  if (parts.length < 2) return null
  return {
    host: parts[0],
    port: parseInt(parts[1]),
    username: parts[2] || null,
    password: parts[3] || null,
    type: 'http',
  }
}

/* ---- Proxy Input Component ---- */

function ProxyInput({ proxyId, setProxyId, newProxy, setNewProxy, proxies = [] }) {
  const [mode, setMode] = useState(proxyId ? 'select' : 'none')

  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">Proxy</label>
      <div className="flex items-center gap-2 mb-2">
        <button
          type="button"
          onClick={() => { setMode('none'); setProxyId(''); setNewProxy('') }}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${mode === 'none' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
        >
          No Proxy
        </button>
        {proxies.length > 0 && (
          <button
            type="button"
            onClick={() => { setMode('select'); setNewProxy('') }}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${mode === 'select' ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
          >
            Select Existing
          </button>
        )}
        <button
          type="button"
          onClick={() => { setMode('new'); setProxyId('') }}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${mode === 'new' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}
        >
          + Add New
        </button>
      </div>

      {mode === 'select' && (
        <select
          value={proxyId}
          onChange={(e) => setProxyId(e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="">Choose proxy...</option>
          {proxies.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label || `${p.host}:${p.port}`}
              {p.country ? ` (${p.country})` : ''}
            </option>
          ))}
        </select>
      )}

      {mode === 'new' && (
        <input
          type="text"
          value={newProxy}
          onChange={(e) => setNewProxy(e.target.value)}
          placeholder="host:port:username:password"
          className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono"
        />
      )}
    </div>
  )
}

/* ---- Add Account Modal ---- */

function AddAccountModal({ onClose, onSuccess }) {
  const [cookieString, setCookieString] = useState('')
  const [browserType, setBrowserType] = useState('chromium')
  const [proxyId, setProxyId] = useState('')
  const [newProxy, setNewProxy] = useState('')
  const [fbCreatedAt, setFbCreatedAt] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: proxies = [] } = useQuery({
    queryKey: ['proxies'],
    queryFn: () => api.get('/proxies').then((r) => r.data),
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!cookieString.trim()) return toast.error('Cookie string is required')

    const parsed = parseCookieInput(cookieString)
    if (!parsed) return toast.error('Invalid cookie format')

    setLoading(true)
    try {
      let finalProxyId = proxyId || null

      if (newProxy.trim()) {
        const proxyData = parseProxyString(newProxy)
        if (!proxyData) {
          toast.error('Invalid proxy format. Use host:port or host:port:user:pass')
          setLoading(false)
          return
        }
        const res = await api.post('/proxies', proxyData)
        finalProxyId = res.data.id
      }

      await api.post('/accounts', {
        cookie_string: parsed,
        browser_type: browserType,
        proxy_id: finalProxyId,
        fb_created_at: fbCreatedAt || null,
      })
      toast.success('Account added')
      onSuccess()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add account')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Add Account</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Cookie String</label>
            <textarea
              value={cookieString}
              onChange={(e) => setCookieString(e.target.value)}
              rows={5}
              placeholder={'Paste cookie here...\nSupports: JSON array (Cookie Editor), plain string (c_user=xxx; xs=xxx; ...)'}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y font-mono"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Browser Type</label>
            <select
              value={browserType}
              onChange={(e) => setBrowserType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="chromium">Chromium</option>
              <option value="camoufox">Camoufox</option>
            </select>
          </div>

          <ProxyInput
            proxyId={proxyId}
            setProxyId={setProxyId}
            newProxy={newProxy}
            setNewProxy={setNewProxy}
            proxies={proxies}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Ngày tạo tài khoản FB (optional)</label>
            <input
              type="date"
              value={fbCreatedAt}
              onChange={(e) => setFbCreatedAt(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">Tuổi thật của nick FB, dùng để tính warm-up chính xác hơn</p>
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

/* ---- Edit Account Modal ---- */

function EditAccountModal({ account, onClose, onSuccess }) {
  const [username, setUsername] = useState(account.username || '')
  const [browserType, setBrowserType] = useState(account.browser_type || 'chromium')
  const [proxyId, setProxyId] = useState(account.proxy_id || '')
  const [newProxy, setNewProxy] = useState('')
  const [notes, setNotes] = useState(account.notes || '')
  const [fbCreatedAt, setFbCreatedAt] = useState(account.fb_created_at || '')
  const [isActive, setIsActive] = useState(account.is_active !== false)
  const [cookieString, setCookieString] = useState('')
  const [loading, setLoading] = useState(false)

  const { data: proxies = [] } = useQuery({
    queryKey: ['proxies'],
    queryFn: () => api.get('/proxies').then((r) => r.data),
  })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try {
      let finalProxyId = proxyId || null

      if (newProxy.trim()) {
        const proxyData = parseProxyString(newProxy)
        if (!proxyData) {
          toast.error('Invalid proxy format. Use host:port or host:port:user:pass')
          setLoading(false)
          return
        }
        const res = await api.post('/proxies', proxyData)
        finalProxyId = res.data.id
      }

      await api.put(`/accounts/${account.id}`, {
        username,
        browser_type: browserType,
        proxy_id: finalProxyId,
        notes,
        is_active: isActive,
        fb_created_at: fbCreatedAt || null,
      })

      if (cookieString.trim()) {
        const parsed = parseCookieInput(cookieString)
        await api.post(`/accounts/${account.id}/update-cookie`, {
          cookie_string: parsed,
        })
      }

      toast.success('Account updated')
      onSuccess()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Update failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Edit Account</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Browser Type</label>
            <select
              value={browserType}
              onChange={(e) => setBrowserType(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="chromium">Chromium</option>
              <option value="camoufox">Camoufox</option>
            </select>
          </div>

          <ProxyInput
            proxyId={proxyId}
            setProxyId={setProxyId}
            newProxy={newProxy}
            setNewProxy={setNewProxy}
            proxies={proxies}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Update Cookie (optional)</label>
            <textarea
              value={cookieString}
              onChange={(e) => setCookieString(e.target.value)}
              rows={3}
              placeholder="Leave empty to keep current cookie"
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y font-mono"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Ngày tạo tài khoản FB</label>
            <input
              type="date"
              value={fbCreatedAt}
              onChange={(e) => setFbCreatedAt(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
            <p className="text-xs text-gray-400 mt-1">Tuổi thật của nick FB, dùng để tính warm-up chính xác hơn</p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              className="rounded border-gray-300"
            />
            <label htmlFor="isActive" className="text-sm text-gray-700">Active</label>
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
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ---- Bulk Import Modal ---- */

function BulkImportModal({ onClose, onSuccess }) {
  const [cookies, setCookies] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    const raw = cookies.trim()
    let lines

    if (raw.startsWith('[')) {
      try {
        const arr = JSON.parse(raw)
        if (Array.isArray(arr) && arr.length > 0 && arr[0].name) {
          lines = [arr.map((c) => `${c.name}=${c.value}`).join('; ')]
        }
      } catch {}
    }

    if (!lines) {
      lines = raw.split('\n').map((l) => parseCookieInput(l)).filter(Boolean)
    }

    if (lines.length === 0) return toast.error('Please enter at least one cookie string')

    setLoading(true)
    try {
      const res = await api.post('/accounts/bulk-import', { cookies: lines })
      const success = Array.isArray(res.data) ? res.data.filter((r) => r.success).length : lines.length
      toast.success(`Imported ${success} account(s)`)
      onSuccess()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Bulk import failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg mx-4 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Bulk Import</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 text-gray-500">
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
              placeholder={'Paste cookie strings here, one per line...\ncookie_string_1\ncookie_string_2'}
              className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-y font-mono"
            />
            <p className="text-xs text-gray-500 mt-1">
              {cookies.split('\n').filter((l) => l.trim()).length} cookie(s) entered
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
