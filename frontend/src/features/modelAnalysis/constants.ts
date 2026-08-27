export const RUN_COLORS = [
  '#3dd6c6',
  '#f0b429',
  '#60a5fa',
  '#f87171',
  '#a78bfa',
  '#4ade80',
  '#fb923c',
  '#38bdf8',
] as const

export const CONFIG_GROUP_ORDER = ['training', 'model', 'data', 'other'] as const

export type ConfigGroup = (typeof CONFIG_GROUP_ORDER)[number]

export const VECTOR_GROUP_META: Record<string, { zh: string; en: string }> = {
  action_mean: { zh: '动作均值', en: 'Action mean' },
  action_std: { zh: '动作标准差', en: 'Action std' },
  qpos_mean: { zh: '状态均值', en: 'Qpos mean' },
  qpos_std: { zh: '状态标准差', en: 'Qpos std' },
  delta_mean: { zh: '增量均值', en: 'Delta mean' },
  delta_std: { zh: '增量标准差', en: 'Delta std' },
}
