import { useEffect, useId, useRef, useState } from 'react'
import { Chart, registerables, type ChartOptions } from 'chart.js'
import { useLocale } from '../../i18n/LocaleContext'
import { fmtNum } from './format'
import { runColor } from './chartTheme'
import { useModelChartTheme } from './useModelChartTheme'
import type { ModelChartTheme } from './chartTheme'
import type { TrainHistoryChartSeries } from './types'

Chart.register(...registerables)

export type ChartYRange = { min: number | null; max: number | null }

function parseBound(raw: string): number | null {
  const s = raw.trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function buildChartOptions(
  title: string,
  theme: ModelChartTheme,
  yRange: ChartYRange,
  yAxisLabel = 'loss',
): ChartOptions {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 320 },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      title: {
        display: true,
        text: title,
        color: theme.muted,
        font: { size: 12, weight: 'normal', family: "'IBM Plex Sans', sans-serif" },
        padding: { bottom: 8 },
      },
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: {
          color: theme.text,
          boxWidth: 10,
          boxHeight: 2,
          usePointStyle: true,
          pointStyle: 'line',
          padding: 12,
          font: { size: 11, family: "'IBM Plex Sans', sans-serif" },
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
        displayColors: true,
        callbacks: {
          label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)}`,
        },
      },
    },
    scales: {
      x: {
        type: 'linear',
        border: { display: false },
        title: {
          display: true,
          text: 'epoch',
          color: theme.muted,
          font: { size: 10, family: "'IBM Plex Sans', sans-serif" },
        },
        ticks: {
          color: theme.muted,
          maxTicksLimit: 12,
          font: { size: 10 },
          padding: 4,
        },
        grid: { color: theme.grid, drawTicks: false },
      },
      y: {
        border: { display: false },
        min: yRange.min ?? undefined,
        max: yRange.max ?? undefined,
        title: {
          display: true,
          text: yAxisLabel,
          color: theme.muted,
          font: { size: 10, family: "'IBM Plex Sans', sans-serif" },
        },
        ticks: {
          color: theme.muted,
          font: { size: 10 },
          padding: 6,
        },
        grid: { color: theme.grid, drawTicks: false },
      },
    },
  }
}

export function MetricChart({
  title,
  series,
  labels,
  yAxisLabel = 'loss',
  active = true,
}: {
  title: string
  series: TrainHistoryChartSeries[]
  labels: string[]
  yAxisLabel?: string
  /** When false (hidden tab), skip resize until shown again. */
  active?: boolean
}) {
  const { t } = useLocale()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<Chart | null>(null)
  const theme = useModelChartTheme()
  const idBase = useId()
  const [minText, setMinText] = useState('')
  const [maxText, setMaxText] = useState('')
  const [yRange, setYRange] = useState<ChartYRange>({ min: null, max: null })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    chartRef.current?.destroy()

    const datasets = series.map((s, i) => {
      const runIdx = labels.indexOf(s.label)
      const color = runColor(theme, runIdx >= 0 ? runIdx : i)
      return {
        label: s.label,
        data: s.values.map((v, idx) => ({ x: idx + 1, y: v ?? null })),
        borderColor: color,
        backgroundColor: 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: color,
        pointHoverBorderColor: theme.text,
        pointHoverBorderWidth: 1,
        tension: 0.12,
        spanGaps: true,
      }
    })

    chartRef.current = new Chart(canvas, {
      type: 'line',
      data: { datasets },
      options: buildChartOptions(title, theme, yRange, yAxisLabel),
    })

    return () => {
      chartRef.current?.destroy()
      chartRef.current = null
    }
    // yRange applied in a separate effect to avoid full rebuild on every axis tweak
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series, labels, title, theme, yAxisLabel])

  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return
    const y = chart.options.scales?.y
    if (y && typeof y === 'object') {
      y.min = yRange.min ?? undefined
      y.max = yRange.max ?? undefined
    }
    chart.update('none')
  }, [yRange])

  useEffect(() => {
    if (!active) return
    const chart = chartRef.current
    if (!chart) return
    requestAnimationFrame(() => chart.resize())
  }, [active])

  const applyRange = () => {
    let min = parseBound(minText)
    let max = parseBound(maxText)
    if (min != null && max != null && min > max) {
      const tmp = min
      min = max
      max = tmp
      setMinText(String(min))
      setMaxText(String(max))
    }
    setYRange({ min, max })
  }

  const resetRange = () => {
    setMinText('')
    setMaxText('')
    setYRange({ min: null, max: null })
  }

  return (
    <div className="ma-chart-block">
      <div className="ma-chart-yaxis" role="group" aria-label={t('modelAnalysis.chartYAxisAria')}>
        <label className="ma-chart-yaxis-field" htmlFor={`${idBase}-ymin`}>
          <span>{t('modelAnalysis.chartYMin')}</span>
          <input
            id={`${idBase}-ymin`}
            type="number"
            inputMode="decimal"
            step="any"
            placeholder={t('modelAnalysis.chartYAuto')}
            value={minText}
            onChange={(e) => setMinText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyRange()
            }}
          />
        </label>
        <label className="ma-chart-yaxis-field" htmlFor={`${idBase}-ymax`}>
          <span>{t('modelAnalysis.chartYMax')}</span>
          <input
            id={`${idBase}-ymax`}
            type="number"
            inputMode="decimal"
            step="any"
            placeholder={t('modelAnalysis.chartYAuto')}
            value={maxText}
            onChange={(e) => setMaxText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyRange()
            }}
          />
        </label>
        <div className="ma-chart-yaxis-actions">
          <button type="button" className="ma-btn ghost compact" onClick={applyRange}>
            {t('modelAnalysis.chartYApply')}
          </button>
          <button type="button" className="ma-btn ghost compact" onClick={resetRange}>
            {t('modelAnalysis.chartYReset')}
          </button>
        </div>
      </div>
      <div className="ma-chart-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  )
}
