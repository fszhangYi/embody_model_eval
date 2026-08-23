import { useEffect, useRef } from 'react'

interface LegacyShellProps {
  html: string
  className?: string
  onMount: () => void | (() => void) | Promise<void | (() => void)>
}

/** Inject legacy HTML shell and run mount logic after DOM is ready. */
export function LegacyShell({ html, className, onMount }: LegacyShellProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<void | (() => void)>(undefined)

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    el.innerHTML = html
    let cancelled = false
    void (async () => {
      const result = await onMount()
      if (!cancelled) cleanupRef.current = result
    })()
    return () => {
      cancelled = true
      if (typeof cleanupRef.current === 'function') cleanupRef.current()
      el.innerHTML = ''
    }
  }, [html, onMount])

  return <div ref={rootRef} className={className} />
}
