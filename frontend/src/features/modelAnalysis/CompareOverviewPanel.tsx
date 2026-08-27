import { useLocale } from '../../i18n/LocaleContext'
import type { ModelCompareResult } from './types'

export function CompareOverviewPanel({ result }: { result: ModelCompareResult }) {
  const { t } = useLocale()
  const { dataset_stats: stats, policy_config: cfg, train_history: hist } = result.compare
  const bestLabel =
    hist.bestRunIndex != null ? hist.labels[hist.bestRunIndex] : hist.labels[0]

  return (
    <div className="ma-overview-grid">
      <article className="ma-overview-card">
        <h4>dataset_stats.pkl</h4>
        <p className="ma-overview-metric">
          {stats.scalarDiffCount === 0 && stats.vectorDiffCount === 0
            ? t('modelAnalysis.overviewStatsOk')
            : t('modelAnalysis.overviewStatsDiff', {
                scalar: stats.scalarDiffCount ?? 0,
                vector: stats.vectorDiffCount ?? 0,
              })}
        </p>
      </article>
      <article className="ma-overview-card">
        <h4>policy_config.json</h4>
        <p className="ma-overview-metric">
          {cfg.diffCount === 0
            ? t('modelAnalysis.overviewConfigOk')
            : t('modelAnalysis.overviewConfigDiff', { n: cfg.diffCount })}
        </p>
      </article>
      <article className="ma-overview-card">
        <h4>train_history.json</h4>
        <p className="ma-overview-metric">
          {t('modelAnalysis.overviewHistory', {
            best: bestLabel ?? '—',
            loss: hist.summaries[hist.bestRunIndex ?? 0]?.bestVal?.loss?.toFixed(4) ?? '—',
          })}
        </p>
      </article>
    </div>
  )
}
