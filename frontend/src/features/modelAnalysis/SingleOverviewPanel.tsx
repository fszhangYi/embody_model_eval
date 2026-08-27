import { useLocale } from '../../i18n/LocaleContext'
import { COMPARE_ARTIFACT_IDS } from './artifacts'
import { formatDatasetMetaBrief, hasEpisodeMeta } from './datasetMeta'
import { fmtNum } from './format'
import { artifactData, bestValEpoch, parseHistoryData } from './runHelpers'
import type { CkptRun } from './types'

function formatBytes(n?: number): string {
  if (n == null) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

export function SingleOverviewPanel({ run }: { run: CkptRun }) {
  const { t } = useLocale()
  const history = parseHistoryData(artifactData(run, 'train_history'))
  const bestVal = history ? bestValEpoch(history.val) : null
  const config = artifactData<Record<string, unknown>>(run, 'policy_config')
  const stats = artifactData<Record<string, unknown>>(run, 'dataset_stats')

  return (
    <div className="ma-overview-grid">
      <article className="ma-overview-card">
        <h4>{t('modelAnalysis.singleArtifacts')}</h4>
        <ul className="ma-single-artifact-list">
          {COMPARE_ARTIFACT_IDS.map((key) => {
            const art = run.artifacts[key]
            return (
              <li key={key} className={art?.ok ? 'ok' : 'missing'}>
                <code>{art?.filename ?? key}</code>
                <span>{art?.ok ? formatBytes(art.sizeBytes) : art?.error ?? '—'}</span>
              </li>
            )
          })}
        </ul>
      </article>
      <article className="ma-overview-card">
        <h4>policy_config.json</h4>
        <p className="ma-overview-metric">
          {config
            ? `${fmtValue(config.action_space)} · ${String(config.camera_names ?? '—')} · lr ${fmtValue(config.lr)}`
            : t('modelAnalysis.singleMissing')}
        </p>
      </article>
      <article className="ma-overview-card">
        <h4>train_history.json</h4>
        <p className="ma-overview-metric">
          {bestVal
            ? t('modelAnalysis.overviewHistory', {
                best: `#${bestVal.epoch}`,
                loss: fmtNum(bestVal.loss),
              })
            : t('modelAnalysis.singleMissing')}
        </p>
      </article>
      <article className="ma-overview-card">
        <h4>dataset_stats.pkl</h4>
        <p className="ma-overview-metric">
          {stats
            ? [
                hasEpisodeMeta(run.datasetMeta)
                  ? formatDatasetMetaBrief(run.datasetMeta, t)
                  : null,
                t('modelAnalysis.singleStatsBrief', {
                  dim: String(stats.state_dim ?? '—'),
                  len: String(stats.max_episode_len ?? '—'),
                }),
              ]
                .filter(Boolean)
                .join(' · ')
            : t('modelAnalysis.singleMissing')}
        </p>
      </article>
    </div>
  )
}

function fmtValue(v: unknown): string {
  if (v == null) return '—'
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}
