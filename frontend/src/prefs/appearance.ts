export type ThemePref = 'system' | 'dark' | 'light'
export type DensityPref = 'comfortable' | 'compact' | 'dense'

export type AppearancePrefs = {
  theme: ThemePref
  compact: boolean
  density: DensityPref
}

export const THEME_STORAGE_KEY = 'embody.theme'
export const COMPACT_STORAGE_KEY = 'embody.compact'
export const DENSITY_STORAGE_KEY = 'embody.density'

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  theme: 'dark',
  compact: false,
  density: 'comfortable',
}

export function isThemePref(v: unknown): v is ThemePref {
  return v === 'system' || v === 'dark' || v === 'light'
}

export function isDensityPref(v: unknown): v is DensityPref {
  return v === 'comfortable' || v === 'compact' || v === 'dense'
}

export function readStoredAppearance(): AppearancePrefs {
  const out: AppearancePrefs = { ...DEFAULT_APPEARANCE }
  try {
    const theme = localStorage.getItem(THEME_STORAGE_KEY)
    if (isThemePref(theme)) out.theme = theme
    const compact = localStorage.getItem(COMPACT_STORAGE_KEY)
    if (compact === '1' || compact === 'true') out.compact = true
    if (compact === '0' || compact === 'false') out.compact = false
    const density = localStorage.getItem(DENSITY_STORAGE_KEY)
    if (isDensityPref(density)) out.density = density
  } catch {
    /* ignore */
  }
  return out
}

export function resolveTheme(theme: ThemePref): 'dark' | 'light' {
  if (theme === 'dark' || theme === 'light') return theme
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  return 'dark'
}

/** Apply appearance to <html> for CSS `[data-theme]` / density / compact. */
export function applyAppearance(prefs: AppearancePrefs): 'dark' | 'light' {
  const resolved = resolveTheme(prefs.theme)
  const root = document.documentElement
  root.dataset.theme = resolved
  root.dataset.themePref = prefs.theme
  root.dataset.compact = prefs.compact ? '1' : '0'
  root.dataset.density = prefs.density
  root.style.colorScheme = resolved
  return resolved
}

export function persistAppearance(prefs: AppearancePrefs): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, prefs.theme)
    localStorage.setItem(COMPACT_STORAGE_KEY, prefs.compact ? '1' : '0')
    localStorage.setItem(DENSITY_STORAGE_KEY, prefs.density)
  } catch {
    /* ignore */
  }
}
