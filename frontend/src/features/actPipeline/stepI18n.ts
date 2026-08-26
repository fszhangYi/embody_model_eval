import { actFieldLabels } from '../../i18n/actFieldLabels'
import { getLocale, t } from '../../i18n/runtime'
import type { PipelineStep, StepField } from './types'

/** Localized step title (sidebar + main heading). */
export function stepTitle(step: PipelineStep): string {
  return t(`act.step.${step.id}.title`)
}

/** Localized step description (main panel). */
export function stepDescription(step: PipelineStep): string {
  return t(`act.step.${step.id}.description`)
}

/** Localized field label (IN/OUT row title). */
export function fieldLabel(stepId: string, field: StepField): string {
  const flatKey = `${stepId}.${field.key}`
  const locale = getLocale()
  const labels = actFieldLabels[locale] ?? actFieldLabels.zh
  return labels[flatKey] ?? actFieldLabels.zh[flatKey] ?? field.label
}
