/** Shared π0.5 training-route mode across Setup / Pipeline / Analysis. */

export type Pi05RouteMode = 'full_ft' | 'smoke_lora'

export const PI05_ROUTE_STORAGE_KEY = 'embody.pi05.routeMode'
export const DEFAULT_PI05_ROUTE: Pi05RouteMode = 'full_ft'

export function normalizePi05Route(v: unknown): Pi05RouteMode {
  return v === 'smoke_lora' ? 'smoke_lora' : 'full_ft'
}

export function readStoredPi05Route(): Pi05RouteMode {
  try {
    return normalizePi05Route(localStorage.getItem(PI05_ROUTE_STORAGE_KEY))
  } catch {
    return DEFAULT_PI05_ROUTE
  }
}

export function writeStoredPi05Route(mode: Pi05RouteMode) {
  try {
    localStorage.setItem(PI05_ROUTE_STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

/** Prefer ?route= on first load, else localStorage. */
export function resolveInitialPi05Route(search?: string): Pi05RouteMode {
  try {
    const q = new URLSearchParams(search ?? window.location.search)
    const fromQuery = q.get('route')
    if (fromQuery === 'full_ft' || fromQuery === 'smoke_lora') return fromQuery
  } catch {
    /* ignore */
  }
  return readStoredPi05Route()
}
