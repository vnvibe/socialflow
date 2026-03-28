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
supabase.auth.getSession().then(({ data: { session } }) => {
  _cachedToken = session?.access_token || null
})
supabase.auth.onAuthStateChange((_event, session) => {
  _cachedToken = session?.access_token || null
})

api.interceptors.request.use(async (config) => {
  if (!_cachedToken) {
    const { data: { session } } = await supabase.auth.getSession()
    _cachedToken = session?.access_token || null
  }
  if (_cachedToken) {
    config.headers.Authorization = `Bearer ${_cachedToken}`
  }
  return config
})

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      supabase.auth.signOut()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

export default api
