import axios from 'axios'

let baseURL = import.meta.env.VITE_API_URL || ''
if (baseURL && !baseURL.startsWith('http')) {
  baseURL = `https://${baseURL}`
}

const api = axios.create({ baseURL })

export { baseURL as API_BASE }

// Attach token from localStorage on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('sf_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 401 handler: redirect to login
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      // Don't redirect if already on login page or if this is a login request
      const isLoginRequest = err.config?.url?.includes('/auth/login')
      if (!isLoginRequest && !window.location.pathname.includes('/login')) {
        localStorage.removeItem('sf_token')
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export default api
