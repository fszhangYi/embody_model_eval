import { useEffect, useMemo, useRef, useState } from 'react'
import type { BuildGuideResponse, ArmKinOverview } from './armApi'
import { MarkdownLite } from './MarkdownLite'

const OVERVIEW_ID = '__overview__'

function OverviewPanel({
  overview,
  steps,
}: {
  overview: ArmKinOverview | null
  steps: BuildGuideResponse['buildSteps']
}) {
  return (
    <>
      {overview ? (
        <section className="sensors-guide-card">
          <h4>模块依赖链（arm_kin）</h4>
          <div className="sensors-pipeline-flow">
            {overview.modules?.map((m, i) => (
              <div key={m.file} className="sensors-pipeline-node">
                <span className="sensors-pipeline-idx">{i + 1}</span>
                <strong>{m.file}</strong>
                <span className="muted">{m.layer}</span>
                <p>{m.role}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {steps?.length ? (
        <section className="sensors-guide-card">
          <h4>从 0 到可交付（12 步）</h4>
          <ol className="sensors-build-steps">
            {steps.map((s) => (
              <li key={s.step}>
                <div className="sensors-build-step-head">
                  <span className="sensors-build-step-num">步骤 {s.step}</span>
                  <code>{s.module}</code>
                  <strong>{s.title}</strong>
                </div>
                <p className="muted">验收：{s.acceptance}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {overview?.dhTable?.length ? (
        <section className="sensors-guide-card">
          <h4>当前 DH 参数表（运行时）</h4>
          <div className="sensors-md-table-wrap">
            <table className="sensors-md-table">
              <thead>
                <tr>
                  <th>关节</th>
                  <th>θ offset (rad)</th>
                  <th>d (m)</th>
                  <th>a (m)</th>
                  <th>α (rad)</th>
                </tr>
              </thead>
              <tbody>
                {overview.dhTable.map((r) => (
                  <tr key={r.joint}>
                    <td>J{r.joint}</td>
                    <td>{r.thetaOffsetRad.toFixed(4)}</td>
                    <td>{r.dM.toFixed(4)}</td>
                    <td>{r.aM.toFixed(4)}</td>
                    <td>{r.alphaRad.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {overview?.apiCatalog?.length ? (
        <section className="sensors-guide-card">
          <h4>对外 API 速查</h4>
          <div className="sensors-md-table-wrap">
            <table className="sensors-md-table">
              <thead>
                <tr>
                  <th>符号</th>
                  <th>模块</th>
                  <th>说明</th>
                  <th>单位</th>
                </tr>
              </thead>
              <tbody>
                {overview.apiCatalog.map((a) => (
                  <tr key={a.symbol}>
                    <td><code>{a.symbol}</code></td>
                    <td><code>{a.module}</code></td>
                    <td>{a.summary}</td>
                    <td>{a.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {overview?.install ? (
        <section className="sensors-guide-card">
          <h4>安装与测试命令</h4>
          <pre className="sensors-md-pre"><code>{overview.install.pipEditable}</code></pre>
          <pre className="sensors-md-pre"><code>{overview.install.pytest}</code></pre>
          <pre className="sensors-md-pre"><code>{overview.install.selfCheck}</code></pre>
        </section>
      ) : null}
    </>
  )
}

export function ArmFkIkBuildGuide({
  guide,
  overview,
  loading,
  error,
}: {
  guide: BuildGuideResponse | null
  overview: ArmKinOverview | null
  loading: boolean
  error: string | null
}) {
  const sections = guide?.sections || []
  const [activeId, setActiveId] = useState<string>(OVERVIEW_ID)
  const mainRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (sections.length && activeId !== OVERVIEW_ID && !sections.some((s) => s.id === activeId)) {
      setActiveId(OVERVIEW_ID)
    }
  }, [sections, activeId])

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [activeId])

  const activeSection = useMemo(
    () => sections.find((s) => s.id === activeId),
    [sections, activeId],
  )

  const steps = guide?.buildSteps || overview?.buildSteps || []

  if (loading) {
    return <p className="muted sensors-guide-loading">正在加载 arm_kin 构建说明…</p>
  }
  if (error && !guide?.ok) {
    return <p className="sensors-guide-error">{error}</p>
  }
  if (!guide?.ok) {
    return (
      <p className="sensors-guide-error">
        {guide?.error || error || '构建说明不可用'}
        {error ? <span className="muted"> · {error}</span> : null}
      </p>
    )
  }

  return (
    <div className="sensors-guide">
      <aside className="sensors-guide-nav" aria-label="文档目录">
        <p className="sensors-guide-nav-title">构建文档</p>
        <ul>
          <li>
            <button
              type="button"
              className={activeId === OVERVIEW_ID ? 'active' : ''}
              onClick={() => setActiveId(OVERVIEW_ID)}
            >
              工程总览
            </button>
          </li>
          {sections.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className={s.id === activeId ? 'active' : ''}
                onClick={() => setActiveId(s.id)}
              >
                {s.title}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <div className="sensors-guide-main" ref={mainRef}>
        <header className="sensors-guide-head">
          <h3>
            {activeId === OVERVIEW_ID
              ? guide.title || 'FK / IK 搭建思路'
              : activeSection?.title || guide.title}
          </h3>
          {guide.sourcePath ? (
            <p className="muted">
              源文件 <code>{guide.sourcePath}</code>
            </p>
          ) : null}
          {error ? <p className="muted sensors-guide-warn">{error}</p> : null}
        </header>

        {activeId === OVERVIEW_ID ? (
          <OverviewPanel overview={overview} steps={steps} />
        ) : activeSection ? (
          <section className="sensors-guide-card sensors-guide-doc" key={activeSection.id}>
            <MarkdownLite source={activeSection.body} />
          </section>
        ) : (
          <p className="muted">未找到对应章节</p>
        )}
      </div>
    </div>
  )
}
