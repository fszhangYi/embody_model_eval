import type { Pi05RouteMode } from './routeMode'
import { t } from '../../i18n/runtime'

export function Pi05RouteChrome({
  route,
  onChange,
}: {
  route: Pi05RouteMode
  onChange: (mode: Pi05RouteMode) => void
}) {
  return (
    <div className="pi05-route-chrome" role="group" aria-label={t('pi05.route.aria')}>
      <button
        type="button"
        className={`pi05-route-seg${route === 'full_ft' ? ' active' : ''}`}
        onClick={() => onChange('full_ft')}
      >
        <strong>{t('pi05.route.fullFt')}</strong>
        <span>{t('pi05.route.fullFtHint')}</span>
      </button>
      <button
        type="button"
        className={`pi05-route-seg${route === 'smoke_lora' ? ' active' : ''}`}
        onClick={() => onChange('smoke_lora')}
      >
        <strong>{t('pi05.route.smoke')}</strong>
        <span>{t('pi05.route.smokeHint')}</span>
      </button>
    </div>
  )
}
