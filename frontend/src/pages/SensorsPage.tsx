import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageChrome } from '../components/PageChrome'
import { useLocale } from '../i18n/LocaleContext'
import { t, trText } from '../i18n/runtime'
import { fetchArmStatus, refreshArm, testArm } from '../features/sensors/armApi'
import { SensorDetailModal } from '../features/sensors/SensorDetailModal'
import { ArmKinematicsModal } from '../features/sensors/ArmKinematicsModal'
import {
  SENSOR_DEVICES,
  applyArmStatus,
  type SensorDevice,
  type SensorStatus,
} from '../features/sensors/types'
import '../styles/sensors.css'

const ARM_ID = 'arm-ec616'

function statusClass(status: SensorStatus): string {
  if (status === 'ok') return 'ok'
  if (status === 'warn') return 'warn'
  if (status === 'error') return 'err'
  if (status === 'offline') return 'off'
  return 'idle'
}

function SensorCard({
  device,
  busy,
  onTest,
  onRefresh,
  onOpen,
}: {
  device: SensorDevice
  busy: boolean
  onTest: (id: string) => void
  onRefresh: (id: string) => void
  onOpen: (device: SensorDevice) => void
}) {
  const canRefresh = device.kind === 'arm'
  return (
    <article
      className={`sensors-card kind-${device.kind}`}
      data-status={device.status}
      title={t("sensors.dblclickTitle")}
      tabIndex={0}
      onDoubleClick={() => onOpen(device)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(device)
      }}
    >
      <div className="sensors-card-head">
        <div className="sensors-card-title">
          <span className="sensors-kind-tag">{t(`sensors.kind.${device.kind}`)}</span>
          <h3>{trText(device.name)}</h3>
          <p className="muted">{device.model}</p>
        </div>
        <span className={`sensors-status ${statusClass(device.status)}`}>
          {t(`sensors.status.${device.status}`)}
        </span>
      </div>

      <p className="sensors-card-note muted">{trText(device.note)}</p>

      <dl className="sensors-metrics">
        {device.metrics.map((m) => (
          <div key={m.label} className="sensors-metric">
            <dt>{trText(m.label)}</dt>
            <dd>{trText(m.value)}</dd>
          </div>
        ))}
      </dl>

      <div className="sensors-card-meta">
        <span className="muted">
          ID <code>{device.id}</code>
        </span>
        <span className="muted">
          {t("sensors.endpoint")} <code>{device.endpoint}</code>
        </span>
        <span className="sensors-card-hint muted">{t("sensors.dblclickHint")}</span>
      </div>

      <div className="sensors-card-actions">
        <button
          type="button"
          className="sensors-btn"
          disabled={busy && device.kind === 'arm'}
          onClick={(e) => {
            e.stopPropagation()
            onTest(device.id)
          }}
        >
          {busy && device.kind === 'arm' ? t('sensors.testing') : t('sensors.testConn')}
        </button>
        <button
          type="button"
          className="sensors-btn ghost"
          disabled={!canRefresh || busy}
          title={canRefresh ? t('sensors.refreshFkTitle') : t('sensors.refreshLaterTitle')}
          onClick={(e) => {
            e.stopPropagation()
            onRefresh(device.id)
          }}
        >
          {t("sensors.refreshReadings")}
        </button>
      </div>
    </article>
  )
}

export function SensorsPage() {
  const [filter, setFilter] = useState<'all' | SensorDevice['kind']>('all')
  const { locale } = useLocale()
  const [toast, setToast] = useState(() => t('sensors.toastLoading'))
  const [active, setActive] = useState<SensorDevice | null>(null)
  const [devices, setDevices] = useState<SensorDevice[]>(() => SENSOR_DEVICES.map((d) => ({ ...d })))
  const [armBusy, setArmBusy] = useState(false)

  const patchArm = useCallback((updater: (arm: SensorDevice) => SensorDevice) => {
    setDevices((prev) =>
      prev.map((d) => (d.id === ARM_ID && d.kind === 'arm' ? updater(d) : d)),
    )
    setActive((cur) => (cur && cur.id === ARM_ID ? updater(cur) : cur))
  }, [])

  const loadArm = useCallback(async () => {
    try {
      const arm = await fetchArmStatus()
      patchArm((base) => applyArmStatus(base, arm))
      setToast(trText(arm.message || '') || (arm.available ? t('sensors.toastLoaded') : t('sensors.toastUnavailable')))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setToast(t('sensors.toastFetchFail', { msg }))
      patchArm((base) => ({
        ...base,
        status: 'offline',
        note: msg,
        endpoint: 'arm_kin://unavailable',
      }))
    }
  }, [patchArm])

  useEffect(() => {
    setToast(t('sensors.toastLoading'))
    void loadArm()
  }, [locale, loadArm])

  const filtered = useMemo(
    () => (filter === 'all' ? devices : devices.filter((d) => d.kind === filter)),
    [devices, filter],
  )

  const summary = useMemo(() => {
    const total = devices.length
    const offline = devices.filter((d) => d.status === 'offline').length
    const ok = devices.filter((d) => d.status === 'ok').length
    const bad = devices.filter((d) => d.status === 'error' || d.status === 'warn').length
    return { total, offline, ok, bad }
  }, [devices])

  const kinds = useMemo(() => {
    const seen = new Set<SensorDevice['kind']>()
    for (const d of devices) seen.add(d.kind)
    return Array.from(seen)
  }, [devices])

  const onTest = async (id: string) => {
    if (id !== ARM_ID) {
      const d = devices.find((x) => x.id === id)
      setToast(t('sensors.toastPlaceholder', { name: trText(d?.name || id) }))
      return
    }
    setArmBusy(true)
    setToast(t('sensors.toastTestRunning'))
    try {
      const arm = await testArm()
      patchArm((base) => applyArmStatus(base, arm))
      setToast(trText(arm.message || '') || t('sensors.toastTestDone'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setToast(t('sensors.toastTestFail', { msg }))
    } finally {
      setArmBusy(false)
    }
  }

  const onRefresh = async (id: string) => {
    if (id !== ARM_ID) return
    setArmBusy(true)
    try {
      const arm = await refreshArm()
      patchArm((base) => applyArmStatus(base, arm))
      setToast(trText(arm.message || '') || t('sensors.toastRefreshDone'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setToast(t('sensors.toastRefreshFail', { msg }))
    } finally {
      setArmBusy(false)
    }
  }

  const onTestAll = () => {
    void onTest(ARM_ID)
    const others = devices.filter((d) => d.id !== ARM_ID).length
    if (others > 0) {
      setToast((prev) => `${prev} · ${t('sensors.toastOthersPlaceholder', { n: others })}`)
    }
  }

  const onSelectTeach = async (index: number) => {
    setArmBusy(true)
    try {
      const arm = await refreshArm({ useTeachIndex: index })
      patchArm((base) => applyArmStatus(base, arm))
      setToast(t('sensors.toastTeachSwitch', { index }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setToast(t('sensors.toastTeachFail', { msg }))
    } finally {
      setArmBusy(false)
    }
  }

  return (
    <div className="sensors-page">
      <header className="sensors-header">
        <div className="sensors-header-brand">
          <h1>{t('sensors.title')}</h1>
          <p className="sensors-header-blurb">{t("sensors.subtitle")}</p>
        </div>
        <div className="sensors-header-actions">
          <PageChrome className="sensors-header-actions-inner" />
        </div>
      </header>

      <main className="sensors-main">
        <section className="sensors-toolbar card">
          <div className="sensors-summary">
            <div className="sensors-stat">
              <span className="l">{t("sensors.statDevices")}</span>
              <span className="v">{summary.total}</span>
            </div>
            <div className="sensors-stat">
              <span className="l">{t("sensors.statOnline")}</span>
              <span className="v ok">{summary.ok}</span>
            </div>
            <div className="sensors-stat">
              <span className="l">{t("sensors.statOffline")}</span>
              <span className="v off">{summary.offline}</span>
            </div>
            <div className="sensors-stat">
              <span className="l">{t("sensors.statAlerts")}</span>
              <span className="v warn">{summary.bad}</span>
            </div>
          </div>

          <div className="sensors-toolbar-right">
            <label className="sensors-filter">
              <span className="muted">{t("sensors.filterType")}</span>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as typeof filter)}
                aria-label={t("sensors.filterAria")}
              >
                <option value="all">{t("sensors.filterAll")}</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {t(`sensors.kind.${k}`)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="sensors-btn primary" disabled={armBusy} onClick={onTestAll}>
              {t("sensors.testAll")}
            </button>
          </div>
        </section>

        <p className="sensors-toast muted" role="status">
          {toast}
        </p>

        <section className="sensors-grid" aria-label={t("sensors.listAria")}>
          {filtered.map((d) => (
            <SensorCard
              key={d.id}
              device={d}
              busy={armBusy}
              onTest={(id) => void onTest(id)}
              onRefresh={(id) => void onRefresh(id)}
              onOpen={setActive}
            />
          ))}
        </section>
      </main>

      {active ? (
        active.kind === 'arm' ? (
          <ArmKinematicsModal
            device={active}
            busy={armBusy}
            onClose={() => setActive(null)}
            onTest={(id) => void onTest(id)}
            onSelectTeach={(i) => void onSelectTeach(i)}
          />
        ) : (
          <SensorDetailModal
            device={active}
            busy={armBusy}
            onClose={() => setActive(null)}
            onTest={(id) => void onTest(id)}
          />
        )
      ) : null}
    </div>
  )
}
