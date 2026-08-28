import { useCallback, useEffect, useRef } from 'react'
import { useLocale } from '../../i18n/LocaleContext'
import type { PolicyModelGraph } from './types'

interface ThemeColors {
  accent: string
  border: string
  fg: string
  muted: string
  panel: string
}

function readThemeColors(wrap: HTMLElement): ThemeColors {
  const styles = getComputedStyle(wrap)
  return {
    accent: styles.getPropertyValue('--accent').trim() || '#5b9cff',
    border: styles.getPropertyValue('--border').trim() || '#2a3344',
    fg: styles.getPropertyValue('--text').trim() || '#e8ecf2',
    muted: styles.getPropertyValue('--muted').trim() || '#8a96a8',
    panel: styles.getPropertyValue('--panel').trim() || '#151b24',
  }
}

function formatElements(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function nodeFill(id: string, theme: ThemeColors): string {
  const palette: Record<string, string> = {
    embed: '#3d5a80',
    backbone: '#5c7cfa',
    encoder: '#2a9d8f',
    decoder: '#e9c46a',
    heads: '#e76f51',
    other: '#6c757d',
  }
  return palette[id] ?? theme.accent
}

function drawGraph(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  graph: PolicyModelGraph,
  theme: ThemeColors,
  title: string,
) {
  ctx.clearRect(0, 0, w, h)
  const pad = 16
  ctx.fillStyle = theme.muted
  ctx.font = '11px system-ui, sans-serif'
  ctx.fillText(title, pad, 18)

  const nodes = [...graph.nodes].sort((a, b) => a.column - b.column || (a.row ?? 0) - (b.row ?? 0))
  if (!nodes.length) {
    ctx.fillText('—', pad, 40)
    return
  }

  const nodeW = 118
  const nodeH = 54
  const colCount = Math.max(...nodes.map((n) => n.column)) + 1
  const colGap = Math.max(28, (w - pad * 2 - nodeW * colCount) / Math.max(1, colCount - 1))
  const positions = new Map<string, { x: number; y: number; w: number; h: number }>()

  nodes.forEach((node) => {
    const x = pad + node.column * (nodeW + colGap)
    const y = 34
    positions.set(node.id, { x, y, w: nodeW, h: nodeH })
  })

  const drawEdge = (from: { x: number; y: number; w: number; h: number }, to: { x: number; y: number; w: number; h: number }) => {
    const x1 = from.x + from.w
    const y1 = from.y + from.h / 2
    const x2 = to.x
    const y2 = to.y + to.h / 2
    const cx = (x1 + x2) / 2
    ctx.strokeStyle = theme.muted
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.bezierCurveTo(cx, y1, cx, y2, x2, y2)
    ctx.stroke()
    const angle = Math.atan2(y2 - y1, x2 - x1)
    const ax = x2 - 6 * Math.cos(angle)
    const ay = y2 - 6 * Math.sin(angle)
    ctx.fillStyle = theme.muted
    ctx.beginPath()
    ctx.moveTo(x2, y2)
    ctx.lineTo(ax - 4 * Math.sin(angle), ay + 4 * Math.cos(angle))
    ctx.lineTo(ax + 4 * Math.sin(angle), ay - 4 * Math.cos(angle))
    ctx.closePath()
    ctx.fill()
  }

  graph.edges.forEach((edge) => {
    const from = positions.get(edge.from)
    const to = positions.get(edge.to)
    if (from && to) drawEdge(from, to)
  })

  nodes.forEach((node) => {
    const pos = positions.get(node.id)
    if (!pos) return
    const fill = nodeFill(node.id, theme)
    ctx.fillStyle = fill
    ctx.globalAlpha = 0.92
    ctx.beginPath()
    ctx.roundRect(pos.x, pos.y, pos.w, pos.h, 8)
    ctx.fill()
    ctx.globalAlpha = 1
    ctx.strokeStyle = theme.border
    ctx.lineWidth = 1
    ctx.stroke()

    ctx.fillStyle = '#fff'
    ctx.font = '600 11px system-ui, sans-serif'
    const label = node.label.length > 14 ? `${node.label.slice(0, 13)}…` : node.label
    ctx.fillText(label, pos.x + 8, pos.y + 18)
    ctx.fillStyle = 'rgba(255,255,255,0.82)'
    ctx.font = '9px ui-monospace, monospace'
    ctx.fillText(`${node.params} tensors · ${formatElements(node.elements)}`, pos.x + 8, pos.y + 34)

    const children = node.children ?? []
    if (!children.length) return
    const childH = 18
    const childW = Math.min(nodeW + 40, Math.max(nodeW, (w - pad * 2) / Math.max(1, Math.ceil(children.length / 2))))
    const baseY = pos.y + pos.h + 12
    children.slice(0, 8).forEach((child, idx) => {
      const row = Math.floor(idx / 2)
      const col = idx % 2
      const cx = pos.x + col * (childW / 2 + 4)
      const cy = baseY + row * (childH + 4)
      ctx.fillStyle = theme.panel
      ctx.strokeStyle = theme.border
      ctx.beginPath()
      ctx.roundRect(cx, cy, childW / 2 - 2, childH, 4)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = theme.fg
      ctx.font = '9px ui-monospace, monospace'
      const cl = `${child.label} · ${formatElements(child.elements)}`
      ctx.fillText(cl.length > 18 ? `${cl.slice(0, 17)}…` : cl, cx + 4, cy + 12)
    })
  })
}

export function PolicyStructureGraph({ graph }: { graph: PolicyModelGraph }) {
  const { t } = useLocale()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = window.devicePixelRatio || 1
    const cw = Math.max(320, wrap.clientWidth)
    const maxChildRows = Math.max(
      0,
      ...graph.nodes.map((n) => Math.ceil(Math.min(8, (n.children ?? []).length) / 2)),
    )
    const ch = 120 + maxChildRows * 22
    canvas.width = Math.floor(cw * dpr)
    canvas.height = Math.floor(ch * dpr)
    canvas.style.width = `${cw}px`
    canvas.style.height = `${ch}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawGraph(ctx, cw, ch, graph, readThemeColors(wrap), t('modelAnalysis.policyGraphTitle'))
  }, [graph, t])

  useEffect(() => {
    paint()
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => paint())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [paint])

  return (
    <div ref={wrapRef} className="ma-policy-graph-wrap">
      <canvas ref={canvasRef} className="ma-policy-graph" aria-label={t('modelAnalysis.policyGraphTitle')} />
    </div>
  )
}
