import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { formatMessage, lookupMessage, messages, type MessageTree } from './messages'
import {
  DOCS_LOCALE_STORAGE_KEY,
  LOCALE_STORAGE_KEY,
  readStoredDocsLocale,
  readStoredLocale,
  resolveDocsLocale,
  type DocsLocale,
  type Locale,
} from './types'
import { PAGES, type PageDef, type PageId } from '../config/pages'

type LocaleContextValue = {
  locale: Locale
  docsLocale: DocsLocale
  effectiveDocsLocale: Locale
  setLocale: (locale: Locale) => void
  setDocsLocale: (docs: DocsLocale) => void
  t: (path: string, vars?: Record<string, string | number>) => string
  m: MessageTree
  pages: PageDef[]
  pageLabel: (id: PageId) => PageDef
}

const LocaleContext = createContext<LocaleContextValue | null>(null)

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale())
  const [docsLocale, setDocsLocaleState] = useState<DocsLocale>(() => readStoredDocsLocale())

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next)
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const setDocsLocale = useCallback((next: DocsLocale) => {
    setDocsLocaleState(next)
    try {
      localStorage.setItem(DOCS_LOCALE_STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
  }, [locale])

  const effectiveDocsLocale = resolveDocsLocale(docsLocale, locale)
  const m = messages[locale]

  const t = useCallback(
    (path: string, vars?: Record<string, string | number>) => {
      const raw = lookupMessage(locale, path) ?? lookupMessage('zh', path) ?? path
      return formatMessage(raw, vars)
    },
    [locale],
  )

  const pages = useMemo<PageDef[]>(
    () =>
      PAGES.map((p) => {
        const loc = m.pages[p.id]
        return loc ? { ...p, label: loc.label, short: loc.short, desc: loc.desc } : p
      }),
    [m],
  )

  const pageLabel = useCallback(
    (id: PageId) => pages.find((p) => p.id === id) ?? pages[0],
    [pages],
  )

  const value = useMemo(
    () => ({
      locale,
      docsLocale,
      effectiveDocsLocale,
      setLocale,
      setDocsLocale,
      t,
      m,
      pages,
      pageLabel,
    }),
    [
      locale,
      docsLocale,
      effectiveDocsLocale,
      setLocale,
      setDocsLocale,
      t,
      m,
      pages,
      pageLabel,
    ],
  )

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider')
  return ctx
}
