import { useEffect } from 'react'

/**
 * Google OAuth relay page — mounted at /websites/google/callback
 * Google redirects here with ?code=...&state=...
 * We immediately forward to Railway API to exchange code for tokens.
 */
export default function GoogleCallbackRelay() {
  useEffect(() => {
    const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3000'
    window.location.replace(`${apiBase}/websites/google/callback${window.location.search}`)
  }, [])

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', textAlign: 'center' }}>
      <p style={{ color: '#555' }}>Đang xử lý kết nối Google...</p>
    </div>
  )
}
