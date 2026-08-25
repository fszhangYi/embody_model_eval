import { useCallback } from 'react'
import hubShell from '../features/hub/hubShell.html?raw'
import { mountHub } from '../features/hub/mountHub'
import { PageChrome } from '../components/PageChrome'
import { LegacyShell } from '../components/LegacyShell'
import { useLocale } from '../i18n/LocaleContext'
import { applyDomI18n } from '../i18n/runtime'
import '../styles/hub.css'

export function HubPage() {
  const { locale } = useLocale()
  const onMount = useCallback(() => {
    applyDomI18n(document.querySelector('.hub-page') || document)
    mountHub()
  }, [locale])

  return (
    <div className="hub-page">
      <LegacyShell className="legacy-shell" html={hubShell} onMount={onMount} />
      <PageChrome />
    </div>
  )
}
