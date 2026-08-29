import { useEffect, useRef, useCallback } from 'react'
import type { Pi05WeightStructure } from './api'

function formatElems(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

function formatBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`
  return `${n} B`
}

const MODULE_COLORS: Record<string, string> = {
  paligemma: '#3d5cfa',
  gemma_expert: '#c9852a',
  action_proj: '#2f8f6a',
  time_mlp: '#6ea8ff',
  state_proj: '#2a9d8f',
}

export function Pi05WeightBars({
  weights,
  title,
  empty,
}: {
  weights: Pi05WeightStructure | null | undefined
  title: string
  empty: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !weights?.modules?.length) return
    const dpr = window.devicePixelRatio || 1
    const cw = Math.max(280, wrap.clientWidth)
    const rowH = 28
    const pad = 12
    const ch = pad * 2 + 22 + weights.modules.length * rowH
    canvas.width = Math.floor(cw * dpr)
    canvas.height = Math.floor(ch * dpr)
    canvas.style.width = `${cw}px`
    canvas.style.height = `${ch}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const styles = getComputedStyle(wrap)
    const muted = styles.getPropertyValue('--muted').trim() || '#8b9bb4'
    const text = styles.getPropertyValue('--text').trim() || '#e7ecf3'
    const border = styles.getPropertyValue('--border').trim() || '#2a3344'
    const panel = styles.getPropertyValue('--surface').trim() || '#151b24'

    ctx.clearRect(0, 0, cw, ch)
    ctx.fillStyle = muted
    ctx.font = '600 11px "IBM Plex Sans", system-ui, sans-serif'
    ctx.fillText(
      `${title} · ${weights.approxParams || formatElems(weights.totalElements)} · ${weights.tensorCount} tensors`,
      pad,
      16,
    )

    const maxEl = Math.max(...weights.modules.map((m) => m.elements), 1)
    const barX = 118
    const barW = cw - barX - pad - 52

    weights.modules.forEach((m, i) => {
      const y = pad + 24 + i * rowH
      ctx.fillStyle = text
      ctx.font = '600 11px "IBM Plex Sans", system-ui, sans-serif'
      const label = m.label.length > 14 ? `${m.label.slice(0, 13)}…` : m.label
      ctx.fillText(label, pad, y + 12)

      ctx.fillStyle = panel
      ctx.strokeStyle = border
      ctx.beginPath()
      ctx.roundRect(barX, y, barW, 14, 4)
      ctx.fill()
      ctx.stroke()

      const w = Math.max(4, (m.elements / maxEl) * barW)
      ctx.fillStyle = MODULE_COLORS[m.id] || '#3dd6c6'
      ctx.beginPath()
      ctx.roundRect(barX, y, w, 14, 4)
      ctx.fill()

      ctx.fillStyle = muted
      ctx.font = '10px ui-monospace, monospace'
      ctx.fillText(formatElems(m.elements), barX + barW + 8, y + 11)
    })
  }, [weights, title])

  useEffect(() => {
    paint()
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => paint())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [paint])

  if (!weights?.modules?.length) {
    return <div className="pi05a-empty muted">{empty}</div>
  }

  return (
    <div className="pi05a-weight-viz">
      <div ref={wrapRef} className="pi05a-weight-bars-wrap">
        <canvas ref={canvasRef} className="pi05a-weight-bars" aria-label={title} />
      </div>
      {weights.dtypeBreakdown?.length ? (
        <div className="pi05a-dtype-row">
          {weights.dtypeBreakdown.map((d) => (
            <span key={d.dtype} className="pi05a-dtype">
              {d.dtype} × {d.count}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function formatBytesLabel(n: number | undefined | null): string {
  if (n == null) return '—'
  return formatBytes(n)
}
