import { t, trText } from '../../i18n/runtime'
import type { PipelineStep, StepField } from '../actPipeline/types'
import type { Pi05RouteMode } from './routeMode'

function trainRouteSuffix(route?: Pi05RouteMode): 'full_ft' | 'smoke_lora' | null {
  if (!route) return null
  return route === 'smoke_lora' ? 'smoke_lora' : 'full_ft'
}

export function stepTitle(step: PipelineStep, route?: Pi05RouteMode): string {
  const suffix = step.id === 'train' ? trainRouteSuffix(route) : null
  if (suffix) {
    const keyed = t(`pi05.step.train.title.${suffix}`)
    if (keyed !== `pi05.step.train.title.${suffix}`) return keyed
  }
  const key = `pi05.step.${step.id}.title`
  const localized = t(key)
  return localized === key ? step.title : localized
}

export function stepDescription(step: PipelineStep, route?: Pi05RouteMode): string {
  const suffix = step.id === 'train' ? trainRouteSuffix(route) : null
  if (suffix) {
    const keyed = t(`pi05.step.train.description.${suffix}`)
    if (keyed !== `pi05.step.train.description.${suffix}`) return keyed
  }
  const key = `pi05.step.${step.id}.description`
  const localized = t(key)
  return localized === key ? step.description : localized
}

export function fieldLabel(stepId: string, field: StepField): string {
  const key = `pi05.field.${stepId}.${field.key}`
  const localized = t(key)
  if (localized !== key) return localized
  const generic = `pi05.field.${field.key}`
  const g = t(generic)
  if (g !== generic) return g
  return trText(field.label)
}

/** Hover tooltip for a pipeline field (native `title`). */
export function fieldTip(stepId: string, field: StepField): string {
  const key = `pi05.fieldTip.${stepId}.${field.key}`
  const localized = t(key)
  if (localized !== key) return localized
  const generic = `pi05.fieldTip.${field.key}`
  const g = t(generic)
  if (g !== generic) return g
  if (field.hint) {
    const viaHint = t('pi05.scriptHint', { hint: field.hint })
    if (viaHint && viaHint !== 'pi05.scriptHint') return viaHint
  }
  return ''
}
