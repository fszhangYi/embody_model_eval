import { t, trText } from './runtime'

/** Episode JSON / event notes → i18n keys. */
const DATA_TEXT: Record<string, string> = {
  未建立稳定接触: 'eval.data.noStableContact',
  '接近物体（未抓住）': 'eval.data.approachNoGrasp',
  '夹爪未闭合 / 未建立接触': 'eval.data.gripperOpenNoContact',
  未建立接触: 'eval.data.noContact',
  未抓住: 'eval.data.missGrasp',
  夹爪未闭合: 'eval.data.gripperOpen',
}

/** advanced_cd validateUnitsAndActionMode issue/warning codes. */
const UNIT_MSG: Record<string, string> = {
  missing_action_mode: 'eval.unit.missingActionMode',
  unknown_action_mode: 'eval.unit.unknownActionMode',
  empty: 'eval.unit.emptyFrames',
  unit_mismatch: 'eval.unit.unitMismatch',
  unit_inferred: 'eval.unit.unitInferred',
  delta_looks_absolute: 'eval.unit.deltaLooksAbsolute',
  absolute_looks_small: 'eval.unit.absoluteLooksSmall',
  dof_mismatch: 'eval.unit.dofMismatch',
}

export function trEvalData(text: string | null | undefined): string {
  if (!text) return text ?? ''
  const key = DATA_TEXT[text.trim()]
  if (key) return t(key)
  return trText(text)
}

export function trUnitMsg(item: { code?: string; msg?: string }): string {
  const code = item?.code || ''
  const key = UNIT_MSG[code]
  if (key) {
    const raw = item.msg || ''
    const declared = raw.match(/声明单位 (\S+)/)?.[1]
    const inferred = raw.match(/启发式推断 (\S+)/)?.[1]
      ?? raw.match(/推断为 (\S+)/)?.[1]
    const maxAbs = raw.match(/max\|q\|=(\d+\.?\d*)/)?.[1]
    const mode = raw.match(/action_mode[=:](\S+)/)?.[1]
      ?? raw.match(/未知 action_mode: (\S+)/)?.[1]
    const frame = raw.match(/帧 (\d+)/)?.[1]
    const field = raw.match(/帧 \d+ (\S+)\.length/)?.[1]
    const dof = raw.match(/joint_names\((\d+)\)/)?.[1]
    const len = raw.match(/\.length=(\d+)/)?.[1]
    return t(key, {
      declared: declared ?? '—',
      inferred: inferred ?? '—',
      maxAbs: maxAbs ?? '—',
      mode: mode ?? '—',
      frame: frame ?? '—',
      field: field ?? '—',
      dof: dof ?? '—',
      len: len ?? '—',
    })
  }
  return trText(item.msg || '')
}

export function glossTitle(key: string): string {
  return t(`eval.gloss.${key}.title`)
}

export function glossBody(key: string): string {
  return t(`eval.gloss.${key}.body`)
}

export function hasGloss(key: string): boolean {
  const title = glossTitle(key)
  return title !== `eval.gloss.${key}.title`
}
