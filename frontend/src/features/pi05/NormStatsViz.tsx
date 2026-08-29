import { useEffect, useId, useMemo, useRef } from 'react'
import { Chart, registerables, type ChartConfiguration } from 'chart.js'
import { useModelChartTheme } from '../modelAnalysis/useModelChartTheme'
import { runColor } from '../modelAnalysis/chartTheme'
import type { Pi05NormGroup } from './api'

Chart.register(...registerables)

function NormGroupChart({ group, index }: { group: Pi05NormGroup; index: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)
  const theme = useModelChartTheme()
  const uid = useId()

  const labels = useMemo(
    () => Array.from({ length: group.dim }, (_, i) => `d${i}`),
    [group.dim],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    chartRef.current?.destroy()

    const meanColor = runColor(theme, 0)
    const stdColor = runColor(theme, 1)

    const cfg: ChartConfiguration = {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'mean',
            data: group.mean,
            backgroundColor: meanColor + 'cc',
            borderColor: meanColor,
            borderWidth: 1,
            borderRadius: 3,
            barPercentage: 0.7,
            categoryPercentage: 0.75,
          },
          {
            label: 'std',
            data: group.std,
            backgroundColor: stdColor + '99',
            borderColor: stdColor,
            borderWidth: 1,
            borderRadius: 3,
            barPercentage: 0.7,
            categoryPercentage: 0.75,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 360 },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: theme.text,
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true,
              pointStyle: 'rectRounded',
              font: { size: 11, family: "'IBM Plex Sans', sans-serif" },
              padding: 10,
            },
          },
          tooltip: {
            backgroundColor: theme.tooltipBg,
            titleColor: theme.tooltipTitle,
            bodyColor: theme.tooltipBody,
            borderColor: theme.tooltipBorder,
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: theme.muted, font: { size: 10 } },
            border: { display: false },
          },
          y: {
            grid: { color: theme.grid },
            ticks: { color: theme.muted, font: { size: 10 }, maxTicksLimit: 6 },
            border: { display: false },
          },
        },
      },
    }

    chartRef.current = new Chart(canvas, cfg)
    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
  }, [group, labels, theme, index])

  return (
    <div className="pi05a-norm-chart" data-group={group.name}>
      <div className="pi05a-norm-chart-head">
        <strong>{group.name}</strong>
        <span className="muted">dim={group.dim}</span>
      </div>
      <div className="pi05a-norm-chart-canvas">
        <canvas ref={canvasRef} id={`${uid}-${group.name}`} />
      </div>
    </div>
  )
}

export function Pi05NormStatsViz({
  groups,
  empty,
  path,
}: {
  groups: Pi05NormGroup[]
  empty: string
  path?: string
}) {
  if (!groups.length) {
    return <div className="pi05a-empty muted">{empty}</div>
  }

  return (
    <div className="pi05a-norm-viz">
      {path ? <code className="pi05a-norm-path" title={path}>{path}</code> : null}
      <div className="pi05a-norm-grid">
        {groups.map((g, i) => (
          <NormGroupChart key={g.name} group={g} index={i} />
        ))}
      </div>
    </div>
  )
}
