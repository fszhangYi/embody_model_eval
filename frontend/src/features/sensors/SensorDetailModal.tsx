import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { t, trText } from '../../i18n/runtime'
import {
  type SensorDevice,
  type SensorStatus,
} from './types'

function statusClass(status: SensorStatus): string {
  if (status === 'ok') return 'ok'
  if (status === 'warn') return 'warn'
  if (status === 'error') return 'err'
  if (status === 'offline') return 'off'
  return 'idle'
}

export function SensorDetailModal({
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

  const { detail } = device
  const arm = device.armLive
  const teachSamples = arm?.teachCheck?.samples

  const previewHint =
    device.kind === 'realsense'
      ? t('sensors.modal.previewRs')
      : device.kind === 'tactile'
        ? t('sensors.modal.previewTactile')
        : device.kind === 'ft'
          ? t('sensors.modal.previewFt')
          : device.kind === 'arm'
            ? t('sensors.modal.previewArmLoading')
            : t('sensors.modal.previewGeneric')

  return createPortal(
    <div
      className="sensors-modal-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`sensors-modal kind-${device.kind}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sensors-modal-title"
      >
        <div className="sensors-modal-head">
          <div>
            <div className="sensors-modal-kicker">
              <span className="sensors-kind-tag">{t(`sensors.kind.${device.kind}`)}</span>
              <span className={`sensors-status ${statusClass(device.status)}`}>
                {t(`sensors.status.${device.status}`)}
              </span>
            </div>
            <h2 id="sensors-modal-title">{trText(device.name)}</h2>
            <p className="muted">{trText(device.model)}</p>
          </div>
          <button
            type="button"
            className="sensors-modal-close"
            onClick={onClose}
            aria-label={t('sensors.modal.closeAria')}
          >
            ×
          </button>
        </div>

        <div className="sensors-modal-body">
          <p className="sensors-modal-summary">{trText(detail.summary)}</p>

          <div className="sensors-modal-preview" aria-hidden={device.kind !== 'arm'}>
            {device.kind === 'arm' && arm?.pose ? (
              <div className="sensors-arm-preview">
                <div className="sensors-arm-preview-row">
                  <span className="muted">{t('sensors.modal.tcpFlange')}</span>
                  <strong>{arm.pose.tcpText}</strong>
                </div>
                <div className="sensors-arm-preview-row">
                  <span className="muted">{t('sensors.modal.rpy')}</span>
                  <strong>{arm.pose.rpyText}</strong>
                </div>
                <div className="sensors-arm-preview-row">
                  <span className="muted">{t('sensors.modal.joints')}</span>
                  <code>{arm.pose.jointText}</code>
                </div>
                {arm.config?.teachPoseCount ? (
                  <div className="sensors-arm-teach-btns">
                    <span className="muted">{t('sensors.modal.teachPoints')}</span>
                    {Array.from({ length: Math.min(arm.config.teachPoseCount, 9) }, (_, i) => i + 1).map(
                      (n) => (
                        <button
                          key={n}
                          type="button"
                          className="sensors-btn ghost"
                          disabled={busy || !onSelectTeach}
                          onClick={() => onSelectTeach?.(n)}
                        >
                          #{n}
                        </button>
                      ),
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <span className="muted">{previewHint}</span>
            )}
          </div>

          <dl className="sensors-metrics sensors-metrics-lg">
            {device.metrics.map((m) => (
              <div key={m.label} className="sensors-metric">
                <dt>{trText(m.label)}</dt>
                <dd>{trText(m.value)}</dd>
              </div>
            ))}
          </dl>

          <div className="sensors-modal-sections">
            {detail.sections.map((sec) => (
              <section key={trText(sec.title)} className="sensors-modal-section">
                <h3>{trText(sec.title)}</h3>
                <table>
                  <tbody>
                    {sec.rows.map((row) => (
                      <tr key={trText(row.label)}>
                        <th scope="row">{trText(row.label)}</th>
                        <td>{trText(row.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            ))}
          </div>

          {teachSamples?.length ? (
            <section className="sensors-modal-section">
              <h3>{t('sensors.modal.teachSamples')}</h3>
              <div className="sensors-teach-table-wrap">
                <table className="sensors-teach-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>err (mm)</th>
                      <th>FK xyz</th>
                      <th>{t('sensors.modal.teachXyz')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {teachSamples.map((s) => (
                      <tr key={s.index} data-ok={s.ok ? '1' : '0'}>
                        <td>{s.index}</td>
                        <td>{s.errMm.toFixed(4)}</td>
                        <td>
                          <code>
                            {s.fkMm.map((x) => x.toFixed(1)).join(', ')}
                          </code>
                        </td>
                        <td>
                          <code>
                            {s.refMm.map((x) => x.toFixed(1)).join(', ')}
                          </code>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="sensors-btn ghost"
                            disabled={busy || !onSelectTeach}
                            onClick={() => onSelectTeach?.(s.index)}
                          >
                            {t('sensors.modal.btnLoad')}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {detail.channels?.length ? (
            <section className="sensors-modal-section">
              <h3>{t('sensors.modal.channels')}</h3>
              <ul className="sensors-chip-list">
                {detail.channels.map((c) => (
                  <li key={c}>
                    <code>{c}</code>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.checklist?.length ? (
            <section className="sensors-modal-section">
              <h3>{t('sensors.modal.checklist')}</h3>
              <ul className="sensors-check-list">
                {detail.checklist.map((item) => (
                  <li key={trText(item)}>
                    <span className="sensors-check-box" aria-hidden="true" />
                    {trText(item)}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="sensors-modal-section">
            <h3>{t('sensors.modal.identity')}</h3>
            <table>
              <tbody>
                <tr>
                  <th scope="row">{t('sensors.modal.deviceId')}</th>
                  <td>
                    <code>{device.id}</code>
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t('sensors.endpoint')}</th>
                  <td>
                    <code>{device.endpoint}</code>
                  </td>
                </tr>
                <tr>
                  <th scope="row">{t('sensors.modal.description')}</th>
                  <td>{trText(device.note)}</td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>

        <div className="sensors-modal-foot">
          <button
            type="button"
            className="sensors-btn"
            disabled={busy}
            onClick={() => onTest(device.id)}
          >
            {busy ? t('sensors.btnTesting') : t('sensors.btnTest')}
          </button>
          <button type="button" className="sensors-btn primary" onClick={onClose}>
            {t('sensors.modal.close')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
