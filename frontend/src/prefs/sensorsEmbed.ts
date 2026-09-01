/** Sensors-view iframe embed URL (host settings). */

export const SENSORS_EMBED_URL_KEY = 'embody.sensorsEmbedUrl'

export const DEFAULT_SENSORS_EMBED_URL =
  'https://uu658526-m86b-7fdc269f.weste.seetacloud.com:8443/'

export type SensorsReachability = 'unknown' | 'checking' | 'ok' | 'fail'

export function normalizeSensorsEmbedUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return DEFAULT_SENSORS_EMBED_URL
  let withProto = trimmed
  if (!/^https?:\/\//i.test(withProto)) {
    withProto = `https://${withProto}`
  }
  try {
    const u = new URL(withProto)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return DEFAULT_SENSORS_EMBED_URL
    }
    const path = u.pathname === '/' || u.pathname === '' ? '/' : u.pathname.replace(/\/?$/, '/')
    return `${u.origin}${path}`
  } catch {
    return DEFAULT_SENSORS_EMBED_URL
  }
}

export function sensorsEmbedOrigin(url: string): string {
  try {
    return new URL(normalizeSensorsEmbedUrl(url)).origin
  } catch {
    return new URL(DEFAULT_SENSORS_EMBED_URL).origin
  }
}

export function readStoredSensorsEmbedUrl(): string {
  try {
    const raw = localStorage.getItem(SENSORS_EMBED_URL_KEY)
    if (raw && raw.trim()) return normalizeSensorsEmbedUrl(raw)
  } catch {
    /* ignore */
  }
  return DEFAULT_SENSORS_EMBED_URL
}

export function persistSensorsEmbedUrl(url: string): string {
  const normalized = normalizeSensorsEmbedUrl(url)
  try {
    localStorage.setItem(SENSORS_EMBED_URL_KEY, normalized)
  } catch {
    /* ignore */
  }
  return normalized
}

export type SensorsPingResult = {
  ok: boolean
  status?: number
  url?: string
  probed?: string
  message?: string
  error?: string
}

export async function pingSensorsEmbedUrl(url: string): Promise<SensorsPingResult> {
  const qs = new URLSearchParams({ url: normalizeSensorsEmbedUrl(url) })
  const res = await fetch(`/api/sensors-view/ping?${qs.toString()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
  })
  const text = await res.text()
  try {
    return JSON.parse(text) as SensorsPingResult
  } catch {
    return { ok: false, status: res.status, message: text || `HTTP ${res.status}` }
  }
}
