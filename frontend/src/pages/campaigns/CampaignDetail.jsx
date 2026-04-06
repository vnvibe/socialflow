import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Target, ArrowLeft, Play, Pause, Edit,
  BarChart3, Users, UsersRound, PenSquare, Eye,
  Database, FileBarChart, Settings, Loader, Menu, X,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

// Sections (lazy-ish — all imported but only active one renders)
import OverviewSection from './sections/OverviewSection'
import NicksSection from './sections/NicksSection'
import GroupsSection from './sections/GroupsSection'
import ContentSection from './sections/ContentSection'
import MonitorSection from './sections/MonitorSection'
import DataCenterSection from './sections/DataCenterSection'
import ReportsSection from './sections/ReportsSection'
import SettingsSection from './sections/SettingsSection'

const STATUS_CONFIG = {
  idle:      { label: 'Chua chay', color: 'bg-gray-100 text-gray-600' },
  running:   { label: 'Dang chay', color: 'bg-green-100 text-green-700' },
  paused:    { label: 'Tam dung',  color: 'bg-yellow-100 text-yellow-700' },
  completed: { label: 'Hoan thanh', color: 'bg-blue-100 text-blue-700' },
  error:     { label: 'Loi',       color: 'bg-red-100 text-red-700' },
}

const SECTIONS = [
  { key: 'overview',    label: 'Tong quan',   icon: BarChart3 },
  { key: 'nicks',       label: 'Nhan vat',    icon: Users },
  { key: 'groups',      label: 'Nhom',        icon: UsersRound },
  { key: 'content',     label: 'Noi dung',    icon: PenSquare },
  { key: 'monitor',     label: 'Theo doi',    icon: Eye },
  { key: 'datacenter',  label: 'Data Center', icon: Database },
  { key: 'reports',     label: 'Bao cao',     icon: FileBarChart },
  { key: 'settings',    label: 'Cai dat',     icon: Settings },
]

const SECTION_COMPONENTS = {
  overview:   OverviewSection,
  nicks:      NicksSection,
  groups:     GroupsSection,
  content:    ContentSection,
  monitor:    MonitorSection,
  datacenter: DataCenterSection,
  reports:    ReportsSection,
  settings:   SettingsSection,
}

export default function CampaignDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const activeSection = searchParams.get('section') || 'overview'

  const setSection = (key) => {
    setSearchParams({ section: key })
    setSidebarOpen(false)
  }

  // Campaign data — fetched once, shared with all sections
  const { data: campaign, isLoading } = useQuery({
    queryKey: ['campaign', id],
    queryFn: () => api.get(`/campaigns/${id}`).then(r => r.data),
  })

  // Derive account_ids from campaign roles
  const accountIds = useMemo(() => {
    if (!campaign?.campaign_roles) return []
    return [...new Set(campaign.campaign_roles.flatMap(r => r.account_ids || []))]
  }, [campaign])

  const startMut = useMutation({
    mutationFn: () => api.post(`/campaigns/${id}/start`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaign', id] }); toast.success('Da bat dau') },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi'),
  })
  const stopMut = useMutation({
    mutationFn: () => api.post(`/campaigns/${id}/stop`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['campaign', id] }); toast.success('Da tam dung') },
    onError: (err) => toast.error(err.response?.data?.error || 'Loi'),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader className="w-6 h-6 animate-spin text-blue-500" />
      </div>
    )
  }
  if (!campaign) {
    return <div className="text-center py-12 text-gray-400">Khong tim thay chien dich</div>
  }

  const status = STATUS_CONFIG[campaign.status] || STATUS_CONFIG.idle
  const isRunning = campaign.status === 'running' || campaign.is_active
  const SectionComponent = SECTION_COMPONENTS[activeSection] || OverviewSection

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      {/* ─── HEADER ─── */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          {/* Mobile menu toggle */}
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="lg:hidden p-1.5 text-gray-500 hover:text-gray-600"
          >
            <Menu size={20} />
          </button>
          <button onClick={() => navigate('/campaigns')} className="p-1.5 text-gray-500 hover:text-gray-600">
            <ArrowLeft size={20} />
          </button>
          <Target size={22} className="text-purple-600 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-gray-900 truncate">{campaign.name}</h1>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${status.color}`}>
                {status.label}
              </span>
            </div>
            {campaign.topic && (
              <p className="text-xs text-gray-500 truncate">{campaign.topic}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isRunning ? (
            <button
              onClick={() => stopMut.mutate()}
              disabled={stopMut.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-yellow-700 bg-yellow-50 rounded-lg hover:bg-yellow-100 disabled:opacity-50 transition-colors"
            >
              <Pause size={14} /> Dung
            </button>
          ) : (
            <button
              onClick={() => startMut.mutate()}
              disabled={startMut.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-green-700 bg-green-50 rounded-lg hover:bg-green-100 disabled:opacity-50 transition-colors"
            >
              <Play size={14} /> Chay
            </button>
          )}
          <button
            onClick={() => navigate(`/campaigns/${id}/edit`)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <Edit size={14} />
          </button>
        </div>
      </div>

      {/* ─── BODY: SIDEBAR + CONTENT ─── */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/40 z-40 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Left Sidebar Navigation */}
        <aside className={`
          absolute lg:relative inset-y-0 left-0 z-50 lg:z-auto
          w-56 lg:w-52 bg-[#1e293b] flex flex-col shrink-0
          transform transition-transform duration-200
          lg:translate-x-0
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          {/* Mobile close */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 lg:hidden">
            <span className="text-white text-sm font-semibold">Sections</span>
            <button onClick={() => setSidebarOpen(false)} className="text-gray-400 hover:text-white">
              <X size={18} />
            </button>
          </div>

          <nav className="flex-1 overflow-y-auto py-3 space-y-0.5 px-2">
            {SECTIONS.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setSection(key)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  activeSection === key
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-300 hover:bg-slate-700 hover:text-white'
                }`}
              >
                <Icon size={18} className="shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </nav>

          {/* Campaign quick stats */}
          <div className="px-3 py-3 border-t border-slate-700">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Users size={12} />
              <span>{accountIds.length} nicks</span>
              <span className="mx-1">·</span>
              <span>{campaign.campaign_roles?.length || 0} roles</span>
            </div>
          </div>
        </aside>

        {/* Main Content Area */}
        <main className="flex-1 overflow-auto p-4 sm:p-6 bg-gray-50">
          <SectionComponent
            campaignId={id}
            campaign={campaign}
            accountIds={accountIds}
          />
        </main>
      </div>
    </div>
  )
}
