import { useEffect, useMemo, useState } from 'react'
import { parseTrainScriptArgs, type ParsedTrainArg } from './api'

type Props = {
  scriptPath: string
  disabled?: boolean
  sweepJson: string
  baseJson: string
  onChangeJson: (sweepJson: string, baseJson: string) => void
}

type RowState = {
  flag: string
  selected: boolean
  candidates: string
  fixedValue: string
  meta: ParsedTrainArg
}

const PREFERRED_CAMS = 'chest top wrist_2'

function defaultCandidates(flag: string, meta: ParsedTrainArg, defaults: Record<string, string[]>): string {
  if (defaults[flag]) return defaults[flag].join(', ')
  if (meta.choices && Array.isArray(meta.choices)) return meta.choices.map(String).join(', ')
  if (meta.default !== null && meta.default !== undefined) return String(meta.default)
  return ''
}

function defaultFixed(flag: string, meta: ParsedTrainArg): string {
  if (flag === 'camera-names') return PREFERRED_CAMS
  if (flag === 'action-space') return 'cartesian_abs'
  if (flag === 'grad-clip') return '1'
  if (meta.action === 'store_true') return meta.default ? 'true' : 'false'
  if (meta.default !== null && meta.default !== undefined) {
    if (Array.isArray(meta.default)) return meta.default.join(' ')
    return String(meta.default)
  }
  return ''
}

function parseCandidateList(raw: string, meta: ParsedTrainArg): unknown[] {
  const parts = raw
    .split(/[,，\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (!parts.length) return []
  if (meta.type === 'int') return parts.map((p) => Number.parseInt(p, 10))
  if (meta.type === 'float') return parts.map((p) => Number.parseFloat(p))
  if (meta.type === 'bool' || meta.action === 'store_true') {
    return parts.map((p) => ['1', 'true', 'yes', 'on'].includes(p.toLowerCase()))
  }
  return parts
}

function coerceFixed(raw: string, meta: ParsedTrainArg): unknown {
  const s = raw.trim()
  if (meta.nargs === '+' || meta.flag === 'camera-names') {
    return s.split(/\s+/).filter(Boolean)
  }
  if (meta.type === 'int') return Number.parseInt(s, 10)
  if (meta.type === 'float') return Number.parseFloat(s)
  if (meta.type === 'bool' || meta.action === 'store_true') {
    return ['1', 'true', 'yes', 'on'].includes(s.toLowerCase())
  }
  return s
}

function buildRows(
  args: ParsedTrainArg[],
  defaultSweepFlags: string[],
  defaultSweepValues: Record<string, string[]>,
): RowState[] {
  return args
    .filter((a) => a.sweepable !== false)
    .map((meta) => {
      const selected = defaultSweepFlags.includes(meta.flag)
      return {
        flag: meta.flag,
        selected,
        candidates: defaultCandidates(meta.flag, meta, defaultSweepValues),
        fixedValue: defaultFixed(meta.flag, meta),
        meta,
      }
    })
}

function serialize(rows: RowState[]): { sweepJson: string; baseJson: string } {
  const sweep: Record<string, unknown> = {}
  const base: Record<string, unknown> = {}
  for (const row of rows) {
    if (row.selected) {
      const vals = parseCandidateList(row.candidates, row.meta)
      if (vals.length) sweep[row.flag] = vals
    } else {
      const v = coerceFixed(row.fixedValue, row.meta)
      if (row.fixedValue.trim() !== '' && !(typeof v === 'number' && Number.isNaN(v))) {
        base[row.flag] = v
      }
    }
  }
  // Loader knobs must exist in base if not swept (bench harness requires them)
  for (const req of ['batch-size', 'num-workers', 'hdf5-cache-size'] as const) {
    if (!(req in sweep) && !(req in base)) {
      const row = rows.find((r) => r.flag === req)
      if (row) base[req] = coerceFixed(row.fixedValue || row.candidates.split(/[,，]/)[0] || '8', row.meta)
    }
  }
  return {
    sweepJson: JSON.stringify(sweep),
    baseJson: JSON.stringify(base),
  }
}

export function HyperparamBenchPanel({
  scriptPath,
  disabled = false,
  sweepJson,
  baseJson: _baseJson,
  onChangeJson,
}: Props) {
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [rows, setRows] = useState<RowState[]>([])
  const [parsedPath, setParsedPath] = useState('')

  useEffect(() => {
    const path = scriptPath.trim()
    if (!path || disabled) return
    if (path === parsedPath && rows.length) return
    let cancelled = false
    const t = window.setTimeout(() => {
      setLoading(true)
      setErr('')
      parseTrainScriptArgs(path)
        .then((res) => {
          if (cancelled) return
          const next = buildRows(res.args, res.defaultSweepFlags, res.defaultSweepValues)
          setRows(next)
          setParsedPath(path)
          const ser = serialize(next)
          onChangeJson(ser.sweepJson, ser.baseJson)
        })
        .catch((e: Error) => {
          if (!cancelled) {
            setErr(e.message)
            setRows([])
          }
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reparse only when scriptPath changes
  }, [scriptPath, disabled])

  const comboCount = useMemo(() => {
    try {
      const sweep = JSON.parse(sweepJson || '{}') as Record<string, unknown[]>
      const sizes = Object.values(sweep).map((v) => (Array.isArray(v) ? v.length : 1))
      if (!sizes.length) return 0
      return sizes.reduce((a, b) => a * b, 1)
    } catch {
      return 0
    }
  }, [sweepJson])

  const updateRow = (flag: string, patch: Partial<RowState>) => {
    setRows((prev) => {
      const next = prev.map((r) => (r.flag === flag ? { ...r, ...patch } : r))
      const ser = serialize(next)
      onChangeJson(ser.sweepJson, ser.baseJson)
      return next
    })
  }

  const selectedCount = rows.filter((r) => r.selected).length

  return (
    <section className={`act-hp-bench${disabled ? ' locked' : ''}`}>
      <div className="act-hp-bench-head">
        <div>
          <h3>超参搜索配置</h3>
          <p className="muted">
            从 train 脚本解析 CLI 参数。勾选参与搜索的项并填写候选值（逗号分隔）；未勾选的作为固定基线。
          </p>
        </div>
        <div className="act-hp-bench-meta">
          {loading ? <span className="muted">解析中…</span> : null}
          {!loading && rows.length ? (
            <span className="act-hp-pill">
              搜索 {selectedCount} 维 · 组合 {comboCount}
            </span>
          ) : null}
        </div>
      </div>
      {err ? <div className="act-banner err">{err}</div> : null}
      {rows.length ? (
        <div className="act-hp-table-wrap">
          <table className="act-hp-table">
            <thead>
              <tr>
                <th>搜索</th>
                <th>参数</th>
                <th>候选值 / 固定值</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.flag} className={row.selected ? 'sweep' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={row.selected}
                      disabled={disabled}
                      onChange={(e) => updateRow(row.flag, { selected: e.target.checked })}
                      aria-label={`搜索 ${row.flag}`}
                    />
                  </td>
                  <td>
                    <code>{row.meta.cli}</code>
                    <span className="act-hp-type">{row.meta.type || 'str'}</span>
                  </td>
                  <td>
                    {row.selected ? (
                      <input
                        type="text"
                        disabled={disabled}
                        value={row.candidates}
                        placeholder="如 8, 16, 24"
                        onChange={(e) => updateRow(row.flag, { candidates: e.target.value })}
                      />
                    ) : row.meta.action === 'store_true' ? (
                      <label className="act-hp-bool">
                        <input
                          type="checkbox"
                          disabled={disabled}
                          checked={['1', 'true', 'yes', 'on'].includes(row.fixedValue.toLowerCase())}
                          onChange={(e) =>
                            updateRow(row.flag, { fixedValue: e.target.checked ? 'true' : 'false' })
                          }
                        />
                        启用
                      </label>
                    ) : (
                      <input
                        type="text"
                        disabled={disabled}
                        value={row.fixedValue}
                        onChange={(e) => updateRow(row.flag, { fixedValue: e.target.value })}
                      />
                    )}
                  </td>
                  <td className="muted" title={row.meta.help}>
                    {(row.meta.help || '').slice(0, 80)}
                    {(row.meta.help || '').length > 80 ? '…' : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !loading && !err ? (
        <p className="muted">请选择有效的 train 脚本以解析超参</p>
      ) : null}
      {comboCount > 0 ? (
        <p className="act-hp-hint muted">
          将尝试 <strong>{comboCount}</strong> 组短测（每组 train/val 微基准），完成后日志与结果 JSON
          中会给出最快组合。
        </p>
      ) : null}
    </section>
  )
}
