import type { ArtifactKey, CkptRun, ModelCompareResult } from './types'

export function firstRun(result: ModelCompareResult | null): CkptRun | null {
  return result?.runs[0] ?? null
}

export function artifactData<T = Record<string, unknown>>(
  run: CkptRun | null,
  key: ArtifactKey,
): T | null {
  if (!run) return null
  const art = run.artifacts[key]
  if (!art?.ok || !art.data) return null
  return art.data as T
}

export function asNumberArray(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => (typeof x === 'number' ? x : Number(x))).filter((x) => !Number.isNaN(x))
}

export interface ExampleQposPreview {
  shape: [number, number]
  preview: number[][]
}

export function parseExampleQpos(v: unknown): ExampleQposPreview | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { shape?: number[]; preview?: number[][] }
  if (Array.isArray(o.preview) && o.preview.length > 0) {
    const rows = o.preview.length
    const cols = o.preview[0]?.length ?? 0
    return { shape: [rows, cols], preview: o.preview }
  }
  if (Array.isArray(v) && v.length > 0 && Array.isArray(v[0])) {
    return { shape: [v.length, (v[0] as unknown[]).length], preview: v as number[][] }
  }
  return null
}

export interface HistoryRecord {
  loss?: number
  l1?: number
  kl?: number
  lr?: number
}

export interface HistoryData {
  train: HistoryRecord[]
  val: HistoryRecord[]
}

export function parseHistoryData(v: unknown): HistoryData | null {
  if (!v || typeof v !== 'object') return null
  const o = v as { train?: HistoryRecord[]; val?: HistoryRecord[] }
  return {
    train: Array.isArray(o.train) ? o.train : [],
    val: Array.isArray(o.val) ? o.val : [],
  }
}

export function bestValEpoch(records: HistoryRecord[]): HistoryRecord & { epoch: number } | null {
  let best: (HistoryRecord & { epoch: number }) | null = null
  records.forEach((r, i) => {
    if (typeof r.loss !== 'number') return
    if (!best || r.loss < best.loss!) {
      best = { ...r, epoch: i + 1 }
    }
  })
  return best
}
