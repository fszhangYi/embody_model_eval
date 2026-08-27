import { VECTOR_GROUP_META } from './constants'
import { datasetMetaSourceLabel, formatDatasetMetaBrief, hasEpisodeMeta } from './datasetMeta'
import { fmtNum, fmtValue } from './format'
import { artifactData, asNumberArray, bestValEpoch, parseHistoryData } from './runHelpers'
import type { AnalysisMode, CkptRun, ModelCompareResult } from './types'

type TFn = (key: string, vars?: Record<string, string | number>) => string

function mdEscapeCell(v: unknown): string {
  const s = v == null ? '—' : String(v)
  return s.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function mdTable(headers: string[], rows: string[][]): string {
  if (!rows.length) return ''
  const head = `| ${headers.join(' | ')} |`
  const sep = `| ${headers.map(() => '---').join(' | ')} |`
  const body = rows.map((r) => `| ${r.map(mdEscapeCell).join(' | ')} |`).join('\n')
  return `${head}\n${sep}\n${body}`
}

function downloadText(filename: string, text: string, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function stamp(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function vectorTitle(key: string, locale: 'zh' | 'en'): string {
  return VECTOR_GROUP_META[key]?.[locale] ?? key
}

function runArtifactsSection(run: CkptRun, t: TFn): string[] {
  const lines: string[] = []
  lines.push(`### ${run.label}`)
  lines.push('')
  lines.push(`- **path**: \`${run.path}\``)
  if (hasEpisodeMeta(run.datasetMeta)) {
    lines.push(`- **${t('modelAnalysis.episodeCountsTitle')}**: ${formatDatasetMetaBrief(run.datasetMeta, t)}`)
    if (run.datasetMeta?.source) {
      lines.push(`- **source**: ${datasetMetaSourceLabel(run.datasetMeta.source, t)}`)
    }
    if (run.datasetMeta?.dataDir) {
      lines.push(`- **${t('modelAnalysis.episodeDataDir')}**: \`${run.datasetMeta.dataDir}\``)
    }
  }
  lines.push('')
  const artRows = Object.entries(run.artifacts).map(([key, art]) => [
    key,
    art.filename ?? key,
    art.ok ? t('modelAnalysis.statusLoaded') : art.error ?? t('modelAnalysis.statusPartial'),
    art.sizeBytes != null ? String(art.sizeBytes) : '—',
  ])
  lines.push(mdTable(['key', 'file', 'status', 'bytes'], artRows))
  lines.push('')
  return lines
}

function singleStatsMd(run: CkptRun, locale: 'zh' | 'en', t: TFn): string[] {
  const stats = artifactData<Record<string, unknown>>(run, 'dataset_stats')
  const lines: string[] = ['## dataset_stats.pkl', '']
  if (!stats) {
    lines.push(t('modelAnalysis.singleMissing'))
    lines.push('')
    return lines
  }

  const scalarRows: string[][] = []
  if (run.datasetMeta?.trainEpisodes != null) {
    scalarRows.push([t('modelAnalysis.scalarTrainEpisodes'), String(run.datasetMeta.trainEpisodes)])
  }
  if (run.datasetMeta?.valEpisodes != null) {
    scalarRows.push([t('modelAnalysis.scalarValEpisodes'), String(run.datasetMeta.valEpisodes)])
  }
  if (run.datasetMeta?.totalEpisodes != null) {
    scalarRows.push([t('modelAnalysis.scalarTotalEpisodes'), String(run.datasetMeta.totalEpisodes)])
  }
  for (const key of ['state_dim', 'max_episode_len', 'chunk_size_for_delta'] as const) {
    scalarRows.push([key, fmtValue(stats[key])])
  }
  lines.push(mdTable(['field', 'value'], scalarRows))
  lines.push('')

  for (const key of ['action_mean', 'action_std', 'qpos_mean', 'qpos_std', 'delta_mean', 'delta_std'] as const) {
    const arr = asNumberArray(stats[key])
    if (!arr.length) continue
    lines.push(`### ${vectorTitle(key, locale)} (\`${key}\`)`)
    lines.push('')
    lines.push(mdTable(['dim', 'value'], arr.map((v, i) => [String(i), fmtNum(v)])))
    lines.push('')
  }
  return lines
}

function singleConfigMd(run: CkptRun, t: TFn): string[] {
  const config = artifactData<Record<string, unknown>>(run, 'policy_config')
  const lines: string[] = ['## policy_config.json', '']
  if (!config) {
    lines.push(t('modelAnalysis.singleMissing'))
    lines.push('')
    return lines
  }
  const rows = Object.entries(config)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => [k, fmtValue(v)])
  lines.push(mdTable(['key', 'value'], rows))
  lines.push('')
  return lines
}

function singleHistoryMd(run: CkptRun, t: TFn): string[] {
  const history = parseHistoryData(artifactData(run, 'train_history'))
  const lines: string[] = ['## train_history.json', '']
  if (!history) {
    lines.push(t('modelAnalysis.singleMissing'))
    lines.push('')
    return lines
  }
  const best = bestValEpoch(history.val)
  const finalTrain = history.train.at(-1)
  const finalVal = history.val.at(-1)
  lines.push(
    mdTable(
      ['metric', 'value'],
      [
        [t('modelAnalysis.colEpochs'), `${history.train.length} / ${history.val.length}`],
        [
          t('modelAnalysis.colBestVal'),
          best ? `#${best.epoch} · loss ${fmtNum(best.loss)} · l1 ${fmtNum(best.l1)} · kl ${fmtNum(best.kl)}` : '—',
        ],
        [t('modelAnalysis.colFinalTrainLoss'), fmtNum(finalTrain?.loss)],
        [t('modelAnalysis.colFinalValLoss'), fmtNum(finalVal?.loss)],
      ],
    ),
  )
  lines.push('')
  return lines
}

function compareStatsMd(result: ModelCompareResult, locale: 'zh' | 'en', t: TFn): string[] {
  const data = result.compare.dataset_stats
  const lines: string[] = ['## dataset_stats.pkl', '']
  const scalarRows = data.scalarRows.filter((row) => row.values.some((v) => v != null))
  if (scalarRows.length) {
    lines.push('### Scalars')
    lines.push('')
    lines.push(
      mdTable(
        ['field', ...data.labels, t('modelAnalysis.colSame')],
        scalarRows.map((row) => [
          row.key,
          ...row.values.map((v) => (v == null ? '—' : String(v))),
          row.same ? t('modelAnalysis.same') : t('modelAnalysis.diff'),
        ]),
      ),
    )
    lines.push('')
  }

  for (const block of data.vectorRows) {
    lines.push(`### ${vectorTitle(block.key, locale)} (\`${block.key}\`)`)
    lines.push('')
    const dimLabels = data.dimLabels ?? []
    lines.push(
      mdTable(
        ['dim', ...data.labels, 'Δ'],
        block.rows.map((row) => [
          dimLabels[row.dim] ?? `d${row.dim}`,
          ...row.values.map((v) => fmtNum(v)),
          fmtNum(row.delta),
        ]),
      ),
    )
    lines.push('')
  }
  return lines
}

function compareConfigMd(result: ModelCompareResult, t: TFn): string[] {
  const data = result.compare.policy_config
  const lines: string[] = ['## policy_config.json', '']
  lines.push(
    mdTable(
      ['key', ...data.labels, t('modelAnalysis.colSame')],
      data.rows.map((row) => [
        row.key,
        ...row.values.map((v) => fmtValue(v)),
        row.same ? t('modelAnalysis.same') : t('modelAnalysis.diff'),
      ]),
    ),
  )
  lines.push('')
  return lines
}

function compareHistoryMd(result: ModelCompareResult, t: TFn): string[] {
  const data = result.compare.train_history
  const lines: string[] = ['## train_history.json', '']
  lines.push(
    mdTable(
      [
        t('modelAnalysis.colRun'),
        t('modelAnalysis.colEpochs'),
        t('modelAnalysis.colBestVal'),
        t('modelAnalysis.colFinalValLoss'),
        t('modelAnalysis.colFinalTrainLoss'),
      ],
      data.summaries.map((s) => [
        s.label,
        s.ok ? `${s.epochsTrain ?? '—'} / ${s.epochsVal ?? '—'}` : s.error ?? '—',
        s.ok && s.bestVal
          ? `#${s.bestVal.epoch} · ${fmtNum(s.bestVal.loss)}`
          : '—',
        s.finalVal ? fmtNum(Number(s.finalVal.loss)) : '—',
        s.finalTrain ? fmtNum(Number(s.finalTrain.loss)) : '—',
      ]),
    ),
  )
  lines.push('')
  return lines
}

export function buildModelAnalysisMarkdown(
  result: ModelCompareResult,
  mode: AnalysisMode,
  locale: 'zh' | 'en',
  t: TFn,
): string {
  const lines: string[] = []
  lines.push(`# ${t('modelAnalysis.exportTitle')}`)
  lines.push('')
  lines.push(`- **mode**: ${mode === 'single' ? t('modelAnalysis.modeSingle') : t('modelAnalysis.modeCompare')}`)
  lines.push(`- **generated**: ${new Date().toISOString()}`)
  lines.push(`- **runs**: ${result.runs.length}`)
  lines.push('')

  lines.push(`## ${t('modelAnalysis.exportRuns')}`)
  lines.push('')
  for (const run of result.runs) {
    lines.push(...runArtifactsSection(run, t))
  }

  if (mode === 'single') {
    const run = result.runs[0]
    if (run) {
      lines.push(...singleStatsMd(run, locale, t))
      lines.push(...singleConfigMd(run, t))
      lines.push(...singleHistoryMd(run, t))
    }
  } else {
    lines.push(...compareStatsMd(result, locale, t))
    lines.push(...compareConfigMd(result, t))
    lines.push(...compareHistoryMd(result, t))
  }

  return `${lines.join('\n').trim()}\n`
}

export function downloadModelAnalysisMarkdown(
  result: ModelCompareResult,
  mode: AnalysisMode,
  locale: 'zh' | 'en',
  t: TFn,
): string {
  const md = buildModelAnalysisMarkdown(result, mode, locale, t)
  const label = result.runs[0]?.label?.replace(/[^\w.-]+/g, '_') || 'model'
  const filename = `model-analysis-${mode}-${label}-${stamp()}.md`
  downloadText(filename, md)
  return filename
}

/** Same summary as Markdown export, wrapped as an Agent analysis ask. */
export function buildModelAnalysisAgentPrompt(
  result: ModelCompareResult,
  mode: AnalysisMode,
  locale: 'zh' | 'en',
  t: TFn,
): string {
  const md = buildModelAnalysisMarkdown(result, mode, locale, t)
  const ask =
    mode === 'single'
      ? t('modelAnalysis.askAgentPromptSingle', {
          label: result.runs[0]?.label ?? '—',
          path: result.runs[0]?.path ?? '—',
        })
      : t('modelAnalysis.askAgentPromptCompare', {
          runs: result.runs.length,
          baseline: result.runs[0]?.label ?? '—',
          labels: result.runs.map((r) => r.label).join(locale === 'zh' ? '、' : ', '),
        })
  return `${ask}\n\n---\n\n${md}`
}
