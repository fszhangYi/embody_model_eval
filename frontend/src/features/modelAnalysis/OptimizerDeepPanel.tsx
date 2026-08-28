import { useLocale } from '../../i18n/LocaleContext'
import { VectorGroupCollapse } from './VectorGroupCollapse'
import { fmtNum, fmtValue } from './format'
import type { OptimizerData, OptimizerStateBuffer, OptimizerStateSlot, TensorBufferStats } from './types'

function formatBytes(n: number | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function StatsGrid({ stats, title }: { stats: TensorBufferStats | null | undefined; title: string }) {
  const { t } = useLocale()
  if (!stats) return null
  return (
    <div className="ma-opt-stats-card">
      <h4>{title}</h4>
      <dl className="ma-opt-stats-kv">
        <div><dt>min</dt><dd>{fmtNum(stats.min, 3)}</dd></div>
        <div><dt>max</dt><dd>{fmtNum(stats.max, 3)}</dd></div>
        <div><dt>mean</dt><dd>{fmtNum(stats.mean, 3)}</dd></div>
        <div><dt>std</dt><dd>{fmtNum(stats.std, 3)}</dd></div>
        <div><dt>|mean|</dt><dd>{fmtNum(stats.absMean, 3)}</dd></div>
        <div><dt>{t('modelAnalysis.optNorm')}</dt><dd>{fmtNum(stats.norm, 3)}</dd></div>
      </dl>
    </div>
  )
}

function BufferRow({ buffer }: { buffer: OptimizerStateBuffer }) {
  return (
    <tr>
      <td><code>{buffer.name}</code></td>
      <td>{fmtValue(buffer.shape)}</td>
      <td>{buffer.dtype ?? '—'}</td>
      <td>{formatBytes(buffer.bytes)}</td>
      <td>
        {buffer.value != null
          ? String(buffer.value)
          : buffer.stats
            ? `${fmtNum(buffer.stats.absMean, 2)} / ${fmtNum(buffer.stats.max, 2)}`
            : '—'}
      </td>
    </tr>
  )
}

function SlotBlock({ slot }: { slot: OptimizerStateSlot }) {
  const { t } = useLocale()
  return (
    <VectorGroupCollapse
      title={t('modelAnalysis.optSlotTitle', { idx: String(slot.paramIndex) })}
      subtitle={
        <>
          step {slot.step ?? '—'} · {formatBytes(slot.bytes)}
        </>
      }
      badge={<span>{(slot.buffers ?? []).length} buf</span>}
    >
      <div className="ma-table-wrap">
        <table className="ma-table compact">
          <thead>
            <tr>
              <th>{t('modelAnalysis.colKey')}</th>
              <th>{t('modelAnalysis.colShape')}</th>
              <th>{t('modelAnalysis.colDtype')}</th>
              <th>{t('modelAnalysis.optStateBytes')}</th>
              <th>{t('modelAnalysis.colMetric')}</th>
            </tr>
          </thead>
          <tbody>
            {(slot.buffers ?? []).map((buf) => (
              <BufferRow key={buf.name} buffer={buf} />
            ))}
          </tbody>
        </table>
      </div>
    </VectorGroupCollapse>
  )
}

export function OptimizerDeepPanel({ data, runLabel }: { data: OptimizerData; runLabel?: string }) {
  const { t } = useLocale()
  const summary = data.stateSummary

  return (
    <>
      <section className="ma-panel card">
        <header className="ma-panel-head">
          <h3>{t('modelAnalysis.artifact.optimizer.panel1')}</h3>
          {runLabel ? <span className="ma-run-tag">{runLabel}</span> : null}
        </header>
        <div className="ma-panel-body">
          <div className="ma-opt-meta-row">
            <span className="ma-format-tag large">{data.optimizerType ?? '—'}</span>
            {!summary?.stepUniform && summary?.stepMin != null ? (
              <span className="ma-warn-tag">{t('modelAnalysis.optStepMismatch')}</span>
            ) : null}
          </div>
          <dl className="ma-single-config-dl">
            <div><dt>{t('modelAnalysis.optEpoch')}</dt><dd>{fmtValue(data.epoch)}</dd></div>
            <div><dt>{t('modelAnalysis.optGlobalStep')}</dt><dd>{fmtValue(summary?.globalStep)}</dd></div>
            <div><dt>{t('modelAnalysis.optSlotCount')}</dt><dd>{fmtValue(data.slotCount)}</dd></div>
            <div><dt>{t('modelAnalysis.optStateTensors')}</dt><dd>{fmtValue(data.stateTensorCount)}</dd></div>
            <div><dt>{t('modelAnalysis.optStateBytes')}</dt><dd>{formatBytes(data.stateBytes)}</dd></div>
          </dl>
          <div className="ma-opt-stats-grid">
            <StatsGrid stats={summary?.expAvg} title={t('modelAnalysis.optExpAvg')} />
            <StatsGrid stats={summary?.expAvgSq} title={t('modelAnalysis.optExpAvgSq')} />
          </div>
          {(data.bufferTypes ?? []).length ? (
            <div className="ma-chip-row">
              {(data.bufferTypes ?? []).map((bt) => (
                <span key={bt.name} className="ma-chip">
                  <code>{bt.name}</code> ×{bt.count}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {data.scheduler ? (
        <section className="ma-panel card">
          <header className="ma-panel-head">
            <h3>{t('modelAnalysis.optSchedulerTitle')}</h3>
          </header>
          <div className="ma-panel-body">
            <dl className="ma-single-config-dl">
              <div><dt>{t('modelAnalysis.optSchedLastEpoch')}</dt><dd>{fmtValue(data.scheduler.lastEpoch)}</dd></div>
              <div><dt>T_max</dt><dd>{fmtValue(data.scheduler.TMax)}</dd></div>
              <div><dt>eta_min</dt><dd>{fmtValue(data.scheduler.etaMin)}</dd></div>
              <div><dt>{t('modelAnalysis.colStep')}</dt><dd>{fmtValue(data.scheduler.stepCount)}</dd></div>
              <div><dt>{t('modelAnalysis.optSchedLastLr')}</dt><dd>{fmtValue(data.scheduler.lastLr)}</dd></div>
              <div><dt>base_lrs</dt><dd>{fmtValue(data.scheduler.baseLrs)}</dd></div>
            </dl>
          </div>
        </section>
      ) : null}

      <section className="ma-panel card">
        <header className="ma-panel-head">
          <h3>{t('modelAnalysis.artifact.optimizer.panel2')}</h3>
        </header>
        <div className="ma-panel-body">
          <div className="ma-table-wrap">
            <table className="ma-table compact">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{t('modelAnalysis.quickLr')}</th>
                  <th>{t('modelAnalysis.optInitialLr')}</th>
                  <th>{t('modelAnalysis.optWeightDecay')}</th>
                  <th>{t('modelAnalysis.optParamCount')}</th>
                  <th>{t('modelAnalysis.optBetas')}</th>
                  <th>eps</th>
                  <th>amsgrad</th>
                </tr>
              </thead>
              <tbody>
                {(data.paramGroups ?? []).map((group, idx) => (
                  <tr key={idx}>
                    <td>{idx + 1}</td>
                    <td>{fmtValue(group.lr)}</td>
                    <td>{fmtValue(group.initialLr)}</td>
                    <td>{fmtValue(group.weightDecay)}</td>
                    <td>{fmtValue(group.paramCount)}</td>
                    <td>{fmtValue(group.betas)}</td>
                    <td>{fmtValue(group.eps)}</td>
                    <td>{fmtValue(group.amsgrad)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {(data.topStateSlots ?? []).length ? (
        <VectorGroupCollapse
          title={t('modelAnalysis.optTopSlots')}
          subtitle={t('modelAnalysis.optTopSlotsHint', { n: (data.topStateSlots ?? []).length })}
          badge={formatBytes(data.stateBytes)}
        >
          <div className="ma-opt-slots">
            {(data.topStateSlots ?? []).map((slot) => (
              <SlotBlock key={String(slot.paramIndex)} slot={slot} />
            ))}
          </div>
        </VectorGroupCollapse>
      ) : null}
    </>
  )
}
