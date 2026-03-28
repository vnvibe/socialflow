import { useEffect } from 'react'
import { API_BASE } from '../lib/api'

/**
 * Google OAuth relay page — mounted at /websites/google/callback
 * Google redirects here with ?code=...&state=...
 * We immediately forward to Railway API to exchange code for tokens.
 */
export default function GoogleCallbackRelay() {
  useEffect(() => {
    window.location.replace(`${API_BASE}/websites/google/callback${window.location.search}`)
  }, [])

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', textAlign: 'center' }}>
      <p style={{ color: '#555' }}>Đang xử lý kết nối Google...</p>
    </div>
  )
}
