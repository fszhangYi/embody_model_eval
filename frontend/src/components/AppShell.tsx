import { Outlet } from 'react-router-dom'
import { PageNav } from './PageNav'

interface AppShellProps {
  showNav?: boolean
  className?: string
}

export function AppShell({ showNav = true, className }: AppShellProps) {
  return (
    <div className={className}>
      {showNav ? (
        <div className="react-page-nav-slot">
          <PageNav />
        </div>
      ) : null}
      <Outlet />
    </div>
  )
}
