import type { ModelCompareResult } from './types'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return data as T
}

export function compareCkptDirs(ckptDirs: string[]) {
  return api<ModelCompareResult>('/api/model-analysis/compare', {
    method: 'POST',
    body: JSON.stringify({ ckptDirs }),
  })
}
