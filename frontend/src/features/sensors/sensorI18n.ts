import { t, trText } from '../../i18n/runtime'

/** Translate common sensor detail row values (yes/no, connected, etc.). */
const VALUE_KEYS: Record<string, string> = {
  '是': 'sensors.row.yes',
  '否': 'sensors.row.no',
  '已连接': 'sensors.row.hardwareLinked',
  '未接入（运动学仿真）': 'sensors.row.hardwareSim',
  '缺失': 'sensors.row.missing',
  '仿真': 'sensors.metric.simulation',
  '—（未接实机）': 'sensors.row.noHardware',
}

export function sensorValue(text: string): string {
  if (!text || text === '—') return text
  const key = VALUE_KEYS[text]
  return key ? t(key) : trText(text)
}
