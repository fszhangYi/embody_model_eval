import type { ActLinkStatus, PipelineJob, PipelineSpec } from './types'
import type { FsEntry, FsListResponse } from './types'

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

export function fetchPipelineSpec(actRoot?: string, embodyRoot?: string) {
  const qs = new URLSearchParams()
  if (actRoot) qs.set('actRoot', actRoot)
  if (embodyRoot) qs.set('embodyRoot', embodyRoot)
  const q = qs.toString()
  return api<PipelineSpec>(`/api/act-pipeline/spec${q ? `?${q}` : ''}`)
}

export function fetchJobs() {
  return api<{ ok: boolean; jobs: PipelineJob[] }>('/api/act-pipeline/jobs')
}

export function fetchJob(id: string) {
  return api<{ ok: boolean; job: PipelineJob }>(
    `/api/act-pipeline/jobs/${encodeURIComponent(id)}`,
  )
}

export function createActLink(embodyRoot: string, actRoot: string) {
  return api<ActLinkStatus>('/api/act-pipeline/link', {
    method: 'POST',
    body: JSON.stringify({ embodyRoot, actRoot }),
  })
}

export function removeActLink(embodyRoot: string) {
  return api<{ ok: boolean; removed: boolean }>(
    `/api/act-pipeline/link?embodyRoot=${encodeURIComponent(embodyRoot)}`,
    { method: 'DELETE' },
  )
}

export function runPipelineStep(
  stepId: string,
  params: Record<string, unknown>,
  actRoot: string,
  embodyRoot: string,
) {
  return api<{ ok: boolean; job: PipelineJob }>('/api/act-pipeline/run', {
    method: 'POST',
    body: JSON.stringify({ stepId, params, actRoot, embodyRoot }),
  })
}

export function cancelJob(id: string) {
  return api<{ ok: boolean; job: PipelineJob }>(
    `/api/act-pipeline/jobs/${encodeURIComponent(id)}/cancel`,
    { method: 'POST' },
  )
}

export function deleteJob(id: string) {
  return api<{ ok: boolean; deleted: string }>(
    `/api/act-pipeline/jobs/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export function fetchFsChildren(rootKey: string, path = '', rootPath?: string) {
  const qs = new URLSearchParams({ root: rootKey })
  if (path) qs.set('path', path)
  if (rootPath) qs.set('rootPath', rootPath)
  return api<FsListResponse>(`/api/fs/children?${qs}`)
}

export type { FsEntry, FsListResponse }
