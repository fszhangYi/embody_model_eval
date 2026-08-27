import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useLocale } from '../../i18n/LocaleContext'
import { runColor } from './chartTheme'
import { VECTOR_GROUP_META } from './constants'
import { CompareRunLegend } from './CompareRunLegend'
import { scalarFieldLabel, isEpisodeScalarKey } from './datasetMeta'
import { barWidth, fmtNum, fmtPct } from './format'
import { useModelChartTheme } from './useModelChartTheme'
import { VectorGroupCollapse } from './VectorGroupCollapse'
import type { ModelCompareResult } from './types'

function vectorTitle(key: string, locale: 'zh' | 'en'): string {
  return VECTOR_GROUP_META[key]?.[locale] ?? key
}

const DEFAULT_OPEN_KEYS = new Set<string>(['action_mean', 'action_std'])

function DimBarRow({
  dimLabel,
  values,
  delta,
  same,
  pctFromBaseline,
  labels,
}: {
  dimLabel: string
  values: (number | null)[]
  delta: number
  same: boolean
  pctFromBaseline?: (number | null)[]
  labels: string[]
}) {
  const theme = useModelChartTheme()
  const nums = values.filter((v): v is number => v != null)
  const min = nums.length ? Math.min(...nums) : 0
  const max = nums.length ? Math.max(...nums) : 0

  return (
    <div className={`ma-dim-row${same ? ' same' : ' diff'}`}>
      <div className="ma-dim-label">
        <code>{dimLabel}</code>
        {!same ? <span className="ma-dim-delta">Δ {fmtNum(delta)}</span> : null}
      </div>
      <div className="ma-dim-bars">
        {values.map((v, i) => (
          <div key={labels[i] || i} className="ma-dim-bar-line">
            <span className="ma-dim-bar-run" style={{ color: runColor(theme, i) }}>
              {labels[i]}
            </span>
            <div className="ma-dim-bar-track">
              <span
                className="ma-dim-bar-fill ma-bar-fill"
                style={
                  {
                    width: `${barWidth(v, min, max)}%`,
                    background: runColor(theme, i),
                  } as CSSProperties
                }
              />
            </div>
            <span className="ma-dim-bar-val">{fmtNum(v)}</span>
            {i > 0 && pctFromBaseline?.[i] != null ? (
              <span className={`ma-dim-pct${Math.abs(pctFromBaseline[i]!) > 1 ? ' warn' : ''}`}>
                {fmtPct(pctFromBaseline[i])}
              </span>
            ) : (
              <span className="ma-dim-pct muted">—</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function CompareDatasetStatsPanel({ data }: { data: ModelCompareResult['compare']['dataset_stats'] }) {
  const { t, locale } = useLocale()
  const theme = useModelChartTheme()
  const [showAll, setShowAll] = useState(false)
  const dimLabels = data.dimLabels ?? data.vectorRows[0]?.rows.map((_, i) => `d${i}`) ?? []
  const scalarDiff = data.scalarDiffCount ?? data.scalarRows.filter((r) => !r.same).length
  const vectorDiff = data.vectorDiffCount ?? data.vectorRows.filter((r) => !r.same).length

  const visibleBlocks = useMemo(
    () => (showAll ? data.vectorRows : data.vectorRows.filter((b) => !b.same)),
    [data.vectorRows, showAll],
  )

  const visibleScalarRows = useMemo(
    () =>
      data.scalarRows.filter((row) => {
        if (isEpisodeScalarKey(row.key)) {
          return row.values.some((v) => v != null)
        }
        return true
      }),
    [data.scalarRows],
  )

  return (
    <div className="ma-compare-stack">
      <div className="ma-compare-summary">
        <CompareRunLegend labels={data.labels} />
        <div className="ma-compare-kpis">
          <div className={`ma-kpi${scalarDiff ? ' warn' : ' ok'}`}>
            <span className="l">{t('modelAnalysis.kpiScalar')}</span>
            <span className="v">{scalarDiff === 0 ? t('modelAnalysis.allMatch') : scalarDiff}</span>
          </div>
          <div className={`ma-kpi${vectorDiff ? ' warn' : ' ok'}`}>
            <span className="l">{t('modelAnalysis.kpiVector')}</span>
            <span className="v">{vectorDiff === 0 ? t('modelAnalysis.allMatch') : vectorDiff}</span>
          </div>
        </div>
      </div>

      <section className="ma-panel card">
        <header className="ma-panel-head">
          <h3>{t('modelAnalysis.artifact.dataset_stats.panel1')}</h3>
        </header>
        <div className="ma-panel-body">
          <div className="ma-scalar-grid">
            {visibleScalarRows.map((row) => (
              <div key={row.key} className={`ma-scalar-card${row.same ? '' : ' diff'}`}>
                <div className="ma-scalar-card-head">
                  <code>{scalarFieldLabel(row.key, t)}</code>
                  <span className={`ma-badge ${row.same ? 'ok' : 'warn'}`}>
                    {row.same ? t('modelAnalysis.same') : t('modelAnalysis.diff')}
                  </span>
                </div>
                <div className="ma-scalar-values">
                  {row.values.map((v, i) => (
                    <div key={i} className="ma-scalar-val-row">
                      <span className="run" style={{ color: runColor(theme, i) }}>
                        {data.labels[i]}
                      </span>
                      <span className="val">{v == null ? '—' : String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="ma-section-toolbar">
        <h3 className="ma-section-title">{t('modelAnalysis.vectorGroups')}</h3>
        <label className="ma-toggle">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          <span>{t('modelAnalysis.showAllDims')}</span>
        </label>
      </div>

      {visibleBlocks.map((block) => {
        const rows = showAll ? block.rows : block.rows.filter((r) => !r.same)
        if (!rows.length) return null
        return (
          <VectorGroupCollapse
            key={block.key}
            title={vectorTitle(block.key, locale)}
            subtitle={
              <>
                <code>{block.key}</code>
                {!block.same
                  ? ` · ${t('modelAnalysis.dimsDiffer', { n: block.diffCount ?? rows.length })}`
                  : ''}
              </>
            }
            badge={
              <span className={`ma-badge ${block.same ? 'ok' : 'warn'}`}>
                {block.same
                  ? t('modelAnalysis.same')
                  : t('modelAnalysis.maxDelta', { v: fmtNum(block.maxDelta) })}
              </span>
            }
            defaultOpen={!block.same || DEFAULT_OPEN_KEYS.has(block.key)}
            highlight={!block.same}
          >
            <div className="ma-dim-list">
              {rows.map((row) => (
                <DimBarRow
                  key={row.dim}
                  dimLabel={dimLabels[row.dim] ?? `d${row.dim}`}
                  values={row.values}
                  delta={row.delta}
                  same={row.same}
                  pctFromBaseline={row.pctFromBaseline}
                  labels={data.labels}
                />
              ))}
            </div>
          </VectorGroupCollapse>
        )
      })}
    </div>
  )
}
