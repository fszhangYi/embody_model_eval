import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyAppearance, readStoredAppearance } from './prefs/appearance'
import './styles/globals.css'
import './styles/appearance.css'
import './styles/loading.css'
import './styles/scoped-pages.css'
import './styles/login.css'

/** Apply theme/density before first paint to avoid FOUC. */
applyAppearance(readStoredAppearance())

/** On API 401, send the user to /login (session expired). */
const _fetch = window.fetch.bind(window)
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await _fetch(input, init)
  if (res.status !== 401) return res
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  if (
    url.includes('/api/auth/') ||
    url.includes('/api/chat') ||
    url.includes('/api/agent/') ||
    window.location.pathname.startsWith('/login')
  ) {
    return res
  }
  if (!window.location.pathname.startsWith('/login')) {
    window.location.assign('/login')
  }
  return res
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
