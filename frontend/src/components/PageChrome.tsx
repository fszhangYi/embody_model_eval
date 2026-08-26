import { PageNav } from './PageNav'

/** Floating page chrome: page switcher only (settings live on the home overview). */
export function PageChrome({ className = 'page-nav-floating' }: { className?: string }) {
  return (
    <div className={className}>
      <PageNav />
    </div>
  )
}
