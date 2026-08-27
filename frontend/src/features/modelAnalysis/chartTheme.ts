/** Resolve Chart.js colors from computed CSS variables (Chart.js cannot parse var(...)). */

export interface ModelChartTheme {
  text: string
  muted: string
  grid: string
  tooltipBg: string
  tooltipTitle: string
  tooltipBody: string
  tooltipBorder: string
  runColors: readonly string[]
}

const RUN_COLORS_DARK = [
  '#3dd6c6',
  '#f0b429',
  '#60a5fa',
  '#f87171',
  '#a78bfa',
  '#4ade80',
  '#fb923c',
  '#38bdf8',
] as const

const RUN_COLORS_LIGHT = [
  '#0d9488',
  '#b45309',
  '#2563eb',
  '#dc2626',
  '#7c3aed',
  '#15803d',
  '#ea580c',
  '#0284c7',
] as const

function cssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return raw || fallback
}

function withAlpha(rgb: string, alpha: number): string {
  const m = rgb.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/)
  if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`
  return rgb
}

export function readModelChartTheme(resolved: 'dark' | 'light'): ModelChartTheme {
  const text = cssVar('--text', resolved === 'light' ? '#0f172a' : '#e7ecf3')
  const muted = cssVar('--muted', resolved === 'light' ? '#64748b' : '#8b9bb4')
  const border = cssVar('--border', resolved === 'light' ? 'rgba(15, 23, 42, 0.12)' : 'rgba(58, 77, 102, 0.75)')

  return {
    text,
    muted,
    grid: withAlpha(border, resolved === 'light' ? 0.55 : 0.45),
    tooltipBg: resolved === 'light' ? 'rgba(255, 255, 255, 0.98)' : 'rgba(12, 18, 28, 0.94)',
    tooltipTitle: text,
    tooltipBody: muted,
    tooltipBorder: cssVar('--accent', resolved === 'light' ? '#0f766e' : '#3dd6c6'),
    runColors: resolved === 'light' ? RUN_COLORS_LIGHT : RUN_COLORS_DARK,
  }
}

export function runColor(theme: ModelChartTheme, index: number): string {
  return theme.runColors[index % theme.runColors.length]
}
