import { useMemo } from 'react'
import { useLocale } from '../../i18n/LocaleContext'
import { fmtNum } from './format'
import { MetricChart } from './MetricChart'
import { artifactData, bestValEpoch, parseHistoryData } from './runHelpers'
import type { CkptRun, TrainHistoryChartSeries } from './types'

export function SingleTrainHistoryPanel({ run, active = true }: { run: CkptRun; active?: boolean }) {
  const { t } = useLocale()
  const raw = artifactData(run, 'train_history')
  const history = parseHistoryData(raw)

  const summary = useMemo(() => {
    if (!history) return null
    const bestVal = bestValEpoch(history.val)
    const finalTrain = history.train.at(-1)
    const finalVal = history.val.at(-1)
    return {
      epochsTrain: history.train.length,
      epochsVal: history.val.length,
      bestVal,
      finalTrain,
      finalVal,
    }
  }, [history])

  const chartSeries = useMemo((): TrainHistoryChartSeries[] => {
    if (!history) return []
    const label = run.label
    return [
      { metric: 'val_loss', label, values: history.val.map((r) => r.loss ?? null) },
      { metric: 'train_loss', label, values: history.train.map((r) => r.loss ?? null) },
      { metric: 'val_kl', label, values: history.val.map((r) => r.kl ?? null) },
      { metric: 'train_kl', label, values: history.train.map((r) => r.kl ?? null) },
    ]
  }, [history, run.label])

  if (!history || !summary) {
    return <p className="muted">{t('modelAnalysis.singleMissing')}</p>
  }

  return (
    <div className="ma-compare-stack">
      <div className="ma-single-run-head">
        <h3>{run.label}</h3>
        <code className="ma-single-path">{run.path}</code>
      </div>

      <div className="ma-single-kpi-grid">
        <div className="ma-kpi ok">
          <span className="l">{t('modelAnalysis.colBestVal')}</span>
          <span className="v">
            #{summary.bestVal?.epoch} · {fmtNum(summary.bestVal?.loss)}
          </span>
        </div>
        <div className="ma-kpi">
          <span className="l">{t('modelAnalysis.colEpochs')}</span>
          <span className="v">
            {summary.epochsTrain} / {summary.epochsVal}
          </span>
        </div>
        <div className="ma-kpi">
          <span className="l">{t('modelAnalysis.colFinalValLoss')}</span>
          <span className="v">{fmtNum(summary.finalVal?.loss)}</span>
        </div>
        <div className="ma-kpi">
          <span className="l">{t('modelAnalysis.colFinalTrainLoss')}</span>
          <span className="v">{fmtNum(summary.finalTrain?.loss)}</span>
        </div>
      </div>

      <section className="ma-panel card highlight">
        <header className="ma-panel-head">
          <h3>{t('modelAnalysis.singleBestMetrics')}</h3>
        </header>
        <div className="ma-panel-body ma-table-wrap">
          <table className="ma-table compact">
            <thead>
              <tr>
                <th>{t('modelAnalysis.colMetric')}</th>
                <th>loss</th>
                <th>l1</th>
                <th>kl</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t('modelAnalysis.colBestVal')}</td>
                <td>{fmtNum(summary.bestVal?.loss)}</td>
                <td>{fmtNum(summary.bestVal?.l1)}</td>
                <td>{fmtNum(summary.bestVal?.kl)}</td>
              </tr>
              <tr>
                <td>{t('modelAnalysis.singleFinalTrain')}</td>
                <td>{fmtNum(summary.finalTrain?.loss)}</td>
                <td>{fmtNum(summary.finalTrain?.l1)}</td>
                <td>{fmtNum(summary.finalTrain?.kl)}</td>
              </tr>
              <tr>
                <td>{t('modelAnalysis.singleFinalVal')}</td>
                <td>{fmtNum(summary.finalVal?.loss)}</td>
                <td>{fmtNum(summary.finalVal?.l1)}</td>
                <td>{fmtNum(summary.finalVal?.kl)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="ma-panel card">
        <header className="ma-panel-head">
          <h3>{t('modelAnalysis.artifact.train_history.panel1')}</h3>
        </header>
        <div className="ma-panel-body ma-chart-grid">
          <MetricChart
            title={t('modelAnalysis.chartVal')}
            series={chartSeries.filter((s) => s.metric === 'val_loss')}
            labels={[run.label]}
            active={active}
          />
          <MetricChart
            title={t('modelAnalysis.chartTrain')}
            series={chartSeries.filter((s) => s.metric === 'train_loss')}
            labels={[run.label]}
            active={active}
          />
          <MetricChart
            title={t('modelAnalysis.chartValKl')}
            series={chartSeries.filter((s) => s.metric === 'val_kl')}
            labels={[run.label]}
            yAxisLabel="KL"
            active={active}
          />
          <MetricChart
            title={t('modelAnalysis.chartTrainKl')}
            series={chartSeries.filter((s) => s.metric === 'train_kl')}
            labels={[run.label]}
            yAxisLabel="KL"
            active={active}
          />
        </div>
      </section>
    </div>
  )
}
