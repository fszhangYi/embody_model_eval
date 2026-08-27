export type AuthUser = { username: string; role?: 'admin' | 'eval' | 'guest' }

export type AuthMeResponse = {
  ok: boolean
  authRequired: boolean
  authenticated: boolean
  user: AuthUser | null
  error?: string
}

export type AuthStatusResponse = {
  ok: boolean
  authRequired: boolean
  usernameHint?: string | null
}

export type LoginResponse = {
  ok: boolean
  authRequired?: boolean
  user?: AuthUser | null
  error?: string
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(text || `HTTP ${res.status}`)
  }
}

export async function fetchAuthStatus(): Promise<AuthStatusResponse> {
  const res = await fetch('/api/auth/status', { cache: 'no-store', credentials: 'same-origin' })
  return parseJson(res)
}

export async function fetchAuthMe(): Promise<AuthMeResponse> {
  const res = await fetch('/api/auth/me', { cache: 'no-store', credentials: 'same-origin' })
  return parseJson(res)
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const data = await parseJson<LoginResponse>(res)
  if (!res.ok && !data.error) {
    data.error = `HTTP ${res.status}`
    data.ok = false
  }
  return data
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
}
