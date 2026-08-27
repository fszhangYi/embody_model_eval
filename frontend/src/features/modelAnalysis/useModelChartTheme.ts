import { useMemo } from 'react'
import { useAppearance } from '../../prefs/AppearanceContext'
import { readModelChartTheme, type ModelChartTheme } from './chartTheme'

/** Theme-aware palette + Chart.js colors; updates when user toggles light/dark. */
export function useModelChartTheme(): ModelChartTheme {
  const { resolvedTheme } = useAppearance()
  return useMemo(() => readModelChartTheme(resolvedTheme), [resolvedTheme])
}
