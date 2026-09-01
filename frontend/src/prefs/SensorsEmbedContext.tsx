import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useAuth } from '../auth/AuthContext'
import {
  persistSensorsEmbedUrl,
  pingSensorsEmbedUrl,
  readStoredSensorsEmbedUrl,
  type SensorsReachability,
} from './sensorsEmbed'

type SensorsEmbedContextValue = {
  url: string
  /** Normalize, persist to localStorage, then ping. */
  setUrl: (next: string) => void
  reachability: SensorsReachability
  reachMessage: string
  reachable: boolean
  ping: () => Promise<boolean>
}

const SensorsEmbedContext = createContext<SensorsEmbedContextValue | null>(null)

export function SensorsEmbedProvider({ children }: { children: ReactNode }) {
  const { authRequired, user } = useAuth()
  const [url, setUrlState] = useState(() => readStoredSensorsEmbedUrl())
  const [reachability, setReachability] = useState<SensorsReachability>('unknown')
  const [reachMessage, setReachMessage] = useState('')
  const pingSeq = useRef(0)
  const canPing = !authRequired || Boolean(user)

  const ping = useCallback(async (): Promise<boolean> => {
    if (!canPing) {
      setReachability('unknown')
      setReachMessage('')
      return false
    }
    const seq = ++pingSeq.current
    setReachability('checking')
    setReachMessage('')
    try {
      const result = await pingSensorsEmbedUrl(url)
      if (seq !== pingSeq.current) return false
      if (result.ok) {
        setReachability('ok')
        setReachMessage(result.message || '')
        return true
      }
      setReachability('fail')
      setReachMessage(result.message || result.error || 'unreachable')
      return false
    } catch (e) {
      if (seq !== pingSeq.current) return false
      const msg = e instanceof Error ? e.message : String(e)
      setReachability('fail')
      setReachMessage(msg)
      return false
    }
  }, [canPing, url])

  const setUrl = useCallback((next: string) => {
    const saved = persistSensorsEmbedUrl(next)
    setUrlState(saved)
  }, [])

  useEffect(() => {
    if (!canPing) return
    void ping()
  }, [canPing, url, ping])

  const value = useMemo(
    () => ({
      url,
      setUrl,
      reachability,
      reachMessage,
      reachable: reachability === 'ok',
      ping,
    }),
    [url, setUrl, reachability, reachMessage, ping],
  )

  return <SensorsEmbedContext.Provider value={value}>{children}</SensorsEmbedContext.Provider>
}

export function useSensorsEmbed(): SensorsEmbedContextValue {
  const ctx = useContext(SensorsEmbedContext)
  if (!ctx) throw new Error('useSensorsEmbed must be used within SensorsEmbedProvider')
  return ctx
}
