import { useEffect, useState } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import useAuthStore from './store/auth.store'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
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

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>
  if (!user) return <Navigate to="/login" />
  return children
}

function AppLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-40 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}
      {/* Sidebar */}
      <div className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 md:relative md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <Sidebar onClose={() => setSidebarOpen(false)} />
      </div>
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <TopBar onMenuToggle={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 overflow-auto p-3 sm:p-6">
          {children}
        </main>
      </div>
    </div>
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
        <Route path="/*" element={
          <ProtectedRoute>
            <AppLayout>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" />} />
                <Route path="/dashboard" element={<Dashboard />} />
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
                <Route path="/pages/:id/inbox" element={<Navigate to="/inbox" />} />
                <Route path="/monitor" element={<Monitor />} />
                <Route path="/campaigns" element={<CampaignManager />} />
                <Route path="/calendar" element={<CampaignCalendar />} />
                <Route path="/trends" element={<TrendCenter />} />
                <Route path="/analytics" element={<Analytics />} />
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
