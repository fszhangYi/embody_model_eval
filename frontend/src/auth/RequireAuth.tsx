import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, authRequired, authenticated } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="auth-boot" role="status" aria-live="polite">
        <div className="auth-boot-mark" aria-hidden="true" />
        <p>正在校验会话…</p>
      </div>
    )
  }

  if (authRequired && !authenticated) {
    const next = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to="/login" replace state={{ from: next }} />
  }

  return children
}
