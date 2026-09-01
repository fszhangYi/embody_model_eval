import { Link } from 'react-router-dom'
import { HomeParticles } from '../components/HomeParticles'
import { PageNav } from '../components/PageNav'
import { SettingsGear } from '../components/SettingsModal'
import { useLocale } from '../i18n/LocaleContext'
import type { PageId } from '../config/pages'
import { useSensorsEmbed } from '../prefs/SensorsEmbedContext'
import '../styles/home.css'

const MODULE_IDS: PageId[] = [
  'eval',
  'hub',
  'pipeline',
  'chat',
  'robots',
  'actPipeline',
  'modelAnalysis',
  'datasetConverter',
  'pi05Pipeline',
  'pi05Analysis',
  'pi05Setup',
  'sensors',
]

export function HomePage() {
  const { m, pages } = useLocale()
  const { reachability } = useSensorsEmbed()
  const home = m.home
  const modules = MODULE_IDS.map((id) => pages.find((p) => p.id === id)!).filter(Boolean)
  const sensorsBlocked = reachability === 'fail'

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
            <p className="home-header-blurb">{home.blurb}</p>
          </div>
        </div>
        <div className="home-header-actions">
          <SettingsGear />
          <PageNav />
        </div>
      </header>

      <main className="home-main">
        <section className="home-hero">
          <p className="home-kicker">{home.kicker}</p>
          <h2 className="home-hero-title">
            {home.heroTitleBefore}
            <span className="home-hero-accent">{home.heroTitleAccent}</span>
          </h2>
          <p className="home-hero-lead">{home.heroLead}</p>
          <div className="home-hero-ctas">
            <Link className="home-cta primary" to="/eval">
              {home.ctaEval}
            </Link>
            <Link className="home-cta ghost" to="/hub">
              {home.ctaHub}
            </Link>
          </div>
        </section>

        <section className="home-pillars" aria-label={home.pillarsAria}>
          {home.pillars.map((p) => (
            <article key={p.title} className="home-pillar">
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </article>
          ))}
        </section>

        <section className="home-modules" aria-labelledby="home-modules-title">
          <div className="home-section-head">
            <h2 id="home-modules-title">{home.modulesTitle}</h2>
            <p className="muted">{home.modulesHint}</p>
          </div>
          <div className="home-module-grid">
            {modules.map((p, i) => {
              const blocked = p.id === 'sensors' && sensorsBlocked
              const body = (
                <>
                  <span className="home-module-idx" aria-hidden="true">
                    {String(i + 2).padStart(2, '0')}
                  </span>
                  <span className="home-module-body">
                    <span className="home-module-title">{p.label}</span>
                    <span className="home-module-desc">{p.desc}</span>
                  </span>
                  <span className="home-module-path">{p.path}</span>
                </>
              )
              if (blocked) {
                return (
                  <span
                    key={p.id}
                    className="home-module-card disabled"
                    aria-disabled="true"
                    title={m.settings.sensors.unreachableHint}
                  >
                    {body}
                  </span>
                )
              }
              return (
                <Link key={p.id} className="home-module-card" to={p.path}>
                  {body}
                </Link>
              )
            })}
          </div>
        </section>

        <section className="home-stack" aria-labelledby="home-stack-title">
          <div className="home-section-head">
            <h2 id="home-stack-title">{home.stackTitle}</h2>
            <p className="muted">{home.stackHint}</p>
          </div>
          <ul className="home-stack-list">
            <li>
              <strong>{home.stackFrontend}</strong>
              <span>{home.stackFrontendBody}</span>
            </li>
            <li>
              <strong>{home.stackServer}</strong>
              <span>{home.stackServerBody}</span>
            </li>
            <li>
              <strong>{home.stackData}</strong>
              <span>{home.stackDataBody}</span>
            </li>
            <li>
              <strong>{home.stackRobots}</strong>
              <span>{home.stackRobotsBody}</span>
            </li>
          </ul>
        </section>
      </main>

      <footer className="home-footer">
        <span>Embody Model Eval</span>
        <span className="home-footer-dot" aria-hidden="true">
          ·
        </span>
        <span>{home.footerTag}</span>
      </footer>
    </div>
  )
}
