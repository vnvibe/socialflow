import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  FileText,
  UsersRound,
  Film,
  PenSquare,
  Send,
  Megaphone,
  TrendingUp,
  BarChart3,
  Brain,
  Shield,
  UserCog,
} from 'lucide-react'
import useAuthStore from '../../store/auth.store'

const mainLinks = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/accounts', label: 'Accounts', icon: Users },
  { to: '/pages', label: 'Pages', icon: FileText },
  { to: '/groups', label: 'Groups', icon: UsersRound },
  { to: '/media', label: 'Media', icon: Film },
  { to: '/content', label: 'Content', icon: PenSquare },
  { to: '/publish', label: 'Publish', icon: Send },
  { to: '/campaigns', label: 'Campaigns', icon: Megaphone },
  { to: '/trends', label: 'Trends', icon: TrendingUp },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
]

const settingsLinks = [
  { to: '/settings/ai', label: 'AI Settings', icon: Brain },
  { to: '/settings/proxies', label: 'Proxies', icon: Shield },
]

export default function Sidebar() {
  const profile = useAuthStore((s) => s.profile)
  const isAdmin = profile?.role === 'admin'

  const linkClasses = ({ isActive }) =>
    `flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-blue-600 text-white'
        : 'text-slate-300 hover:bg-slate-700 hover:text-white'
    }`

  return (
    <aside className="w-64 bg-[#1e293b] flex flex-col h-full shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-700">
        <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
          <Send className="w-4 h-4 text-white" />
        </div>
        <span className="text-white text-lg font-bold tracking-tight">
          SocialFlow
        </span>
      </div>

      {/* Main navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {mainLinks.map((link) => (
          <NavLink key={link.to} to={link.to} className={linkClasses}>
            <link.icon className="w-5 h-5 shrink-0" />
            {link.label}
          </NavLink>
        ))}

        {/* Separator */}
        <div className="border-t border-slate-700 my-4" />

        {settingsLinks.map((link) => (
          <NavLink key={link.to} to={link.to} className={linkClasses}>
            <link.icon className="w-5 h-5 shrink-0" />
            {link.label}
          </NavLink>
        ))}

        {isAdmin && (
          <NavLink to="/settings/users" className={linkClasses}>
            <UserCog className="w-5 h-5 shrink-0" />
            Users
          </NavLink>
        )}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-700">
        <p className="text-xs text-slate-500">SocialFlow v1.0</p>
      </div>
    </aside>
  )
}
