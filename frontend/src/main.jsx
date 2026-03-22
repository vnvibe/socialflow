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

// Persist cache vào localStorage — sống qua reload trang
const persister = createSyncStoragePersister({
  storage: window.localStorage,
  key: 'sf-cache',
  throttleTime: 3000, // write localStorage tối đa 1 lần/3s
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
