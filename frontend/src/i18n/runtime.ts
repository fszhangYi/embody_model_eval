import { formatMessage, lookupMessage } from './messages'
import { pageStrings } from './pageStrings'
import { readStoredLocale, type Locale } from './types'

type LocaleListener = (locale: Locale) => void

let currentLocale: Locale = readStoredLocale()
const listeners = new Set<LocaleListener>()

let zhReverse: Map<string, string> | null = null

function getZhReverse(): Map<string, string> {
  if (!zhReverse) {
    zhReverse = new Map()
    for (const [key, val] of Object.entries(pageStrings.zh)) {
      if (val && !zhReverse.has(val)) zhReverse.set(val, key)
    }
  }
  return zhReverse
}

export function getLocale(): Locale {
  return currentLocale
}

/** Keep non-React (legacy mount*) code in sync with LocaleProvider. */
export function syncLocale(locale: Locale): void {
  if (currentLocale === locale) return
  currentLocale = locale
  listeners.forEach((fn) => {
    try {
      fn(locale)
    } catch {
      /* ignore */
    }
  })
}

export function onLocaleChange(fn: LocaleListener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function t(path: string, vars?: Record<string, string | number>): string {
  const raw = lookupMessage(currentLocale, path) ?? lookupMessage('zh', path) ?? path
  return formatMessage(raw, vars)
}

/**
 * Translate a Chinese UI string that exists in pageStrings.
 * Returns the input unchanged when no catalog match (or already Chinese locale).
 */
export function trText(text: string): string {
  if (!text || currentLocale === 'zh') return text
  const key = getZhReverse().get(text)
  if (!key) return text
  return t(key)
}

/** Apply `[data-i18n]` / `[data-i18n-html]` / `[data-i18n-attr]` / `[data-i18n-title]` / `[data-i18n-placeholder]` / `[data-i18n-aria]`. */
export function applyDomI18n(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n')
    if (!key) return
    const attr = el.getAttribute('data-i18n-attr')
    const text = t(key)
    if (attr) el.setAttribute(attr, text)
    else if (el.hasAttribute('data-i18n-html')) el.innerHTML = text
    else el.textContent = text
  })
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title')
    if (key) el.setAttribute('title', t(key))
  })
  root.querySelectorAll<HTMLElement>('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder')
    if (key) el.setAttribute('placeholder', t(key))
  })
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    const key = el.getAttribute('data-i18n-aria')
    if (key) el.setAttribute('aria-label', t(key))
  })
}
