import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageChrome } from '../components/PageChrome'
import { PathPickerModal } from '../components/PathPickerModal'
import type { BrowseRoot, PathKind } from '../features/actPipeline/types'
import { fetchFsChildren } from '../features/actPipeline/api'
import { useLocale } from '../i18n/LocaleContext'
import { t } from '../i18n/runtime'
import {
  analyzePi05,
  fetchPi05GpuStatus,
  probeFsPath,
  type Pi05AnalyzeResult,
} from '../features/pi05/api'
import {
  buildLoraTaskMkdirSh,
  buildLoraTaskRefJson,
  DEFAULT_LORA_ADDRESS,
  DEFAULT_LORA_TASK_NAME,
  downloadLoraTaskBundle,
} from '../features/pi05/loraTaskRefExport'
import { Pi05RouteChrome } from '../features/pi05/Pi05RouteChrome'
import { Pi05FullFtYamlGuide } from '../features/pi05/FullFtYamlGuide'
import {
  resolveInitialPi05Route,
  writeStoredPi05Route,
  type Pi05RouteMode,
} from '../features/pi05/routeMode'
import '../styles/act-pipeline.css'
import '../styles/pi05-setup.css'
import '../styles/pi05-route.css'

const LORA_EXPORT_STORAGE = 'embody.pi05.setup.loraExport'

type ExpectKind = 'dir' | 'file' | 'pytorch_base'
type GpuState = 'idle' | 'checking' | 'ok' | 'bad'

type PathSlotId =
  | 'pi05Root'
  | 'baseCkptPytorch'
  | 'fullFtConfig'
  | 'trainFullFtScript'
  | 'lerobotHome'
  | 'actRobotRoot'
  | 'baseCkptJax'

type FocusId = PathSlotId | 'gpu'

type PathSlot = {
  id: PathSlotId
  label: string
  pathKey: string
  expect: ExpectKind
  pathKind: PathKind
  optional?: boolean
}

type ProbeInfo = {
  healthy: boolean | null
  path: string
  reason: string
  detail?: string | null
  exists?: boolean
  isFile?: boolean
  isDir?: boolean
}

const PATH_STORAGE_PREFIX = 'embody.pi05.setup.paths.'

function loadStoredPaths(route: Pi05RouteMode): Partial<Record<PathSlotId, string>> {
  try {
    const raw = localStorage.getItem(PATH_STORAGE_PREFIX + route)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, string>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function saveStoredPaths(route: Pi05RouteMode, values: Partial<Record<PathSlotId, string>>) {
  try {
    localStorage.setItem(PATH_STORAGE_PREFIX + route, JSON.stringify(values))
  } catch {
    /* ignore */
  }
}

function effectivePath(value: string, placeholder: string) {
  return (value.trim() || placeholder.trim()).trim()
}

function buildSlots(fullFt: boolean): PathSlot[] {
  if (fullFt) {
    return [
      {
        id: 'pi05Root',
        label: t('pi05Setup.check.project'),
        pathKey: 'pi05Root',
        expect: 'dir',
        pathKind: 'dir',
      },
      {
        id: 'baseCkptPytorch',
        label: t('pi05Setup.check.basePytorch'),
        pathKey: 'baseCkptPytorch',
        expect: 'pytorch_base',
        pathKind: 'dir',
        optional: true,
      },
      {
        id: 'fullFtConfig',
        label: t('pi05Setup.check.fullFtConfig'),
        pathKey: 'fullFtConfig',
        expect: 'file',
        pathKind: 'file',
        optional: true,
      },
      {
        id: 'trainFullFtScript',
        label: t('pi05Setup.check.trainFullFt'),
        pathKey: 'trainFullFtScript',
        expect: 'file',
        pathKind: 'file',
        optional: true,
      },
      {
        id: 'lerobotHome',
        label: t('pi05Setup.check.lerobot'),
        pathKey: 'lerobotHome',
        expect: 'dir',
        pathKind: 'dir',
        optional: true,
      },
    ]
  }
  return [
    {
      id: 'pi05Root',
      label: t('pi05Setup.check.project'),
      pathKey: 'pi05Root',
      expect: 'dir',
      pathKind: 'dir',
    },
    {
      id: 'actRobotRoot',
      label: t('pi05Setup.check.actData'),
      pathKey: 'actRobotRoot',
      expect: 'dir',
      pathKind: 'dir',
      optional: true,
    },
    {
      id: 'baseCkptJax',
      label: t('pi05Setup.check.baseCkpt'),
      pathKey: 'baseCkptJax',
      expect: 'dir',
      pathKind: 'dir',
      optional: true,
    },
    {
      id: 'lerobotHome',
      label: t('pi05Setup.check.lerobot'),
      pathKey: 'lerobotHome',
      expect: 'dir',
      pathKind: 'dir',
      optional: true,
    },
  ]
}

function reasonMessage(reason: string, path: string, detail?: string | null) {
  const key = `pi05Setup.reason.${reason}`
  const msg = t(key, { path: path || '—', detail: detail || '—' })
  return msg === key ? t('pi05Setup.reason.unknown', { path: path || '—', reason }) : msg
}

export function Pi05SetupPage() {
  const { locale } = useLocale()
  const [route, setRoute] = useState<Pi05RouteMode>(() => resolveInitialPi05Route())
  const [data, setData] = useState<Pi05AnalyzeResult | null>(null)
  const [err, setErr] = useState('')
  const [pathValues, setPathValues] = useState<Partial<Record<PathSlotId, string>>>(() =>
    loadStoredPaths(resolveInitialPi05Route()),
  )
  const [probes, setProbes] = useState<Partial<Record<PathSlotId, ProbeInfo>>>({})
  const [focus, setFocus] = useState<FocusId | null>(null)
  const [gpuState, setGpuState] = useState<GpuState>('idle')
  const [gpuCount, setGpuCount] = useState<number | null>(null)
  const [gpuBusy, setGpuBusy] = useState(false)
  const [picker, setPicker] = useState<PathSlot | null>(null)
  const [probeBusy, setProbeBusy] = useState(false)
  const [loraAddress, setLoraAddress] = useState(DEFAULT_LORA_ADDRESS)
  const [loraTaskName, setLoraTaskName] = useState(DEFAULT_LORA_TASK_NAME)
  const [loraAddressOptions, setLoraAddressOptions] = useState<string[]>([DEFAULT_LORA_ADDRESS])
  const [loraExportMsg, setLoraExportMsg] = useState('')
  const [loraMkdirSh, setLoraMkdirSh] = useState('')
  const [loraMkdirCopied, setLoraMkdirCopied] = useState(false)

  const fullFt = route === 'full_ft'
  const paths = data?.paths || {}
  const slots = useMemo(() => buildSlots(fullFt), [fullFt, locale])

  const placeholderOf = useCallback(
    (slot: PathSlot) => String(paths[slot.pathKey] || ''),
    [paths],
  )

  const applyProbe = (slot: PathSlot, target: string, st: Awaited<ReturnType<typeof probeFsPath>>) => {
    const info: ProbeInfo = {
      healthy: st.healthy ?? st.exists,
      path: st.path || target,
      reason: st.reason || (st.healthy ?? st.exists ? 'ok' : 'missing'),
      detail: st.detail,
      exists: st.exists,
      isFile: st.isFile,
      isDir: st.isDir,
    }
    setProbes((prev) => ({ ...prev, [slot.id]: info }))
    return info
  }

  const probeSlot = async (slot: PathSlot, values: Partial<Record<PathSlotId, string>>) => {
    const ph = String(paths[slot.pathKey] || placeholderOf(slot))
    const target = effectivePath(values[slot.id] || '', ph)
    if (!target) {
      const info: ProbeInfo = {
        healthy: slot.optional ? null : false,
        path: '',
        reason: 'empty',
      }
      setProbes((prev) => ({ ...prev, [slot.id]: info }))
      return info
    }
    try {
      const st = await probeFsPath(target, slot.expect)
      return applyProbe(slot, target, st)
    } catch {
      const info: ProbeInfo = { healthy: false, path: target, reason: 'missing' }
      setProbes((prev) => ({ ...prev, [slot.id]: info }))
      return info
    }
  }

  const probeAll = useCallback(
    async (
      nextPaths: Record<string, string>,
      values: Partial<Record<PathSlotId, string>>,
      nextSlots: PathSlot[],
    ) => {
      setProbeBusy(true)
      const next: Partial<Record<PathSlotId, ProbeInfo>> = {}
      await Promise.all(
        nextSlots.map(async (slot) => {
          const ph = String(nextPaths[slot.pathKey] || '')
          const target = effectivePath(values[slot.id] || '', ph)
          if (!target) {
            next[slot.id] = {
              healthy: slot.optional ? null : false,
              path: '',
              reason: 'empty',
            }
            return
          }
          try {
            const st = await probeFsPath(target, slot.expect)
            next[slot.id] = {
              healthy: st.healthy ?? st.exists,
              path: st.path || target,
              reason: st.reason || (st.healthy ?? st.exists ? 'ok' : 'missing'),
              detail: st.detail,
              exists: st.exists,
              isFile: st.isFile,
              isDir: st.isDir,
            }
          } catch {
            next[slot.id] = { healthy: false, path: target, reason: 'missing' }
          }
        }),
      )
      setProbes(next)
      setProbeBusy(false)
    },
    [],
  )

  const load = useCallback(
    async (rootOverride?: string, values = pathValues) => {
      setErr('')
      try {
        const root = (rootOverride ?? values.pi05Root ?? '').trim() || undefined
        const r = await analyzePi05(root, undefined, undefined, route)
        if (!r.ok) throw new Error(r.error || 'failed')
        setData(r)
        await probeAll(r.paths || {}, values, buildSlots(route === 'full_ft'))
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      }
    },
    [route, pathValues, probeAll],
  )

  useEffect(() => {
    writeStoredPi05Route(route)
    const stored = loadStoredPaths(route)
    setPathValues(stored)
    setGpuState('idle')
    setGpuCount(null)
    setProbes({})
    setFocus(null)
    setLoraExportMsg('')
    setLoraMkdirSh('')
    setLoraMkdirCopied(false)
    void load(undefined, stored)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route])

  useEffect(() => {
    saveStoredPaths(route, pathValues)
  }, [route, pathValues])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LORA_EXPORT_STORAGE)
      if (!raw) return
      const parsed = JSON.parse(raw) as { address?: string; taskName?: string }
      if (parsed.address?.trim()) setLoraAddress(parsed.address.trim())
      if (parsed.taskName?.trim()) setLoraTaskName(parsed.taskName.trim())
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(
        LORA_EXPORT_STORAGE,
        JSON.stringify({ address: loraAddress, taskName: loraTaskName }),
      )
    } catch {
      /* ignore */
    }
  }, [loraAddress, loraTaskName])

  useEffect(() => {
    if (fullFt) return
    let cancelled = false
    void (async () => {
      const opts = new Set<string>([DEFAULT_LORA_ADDRESS])
      // AUTODL_TMP candidates: shallow roots only (skip symlink-resolved deep paths).
      const isAddressCandidate = (p: string) => {
        const parts = p.replace(/\/+$/, '').split('/').filter(Boolean)
        return parts.length > 0 && parts.length <= 2
      }
      try {
        const r = await fetchFsChildren('pi05', '', '/root')
        for (const e of r.entries || []) {
          if (e.isDir && e.path && isAddressCandidate(e.path)) opts.add(e.path)
        }
      } catch {
        /* keep defaults */
      }
      if (!cancelled) setLoraAddressOptions([...opts].sort((a, b) => a.localeCompare(b)))
    })()
    return () => {
      cancelled = true
    }
  }, [fullFt])

  const onExportLoraRef = () => {
    const name = loraTaskName.trim()
    if (!name) {
      setLoraExportMsg(t('pi05Setup.loraExport.needTask'))
      setLoraMkdirSh('')
      setLoraMkdirCopied(false)
      return
    }
    const doc = buildLoraTaskRefJson(loraAddress, name)
    downloadLoraTaskBundle(doc)
    setLoraMkdirSh(buildLoraTaskMkdirSh(doc))
    setLoraMkdirCopied(false)
    setLoraExportMsg(t('pi05Setup.loraExport.done', { name: doc.TASK_NAME }))
  }

  const onCopyLoraMkdir = async () => {
    if (!loraMkdirSh) return
    try {
      await navigator.clipboard.writeText(`${loraMkdirSh}\n`)
      setLoraMkdirCopied(true)
    } catch {
      setLoraMkdirCopied(false)
    }
  }

  const setPathValue = (id: PathSlotId, next: string) => {
    setPathValues((prev) => ({ ...prev, [id]: next }))
  }

  const onPathCommit = async (slot: PathSlot, next: string) => {
    const merged = { ...pathValues, [slot.id]: next }
    setPathValues(merged)
    setFocus(slot.id)
    setProbeBusy(true)
    const ph = placeholderOf(slot)
    try {
      if (slot.id === 'pi05Root') {
        await load(next.trim() || ph, merged)
        return
      }
      await probeSlot(slot, merged)
    } finally {
      setProbeBusy(false)
    }
  }

  const onDetectGpu = async () => {
    setFocus('gpu')
    setGpuBusy(true)
    setGpuState('checking')
    try {
      const r = await fetchPi05GpuStatus()
      setGpuCount(r.gpuCount)
      setGpuState(r.enoughForFullFt ? 'ok' : 'bad')
    } catch {
      setGpuCount(null)
      setGpuState('bad')
    } finally {
      setGpuBusy(false)
    }
  }

  const browseRoots = useMemo(() => {
    return {
      pi05: '/root/autodl-tmp',
      act: '/root/autodl-tmp',
      embody: '',
    } as Record<BrowseRoot, string>
  }, [])

  const rowClass = (healthy: boolean | null | undefined, optional?: boolean) => {
    if (healthy === true) return ' ok'
    if (healthy === false) return ' bad'
    return optional ? ' idle' : ' bad'
  }

  const gpuRowClass =
    gpuState === 'ok' ? ' ok' : gpuState === 'bad' ? ' bad' : gpuState === 'checking' ? ' checking' : ' idle'

  const focusSlot = focus && focus !== 'gpu' ? slots.find((s) => s.id === focus) : null
  const focusProbe = focusSlot ? probes[focusSlot.id] : null

  return (
    <div className="act-pipeline-page pi05-setup-page" data-locale={locale} data-route={route}>
      <header className="act-header">
        <div className="act-header-brand">
          <h1>{t('pi05Setup.title')}</h1>
          <p className="act-sub">{fullFt ? t('pi05Setup.subtitleFullFt') : t('pi05Setup.subtitle')}</p>
        </div>
        <div className="act-header-actions">
          <PageChrome className="act-header-actions-inner" />
        </div>
      </header>

      <div className="act-body pi05s-body">
        <Pi05RouteChrome route={route} onChange={setRoute} />

        {fullFt ? (
          <div className="pi05-route-hero">
            <p className="pi05-route-hero-kicker">{t('pi05Setup.hero.kicker')}</p>
            <h2>{t('pi05Setup.hero.title')}</h2>
            <p className="muted">{t('pi05Setup.hero.lead')}</p>
          </div>
        ) : (
          <div className="pi05-route-hero secondary">
            <p className="pi05-route-hero-kicker">{t('pi05Setup.heroSmoke.kicker')}</p>
            <h2>{t('pi05Setup.heroSmoke.title')}</h2>
            <p className="muted">{t('pi05Setup.heroSmoke.lead')}</p>
            <div className="pi05-lora-export" aria-label={t('pi05Setup.loraExport.aria')}>
              <label className="pi05-lora-export-field">
                <span className="pi05-lora-export-label">{t('pi05Setup.loraExport.address')}</span>
                <select
                  value={loraAddress}
                  onChange={(e) => setLoraAddress(e.target.value)}
                  title={t('pi05Setup.loraExport.addressHint')}
                >
                  {!loraAddressOptions.includes(loraAddress) && loraAddress ? (
                    <option value={loraAddress}>{loraAddress}</option>
                  ) : null}
                  {loraAddressOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pi05-lora-export-field">
                <span className="pi05-lora-export-label">{t('pi05Setup.loraExport.taskName')}</span>
                <input
                  type="text"
                  value={loraTaskName}
                  onChange={(e) => setLoraTaskName(e.target.value)}
                  placeholder={DEFAULT_LORA_TASK_NAME}
                  title={t('pi05Setup.loraExport.taskHint')}
                  spellCheck={false}
                />
              </label>
              <button type="button" className="pi05-lora-export-btn" onClick={onExportLoraRef}>
                {t('pi05Setup.loraExport.button')}
              </button>
            </div>
            {loraExportMsg ? <p className="pi05-lora-export-msg muted">{loraExportMsg}</p> : null}
            {loraMkdirSh ? (
              <div className="pi05-lora-mkdir">
                <div className="pi05-lora-mkdir-head">
                  <span className="pi05-lora-export-label">{t('pi05Setup.loraExport.mkdirLabel')}</span>
                  <button
                    type="button"
                    className="pi05-lora-mkdir-copy"
                    onClick={() => void onCopyLoraMkdir()}
                  >
                    {loraMkdirCopied
                      ? t('pi05Setup.loraExport.mkdirCopied')
                      : t('pi05Setup.loraExport.mkdirCopy')}
                  </button>
                </div>
                <p className="pi05-lora-mkdir-hint muted">{t('pi05Setup.loraExport.mkdirHint')}</p>
                <textarea
                  className="pi05-lora-mkdir-code"
                  readOnly
                  spellCheck={false}
                  value={loraMkdirSh}
                  rows={4}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={t('pi05Setup.loraExport.mkdirLabel')}
                />
              </div>
            ) : null}
          </div>
        )}

        {err ? <div className="act-banner err">{err}</div> : null}

        <div className="pi05s-layout">
          <aside className="pi05s-aside" aria-label={t('pi05Setup.healthTitle')}>
            <div className="pi05s-section-label">{t('pi05Setup.healthTitle')}</div>
            <p className="pi05s-health-hint muted">{t('pi05Setup.healthPickHint')}</p>
            <ul className="pi05s-health-list">
              {slots.map((slot) => {
                const ph = placeholderOf(slot)
                const value = pathValues[slot.id] ?? ''
                const probe = probes[slot.id]
                const healthy = probe?.healthy
                return (
                  <li
                    key={slot.id}
                    className={`pi05s-health-row${rowClass(healthy, slot.optional)}${
                      focus === slot.id ? ' focused' : ''
                    }`}
                    onClick={() => setFocus(slot.id)}
                  >
                    <span className="pi05s-health-dot" aria-hidden="true" />
                    <div className="pi05s-health-meta">
                      <span className="pi05s-health-name">
                        {slot.label}
                        {slot.optional ? (
                          <em className="pi05s-optional">{t('pi05Setup.optional')}</em>
                        ) : null}
                      </span>
                      <div className="pi05s-path-field" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          value={value}
                          placeholder={ph || t('pi05Setup.pathPlaceholder')}
                          onChange={(e) => setPathValue(slot.id, e.target.value)}
                          onFocus={() => setFocus(slot.id)}
                          onBlur={() => void onPathCommit(slot, value)}
                          title={effectivePath(value, ph)}
                        />
                        <button type="button" className="pi05s-browse" onClick={() => setPicker(slot)}>
                          {t('pi05.btnBrowse')}
                        </button>
                      </div>
                    </div>
                  </li>
                )
              })}

              {fullFt ? (
                <li
                  className={`pi05s-health-row pi05s-gpu-row${gpuRowClass}${focus === 'gpu' ? ' focused' : ''}`}
                  onClick={() => setFocus('gpu')}
                >
                  <span className="pi05s-health-dot" aria-hidden="true" />
                  <div className="pi05s-health-meta">
                    <span className="pi05s-health-name">{t('pi05Setup.check.gpu8')}</span>
                    <div className="pi05s-gpu-actions" onClick={(e) => e.stopPropagation()}>
                      <code className="pi05s-health-path">
                        {gpuState === 'idle'
                          ? t('pi05Setup.gpuIdle')
                          : gpuState === 'checking'
                            ? t('pi05Setup.gpuChecking')
                            : `${t('pi05Setup.check.gpuCount')}: ${gpuCount ?? '—'}${
                                gpuState === 'ok'
                                  ? ` · ${t('pi05Setup.gpuOk')}`
                                  : ` · ${t('pi05Setup.gpuBad')}`
                              }`}
                      </code>
                      <button
                        type="button"
                        className="pi05s-gpu-btn"
                        disabled={gpuBusy}
                        onClick={() => void onDetectGpu()}
                      >
                        {gpuBusy ? t('pi05Setup.gpuChecking') : t('pi05Setup.gpuDetect')}
                      </button>
                    </div>
                  </div>
                </li>
              ) : null}
            </ul>
          </aside>

          <section className="pi05s-main" aria-label={t('pi05Setup.detailTitle')}>
            <div className="pi05s-section-label">{t('pi05Setup.detailTitle')}</div>
            {!focus ? (
              <p className="pi05s-detail-empty muted">{t('pi05Setup.detailEmpty')}</p>
            ) : focus === 'gpu' ? (
              <div className={`pi05s-detail-card${gpuState === 'ok' ? ' ok' : gpuState === 'bad' ? ' bad' : ''}`}>
                <h3>{t('pi05Setup.check.gpu8')}</h3>
                {(
                  [
                    ['purpose', 'role.gpu'],
                    ['pipeline', 'pipeline.gpu'],
                    ['example', 'example.gpu'],
                    ['mistakes', 'mistakes.gpu'],
                    ['criteria', 'criteria.gpu'],
                    ['impact', 'impact.gpu'],
                  ] as const
                ).map(([label, body]) => (
                  <div key={label} className="pi05s-detail-block">
                    <div className="pi05s-detail-label">{t(`pi05Setup.detail.${label}`)}</div>
                    <p className="pi05s-detail-body">{t(`pi05Setup.${body}`)}</p>
                  </div>
                ))}
                <div className="pi05s-detail-block">
                  <div className="pi05s-detail-label">{t('pi05Setup.detail.result')}</div>
                  <p className="pi05s-detail-verdict">
                    {gpuState === 'idle'
                      ? t('pi05Setup.gpuDetailIdle')
                      : gpuState === 'checking'
                        ? t('pi05Setup.gpuChecking')
                        : gpuState === 'ok'
                          ? t('pi05Setup.gpuDetailOk', { n: String(gpuCount ?? 0) })
                          : t('pi05Setup.gpuDetailBad', { n: String(gpuCount ?? 0) })}
                  </p>
                </div>
              </div>
            ) : focusSlot ? (
              <div
                className={`pi05s-detail-card${
                  focusProbe?.healthy === true ? ' ok' : focusProbe?.healthy === false ? ' bad' : ''
                }`}
              >
                <h3>
                  {focusSlot.label}
                  {probeBusy ? <em className="muted"> · {t('pi05Setup.probing')}</em> : null}
                </h3>
                {(
                  [
                    ['purpose', `role.${focusSlot.id}`],
                    ['pipeline', `pipeline.${focusSlot.id}`],
                    ['example', `example.${focusSlot.id}`],
                    ['mistakes', `mistakes.${focusSlot.id}`],
                    ['criteria', `criteria.${focusSlot.id}`],
                    ['impact', `impact.${focusSlot.id}`],
                  ] as const
                ).map(([label, body]) => (
                  <div key={label} className="pi05s-detail-block">
                    <div className="pi05s-detail-label">{t(`pi05Setup.detail.${label}`)}</div>
                    <p className="pi05s-detail-body">{t(`pi05Setup.${body}`)}</p>
                  </div>
                ))}
                <div className="pi05s-detail-block">
                  <div className="pi05s-detail-label">{t('pi05Setup.detail.path')}</div>
                  <code className="pi05s-detail-path" title={focusProbe?.path || ''}>
                    {focusProbe?.path ||
                      effectivePath(pathValues[focusSlot.id] || '', placeholderOf(focusSlot)) ||
                      t('pi05Setup.pathPlaceholder')}
                  </code>
                </div>
                <div className="pi05s-detail-block">
                  <div className="pi05s-detail-label">{t('pi05Setup.detail.result')}</div>
                  <p className="pi05s-detail-verdict">
                    {focusProbe == null
                      ? t('pi05Setup.detailPending')
                      : focusProbe.healthy === null
                        ? t('pi05Setup.detailOptionalEmpty')
                        : reasonMessage(focusProbe.reason, focusProbe.path, focusProbe.detail)}
                  </p>
                </div>
              </div>
            ) : null}

            {fullFt && focus === 'fullFtConfig'
              ? (() => {
                  const slot = slots.find((s) => s.id === 'fullFtConfig')
                  if (!slot) return null
                  return (
                    <Pi05FullFtYamlGuide
                      yamlPath={effectivePath(pathValues.fullFtConfig || '', placeholderOf(slot))}
                      pi05Root={effectivePath(
                        pathValues.pi05Root || '',
                        String(paths.pi05Root || ''),
                      )}
                    />
                  )
                })()
              : null}

            <nav className="pi05s-jumps" aria-label={t('pi05Setup.jumpAria')}>
              <Link to={`/pi05-pipeline?route=${route}`}>{t('pi05Setup.linkPipeline')}</Link>
              <Link to={`/pi05-analysis?route=${route}`}>{t('pi05Setup.linkAnalysis')}</Link>
              <Link to="/dataset-converter">{t('pi05Setup.linkConverter')}</Link>
            </nav>
          </section>
        </div>
      </div>

      {picker ? (
        <PathPickerModal
          open
          title={picker.label}
          value={effectivePath(pathValues[picker.id] || '', placeholderOf(picker))}
          browseRoot={picker.id === 'actRobotRoot' ? 'act' : 'pi05'}
          roots={browseRoots}
          pathKind={picker.pathKind}
          browseAnchor="/root/autodl-tmp"
          onClose={() => setPicker(null)}
          onConfirm={(path) => {
            const slot = picker
            setPicker(null)
            void onPathCommit(slot, path)
          }}
        />
      ) : null}
    </div>
  )
}
