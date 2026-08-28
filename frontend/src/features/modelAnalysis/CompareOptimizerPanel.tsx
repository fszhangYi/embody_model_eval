import { useLocale } from '../../i18n/LocaleContext'
import { OptimizerDeepPanel } from './OptimizerDeepPanel'
import { VectorGroupCollapse } from './VectorGroupCollapse'
import { CompareRunLegend } from './CompareRunLegend'
import { fmtValue } from './format'
import { artifactData } from './runHelpers'
import type { CkptRun, OptimizerCompareResult, OptimizerData } from './types'

export function CompareOptimizerPanel({
  data,
  runs,
}: {
  data: OptimizerCompareResult
  runs: CkptRun[]
}) {
  const { t } = useLocale()

  return (
    <div className="ma-compare-stack">
      <div className="ma-compare-summary">
        <CompareRunLegend labels={data.labels} />
        <div className="ma-compare-kpis">
          <div className={`ma-kpi${data.diffCount ? ' warn' : ' ok'}`}>
            <span className="l">{t('modelAnalysis.kpiScalar')}</span>
            <span className="v">
              {data.diffCount === 0 ? t('modelAnalysis.allMatch') : t('modelAnalysis.configDiffCount', { n: data.diffCount })}
            </span>
          </div>
        </div>
      </div>

      <section className="ma-panel card">
        <header className="ma-panel-head">
          <h3>{t('modelAnalysis.optCompareScalars')}</h3>
        </header>
        <div className="ma-panel-body">
          <div className="ma-table-wrap">
            <table className="ma-table">
              <thead>
                <tr>
                  <th>{t('modelAnalysis.colField')}</th>
                  {data.labels.map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                  <th>{t('modelAnalysis.colSame')}</th>
                </tr>
              </thead>
              <tbody>
                {data.scalarRows.map((row) => (
                  <tr key={row.key} className={row.same ? '' : 'diff-row'}>
                    <td><code>{row.key}</code></td>
                    {row.values.map((value, idx) => (
                      <td key={`${row.key}-${idx}`}>{fmtValue(value)}</td>
                    ))}
                    <td>{row.same ? t('modelAnalysis.yes') : t('modelAnalysis.no')}</td>
                  </tr>
                ))}
                {data.schedulerRows.map((row) => (
                  <tr key={`sched-${row.key}`} className={row.same ? '' : 'diff-row'}>
                    <td><code>scheduler.{row.key}</code></td>
                    {row.values.map((value, idx) => (
                      <td key={`${row.key}-${idx}`}>{fmtValue(value)}</td>
                    ))}
                    <td>{row.same ? t('modelAnalysis.yes') : t('modelAnalysis.no')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {data.groupRows.length ? (
        <VectorGroupCollapse
          title={t('modelAnalysis.artifact.optimizer.panel2')}
          subtitle={t('modelAnalysis.optGroupCompareHint', { n: data.groupRows.length })}
        >
          {data.groupRows.map((row) => (
            <div key={row.groupIndex} className="ma-opt-group-block">
              <h4>{t('modelAnalysis.optGroupIndex', { n: row.groupIndex + 1 })}</h4>
              <div className="ma-table-wrap">
                <table className="ma-table compact">
                  <thead>
                    <tr>
                      <th>{t('modelAnalysis.colField')}</th>
                      {data.labels.map((label) => (
                        <th key={label}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(['lr', 'weightDecay', 'paramCount'] as const).map((field) => (
                      <tr key={field} className={row[field].same ? '' : 'diff-row'}>
                        <td><code>{field}</code></td>
                        {row[field].values.map((value, idx) => (
                          <td key={`${field}-${idx}`}>{fmtValue(value)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </VectorGroupCollapse>
      ) : null}

      {runs.map((run) => {
        const opt = artifactData<OptimizerData>(run, 'optimizer')
        if (!opt) return null
        return (
          <VectorGroupCollapse
            key={run.path}
            title={run.label}
            subtitle={<code>{run.path.split('/').slice(-2).join('/')}</code>}
            badge={opt.optimizerType}
          >
            <OptimizerDeepPanel data={opt} />
          </VectorGroupCollapse>
        )
      })}
    </div>
  )
}
