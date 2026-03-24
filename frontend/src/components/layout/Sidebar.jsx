import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  FileText,
  UsersRound,
  Film,
  PenSquare,
  Send,
  Inbox,
  Eye,
  Megaphone,
  TrendingUp,
  BarChart3,
  CalendarDays,
  Settings,
  Globe,
  Activity,
} from 'lucide-react'
import useAuthStore from '../../store/auth.store'

const mainLinks = [
  { to: '/dashboard', label: 'Tổng quan', icon: LayoutDashboard },
  { to: '/accounts', label: 'Tài khoản', icon: Users },
  { to: '/pages', label: 'Fanpage', icon: FileText },
  { to: '/groups', label: 'Nhóm', icon: UsersRound },
  { to: '/media', label: 'Thư viện', icon: Film },
  { to: '/content', label: 'Nội dung', icon: PenSquare },
  { to: '/publish', label: 'Đăng bài', icon: Send },
  { to: '/inbox', label: 'Hộp thư', icon: Inbox },
  { to: '/monitor', label: 'Theo dõi', icon: Eye },
  { to: '/campaigns', label: 'Chiến dịch', icon: Megaphone },
  { to: '/health', label: 'Sức khỏe', icon: Activity },
  { to: '/calendar', label: 'Lịch', icon: CalendarDays },
  { to: '/trends', label: 'Xu hướng', icon: TrendingUp },
  { to: '/analytics', label: 'Thống kê', icon: BarChart3 },
  { to: '/settings/websites', label: 'Website', icon: Globe },
]

const settingsLinks = []

export default function Sidebar({ onClose }) {
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
          <NavLink key={link.to} to={link.to} className={linkClasses} onClick={onClose}>
            <link.icon className="w-5 h-5 shrink-0" />
            {link.label}
          </NavLink>
        ))}

        {/* Separator */}
        <div className="border-t border-slate-700 my-4" />

        {isAdmin ? (
          <NavLink to="/settings/admin" className={linkClasses} onClick={onClose}>
            <Settings className="w-5 h-5 shrink-0" />
            Cài đặt hệ thống
          </NavLink>
        ) : (
          <NavLink to="/settings" className={linkClasses} onClick={onClose}>
            <Settings className="w-5 h-5 shrink-0" />
            Cài đặt
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
