import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocale } from '../../i18n/LocaleContext'
import { PolicyStructureGraph } from './PolicyStructureGraph'
import type { PolicyBestData, PolicyVisualization } from './types'

function heatColor(t: number): string {
  const x = Math.max(0, Math.min(1, t))
  const r = Math.round(40 + x * 215)
  const g = Math.round(80 + (1 - Math.abs(x - 0.5) * 2) * 60)
  const b = Math.round(220 - x * 200)
  return `rgb(${r},${g},${b})`
}

function readThemeColors(wrap: HTMLElement) {
  const styles = getComputedStyle(wrap)
  return {
    accent: styles.getPropertyValue('--accent').trim() || '#5b9cff',
    border: styles.getPropertyValue('--border').trim() || '#2a3344',
    fg: styles.getPropertyValue('--text').trim() || '#e8ecf2',
    muted: styles.getPropertyValue('--muted').trim() || '#8a96a8',
  }
}

function drawPolicyCanvas(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  viz: PolicyVisualization,
  heatIdx: number,
  labels: { modules: string; hist: string; heat: string },
  wrap: HTMLElement,
) {
  const theme = readThemeColors(wrap)
  ctx.clearRect(0, 0, w, h)
  const pad = 12
  const barH = Math.floor(h * 0.38)
  const histH = Math.floor(h * 0.24)
  const heatH = h - barH - histH - pad * 4

  ctx.fillStyle = theme.muted
  ctx.font = '11px system-ui, sans-serif'
  ctx.fillText(labels.modules, pad, pad + 10)

  const bars = viz.moduleBars ?? []
  const maxEl = Math.max(1, ...bars.map((b) => b.elements))
  const rowH = bars.length ? Math.min(18, Math.max(10, (barH - 24) / bars.length)) : 14
  bars.slice(0, Math.floor((barH - 24) / rowH)).forEach((bar, i) => {
    const y = pad + 18 + i * rowH
    const bw = ((w - pad * 2 - 120) * bar.elements) / maxEl
    ctx.fillStyle = theme.accent
    ctx.globalAlpha = 0.72
    ctx.fillRect(pad + 110, y, Math.max(2, bw), rowH - 3)
    ctx.globalAlpha = 1
    ctx.fillStyle = theme.fg
    ctx.font = '10px ui-monospace, monospace'
    const label = bar.label.length > 14 ? `${bar.label.slice(0, 13)}…` : bar.label
    ctx.fillText(label, pad, y + rowH - 5)
    ctx.fillStyle = theme.muted
    ctx.font = '10px system-ui, sans-serif'
    ctx.fillText(`${bar.pct}%`, pad + 112 + bw + 4, y + rowH - 5)
  })

  const histTop = barH + pad * 2
  ctx.fillStyle = theme.muted
  ctx.font = '11px system-ui, sans-serif'
  ctx.fillText(labels.hist, pad, histTop + 10)

  const hist = viz.histogram
  if (hist?.counts?.length) {
    const hx = pad
    const hy = histTop + 16
    const hw = w - pad * 2
    const hh = histH - 20
    const maxC = Math.max(1, ...hist.counts)
    const binW = hw / hist.counts.length
    hist.counts.forEach((c, i) => {
      const bh = (c / maxC) * hh
      ctx.fillStyle = theme.accent
      ctx.globalAlpha = 0.45
      ctx.fillRect(hx + i * binW, hy + hh - bh, Math.max(1, binW - 1), bh)
      ctx.globalAlpha = 1
    })
    ctx.fillStyle = theme.muted
    ctx.font = '9px ui-monospace, monospace'
    if (hist.min != null && hist.max != null) {
      ctx.fillText(hist.min.toExponential(2), hx, hy + hh + 12)
      ctx.fillText(hist.max.toExponential(2), hx + hw - 52, hy + hh + 12)
    }
  }

  const heatTop = histTop + histH + pad
  ctx.fillStyle = theme.muted
  ctx.font = '11px system-ui, sans-serif'
  ctx.fillText(labels.heat, pad, heatTop + 10)

  const heatmaps = viz.heatmaps ?? []
  const heat = heatmaps[heatIdx]
  if (heat?.values?.length && heat.width && heat.height) {
    const areaW = w - pad * 2
    const areaH = Math.max(40, heatH - 16)
    const cellW = areaW / heat.width
    const cellH = areaH / heat.height
    for (let row = 0; row < heat.height; row += 1) {
      for (let col = 0; col < heat.width; col += 1) {
        const v = heat.values[row * heat.width + col] ?? 0
        ctx.fillStyle = heatColor(v)
        ctx.fillRect(pad + col * cellW, heatTop + 14 + row * cellH, cellW + 0.5, cellH + 0.5)
      }
    }
    ctx.fillStyle = theme.muted
    ctx.font = '9px ui-monospace, monospace'
    ctx.fillText(
      `${heat.name.split('.').slice(-2).join('.')} · ${heat.sourceShape?.join('×')} · [${heat.min?.toExponential(2)}, ${heat.max?.toExponential(2)}]`,
      pad,
      heatTop + 14 + areaH + 12,
    )
  }
}

export function PolicyWeightCanvas({ data }: { data: PolicyBestData }) {
  const { t } = useLocale()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [heatIdx, setHeatIdx] = useState(0)
  const viz = data.visualization

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !viz) return
    const dpr = window.devicePixelRatio || 1
    const cw = Math.max(280, wrap.clientWidth)
    const ch = 360
    canvas.width = Math.floor(cw * dpr)
    canvas.height = Math.floor(ch * dpr)
    canvas.style.width = `${cw}px`
    canvas.style.height = `${ch}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawPolicyCanvas(ctx, cw, ch, viz, heatIdx, {
      modules: t('modelAnalysis.policyCanvasModules'),
      hist: t('modelAnalysis.policyCanvasHist'),
      heat: t('modelAnalysis.policyCanvasHeat'),
    }, wrap)
  }, [viz, heatIdx, t])

  useEffect(() => {
    paint()
    const wrap = wrapRef.current
    if (!wrap) return
    const ro = new ResizeObserver(() => paint())
    ro.observe(wrap)
    return () => ro.disconnect()
  }, [paint])

  if (!viz) {
    return <p className="muted">{t('modelAnalysis.policyCanvasMissing')}</p>
  }

  const heatmaps = viz.heatmaps ?? []

  return (
    <section className="ma-panel card ma-policy-canvas-panel">
      <header className="ma-panel-head">
        <h3>{t('modelAnalysis.policyCanvasTitle')}</h3>
        {data.weightStats ? (
          <p className="muted ma-panel-sub">
            min {data.weightStats.min?.toExponential(3)} · max {data.weightStats.max?.toExponential(3)} · μ{' '}
            {data.weightStats.mean?.toExponential(3)}
          </p>
        ) : null}
      </header>
      <div className="ma-panel-body">
        {viz.modelGraph?.nodes?.length ? (
          <PolicyStructureGraph graph={viz.modelGraph} />
        ) : null}
        {heatmaps.length > 1 ? (
          <div className="ma-heat-tabs" role="tablist" aria-label={t('modelAnalysis.policyCanvasHeat')}>
            {heatmaps.map((hm, idx) => (
              <button
                key={hm.name}
                type="button"
                role="tab"
                aria-selected={idx === heatIdx}
                className={`ma-heat-tab${idx === heatIdx ? ' active' : ''}`}
                onClick={() => setHeatIdx(idx)}
              >
                {hm.name.split('.').slice(-2).join('.')}
              </button>
            ))}
          </div>
        ) : null}
        <div ref={wrapRef} className="ma-policy-canvas-wrap">
          <canvas ref={canvasRef} className="ma-policy-canvas" aria-label={t('modelAnalysis.policyCanvasTitle')} />
        </div>
      </div>
    </section>
  )
}
