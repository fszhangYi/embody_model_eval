import { useEffect } from 'react'
import { Chart, registerables } from 'chart.js'
import evalShell from '../features/eval/evalShell.html?raw'
import { bootstrapEval, refreshEvalLocale } from '../features/eval/runEval'
import { PageChrome } from '../components/PageChrome'
import { useLocale } from '../i18n/LocaleContext'
import { applyDomI18n, t } from '../i18n/runtime'
import '../styles/eval.css'

Chart.register(...registerables)
;(globalThis as typeof globalThis & { Chart: typeof Chart }).Chart = Chart

export function EvalPage() {
  const { locale } = useLocale()

  useEffect(() => {
    let cancelled = false
    applyDomI18n(document.querySelector('.eval-page') || document)
    bootstrapEval().catch((err: Error) => {
      if (cancelled) return
      const sub = document.getElementById('subtitle')
      if (sub) sub.textContent = t('eval.loadFail', { msg: err.message })
      console.error(err)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    applyDomI18n(document.querySelector('.eval-page') || document)
    refreshEvalLocale()
  }, [locale])

  return (
    <div className="eval-page">
      <div dangerouslySetInnerHTML={{ __html: evalShell }} />
      <div className="eval-page-nav">
        <PageChrome className="eval-page-nav-inner" />
      </div>
    </div>
  )
}
