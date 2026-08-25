import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useLocale } from '../i18n/LocaleContext'
import type { Locale } from '../i18n/types'
import '../styles/login.css'

type LocState = { from?: string }

export function LoginPage() {
  const { loading, authRequired, authenticated, login, user } = useAuth()
  const { m, locale, setLocale } = useLocale()
  const loginCopy = m.login
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
        <p>{loginCopy.loading}</p>
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
        const raw = out.error || ''
        setError(!raw || /^HTTP \d+$/.test(raw) ? loginCopy.fail : raw)
        return
      }
      navigate(from, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : loginCopy.networkError)
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
        <div className="login-lang" role="group" aria-label={m.settings.language.ui}>
          {(['zh', 'en'] as Locale[]).map((id) => (
            <button
              key={id}
              type="button"
              className={`login-lang-btn${locale === id ? ' active' : ''}`}
              aria-pressed={locale === id}
              onClick={() => setLocale(id)}
            >
              {id === 'zh' ? '中文' : 'English'}
            </button>
          ))}
        </div>
      </header>

      <main className="login-main">
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-card-shine" aria-hidden="true" />
          <h1 id="login-title">{loginCopy.title}</h1>
          <p className="login-sub">{loginCopy.sub}</p>

          <form className="login-form" onSubmit={onSubmit} autoComplete="on">
            <label className="login-field">
              <span>{loginCopy.username}</span>
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
                <span>{loginCopy.password}</span>
                <button
                  type="button"
                  className="login-ghost"
                  onClick={() => setShowPw((v) => !v)}
                  tabIndex={-1}
                >
                  {showPw ? loginCopy.hide : loginCopy.show}
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
              {busy ? loginCopy.submitting : loginCopy.submit}
            </button>
          </form>
        </section>

        <aside className="login-aside">
          <p>{loginCopy.aside}</p>
          <p className="login-aside-muted">{loginCopy.asideMuted}</p>
        </aside>
      </main>

      <footer className="login-footer">
        <span>Embody Model Eval</span>
        <span className="login-footer-dot" aria-hidden="true">
          ·
        </span>
        <span>{loginCopy.footerTag}</span>
      </footer>
    </div>
  )
}
