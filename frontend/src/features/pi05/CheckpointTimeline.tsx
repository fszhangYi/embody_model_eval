import type { Pi05CkptRun } from './api'
import { formatBytesLabel } from './WeightViz'

function parseStepNum(name: string): number | null {
  const m = name.match(/(\d+)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

export function Pi05CheckpointTimeline({
  runs,
  empty,
  stepsLabel,
  selectedPath,
  onSelectStep,
  inspecting,
}: {
  runs: Pi05CkptRun[]
  empty: string
  stepsLabel: (n: number) => string
  selectedPath?: string
  onSelectStep?: (path: string) => void
  inspecting?: boolean
}) {
  if (!runs.length) {
    return <div className="pi05a-empty muted">{empty}</div>
  }

  return (
    <div className="pi05a-ckpt-list">
      {runs.map((run) => {
        const nums = run.steps
          .map((s) => parseStepNum(s.name))
          .filter((n): n is number => n != null)
        const max = nums.length ? Math.max(...nums) : 0
        const min = nums.length ? Math.min(...nums) : 0
        const span = Math.max(1, max - min)

        return (
          <article key={run.path} className="pi05a-ckpt-card">
            <header className="pi05a-ckpt-head">
              <div>
                <strong>
                  {run.project}
                  <span className="pi05a-ckpt-sep">/</span>
                  {run.exp}
                </strong>
                <code title={run.path}>{run.path}</code>
                <div className="pi05a-ckpt-flags">
                  {run.hasModel ? <span className="pi05a-flag ok">safetensors</span> : null}
                  {run.totalBytes ? (
                    <span className="pi05a-flag">{formatBytesLabel(run.totalBytes)}</span>
                  ) : null}
                </div>
              </div>
              <span className="pi05a-count">{stepsLabel(run.stepCount)}</span>
            </header>

            {run.steps.length === 0 ? (
              <div className="pi05a-ckpt-rail empty">
                <span className="muted">—</span>
              </div>
            ) : (
              <div className="pi05a-ckpt-rail" role="list">
                <div className="pi05a-ckpt-track" aria-hidden="true" />
                {run.steps.map((step) => {
                  const n = parseStepNum(step.name)
                  const pct = n == null ? 50 : ((n - min) / span) * 100
                  const active = step.path === selectedPath
                  return (
                    <button
                      key={step.path}
                      type="button"
                      className={`pi05a-ckpt-dot${active ? ' active' : ''}`}
                      role="listitem"
                      style={{ left: `${Math.min(100, Math.max(0, pct))}%` }}
                      title={`${step.name}\n${step.path}`}
                      disabled={inspecting}
                      onClick={() => onSelectStep?.(step.path)}
                    >
                      <span>{step.name}</span>
                    </button>
                  )
                })}
              </div>
            )}

            {run.steps.length ? (
              <div className="pi05a-ckpt-chips">
                {run.steps.slice(-8).map((s) => (
                  <button
                    key={s.path}
                    type="button"
                    className={`pi05a-ckpt-chip${s.path === selectedPath ? ' active' : ''}`}
                    disabled={inspecting}
                    onClick={() => onSelectStep?.(s.path)}
                  >
                    {s.name}
                    {s.hasModel ? ' · wt' : ''}
                  </button>
                ))}
              </div>
            ) : null}
          </article>
        )
      })}
    </div>
  )
}
