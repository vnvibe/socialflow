import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Loader,
  Save,
  Settings,
  FileText,
  UsersRound,
  History,
  Monitor,
  Clock,
  Plus,
  Download,
  Trash2,
  X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import HealthBadge from '../../components/accounts/HealthBadge'
import ProxyBadge from '../../components/shared/ProxyBadge'

const TABS = [
  { key: 'config', label: 'Config', icon: Settings },
  { key: 'fanpages', label: 'Fanpages', icon: FileText },
  { key: 'groups', label: 'Groups', icon: UsersRound },
  { key: 'history', label: 'History', icon: History },
]

function formatDate(dateStr) {
  if (!dateStr) return 'Never'
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function AccountDetail() {
  const { id } = useParams()
  const [activeTab, setActiveTab] = useState('config')
  const queryClient = useQueryClient()

  const {
    data: account,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['account', id],
    queryFn: () => api.get(`/accounts/${id}`).then((r) => r.data),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    )
  }

  if (error || !account) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 text-sm">Failed to load account details.</p>
        <Link
          to="/accounts"
          className="text-blue-600 text-sm mt-2 inline-block hover:underline"
        >
          Back to accounts
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to="/accounts"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Accounts
      </Link>

      {/* Header */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900">
                {account.username}
              </h1>
              <HealthBadge status={account.status} />
            </div>
            <p className="text-sm text-gray-500">
              FB User ID: {account.fb_user_id}
            </p>
          </div>
          <div className="text-right space-y-1">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Monitor className="w-4 h-4" />
              {account.browser_type || 'N/A'}
            </div>
            <ProxyBadge proxy={account.proxy} />
          </div>
        </div>
        <div className="flex items-center gap-6 mt-4 pt-4 border-t border-gray-100 text-sm text-gray-500">
          <span>
            Posts today: {account.posts_today ?? 0}/{account.max_daily_posts ?? '?'}
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            Last used: {formatDate(account.last_used_at)}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="flex gap-0">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'config' && (
          <ConfigTab account={account} queryClient={queryClient} />
        )}
        {activeTab === 'fanpages' && <FanpagesTab accountId={id} />}
        {activeTab === 'groups' && <GroupsTab accountId={id} />}
        {activeTab === 'history' && <HistoryTab accountId={id} />}
      </div>
    </div>
  )
}

function ConfigTab({ account, queryClient }) {
  const [form, setForm] = useState({
    active_hours_start: account.active_hours_start ?? '08:00',
    active_hours_end: account.active_hours_end ?? '22:00',
    active_days: account.active_days ?? [1, 2, 3, 4, 5],
    max_daily_posts: account.max_daily_posts ?? 10,
    min_delay_minutes: account.min_delay_minutes ?? 15,
    max_delay_minutes: account.max_delay_minutes ?? 60,
  })

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const updateMutation = useMutation({
    mutationFn: (data) => api.put(`/accounts/${account.id}`, data),
    onSuccess: () => {
      toast.success('Settings saved')
      queryClient.invalidateQueries({ queryKey: ['account', String(account.id)] })
    },
    onError: () => toast.error('Failed to save settings'),
  })

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const toggleDay = (day) => {
    setForm((prev) => ({
      ...prev,
      active_days: prev.active_days.includes(day)
        ? prev.active_days.filter((d) => d !== day)
        : [...prev.active_days, day].sort(),
    }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    updateMutation.mutate(form)
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-xl border border-gray-200 p-6 space-y-6 max-w-2xl"
    >
      <h2 className="text-lg font-semibold text-gray-900">
        Schedule Settings
      </h2>

      {/* Active hours */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Active Hours Start
          </label>
          <input
            type="time"
            value={form.active_hours_start}
            onChange={(e) => handleChange('active_hours_start', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Active Hours End
          </label>
          <input
            type="time"
            value={form.active_hours_end}
            onChange={(e) => handleChange('active_hours_end', e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Active days */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Active Days
        </label>
        <div className="flex gap-2">
          {dayNames.map((name, i) => (
            <button
              key={i}
              type="button"
              onClick={() => toggleDay(i)}
              className={`w-10 h-10 rounded-lg text-xs font-medium transition-colors ${
                form.active_days.includes(i)
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Max daily posts */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Max Daily Posts
        </label>
        <input
          type="number"
          min={1}
          max={100}
          value={form.max_daily_posts}
          onChange={(e) =>
            handleChange('max_daily_posts', parseInt(e.target.value) || 1)
          }
          className="w-full max-w-xs rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Delay range */}
      <div className="grid grid-cols-2 gap-4 max-w-md">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Min Delay (minutes)
          </label>
          <input
            type="number"
            min={1}
            value={form.min_delay_minutes}
            onChange={(e) =>
              handleChange('min_delay_minutes', parseInt(e.target.value) || 1)
            }
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            Max Delay (minutes)
          </label>
          <input
            type="number"
            min={1}
            value={form.max_delay_minutes}
            onChange={(e) =>
              handleChange('max_delay_minutes', parseInt(e.target.value) || 1)
            }
            className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={updateMutation.isPending}
        className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400 transition-colors"
      >
        {updateMutation.isPending ? (
          <Loader className="w-4 h-4 animate-spin" />
        ) : (
          <Save className="w-4 h-4" />
        )}
        {updateMutation.isPending ? 'Saving...' : 'Save Settings'}
      </button>
    </form>
  )
}

function FanpagesTab({ accountId }) {
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ fb_page_id: '', name: '', url: '', category: '' })
  const [addLoading, setAddLoading] = useState(false)
  const queryClient = useQueryClient()

  const { data: fanpages = [], isLoading } = useQuery({
    queryKey: ['account-fanpages', accountId],
    queryFn: () => api.get(`/accounts/${accountId}/fanpages`).then((r) => r.data),
    refetchInterval: 5000,
  })

  const fetchMutation = useMutation({
    mutationFn: () => api.post(`/accounts/${accountId}/fetch-pages`),
    onSuccess: () => {
      toast.success('Fetching pages from Facebook... Agent is processing.')
      queryClient.invalidateQueries({ queryKey: ['account-fanpages', accountId] })
    },
    onError: (err) => {
      if (err.response?.status === 503) toast.error('Agent offline! Start the SocialFlow Agent first.')
      else toast.error(err.response?.data?.error || 'Fetch failed')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/fanpages/${id}`),
    onSuccess: () => {
      toast.success('Fanpage removed')
      queryClient.invalidateQueries({ queryKey: ['account-fanpages', accountId] })
    },
    onError: () => toast.error('Delete failed'),
  })

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!addForm.fb_page_id && !addForm.url) return toast.error('Page ID or URL required')
    setAddLoading(true)
    try {
      let pageId = addForm.fb_page_id
      if (!pageId && addForm.url) {
        const m = addForm.url.match(/facebook\.com\/(?:pages\/[^/]+\/|)(\d+)|facebook\.com\/([^/?]+)/)
        pageId = m ? (m[1] || m[2]) : addForm.url
      }
      await api.post('/fanpages', { account_id: accountId, fb_page_id: pageId, name: addForm.name || pageId, url: addForm.url, category: addForm.category })
      toast.success('Fanpage added')
      setShowAdd(false)
      setAddForm({ fb_page_id: '', name: '', url: '', category: '' })
      queryClient.invalidateQueries({ queryKey: ['account-fanpages', accountId] })
    } catch (err) {
      toast.error(err.response?.data?.error || 'Add failed')
    } finally { setAddLoading(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => fetchMutation.mutate()} disabled={fetchMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400 transition-colors">
          {fetchMutation.isPending ? <Loader className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Fetch from Facebook
        </button>
        <button onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors">
          <Plus className="w-4 h-4" /> Add Manually
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 max-w-lg">
          <div className="grid grid-cols-2 gap-3">
            <input type="text" placeholder="Page ID" value={addForm.fb_page_id} onChange={(e) => setAddForm(f => ({ ...f, fb_page_id: e.target.value }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
            <input type="text" placeholder="Page Name" value={addForm.name} onChange={(e) => setAddForm(f => ({ ...f, name: e.target.value }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <input type="text" placeholder="Facebook URL (optional)" value={addForm.url} onChange={(e) => setAddForm(f => ({ ...f, url: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-2">
            <button type="submit" disabled={addLoading}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400">
              {addLoading ? 'Adding...' : 'Add'}
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-32"><Loader className="w-5 h-5 animate-spin text-blue-500" /></div>
      ) : fanpages.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <FileText className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No fanpages found. Click "Fetch from Facebook" to import your pages.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Page Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Page ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Category</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Followers</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {fanpages.map((page) => (
                <tr key={page.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{page.name}</td>
                  <td className="px-4 py-3 text-gray-500">{page.fb_page_id}</td>
                  <td className="px-4 py-3 text-gray-500">{page.category || '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{page.followers_count ?? '-'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { if (window.confirm(`Remove "${page.name}"?`)) deleteMutation.mutate(page.id) }}
                      className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function GroupsTab({ accountId }) {
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState({ fb_group_id: '', name: '', url: '' })
  const [addLoading, setAddLoading] = useState(false)
  const queryClient = useQueryClient()

  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['account-groups', accountId],
    queryFn: () => api.get(`/accounts/${accountId}/groups`).then((r) => r.data),
    refetchInterval: 5000,
  })

  const fetchMutation = useMutation({
    mutationFn: () => api.post(`/accounts/${accountId}/fetch-groups`),
    onSuccess: () => {
      toast.success('Fetching groups from Facebook... Agent is processing.')
      queryClient.invalidateQueries({ queryKey: ['account-groups', accountId] })
    },
    onError: (err) => {
      if (err.response?.status === 503) toast.error('Agent offline! Start the SocialFlow Agent first.')
      else toast.error(err.response?.data?.error || 'Fetch failed')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id) => api.delete(`/groups/${id}`),
    onSuccess: () => {
      toast.success('Group removed')
      queryClient.invalidateQueries({ queryKey: ['account-groups', accountId] })
    },
    onError: () => toast.error('Delete failed'),
  })

  const handleAdd = async (e) => {
    e.preventDefault()
    if (!addForm.fb_group_id && !addForm.url) return toast.error('Group ID or URL required')
    setAddLoading(true)
    try {
      let groupId = addForm.fb_group_id
      if (!groupId && addForm.url) {
        const m = addForm.url.match(/facebook\.com\/groups\/([^/?]+)/)
        groupId = m ? m[1] : addForm.url
      }
      await api.post('/groups', { account_id: accountId, fb_group_id: groupId, name: addForm.name || groupId, url: addForm.url })
      toast.success('Group added')
      setShowAdd(false)
      setAddForm({ fb_group_id: '', name: '', url: '' })
      queryClient.invalidateQueries({ queryKey: ['account-groups', accountId] })
    } catch (err) {
      toast.error(err.response?.data?.error || 'Add failed')
    } finally { setAddLoading(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => fetchMutation.mutate()} disabled={fetchMutation.isPending}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400 transition-colors">
          {fetchMutation.isPending ? <Loader className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          Fetch from Facebook
        </button>
        <button onClick={() => setShowAdd(!showAdd)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors">
          <Plus className="w-4 h-4" /> Add Manually
        </button>
      </div>

      {showAdd && (
        <form onSubmit={handleAdd} className="bg-white rounded-xl border border-gray-200 p-4 space-y-3 max-w-lg">
          <div className="grid grid-cols-2 gap-3">
            <input type="text" placeholder="Group ID" value={addForm.fb_group_id} onChange={(e) => setAddForm(f => ({ ...f, fb_group_id: e.target.value }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
            <input type="text" placeholder="Group Name" value={addForm.name} onChange={(e) => setAddForm(f => ({ ...f, name: e.target.value }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          </div>
          <input type="text" placeholder="Facebook Group URL (optional)" value={addForm.url} onChange={(e) => setAddForm(f => ({ ...f, url: e.target.value }))}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-2">
            <button type="submit" disabled={addLoading}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-blue-400">
              {addLoading ? 'Adding...' : 'Add'}
            </button>
            <button type="button" onClick={() => setShowAdd(false)} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Cancel</button>
          </div>
        </form>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-32"><Loader className="w-5 h-5 animate-spin text-blue-500" /></div>
      ) : groups.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <UsersRound className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-500">No groups found. Click "Fetch from Facebook" to import your groups.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50">
                <th className="text-left px-4 py-3 font-medium text-gray-600">Group Name</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Group ID</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Members</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Role</th>
                <th className="text-right px-4 py-3 font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {groups.map((group) => (
                <tr key={group.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{group.name}</td>
                  <td className="px-4 py-3 text-gray-500">{group.fb_group_id}</td>
                  <td className="px-4 py-3 text-gray-500">{group.member_count ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-500">{group.is_admin ? 'Admin' : 'Member'}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => { if (window.confirm(`Remove "${group.name}"?`)) deleteMutation.mutate(group.id) }}
                      className="text-red-500 hover:text-red-700"><Trash2 className="w-4 h-4" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function HistoryTab({ accountId }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['account-history', accountId],
    queryFn: () =>
      api.get(`/accounts/${accountId}/history`).then((r) => r.data),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader className="w-5 h-5 animate-spin text-blue-500" />
      </div>
    )
  }

  if (history.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
        <History className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No history available</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {history.map((entry, i) => (
        <div
          key={entry.id || i}
          className="bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3"
        >
          <div
            className={`w-2 h-2 rounded-full mt-2 shrink-0 ${
              entry.status === 'done'
                ? 'bg-green-500'
                : entry.status === 'failed'
                ? 'bg-red-500'
                : 'bg-gray-400'
            }`}
          />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900">
              {entry.action || entry.type || 'Action'}
            </p>
            {entry.detail && (
              <p className="text-xs text-gray-500 mt-0.5 truncate">
                {entry.detail}
              </p>
            )}
          </div>
          <span className="text-xs text-gray-400 shrink-0">
            {formatDate(entry.created_at)}
          </span>
        </div>
      ))}
    </div>
  )
}
