import type { CSSProperties } from 'react'
import { useLocale } from '../../i18n/LocaleContext'
import { CONFIG_GROUP_ORDER } from './constants'
import { fmtValue } from './format'
import { artifactData } from './runHelpers'
import type { CkptRun, PolicyConsistencyCheck } from './types'

function groupKey(key: string): string {
  for (const g of CONFIG_GROUP_ORDER) {
    const keys: Record<string, string[]> = {
      training: ['lr', 'lr_backbone', 'batch_size', 'num_epochs', 'seed', 'kl_weight'],
      model: [
        'hidden_dim', 'dim_feedforward', 'enc_layers', 'dec_layers', 'nheads', 'backbone',
        'num_queries', 'chunk_size', 'state_dim', 'use_sam2_features', 'use_cvae', 'action_repr',
      ],
      data: ['action_space', 'rx_unwrapped', 'camera_names', 'hdf5_cache_size', 'num_workers'],
    }
    if ((keys[g] ?? []).includes(key)) return g
  }
  return 'other'
}

function buildConsistency(run: CkptRun): PolicyConsistencyCheck[] {
  const cfg = artifactData<Record<string, unknown>>(run, 'policy_config')
  const stats = artifactData<Record<string, unknown>>(run, 'dataset_stats')
  if (!cfg || !stats) return []
  const checks: PolicyConsistencyCheck[] = []
  for (const field of ['state_dim', 'chunk_size', 'num_queries'] as const) {
    let cfgVal = cfg[field]
    if (field === 'chunk_size' && cfgVal == null) cfgVal = cfg.num_queries
    const statsVal = field === 'state_dim' ? stats.state_dim : stats.chunk_size_for_delta
    if (cfgVal == null && statsVal == null) continue
    checks.push({ field, config: cfgVal, stats: statsVal, match: cfgVal === statsVal })
  }
  return checks
}

export function SinglePolicyConfigPanel({ run }: { run: CkptRun }) {
  const { t } = useLocale()
  const config = artifactData<Record<string, unknown>>(run, 'policy_config')
  if (!config) {
    return <p className="muted">{t('modelAnalysis.singleMissing')}</p>
  }

  const entries = Object.entries(config).sort(([a], [b]) => a.localeCompare(b))
  const grouped = CONFIG_GROUP_ORDER.map((g) => ({
    group: g,
    rows: entries.filter(([k]) => groupKey(k) === g),
  })).filter((b) => b.rows.length > 0)

  const consistency = buildConsistency(run)

  return (
    <div className="ma-compare-stack">
      <div className="ma-single-run-head">
        <h3>{run.label}</h3>
        <code className="ma-single-path">{run.path}</code>
      </div>

      <div className="ma-config-run-grid single">
        <article className="ma-config-run-card" style={{ '--run-color': 'var(--accent)' } as CSSProperties}>
          <header>
            <span className="ma-config-run-name">{t('modelAnalysis.singleConfigSummary')}</span>
          </header>
          <dl className="ma-config-run-dl">
            <div><dt>{t('modelAnalysis.quickLr')}</dt><dd>{fmtValue(config.lr)}</dd></div>
            <div><dt>{t('modelAnalysis.quickBatch')}</dt><dd>{fmtValue(config.batch_size)}</dd></div>
            <div><dt>{t('modelAnalysis.quickCameras')}</dt><dd>{fmtValue(config.camera_names)}</dd></div>
            <div><dt>{t('modelAnalysis.quickActionSpace')}</dt><dd>{fmtValue(config.action_space)}</dd></div>
          </dl>
        </article>
      </div>

      {grouped.map(({ group, rows }) => (
        <section key={group} className="ma-panel card">
          <header className="ma-panel-head">
            <h3>{t(`modelAnalysis.configGroup.${group}`)}</h3>
          </header>
          <div className="ma-panel-body">
            <dl className="ma-single-config-dl">
              {rows.map(([key, val]) => (
                <div key={key}>
                  <dt><code>{key}</code></dt>
                  <dd>{fmtValue(val)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      ))}

      {consistency.length > 0 ? (
        <section className="ma-panel card">
          <header className="ma-panel-head">
            <h3>{t('modelAnalysis.artifact.policy_config.panel2')}</h3>
          </header>
          <div className="ma-panel-body">
            <p className="muted ma-section-note">{t('modelAnalysis.consistencyHint')}</p>
            <div className="ma-consistency-grid">
              <div className="ma-consistency-card">
                {consistency.map((c) => (
                  <div key={c.field} className={`ma-consistency-row${c.match ? ' ok' : ' warn'}`}>
                    <code>{c.field}</code>
                    <span>config {fmtValue(c.config)} · stats {fmtValue(c.stats)}</span>
                    <span className={`ma-badge ${c.match ? 'ok' : 'warn'}`}>
                      {c.match ? t('modelAnalysis.same') : t('modelAnalysis.diff')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
