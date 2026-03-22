import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient } from '@tanstack/react-query'
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client'
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,   // 5 phút — không refetch nếu data còn mới
      gcTime: 30 * 60 * 1000,     // 30 phút — giữ cache trong memory
      retry: 1,
      refetchOnWindowFocus: false, // không refetch khi switch tab
    }
  }
})

// Lấy userId từ Supabase session trong localStorage (sync, không cần await)
function getStoredUserId() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k?.includes('-auth-token')) {
        const v = JSON.parse(localStorage.getItem(k))
        return v?.user?.id || 'anon'
      }
    }
  } catch {}
  return 'anon'
}

// Storage wrapper scope theo userId — mỗi user có cache riêng, không dính nhau
const userScopedStorage = {
  getItem: (key) => localStorage.getItem(`${key}-${getStoredUserId()}`),
  setItem: (key, value) => localStorage.setItem(`${key}-${getStoredUserId()}`, value),
  removeItem: (key) => localStorage.removeItem(`${key}-${getStoredUserId()}`),
}

// Persist cache vào localStorage — sống qua reload trang, scope theo user
const persister = createSyncStoragePersister({
  storage: userScopedStorage,
  key: 'sf-cache',
  throttleTime: 3000,
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 24 * 60 * 60 * 1000 }} // cache 24h
    >
      <App />
      <Toaster position="top-right" />
    </PersistQueryClientProvider>
  </React.StrictMode>
)
