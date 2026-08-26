import { t } from '../../i18n/runtime'
import { useMemo, useState } from 'react'

const ALPHA_TRAIN = 28
const ALPHA_VAL = 4
const PREFETCH = 2
const MAIN_GB = 4
const MISC_GB = 1
const DEFAULT_H = 480
const DEFAULT_W = 640

function parseCameraCount(cameraNames: string): number {
  const parts = cameraNames.trim().split(/\s+/).filter(Boolean)
  return parts.length > 0 ? parts.length : 3
}

function estimateMemory(opts: {
  batchSize: number
  numWorkers: number
  cameraCount: number
  height: number
  width: number
}) {
  const B = Math.max(1, opts.batchSize)
  const W_train = Math.max(0, opts.numWorkers)
  const W_val = Math.min(2, W_train)
  const K = Math.max(1, opts.cameraCount)
  const { height: H, width: W } = opts

  const sampleGb = (K * 3 * H * W * 4) / 1e9
  const batchGb = B * sampleGb
  const workersGb =
    W_train * ALPHA_TRAIN * PREFETCH * batchGb + W_val * ALPHA_VAL * PREFETCH * batchGb
  const cpuGb = MAIN_GB + workersGb + MISC_GB
  const gpuBatchGb = batchGb * 5
  const gpuGb = gpuBatchGb + 18

  return { sampleGb, batchGb, workersGb, cpuGb, gpuGb, W_train, W_val, K, B }
}

function fmtGb(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 100) return `${n.toFixed(0)} GB`
  if (n >= 10) return `${n.toFixed(1)} GB`
  return `${n.toFixed(2)} GB`
}

export function TrainMemoryGuide({
  batchSize,
  numWorkers,
  cameraNames,
}: {
  batchSize: number
  numWorkers: number
  cameraNames: string
}) {
  const [open, setOpen] = useState(true)
  const [height, setHeight] = useState(DEFAULT_H)
  const [width, setWidth] = useState(DEFAULT_W)

  const cameraCount = useMemo(() => parseCameraCount(cameraNames), [cameraNames])
  const est = useMemo(
    () =>
      estimateMemory({
        batchSize,
        numWorkers,
        cameraCount,
        height,
        width,
      }),
    [batchSize, numWorkers, cameraCount, height, width],
  )

  const highCpu = est.cpuGb >= 64
  const highGpu = est.gpuGb >= 28

  return (
    <section className="act-train-mem">
      <button
        type="button"
        className="act-train-mem-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="act-train-mem-title">{t('act.mem.title')}</span>
        <span className="act-train-mem-badges">
          <span className={`act-train-mem-pill${highCpu ? ' warn' : ''}`}>
            CPU ≈ {fmtGb(est.cpuGb)}
          </span>
          <span className={`act-train-mem-pill${highGpu ? ' warn' : ''}`}>
            GPU ≈ {fmtGb(est.gpuGb)}
          </span>
        </span>
        <span className="act-train-mem-chevron">{open ? '▾' : '▸'}</span>
      </button>

      {open ? (
        <div className="act-train-mem-body">
          <p className="act-train-mem-lead muted">{t('act.mem.lead')}</p>

          <div className="act-train-mem-res">
            <label>
              {t('act.mem.height')}
              <input
                type="number"
                min={1}
                value={height}
                onChange={(e) => setHeight(Math.max(1, Number(e.target.value) || DEFAULT_H))}
              />
            </label>
            <label>
              {t('act.mem.width')}
              <input
                type="number"
                min={1}
                value={width}
                onChange={(e) => setWidth(Math.max(1, Number(e.target.value) || DEFAULT_W))}
              />
            </label>
            <span className="muted act-train-mem-res-hint">{t('act.mem.resHint')}</span>
          </div>

          <div className="act-train-mem-live">
            <h4>{t('act.mem.current')}</h4>
            <dl className="act-train-mem-stats">
              <div>
                <dt>{t('act.mem.sample')}</dt>
                <dd>
                  {t('act.mem.sampleVal', {
                    cameras: est.K,
                    h: height,
                    w: width,
                    size: fmtGb(est.sampleGb),
                  })}
                </dd>
              </div>
              <div>
                <dt>{t('act.mem.batch')}</dt>
                <dd>{t('act.mem.batchVal', { b: est.B, size: fmtGb(est.batchGb) })}</dd>
              </div>
              <div>
                <dt>{t('act.mem.workers')}</dt>
                <dd>
                  {t('act.mem.workersVal', {
                    train: est.W_train,
                    val: est.W_val,
                    size: fmtGb(est.workersGb),
                  })}
                </dd>
              </div>
              <div>
                <dt>{t('act.mem.cpuTotal')}</dt>
                <dd className={highCpu ? 'warn' : ''}>
                  {t('act.mem.cpuVal', {
                    main: MAIN_GB,
                    workers: fmtGb(est.workersGb),
                    misc: MISC_GB,
                    total: fmtGb(est.cpuGb),
                  })}
                </dd>
              </div>
              <div>
                <dt>{t('act.mem.gpu')}</dt>
                <dd className={highGpu ? 'warn' : ''}>
                  {t('act.mem.gpuVal', { size: fmtGb(est.gpuGb) })}
                </dd>
              </div>
            </dl>
          </div>

          <details className="act-train-mem-details">
            <summary>{t('act.mem.formulas')}</summary>
            <div className="act-train-mem-formulas">
              <p>
                <strong>{t('act.mem.formulaSample')}</strong>
                <code>M_sample = K × 3 × H × W × 4</code>（bytes）
              </p>
              <p>
                <strong>{t('act.mem.formulaBatch')}</strong>
                <code>M_batch = B × M_sample</code>（{t('act.mem.formulaBatchNote')}）
              </p>
              <p>
                <strong>{t('act.mem.formulaWorkers')}</strong>
                <code>
                  M_workers = W_train×α_train×prefetch×M_batch + W_val×α_val×prefetch×M_batch
                </code>
                <br />
                <span className="muted">{t('act.mem.formulaWorkersNote')}</span>
              </p>
              <p>
                <strong>{t('act.mem.formulaCpu')}</strong>
                <code>M_CPU ≈ M_main(2–5 GB) + M_workers + M_misc(~1 GB)</code>
              </p>
              <p>
                <strong>{t('act.mem.formulaGpu')}</strong>
                <code>M_GPU ≈ M_model + M_opt + B×M_sample×β</code>，{t('act.mem.formulaGpuNote')}
              </p>
            </div>
          </details>

          <table className="act-train-mem-table">
            <caption>{t('act.mem.tableCaption')}</caption>
            <thead>
              <tr>
                <th>{t('act.mem.colMethod')}</th>
                <th>{t('act.mem.colEffect')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{t('act.mem.reduceWorkers')}</td>
                <td>{t('act.mem.reduceWorkersEffect')}</td>
              </tr>
              <tr>
                <td>{t('act.mem.reduceBatch')}</td>
                <td>{t('act.mem.reduceBatchEffect')}</td>
              </tr>
              <tr>
                <td>{t('act.mem.workersZero')}</td>
                <td>{t('act.mem.workersZeroEffect')}</td>
              </tr>
              <tr>
                <td>{t('act.mem.reduceCameras')}</td>
                <td>{t('act.mem.reduceCamerasEffect')}</td>
              </tr>
            </tbody>
          </table>

          <details className="act-train-mem-details">
            <summary>{t('act.mem.benchmark')}</summary>
            <table className="act-train-mem-table compact">
              <tbody>
                <tr>
                  <th>{t('act.mem.workerRss')}</th>
                  <td>19–22 GB</td>
                </tr>
                <tr>
                  <th>{t('act.mem.valWorkerRss')}</th>
                  <td>~2.7 GB</td>
                </tr>
                <tr>
                  <th>{t('act.mem.mainRss')}</th>
                  <td>~4 GB</td>
                </tr>
                <tr>
                  <th>{t('act.mem.workersTotal')}</th>
                  <td>~87 GB</td>
                </tr>
                <tr>
                  <th>{t('act.mem.gpuMem')}</th>
                  <td>~24 GB</td>
                </tr>
              </tbody>
            </table>
            <p className="muted act-train-mem-foot">{t('act.mem.footnote')}</p>
          </details>
        </div>
      ) : null}
    </section>
  )
}
