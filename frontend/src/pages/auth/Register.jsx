import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader, CheckCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'

const inputCls = "w-full px-3 py-2 text-sm focus:outline-none font-mono-ui"
const inputStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 4 }
const labelCls = "block text-[10px] uppercase tracking-wider text-app-muted font-mono-ui mb-1.5"

function Shell({ children }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: 'var(--bg-base)' }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-8">
          <div
            className="w-9 h-9 flex items-center justify-center font-mono-ui font-bold text-sm"
            style={{ background: 'var(--hermes-dim)', color: 'var(--hermes)', borderRadius: 4 }}
          >
            SF
          </div>
          <span className="text-xl font-semibold text-app-primary tracking-tight">SocialFlow</span>
        </div>
        <div className="p-8" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4 }}>
          {children}
        </div>
      </div>
    </div>
  )
}

export default function Register() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) { toast.error('Vui lòng nhập email và mật khẩu'); return }
    if (password.length < 6) { toast.error('Mật khẩu tối thiểu 6 ký tự'); return }

    setLoading(true)
    try {
      await api.post('/auth/register', { email, password, display_name: displayName })
      setSuccess(true)
    } catch (err) {
      toast.error(err.response?.data?.error || 'Đăng ký thất bại')
    } finally { setLoading(false) }
  }

  if (success) {
    return (
      <Shell>
        <div className="text-center">
          <CheckCircle className="w-12 h-12 text-hermes mx-auto mb-4" />
          <div className="text-[10px] uppercase tracking-wider text-app-muted font-mono-ui mb-1">Đã đăng ký</div>
          <h1 className="text-lg font-semibold text-app-primary mb-3">Đăng ký thành công</h1>
          <p className="text-sm text-app-muted mb-6">
            Tài khoản của bạn đang chờ admin phê duyệt.<br />
            Bạn sẽ nhận thông báo khi được kích hoạt.
          </p>
          <Link to="/login" className="text-hermes hover:opacity-80 font-medium text-sm">
            Quay lại đăng nhập →
          </Link>
        </div>
      </Shell>
    )
  }

  return (
    <Shell>
      <div className="text-[10px] uppercase tracking-wider text-app-muted font-mono-ui mb-1">Đăng ký</div>
      <p className="text-sm text-app-muted mb-6">Tạo tài khoản SocialFlow</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="displayName" className={labelCls}>Tên hiển thị</label>
          <input
            id="displayName" type="text"
            value={displayName} onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Tên của bạn"
            className={inputCls} style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="email" className={labelCls}>Email</label>
          <input
            id="email" type="email" autoComplete="email" required
            value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputCls} style={inputStyle}
          />
        </div>

        <div>
          <label htmlFor="password" className={labelCls}>Mật khẩu</label>
          <input
            id="password" type="password" autoComplete="new-password" required
            value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Tối thiểu 6 ký tự"
            className={inputCls} style={inputStyle}
          />
        </div>

        <button
          type="submit" disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold disabled:opacity-50"
          style={{ background: 'var(--hermes)', color: '#000', borderRadius: 4 }}
        >
          {loading && <Loader className="w-4 h-4 animate-spin" />}
          {loading ? 'Đang đăng ký…' : 'Đăng ký'}
        </button>
      </form>

      <p className="text-sm text-app-muted text-center mt-6">
        Đã có tài khoản?{' '}
        <Link to="/login" className="text-hermes hover:opacity-80 font-medium">
          Đăng nhập
        </Link>
      </p>
    </Shell>
  )
}
