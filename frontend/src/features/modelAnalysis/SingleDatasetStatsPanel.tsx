import { useLocale } from '../../i18n/LocaleContext'
import { VECTOR_GROUP_META } from './constants'
import {
  datasetMetaSourceLabel,
  formatDatasetMetaBrief,
  formatEpisodeCount,
  hasEpisodeMeta,
  isEpisodeScalarKey,
  scalarFieldLabel,
} from './datasetMeta'
import { fmtNum } from './format'
import { useModelChartTheme } from './useModelChartTheme'
import { runColor } from './chartTheme'
import { artifactData, asNumberArray, parseExampleQpos } from './runHelpers'
import { VectorGroupCollapse } from './VectorGroupCollapse'
import type { CkptRun, ModelCompareResult } from './types'

const VECTOR_KEYS = [
  'action_mean',
  'action_std',
  'qpos_mean',
  'qpos_std',
  'delta_mean',
  'delta_std',
] as const

const DEFAULT_OPEN_KEYS = new Set<string>(['action_mean', 'action_std'])

const SCALAR_KEYS = ['train_episodes', 'val_episodes', 'total_episodes', 'state_dim', 'max_episode_len', 'chunk_size_for_delta'] as const

export function SingleDatasetStatsPanel({
  run,
  dimLabels,
}: {
  run: CkptRun
  dimLabels: string[]
}) {
  const { t, locale } = useLocale()
  const theme = useModelChartTheme()
  const stats = artifactData<Record<string, unknown>>(run, 'dataset_stats')
  if (!stats) {
    return <p className="muted">{t('modelAnalysis.singleMissing')}</p>
  }

  const example = parseExampleQpos(stats.example_qpos)
  const meta = run.datasetMeta

  const scalarValues: Record<(typeof SCALAR_KEYS)[number], unknown> = {
    train_episodes: meta?.trainEpisodes,
    val_episodes: meta?.valEpisodes,
    total_episodes: meta?.totalEpisodes,
    state_dim: stats.state_dim,
    max_episode_len: stats.max_episode_len,
    chunk_size_for_delta: stats.chunk_size_for_delta,
  }

  const visibleScalarKeys = SCALAR_KEYS.filter((key) => {
    if (!isEpisodeScalarKey(key)) return true
    return scalarValues[key] != null
  })

  return (
    <div className="ma-compare-stack">
      <div className="ma-single-run-head">
        <h3>{run.label}</h3>
        <code className="ma-single-path">{run.path}</code>
      </div>

      {hasEpisodeMeta(meta) ? (
        <section className="ma-panel card highlight">
          <header className="ma-panel-head">
            <h3>{t('modelAnalysis.episodeCountsTitle')}</h3>
          </header>
          <div className="ma-panel-body">
            <p className="ma-episode-summary">{formatDatasetMetaBrief(meta, t)}</p>
            <p className="muted ma-episode-source">
              {datasetMetaSourceLabel(meta?.source, t)}
              {meta?.sourcePath ? (
                <>
                  {' · '}
                  <code className="ma-episode-source-path">{meta.sourcePath}</code>
                </>
              ) : null}
            </p>
            {meta?.dataDir ? (
              <p className="muted ma-episode-source">
                {t('modelAnalysis.episodeDataDir')}: <code>{meta.dataDir}</code>
              </p>
            ) : null}
            <p className="muted ma-section-note">{t('modelAnalysis.episodeMetaHint')}</p>
          </div>
        </section>
      ) : null}

      <section className="ma-panel card">
        <header className="ma-panel-head">
          <h3>{t('modelAnalysis.singleScalars')}</h3>
        </header>
        <div className="ma-panel-body ma-scalar-grid">
          {visibleScalarKeys.map((key) => (
            <div key={key} className="ma-scalar-card">
              <div className="ma-scalar-card-head">
                <code>{scalarFieldLabel(key, t)}</code>
              </div>
              <div className="ma-single-scalar-val">{formatEpisodeCount(scalarValues[key])}</div>
            </div>
          ))}
        </div>
      </section>

      {VECTOR_KEYS.map((key) => {
        const arr = asNumberArray(stats[key])
        if (!arr.length) return null
        const title = VECTOR_GROUP_META[key]?.[locale] ?? key
        const maxAbs = Math.max(...arr.map(Math.abs), 1e-6)
        return (
          <VectorGroupCollapse
            key={key}
            title={title}
            subtitle={<code>{key}</code>}
            defaultOpen={DEFAULT_OPEN_KEYS.has(key)}
          >
            <div className="ma-single-vector-bars">
              {arr.map((v, i) => (
                <div key={i} className="ma-single-vector-row">
                  <code className="dim">{dimLabels[i] ?? `d${i}`}</code>
                  <div className="track">
                    <span
                      className="fill ma-bar-fill"
                      style={{
                        width: `${Math.max(4, (Math.abs(v) / maxAbs) * 100)}%`,
                        background: runColor(theme, 0),
                      }}
                    />
                  </div>
                  <span className="val">{fmtNum(v)}</span>
                </div>
              ))}
            </div>
          </VectorGroupCollapse>
        )
      })}

      {example ? (
        <section className="ma-panel card">
          <header className="ma-panel-head">
            <h3>{t('modelAnalysis.singleExampleQpos')}</h3>
            <span className="muted">
              {example.shape[0]} × {example.shape[1]}
            </span>
          </header>
          <div className="ma-panel-body ma-table-wrap">
            <table className="ma-table compact">
              <thead>
                <tr>
                  <th>{t('modelAnalysis.colStep')}</th>
                  {dimLabels.slice(0, example.shape[1]).map((l) => (
                    <th key={l}>{l}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {example.preview.map((row, si) => (
                  <tr key={si}>
                    <td>{si}</td>
                    {row.map((v, di) => (
                      <td key={di}>{fmtNum(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  )
}

export function singleDimLabels(result: ModelCompareResult | null): string[] {
  return result?.compare.dataset_stats.dimLabels ?? ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6']
}
