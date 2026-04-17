import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Loader } from 'lucide-react'
import toast from 'react-hot-toast'
import useAuthStore from '../../store/auth.store'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const login = useAuthStore((s) => s.login)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) { toast.error('Vui lòng nhập email và mật khẩu'); return }
    setLoading(true)
    try {
      await login(email, password)
      toast.success('Welcome back')
      navigate('/dashboard')
    } catch (err) {
      toast.error(err.message || 'Đăng nhập thất bại')
    } finally { setLoading(false) }
  }

  const inputCls = "w-full px-3 py-2 text-sm focus:outline-none font-mono-ui"
  const inputStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 4 }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg-base)' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div
            className="w-9 h-9 flex items-center justify-center font-mono-ui font-bold text-sm"
            style={{ background: 'var(--hermes-dim)', color: 'var(--hermes)', borderRadius: 4 }}
          >
            SF
          </div>
          <span className="text-xl font-semibold text-app-primary tracking-tight">SocialFlow</span>
        </div>

        {/* Card */}
        <div className="p-8" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4 }}>
          <div className="text-[10px] uppercase tracking-wider text-app-muted font-mono-ui mb-1">Đăng nhập</div>
          <p className="text-sm text-app-muted mb-6">Tiếp tục vào hệ thống</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-[10px] uppercase tracking-wider text-app-muted font-mono-ui mb-1.5">
                Email
              </label>
              <input
                id="email" type="email" autoComplete="email"
                value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className={inputCls} style={inputStyle}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-[10px] uppercase tracking-wider text-app-muted font-mono-ui mb-1.5">
                Mật khẩu
              </label>
              <input
                id="password" type="password" autoComplete="current-password"
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className={inputCls} style={inputStyle}
              />
            </div>

            <button
              type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--hermes)', color: '#000', borderRadius: 4 }}
            >
              {loading && <Loader className="w-4 h-4 animate-spin" />}
              {loading ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </button>
          </form>

          <p className="text-sm text-app-muted text-center mt-6">
            Chưa có tài khoản?{' '}
            <Link to="/register" className="text-hermes hover:opacity-80 font-medium">
              Đăng ký
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
