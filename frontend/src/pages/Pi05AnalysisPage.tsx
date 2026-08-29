import { useEffect, useMemo, useState } from 'react'
import { PageChrome } from '../components/PageChrome'
import { PathPickerModal } from '../components/PathPickerModal'
import { useLocale } from '../i18n/LocaleContext'
import { t } from '../i18n/runtime'
import {
  analyzePi05,
  inspectPi05Checkpoint,
  type Pi05AnalyzeResult,
  type Pi05CheckpointInspect,
  type Pi05CkptRun,
  type Pi05ConfigItem,
} from '../features/pi05/api'
import { Pi05ModelStructureView } from '../features/pi05/ModelStructure'
import { Pi05NormStatsViz } from '../features/pi05/NormStatsViz'
import { Pi05WeightBars, formatBytesLabel } from '../features/pi05/WeightViz'
import { Pi05RouteChrome } from '../features/pi05/Pi05RouteChrome'
import {
  resolveInitialPi05Route,
  writeStoredPi05Route,
  type Pi05RouteMode,
} from '../features/pi05/routeMode'
import '../styles/pi05-route.css'
import type { BrowseRoot } from '../features/actPipeline/types'
import '../styles/model-analysis.css'
import '../styles/pi05-analysis.css'

type TabId = 'structure' | 'weights' | 'norm' | 'config'

const DEFAULT_PI05 = '/root/autodl-tmp/pi05'
const DEFAULT_CKPT_PROJECT = '/root/autodl-tmp/pi05/artifacts/checkpoints/pi05_act_robot_smoke'
/** Path picker chroot: parent of π0.5 project. */
const PI05_BROWSE_SUPERROOT = '/root/autodl-tmp'

function checkOk(v: unknown): boolean {
  return v === true || v === 'true'
}

function runLabel(run: Pi05CkptRun) {
  return `${run.project} / ${run.exp}`
}

function derivePi05FromCkpt(path: string): string {
  const marker = '/artifacts/checkpoints'
  const i = path.indexOf(marker)
  if (i > 0) return path.slice(0, i)
  return DEFAULT_PI05
}

export function Pi05AnalysisPage() {
  const { locale } = useLocale()
  const [ckptTarget, setCkptTarget] = useState('')
  const [configPath, setConfigPath] = useState('')
  const [data, setData] = useState<Pi05AnalyzeResult | null>(null)
  const [ckpt, setCkpt] = useState<Pi05CheckpointInspect | null>(null)
  const [selectedStep, setSelectedStep] = useState('')
  const [selectedRunPath, setSelectedRunPath] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ckptBusy, setCkptBusy] = useState(false)
  const [picker, setPicker] = useState<'root' | 'config' | null>(null)
  const [selectedConfig, setSelectedConfig] = useState('')
  const [normIdx, setNormIdx] = useState(0)
  const [tab, setTab] = useState<TabId>('structure')
  const [route, setRoute] = useState<Pi05RouteMode>(() => resolveInitialPi05Route())

  const pi05Root = data?.pi05Root || derivePi05FromCkpt(ckptTarget.trim() || DEFAULT_CKPT_PROJECT)

  const browseRoots = useMemo(
    () =>
      ({
        pi05: PI05_BROWSE_SUPERROOT,
        act: PI05_BROWSE_SUPERROOT,
        embody: '',
      }) as Record<BrowseRoot, string>,
    [],
  )

  const loadCheckpoint = async (path: string, root?: string) => {
    setCkptBusy(true)
    try {
      const info = await inspectPi05Checkpoint(path, root || pi05Root || undefined)
      if (!info.ok && info.error) throw new Error(info.error)
      setCkpt(info)
      setSelectedStep(path)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setCkptBusy(false)
    }
  }

  const load = async (opts?: { configFocus?: string; targetOverride?: string }) => {
    const target = (opts?.targetOverride ?? ckptTarget).trim() || DEFAULT_CKPT_PROJECT
    if (!ckptTarget.trim() && !opts?.targetOverride) {
      setCkptTarget(target)
    }
    setBusy(true)
    setErr('')
    try {
      const focus = (opts?.configFocus ?? configPath).trim() || undefined
      const r = await analyzePi05(undefined, focus, target, route)
      if (!r.ok) throw new Error(r.error || 'analyze failed')
      setData(r)
      setNormIdx(0)

      const configs = r.configs || []
      const keepConfig =
        (focus && configs.some((c) => c.path === focus) && focus) ||
        (configPath && configs.some((c) => c.path === configPath) && configPath) ||
        configs[0]?.path ||
        ''
      if (keepConfig) {
        setConfigPath(keepConfig)
        setSelectedConfig(keepConfig)
      }

      const runs = r.checkpoints?.runs || []
      const prevRun = selectedRunPath
      const prevStep = selectedStep
      const keptRun = (prevRun && runs.find((x) => x.path === prevRun)) || null
      const preferredRun =
        keptRun || runs.find((x) => x.latestPath && x.hasModel) || runs[0] || null
      setSelectedRunPath(preferredRun?.path || '')

      const stepStillThere =
        preferredRun &&
        prevStep &&
        preferredRun.steps.some((s) => s.path === prevStep)
          ? prevStep
          : preferredRun?.latestPath || preferredRun?.steps[preferredRun.steps.length - 1]?.path || ''

      if (stepStillThere) {
        setSelectedStep(stepStillThere)
        await loadCheckpoint(stepStillThere, r.pi05Root)
      } else {
        setSelectedStep('')
        setCkpt(null)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    writeStoredPi05Route(route)
    setData(null)
    setCkpt(null)
    setSelectedStep('')
    setSelectedRunPath('')
    setSelectedConfig('')
    setConfigPath('')
    setErr('')
  }, [route])

  const checks = data?.checks || {}
  const activePath = selectedConfig || configPath
  const selectedBrief: Pi05ConfigItem | undefined = data?.configs?.find((c) => c.path === activePath)
  const runs = data?.checkpoints?.runs || []
  const activeRun = runs.find((r) => r.path === selectedRunPath) || runs[0]
  const structure = ckpt?.modelStructure || data?.modelStructure
  const normFromCkpt = ckpt?.normStats?.[0]
  const normList = data?.normStats || []
  const activeNorm = normFromCkpt?.groups?.length
    ? normFromCkpt
    : normList[Math.min(normIdx, Math.max(0, normList.length - 1))]
  const metaCfg = (ckpt?.metadata?.config || {}) as Record<string, unknown>

  const healthItems = [
    { key: 'pi05Exists', label: t('pi05Analysis.check.pi05') },
    { key: 'actRobotExists', label: t('pi05Analysis.check.act') },
    { key: 'baseCkptExists', label: t('pi05Analysis.check.base') },
    { key: 'lerobotExists', label: t('pi05Analysis.check.lerobot') },
  ] as const

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'structure', label: t('pi05Analysis.tab.structure') },
    { id: 'weights', label: t('pi05Analysis.tab.weights') },
    { id: 'norm', label: t('pi05Analysis.tab.norm') },
    { id: 'config', label: t('pi05Analysis.tab.config') },
  ]

  const selectRun = (run: Pi05CkptRun) => {
    setSelectedRunPath(run.path)
    const step = run.latestPath || run.steps[run.steps.length - 1]?.path
    if (step) void loadCheckpoint(step)
  }

  return (
    <div className="model-analysis-page pi05-analysis-page" data-locale={locale}>
      <header className="ma-header pi05a-header">
        <div className="ma-header-brand pi05a-brand">
          <h1>{t('pi05Analysis.title')}</h1>
          <p className="ma-header-blurb pi05a-sub">{route === 'full_ft' ? t('pi05Analysis.subtitleFullFt') : t('pi05Analysis.subtitle')}</p>
        </div>
        <div className="ma-header-actions pi05a-chrome">
          <PageChrome />
        </div>
      </header>

      <main className="pi05a-shell">
        <Pi05RouteChrome
          route={route}
          onChange={(m) => {
            setRoute(m)
          }}
        />
        <section className="pi05a-topbar" aria-label={t('pi05Analysis.toolbarAria')}>
          <div className="pi05a-topbar-path grow">
            <input
              value={ckptTarget}
              onChange={(e) => setCkptTarget(e.target.value)}
              placeholder={t('pi05Analysis.rootPlaceholder')}
              aria-label={t('pi05Analysis.root')}
            />
            <button type="button" className="pi05a-btn" onClick={() => setPicker('root')}>
              {t('pi05.btnBrowse')}
            </button>
            <button
              type="button"
              className="pi05a-btn primary"
              disabled={busy}
              onClick={() => void load()}
            >
              {busy
                ? t('pi05Analysis.analyzing')
                : data
                  ? t('pi05Analysis.analyze')
                  : t('pi05Analysis.analyzeFirst')}
            </button>
          </div>
          <p className="pi05a-root-hint muted">{t('pi05Analysis.rootHint')}</p>

          {data ? (
            <div className="pi05a-health-mini" aria-label={t('pi05Analysis.health')}>
              {healthItems.map((item) => (
                <span
                  key={item.key}
                  className={`pi05a-health-dot-wrap${checkOk(checks[item.key]) ? ' ok' : ' bad'}`}
                  title={`${item.label}: ${String(checks[item.key] ?? '—')}`}
                >
                  <i className="pi05a-kpi-dot" />
                  <span>{item.label}</span>
                </span>
              ))}
            </div>
          ) : null}
        </section>

        {err ? <div className="pi05a-banner err">{err}</div> : null}
        {data?.healthHint ? <div className="pi05a-banner info">{data.healthHint}</div> : null}

        <div className="pi05a-workspace">
          <aside className="pi05a-rail" aria-label={t('pi05Analysis.checkpoints')}>
            <div className="pi05a-rail-head">
              <h2>{t('pi05Analysis.runs')}</h2>
              <span className="pi05a-count">{runs.length}</span>
            </div>
            <ul className="pi05a-run-list">
              {runs.length === 0 ? (
                <li className="pi05a-rail-empty muted">{t('pi05Analysis.ckptEmpty')}</li>
              ) : (
                runs.map((run) => {
                  const active = run.path === (activeRun?.path || '')
                  return (
                    <li key={run.path}>
                      <button
                        type="button"
                        className={`pi05a-run-item${active ? ' active' : ''}`}
                        onClick={() => selectRun(run)}
                      >
                        <strong>{runLabel(run)}</strong>
                        <span className="muted">
                          {t('pi05Analysis.ckptSteps', { n: run.stepCount })}
                          {run.latestStep ? ` · ${run.latestStep}` : ''}
                        </span>
                        {run.adaptation ? (
                          <span className={`pi05a-adapt-badge adapt-${run.adaptation}`}>
                            {run.adaptation === 'full_ft'
                              ? t('pi05Analysis.adapt.fullFt')
                              : run.adaptation === 'lora'
                                ? t('pi05Analysis.adapt.lora')
                                : run.adaptation === 'mixed'
                                  ? t('pi05Analysis.adapt.mixed')
                                  : run.adaptation}
                          </span>
                        ) : null}
                        <span className="pi05a-run-meta">
                          {run.hasModel ? <em className="ok">wt</em> : null}
                          {run.totalBytes ? <em>{formatBytesLabel(run.totalBytes)}</em> : null}
                        </span>
                      </button>
                      {active && run.steps.length > 1 ? (
                        <div className="pi05a-step-row">
                          {run.steps.map((s) => (
                            <button
                              key={s.path}
                              type="button"
                              className={`pi05a-step-chip${s.path === selectedStep ? ' active' : ''}`}
                              disabled={ckptBusy}
                              onClick={() => void loadCheckpoint(s.path)}
                            >
                              {s.name}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </li>
                  )
                })
              )}
            </ul>

            {(data?.prepare || []).length ? (
              <div className="pi05a-rail-prep">
                <div className="pi05a-rail-head">
                  <h2>{t('pi05Analysis.prepare')}</h2>
                </div>
                {(data?.prepare || []).slice(0, 2).map((p) => (
                  <div key={p.path} className="pi05a-prep-mini">
                    <strong>{p.summary?.repoId || p.name}</strong>
                    <span className="muted">
                      ep {p.summary?.episodes ?? '—'} · fr {p.summary?.frames ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </aside>

          <section className="pi05a-stage">
            <div className="pi05a-stage-head">
              <div className="pi05a-tabs" role="tablist" aria-label={t('pi05Analysis.tabsAria')}>
                {tabs.map((tb) => (
                  <button
                    key={tb.id}
                    type="button"
                    role="tab"
                    aria-selected={tab === tb.id}
                    className={`pi05a-tab${tab === tb.id ? ' active' : ''}`}
                    onClick={() => setTab(tb.id)}
                  >
                    {tb.label}
                  </button>
                ))}
              </div>
              <div className="pi05a-stage-status muted">
                {ckptBusy
                  ? t('pi05Analysis.inspecting')
                  : selectedStep
                    ? `${t('pi05Analysis.ckptStep')} ${ckpt?.metadata?.globalStep ?? selectedStep.split('/').pop()}`
                    : '—'}
                {metaCfg.repoId ? ` · ${String(metaCfg.repoId)}` : ''}
              </div>
            </div>

            <div className="pi05a-stage-body" role="tabpanel">
              {tab === 'structure' ? (
                <div className="pi05a-panel">
                  <Pi05ModelStructureView
                    structure={structure}
                    title={t('pi05Analysis.structure')}
                    empty={t('pi05Analysis.structureEmpty')}
                    weights={ckpt?.weights}
                  />
                </div>
              ) : null}

              {tab === 'weights' ? (
                <div className="pi05a-panel">
                  {ckpt?.files ? (
                    <div className="pi05a-file-row">
                      {Object.entries(ckpt.files).map(([name, info]) => (
                        <span key={name} className="pi05a-file-chip">
                          {name}
                          <em>{formatBytesLabel(info.size)}</em>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <Pi05WeightBars
                    weights={ckpt?.weights}
                    title={t('pi05Analysis.weightBars')}
                    empty={t('pi05Analysis.weightEmpty')}
                  />
                  {selectedStep ? (
                    <code className="pi05a-norm-path" title={selectedStep}>
                      {selectedStep}
                    </code>
                  ) : null}
                </div>
              ) : null}

              {tab === 'norm' ? (
                <div className="pi05a-panel">
                  <div className="pi05a-panel-tools">
                    {!normFromCkpt?.groups?.length && normList.length > 1 ? (
                      <select
                        className="pi05a-select"
                        value={normIdx}
                        onChange={(e) => setNormIdx(Number(e.target.value))}
                        aria-label={t('pi05Analysis.normPick')}
                      >
                        {normList.map((n, i) => (
                          <option key={n.path} value={i}>
                            {n.path.split('/').slice(-4).join('/')}
                          </option>
                        ))}
                      </select>
                    ) : null}
                  </div>
                  <Pi05NormStatsViz
                    groups={activeNorm?.groups || []}
                    empty={t('pi05Analysis.normEmpty')}
                    path={activeNorm?.path}
                  />
                </div>
              ) : null}

              {tab === 'config' ? (
                <div className="pi05a-panel pi05a-config-panel">
                  <div className="pi05a-config-toolbar">
                    <label className="pi05a-field grow">
                      <span>{t('pi05Analysis.config')}</span>
                      <div className="pi05a-path">
                        <input
                          value={configPath}
                          onChange={(e) => setConfigPath(e.target.value)}
                          placeholder={t('pi05Analysis.configPlaceholder')}
                        />
                        <button type="button" className="pi05a-btn" onClick={() => setPicker('config')}>
                          {t('pi05.btnBrowse')}
                        </button>
                      </div>
                    </label>
                  </div>
                  <div className="pi05a-config-split">
                    <ul className="pi05a-config-list compact">
                      {(data?.configs || []).map((c) => (
                        <li key={c.path}>
                          <button
                            type="button"
                            className={c.path === activePath ? 'active' : ''}
                            onClick={() => {
                              setSelectedConfig(c.path)
                              setConfigPath(c.path)
                              void load({ configFocus: c.path })
                            }}
                          >
                            <strong>{c.name}</strong>
                            <span className="muted mono">
                              {c.brief?.paligemma || '—'} / {c.brief?.actionExpert || '—'}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                    <div className="pi05a-config-preview">
                      {selectedBrief?.brief ? (
                        <dl className="pi05a-kv">
                          <div>
                            <dt>{t('pi05Analysis.kv.project')}</dt>
                            <dd>{selectedBrief.brief.projectName || '—'}</dd>
                          </div>
                          <div>
                            <dt>{t('pi05Analysis.kv.repo')}</dt>
                            <dd>{selectedBrief.brief.repoId || '—'}</dd>
                          </div>
                          <div>
                            <dt>{t('pi05Analysis.kv.lora')}</dt>
                            <dd>
                              {selectedBrief.brief.paligemma || '—'} / {selectedBrief.brief.actionExpert || '—'}
                            </dd>
                          </div>
                          <div>
                            <dt>{t('pi05Analysis.kv.batch')}</dt>
                            <dd>
                              {selectedBrief.brief.batchSize ?? '—'} × FSDP{' '}
                              {selectedBrief.brief.fsdpDevices ?? '—'}
                            </dd>
                          </div>
                        </dl>
                      ) : null}
                      <pre className="pi05a-code">{data?.config?.text || t('pi05Analysis.yamlEmpty')}</pre>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </main>

      {picker ? (
        <PathPickerModal
          open
          title={picker === 'root' ? t('pi05Analysis.pickerCkpt') : t('pi05Analysis.pickConfig')}
          value={picker === 'root' ? ckptTarget : configPath}
          browseRoot="pi05"
          roots={browseRoots}
          pathKind={picker === 'root' ? 'dir' : 'file'}
          browseAnchor={PI05_BROWSE_SUPERROOT}
          onClose={() => setPicker(null)}
          onConfirm={(path) => {
            if (picker === 'root') {
              setCkptTarget(path)
              setData(null)
              setCkpt(null)
              setSelectedStep('')
              setSelectedRunPath('')
              setSelectedConfig('')
              setConfigPath('')
              setErr('')
            } else {
              setConfigPath(path)
              setSelectedConfig(path)
            }
            setPicker(null)
          }}
        />
      ) : null}
    </div>
  )
}
