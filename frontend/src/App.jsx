import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import useAuthStore from './store/auth.store'
import Sidebar from './components/layout/Sidebar'
import TopBar from './components/layout/TopBar'
import Login from './pages/auth/Login'
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
import PublishQueue from './pages/publish/PublishQueue'
import CampaignManager from './pages/publish/CampaignManager'
import TrendCenter from './pages/trends/TrendCenter'
import Analytics from './pages/analytics/Analytics'
import AISettings from './pages/settings/AISettings'
import ProxyManager from './pages/settings/ProxyManager'
import UserManager from './pages/settings/UserManager'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuthStore()
  if (loading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>
  if (!user) return <Navigate to="/login" />
  return children
}

function AppLayout({ children }) {
  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto p-6">
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
                <Route path="/publish" element={<PublishQueue />} />
                <Route path="/campaigns" element={<CampaignManager />} />
                <Route path="/trends" element={<TrendCenter />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/settings/ai" element={<AISettings />} />
                <Route path="/settings/proxies" element={<ProxyManager />} />
                <Route path="/settings/users" element={<UserManager />} />
              </Routes>
            </AppLayout>
          </ProtectedRoute>
        } />
      </Routes>
    </BrowserRouter>
  )
}
