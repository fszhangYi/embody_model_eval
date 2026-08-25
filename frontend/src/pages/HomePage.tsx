import { Link } from 'react-router-dom'
import { HomeParticles } from '../components/HomeParticles'
import { PageNav } from '../components/PageNav'
import { SettingsGear } from '../components/SettingsModal'
import { PAGES, type PageId } from '../config/pages'
import '../styles/home.css'

const MODULE_IDS: PageId[] = [
  'eval',
  'hub',
  'pipeline',
  'chat',
  'robots',
  'actPipeline',
  'sensors',
]

const PILLARS = [
  {
    title: '离线评测',
    text: '在同一坐标系叠画 current · GT · predict，量化 TCP 与关节误差，核对「下一时刻」策略是否合理。',
  },
  {
    title: '多机型与感知',
    text: 'SO-100 / EC616 / Koch 等 URDF 浏览，传感器卡片墙与内置 arm_kin 运动学联调。',
  },
  {
    title: '数据与 Agent',
    text: 'ACT 训练推理流水线、ComfyUI 式数据流演示，以及 Skills + 本地 / 远程 Agent Chat。',
  },
] as const

export function HomePage() {
  const modules = MODULE_IDS.map((id) => PAGES.find((p) => p.id === id)!).filter(Boolean)

  return (
    <div className="home-page">
      <div className="home-bg" aria-hidden="true">
        <div className="home-grid" />
        <div className="home-orb home-orb-a" />
        <div className="home-orb home-orb-b" />
        <HomeParticles />
      </div>

      <header className="home-header">
        <div className="home-header-brand">
          <img src="/assets/favicon.svg" alt="" width={36} height={36} className="home-logo" />
          <div>
            <h1>Embody Model Eval</h1>
            <p className="home-header-blurb">具身智能评测 · 机型 · 流水线 · 传感器一体控制台</p>
          </div>
        </div>
        <div className="home-header-actions">
          <SettingsGear />
          <PageNav />
        </div>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <p className="home-kicker">项目总览</p>
          <h2 className="home-hero-title">
            把策略回放、多机型资产与训练流水线
            <span className="home-hero-accent">收进同一工作台</span>
          </h2>
          <p className="home-hero-lead">
            Embody Model Eval 面向具身策略与模型的功能评测：本地静态托管 + Python 标准库 API，支持 Cookie
            鉴权、离线 Three.js 可视化，以及 ACT / Skills Agent 联调。评测页与其它模块平级，从下方入口进入。
          </p>
          <div className="home-hero-ctas">
            <Link className="home-cta primary" to="/eval">
              进入单轨迹评测
            </Link>
            <Link className="home-cta ghost" to="/hub">
              查看 Hub 汇总
            </Link>
          </div>
        </section>

        <section className="home-pillars" aria-label="能力支柱">
          {PILLARS.map((p) => (
            <article key={p.title} className="home-pillar">
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </article>
          ))}
        </section>

        <section className="home-modules" aria-labelledby="home-modules-title">
          <div className="home-section-head">
            <h2 id="home-modules-title">功能模块</h2>
            <p className="muted">与顶栏「页面」菜单同一套路由，可用 Alt+1…N 直达</p>
          </div>
          <div className="home-module-grid">
            {modules.map((p, i) => (
              <Link key={p.id} className="home-module-card" to={p.path}>
                <span className="home-module-idx" aria-hidden="true">
                  {String(i + 2).padStart(2, '0')}
                </span>
                <span className="home-module-body">
                  <span className="home-module-title">{p.label}</span>
                  <span className="home-module-desc">{p.desc}</span>
                </span>
                <span className="home-module-path">{p.path}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="home-stack" aria-labelledby="home-stack-title">
          <div className="home-section-head">
            <h2 id="home-stack-title">技术栈一览</h2>
            <p className="muted">浏览器端不依赖外网 CDN；服务端以 stdlib 为主</p>
          </div>
          <ul className="home-stack-list">
            <li>
              <strong>前端</strong>
              <span>React SPA · Three.js / Chart.js / urdf-loader（vendor 离线）</span>
            </li>
            <li>
              <strong>服务</strong>
              <span>
                <code>scripts/agent_server.py</code>：静态托管 + <code>/api/*</code> + Cookie 会话鉴权
              </span>
            </li>
            <li>
              <strong>数据</strong>
              <span>
                <code>data/</code> episode JSON · Hub 汇总 · ACT → embody 转换
              </span>
            </li>
            <li>
              <strong>机型</strong>
              <span>
                <code>config/robots.json</code> + URDF mesh · 内置 <code>arm_kin</code>
              </span>
            </li>
          </ul>
        </section>
      </main>

      <footer className="home-footer">
        <span>Embody Model Eval</span>
        <span className="home-footer-dot" aria-hidden="true">
          ·
        </span>
        <span>本地评测控制台</span>
      </footer>
    </div>
  )
}
