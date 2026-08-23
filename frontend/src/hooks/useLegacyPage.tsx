import { useCallback } from 'react'
import { LegacyShell } from '../components/LegacyShell'

export function useLegacyPage(html: string, mount: () => void, className?: string) {
  const onMount = useCallback(() => {
    mount()
  }, [mount])

  return <LegacyShell html={html} className={className} onMount={onMount} />
}
