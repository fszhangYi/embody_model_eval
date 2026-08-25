import { useCallback } from 'react'
import robotsShell from '../features/robots/robotsShell.html?raw'
import { mountRobots } from '../features/robots/mountRobots'
import { PageChrome } from '../components/PageChrome'
import { LegacyShell } from '../components/LegacyShell'
import { useLocale } from '../i18n/LocaleContext'
import { applyDomI18n } from '../i18n/runtime'
import '../styles/robots.css'

export function RobotsPage() {
  const { locale } = useLocale()
  const onMount = useCallback(() => {
    applyDomI18n(document.querySelector('.robots-page') || document)
    mountRobots()
  }, [locale])

  return (
    <div className="robots-page">
      <LegacyShell className="legacy-shell" html={robotsShell} onMount={onMount} />
      <PageChrome />
    </div>
  )
}
