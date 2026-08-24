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
        <span className="act-train-mem-title">内存 / 显存估算</span>
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
          <p className="act-train-mem-lead muted">
            基于 <code>EpisodicDataset</code> + PyTorch DataLoader（<code>persistent_workers</code>、
            <code>prefetch=2</code>）的经验公式，用于调整 batch-size / num-workers / 相机数时预判资源。
            SAM2 特征模式张量形状不同，仅供参考。
          </p>

          <div className="act-train-mem-res">
            <label>
              图像高 H
              <input
                type="number"
                min={1}
                value={height}
                onChange={(e) => setHeight(Math.max(1, Number(e.target.value) || DEFAULT_H))}
              />
            </label>
            <label>
              图像宽 W
              <input
                type="number"
                min={1}
                value={width}
                onChange={(e) => setWidth(Math.max(1, Number(e.target.value) || DEFAULT_W))}
              />
            </label>
            <span className="muted act-train-mem-res-hint">默认 480×640，与常见 HDF5 一致</span>
          </div>

          <div className="act-train-mem-live">
            <h4>当前参数估算</h4>
            <dl className="act-train-mem-stats">
              <div>
                <dt>单样本图像</dt>
                <dd>
                  {est.K} 相机 × {height}×{width} ≈ {fmtGb(est.sampleGb)}
                </dd>
              </div>
              <div>
                <dt>单 batch 张量</dt>
                <dd>
                  B={est.B} → ≈ {fmtGb(est.batchGb)}
                </dd>
              </div>
              <div>
                <dt>DataLoader workers</dt>
                <dd>
                  训练 {est.W_train} + 验证 {est.W_val} → ≈ {fmtGb(est.workersGb)}
                </dd>
              </div>
              <div>
                <dt>CPU 合计（估）</dt>
                <dd className={highCpu ? 'warn' : ''}>
                  主进程 {MAIN_GB} GB + workers {fmtGb(est.workersGb)} + 杂项 {MISC_GB} GB ≈{' '}
                  <strong>{fmtGb(est.cpuGb)}</strong>
                </dd>
              </div>
              <div>
                <dt>GPU 显存（粗估）</dt>
                <dd className={highGpu ? 'warn' : ''}>
                  batch 激活 ×5 + 模型/优化器 ≈ <strong>{fmtGb(est.gpuGb)}</strong>（需实测校准）
                </dd>
              </div>
            </dl>
          </div>

          <details className="act-train-mem-details">
            <summary>公式说明</summary>
            <div className="act-train-mem-formulas">
              <p>
                <strong>单样本（float32）：</strong>
                <code>M_sample = K × 3 × H × W × 4</code>（bytes）
              </p>
              <p>
                <strong>单 batch：</strong>
                <code>M_batch = B × M_sample</code>（qpos / action 等辅助项通常可忽略）
              </p>
              <p>
                <strong>Workers CPU：</strong>
                <code>
                  M_workers = W_train×α_train×prefetch×M_batch + W_val×α_val×prefetch×M_batch
                </code>
                <br />
                <span className="muted">
                  W_train = num-workers；W_val = min(2, num-workers)；prefetch=2；α_train≈28；α_val≈4
                </span>
              </p>
              <p>
                <strong>CPU 合计：</strong>
                <code>M_CPU ≈ M_main(2–5 GB) + M_workers + M_misc(~1 GB)</code>
              </p>
              <p>
                <strong>GPU：</strong>
                <code>M_GPU ≈ M_model + M_opt + B×M_sample×β</code>，β（激活倍数）常见 3–8
              </p>
            </div>
          </details>

          <table className="act-train-mem-table">
            <caption>降内存与变量对应</caption>
            <thead>
              <tr>
                <th>改法</th>
                <th>影响</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>减小 num-workers</td>
                <td>W_train / W_val 下降，M_workers 近似线性减少</td>
              </tr>
              <tr>
                <td>减小 batch-size</td>
                <td>M_batch 下降，worker 与 GPU batch 项同步减少</td>
              </tr>
              <tr>
                <td>num-workers = 0</td>
                <td>M_workers ≈ 0，但数据加载成为瓶颈</td>
              </tr>
              <tr>
                <td>减少相机数 K</td>
                <td>M_sample 线性减少</td>
              </tr>
            </tbody>
          </table>

          <details className="act-train-mem-details">
            <summary>实测参考（batch=32, workers=4, 3×480×640）</summary>
            <table className="act-train-mem-table compact">
              <tbody>
                <tr>
                  <th>单个训练 worker RSS</th>
                  <td>19–22 GB</td>
                </tr>
                <tr>
                  <th>验证 worker RSS</th>
                  <td>~2.7 GB</td>
                </tr>
                <tr>
                  <th>主进程 RSS</th>
                  <td>~4 GB</td>
                </tr>
                <tr>
                  <th>worker 合计</th>
                  <td>~87 GB</td>
                </tr>
                <tr>
                  <th>GPU 显存</th>
                  <td>~24 GB</td>
                </tr>
              </tbody>
            </table>
            <p className="muted act-train-mem-foot">
              公式估算与 ps / nvidia-smi 实测应在同一数量级；精确值以实测为准。详见{' '}
              <code>act_robot/docs/training_memory_estimation.md</code>
            </p>
          </details>
        </div>
      ) : null}
    </section>
  )
}
