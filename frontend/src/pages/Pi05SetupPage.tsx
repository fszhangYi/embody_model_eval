import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { PageChrome } from '../components/PageChrome'
import { useLocale } from '../i18n/LocaleContext'
import { t } from '../i18n/runtime'
import { analyzePi05, type Pi05AnalyzeResult } from '../features/pi05/api'
import { Pi05RouteChrome } from '../features/pi05/Pi05RouteChrome'
import {
  resolveInitialPi05Route,
  writeStoredPi05Route,
  type Pi05RouteMode,
} from '../features/pi05/routeMode'
import '../styles/act-pipeline.css'
import '../styles/pi05-setup.css'
import '../styles/pi05-route.css'

function ok(v: unknown) {
  return v === true || v === 'true'
}

const DIFF_ROWS: Array<{ id: string; actKey: string; pi05Key: string }> = [
  { id: 'stack', actKey: 'pi05Setup.compare.act.stack', pi05Key: 'pi05Setup.compare.pi05.stack' },
  { id: 'data', actKey: 'pi05Setup.compare.act.data', pi05Key: 'pi05Setup.compare.pi05.data' },
  { id: 'norm', actKey: 'pi05Setup.compare.act.norm', pi05Key: 'pi05Setup.compare.pi05.norm' },
  { id: 'hw', actKey: 'pi05Setup.compare.act.hw', pi05Key: 'pi05Setup.compare.pi05.hw' },
  { id: 'serve', actKey: 'pi05Setup.compare.act.serve', pi05Key: 'pi05Setup.compare.pi05.serve' },
]

export function Pi05SetupPage() {
  const { locale } = useLocale()
  const [route, setRoute] = useState<Pi05RouteMode>(() => resolveInitialPi05Route())
  const [data, setData] = useState<Pi05AnalyzeResult | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    writeStoredPi05Route(route)
    setErr('')
    analyzePi05(undefined, undefined, undefined, route)
      .then((r) => {
        if (!r.ok) throw new Error(r.error || 'failed')
        setData(r)
      })
      .catch((e: Error) => setErr(e.message))
  }, [route])

  const checks = data?.checks || {}
  const paths = data?.paths || {}
  const fullFt = route === 'full_ft'

  const healthRows: Array<{ key: string; label: string; pathKey?: string }> = fullFt
    ? [
        { key: 'pi05Exists', label: t('pi05Setup.check.project'), pathKey: 'pi05Root' },
        { key: 'basePytorchExists', label: t('pi05Setup.check.basePytorch'), pathKey: 'baseCkptPytorch' },
        { key: 'gpuEnoughForFullFt', label: t('pi05Setup.check.gpu8') },
        { key: 'fullFtConfigExists', label: t('pi05Setup.check.fullFtConfig'), pathKey: 'fullFtConfig' },
        { key: 'trainFullFtScriptExists', label: t('pi05Setup.check.trainFullFt'), pathKey: 'trainFullFtScript' },
        { key: 'lerobotExists', label: t('pi05Setup.check.lerobot'), pathKey: 'lerobotHome' },
      ]
    : [
        { key: 'pi05Exists', label: t('pi05Setup.check.project'), pathKey: 'pi05Root' },
        { key: 'actRobotExists', label: t('pi05Setup.check.actData'), pathKey: 'actRobotRoot' },
        { key: 'baseJaxExists', label: t('pi05Setup.check.baseCkpt'), pathKey: 'baseCkptJax' },
        { key: 'lerobotExists', label: t('pi05Setup.check.lerobot'), pathKey: 'lerobotHome' },
      ]

  return (
    <div className="act-pipeline-page pi05-setup-page" data-locale={locale} data-route={route}>
      <header className="act-header">
        <div className="act-header-brand">
          <h1>{t('pi05Setup.title')}</h1>
          <p className="act-sub">{fullFt ? t('pi05Setup.subtitleFullFt') : t('pi05Setup.subtitle')}</p>
        </div>
        <div className="act-header-actions">
          <PageChrome className="act-header-actions-inner" />
        </div>
      </header>

      <div className="act-body pi05s-body">
        <Pi05RouteChrome
          route={route}
          onChange={(m) => {
            setRoute(m)
          }}
        />

        {fullFt ? (
          <div className="pi05-route-hero">
            <p className="pi05-route-hero-kicker">{t('pi05Setup.hero.kicker')}</p>
            <h2>{t('pi05Setup.hero.title')}</h2>
            <p className="muted">{t('pi05Setup.hero.lead')}</p>
            <ul className="pi05-route-hero-points">
              <li>{t('pi05Setup.hero.p1')}</li>
              <li>{t('pi05Setup.hero.p2')}</li>
              <li>{t('pi05Setup.hero.p3')}</li>
            </ul>
          </div>
        ) : (
          <div className="pi05-route-hero secondary">
            <p className="pi05-route-hero-kicker">{t('pi05Setup.heroSmoke.kicker')}</p>
            <h2>{t('pi05Setup.heroSmoke.title')}</h2>
            <p className="muted">{t('pi05Setup.heroSmoke.lead')}</p>
          </div>
        )}

        {err ? <div className="act-banner err">{err}</div> : null}
        {data?.healthHint ? <div className="act-banner info">{data.healthHint}</div> : null}

        <div className="pi05s-layout">
          <aside className="pi05s-aside" aria-label={t('pi05Setup.healthTitle')}>
            <div className="pi05s-section-label">{t('pi05Setup.healthTitle')}</div>
            <ul className="pi05s-health-list">
              {healthRows.map((r) => (
                <li key={r.key} className={`pi05s-health-row${ok(checks[r.key]) ? ' ok' : ' bad'}`}>
                  <span className="pi05s-health-dot" aria-hidden="true" />
                  <div className="pi05s-health-meta">
                    <span className="pi05s-health-name">{r.label}</span>
                    <code className="pi05s-health-path" title={r.pathKey ? String(paths[r.pathKey] || '') : ''}>
                      {r.key === 'gpuEnoughForFullFt'
                        ? `${t('pi05Setup.check.gpuCount')}: ${String(checks.gpuCount ?? '—')}`
                        : r.pathKey
                          ? String(paths[r.pathKey] || '—')
                          : '—'}
                    </code>
                  </div>
                </li>
              ))}
            </ul>

            <div className="pi05s-aside-docs">
              <div className="pi05s-section-label">{t('pi05Setup.docsTitle')}</div>
              <div className="pi05s-doc-lines">
                {fullFt ? (
                  <div>
                    <span className="muted">{t('pi05Setup.doc.fullFt')}</span>
                    <code>{String(paths.docsFullFt || 'docs/tonglu_mlu_full_ft_reproduce.md')}</code>
                  </div>
                ) : null}
                <div>
                  <span className="muted">{t('pi05Setup.doc.install')}</span>
                  <code>{String(paths.docsInstall || 'docs/installation.md')}</code>
                </div>
                <div>
                  <span className="muted">{t('pi05Setup.doc.issues')}</span>
                  <code>{String(paths.docsIssues || 'docs/issues.md')}</code>
                </div>
              </div>
            </div>
          </aside>

          <section className="pi05s-main" aria-label={t('pi05Setup.diffTitle')}>
            <div className="pi05s-section-label">{t('pi05Setup.diffTitle')}</div>
            <div className="pi05s-compare-table" role="table">
              <div className="pi05s-compare-head" role="row">
                <span role="columnheader">{t('pi05Setup.compare.dim')}</span>
                <span role="columnheader">{t('pi05Setup.compare.act')}</span>
                <span role="columnheader">{t('pi05Setup.compare.pi05')}</span>
              </div>
              {DIFF_ROWS.map((row) => (
                <div key={row.id} className="pi05s-compare-row" role="row">
                  <span role="cell">{t(`pi05Setup.compare.dim.${row.id}`)}</span>
                  <span role="cell">{t(row.actKey)}</span>
                  <span role="cell">
                    {fullFt ? t(`${row.pi05Key}Full`) : t(row.pi05Key)}
                  </span>
                </div>
              ))}
            </div>

            <nav className="pi05s-jumps" aria-label={t('pi05Setup.jumpAria')}>
              <Link to={`/pi05-pipeline?route=${route}`}>{t('pi05Setup.linkPipeline')}</Link>
              <Link to={`/pi05-analysis?route=${route}`}>{t('pi05Setup.linkAnalysis')}</Link>
              <Link to="/dataset-converter">{t('pi05Setup.linkConverter')}</Link>
            </nav>
            <p className="pi05s-footer muted">{t('pi05Setup.footerHint')}</p>
          </section>
        </div>
      </div>
    </div>
  )
}
