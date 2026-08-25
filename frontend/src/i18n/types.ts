export type Locale = 'zh' | 'en'
export type DocsLocale = 'zh' | 'en' | 'auto'

export const LOCALE_STORAGE_KEY = 'embody.locale'
export const DOCS_LOCALE_STORAGE_KEY = 'embody.docsLocale'

export function isLocale(v: unknown): v is Locale {
  return v === 'zh' || v === 'en'
}

export function isDocsLocale(v: unknown): v is DocsLocale {
  return v === 'zh' || v === 'en' || v === 'auto'
}

export function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (isLocale(raw)) return raw
  } catch {
    /* ignore */
  }
  return 'zh'
}

export function readStoredDocsLocale(): DocsLocale {
  try {
    const raw = localStorage.getItem(DOCS_LOCALE_STORAGE_KEY)
    if (isDocsLocale(raw)) return raw
  } catch {
    /* ignore */
  }
  return 'auto'
}

export function resolveDocsLocale(docs: DocsLocale, ui: Locale): Locale {
  return docs === 'auto' ? ui : docs
}
