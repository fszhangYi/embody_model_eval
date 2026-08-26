import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  applyAppearance,
  persistAppearance,
  readStoredAppearance,
  resolveTheme,
  type AppearancePrefs,
  type DensityPref,
  type ThemePref,
} from './appearance'

type AppearanceContextValue = AppearancePrefs & {
  setTheme: (theme: ThemePref) => void
  setCompact: (compact: boolean) => void
  setDensity: (density: DensityPref) => void
  resolvedTheme: 'dark' | 'light'
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<AppearancePrefs>(() => readStoredAppearance())
  const [resolvedTheme, setResolvedTheme] = useState<'dark' | 'light'>(() =>
    resolveTheme(readStoredAppearance().theme),
  )

  const patch = useCallback((partial: Partial<AppearancePrefs>) => {
    setPrefs((prev) => ({ ...prev, ...partial }))
  }, [])

  const setTheme = useCallback((theme: ThemePref) => patch({ theme }), [patch])
  const setCompact = useCallback((compact: boolean) => patch({ compact }), [patch])
  const setDensity = useCallback((density: DensityPref) => patch({ density }), [patch])

  useEffect(() => {
    persistAppearance(prefs)
    setResolvedTheme(applyAppearance(prefs))
  }, [prefs])

  useEffect(() => {
    if (prefs.theme !== 'system' || typeof window === 'undefined' || !window.matchMedia) {
      return
    }
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => setResolvedTheme(applyAppearance(prefs))
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [prefs])

  const value = useMemo(
    () => ({
      ...prefs,
      setTheme,
      setCompact,
      setDensity,
      resolvedTheme,
    }),
    [prefs, setTheme, setCompact, setDensity, resolvedTheme],
  )

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext)
  if (!ctx) throw new Error('useAppearance must be used within AppearanceProvider')
  return ctx
}
