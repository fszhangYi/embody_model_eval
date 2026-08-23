import { useCallback } from 'react'
import chatShell from '../features/chat/chatShell.html?raw'
import { mountChat } from '../features/chat/mountChat'
import { PageNav } from '../components/PageNav'
import { LegacyShell } from '../components/LegacyShell'
import '../styles/chat.css'

export function ChatPage() {
  const onMount = useCallback(() => {
    mountChat()
  }, [])

  return (
    <div className="chat-page">
      <LegacyShell className="legacy-shell" html={chatShell} onMount={onMount} />
      <div className="page-nav-floating">
        <PageNav />
      </div>
    </div>
  )
}
