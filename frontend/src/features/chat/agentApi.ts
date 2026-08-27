export type AgentMode = 'dry_run' | 'openai' | 'webhook' | 'cursor_sdk' | 'dsh_agent'

export interface AgentConfigPublic {
  mode: AgentMode
  baseUrl: string
  path: string
  model: string
  systemPrompt: string
  apiKeySet?: boolean
  apiKeyMasked?: string
}

export interface AgentConfigInput {
  mode: AgentMode
  baseUrl: string
  path: string
  model: string
  systemPrompt: string
  apiKey?: string
}

export interface AgentProbeResult {
  ok: boolean
  mode?: string
  message?: string
  error?: string
  authWarning?: boolean
  url?: string
  httpStatus?: number
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string }
  if (!res.ok && data && data.ok === undefined) {
    ;(data as { ok: boolean }).ok = false
  }
  return data
}

export function fetchAgentConfig() {
  return api<{ ok: boolean; config: AgentConfigPublic; error?: string }>('/api/agent/config')
}

export function saveAgentConfig(config: Partial<AgentConfigInput>) {
  return api<{ ok: boolean; config: AgentConfigPublic; error?: string }>('/api/agent/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  })
}

export function probeAgentConnection(config: Partial<AgentConfigInput>) {
  return api<AgentProbeResult>('/api/agent/probe', {
    method: 'POST',
    body: JSON.stringify({ config }),
  })
}

export function needsAgentUrl(mode: AgentMode): boolean {
  return mode === 'openai' || mode === 'webhook' || mode === 'dsh_agent'
}

export function defaultAgentPath(mode: AgentMode): string {
  if (mode === 'dsh_agent') return '/agent/run'
  return '/chat/completions'
}

export function defaultAgentBaseUrl(mode: AgentMode): string {
  if (mode === 'dsh_agent') return 'http://127.0.0.1:8790'
  return ''
}
