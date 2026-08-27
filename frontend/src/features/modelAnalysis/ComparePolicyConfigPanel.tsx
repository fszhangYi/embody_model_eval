import type { CSSProperties } from 'react'
import { useMemo, useState } from 'react'
import { useLocale } from '../../i18n/LocaleContext'
import { runColor } from './chartTheme'
import { CONFIG_GROUP_ORDER, type ConfigGroup } from './constants'
import { CompareRunLegend } from './CompareRunLegend'
import { fmtValue } from './format'
import { useModelChartTheme } from './useModelChartTheme'
import type { ModelCompareResult, PolicyConfigRow } from './types'

function ConfigCell({
  value,
  same,
  color,
}: {
  value: unknown
  same: boolean
  color: string
}) {
  return (
    <td className={`ma-config-cell${same ? '' : ' diff'}`}>
      <span className="ma-config-cell-inner" style={{ borderLeftColor: color }}>
        {fmtValue(value)}
      </span>
    </td>
  )
}

function groupRows(rows: PolicyConfigRow[], group: ConfigGroup, showSame: boolean) {
  return rows.filter((r) => r.group === group && r.present && (showSame || !r.same))
}

export function ComparePolicyConfigPanel({ data }: { data: ModelCompareResult['compare']['policy_config'] }) {
  const { t } = useLocale()
  const theme = useModelChartTheme()
  const labels = data.labels
  const [showSame, setShowSame] = useState(false)

  const grouped = useMemo(() => {
    const out: { group: ConfigGroup; rows: PolicyConfigRow[] }[] = []
    for (const g of CONFIG_GROUP_ORDER) {
      const rows = groupRows(data.rows, g, showSame)
      if (rows.length) out.push({ group: g, rows })
    }
    return out
  }, [data.rows, showSame])

  return (
    <div className="ma-compare-stack">
      <div className="ma-compare-summary">
        <CompareRunLegend labels={labels} />
        <div className="ma-compare-kpis">
          <div className={`ma-kpi${data.diffCount ? ' warn' : ' ok'}`}>
            <span className="l">{t('modelAnalysis.kpiConfig')}</span>
            <span className="v">
              {data.diffCount === 0 ? t('modelAnalysis.allMatch') : t('modelAnalysis.configDiffCount', { n: data.diffCount })}
            </span>
          </div>
        </div>
      </div>

      <div className="ma-config-run-grid">
        {labels.map((label, i) => {
          const cfg = data.rows.reduce<Record<string, unknown>>((acc, row) => {
            acc[row.key] = row.values[i]
            return acc
          }, {})
          return (
            <article
              key={label}
              className="ma-config-run-card"
              style={{ '--run-color': runColor(theme, i) } as CSSProperties}
            >
              <header>
                <span className="ma-config-run-name">{label}</span>
                {i === 0 ? <span className="ma-run-legend-tag">{t('modelAnalysis.baseline')}</span> : null}
              </header>
              <dl className="ma-config-run-dl">
                <div>
                  <dt>{t('modelAnalysis.quickLr')}</dt>
                  <dd>{fmtValue(cfg.lr)}</dd>
                </div>
                <div>
                  <dt>{t('modelAnalysis.quickBatch')}</dt>
                  <dd>{fmtValue(cfg.batch_size)}</dd>
                </div>
                <div>
                  <dt>{t('modelAnalysis.quickCameras')}</dt>
                  <dd>{fmtValue(cfg.camera_names)}</dd>
                </div>
                <div>
                  <dt>{t('modelAnalysis.quickActionSpace')}</dt>
                  <dd>{fmtValue(cfg.action_space)}</dd>
                </div>
              </dl>
            </article>
          )
        })}
      </div>

      <div className="ma-section-toolbar">
        <h3 className="ma-section-title">{t('modelAnalysis.configMatrix')}</h3>
        <label className="ma-toggle">
          <input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} />
          <span>{t('modelAnalysis.showSameKeys')}</span>
        </label>
      </div>

      {grouped.map(({ group, rows }) => (
        <section key={group} className="ma-panel card">
          <header className="ma-panel-head">
            <h3>{t(`modelAnalysis.configGroup.${group}`)}</h3>
            <span className="muted">{rows.filter((r) => !r.same).length} {t('modelAnalysis.diff')}</span>
          </header>
          <div className="ma-panel-body ma-table-wrap">
            <table className="ma-table ma-config-matrix">
              <thead>
                <tr>
                  <th>{t('modelAnalysis.colKey')}</th>
                  {labels.map((l, i) => (
                    <th key={l} style={{ color: runColor(theme, i) }}>
                      {l}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key} className={row.same ? 'same' : 'diff'}>
                    <td>
                      <code>{row.key}</code>
                    </td>
                    {row.values.map((v, i) => (
                      <ConfigCell key={i} value={v} same={row.same} color={runColor(theme, i)} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {data.consistency.length > 0 ? (
        <section className="ma-panel card">
          <header className="ma-panel-head">
            <h3>{t('modelAnalysis.artifact.policy_config.panel2')}</h3>
          </header>
          <div className="ma-panel-body">
            <p className="muted ma-section-note">{t('modelAnalysis.consistencyHint')}</p>
            <div className="ma-consistency-grid">
              {data.consistency.map((block) => (
                <div key={block.label} className="ma-consistency-card">
                  <h4>{block.label}</h4>
                  {block.checks.map((c) => (
                    <div key={c.field} className={`ma-consistency-row${c.match ? ' ok' : ' warn'}`}>
                      <code>{c.field}</code>
                      <span>
                        config {fmtValue(c.config)} · stats {fmtValue(c.stats)}
                      </span>
                      <span className={`ma-badge ${c.match ? 'ok' : 'warn'}`}>
                        {c.match ? t('modelAnalysis.same') : t('modelAnalysis.diff')}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  )
}
