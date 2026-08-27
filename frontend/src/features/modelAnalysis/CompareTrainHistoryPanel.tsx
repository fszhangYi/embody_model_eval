import { useMemo } from 'react'
import type { CSSProperties } from 'react'
import { useLocale } from '../../i18n/LocaleContext'
import { runColor } from './chartTheme'
import { CompareRunLegend } from './CompareRunLegend'
import { fmtNum } from './format'
import { MetricChart } from './MetricChart'
import { useModelChartTheme } from './useModelChartTheme'
import type { ModelCompareResult } from './types'

function BestValBars({
  labels,
  values,
  bestIndex,
}: {
  labels: string[]
  values: (number | null)[]
  bestIndex: number | null
}) {
  const theme = useModelChartTheme()
  const max = Math.max(...values.filter((v): v is number => v != null), 0.001)

  return (
    <div className="ma-best-bars">
      {labels.map((label, i) => {
        const v = values[i]
        const pct = v != null ? Math.max(6, (v / max) * 100) : 0
        const color = runColor(theme, i)
        return (
          <div key={label} className={`ma-best-bar-row${bestIndex === i ? ' winner' : ''}`}>
            <span className="name" style={{ color }}>
              {label}
            </span>
            <div className="track">
              <span
                className="fill"
                style={{ width: `${pct}%`, background: color } as CSSProperties}
              />
            </div>
            <span className="val">{v != null ? fmtNum(v) : '—'}</span>
          </div>
        )
      })}
    </div>
  )
}

export function CompareTrainHistoryPanel({
  data,
  active = true,
}: {
  data: ModelCompareResult['compare']['train_history']
  active?: boolean
}) {
  const { t } = useLocale()
  const theme = useModelChartTheme()
  const bestIndex = data.bestRunIndex ?? null

  const bestVals = data.summaries.map((s) =>
    s.ok && s.bestVal?.loss != null ? Number(s.bestVal.loss) : null,
  )

  const valSeries = useMemo(
    () => data.chartSeries.filter((s) => s.metric === 'val_loss'),
    [data.chartSeries],
  )
  const trainSeries = useMemo(
    () => data.chartSeries.filter((s) => s.metric === 'train_loss'),
    [data.chartSeries],
  )
  const valKlSeries = useMemo(
    () => data.chartSeries.filter((s) => s.metric === 'val_kl'),
    [data.chartSeries],
  )
  const trainKlSeries = useMemo(
    () => data.chartSeries.filter((s) => s.metric === 'train_kl'),
    [data.chartSeries],
  )

  return (
    <div className="ma-compare-stack">
      <div className="ma-compare-summary">
        <CompareRunLegend labels={data.labels} bestIndex={bestIndex} />
        {data.bestValSpread > 0 ? (
          <div className="ma-kpi warn">
            <span className="l">{t('modelAnalysis.kpiValGap')}</span>
            <span className="v">{fmtNum(data.bestValSpread)}</span>
          </div>
        ) : null}
      </div>

      <section className="ma-panel card highlight">
        <header className="ma-panel-head">
          <h3>{t('modelAnalysis.bestValCompare')}</h3>
        </header>
        <div className="ma-panel-body">
          <BestValBars labels={data.labels} values={bestVals} bestIndex={bestIndex} />
        </div>
      </section>

      <div className="ma-history-card-grid">
        {data.summaries.map((s, i) => (
          <article
            key={s.label}
            className={`ma-history-run-card${bestIndex === i ? ' winner' : ''}`}
            style={{ '--run-color': runColor(theme, i) } as CSSProperties}
          >
            <header>
              <span className="name">{s.label}</span>
              {bestIndex === i ? <span className="ma-run-legend-tag best">{t('modelAnalysis.best')}</span> : null}
            </header>
            {!s.ok ? (
              <p className="muted">{s.error || t('modelAnalysis.statusPartial')}</p>
            ) : (
              <dl>
                <div>
                  <dt>{t('modelAnalysis.colBestVal')}</dt>
                  <dd>
                    #{s.bestVal?.epoch} · loss {fmtNum(s.bestVal?.loss)}
                  </dd>
                </div>
                <div>
                  <dt>L1 / KL</dt>
                  <dd>
                    {fmtNum(s.bestVal?.l1)} / {fmtNum(s.bestVal?.kl)}
                  </dd>
                </div>
                <div>
                  <dt>{t('modelAnalysis.colEpochs')}</dt>
                  <dd>
                    {s.epochsTrain} / {s.epochsVal}
                  </dd>
                </div>
                <div>
                  <dt>{t('modelAnalysis.colFinalValLoss')}</dt>
                  <dd>{s.finalVal ? fmtNum(Number(s.finalVal.loss)) : '—'}</dd>
                </div>
              </dl>
            )}
          </article>
        ))}
      </div>

      <section className="ma-panel card">
        <header className="ma-panel-head">
          <h3>{t('modelAnalysis.artifact.train_history.panel1')}</h3>
        </header>
        <div className="ma-panel-body ma-chart-grid">
          <MetricChart
            title={t('modelAnalysis.chartVal')}
            series={valSeries}
            labels={data.labels}
            active={active}
          />
          <MetricChart
            title={t('modelAnalysis.chartTrain')}
            series={trainSeries}
            labels={data.labels}
            active={active}
          />
          <MetricChart
            title={t('modelAnalysis.chartValKl')}
            series={valKlSeries}
            labels={data.labels}
            yAxisLabel="KL"
            active={active}
          />
          <MetricChart
            title={t('modelAnalysis.chartTrainKl')}
            series={trainKlSeries}
            labels={data.labels}
            yAxisLabel="KL"
            active={active}
          />
        </div>
      </section>
    </div>
  )
}
