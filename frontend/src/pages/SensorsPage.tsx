import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageNav } from '../components/PageNav'
import { fetchArmStatus, refreshArm, testArm } from '../features/sensors/armApi'
import { SensorDetailModal } from '../features/sensors/SensorDetailModal'
import { ArmKinematicsModal } from '../features/sensors/ArmKinematicsModal'
import {
  KIND_LABEL,
  SENSOR_DEVICES,
  STATUS_LABEL,
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
      title="双击查看详情"
      tabIndex={0}
      onDoubleClick={() => onOpen(device)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(device)
      }}
    >
      <div className="sensors-card-head">
        <div className="sensors-card-title">
          <span className="sensors-kind-tag">{KIND_LABEL[device.kind]}</span>
          <h3>{device.name}</h3>
          <p className="muted">{device.model}</p>
        </div>
        <span className={`sensors-status ${statusClass(device.status)}`}>
          {STATUS_LABEL[device.status]}
        </span>
      </div>

      <p className="sensors-card-note muted">{device.note}</p>

      <dl className="sensors-metrics">
        {device.metrics.map((m) => (
          <div key={m.label} className="sensors-metric">
            <dt>{m.label}</dt>
            <dd>{m.value}</dd>
          </div>
        ))}
      </dl>

      <div className="sensors-card-meta">
        <span className="muted">
          ID <code>{device.id}</code>
        </span>
        <span className="muted">
          端点 <code>{device.endpoint}</code>
        </span>
        <span className="sensors-card-hint muted">双击打开详情</span>
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
          {busy && device.kind === 'arm' ? '测试中…' : '测试连接'}
        </button>
        <button
          type="button"
          className="sensors-btn ghost"
          disabled={!canRefresh || busy}
          title={canRefresh ? '重新计算 FK 读数' : '后续接入实时刷新'}
          onClick={(e) => {
            e.stopPropagation()
            onRefresh(device.id)
          }}
        >
          刷新读数
        </button>
      </div>
    </article>
  )
}

export function SensorsPage() {
  const [filter, setFilter] = useState<'all' | SensorDevice['kind']>('all')
  const [toast, setToast] = useState('正在加载机械臂 arm_kin 运动学…')
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
      setToast(arm.message || (arm.available ? '机械臂运动学已加载' : '机械臂后端不可用'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setToast(`机械臂状态拉取失败：${msg}`)
      patchArm((base) => ({
        ...base,
        status: 'offline',
        note: msg,
        endpoint: 'arm_kin://unavailable',
      }))
    }
  }, [patchArm])

  useEffect(() => {
    void loadArm()
  }, [loadArm])

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
      setToast(`「${d?.name || id}」连接测试尚未接入硬件 API`)
      return
    }
    setArmBusy(true)
    setToast('机械臂：运行示教 FK 对表 + IK 回环…')
    try {
      const arm = await testArm()
      patchArm((base) => applyArmStatus(base, arm))
      setToast(arm.message || '测试完成')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setToast(`机械臂测试失败：${msg}`)
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
      setToast(arm.message || '读数已刷新')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setToast(`刷新失败：${msg}`)
    } finally {
      setArmBusy(false)
    }
  }

  const onTestAll = () => {
    void onTest(ARM_ID)
    const others = devices.filter((d) => d.id !== ARM_ID).length
    if (others > 0) {
      setToast((t) => `${t} · 另有 ${others} 路仍为占位`)
    }
  }

  const onSelectTeach = async (index: number) => {
    setArmBusy(true)
    try {
      const arm = await refreshArm({ useTeachIndex: index })
      patchArm((base) => applyArmStatus(base, arm))
      setToast(`已切换到示教点 #${index} 并重算 FK`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setToast(`切换示教点失败：${msg}`)
    } finally {
      setArmBusy(false)
    }
  }

  return (
    <div className="sensors-page">
      <header className="sensors-header">
        <div className="sensors-header-brand">
          <h1>传感器状态</h1>
          <p className="sensors-header-blurb">连接检测 · 实时读数 · 多相机 / 力觉 / Gello</p>
        </div>
        <div className="sensors-header-actions">
          <PageNav />
        </div>
      </header>

      <main className="sensors-main">
        <section className="sensors-toolbar card">
          <div className="sensors-summary">
            <div className="sensors-stat">
              <span className="l">设备</span>
              <span className="v">{summary.total}</span>
            </div>
            <div className="sensors-stat">
              <span className="l">在线</span>
              <span className="v ok">{summary.ok}</span>
            </div>
            <div className="sensors-stat">
              <span className="l">离线</span>
              <span className="v off">{summary.offline}</span>
            </div>
            <div className="sensors-stat">
              <span className="l">告警</span>
              <span className="v warn">{summary.bad}</span>
            </div>
          </div>

          <div className="sensors-toolbar-right">
            <label className="sensors-filter">
              <span className="muted">类型</span>
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value as typeof filter)}
                aria-label="按传感器类型筛选"
              >
                <option value="all">全部</option>
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="sensors-btn primary" disabled={armBusy} onClick={onTestAll}>
              全部测试
            </button>
          </div>
        </section>

        <p className="sensors-toast muted" role="status">
          {toast}
        </p>

        <section className="sensors-grid" aria-label="传感器列表">
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
