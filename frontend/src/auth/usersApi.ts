export type UserRole = 'admin' | 'eval' | 'guest'

export type ManagedUser = {
  username: string
  role: UserRole
  enabled: boolean
  online?: boolean
}

type UsersResponse = { ok: boolean; users?: ManagedUser[]; error?: string }
type UserResponse = { ok: boolean; user?: ManagedUser; error?: string }

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(text || `HTTP ${res.status}`)
  }
}

export async function fetchUsers(): Promise<ManagedUser[]> {
  const res = await fetch('/api/users', { cache: 'no-store', credentials: 'same-origin' })
  const data = await parseJson<UsersResponse>(res)
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data.users ?? []
}

export async function createUser(body: {
  username: string
  password: string
  role: UserRole
}): Promise<ManagedUser> {
  const res = await fetch('/api/users', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await parseJson<UserResponse>(res)
  if (!res.ok || !data.ok || !data.user) throw new Error(data.error || `HTTP ${res.status}`)
  return data.user
}

export async function updateUser(
  username: string,
  patch: Partial<{ role: UserRole; enabled: boolean; password: string }>,
): Promise<ManagedUser> {
  const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const data = await parseJson<UserResponse>(res)
  if (!res.ok || !data.ok || !data.user) throw new Error(data.error || `HTTP ${res.status}`)
  return data.user
}

export async function deleteUser(username: string): Promise<void> {
  const res = await fetch(`/api/users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  const data = await parseJson<{ ok: boolean; error?: string }>(res)
  if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`)
}
