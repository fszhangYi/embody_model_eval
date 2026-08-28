import { useLocale } from '../../i18n/LocaleContext'
import { VectorGroupCollapse } from './VectorGroupCollapse'
import { PolicyWeightCanvas } from './PolicyWeightCanvas'
import { fmtValue } from './format'
import { artifactData } from './runHelpers'
import type { CkptRun, PolicyBestData } from './types'

function formatBytes(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatNum(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString()
}

function PolicyStructureTables({ data }: { data: PolicyBestData }) {
  const { t } = useLocale()

  return (
    <>
      <VectorGroupCollapse
        title={t('modelAnalysis.artifact.policy_best.panel1')}
        subtitle={t('modelAnalysis.policyModulesHint', { n: (data.modules ?? []).length })}
        badge={formatNum(data.modules?.length)}
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
        <VectorGroupCollapse
          title={t('modelAnalysis.policyTopTensors')}
          subtitle={t('modelAnalysis.policyTopTensorsHint', { n: (data.topTensors ?? []).length })}
          badge={formatNum(data.topTensors?.length)}
        >
          <div className="ma-table-wrap">
            <table className="ma-table compact">
              <thead>
                <tr>
                  <th>{t('modelAnalysis.colKey')}</th>
                  <th>{t('modelAnalysis.colShape')}</th>
                  <th>{t('modelAnalysis.colDtype')}</th>
                  <th>{t('modelAnalysis.policyTotalParams')}</th>
                  <th>{t('modelAnalysis.optStateBytes')}</th>
                </tr>
              </thead>
              <tbody>
                {(data.topTensors ?? []).map((tensor) => (
                  <tr key={tensor.name}>
                    <td><code>{tensor.name}</code></td>
                    <td>{fmtValue(tensor.shape)}</td>
                    <td>{tensor.dtype ?? '—'}</td>
                    <td>{formatNum(tensor.numel)}</td>
                    <td>{formatBytes(tensor.bytes)}</td>
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

export function SinglePolicyBestPanel({ run }: { run: CkptRun }) {
  const { t } = useLocale()
  const data = artifactData<PolicyBestData>(run, 'policy_best')
  if (!data) {
    return <p className="muted">{t('modelAnalysis.singleMissing')}</p>
  }

  return (
    <div className="ma-compare-stack">
      <div className="ma-single-run-head">
        <h3>{run.label}</h3>
        <code className="ma-single-path">{run.path}</code>
      </div>

      <section className="ma-panel card">
        <header className="ma-panel-head">
          <h3>{t('modelAnalysis.artifact.policy_best.panel2')}</h3>
        </header>
        <div className="ma-panel-body">
          <dl className="ma-single-config-dl">
            <div><dt>{t('modelAnalysis.policyParamTensors')}</dt><dd>{formatNum(data.paramCount)}</dd></div>
            <div><dt>{t('modelAnalysis.policyTotalParams')}</dt><dd>{formatNum(data.totalParams)}</dd></div>
            <div><dt>{t('modelAnalysis.policyTotalBytes')}</dt><dd>{formatBytes(data.totalBytes)}</dd></div>
          </dl>
          {(data.dtypeBreakdown ?? []).length ? (
            <div className="ma-chip-row">
              {(data.dtypeBreakdown ?? []).map((d) => (
                <span key={d.dtype} className="ma-chip">
                  <code>{d.dtype}</code> ×{d.count}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <PolicyWeightCanvas data={data} />
      <PolicyStructureTables data={data} />
    </div>
  )
}
