export function fmtNum(v: number | null | undefined, digits = 4): string {
  if (v == null || Number.isNaN(v)) return '—'
  if (Math.abs(v) >= 1000 || (Math.abs(v) > 0 && Math.abs(v) < 1e-4)) return v.toExponential(3)
  return v.toFixed(digits)
}

export function fmtPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(1)}%`
}

export function fmtValue(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') return fmtNum(v, 6)
  if (Array.isArray(v)) return JSON.stringify(v)
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function barWidth(value: number | null, min: number, max: number): number {
  if (value == null || max <= min) return 0
  return Math.max(4, Math.round(((value - min) / (max - min)) * 100))
}
