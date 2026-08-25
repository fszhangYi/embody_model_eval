import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import '../styles/login.css'

type LocState = { from?: string }

export function LoginPage() {
  const { loading, authRequired, authenticated, login, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = useMemo(() => {
    const st = location.state as LocState | null
    const raw = st?.from || '/'
    if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/login')) return '/'
    return raw
  }, [location.state])

  const [username, setUsername] = useState('embody')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user?.username) setUsername(user.username)
  }, [user])

  if (loading) {
    return (
      <div className="auth-boot" role="status" aria-live="polite">
        <div className="auth-boot-mark" aria-hidden="true" />
        <p>正在加载…</p>
      </div>
    )
  }

  if (!authRequired || authenticated) {
    return <Navigate to={from} replace />
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const out = await login(username.trim(), password)
      if (!out.ok) {
        setError(out.error || '登录失败')
        return
      }
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-bg" aria-hidden="true">
        <div className="login-grid" />
        <div className="login-orb login-orb-a" />
        <div className="login-orb login-orb-b" />
        <div className="login-scan" />
      </div>

      <header className="login-brand">
        <img src="/assets/favicon.svg" alt="" width={48} height={48} className="login-logo" />
        <span className="login-brand-name">Embody Model Eval</span>
      </header>

      <main className="login-main">
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-card-shine" aria-hidden="true" />
          <h1 id="login-title">登录到 Embody</h1>
          <p className="login-sub">项目总览 · 评测可视化 · ACT 流水线 · 传感器</p>

          <form className="login-form" onSubmit={onSubmit} autoComplete="on">
            <label className="login-field">
              <span>用户名</span>
              <input
                name="username"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={busy}
                required
              />
            </label>

            <label className="login-field">
              <span className="login-field-row">
                <span>密码</span>
                <button
                  type="button"
                  className="login-ghost"
                  onClick={() => setShowPw((v) => !v)}
                  tabIndex={-1}
                >
                  {showPw ? '隐藏' : '显示'}
                </button>
              </span>
              <input
                name="password"
                type={showPw ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={busy}
                required
              />
            </label>

            {error ? (
              <div className="login-error" role="alert">
                {error}
              </div>
            ) : null}

            <button type="submit" className="login-submit" disabled={busy}>
              {busy ? '登录中…' : '登录'}
            </button>
          </form>
        </section>

        <aside className="login-aside">
          <p>
            默认用户 <code>embody</code>；密码见启动日志或 <code>config/.auth.json</code>。
          </p>
          <p className="login-aside-muted">会话 Cookie · HttpOnly · 7 天有效</p>
        </aside>
      </main>

      <footer className="login-footer">
        <span>Embody Model Eval</span>
        <span className="login-footer-dot" aria-hidden="true">
          ·
        </span>
        <span>本地评测控制台</span>
      </footer>
    </div>
  )
}
