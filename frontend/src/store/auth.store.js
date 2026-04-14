import { create } from 'zustand'
import api from '../lib/api'

let authInitialized = false

const useAuthStore = create((set) => ({
  user: null,
  profile: null,
  loading: true,

  init: async () => {
    if (authInitialized) return
    authInitialized = true

    try {
      const token = localStorage.getItem('sf_token')
      if (!token) {
        set({ loading: false })
        return
      }

      // Verify token + fetch profile from API
      const { data } = await api.get('/auth/me')
      if (data?.user) {
        set({ user: data.user, profile: data.user, loading: false })
      } else {
        localStorage.removeItem('sf_token')
        set({ loading: false })
      }
    } catch (err) {
      console.error('Auth init failed:', err)
      localStorage.removeItem('sf_token')
      set({ loading: false })
    }
  },

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password })
    if (!data?.token) throw new Error('Login failed')

    localStorage.setItem('sf_token', data.token)

    // Fetch full profile
    const { data: me } = await api.get('/auth/me')
    set({ user: me.user, profile: me.user })

    return data
  },

  logout: async () => {
    try { await api.post('/auth/logout') } catch {}
    localStorage.removeItem('sf_token')
    set({ user: null, profile: null })
  },

  isAdmin: () => {
    const state = useAuthStore.getState()
    return state.profile?.role === 'admin'
  }
}))

export default useAuthStore
