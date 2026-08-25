import type { ArmKinOverview } from './armApi'

export function ArmProjectPanel({
  overview,
  loading,
  error,
}: {
  overview: ArmKinOverview | null
  loading: boolean
  error: string | null
}) {
  if (loading) return <p className="muted">正在加载 arm_kin 模块信息…</p>
  if (error) return <p className="sensors-guide-error">{error}</p>
  if (!overview?.ok) {
    return <p className="sensors-guide-error">{overview?.importError || 'arm_kin 模块不可用'}</p>
  }

  return (
    <div className="sensors-project">
      <section className="sensors-guide-card">
        <h4>集成路径</h4>
        <table>
          <tbody>
            <tr>
              <th>embody 根目录</th>
              <td><code>{overview.embodyRoot}</code></td>
            </tr>
            <tr>
              <th>arm_kin 根目录</th>
              <td><code>{overview.armKinRoot}</code></td>
            </tr>
            <tr>
              <th>robot.xml</th>
              <td>
                <code>{overview.paths?.robotXml}</code>
                {overview.paths?.robotXmlExists ? ' ✓' : ' ✗'}
              </td>
            </tr>
            <tr>
              <th>构建说明</th>
              <td>
                <code>{overview.paths?.buildGuide}</code>
                {overview.paths?.buildGuideExists ? ' ✓' : ' ✗'}
              </td>
            </tr>
            <tr>
              <th>回归测试</th>
              <td><code>{overview.paths?.tests}</code></td>
            </tr>
          </tbody>
        </table>
        {overview.integrationNote ? (
          <p className="muted sensors-project-note">{overview.integrationNote}</p>
        ) : null}
      </section>

      {overview.dependencies?.length ? (
        <section className="sensors-guide-card">
          <h4>Python 依赖（pyproject.toml）</h4>
          <ul className="sensors-chip-list">
            {overview.dependencies.map((d) => (
              <li key={d.name + d.spec}>
                <code>{d.name}</code>
                <span className="muted">{d.spec}</span>
                {d.dev ? <span className="sensors-tag-dev">dev</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {overview.packageFiles?.length ? (
        <section className="sensors-guide-card">
          <h4>包内模块文件</h4>
          <ul className="sensors-file-list">
            {overview.packageFiles.map((f) => (
              <li key={f.path}>
                <code>{f.path}</code>
                <span className="muted">{f.size} B</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {overview.tree?.length ? (
        <section className="sensors-guide-card">
          <h4>目录树（节选）</h4>
          <ul className="sensors-file-list sensors-file-tree">
            {overview.tree.map((n) => (
              <li key={n.path} className={n.type === 'dir' ? 'dir' : 'file'}>
                <code>{n.path}</code>
                {n.size != null ? <span className="muted">{n.size} B</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
