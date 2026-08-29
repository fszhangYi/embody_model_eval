import { useCallback, useEffect, useMemo, useState } from 'react'
import { PathPickerModal } from '../components/PathPickerModal'
import { PageChrome } from '../components/PageChrome'
import { useLocale } from '../i18n/LocaleContext'
import { t } from '../i18n/runtime'
import {
  cancelPi05Job,
  deletePi05Job,
  fetchPi05Job,
  fetchPi05Jobs,
  fetchPi05Spec,
  runPi05Step,
} from '../features/pi05/api'
import { fieldLabel, stepDescription, stepTitle } from '../features/pi05/stepI18n'
import { Pi05TrainGuide } from '../features/pi05/TrainGuide'
import { Pi05TrainTheory } from '../features/pi05/TrainTheory'
import { Pi05RouteChrome } from '../features/pi05/Pi05RouteChrome'
import {
  resolveInitialPi05Route,
  writeStoredPi05Route,
  type Pi05RouteMode,
} from '../features/pi05/routeMode'
import '../styles/pi05-route.css'
import type {
  BrowseRoot,
  PipelineJob,
  PipelineSpec,
  PipelineStep,
  StepField,
} from '../features/actPipeline/types'
import '../styles/act-pipeline.css'
import '../styles/pi05-pipeline.css'

const FLOW_KEYS = [
  { n: 1, id: 'convert', labelKey: 'pi05.flow.convert', to: 'lerobot/' },
  { n: 2, id: 'norm_stats', labelKey: 'pi05.flow.norm', to: 'norm_stats.json' },
  { n: 3, id: 'train', labelKey: 'pi05.flow.train', to: 'checkpoints/' },
  { n: 4, id: 'infer_batch', labelKey: 'pi05.flow.infer', to: 'infer/' },
  { n: 5, id: 'embody', labelKey: 'pi05.flow.embody', to: 'data/' },
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
  const id = `pi05-field-${field.key}`
  const wide = field.key === 'scriptPath' || field.key === 'configPath' || field.key === 'taskPrompt'
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
            <option key={o} value={o} title={o}>
              {o.includes('/') ? o.split('/').pop() : o}
            </option>
          ))}
        </select>
      </label>
    )
  }
  if (field.type === 'path') {
    const tip = field.hint ? t('pi05.scriptHint', { hint: field.hint }) : undefined
    return (
      <label className={fieldClass}>
        <span className="act-field-label">
          {ioRole === 'input' ? <span className="act-io-tag in">{t('pi05.io.in')}</span> : null}
          {ioRole === 'output' ? <span className="act-io-tag out">{t('pi05.io.out')}</span> : null}
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
            placeholder={field.pathKind === 'file' ? t('pi05.pathFilePlaceholder') : t('pi05.pathDirPlaceholder')}
          />
          <button
            type="button"
            className="act-path-browse"
            title={tip || t('pi05.pathBrowseTitle', { root: browseRoots[field.browseRoot || 'pi05'] || '' })}
            onClick={onBrowse}
            disabled={disabled}
          >
            {t('pi05.btnBrowse')}
          </button>
        </div>
      </label>
    )
  }
  return (
    <label className={fieldClass}>
      <span className="act-field-label">
        {ioRole === 'input' ? <span className="act-io-tag in">{t('pi05.io.in')}</span> : null}
        {ioRole === 'output' ? <span className="act-io-tag out">{t('pi05.io.out')}</span> : null}
        <span>{label}</span>
      </span>
      <input
        id={id}
        type={field.type === 'number' ? 'number' : 'text'}
        value={String(value ?? '')}
        disabled={disabled}
        onChange={(e) => onChange(field.type === 'number' ? Number(e.target.value) : e.target.value)}
      />
    </label>
  )
}

/** Path picker chroot for π0.5 pages: parent of the project = /root/autodl-tmp. */
const PI05_BROWSE_SUPERROOT = '/root/autodl-tmp'

function rootBrowseAnchor(_root: BrowseRoot, _current: string, _spec: PipelineSpec | null): string {
  return PI05_BROWSE_SUPERROOT
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

function checkTrue(v: unknown): boolean {
  return v === true || v === 'true'
}

export function Pi05PipelinePage() {
  const { locale } = useLocale()
  const [spec, setSpec] = useState<PipelineSpec | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [stepId, setStepId] = useState('convert')
  const [params, setParams] = useState<Record<string, Record<string, string | number | boolean>>>({})
  const [activeJob, setActiveJob] = useState<PipelineJob | null>(null)
  const [jobs, setJobs] = useState<PipelineJob[]>([])
  const [busy, setBusy] = useState(false)
  const [logSyncing, setLogSyncing] = useState(false)
  const [jobsSyncing, setJobsSyncing] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [deletingJobId, setDeletingJobId] = useState<string | null>(null)
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [pi05Root, setPi05Root] = useState('')
  const [route, setRoute] = useState<Pi05RouteMode>(() => resolveInitialPi05Route())

  useEffect(() => {
    writeStoredPi05Route(route)
  }, [route])

  useEffect(() => {
    fetchPi05Spec(pi05Root.trim() || undefined, route)
      .then((s) => {
        setSpec(s)
        setLoadErr('')
        if (!pi05Root.trim() && (s.paths?.pi05Root || s.browseRoots?.pi05)) {
          setPi05Root(s.paths?.pi05Root || s.browseRoots?.pi05 || '')
        }
        setParams((prev) => {
          const next = initParamsFromSpec(s)
          for (const id of Object.keys(next)) {
            if (prev[id]) next[id] = { ...next[id], ...prev[id] }
          }
          return next
        })
      })
      .catch((e: Error) => setLoadErr(e.message))
  }, [route, pi05Root])

  const browseRoots = useMemo(
    () =>
      ({
        pi05: PI05_BROWSE_SUPERROOT,
        act: PI05_BROWSE_SUPERROOT,
        embody: PI05_BROWSE_SUPERROOT,
      }) as Record<BrowseRoot, string>,
    [],
  )

  const step = useMemo(() => spec?.steps.find((s) => s.id === stepId) ?? null, [spec, stepId])
  const rootsReady = Boolean(pi05Root.trim())
  const currentParams = step ? params[step.id] ?? defaultParams(step) : {}
  const checks = spec?.checks || {}

  const stepLabelForId = useCallback(
    (id: string) => {
      const s = spec?.steps.find((x) => x.id === id)
      return s ? stepTitle(s, route) : id
    },
    [spec, locale, route],
  )

  useEffect(() => {
    fetchPi05Spec(undefined, route)
      .then((s) => {
        setSpec(s)
        setPi05Root(s.paths?.pi05Root || s.browseRoots?.pi05 || '')
        setStepId(s.steps[0]?.id || 'convert')
        setParams(initParamsFromSpec(s))
      })
      .catch((e: Error) => setLoadErr(e.message))
    fetchPi05Jobs()
      .then((r) => setJobs(r.jobs))
      .catch(() => {})
  }, [])


  useEffect(() => {
    if (!step) return
    setParams((prev) => {
      if (prev[step.id]) return prev
      return { ...prev, [step.id]: defaultParams(step) }
    })
  }, [step])

  useEffect(() => {
    if (!activeJob || !isJobActive(activeJob.status)) return
    const id = activeJob.id
    const timer = window.setInterval(() => {
      fetchPi05Job(id)
        .then((r) => {
          setActiveJob(r.job)
          if (!isJobActive(r.job.status)) {
            fetchPi05Jobs()
              .then((j) => setJobs(j.jobs))
              .catch(() => {})
          }
        })
        .catch(() => {})
    }, 1500)
    return () => window.clearInterval(timer)
  }, [activeJob?.id, activeJob?.status])

  const setField = (key: string, value: string | number | boolean) => {
    if (!step) return
    setParams((prev) => ({
      ...prev,
      [step.id]: { ...(prev[step.id] || defaultParams(step)), [key]: value },
    }))
  }

  const onRun = async () => {
    if (!step || !rootsReady) return
    setBusy(true)
    try {
      const r = await runPi05Step(step.id, currentParams, pi05Root.trim(), route)
      setActiveJob(r.job)
      const j = await fetchPi05Jobs()
      setJobs(j.jobs)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onCancel = async () => {
    if (!activeJob || !isJobActive(activeJob.status)) return
    setCanceling(true)
    try {
      const r = await cancelPi05Job(activeJob.id)
      setActiveJob(r.job)
      const j = await fetchPi05Jobs()
      setJobs(j.jobs)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCanceling(false)
    }
  }

  const refreshActiveJobLog = async () => {
    if (!activeJob) return
    setLogSyncing(true)
    try {
      const r = await fetchPi05Job(activeJob.id)
      setActiveJob(r.job)
    } finally {
      setLogSyncing(false)
    }
  }

  const refreshJobs = async () => {
    setJobsSyncing(true)
    try {
      const j = await fetchPi05Jobs()
      setJobs(j.jobs)
    } finally {
      setJobsSyncing(false)
    }
  }

  const onDeleteJob = async (j: PipelineJob) => {
    const stepLabel = stepLabelForId(j.stepId)
    if (!window.confirm(t('pi05.confirmDeleteJob', { label: stepLabel }))) return
    setDeletingJobId(j.id)
    try {
      await deletePi05Job(j.id)
      if (activeJob?.id === j.id) setActiveJob(null)
      const next = await fetchPi05Jobs()
      setJobs(next.jobs)
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e))
    } finally {
      setDeletingJobId(null)
    }
  }

  const healthOk =
    checkTrue(checks.baseCkptExists) && checkTrue(checks.lerobotExists) && checkTrue(checks.pi05Exists)

  const pickerValue = useMemo(() => {
    if (!picker) return ''
    if (picker.kind === 'root') return browseRoots[picker.root]
    if (!step) return ''
    return String(currentParams[picker.field.key] ?? '')
  }, [picker, browseRoots, step, currentParams])

  return (
    <div className="act-pipeline-page pi05-pipeline-page" data-locale={locale}>
      <header className="act-header">
        <div className="act-header-brand">
          <h1>{t('pi05.title')}</h1>
          <p className="act-sub">{t('pi05.subtitle')}</p>
        </div>
        <div className="act-header-actions">
          <PageChrome className="act-header-actions-inner" />
        </div>
      </header>

      <div className="act-body">
        <Pi05RouteChrome route={route} onChange={setRoute} />

        <div className="act-project-roots">
          <label className={`act-root-field act-root-step${pi05Root.trim() ? ' done' : ''}`}>
            <span className="act-root-step-label">{t('pi05.rootPi05')}</span>
            <div className="act-path-field">
              <input
                type="text"
                value={pi05Root}
                onChange={(e) => setPi05Root(e.target.value)}
                placeholder={t('pi05.rootPi05Placeholder')}
              />
              <button type="button" className="act-path-browse" onClick={() => setPicker({ kind: 'root', root: 'pi05' })}>
                {t('pi05.btnBrowse')}
              </button>
            </div>
          </label>
          <div className={`act-root-field act-root-step pi05-health-field${healthOk ? ' done' : ''}`}>
            <span className="act-root-step-label">{t('pi05.healthLabel')}</span>
            <div className="pi05-health-shell" aria-label={t('pi05.healthLabel')}>
              <span className={`pi05-pill${checkTrue(checks.baseCkptExists) ? ' ok' : ' bad'}`}>
                {t('pi05.health.base')}
              </span>
              <span className={`pi05-pill${checkTrue(checks.lerobotExists) ? ' ok' : ' bad'}`}>
                {t('pi05.health.lerobot')}
              </span>
              <span className="pi05-pill info">
                {t('pi05.health.configs', { n: Number(checks.configCount) || 0 })}
              </span>
            </div>
          </div>
        </div>

        <div className="act-flow" aria-label={t('pi05.flowAria')}>
          {FLOW_KEYS.map((f, i) => {
            const active =
              stepId === f.id ||
              (f.id === 'infer_batch' && stepId === 'infer_single') ||
              (f.id === 'embody' && stepId === 'embody_chunk')
            return (
              <span key={f.n} className="pi05-flow-wrap">
                <button
                  type="button"
                  className={`act-flow-item${active ? ' active' : ''}`}
                  onClick={() => setStepId(f.id)}
                >
                  <span className="act-flow-n">{f.n}</span>
                  <span className="act-flow-label">{t(f.labelKey)}</span>
                  <span className="act-flow-to">{f.to}</span>
                </button>
                {i < FLOW_KEYS.length - 1 ? <span className="act-flow-arrow">→</span> : null}
              </span>
            )
          })}
        </div>

        {loadErr ? <div className="act-banner err">{loadErr}</div> : null}

        <div className="act-layout">
          <aside className="act-steps">
            <h2>{t('pi05.steps')}</h2>
            {spec?.steps.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`act-step-btn${s.id === stepId ? ' active' : ''}${s.variant ? ' variant' : ''}`}
                onClick={() => setStepId(s.id)}
                title={s.subtitle ? t('pi05.scriptHint', { hint: s.subtitle }) : undefined}
              >
                <span className="act-step-num">
                  {s.step}
                  {s.variant ? '·' : ''}
                </span>
                <span className="act-step-title">{stepTitle(s, route)}</span>
                <span className="act-step-sub">{s.subtitle}</span>
              </button>
            ))}
          </aside>

          <main className="act-main">
            {step ? (
              <div className={`act-config${rootsReady ? '' : ' locked'}`}>
                <div className="act-step-head">
                  <div>
                    <h2>{stepTitle(step, route)}</h2>
                    <p className="muted">{stepDescription(step, route)}</p>
                    {step.subtitle ? <span className="act-script">{step.subtitle}</span> : null}
                    {!rootsReady ? (
                      <p className="act-config-hint muted">{t('pi05.configLocked')}</p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy || !rootsReady}
                    onClick={() => void onRun()}
                  >
                    {busy ? t('pi05.btnStarting') : t('pi05.btnRun')}
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
                        disabled={!rootsReady}
                        ioRole={fieldIoRole(f, step)}
                        onBrowse={
                          f.type === 'path' && rootsReady
                            ? () => setPicker({ kind: 'field', field: f })
                            : undefined
                        }
                      />
                    ))}
                </div>
                {step.id === 'train' ? (
                  <>
                    <Pi05TrainGuide
                      configName={String(currentParams.configPath || '')}
                      printOnly={Boolean(currentParams.printOnly)}
                      route={route}
                    />
                    <Pi05TrainTheory route={route} />
                  </>
                ) : null}
              </div>
            ) : null}

            <section className="act-log">
              <div className="act-log-head">
                <h3>{t('pi05.logTitle')}</h3>
                <div className="act-log-actions">
                  {activeJob && isJobActive(activeJob.status) ? (
                    <button
                      type="button"
                      className="act-log-cancel"
                      disabled={canceling}
                      onClick={() => void onCancel()}
                      title={t('pi05.btnCancelTitle')}
                    >
                      {canceling ? t('pi05.btnCanceling') : t('pi05.btnCancel')}
                    </button>
                  ) : null}
                  {activeJob ? (
                    <button
                      type="button"
                      className="act-log-refresh"
                      disabled={logSyncing}
                      onClick={() => void refreshActiveJobLog()}
                      title={t('pi05.btnSyncTitle')}
                    >
                      {logSyncing ? t('pi05.btnSyncing') : t('pi05.btnSyncLog')}
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
                  (rootsReady ? t('pi05.logEmptyReady') : t('pi05.logEmptyLocked'))}
              </pre>
            </section>
          </main>

          <aside className="act-jobs">
            <div className="act-jobs-head">
              <h2>{t('pi05.jobsTitle')}</h2>
              <button
                type="button"
                className="act-jobs-refresh"
                disabled={jobsSyncing}
                onClick={() => void refreshJobs()}
                title={t('pi05.jobsRefreshTitle')}
              >
                {jobsSyncing ? '…' : t('pi05.jobsRefresh')}
              </button>
            </div>
            {jobs.length === 0 ? (
              <div className="pi05-jobs-empty">{t('pi05.jobsEmpty')}</div>
            ) : (
              <ul>
                {jobs.map((j) => (
                  <li key={j.id} className="act-job-item">
                    <button
                      type="button"
                      className={`act-job-row${activeJob?.id === j.id ? ' active' : ''}`}
                      onClick={() => {
                        fetchPi05Job(j.id)
                          .then((r) => setActiveJob(r.job))
                          .catch(() => {})
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
                      title={t('pi05.jobDelete')}
                      aria-label={t('pi05.jobDeleteAria', { id: j.stepId })}
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
            )}
          </aside>
        </div>
      </div>

      <footer className="act-footer">
        <div className="act-footer-brand">
          <span className="act-footer-mark" aria-hidden="true" />
          <span>π0.5 Pipeline</span>
          <span className="act-footer-sep">·</span>
          <span className="act-footer-muted">embody_model_eval</span>
        </div>
        <div className="act-footer-paths">
          {pi05Root.trim() ? (
            <span className="act-footer-path" title={pi05Root}>
              {t('pi05.footerPi05')} {truncatePath(pi05Root)}
            </span>
          ) : (
            <span className="act-footer-path idle">{t('pi05.footerNone')}</span>
          )}
        </div>
        <div className="act-footer-meta">
          {step ? <span className="act-footer-step">{stepTitle(step, route)}</span> : null}
          <span>{t('pi05.footerJobs', { n: jobs.length })}</span>
        </div>
      </footer>

      {picker ? (
        <PathPickerModal
          open
          title={
            picker.kind === 'root'
              ? picker.root === 'embody'
                ? t('pi05.pickerEmbodyRoot')
                : t('pi05.pickerPi05Root')
              : fieldLabel(stepId, picker.field)
          }
          value={pickerValue}
          browseRoot={picker.kind === 'root' ? picker.root : picker.field.browseRoot || 'pi05'}
          roots={browseRoots}
          pathKind={picker.kind === 'root' ? 'dir' : picker.field.pathKind || 'dir'}
          browseAnchor={
            picker.kind === 'root'
              ? rootBrowseAnchor(picker.root, browseRoots[picker.root], spec)
              : PI05_BROWSE_SUPERROOT
          }
          onClose={() => setPicker(null)}
          onConfirm={(path) => {
            if (picker.kind === 'root') {
              if (picker.root === 'pi05') setPi05Root(path)
            } else {
              setField(picker.field.key, path)
            }
            setPicker(null)
          }}
        />
      ) : null}
    </div>
  )
}
