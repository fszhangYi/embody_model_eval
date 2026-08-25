import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  fetchArmKinBundle,
  type BuildGuideResponse,
  type ArmKinOverview,
} from './armApi'
import { loadBuildGuideFallback } from './buildGuideFallback'
import { ArmFkIkBuildGuide } from './ArmFkIkBuildGuide'
import { ArmLivePanel } from './ArmLivePanel'
import { ArmProjectPanel } from './ArmProjectPanel'
import { KIND_LABEL, STATUS_LABEL, type SensorDevice, type SensorStatus } from './types'

type ArmTab = 'live' | 'guide' | 'project'

function statusClass(status: SensorStatus): string {
  if (status === 'ok') return 'ok'
  if (status === 'warn') return 'warn'
  if (status === 'error') return 'err'
  if (status === 'offline') return 'off'
  return 'idle'
}

export function ArmKinematicsModal({
  device,
  onClose,
  onTest,
  onSelectTeach,
  busy = false,
}: {
  device: SensorDevice
  onClose: () => void
  onTest: (id: string) => void
  onSelectTeach?: (index: number) => void
  busy?: boolean
}) {
  const [tab, setTab] = useState<ArmTab>('live')
  const [guide, setGuide] = useState<BuildGuideResponse | null>(null)
  const [overview, setOverview] = useState<ArmKinOverview | null>(null)
  const [bundleLoading, setBundleLoading] = useState(true)
  const [bundleError, setBundleError] = useState<string | null>(null)

  const arm = device.armLive

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    setBundleLoading(true)
    setBundleError(null)

    const load = async () => {
      try {
        const b = await fetchArmKinBundle()
        if (cancelled) return
        if (b.guide?.ok) {
          setGuide(b.guide)
          setOverview(b.overview)
          return
        }
        const fallback = await loadBuildGuideFallback()
        if (cancelled) return
        if (fallback.ok) {
          setGuide(fallback)
          setOverview(b.overview?.ok ? b.overview : null)
          setBundleError(
            b.guide?.error
              ? `API 构建说明不可用，已加载静态副本：${b.guide.error}`
              : null,
          )
          return
        }
        setGuide(b.guide || fallback)
        setOverview(b.overview)
        setBundleError(fallback.error || b.guide?.error || '构建说明加载失败')
      } catch (e) {
        if (cancelled) return
        try {
          const fallback = await loadBuildGuideFallback()
          if (cancelled) return
          if (fallback.ok) {
            setGuide(fallback)
            setOverview(null)
            setBundleError(
              `${e instanceof Error ? e.message : String(e)} · 已回退到静态构建说明`,
            )
            return
          }
        } catch {
          /* ignore nested */
        }
        setBundleError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setBundleLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  return createPortal(
    <div
      className="sensors-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="sensors-modal sensors-modal-wide kind-arm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sensors-arm-modal-title"
      >
        <div className="sensors-modal-head">
          <div>
            <div className="sensors-modal-kicker">
              <span className="sensors-kind-tag">{KIND_LABEL.arm}</span>
              <span className={`sensors-status ${statusClass(device.status)}`}>
                {STATUS_LABEL[device.status]}
              </span>
              <span className="sensors-tag-demo">arm_kin</span>
            </div>
            <h2 id="sensors-arm-modal-title">{device.name}</h2>
            <p className="muted">{device.model} · 运动学集成</p>
          </div>
          <button type="button" className="sensors-modal-close" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        <nav className="sensors-arm-tabs" aria-label="机械臂详情页">
          <button
            type="button"
            className={tab === 'live' ? 'active' : ''}
            onClick={() => setTab('live')}
          >
            状态与自检
          </button>
          <button
            type="button"
            className={tab === 'guide' ? 'active' : ''}
            onClick={() => setTab('guide')}
          >
            FK / IK 搭建说明
          </button>
          <button
            type="button"
            className={tab === 'project' ? 'active' : ''}
            onClick={() => setTab('project')}
          >
            arm_kin 模块
          </button>
        </nav>

        <div className="sensors-modal-body sensors-arm-modal-body">
          {tab === 'live' ? (
            <ArmLivePanel device={device} arm={arm} busy={busy} onSelectTeach={onSelectTeach} />
          ) : null}
          {tab === 'guide' ? (
            <ArmFkIkBuildGuide
              guide={guide}
              overview={overview}
              loading={bundleLoading}
              error={bundleError}
            />
          ) : null}
          {tab === 'project' ? (
            <ArmProjectPanel overview={overview} loading={bundleLoading} error={bundleError} />
          ) : null}
        </div>

        <div className="sensors-modal-foot">
          <button
            type="button"
            className="sensors-btn"
            disabled={busy}
            onClick={() => onTest(device.id)}
          >
            {busy ? '测试中…' : '运行 FK/IK 自检'}
          </button>
          <button type="button" className="sensors-btn primary" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
