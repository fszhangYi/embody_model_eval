import type { ArmStatusResponse } from './armApi'
import type { SensorDevice } from './types'
import { t, trText } from '../../i18n/runtime'

export function ArmLivePanel({
  device,
  arm,
  busy,
  onSelectTeach,
}: {
  device: SensorDevice
  arm: ArmStatusResponse | undefined
  busy: boolean
  onSelectTeach?: (index: number) => void
}) {
  const { detail } = device
  const teachSamples = arm?.teachCheck?.samples

  return (
    <>
      <p className="sensors-modal-summary">{trText(detail.summary)}</p>

      <div className="sensors-modal-preview">
        {arm?.pose ? (
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
          <span className="muted">{t('sensors.arm.poseLoading')}</span>
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
          <h3>{t('sensors.modal.teachSamplesKin')}</h3>
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
                      <code>{s.fkMm.map((x) => x.toFixed(1)).join(', ')}</code>
                    </td>
                    <td>
                      <code>{s.refMm.map((x) => x.toFixed(1)).join(', ')}</code>
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
    </>
  )
}
