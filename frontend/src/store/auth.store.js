import { create } from 'zustand'
import { supabase } from '../lib/supabase'

let authInitialized = false
let authSubscription = null

const useAuthStore = create((set) => ({
  user: null,
  profile: null,
  loading: true,

  init: async () => {
    if (authInitialized) return
    authInitialized = true

    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()

        set({ user: session.user, profile, loading: false })
      } else {
        set({ loading: false })
      }

      if (authSubscription) {
        authSubscription.unsubscribe()
      }

      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (session?.user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()
          set({ user: session.user, profile })
        } else {
          set({ user: null, profile: null })
        }
      })
      authSubscription = subscription
    } catch (err) {
      console.error('Auth init failed:', err)
      set({ loading: false })
    }
  },

  login: async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error

    // Check if account is approved
    if (data.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_active')
        .eq('id', data.user.id)
        .single()

      if (profile && !profile.is_active) {
        await supabase.auth.signOut()
        throw new Error('Tài khoản chưa được phê duyệt. Vui lòng chờ admin duyệt.')
      }
    }

    return data
  },

  logout: async () => {
    await supabase.auth.signOut()
    set({ user: null, profile: null })
  },

  isAdmin: () => {
    const state = useAuthStore.getState()
    return state.profile?.role === 'admin'
  }
}))

export default useAuthStore
