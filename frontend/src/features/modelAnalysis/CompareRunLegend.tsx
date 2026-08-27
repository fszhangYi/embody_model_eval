import type { CSSProperties } from 'react'
import { useLocale } from '../../i18n/LocaleContext'
import { runColor } from './chartTheme'
import { useModelChartTheme } from './useModelChartTheme'

export function CompareRunLegend({
  labels,
  bestIndex,
}: {
  labels: string[]
  bestIndex?: number | null
}) {
  const { t } = useLocale()
  const theme = useModelChartTheme()

  return (
    <div className="ma-run-legend" aria-label={t('modelAnalysis.legendAria')}>
      {labels.map((label, i) => (
        <span
          key={label}
          className={`ma-run-legend-item${bestIndex === i ? ' best' : ''}`}
          style={{ '--run-color': runColor(theme, i) } as CSSProperties}
        >
          <span className="ma-run-legend-dot" aria-hidden="true" />
          <span className="ma-run-legend-label">{label}</span>
          {i === 0 ? <span className="ma-run-legend-tag">{t('modelAnalysis.baseline')}</span> : null}
          {bestIndex === i ? <span className="ma-run-legend-tag best">{t('modelAnalysis.best')}</span> : null}
        </span>
      ))}
    </div>
  )
}
