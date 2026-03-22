import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Globe, Plus, Trash2, CheckCircle, ChevronDown, ChevronUp, Loader, ExternalLink, BarChart3, Search, FileBarChart } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import { supabase } from '../../lib/supabase'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000'

// Modal: chọn GSC sites (multi) + GA property sau khi OAuth thành công
function SitePickerModal({ websiteId, email, onDone, onCancel }) {
  const [selectedGscs, setSelectedGscs] = useState([]) // multi-select
  const [selectedGa, setSelectedGa] = useState(null)
  const [tab, setTab] = useState('gsc')

  const gscQuery = useQuery({
    queryKey: ['gsc-sites', websiteId],
    queryFn: () => api.get(`/websites/${websiteId}/gsc-sites`).then(r => r.data),
  })
  const gaQuery = useQuery({
    queryKey: ['ga-properties', websiteId],
    queryFn: () => api.get(`/websites/${websiteId}/ga-properties`).then(r => r.data),
    enabled: tab === 'ga',
  })

  const toggleGsc = (site) => {
    setSelectedGscs(prev =>
      prev.some(s => s.url === site.url) ? prev.filter(s => s.url !== site.url) : [...prev, site]
    )
  }

  const finalizeMutation = useMutation({
    mutationFn: () => api.post(`/websites/${websiteId}/finalize`, {
      sites: selectedGscs.map(s => ({
        gsc_site_url: s.url,
        ga_property_id: selectedGa?.id,
        ga_property_name: selectedGa?.name,
      })),
    }),
    onSuccess: (res) => {
      toast.success(`Đã kết nối ${res.data.length} website!`)
      onDone()
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Lỗi lưu'),
  })

  const handleCancel = async () => {
    await api.delete(`/websites/${websiteId}`).catch(() => {})
    onCancel()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="p-5 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Chọn website cần theo dõi</h2>
          <p className="text-xs text-gray-500 mt-0.5">Đã đăng nhập: <strong>{email}</strong></p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100">
          <button
            onClick={() => setTab('gsc')}
            className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 ${tab === 'gsc' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
          >
            <Search size={14} /> Search Console
            {selectedGscs.length > 0 && <span className="ml-1 bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5">{selectedGscs.length}</span>}
          </button>
          <button
            onClick={() => setTab('ga')}
            className={`flex-1 py-2.5 text-sm font-medium flex items-center justify-center gap-1.5 ${tab === 'ga' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-500'}`}
          >
            <BarChart3 size={14} /> Analytics 4 <span className="text-xs text-gray-400">(tuỳ chọn)</span>
          </button>
        </div>

        <div className="p-4 min-h-[200px] max-h-[320px] overflow-y-auto">
          {tab === 'gsc' && (
            gscQuery.isLoading ? (
              <div className="flex items-center justify-center h-32 text-gray-400">
                <Loader size={20} className="animate-spin mr-2" /> Đang tải sites...
              </div>
            ) : gscQuery.error ? (
              <p className="text-red-500 text-sm text-center py-8">{gscQuery.error?.response?.data?.error || 'Lỗi tải Search Console sites'}</p>
            ) : (gscQuery.data?.sites || []).length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Search size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">Không tìm thấy site nào trong Search Console</p>
                <p className="text-xs mt-1">Hãy thêm website vào <a href="https://search.google.com/search-console" target="_blank" rel="noreferrer" className="text-blue-500 underline">Google Search Console</a> trước</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <p className="text-xs text-gray-400 mb-2">Chọn một hoặc nhiều website</p>
                {gscQuery.data.sites.map(s => {
                  const checked = selectedGscs.some(x => x.url === s.url)
                  return (
                    <button
                      key={s.url}
                      onClick={() => toggleGsc(s)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all flex items-center gap-3 ${checked ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                    >
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 ${checked ? 'border-blue-500 bg-blue-500' : 'border-gray-300'}`}>
                        {checked && <svg width="10" height="8" viewBox="0 0 10 8" fill="none"><path d="M1 4L3.5 6.5L9 1" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-800 truncate">{s.url}</div>
                        <div className="text-xs text-gray-400">{s.level}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          )}

          {tab === 'ga' && (
            gaQuery.isLoading ? (
              <div className="flex items-center justify-center h-32 text-gray-400">
                <Loader size={20} className="animate-spin mr-2" /> Đang tải Analytics...
              </div>
            ) : gaQuery.error ? (
              <p className="text-red-500 text-sm text-center py-8">{gaQuery.error?.response?.data?.error || 'Lỗi tải GA properties'}</p>
            ) : (gaQuery.data?.properties || []).length === 0 ? (
              <p className="text-center py-8 text-sm text-gray-400">Không tìm thấy GA4 property nào</p>
            ) : (
              <div className="space-y-1.5">
                <button
                  onClick={() => setSelectedGa(null)}
                  className={`w-full text-left px-3 py-2 rounded-lg border text-sm text-gray-400 ${!selectedGa ? 'border-blue-500 bg-blue-100' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  Bỏ qua (không kết nối GA)
                </button>
                {gaQuery.data.properties.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedGa(p)}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-all ${selectedGa?.id === p.id ? 'border-blue-500 bg-blue-100' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800">{p.name}</span>
                      {selectedGa?.id === p.id && <CheckCircle size={16} className="text-blue-500 shrink-0" />}
                    </div>
                    <span className="text-xs text-gray-400">{p.id}</span>
                  </button>
                ))}
              </div>
            )
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2 justify-end">
          <button onClick={handleCancel} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">Huỷ</button>
          <button
            onClick={() => finalizeMutation.mutate()}
            disabled={selectedGscs.length === 0 || finalizeMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
          >
            {finalizeMutation.isPending ? <Loader size={14} className="animate-spin" /> : <CheckCircle size={14} />}
            Xong {selectedGscs.length > 0 && `(${selectedGscs.length})`}
          </button>
        </div>
      </div>
    </div>
  )
}

function WebsiteCard({ site, onRefresh }) {
  const [expanded, setExpanded] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/websites/${site.id}`),
    onSuccess: () => { toast.success('Đã xoá'); onRefresh() },
    onError: () => toast.error('Xoá thất bại'),
  })

  const disconnectMutation = useMutation({
    mutationFn: () => api.post(`/websites/${site.id}/disconnect-google`),
    onSuccess: () => { toast.success('Đã huỷ kết nối Google'); onRefresh() },
    onError: () => toast.error('Lỗi huỷ kết nối'),
  })

  return (
    <div className="bg-white border border-gray-200 rounded-xl">
      <div className="flex items-center gap-3 p-4">
        <div className="w-9 h-9 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
          <Globe size={18} className="text-blue-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 text-sm truncate">{site.name}</h3>
          <a href={site.url} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
            {site.url} <ExternalLink size={10} />
          </a>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Link to={`/websites/${site.id}/report`} className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 text-xs font-medium">
            <FileBarChart size={13} /> Báo cáo
          </Link>
          <button onClick={() => setExpanded(e => !e)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100">
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
          <button
            onClick={() => { if (confirm('Xoá website này?')) deleteMutation.mutate() }}
            disabled={deleteMutation.isPending}
            className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-100"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Badges */}
      <div className="px-4 pb-3 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-green-50 text-green-700">
          <CheckCircle size={10} /> {site.google_email}
        </span>
        {site.gsc_site_url && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-purple-50 text-purple-700">
            <Search size={10} /> GSC
          </span>
        )}
        {site.ga_property_name && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-orange-50 text-orange-700">
            <BarChart3 size={10} /> {site.ga_property_name}
          </span>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-100 space-y-2 text-xs text-gray-600">
          <div className="flex justify-between">
            <span>Google: <strong>{site.google_email}</strong></span>
            <button onClick={() => disconnectMutation.mutate()} disabled={disconnectMutation.isPending} className="text-red-500 hover:underline">
              Huỷ kết nối Google
            </button>
          </div>
          {site.gsc_site_url && <div>Search Console: <strong>{site.gsc_site_url}</strong></div>}
          {site.ga_property_name && <div>Analytics: <strong>{site.ga_property_name}</strong></div>}
        </div>
      )}
    </div>
  )
}

export default function WebsiteSettings() {
  const queryClient = useQueryClient()
  const [picker, setPicker] = useState(null) // { websiteId, email }
  const [connecting, setConnecting] = useState(false)

  const { data: websites = [], isLoading } = useQuery({
    queryKey: ['websites'],
    queryFn: () => api.get('/websites').then(r => r.data),
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['websites'] })

  const handleConnectGoogle = async () => {
    setConnecting(true)
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (!token) { toast.error('Chưa đăng nhập'); setConnecting(false); return }

    const url = `${API_BASE}/websites/google/auth?token=${token}`
    const popup = window.open(url, 'google_oauth', 'width=520,height=620,left=200,top=100')

    // Detect popup blocked
    if (!popup || popup.closed || typeof popup.closed === 'undefined') {
      toast.error('Popup bị chặn! Hãy cho phép popup trong cài đặt trình duyệt rồi thử lại.')
      setConnecting(false)
      return
    }

    const bc = new BroadcastChannel('google_oauth')
    let timeout

    const cleanup = () => {
      clearTimeout(timeout)
      bc.close()
      setConnecting(false)
    }

    bc.onmessage = (e) => {
      if (e.data?.type !== 'google_oauth') return
      cleanup()
      if (e.data.ok) {
        setPicker({ websiteId: e.data.website_id, email: e.data.email })
      } else {
        toast.error(e.data.msg || 'Kết nối thất bại')
      }
    }

    // Auto-cleanup after 5 minutes (COOP blocks popup.closed check so no interval)
    timeout = setTimeout(() => { cleanup(); toast.error('Hết thời gian kết nối. Vui lòng thử lại.') }, 5 * 60 * 1000)
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Website</h1>
          <p className="text-sm text-gray-500 mt-0.5">Kết nối Google Analytics & Search Console</p>
        </div>
        <button
          onClick={handleConnectGoogle}
          disabled={connecting}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 text-sm font-medium shadow-sm"
        >
          {connecting ? <Loader size={16} className="animate-spin" /> : (
            <svg width="16" height="16" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
          )}
          {connecting ? 'Đang kết nối...' : 'Kết nối Google'}
        </button>
      </div>

      {/* Site picker modal */}
      {picker && (
        <SitePickerModal
          websiteId={picker.websiteId}
          email={picker.email}
          onDone={() => { setPicker(null); refresh() }}
          onCancel={() => setPicker(null)}
        />
      )}

      {/* Website list */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400"><Loader className="animate-spin inline mr-2" size={18} />Đang tải...</div>
      ) : websites.length === 0 ? (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-200">
          <Globe size={48} className="mx-auto text-gray-200 mb-3" />
          <p className="text-gray-500 font-medium">Chưa có website nào</p>
          <p className="text-gray-400 text-sm mt-1">Nhấn "Kết nối Google" để thêm website từ Search Console</p>
        </div>
      ) : (
        <div className="space-y-3">
          {websites.map(site => (
            <WebsiteCard key={site.id} site={site} onRefresh={refresh} />
          ))}
        </div>
      )}

    </div>
  )
}
