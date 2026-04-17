import { LogOut, User, Menu } from 'lucide-react'
import useAuthStore from '../../store/auth.store'
import AgentStatus from './AgentStatus'
import NotificationBell from './NotificationBell'
import ProactiveAlerts from './ProactiveAlerts'

const roleBadgeColors = {
  admin: 'bg-red-100 text-red-700',
  manager: 'bg-blue-100 text-blue-700',
  user: 'bg-gray-100 text-gray-700',
}

export default function TopBar({ onMenuToggle }) {
  const { profile, logout } = useAuthStore()

  const handleLogout = async () => {
    await logout()
  }

  return (
    <header className="h-14 sm:h-16 bg-white border-b border-gray-200 flex items-center justify-between px-3 sm:px-6 shrink-0">
      <div className="flex items-center gap-2">
        <button onClick={onMenuToggle} className="md:hidden p-2 -ml-1 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100">
          <Menu size={20} />
        </button>
        <AgentStatus />
      </div>

      <ProactiveAlerts />
      <div className="flex items-center gap-4">
        <NotificationBell />
        {/* User info */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-slate-200 flex items-center justify-center">
            <User className="w-4 h-4 text-slate-600" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-700">
              {profile?.username || 'User'}
            </span>
            {profile?.role && (
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  roleBadgeColors[profile.role] || roleBadgeColors.user
                }`}
              >
                {profile.role}
              </span>
            )}
          </div>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors px-3 py-2 rounded-lg hover:bg-gray-100"
        >
          <LogOut className="w-4 h-4" />
          Logout
        </button>
      </div>
    </header>
  )
}
