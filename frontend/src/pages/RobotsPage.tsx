import { useCallback } from 'react'
import robotsShell from '../features/robots/robotsShell.html?raw'
import { mountRobots } from '../features/robots/mountRobots'
import { PageNav } from '../components/PageNav'
import { LegacyShell } from '../components/LegacyShell'
import '../styles/robots.css'

export function RobotsPage() {
  const onMount = useCallback(() => {
    mountRobots()
  }, [])

  return (
    <div className="robots-page">
      <LegacyShell className="legacy-shell" html={robotsShell} onMount={onMount} />
      <div className="page-nav-floating">
        <PageNav />
      </div>
    </div>
  )
}
