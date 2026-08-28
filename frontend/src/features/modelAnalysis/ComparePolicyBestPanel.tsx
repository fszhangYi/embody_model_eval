import { useLocale } from '../../i18n/LocaleContext'
import { PolicyWeightCanvas } from './PolicyWeightCanvas'
import { VectorGroupCollapse } from './VectorGroupCollapse'
import { CompareRunLegend } from './CompareRunLegend'
import { fmtValue } from './format'
import { artifactData } from './runHelpers'
import type { CkptRun, PolicyBestCompareResult, PolicyBestData } from './types'

function formatNum(n: number | undefined | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString()
}

function PolicyRunTables({ data }: { data: PolicyBestData }) {
  const { t } = useLocale()
  return (
    <>
      <VectorGroupCollapse
        title={t('modelAnalysis.artifact.policy_best.panel1')}
        subtitle={t('modelAnalysis.policyModulesHint', { n: (data.modules ?? []).length })}
      >
        <div className="ma-table-wrap">
          <table className="ma-table compact">
            <thead>
              <tr>
                <th>{t('modelAnalysis.colModule')}</th>
                <th>{t('modelAnalysis.policyParamTensors')}</th>
                <th>{t('modelAnalysis.policyTotalParams')}</th>
              </tr>
            </thead>
            <tbody>
              {(data.modules ?? []).map((mod) => (
                <tr key={mod.prefix}>
                  <td><code>{mod.prefix}</code></td>
                  <td>{formatNum(mod.params)}</td>
                  <td>{formatNum(mod.elements)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </VectorGroupCollapse>
      {(data.topTensors ?? []).length ? (
        <VectorGroupCollapse title={t('modelAnalysis.policyTopTensors')}>
          <div className="ma-table-wrap">
            <table className="ma-table compact">
              <thead>
                <tr>
                  <th>{t('modelAnalysis.colKey')}</th>
                  <th>{t('modelAnalysis.colShape')}</th>
                  <th>{t('modelAnalysis.colDtype')}</th>
                  <th>{t('modelAnalysis.policyTotalParams')}</th>
                </tr>
              </thead>
              <tbody>
                {(data.topTensors ?? []).map((tensor) => (
                  <tr key={tensor.name}>
                    <td><code>{tensor.name}</code></td>
                    <td>{fmtValue(tensor.shape)}</td>
                    <td>{tensor.dtype ?? '—'}</td>
                    <td>{formatNum(tensor.numel)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </VectorGroupCollapse>
      ) : null}
    </>
  )
}

export function ComparePolicyBestPanel({
  data,
  runs,
}: {
  data: PolicyBestCompareResult
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

      {runs.map((run) => {
        const policy = artifactData<PolicyBestData>(run, 'policy_best')
        if (!policy?.visualization) return null
        return (
          <VectorGroupCollapse key={run.path} title={run.label} subtitle={t('modelAnalysis.policyCanvasTitle')} defaultOpen={runs.indexOf(run) === 0}>
            <PolicyWeightCanvas data={policy} />
            <PolicyRunTables data={policy} />
          </VectorGroupCollapse>
        )
      })}

      <section className="ma-panel card">
        <header className="ma-panel-head">
          <h3>{t('modelAnalysis.artifact.policy_best.panel2')}</h3>
        </header>
        <div className="ma-panel-body">
          <div className="ma-table-wrap">
            <table className="ma-table">
              <thead>
                <tr>
                  <th>{t('modelAnalysis.colRun')}</th>
                  <th>{t('modelAnalysis.policyParamTensors')}</th>
                  <th>{t('modelAnalysis.policyTotalParams')}</th>
                  <th>{t('modelAnalysis.policyTotalBytes')}</th>
                </tr>
              </thead>
              <tbody>
                {data.summaries.map((summary) => (
                  <tr key={summary.label} className={summary.ok ? '' : 'diff-row'}>
                    <td>{summary.label}</td>
                    <td>{summary.ok ? formatNum(summary.paramCount) : summary.error ?? '—'}</td>
                    <td>{summary.ok ? formatNum(summary.totalParams) : '—'}</td>
                    <td>{summary.ok ? formatNum(summary.totalBytes) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {data.shapeRows.length ? (
        <VectorGroupCollapse
          title={t('modelAnalysis.policyShapeDiffs')}
          subtitle={t('modelAnalysis.policyDiffCount', { n: data.shapeRows.length })}
          highlight
        >
          <div className="ma-table-wrap">
            <table className="ma-table compact">
              <thead>
                <tr>
                  <th>{t('modelAnalysis.colKey')}</th>
                  {data.labels.map((label) => (
                    <th key={label}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.shapeRows.slice(0, 40).map((row) => (
                  <tr key={row.key}>
                    <td><code>{row.key}</code></td>
                    {row.shapes.map((shape, idx) => (
                      <td key={`${row.key}-${idx}`}>{fmtValue(shape)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </VectorGroupCollapse>
      ) : null}

      {data.weightRows.length ? (
        <VectorGroupCollapse
          title={t('modelAnalysis.policyWeightDiffs')}
          subtitle={t('modelAnalysis.policyDiffCount', { n: data.weightRows.length })}
          highlight
        >
          <div className="ma-table-wrap">
            <table className="ma-table compact">
              <thead>
                <tr>
                  <th>{t('modelAnalysis.colKey')}</th>
                  <th>{t('modelAnalysis.policyMaxAbsDiff')}</th>
                  <th>{t('modelAnalysis.policyMeanAbsDiff')}</th>
                  <th>{t('modelAnalysis.policyRelL2')}</th>
                </tr>
              </thead>
              <tbody>
                {data.weightRows.slice(0, 40).map((row) => (
                  <tr key={row.key}>
                    <td><code>{row.key}</code></td>
                    <td>{row.maxAbsDiff.toExponential(3)}</td>
                    <td>{row.meanAbsDiff.toExponential(3)}</td>
                    <td>{row.relL2.toExponential(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </VectorGroupCollapse>
      ) : null}
    </div>
  )
}
