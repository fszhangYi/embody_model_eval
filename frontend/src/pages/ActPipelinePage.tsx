import { useCallback, useEffect, useMemo, useState } from 'react'
import { PathPickerModal } from '../components/PathPickerModal'
import { PageNav } from '../components/PageNav'
import { fetchJob, fetchJobs, fetchPipelineSpec, createActLink, removeActLink, runPipelineStep } from '../features/actPipeline/api'
import type { BrowseRoot, PipelineJob, PipelineSpec, PipelineStep, StepField } from '../features/actPipeline/types'
import '../styles/act-pipeline.css'

const FLOW = [
  { n: 1, label: '质量过滤', to: 'quality_pass.json' },
  { n: 2, label: 'HDF5', to: 'converted/' },
  { n: 3, label: '训练', to: 'ckpt/' },
  { n: 4, label: '离线推理', to: 'infer/' },
  { n: 5, label: 'embody JSON', to: 'data/' },
]

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
  value,
  browseRoots,
  onChange,
  onBrowse,
  disabled = false,
  ioRole = 'neutral',
}: {
  field: StepField
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

  if (field.type === 'checkbox') {
    return (
      <label className={`${fieldClass} act-field-check`} htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
        />
        {field.label}
      </label>
    )
  }
  if (field.type === 'select') {
    return (
      <label className={fieldClass}>
        <span>{field.label}</span>
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
    const tip = field.hint ? `推荐脚本：${field.hint}` : undefined
    return (
      <label className={fieldClass}>
        <span className="act-field-label">
          {ioRole === 'input' ? <span className="act-io-tag in">IN</span> : null}
          {ioRole === 'output' ? <span className="act-io-tag out">OUT</span> : null}
          <span>{field.label}</span>
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
            placeholder={field.pathKind === 'file' ? '选择或输入文件路径' : '选择或输入目录路径'}
          />
          <button
            type="button"
            className="act-path-browse"
            title={tip || `浏览 ${browseRoots[field.browseRoot || 'act'] || ''}`}
            onClick={onBrowse}
            disabled={disabled}
          >
            选择
          </button>
        </div>
      </label>
    )
  }
  return (
    <label className={fieldClass}>
      <span className="act-field-label">
        {ioRole === 'input' ? <span className="act-io-tag in">IN</span> : null}
        {ioRole === 'output' ? <span className="act-io-tag out">OUT</span> : null}
        <span>{field.label}</span>
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
  if (status === 'running') return 'run'
  return 'idle'
}

export function ActPipelinePage() {
  const [spec, setSpec] = useState<PipelineSpec | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [stepId, setStepId] = useState('quality')
  const [params, setParams] = useState<Record<string, Record<string, string | number | boolean>>>({})
  const [activeJob, setActiveJob] = useState<PipelineJob | null>(null)
  const [jobs, setJobs] = useState<PipelineJob[]>([])
  const [busy, setBusy] = useState(false)
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const [embodyRoot, setEmbodyRoot] = useState('')
  const [actRoot, setActRoot] = useState('')
  const [linkReady, setLinkReady] = useState(false)
  const [linkMsg, setLinkMsg] = useState('请先选择评测根目录，再选择训练/推理根目录')

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
      if (!embody) setLinkMsg('请先选择评测根目录')
      else if (!act) setLinkMsg('请选择训练/推理根目录以建立软链')
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      createActLink(embody, act)
        .then(async (r) => {
          if (cancelled) return
          if (r.linked && r.matches) {
            setLinkReady(true)
            setLinkMsg(`软链已就绪：${r.linkPath} → ${r.target}`)
            const s = await fetchPipelineSpec(act, embody)
            setSpec(s)
            setParams(initParamsFromSpec(s))
          } else {
            setLinkReady(false)
            setLinkMsg(r.error || '软链未建立')
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
    if (!activeJob || activeJob.status === 'succeeded' || activeJob.status === 'failed') return
    const t = setInterval(() => {
      fetchJob(activeJob.id)
        .then((r) => {
          setActiveJob(r.job)
          if (r.job.status === 'succeeded' || r.job.status === 'failed') {
            fetchJobs().then((x) => setJobs(x.jobs)).catch(() => {})
          }
        })
        .catch(() => {})
    }, 1500)
    return () => clearInterval(t)
  }, [activeJob])

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

  const applyEmbodyRoot = (next: string) => {
    if (next === embodyRoot) return
    if (embodyRoot.trim()) void removeActLink(embodyRoot.trim())
    setEmbodyRoot(next)
    setActRoot('')
    setLinkReady(false)
    setLinkMsg('请选择训练/推理根目录以建立软链')
    setParams({})
  }

  const applyActRoot = (next: string) => {
    if (next === actRoot) return
    if (embodyRoot.trim()) void removeActLink(embodyRoot.trim())
    setActRoot(next)
    setLinkReady(false)
    setLinkMsg('正在建立软链…')
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

  return (
    <div className="act-pipeline-page">
      <header className="act-header">
        <div className="act-header-brand">
          <h1>ACT 数据流水线</h1>
          <p className="act-sub">raw → 质量过滤 → HDF5 → 训练 → 推理 → embody 对比 JSON</p>
        </div>
        <div className="act-header-actions">
          <div className="act-header-meta">
            {linkReady ? (
              <span className="pill ok">软链已就绪</span>
            ) : embodyReady ? (
              <span className="pill warn">等待软链</span>
            ) : (
              <span className="pill idle">选择根目录</span>
            )}
          </div>
          <PageNav />
        </div>
      </header>

      <div className="act-body">
      <div className="act-project-roots">
        <label className={`act-root-field act-root-step${embodyReady ? ' done' : ''}`}>
          <span className="act-root-step-label">1. 评测根目录</span>
          <div className="act-path-field">
            <input
              type="text"
              value={embodyRoot}
              onChange={(e) => applyEmbodyRoot(e.target.value)}
              placeholder="选择评测项目根目录"
            />
            <button
              type="button"
              className="act-path-browse"
              onClick={() => setPicker({ kind: 'root', root: 'embody' })}
            >
              选择
            </button>
          </div>
        </label>
        <label
          className={`act-root-field act-root-step${actRoot.trim() ? ' done' : ''}${!embodyReady ? ' disabled' : ''}`}
        >
          <span className="act-root-step-label">2. 训练/推理根目录</span>
          <div className="act-path-field">
            <input
              type="text"
              value={actRoot}
              disabled={!embodyReady}
              onChange={(e) => applyActRoot(e.target.value)}
              placeholder={embodyReady ? '选择训练/推理项目根目录' : '请先选择评测根目录'}
            />
            <button
              type="button"
              className="act-path-browse"
              disabled={!embodyReady}
              onClick={() => setPicker({ kind: 'root', root: 'act' })}
            >
              选择
            </button>
          </div>
        </label>
      </div>

      <div className={`act-link-banner${linkReady ? ' ok' : embodyReady && actRoot.trim() ? ' pending' : ''}`}>
        <span className="act-link-step">3. 软链</span>
        <span className="act-link-text">
          {linkReady
            ? linkMsg
            : embodyReady && actRoot.trim()
              ? linkMsg || '正在建立软链…'
              : '完成前两步后，将在评测根目录下创建 act_robot 软链指向训练/推理根目录'}
        </span>
      </div>

      <div className="act-flow" aria-label="流程总览">
        {FLOW.map((f, i) => (
          <div key={f.n} className="act-flow-item">
            <span className="act-flow-n">{f.n}</span>
            <span className="act-flow-label">{f.label}</span>
            <span className="act-flow-to">{f.to}</span>
            {i < FLOW.length - 1 ? <span className="act-flow-arrow">→</span> : null}
          </div>
        ))}
      </div>

      {loadErr ? <div className="act-banner err">{loadErr}</div> : null}

      <div className={`act-layout${linkReady ? '' : ' locked'}`}>
        <aside className="act-steps">
          <h2>步骤</h2>
          {spec?.steps.map((s) => (
            <button
              key={s.id}
              type="button"
              disabled={!linkReady}
              className={`act-step-btn${s.id === stepId ? ' active' : ''}${s.variant ? ' variant' : ''}`}
              onClick={() => setStepId(s.id)}
              title={s.subtitle ? `推荐脚本：${s.subtitle}` : undefined}
            >
              <span className="act-step-num">{s.step}{s.variant ? '·' : ''}</span>
              <span className="act-step-title">{s.title}</span>
              <span className="act-step-sub">{s.subtitle}</span>
            </button>
          ))}
        </aside>

        <main className="act-main">
          {step ? (
            <>
              <div className="act-step-head">
                <div>
                  <h2>{step.title}</h2>
                  <p className="muted">{step.description}</p>
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={busy || !linkReady}
                  onClick={() => void onRun()}
                >
                  {busy ? '启动中…' : '运行此步骤'}
                </button>
              </div>
              <div className="act-fields">
                {step.fields.map((f) => (
                  <FieldInput
                    key={f.key}
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
            </>
          ) : null}

          <section className="act-log">
            <div className="act-log-head">
              <h3>运行日志</h3>
              {activeJob ? (
                <span className={`act-status ${statusClass(activeJob.status)}`}>{activeJob.status}</span>
              ) : null}
            </div>
            {activeJob?.command ? <pre className="act-cmd">{activeJob.command}</pre> : null}
            <pre className="act-log-body">
              {activeJob?.logTail ||
                activeJob?.error ||
                (linkReady ? '选择步骤并点击「运行此步骤」' : '完成根目录选择与软链建立后，可配置并运行步骤')}
            </pre>
          </section>
        </main>

        <aside className="act-jobs">
          <h2>历史任务</h2>
          <ul>
            {jobs.map((j) => (
              <li key={j.id}>
                <button
                  type="button"
                  className={`act-job-row${activeJob?.id === j.id ? ' active' : ''}`}
                  onClick={() => {
                    fetchJob(j.id).then((r) => setActiveJob(r.job)).catch(() => {})
                  }}
                >
                  <span className={`dot ${statusClass(j.status)}`} />
                  <span className="act-job-id">{j.stepId}</span>
                  <span className="act-job-st">{j.status}</span>
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
              评测 {truncatePath(embodyRoot)}
            </span>
          ) : (
            <span className="act-footer-path idle">未选择评测根目录</span>
          )}
          {actRoot.trim() ? (
            <span className="act-footer-path" title={actRoot}>
              训练 {truncatePath(actRoot)}
            </span>
          ) : embodyReady ? (
            <span className="act-footer-path idle">未选择训练根目录</span>
          ) : null}
        </div>
        <div className="act-footer-meta">
          {step ? <span className="act-footer-step">{step.title}</span> : null}
          {jobs.length > 0 ? <span>{jobs.length} 个历史任务</span> : null}
          {linkReady ? (
            <span className="act-footer-link ok">软链就绪</span>
          ) : embodyReady && actRoot.trim() ? (
            <span className="act-footer-link warn">软链待建</span>
          ) : null}
        </div>
      </footer>

      {picker ? (
        <PathPickerModal
          open
          title={
            picker.kind === 'root'
              ? picker.root === 'act'
                ? '训练/推理根目录'
                : '评测根目录'
              : picker.field.label
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
