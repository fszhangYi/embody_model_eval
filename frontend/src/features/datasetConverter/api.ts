import type {
  ConvertOptions,
  ConvertResult,
  ConverterSpec,
  DatasetFormatId,
  DetectResult,
  InspectResult,
} from './types'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) {
    throw new Error(data.error || `${path} HTTP ${res.status}`)
  }
  return data
}

export function fetchConverterSpec() {
  return api<ConverterSpec>('/api/dataset-converter/spec')
}

export function detectEpisodePath(path: string) {
  return api<DetectResult>('/api/dataset-converter/detect', {
    method: 'POST',
    body: JSON.stringify({ path }),
  })
}

export function inspectPath(path: string, formatHint?: DatasetFormatId) {
  return api<InspectResult>('/api/dataset-converter/inspect', {
    method: 'POST',
    body: JSON.stringify({ path, format: formatHint }),
  })
}

export function convertEpisode(payload: {
  sourcePath: string
  sourceFormat: DatasetFormatId
  targetFormat: DatasetFormatId
  options?: ConvertOptions
}) {
  return api<ConvertResult>('/api/dataset-converter/convert', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
