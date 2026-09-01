import { useCallback, useEffect, useRef, useState } from 'react'
import { PageChrome } from '../components/PageChrome'
import { useLocale } from '../i18n/LocaleContext'
import { t } from '../i18n/runtime'
import type { Locale } from '../i18n/types'
import { useAppearance } from '../prefs/AppearanceContext'
import type { ThemePref } from '../prefs/appearance'
import { useSensorsEmbed } from '../prefs/SensorsEmbedContext'
import { sensorsEmbedOrigin } from '../prefs/sensorsEmbed'
import '../styles/sensors.css'

type SensorsEmbedPrefs = {
  locale: Locale
  theme: ThemePref
}

function buildSensorsEmbedUrl(baseUrl: string, { locale, theme }: SensorsEmbedPrefs): string {
  const url = new URL(baseUrl)
  url.searchParams.set('locale', locale)
  url.searchParams.set('theme', theme)
  return url.toString()
}

function postSensorsEmbedPrefs(
  target: Window | null | undefined,
  prefs: SensorsEmbedPrefs,
  targetOrigin: string,
) {
  if (!target) return
  target.postMessage(
    {
      source: 'sensors-view-host',
      type: 'embed-prefs',
      locale: prefs.locale,
      theme: prefs.theme,
    },
    targetOrigin,
  )
}

function isSensorsEmbedMessage(data: unknown): data is { source: string; type?: string } {
  return Boolean(data && typeof data === 'object' && (data as { source?: string }).source === 'sensors-view')
}

export function SensorsPage() {
  const { locale, m } = useLocale()
  const { theme } = useAppearance()
  const { url: baseUrl, reachability, reachMessage } = useSensorsEmbed()
  const targetOrigin = sensorsEmbedOrigin(baseUrl)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const prefsRef = useRef<SensorsEmbedPrefs>({ locale, theme })
  prefsRef.current = { locale, theme }
  const originRef = useRef(targetOrigin)
  originRef.current = targetOrigin

  // Remount iframe when base URL changes; locale/theme after that go via postMessage.
  const [iframeSrc, setIframeSrc] = useState(() =>
    buildSensorsEmbedUrl(baseUrl, { locale, theme }),
  )
  useEffect(() => {
    setIframeSrc(buildSensorsEmbedUrl(baseUrl, prefsRef.current))
  }, [baseUrl])

  const pushPrefs = useCallback(() => {
    postSensorsEmbedPrefs(iframeRef.current?.contentWindow, prefsRef.current, originRef.current)
  }, [])

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== originRef.current) return
      if (!isSensorsEmbedMessage(event.data)) return
      const type = event.data.type
      if (type !== 'embed-ready' && type !== 'embed-request-prefs') return
      postSensorsEmbedPrefs(event.source as Window | null, prefsRef.current, event.origin)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  useEffect(() => {
    pushPrefs()
  }, [locale, theme, pushPrefs])

  const unreachable = reachability === 'fail'

  return (
    <div className="sensors-page">
      {!unreachable ? (
        <iframe
          key={baseUrl}
          ref={iframeRef}
          className="sensors-embed"
          src={iframeSrc}
          title={t('sensors.title')}
          allow="fullscreen; clipboard-read; clipboard-write"
          referrerPolicy="no-referrer-when-downgrade"
        />
      ) : (
        <div className="sensors-unreachable" role="status">
          <p className="sensors-unreachable-title">{m.settings.sensors.statusFail}</p>
          <p className="sensors-unreachable-msg">
            {reachMessage || m.settings.sensors.unreachableHint}
          </p>
          <p className="sensors-unreachable-url muted">{baseUrl}</p>
        </div>
      )}
      <PageChrome />
    </div>
  )
}
