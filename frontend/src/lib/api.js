import axios from 'axios'
import { supabase } from './supabase'

let baseURL = import.meta.env.VITE_API_URL || ''
if (baseURL && !baseURL.startsWith('http')) {
  baseURL = `https://${baseURL}`
}

const api = axios.create({ baseURL })

export { baseURL as API_BASE }

// Cache token từ auth state — tránh gọi getSession() mỗi request
let _cachedToken = null
let _tokenExpiresAt = 0 // epoch seconds
supabase.auth.getSession().then(({ data: { session } }) => {
  _cachedToken = session?.access_token || null
  _tokenExpiresAt = session?.expires_at || 0
})
supabase.auth.onAuthStateChange((_event, session) => {
  _cachedToken = session?.access_token || null
  _tokenExpiresAt = session?.expires_at || 0
})

api.interceptors.request.use(async (config) => {
  // Proactive refresh: nếu token hết hạn hoặc sắp hết (< 60s) → refresh trước khi gửi
  const nowSec = Math.floor(Date.now() / 1000)
  if (!_cachedToken || (_tokenExpiresAt > 0 && _tokenExpiresAt - nowSec < 60)) {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      // Session thật sự chết → thử refresh 1 lần
      const { data: refreshed } = await supabase.auth.refreshSession()
      _cachedToken = refreshed?.session?.access_token || null
      _tokenExpiresAt = refreshed?.session?.expires_at || 0
    } else {
      _cachedToken = session.access_token
      _tokenExpiresAt = session.expires_at || 0
    }
  }
  if (_cachedToken) {
    config.headers.Authorization = `Bearer ${_cachedToken}`
  }
  return config
})

// 401 handler: thử refresh token 1 lần trước khi kick user ra login.
// Trước đây 1 lần 401 = signOut ngay → đá session liên tục.
let _refreshing = null
api.interceptors.response.use(
  (res) => res,
  async (err) => {
    const original = err.config
    if (err.response?.status === 401 && !original._retried) {
      original._retried = true
      // Coalesce concurrent 401s into a single refresh
      if (!_refreshing) {
        _refreshing = supabase.auth.refreshSession().finally(() => { _refreshing = null })
      }
      const { data: refreshed } = await _refreshing
      if (refreshed?.session?.access_token) {
        _cachedToken = refreshed.session.access_token
        _tokenExpiresAt = refreshed.session.expires_at || 0
        original.headers.Authorization = `Bearer ${_cachedToken}`
        return api(original) // retry với token mới
      }
      // Refresh thất bại → session thật sự chết
      supabase.auth.signOut()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
