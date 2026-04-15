/**
 * HermesLayout — new shell with HermesBar top + icon-only SideNav left.
 * Replaces old Sidebar/TopBar layout.
 */
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Users, Target, Radio, Mail, FileText,
  Brain, Settings, LogOut, Database, Activity,
} from 'lucide-react'
import HermesBar from './HermesBar'
import useAuthStore from '../../store/auth.store'

const NAV_ITEMS = [
  { to: '/dashboard',     Icon: LayoutDashboard, label: 'Command' },
  { to: '/agents',        Icon: Users,           label: 'Agents' },
  { to: '/campaigns',     Icon: Target,          label: 'Missions' },
  { to: '/monitor',       Icon: Radio,           label: 'Signals' },
  { to: '/inbox',         Icon: Mail,            label: 'Inbox' },
  { to: '/content',       Icon: FileText,        label: 'Content' },
  { to: '/data-center',   Icon: Database,        label: 'Data' },
  { to: '/hermes',        Icon: Brain,           label: 'Hermes Brain' },
  { to: '/analytics',     Icon: Activity,        label: 'Analytics' },
]

function NavItem({ to, Icon, label }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `relative flex items-center justify-center w-16 h-14 group transition-colors ${
          isActive ? 'text-hermes' : 'text-app-muted hover:text-app-primary'
        }`
      }
      title={label}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <span
              className="absolute left-0 top-0 bottom-0 w-0.5 bg-hermes"
            />
          )}
          <Icon size={18} strokeWidth={1.6} />
          {/* Tooltip on hover */}
          <span
            className="absolute left-full ml-2 px-2 py-1 bg-app-elevated text-[11px] font-mono-ui uppercase tracking-wider opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap z-10"
            style={{ border: '1px solid var(--border-bright)' }}
          >
            {label}
          </span>
        </>
      )}
    </NavLink>
  )
}

export default function HermesLayout({ children }) {
  const logout = useAuthStore((s) => s.logout)
  const user = useAuthStore((s) => s.user)

  return (
    <div className="min-h-screen flex flex-col bg-app-base">
      <HermesBar />
      <div className="flex-1 flex">
        {/* Sidebar — 64px, icons only */}
        <aside
          className="flex flex-col items-center bg-app-surface"
          style={{
            width: 64,
            borderRight: '1px solid var(--border)',
          }}
        >
          {/* Logo area */}
          <div
            className="flex items-center justify-center w-16 h-14 text-hermes"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <span className="font-mono-ui text-lg font-bold">⬡</span>
          </div>

          {/* Nav items */}
          <nav className="flex-1 flex flex-col w-full">
            {NAV_ITEMS.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </nav>

          {/* Bottom: settings + logout */}
          <div className="w-full" style={{ borderTop: '1px solid var(--border)' }}>
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                `flex items-center justify-center w-16 h-14 ${
                  isActive ? 'text-hermes' : 'text-app-muted hover:text-app-primary'
                }`
              }
              title="Settings"
            >
              <Settings size={18} strokeWidth={1.6} />
            </NavLink>
            <button
              onClick={logout}
              className="flex items-center justify-center w-16 h-14 text-app-muted hover:text-danger"
              title={`Logout ${user?.email || ''}`}
            >
              <LogOut size={18} strokeWidth={1.6} />
            </button>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 overflow-auto" style={{ minWidth: 0 }}>
          {children}
        </main>
      </div>
    </div>
  )
}
