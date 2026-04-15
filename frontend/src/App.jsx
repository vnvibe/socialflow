import { useEffect, useState, Component } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import useAuthStore from './store/auth.store'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import HermesLayout from './components/hermes/HermesLayout'
import HermesBrain from './pages/hermes/HermesBrain'
import CommandCenter from './pages/dashboard/CommandCenter'
import AgentsRoster from './pages/agents/AgentsRoster'
import MissionBoard from './pages/campaigns/MissionBoard'
import SignalWall from './pages/monitor/SignalWall'
import Login from './pages/auth/Login'
import Register from './pages/auth/Register'
import Dashboard from './pages/dashboard/Dashboard'
import AccountList from './pages/accounts/AccountList'
import AccountDetail from './pages/accounts/AccountDetail'
import PageList from './pages/pages-manager/PageList'
import InboxView from './pages/pages-manager/InboxView'
import GroupList from './pages/groups/GroupList'
import MediaLibrary from './pages/media/MediaLibrary'
import VideoEditor from './pages/media/VideoEditor'
import ContentComposer from './pages/content/ContentComposer'
import ContentList from './pages/content/ContentList'
import UnifiedPublish from './pages/publish/UnifiedPublish'
import Monitor from './pages/monitor/Monitor'
import CampaignManager from './pages/publish/CampaignManager'
import CampaignCalendar from './pages/publish/CampaignCalendar'
import TrendCenter from './pages/trends/TrendCenter'
import Analytics from './pages/analytics/Analytics'
import InboxPage from './pages/inbox/InboxPage'
import AdminSettings from './pages/settings/AdminSettings'
import Settings from './pages/settings/Settings'
import WebsiteSettings from './pages/settings/WebsiteSettings'
import WebsiteReport from './pages/websites/WebsiteReport'
import OAuthCallback from './pages/OAuthCallback'
import GoogleCallbackRelay from './pages/GoogleCallbackRelay'
import CampaignList from './pages/campaigns/CampaignList'
import CampaignForm from './pages/campaigns/CampaignForm'
import CampaignDetail from './pages/campaigns/CampaignDetail'
import AccountHealth from './pages/accounts/AccountHealth'
import DataCenter from './pages/data-center/DataCenter'
import NickNurture from './pages/nick-nurture/NickNurture'
import GroupMonitor from './pages/groups/GroupMonitor'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(error) { return { error } }
  render() {
    if (this.state.error) return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center p-8">
          <p className="text-red-500 font-medium mb-2">Đã xảy ra lỗi không mong muốn</p>
          <p className="text-gray-500 text-sm mb-4">{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 bg-blue-500 text-white rounded text-sm">Tải lại trang</button>
        </div>
      </div>
    )
    return this.props.children
  }
}

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>
  if (!user) return <Navigate to="/login" />
  return children
}

function AppLayout({ children }) {
  // New Hermes-centric layout (dark terminal aesthetic)
  return (
    <HermesLayout>
      <ErrorBoundary>{children}</ErrorBoundary>
    </HermesLayout>
  )
}

export default function App() {
  const init = useAuthStore((s) => s.init)

  useEffect(() => { init() }, [init])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/oauth-callback" element={<OAuthCallback />} />
        <Route path="/websites/google/callback" element={<GoogleCallbackRelay />} />
        <Route path="/*" element={
          <ProtectedRoute>
            <AppLayout>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" />} />
                {/* ── Hermes UI pages (new) ── */}
                <Route path="/dashboard" element={<CommandCenter />} />
                <Route path="/agents" element={<AgentsRoster />} />
                <Route path="/campaigns" element={<MissionBoard />} />
                <Route path="/monitor" element={<SignalWall />} />
                <Route path="/hermes" element={<HermesBrain />} />

                {/* ── Legacy dashboard fallback ── */}
                <Route path="/dashboard-legacy" element={<Dashboard />} />
                <Route path="/campaigns-legacy" element={<CampaignList />} />
                <Route path="/monitor-legacy" element={<Monitor />} />

                {/* ── Unchanged existing pages ── */}
                <Route path="/accounts" element={<AccountList />} />
                <Route path="/accounts/:id" element={<AccountDetail />} />
                <Route path="/pages" element={<PageList />} />
                <Route path="/pages/:id/inbox" element={<InboxView />} />
                <Route path="/groups" element={<GroupList />} />
                <Route path="/media" element={<MediaLibrary />} />
                <Route path="/media/:id/edit" element={<VideoEditor />} />
                <Route path="/content" element={<ContentList />} />
                <Route path="/content/new" element={<ContentComposer />} />
                <Route path="/publish" element={<UnifiedPublish />} />
                <Route path="/inbox" element={<InboxPage />} />
                <Route path="/campaigns/new" element={<CampaignForm />} />
                <Route path="/campaigns/:id" element={<CampaignDetail />} />
                <Route path="/campaigns/:id/edit" element={<CampaignForm />} />
                <Route path="/campaigns/old" element={<CampaignManager />} />
                <Route path="/health" element={<AccountHealth />} />
                <Route path="/nick-nurture" element={<NickNurture />} />
                <Route path="/calendar" element={<CampaignCalendar />} />
                <Route path="/trends" element={<TrendCenter />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/data-center" element={<DataCenter />} />
                <Route path="/group-monitor" element={<GroupMonitor />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/settings/admin" element={<AdminSettings />} />
                <Route path="/settings/websites" element={<WebsiteSettings />} />
                <Route path="/websites/:id/report" element={<WebsiteReport />} />
                <Route path="/settings/ai" element={<Navigate to="/settings/admin" />} />
                <Route path="/settings/proxies" element={<Navigate to="/settings/admin" />} />
                <Route path="/settings/users" element={<Navigate to="/settings/admin" />} />
              </Routes>
            </AppLayout>
          </ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  )
}
