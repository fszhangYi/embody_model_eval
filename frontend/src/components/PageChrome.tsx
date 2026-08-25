import { PageNav } from './PageNav'
import { SettingsGear } from './SettingsModal'

/** Floating page chrome: settings (language) + page switcher. */
export function PageChrome({ className = 'page-nav-floating' }: { className?: string }) {
  return (
    <div className={className}>
      <SettingsGear />
      <PageNav />
    </div>
  )
}
