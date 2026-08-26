import { useCallback, useEffect } from 'react'
import chatShell from '../features/chat/chatShell.html?raw'
import { mountChat } from '../features/chat/mountChat'
import { PageChrome } from '../components/PageChrome'
import { LegacyShell } from '../components/LegacyShell'
import { useLocale } from '../i18n/LocaleContext'
import { applyDomI18n } from '../i18n/runtime'
import '../styles/chat.css'

export function ChatPage() {
  const { locale } = useLocale()
  const onMount = useCallback(() => {
    mountChat()
  }, [])

  useEffect(() => {
    applyDomI18n(document.querySelector('.chat-page') || document)
  }, [locale])

  return (
    <div className="chat-page">
      <LegacyShell className="legacy-shell" html={chatShell} onMount={onMount} />
      <PageChrome />
    </div>
  )
}
