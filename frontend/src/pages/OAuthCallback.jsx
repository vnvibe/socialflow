import { useEffect } from 'react'

// This page is opened in a popup after Google OAuth redirect.
// It uses BroadcastChannel (same origin as parent) to send results,
// bypassing Cross-Origin-Opener-Policy that blocks window.opener.postMessage.
export default function OAuthCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const error = params.get('error')
    const website_id = params.get('website_id')
    const email = params.get('email')

    const msg = error
      ? { type: 'google_oauth', ok: false, msg: decodeURIComponent(error) }
      : { type: 'google_oauth', ok: true, website_id, email: decodeURIComponent(email || '') }

    try {
      const bc = new BroadcastChannel('google_oauth')
      bc.postMessage(msg)
      bc.close()
    } catch (e) {}

    setTimeout(() => { try { window.close() } catch (e) {} }, 300)
  }, [])

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem', textAlign: 'center' }}>
      <p style={{ color: '#555' }}>Đang hoàn tất kết nối...</p>
    </div>
  )
}
