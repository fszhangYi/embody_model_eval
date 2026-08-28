import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PathPickerModal } from '../components/PathPickerModal'
import { PageChrome } from '../components/PageChrome'
import { useLocale } from '../i18n/LocaleContext'
import {
  analyzeGpuArtifacts,
  compareCkptDirs,
  fetchGpuStatus,
  mergeGpuAnalyzeResult,
} from '../features/modelAnalysis/api'
import {
  ALL_ARTIFACT_IDS,
  GPU_ARTIFACT_IDS,
  MODEL_ARTIFACTS,
  type ModelArtifactId,
} from '../features/modelAnalysis/artifacts'
import { CompareDatasetStatsPanel } from '../features/modelAnalysis/CompareDatasetStatsPanel'
import { CompareOptimizerPanel } from '../features/modelAnalysis/CompareOptimizerPanel'
import { CompareOverviewPanel } from '../features/modelAnalysis/CompareOverviewPanel'
import { ComparePolicyBestPanel } from '../features/modelAnalysis/ComparePolicyBestPanel'
import { ComparePolicyConfigPanel } from '../features/modelAnalysis/ComparePolicyConfigPanel'
import { CompareTrainHistoryPanel } from '../features/modelAnalysis/CompareTrainHistoryPanel'
import { firstRun } from '../features/modelAnalysis/runHelpers'
import {
  SingleDatasetStatsPanel,
  singleDimLabels,
} from '../features/modelAnalysis/SingleDatasetStatsPanel'
import { SingleOptimizerPanel } from '../features/modelAnalysis/SingleOptimizerPanel'
import { SingleOverviewPanel } from '../features/modelAnalysis/SingleOverviewPanel'
import { SinglePolicyBestPanel } from '../features/modelAnalysis/SinglePolicyBestPanel'
import { SinglePolicyConfigPanel } from '../features/modelAnalysis/SinglePolicyConfigPanel'
import { SingleTrainHistoryPanel } from '../features/modelAnalysis/SingleTrainHistoryPanel'
import {
  buildModelAnalysisAgentPrompt,
  downloadModelAnalysisMarkdown,
} from '../features/modelAnalysis/exportMarkdown'
import { AgentLinkModal } from '../features/chat/AgentLinkModal'
import { stashChatPendingPrompt } from '../features/chat/pendingPrompt'
import type { AnalysisMode, ArtifactKey, ModelCompareResult } from '../features/modelAnalysis/types'
import '../styles/model-analysis.css'

const ARTIFACT_TO_KEY: Partial<Record<ModelArtifactId, ArtifactKey>> = {
  dataset_stats: 'dataset_stats',
  policy_config: 'policy_config',
  train_history: 'train_history',
  optimizer: 'optimizer',
  policy_best: 'policy_best',
}

function artifactStatus(
  result: ModelCompareResult | null,
  artifactId: ModelArtifactId,
  gpuAvailable: boolean,
  gpuLoaded: boolean,
): 'idle' | 'ok' | 'missing' | 'na' {
  if (GPU_ARTIFACT_IDS.has(artifactId)) {
    if (!gpuAvailable) return 'na'
    if (!result || !gpuLoaded) return 'idle'
    const gpuKey = ARTIFACT_TO_KEY[artifactId]
    if (!gpuKey) return 'idle'
    const okCount = result.runs.filter((r) => r.artifacts[gpuKey]?.ok).length
    if (okCount === 0) return 'missing'
    if (okCount === result.runs.length) return 'ok'
    return 'missing'
  }
  const key = ARTIFACT_TO_KEY[artifactId]
  if (!key || !result) return 'idle'
  const okCount = result.runs.filter((r) => r.artifacts[key]?.ok).length
  if (okCount === 0) return 'missing'
  if (okCount === result.runs.length) return 'ok'
  return 'missing'
}

function GpuArtifactPlaceholder({
  gpuAvailable,
  gpuLoaded,
  onAnalyzeGpu,
  gpuBusy,
  validDirs,
  mode,
}: {
  gpuAvailable: boolean
  gpuLoaded: boolean
  onAnalyzeGpu: () => void
  gpuBusy: boolean
  validDirs: string[]
  mode: AnalysisMode
}) {
  const { t } = useLocale()

  if (gpuLoaded) return null

  return (
    <div className="ma-empty-state ma-gpu-block">
      <h3>{gpuAvailable ? t('modelAnalysis.gpuPendingTitle') : t('modelAnalysis.gpuRequiredTitle')}</h3>
      <p className="muted">
        {gpuAvailable ? t('modelAnalysis.gpuPendingDesc') : t('modelAnalysis.gpuRequiredDesc')}
      </p>
      <button
        type="button"
        className="ma-btn primary"
        disabled={!gpuAvailable || gpuBusy || validDirs.length < 1 || (mode === 'compare' && validDirs.length < 2)}
        onClick={onAnalyzeGpu}
      >
        {gpuBusy ? t('modelAnalysis.gpuAnalyzing') : t('modelAnalysis.gpuAnalyze')}
      </button>
    </div>
  )
}

function ArtifactDetailContent({
  mode,
  artifactId,
  result,
  gpuAvailable,
  gpuLoaded,
  gpuBusy,
  validDirs,
  onAnalyzeGpu,
}: {
  mode: AnalysisMode
  artifactId: ModelArtifactId
  result: ModelCompareResult | null
  gpuAvailable: boolean
  gpuLoaded: boolean
  gpuBusy: boolean
  validDirs: string[]
  onAnalyzeGpu: () => void
}) {
  const { t } = useLocale()
  const run = firstRun(result)
  const isGpu = GPU_ARTIFACT_IDS.has(artifactId)

  if (!result || !run) {
    if (isGpu) {
      return (
        <GpuArtifactPlaceholder
          gpuAvailable={gpuAvailable}
          gpuLoaded={false}
          onAnalyzeGpu={onAnalyzeGpu}
          gpuBusy={gpuBusy}
          validDirs={validDirs}
          mode={mode}
        />
      )
    }
    return (
      <div className="ma-empty-state">
        <div className="ma-empty-icon" aria-hidden="true">
          ◫
        </div>
        <h3>{t('modelAnalysis.emptyTitle')}</h3>
        <p className="muted">{t('modelAnalysis.emptyDesc')}</p>
      </div>
    )
  }

  if (mode === 'single') {
    return (
      <div className="ma-detail-panes">
        {isGpu && !gpuLoaded ? (
          <GpuArtifactPlaceholder
            gpuAvailable={gpuAvailable}
            gpuLoaded={gpuLoaded}
            onAnalyzeGpu={onAnalyzeGpu}
            gpuBusy={gpuBusy}
            validDirs={validDirs}
            mode={mode}
          />
        ) : null}
        {isGpu && gpuLoaded && artifactId === 'optimizer' ? <SingleOptimizerPanel run={run} /> : null}
        {isGpu && gpuLoaded && artifactId === 'policy_best' ? <SinglePolicyBestPanel run={run} /> : null}
        <div
          className={`ma-detail-pane${artifactId === 'dataset_stats' ? ' active' : ''}`}
          hidden={artifactId !== 'dataset_stats'}
        >
          <SingleDatasetStatsPanel run={run} dimLabels={singleDimLabels(result)} />
        </div>
        <div
          className={`ma-detail-pane${artifactId === 'policy_config' ? ' active' : ''}`}
          hidden={artifactId !== 'policy_config'}
        >
          <SinglePolicyConfigPanel run={run} />
        </div>
        <div
          className={`ma-detail-pane${artifactId === 'train_history' ? ' active' : ''}`}
          hidden={artifactId !== 'train_history'}
        >
          <SingleTrainHistoryPanel run={run} active={artifactId === 'train_history'} />
        </div>
      </div>
    )
  }

  return (
    <div className="ma-detail-panes">
      {isGpu && !gpuLoaded ? (
        <GpuArtifactPlaceholder
          gpuAvailable={gpuAvailable}
          gpuLoaded={gpuLoaded}
          onAnalyzeGpu={onAnalyzeGpu}
          gpuBusy={gpuBusy}
          validDirs={validDirs}
          mode={mode}
        />
      ) : null}
      {isGpu && gpuLoaded && artifactId === 'optimizer' && result.compare.optimizer ? (
        <CompareOptimizerPanel data={result.compare.optimizer} runs={result.runs} />
      ) : null}
      {isGpu && gpuLoaded && artifactId === 'policy_best' && result.compare.policy_best ? (
        <ComparePolicyBestPanel data={result.compare.policy_best} runs={result.runs} />
      ) : null}
      <div
        className={`ma-detail-pane${artifactId === 'dataset_stats' ? ' active' : ''}`}
        hidden={artifactId !== 'dataset_stats'}
      >
        <CompareDatasetStatsPanel data={result.compare.dataset_stats} />
      </div>
      <div
        className={`ma-detail-pane${artifactId === 'policy_config' ? ' active' : ''}`}
        hidden={artifactId !== 'policy_config'}
      >
        <ComparePolicyConfigPanel data={result.compare.policy_config} />
      </div>
      <div
        className={`ma-detail-pane${artifactId === 'train_history' ? ' active' : ''}`}
        hidden={artifactId !== 'train_history'}
      >
        <CompareTrainHistoryPanel
          data={result.compare.train_history}
          active={artifactId === 'train_history'}
        />
      </div>
    </div>
  )
}

export function ModelAnalysisPage() {
  const { t, locale } = useLocale()
  const navigate = useNavigate()
  const [mode, setMode] = useState<AnalysisMode>('single')
  const [selectedId, setSelectedId] = useState<ModelArtifactId>('dataset_stats')
  const [singleDir, setSingleDir] = useState('')
  const [ckptDirs, setCkptDirs] = useState(['', ''])
  const [actRoot, setActRoot] = useState('/root/autodl-tmp/act_robot')
  const [pickerTarget, setPickerTarget] = useState<'single' | number | null>(null)
  const [singleResult, setSingleResult] = useState<ModelCompareResult | null>(null)
  const [compareResult, setCompareResult] = useState<ModelCompareResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [gpuBusy, setGpuBusy] = useState(false)
  const [gpuAvailable, setGpuAvailable] = useState(false)
  const [gpuLoaded, setGpuLoaded] = useState(false)
  const [error, setError] = useState('')
  const [agentModalOpen, setAgentModalOpen] = useState(false)
  const autoAnalyzeRef = useRef(0)

  const result = mode === 'single' ? singleResult : compareResult
  const setResult = mode === 'single' ? setSingleResult : setCompareResult

  const selected = useMemo(
    () => MODEL_ARTIFACTS.find((a) => a.id === selectedId) ?? MODEL_ARTIFACTS[0],
    [selectedId],
  )

  useEffect(() => {
    fetch('/api/fs/roots')
      .then((r) => r.json())
      .then((d) => {
        if (d?.roots?.act) setActRoot(d.roots.act)
      })
      .catch(() => {})
    fetchGpuStatus()
      .then((status) => setGpuAvailable(Boolean(status.available)))
      .catch(() => setGpuAvailable(false))
  }, [])

  const validDirs = useMemo(() => {
    if (mode === 'single') {
      const d = singleDir.trim()
      return d ? [d] : []
    }
    return ckptDirs.map((d) => d.trim()).filter(Boolean)
  }, [mode, singleDir, ckptDirs])

  const loadedCount = useMemo(() => {
    if (!result) return 0
    return ALL_ARTIFACT_IDS.filter((id) => artifactStatus(result, id, gpuAvailable, gpuLoaded) === 'ok').length
  }, [result, gpuAvailable, gpuLoaded])

  const canAnalyze = validDirs.length >= 1 && (mode !== 'compare' || validDirs.length >= 2)

  const runLightAnalyze = useCallback(async () => {
    if (!canAnalyze) return
    setBusy(true)
    setError('')
    setGpuLoaded(false)
    try {
      const data = await compareCkptDirs(validDirs)
      setResult(data)
    } catch (e) {
      setResult(null)
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg === 'not found' ? t('modelAnalysis.errServerStale') : msg)
    } finally {
      setBusy(false)
    }
  }, [canAnalyze, validDirs, t, setResult])

  useEffect(() => {
    if (!canAnalyze) {
      setResult(null)
      setGpuLoaded(false)
      return
    }
    const token = ++autoAnalyzeRef.current
    const timer = window.setTimeout(() => {
      if (token !== autoAnalyzeRef.current) return
      void runLightAnalyze()
    }, 500)
    return () => window.clearTimeout(timer)
  }, [canAnalyze, validDirs.join('\u0000'), mode, runLightAnalyze, setResult])

  const onAnalyzeGpu = useCallback(async () => {
    if (!canAnalyze || !gpuAvailable) return
    setGpuBusy(true)
    setError('')
    try {
      const gpu = await analyzeGpuArtifacts(validDirs)
      setResult((prev) => (prev ? mergeGpuAnalyzeResult(prev, gpu) : null))
      setGpuLoaded(true)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg === 'not found' ? t('modelAnalysis.errServerStale') : msg)
    } finally {
      setGpuBusy(false)
    }
  }, [canAnalyze, gpuAvailable, validDirs, t, setResult])

  const onAnalyze = useCallback(async () => {
    await runLightAnalyze()
  }, [runLightAnalyze])

  const switchMode = (next: AnalysisMode) => {
    if (next === mode) return
    setMode(next)
    setError('')
    setGpuLoaded(false)
    if (next === 'single' && !singleDir.trim() && ckptDirs[0]?.trim()) {
      setSingleDir(ckptDirs[0].trim())
    }
    if (next === 'compare' && ckptDirs.every((d) => !d.trim()) && singleDir.trim()) {
      setCkptDirs([singleDir.trim(), ''])
    }
  }

  const statusLabel = (id: ModelArtifactId): string => {
    const st = artifactStatus(result, id, gpuAvailable, gpuLoaded)
    if (st === 'ok') return t('modelAnalysis.statusLoaded')
    if (st === 'missing') return t('modelAnalysis.statusPartial')
    if (st === 'na') return t('modelAnalysis.statusGpu')
    return t('modelAnalysis.statusPending')
  }

  const analyzeLabel =
    mode === 'single'
      ? busy
        ? t('modelAnalysis.singleAnalyzing')
        : t('modelAnalysis.singleAnalyze')
      : busy
        ? t('modelAnalysis.analyzing')
        : t('modelAnalysis.analyzeRefresh')

  const sendToAgent = () => {
    if (!result) return
    setAgentModalOpen(true)
  }

  const completeAgentHandoff = () => {
    if (!result) return
    const message = buildModelAnalysisAgentPrompt(result, mode, locale, t)
    stashChatPendingPrompt({
      message,
      autoSend: true,
      newSession: true,
      source: 'model-analysis',
    })
    navigate('/chat')
  }

  return (
    <div className="model-analysis-page">
      <header className="ma-header">
        <div className="ma-header-brand">
          <h1>{t('modelAnalysis.title')}</h1>
          <p className="ma-header-blurb">{t('modelAnalysis.subtitle')}</p>
        </div>
        <div className="ma-header-actions">
          <PageChrome className="ma-header-actions-inner" />
        </div>
      </header>

      <main className="ma-main">
        <section className="ma-toolbar card" aria-label={t('modelAnalysis.toolbarAria')}>
          <div className="ma-mode-switch" role="tablist" aria-label={t('modelAnalysis.modeAria')}>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'single'}
              className={`ma-mode-btn${mode === 'single' ? ' active' : ''}`}
              onClick={() => switchMode('single')}
            >
              {t('modelAnalysis.modeSingle')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'compare'}
              className={`ma-mode-btn${mode === 'compare' ? ' active' : ''}`}
              onClick={() => switchMode('compare')}
            >
              {t('modelAnalysis.modeCompare')}
            </button>
          </div>

          {mode === 'single' ? (
            <div className="ma-ckpt-row">
              <label className="ma-field ma-field-wide">
                <span>{t('modelAnalysis.ckptDir')}</span>
                <input
                  type="text"
                  value={singleDir}
                  placeholder={t('modelAnalysis.ckptDirPlaceholder')}
                  onChange={(e) => setSingleDir(e.target.value)}
                />
              </label>
              <div className="ma-toolbar-btns">
                <button type="button" className="ma-btn ghost" onClick={() => setPickerTarget('single')}>
                  {t('modelAnalysis.browse')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="ma-ckpt-list">
                {ckptDirs.map((dir, idx) => (
                  <div key={idx} className="ma-ckpt-row">
                    <label className="ma-field ma-field-wide">
                      <span>
                        {t('modelAnalysis.ckptDir')} {idx + 1}
                        {idx === 0 ? ` (${t('modelAnalysis.baseline')})` : ''}
                      </span>
                      <input
                        type="text"
                        value={dir}
                        placeholder={t('modelAnalysis.ckptDirPlaceholder')}
                        onChange={(e) => {
                          const next = [...ckptDirs]
                          next[idx] = e.target.value
                          setCkptDirs(next)
                        }}
                      />
                    </label>
                    <div className="ma-toolbar-btns">
                      <button type="button" className="ma-btn ghost" onClick={() => setPickerTarget(idx)}>
                        {t('modelAnalysis.browse')}
                      </button>
                      {ckptDirs.length > 1 ? (
                        <button
                          type="button"
                          className="ma-btn ghost"
                          title={t('modelAnalysis.removeDir')}
                          onClick={() => setCkptDirs(ckptDirs.filter((_, i) => i !== idx))}
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              <div className="ma-toolbar-actions inline">
                <button
                  type="button"
                  className="ma-btn ghost"
                  disabled={ckptDirs.length >= 8}
                  onClick={() => setCkptDirs([...ckptDirs, ''])}
                >
                  {t('modelAnalysis.addDir')}
                </button>
              </div>
            </>
          )}

          <div className="ma-toolbar-actions">
            <button
              type="button"
              className="ma-btn primary"
              disabled={busy || !canAnalyze}
              onClick={() => void onAnalyze()}
            >
              {analyzeLabel}
            </button>
            <button
              type="button"
              className="ma-btn ghost"
              disabled={!gpuAvailable || gpuBusy || !canAnalyze || !result}
              onClick={() => void onAnalyzeGpu()}
              title={gpuAvailable ? t('modelAnalysis.gpuAnalyzeHint') : t('modelAnalysis.gpuRequiredDesc')}
            >
              {gpuBusy ? t('modelAnalysis.gpuAnalyzing') : t('modelAnalysis.gpuAnalyze')}
            </button>
          </div>

          <p className="muted ma-toolbar-hint">
            {mode === 'single' ? t('modelAnalysis.toolbarHintSingle') : t('modelAnalysis.toolbarHint')}
          </p>
          {gpuAvailable ? (
            <p className="muted ma-toolbar-hint">{t('modelAnalysis.gpuReadyHint')}</p>
          ) : (
            <p className="muted ma-toolbar-hint">{t('modelAnalysis.gpuUnavailableHint')}</p>
          )}
          {error ? <p className="ma-error">{error}</p> : null}
        </section>

        <div className="ma-layout">
          <aside className="ma-sidebar card" aria-label={t('modelAnalysis.artifactsAria')}>
            <div className="ma-sidebar-head">
              <h2>{t('modelAnalysis.artifactsTitle')}</h2>
              <p className="muted">
                {mode === 'single' ? t('modelAnalysis.artifactsHintSingle') : t('modelAnalysis.artifactsHint')}
              </p>
            </div>
            <ul className="ma-artifact-list" role="list">
              {MODEL_ARTIFACTS.map((artifact) => {
                const active = artifact.id === selectedId
                const st = artifactStatus(result, artifact.id, gpuAvailable, gpuLoaded)
                return (
                  <li key={artifact.id}>
                    <button
                      type="button"
                      className={`ma-artifact-item${active ? ' active' : ''}`}
                      aria-current={active ? 'true' : undefined}
                      onClick={() => setSelectedId(artifact.id)}
                    >
                      <span className="ma-artifact-main">
                        <span className="ma-artifact-name">{artifact.filename}</span>
                        <span className="ma-artifact-desc">{t(`modelAnalysis.artifact.${artifact.id}.desc`)}</span>
                      </span>
                      <span className="ma-artifact-meta">
                        <span className="ma-format-tag">{t(artifact.formatKey)}</span>
                        <span className={`ma-status-dot ${st}`} title={statusLabel(artifact.id)} />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          <div className="ma-content">
            <section className="ma-status-strip card" aria-label={t('modelAnalysis.statusStrip')}>
              <div className="ma-status-head">
                <h2>{t('modelAnalysis.statusStrip')}</h2>
                <span className="ma-status-summary muted">
                  {result
                    ? mode === 'single'
                      ? t('modelAnalysis.statusSummarySingle', {
                          loaded: loadedCount,
                          total: ALL_ARTIFACT_IDS.length,
                          label: result.runs[0]?.label ?? '',
                        })
                      : t('modelAnalysis.statusSummaryDone', {
                          loaded: loadedCount,
                          total: ALL_ARTIFACT_IDS.length,
                          runs: result.runs.length,
                        })
                    : t('modelAnalysis.statusSummary')}
                </span>
              </div>
              <div className="ma-status-chips">
                {MODEL_ARTIFACTS.map((artifact) => {
                  const st = artifactStatus(result, artifact.id, gpuAvailable, gpuLoaded)
                  return (
                    <div key={artifact.id} className={`ma-status-chip ${st}`}>
                      <code>{artifact.filename}</code>
                      <span>{statusLabel(artifact.id)}</span>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="ma-overview card">
              <div className="ma-overview-head">
                <div>
                  <h2>{t('modelAnalysis.overview')}</h2>
                  <p className="muted">
                    {mode === 'single' ? t('modelAnalysis.overviewDescSingle') : t('modelAnalysis.overviewDesc')}
                  </p>
                </div>
                <div className="ma-overview-stats">
                  <div className="ma-stat">
                    <span className="l">
                      {mode === 'single' ? t('modelAnalysis.statModel') : t('modelAnalysis.statRuns')}
                    </span>
                    <span className="v">{result?.runs.length ?? 0}</span>
                  </div>
                  <div className="ma-stat">
                    <span className="l">{t('modelAnalysis.statLoaded')}</span>
                    <span className={`v${loadedCount > 0 ? ' ok' : ' off'}`}>{loadedCount}</span>
                  </div>
                  {mode === 'compare' ? (
                    <div className="ma-stat">
                      <span className="l">{t('modelAnalysis.statCompareReady')}</span>
                      <span className={`v${result && result.runs.length >= 2 ? ' ok' : ' off'}`}>
                        {result && result.runs.length >= 2 ? t('modelAnalysis.yes') : t('modelAnalysis.no')}
                      </span>
                    </div>
                  ) : null}
                  {result ? (
                    <>
                      <button
                        type="button"
                        className="ma-btn ghost compact"
                        onClick={() => downloadModelAnalysisMarkdown(result, mode, locale, t)}
                      >
                        {t('modelAnalysis.exportMarkdown')}
                      </button>
                      <button
                        type="button"
                        className="ma-btn primary compact"
                        onClick={sendToAgent}
                        title={t('modelAnalysis.askAgentHint')}
                      >
                        {t('modelAnalysis.askAgent')}
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
              {result && firstRun(result) ? (
                mode === 'single' ? (
                  <SingleOverviewPanel run={firstRun(result)!} />
                ) : (
                  <>
                    <CompareOverviewPanel result={result} />
                    <div className="ma-run-tags">
                      {result.runs.map((run) => (
                        <span key={run.path} className="ma-run-tag" title={run.path}>
                          {run.label}
                        </span>
                      ))}
                    </div>
                  </>
                )
              ) : (
                <div className="ma-empty-state compact">
                  <p className="muted">{t('modelAnalysis.emptyDesc')}</p>
                </div>
              )}
            </section>

            <section className="ma-detail card" aria-labelledby="ma-detail-title">
              <header className="ma-detail-head">
                <div>
                  <p className="ma-detail-kicker">
                    {mode === 'single' ? t('modelAnalysis.detailKickerSingle') : t('modelAnalysis.detailKicker')}
                  </p>
                  <h2 id="ma-detail-title">
                    <code>{selected.filename}</code>
                  </h2>
                  <p className="muted">{t(`modelAnalysis.artifact.${selected.id}.desc`)}</p>
                </div>
                <span className="ma-format-tag large">{t(selected.formatKey)}</span>
              </header>
              <ArtifactDetailContent
                mode={mode}
                artifactId={selectedId}
                result={result}
                gpuAvailable={gpuAvailable}
                gpuLoaded={gpuLoaded}
                gpuBusy={gpuBusy}
                validDirs={validDirs}
                onAnalyzeGpu={() => void onAnalyzeGpu()}
              />
            </section>
          </div>
        </div>
      </main>

      {pickerTarget !== null ? (
        <PathPickerModal
          open
          title={t('modelAnalysis.pickCkptTitle')}
          value={pickerTarget === 'single' ? singleDir : ckptDirs[pickerTarget] || ''}
          browseRoot="act"
          roots={{ act: actRoot, embody: actRoot }}
          pathKind="dir"
          browseAnchor={actRoot}
          onClose={() => setPickerTarget(null)}
          onConfirm={(path) => {
            if (pickerTarget === 'single') {
              setSingleDir(path)
            } else {
              const next = [...ckptDirs]
              next[pickerTarget] = path
              setCkptDirs(next)
            }
            setPickerTarget(null)
          }}
        />
      ) : null}

      <AgentLinkModal
        open={agentModalOpen}
        onClose={() => setAgentModalOpen(false)}
        onReady={completeAgentHandoff}
      />
    </div>
  )
}
