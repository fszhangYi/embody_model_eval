import { useLocale } from '../../i18n/LocaleContext'
import { OptimizerDeepPanel } from './OptimizerDeepPanel'
import { artifactData } from './runHelpers'
import type { CkptRun, OptimizerData } from './types'

export function SingleOptimizerPanel({ run }: { run: CkptRun }) {
  const { t } = useLocale()
  const data = artifactData<OptimizerData>(run, 'optimizer')
  if (!data) {
    return <p className="muted">{t('modelAnalysis.singleMissing')}</p>
  }

  return (
    <div className="ma-compare-stack">
      <div className="ma-single-run-head">
        <h3>{run.label}</h3>
        <code className="ma-single-path">{run.path}</code>
      </div>
      <OptimizerDeepPanel data={data} />
    </div>
  )
}
