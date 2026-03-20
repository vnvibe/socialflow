import { useState } from 'react'
import useAuthStore from '../../store/auth.store'
import AdminSettings from './AdminSettings'
import UserAISettings from './UserAISettings'
import UserApifySettings from './UserApifySettings'

// Admin tabs (full access)
const adminTabs = [
  { key: 'ai', label: 'AI' },
  { key: 'facebook', label: 'Facebook' },
  { key: 'storage', label: 'Lưu trữ (R2)' },
  { key: 'apify', label: 'Apify' },
  { key: 'proxies', label: 'Proxy' },
  { key: 'users', label: 'Người dùng' },
]

// User tabs (limited)
const userTabs = [
  { key: 'ai', label: 'AI' },
  { key: 'apify', label: 'Apify' },
]

export default function Settings() {
  const profile = useAuthStore((s) => s.profile)
  const isAdmin = profile?.role === 'admin'

  if (isAdmin) {
    // Admin sees the full AdminSettings
    return <AdminSettings />
  }

  // Non-admin user sees limited settings
  return <UserSettings />
}

function UserSettings() {
  const [activeTab, setActiveTab] = useState('ai')

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Cài đặt</h1>
      <p className="text-sm text-gray-500 mb-6">
        Cấu hình API key riêng cho tài khoản của bạn. Để trống sẽ dùng cài đặt mặc định của hệ thống.
      </p>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {userTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'ai' && <UserAISettings />}
      {activeTab === 'apify' && <UserApifySettings />}
    </div>
  )
}
