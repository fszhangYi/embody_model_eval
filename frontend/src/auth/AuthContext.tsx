import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  fetchAuthMe,
  login as apiLogin,
  logout as apiLogout,
  type AuthUser,
} from './api'

type AuthState = {
  loading: boolean
  authRequired: boolean
  authenticated: boolean
  user: AuthUser | null
  refresh: () => Promise<void>
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [authRequired, setAuthRequired] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)

  const refresh = useCallback(async () => {
    try {
      const me = await fetchAuthMe()
      setAuthRequired(Boolean(me.authRequired))
      setAuthenticated(Boolean(me.authenticated) || !me.authRequired)
      setUser(me.user ?? null)
    } catch {
      // Server down / first paint: keep requiring auth so we don't leak UI
      setAuthRequired(true)
      setAuthenticated(false)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(
    async (username: string, password: string) => {
      const out = await apiLogin(username, password)
      if (!out.ok) {
        return { ok: false, error: out.error }
      }
      setAuthRequired(Boolean(out.authRequired))
      setAuthenticated(true)
      setUser(out.user ?? (username ? { username } : null))
      return { ok: true }
    },
    [],
  )

  const logout = useCallback(async () => {
    try {
      await apiLogout()
    } finally {
      setAuthenticated(false)
      setUser(null)
      await refresh()
    }
  }, [refresh])

  const value = useMemo(
    () => ({
      loading,
      authRequired,
      authenticated,
      user,
      refresh,
      login,
      logout,
    }),
    [loading, authRequired, authenticated, user, refresh, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
