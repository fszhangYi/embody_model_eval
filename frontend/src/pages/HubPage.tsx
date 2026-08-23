import { useCallback } from 'react'
import hubShell from '../features/hub/hubShell.html?raw'
import { mountHub } from '../features/hub/mountHub'
import { PageNav } from '../components/PageNav'
import { LegacyShell } from '../components/LegacyShell'
import '../styles/hub.css'

export function HubPage() {
  const onMount = useCallback(() => {
    mountHub()
  }, [])

  return (
    <div className="hub-page">
      <LegacyShell className="legacy-shell" html={hubShell} onMount={onMount} />
      <div className="page-nav-floating">
        <PageNav />
      </div>
    </div>
  )
}
