import { useCallback, useEffect, useMemo, useState } from 'react'
import { PathPickerModal } from '../components/PathPickerModal'
import { PageChrome } from '../components/PageChrome'
import { useLocale } from '../i18n/LocaleContext'
import { t } from '../i18n/runtime'
import { cancelJob, deleteJob, fetchJob, fetchJobs, fetchPipelineSpec, createActLink, removeActLink, runPipelineStep } from '../features/actPipeline/api'
import { HyperparamBenchPanel } from '../features/actPipeline/HyperparamBenchPanel'
import { TrainMemoryGuide } from '../features/actPipeline/TrainMemoryGuide'
import type { BrowseRoot, PipelineJob, PipelineSpec, PipelineStep, StepField } from '../features/actPipeline/types'
import { stepDescription, stepTitle, fieldLabel } from '../features/actPipeline/stepI18n'
import '../styles/act-pipeline.css'

const FLOW_KEYS = [
  { n: 1, labelKey: 'act.flow.quality', to: 'quality_pass.json' },
  { n: 2, labelKey: 'act.flow.hdf5', to: 'converted/' },
  { n: 3, labelKey: 'act.flow.train', to: 'ckpt/' },
  { n: 4, labelKey: 'act.flow.infer', to: 'infer/' },
  { n: 5, labelKey: 'act.flow.embody', to: 'data/' },
] as const

type PickerTarget =
  | { kind: 'field'; field: StepField }
  | { kind: 'root'; root: BrowseRoot }

function defaultParams(step: PipelineStep): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const f of step.fields) {
    if (f.default !== undefined) out[f.key] = f.default
    else if (f.type === 'checkbox') out[f.key] = false
    else out[f.key] = ''
  }
  return out
}

function initParamsFromSpec(spec: PipelineSpec): Record<string, Record<string, string | number | boolean>> {
  const init: Record<string, Record<string, string | number | boolean>> = {}
  for (const st of spec.steps) init[st.id] = defaultParams(st)
  return init
}

function fieldIoRole(field: StepField, step: PipelineStep): 'input' | 'output' | 'neutral' {
  if (field.io === 'input') return 'input'
  if (field.io === 'output') return 'output'
  if (field.io === 'config' || field.key === 'scriptPath') return 'neutral'
  if (step.outputs?.includes(field.key)) return 'output'
  if (field.type === 'path') return 'input'
  return 'neutral'
}

function FieldInput({
  field,
  stepId,
  value,
  browseRoots,
  onChange,
  onBrowse,
  disabled = false,
  ioRole = 'neutral',
}: {
  field: StepField
  stepId: string
  value: string | number | boolean
  browseRoots: Record<BrowseRoot, string>
  onChange: (v: string | number | boolean) => void
  onBrowse?: () => void
  disabled?: boolean
  ioRole?: 'input' | 'output' | 'neutral'
}) {
  const id = `act-field-${field.key}`
  const wide = field.key === 'scriptPath'
  const fieldClass = `act-field act-field-${ioRole}${wide ? ' act-field-wide' : ''}`
  const label = fieldLabel(stepId, field)

  if (field.type === 'checkbox') {
    return (
      <div className={`${fieldClass} act-field-check`}>
        <label className="act-field-check-hit" htmlFor={id}>
          <input
            id={id}
            type="checkbox"
            checked={Boolean(value)}
            disabled={disabled}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{label}</span>
        </label>
      </div>
    )
  }
  if (field.type === 'select') {
    return (
      <label className={fieldClass}>
        <span>{label}</span>
        <select id={id} value={String(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
          {(field.options || []).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </label>
    )
  }
  if (field.type === 'path') {
    const tip = field.hint ? t('act.scriptHint', { hint: field.hint }) : undefined
    return (
      <label className={fieldClass}>
        <span className="act-field-label">
          {ioRole === 'input' ? <span className="act-io-tag in">{t('act.io.in')}</span> : null}
          {ioRole === 'output' ? <span className="act-io-tag out">{t('act.io.out')}</span> : null}
          <span>{label}</span>
          {field.hint ? (
            <span className="act-field-hint" title={tip}>
              {field.hint}
            </span>
          ) : null}
        </span>
        <div className="act-path-field">
          <input
            id={id}
            type="text"
            value={String(value ?? '')}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            title={tip}
            placeholder={field.pathKind === 'file' ? t('act.pathFilePlaceholder') : t('act.pathDirPlaceholder')}
          />
          <button
            type="button"
            className="act-path-browse"
            title={tip || t('act.pathBrowseTitle', { root: browseRoots[field.browseRoot || 'act'] || '' })}
            onClick={onBrowse}
            disabled={disabled}
          >
            {t('act.btnBrowse')}
          </button>
        </div>
      </label>
    )
  }
  return (
    <label className={fieldClass}>
      <span className="act-field-label">
        {ioRole === 'input' ? <span className="act-io-tag in">{t('act.io.in')}</span> : null}
        {ioRole === 'output' ? <span className="act-io-tag out">{t('act.io.out')}</span> : null}
        <span>{label}</span>
      </span>
      <input
        id={id}
        type={field.type === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        disabled={disabled}
        onChange={(e) =>
          onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)
        }
      />
    </label>
  )
}

function rootBrowseAnchor(root: BrowseRoot, current: string, spec: PipelineSpec | null): string {
  const fallback = current || spec?.browseRoots?.[root] || spec?.paths?.[root === 'act' ? 'actRobotRoot' : 'embodyRoot'] || ''
  if (fallback) {
    const parent = fallback.replace(/\/[^/]+$/, '')
    return parent || fallback
  }
  return '/root/autodl-tmp'
}

function truncatePath(path: string, max = 42): string {
  const p = path.trim()
  if (p.length <= max) return p
  return `…${p.slice(-(max - 1))}`
}

function statusClass(status: string): string {
  if (status === 'succeeded') return 'ok'
  if (status === 'failed') return 'err'
  if (status === 'cancelled') return 'cancel'
  if (status === 'running') return 'run'
  return 'idle'
}

function isJobActive(status: string): boolean {
  return status === 'queued' || status === 'running'
}

export function ActPipelinePage() {
  const { locale } = useLocale()
  const [spec, setSpec] = useState<PipelineSpec | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [stepId, setStepId] = useState('quality')
  const [params, setParams] = useState<Record<string, Record<string, string | number | boolean>>>({})
  const [activeJob, setActiveJob] = useState<PipelineJob | null>(null)
  const [jobs, setJobs] = useState<PipelineJob[]>([])
  const [busy, setBusy] = useState(false)
  const [logSyncing, setLogSyncing] = useState(false)
  const [jobsSyncing, setJobsSyncing] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null)
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [embodyRoot, setEmbodyRoot] = useState('')
  const [actRoot, setActRoot] = useState('')
  const [linkReady, setLinkReady] = useState(false)
  const [linkMsg, setLinkMsg] = useState('')

  const browseRoots = useMemo(
    () => ({
      act: actRoot,
      embody: embodyRoot,
    }),
    [actRoot, embodyRoot],
  )

  const step = useMemo(
    () => spec?.steps.find((s) => s.id === stepId) ?? null,
    [spec, stepId],
  )

  const stepLabelForId = useCallback(
    (id: string) => {
      const s = spec?.steps.find((x) => x.id === id)
      return s ? stepTitle(s) : id
    },
    [spec, locale],
  )

  const currentParams = step ? params[step.id] ?? defaultParams(step) : {}

  useEffect(() => {
    fetchPipelineSpec()
      .then((s) => {
        setSpec(s)
        setStepId(s.steps[0]?.id || 'quality')
      })
      .catch((e: Error) => setLoadErr(e.message))
    fetchJobs().then((r) => setJobs(r.jobs)).catch(() => {})
  }, [])

  useEffect(() => {
    const embody = embodyRoot.trim()
    const act = actRoot.trim()
    if (!embody || !act) {
      setLinkReady(false)
      if (!embody) setLinkMsg(t('act.rootActDisabled'))
      else if (!act) setLinkMsg(t('act.linkPickAct'))
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      createActLink(embody, act)
        .then(async (r) => {
          if (cancelled) return
          if (r.linked && r.matches) {
            setLinkReady(true)
            setLinkMsg(`${r.linkPath} → ${r.target}`)
            const s = await fetchPipelineSpec(act, embody)
            setSpec(s)
            setParams(initParamsFromSpec(s))
          } else {
            setLinkReady(false)
            setLinkMsg(r.error || t('act.linkNotReady'))
          }
        })
        .catch((e: Error) => {
          if (!cancelled) {
            setLinkReady(false)
            setLinkMsg(e.message)
          }
        })
    }, 500)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [embodyRoot, actRoot])

  useEffect(() => {
    if (!step) return
    setParams((prev) => {
      if (prev[step.id]) return prev
      return { ...prev, [step.id]: defaultParams(step) }
    })
  }, [step])

  useEffect(() => {
    if (!activeJob || !isJobActive(activeJob.status)) return
    const t = setInterval(() => {
      fetchJob(activeJob.id)
        .then((r) => {
          setActiveJob(r.job)
          if (!isJobActive(r.job.status)) {
            fetchJobs().then((x) => setJobs(x.jobs)).catch(() => {})
          }
        })
        .catch(() => {})
    }, 1500)
    return () => clearInterval(t)
  }, [activeJob])

  const refreshJobs = useCallback(async () => {
    setJobsSyncing(true)
    try {
      const list = await fetchJobs()
      setJobs(list.jobs)
    } catch {
      /* ignore */
    } finally {
      setJobsSyncing(false)
    }
  }, [])

  const refreshActiveJobLog = useCallback(async () => {
    if (!activeJob?.id || activeJob.id === 'local') return
    setLogSyncing(true)
    try {
      const [jobRes] = await Promise.all([fetchJob(activeJob.id), refreshJobs()])
      setActiveJob(jobRes.job)
    } catch {
      /* ignore */
    } finally {
      setLogSyncing(false)
    }
  }, [activeJob?.id, refreshJobs])

  const onCancel = useCallback(async () => {
    if (!activeJob?.id || activeJob.id === 'local' || !isJobActive(activeJob.status)) return
    setCanceling(true)
    try {
      const { job } = await cancelJob(activeJob.id)
      setActiveJob(job)
      await refreshJobs()
    } catch {
      /* ignore */
    } finally {
      setCanceling(false)
    }
  }, [activeJob, refreshJobs])

  const onDeleteJob = useCallback(
    async (job: PipelineJob) => {
      if (!job.id || job.id === 'local') return
      const label = `${stepLabelForId(job.stepId)} (${job.status})`
      if (!confirm(t('act.confirmDeleteJob', { label }))) return
      setDeletingJobId(job.id)
      try {
        await deleteJob(job.id)
        setJobs((prev) => prev.filter((j) => j.id !== job.id))
        if (activeJob?.id === job.id) setActiveJob(null)
      } catch {
        /* ignore */
      } finally {
        setDeletingJobId(null)
      }
    },
    [activeJob?.id],
  )

  const onRun = useCallback(async () => {
    if (!step || !linkReady) return
    setBusy(true)
    try {
      const { job } = await runPipelineStep(
        step.id,
        currentParams as Record<string, unknown>,
        actRoot.trim(),
        embodyRoot.trim(),
      )
      setActiveJob(job)
      const list = await fetchJobs()
      setJobs(list.jobs)
    } catch (e) {
      setActiveJob({
        id: 'local',
        stepId: step.id,
        status: 'failed',
        error: e instanceof Error ? e.message : String(e),
        logTail: String(e),
      })
    } finally {
      setBusy(false)
    }
  }, [step, currentParams, linkReady, actRoot, embodyRoot])

  const setField = (key: string, value: string | number | boolean) => {
    if (!step || !linkReady) return
    setParams((prev) => ({
      ...prev,
      [step.id]: { ...(prev[step.id] ?? defaultParams(step)), [key]: value },
    }))
  }

  const setFields = (patch: Record<string, string | number | boolean>) => {
    if (!step || !linkReady) return
    setParams((prev) => ({
      ...prev,
      [step.id]: { ...(prev[step.id] ?? defaultParams(step)), ...patch },
    }))
  }

  const applyEmbodyRoot = (next: string) => {
    if (next === embodyRoot) return
    if (embodyRoot.trim()) void removeActLink(embodyRoot.trim())
    setEmbodyRoot(next)
    setActRoot('')
    setLinkReady(false)
    setLinkMsg(t('act.linkPickAct'))
    setParams({})
  }

  const applyActRoot = (next: string) => {
    if (next === actRoot) return
    if (embodyRoot.trim()) void removeActLink(embodyRoot.trim())
    setActRoot(next)
    setLinkReady(false)
    setLinkMsg(t('act.linkCreating'))
  }

  const pickerValue = useMemo(() => {
    if (!picker) return ''
    if (picker.kind === 'root') return browseRoots[picker.root]
    if (!step) return ''
    return String(currentParams[picker.field.key] ?? '')
  }, [picker, browseRoots, step, currentParams])

  const onPickerConfirm = (path: string) => {
    if (!picker) return
    if (picker.kind === 'root') {
      if (picker.root === 'embody') applyEmbodyRoot(path)
      else applyActRoot(path)
    } else if (linkReady) {
      setField(picker.field.key, path)
    }
    setPicker(null)
  }

  const embodyReady = Boolean(embodyRoot.trim())
  const actReady = Boolean(actRoot.trim())

  const linkDisplay = useMemo(() => {
    if (linkReady) return linkMsg
    if (!embodyReady) return ''
    if (!actReady) return ''
    return linkMsg || t('act.linkCreating')
  }, [linkReady, embodyReady, actReady, linkMsg])

  const linkPlaceholder = useMemo(() => {
    if (!embodyReady) return t('act.rootActDisabled')
    if (!actReady) return t('act.rootActNeed')
    if (linkReady) return ''
    return t('act.linkAuto')
  }, [embodyReady, actReady, linkReady])

  return (
    <div className="act-pipeline-page" data-locale={locale}>
      <header className="act-header">
        <div className="act-header-brand">
          <h1>{t('act.title')}</h1>
          <p className="act-sub">{t('act.subtitle')}</p>
        </div>
        <div className="act-header-actions">
          <PageChrome className="act-header-actions-inner" />
        </div>
      </header>

      <div className="act-body">
      <div className="act-project-roots">
        <label className={`act-root-field act-root-step${embodyReady ? ' done' : ''}`}>
          <span className="act-root-step-label">{t('act.rootEmbody')}</span>
          <div className="act-path-field">
            <input
              type="text"
              value={embodyRoot}
              onChange={(e) => applyEmbodyRoot(e.target.value)}
              placeholder={t('act.rootEmbodyPlaceholder')}
            />
            <button
              type="button"
              className="act-path-browse"
              onClick={() => setPicker({ kind: 'root', root: 'embody' })}
            >
              {t('act.btnBrowse')}
            </button>
          </div>
        </label>
        <label
          className={`act-root-field act-root-step${actRoot.trim() ? ' done' : ''}${!embodyReady ? ' disabled' : ''}`}
        >
          <span className="act-root-step-label">{t('act.rootAct')}</span>
          <div className="act-path-field">
            <input
              type="text"
              value={actRoot}
              disabled={!embodyReady}
              onChange={(e) => applyActRoot(e.target.value)}
              placeholder={embodyReady ? t('act.rootActPlaceholder') : t('act.rootActDisabled')}
            />
            <button
              type="button"
              className="act-path-browse"
              disabled={!embodyReady}
              onClick={() => setPicker({ kind: 'root', root: 'act' })}
            >
              {t('act.btnBrowse')}
            </button>
          </div>
        </label>
        <div
          className={`act-root-field act-root-step${linkReady ? ' done' : ''}${!embodyReady || !actReady ? ' disabled' : ''}`}
        >
          <span className="act-root-step-label">{t('act.rootLink')}</span>
          <div className="act-path-field">
            <input
              type="text"
              readOnly
              tabIndex={-1}
              value={linkDisplay}
              placeholder={linkPlaceholder}
              className="act-path-readonly"
            />
          </div>
        </div>
      </div>

      <div className="act-flow" aria-label={t("act.flowAria")}>
        {FLOW_KEYS.map((f, i) => (
          <div key={f.n} className="act-flow-item">
            <span className="act-flow-n">{f.n}</span>
            <span className="act-flow-label">{t(f.labelKey)}</span>
            <span className="act-flow-to">{f.to}</span>
            {i < FLOW_KEYS.length - 1 ? <span className="act-flow-arrow">→</span> : null}
          </div>
        ))}
      </div>

      {loadErr ? <div className="act-banner err">{loadErr}</div> : null}

      <div className="act-layout">
        <aside className="act-steps">
          <h2>{t('act.steps')}</h2>
          {spec?.steps.map((s) => (
            <button
              key={s.id}
              type="button"
              className={`act-step-btn${s.id === stepId ? ' active' : ''}${s.variant ? ' variant' : ''}`}
              onClick={() => setStepId(s.id)}
              title={s.subtitle ? t('act.scriptHint', { hint: s.subtitle }) : undefined}
            >
              <span className="act-step-num">{s.step}{s.variant ? '·' : ''}</span>
              <span className="act-step-title">{stepTitle(s)}</span>
              <span className="act-step-sub">{s.subtitle}</span>
            </button>
          ))}
        </aside>

        <main className="act-main">
          {step ? (
            <>
              <div className={`act-config${linkReady ? '' : ' locked'}`}>
                <div className="act-step-head">
                  <div>
                    <h2>{stepTitle(step)}</h2>
                    <p className="muted">{stepDescription(step)}</p>
                    {!linkReady ? (
                      <p className="act-config-hint muted">{t('act.configLocked')}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy || !linkReady}
                    onClick={() => void onRun()}
                  >
                    {busy
                      ? t('act.btnStarting')
                      : step.id === 'hyperparam_bench'
                        ? t('act.btnHyperparam')
                        : t('act.btnRun')}
                  </button>
                </div>
                <div className="act-fields">
                  {step.fields
                    .filter((f) => !f.hidden)
                    .map((f) => (
                    <FieldInput
                      key={f.key}
                      stepId={step.id}
                      field={f}
                      value={currentParams[f.key] ?? ''}
                      browseRoots={browseRoots}
                      onChange={(v) => setField(f.key, v)}
                      disabled={!linkReady}
                      ioRole={fieldIoRole(f, step)}
                      onBrowse={
                        f.type === 'path' && linkReady
                          ? () => setPicker({ kind: 'field', field: f })
                          : undefined
                      }
                    />
                  ))}
                </div>
                {step.id === 'hyperparam_bench' || step.ui === 'hyperparam_bench' ? (
                  <HyperparamBenchPanel
                    scriptPath={String(currentParams.scriptPath ?? '')}
                    disabled={!linkReady}
                    sweepJson={String(currentParams.sweepJson ?? '{}')}
                    baseJson={String(currentParams.baseJson ?? '{}')}
                    onChangeJson={(sweep, base) => {
                      setFields({ sweepJson: sweep, baseJson: base })
                    }}
                  />
                ) : null}
              </div>
              {step.id === 'train' ? (
                <TrainMemoryGuide
                  batchSize={Number(currentParams.batchSize) || 64}
                  numWorkers={Number(currentParams.numWorkers) || 4}
                  cameraNames={String(currentParams.cameraNames ?? '')}
                />
              ) : null}
            </>
          ) : null}

          <section className="act-log">
            <div className="act-log-head">
              <h3>{t('act.logTitle')}</h3>
              <div className="act-log-actions">
                {activeJob?.scriptLogPath ? (
                  <span className="act-log-file" title={activeJob.scriptLogPath}>
                    {t('act.trainLog')}
                  </span>
                ) : null}
                {activeJob && activeJob.id !== 'local' && isJobActive(activeJob.status) ? (
                  <button
                    type="button"
                    className="act-log-cancel"
                    disabled={canceling}
                    onClick={() => void onCancel()}
                    title={t('act.btnCancelTitle')}
                  >
                    {canceling ? t('act.btnCanceling') : t('act.btnCancel')}
                  </button>
                ) : null}
                {activeJob && activeJob.id !== 'local' ? (
                  <button
                    type="button"
                    className="act-log-refresh"
                    disabled={logSyncing}
                    onClick={() => void refreshActiveJobLog()}
                    title={t('act.btnSyncTitle')}
                  >
                    {logSyncing ? t('act.btnSyncing') : t('act.btnSyncLog')}
                  </button>
                ) : null}
                {activeJob ? (
                  <span className={`act-status ${statusClass(activeJob.status)}`}>{activeJob.status}</span>
                ) : null}
              </div>
            </div>
            {activeJob?.command ? <pre className="act-cmd">{activeJob.command}</pre> : null}
            <pre className="act-log-body">
              {activeJob?.logTail ||
                activeJob?.error ||
                (linkReady ? t('act.logEmptyReady') : t('act.logEmptyLocked'))}
            </pre>
          </section>
        </main>

        <aside className="act-jobs">
          <div className="act-jobs-head">
            <h2>{t('act.jobsTitle')}</h2>
            <button
              type="button"
              className="act-jobs-refresh"
              disabled={jobsSyncing}
              onClick={() => void refreshJobs()}
              title={t('act.jobsRefreshTitle')}
            >
              {jobsSyncing ? '…' : t('act.jobsRefresh')}
            </button>
          </div>
          <ul>
            {jobs.map((j) => (
              <li key={j.id} className="act-job-item">
                <button
                  type="button"
                  className={`act-job-row${activeJob?.id === j.id ? ' active' : ''}`}
                  onClick={() => {
                    fetchJob(j.id).then((r) => setActiveJob(r.job)).catch(() => {})
                  }}
                >
                  <span className={`dot ${statusClass(j.status)}`} />
                  <span className="act-job-id">{stepLabelForId(j.stepId)}</span>
                  <span className="act-job-st">{j.status}</span>
                </button>
                <button
                  type="button"
                  className="act-job-delete"
                  disabled={deletingJobId === j.id}
                  title={t('act.jobDelete')}
                  aria-label={t('act.jobDeleteAria', { id: j.stepId })}
                  onClick={(e) => {
                    e.stopPropagation()
                    void onDeleteJob(j)
                  }}
                >
                  {deletingJobId === j.id ? '…' : '×'}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      </div>
      </div>

      <footer className="act-footer">
        <div className="act-footer-brand">
          <span className="act-footer-mark" aria-hidden="true" />
          <span>ACT Pipeline</span>
          <span className="act-footer-sep">·</span>
          <span className="act-footer-muted">embody_model_eval</span>
        </div>
        <div className="act-footer-paths">
          {embodyReady ? (
            <span className="act-footer-path" title={embodyRoot}>
              {t('act.footerEval')} {truncatePath(embodyRoot)}
            </span>
          ) : (
            <span className="act-footer-path idle">{t('act.footerEvalNone')}</span>
          )}
          {actRoot.trim() ? (
            <span className="act-footer-path" title={actRoot}>
              {t('act.footerTrain')} {truncatePath(actRoot)}
            </span>
          ) : embodyReady ? (
            <span className="act-footer-path idle">{t('act.footerTrainNone')}</span>
          ) : null}
        </div>
        <div className="act-footer-meta">
          {step ? <span className="act-footer-step">{stepTitle(step)}</span> : null}
          {jobs.length > 0 ? <span>{t('act.jobsCount', { n: jobs.length })}</span> : null}
        </div>
      </footer>

      {picker ? (
        <PathPickerModal
          open
          title={
            picker.kind === 'root'
              ? picker.root === 'act'
                ? t('act.pickerActRoot')
                : t('act.pickerEmbodyRoot')
              : fieldLabel(stepId, picker.field)
          }
          value={pickerValue}
          browseRoot={picker.kind === 'root' ? picker.root : picker.field.browseRoot || 'act'}
          roots={browseRoots}
          pathKind={picker.kind === 'root' ? 'dir' : picker.field.pathKind || 'dir'}
          browseAnchor={
            picker.kind === 'root' ? rootBrowseAnchor(picker.root, browseRoots[picker.root], spec) : undefined
          }
          onClose={() => setPicker(null)}
          onConfirm={onPickerConfirm}
        />
      ) : null}
    </div>
  )
}
