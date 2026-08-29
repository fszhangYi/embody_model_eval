import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useLocale } from '../i18n/LocaleContext'
import type { PageGroupId, PageId } from '../config/pages'
import { groupForPage } from '../config/pages'

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof Element)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el instanceof HTMLElement && el.isContentEditable) return true
  return !!el.closest?.('[contenteditable="true"]')
}

function resolvePageId(pathname: string): PageId {
  if (pathname === '/' || pathname === '') return 'home'
  if (pathname.startsWith('/eval')) return 'eval'
  if (pathname.startsWith('/hub')) return 'hub'
  if (pathname.startsWith('/pipeline')) return 'pipeline'
  if (pathname.startsWith('/chat')) return 'chat'
  if (pathname.startsWith('/robots')) return 'robots'
  if (pathname.startsWith('/act-pipeline')) return 'actPipeline'
  if (pathname.startsWith('/model-analysis')) return 'modelAnalysis'
  if (pathname.startsWith('/dataset-converter')) return 'datasetConverter'
  if (pathname.startsWith('/pi05-pipeline')) return 'pi05Pipeline'
  if (pathname.startsWith('/pi05-analysis')) return 'pi05Analysis'
  if (pathname.startsWith('/pi05-setup')) return 'pi05Setup'
  if (pathname.startsWith('/sensors')) return 'sensors'
  return 'home'
}

export function PageNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { authRequired, user, logout } = useAuth()
  const { pages, pageGroups, t, m } = useLocale()
  const pageById = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages])
  const navPages = useMemo(() => {
    const ordered: typeof pages = []
    for (const g of pageGroups) {
      for (const id of g.pageIds) {
        const p = pageById.get(id)
        if (p) ordered.push(p)
      }
    }
    return ordered
  }, [pageGroups, pageById])
  const shortcutOf = useMemo(() => {
    const map = new Map<PageId, number>()
    navPages.forEach((p, i) => map.set(p.id, i + 1))
    return map
  }, [navPages])

  const currentId = resolvePageId(location.pathname)
  const currentIdx = Math.max(0, navPages.findIndex((p) => p.id === currentId))
  const current = navPages[currentIdx] ?? pages[0]
  const currentGroup = useMemo(() => {
    const raw = groupForPage(currentId)
    if (!raw) return undefined
    return pageGroups.find((g) => g.id === raw.id) ?? raw
  }, [currentId, pageGroups])

  const [open, setOpen] = useState(false)
  const [flyout, setFlyout] = useState<PageGroupId | null>(null)
  const [loggingOut, setLoggingOut] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setFlyout(null)
      return
    }
    const gid = groupForPage(currentId)?.id
    const g = gid ? pageGroups.find((x) => x.id === gid) : undefined
    setFlyout(g && g.pageIds.length > 1 ? g.id : null)
  }, [open, currentId, pageGroups])

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const target = e.target
      if (target instanceof Element && target.closest('.page-nav')) return
      setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (flyout) {
          setFlyout(null)
          return
        }
        setOpen(false)
        return
      }
      if (isTypingTarget(e.target)) return
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return

      const digit = e.code?.startsWith('Digit')
        ? Number(e.code.slice(5))
        : /^[1-9]$/.test(e.key)
          ? Number(e.key)
          : 0
      if (digit >= 1 && digit <= navPages.length) {
        e.preventDefault()
        const page = navPages[digit - 1]
        if (page.id !== currentId) navigate(page.path)
        return
      }
      if (e.key === 'ArrowLeft' || e.key === '[' || e.code === 'BracketLeft') {
        e.preventDefault()
        const next = (currentIdx - 1 + navPages.length) % navPages.length
        navigate(navPages[next].path)
      }
      if (e.key === 'ArrowRight' || e.key === ']' || e.code === 'BracketRight') {
        e.preventDefault()
        const next = (currentIdx + 1) % navPages.length
        navigate(navPages[next].path)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [currentId, currentIdx, flyout, navigate, navPages])

  useEffect(() => {
    if (!open || !btnRef.current || !menuRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const menu = menuRef.current
    menu.style.top = `${Math.round(rect.bottom + 6)}px`
    menu.style.right = `${Math.round(Math.max(8, window.innerWidth - rect.right))}px`
  }, [open, flyout])

  const btnLabel =
    currentGroup && currentGroup.pageIds.length > 1
      ? `${currentGroup.short} · ${current.short || current.label}`
      : current.short || current.label

  return (
    <div className={`page-nav${open ? ' open' : ''}`}>
      <button
        ref={btnRef}
        type="button"
        className="page-nav-btn pill"
        aria-expanded={open}
        aria-haspopup="true"
        title={t('nav.switchPages', { n: navPages.length })}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <span className="page-nav-label">{btnLabel}</span>
        <span className="page-nav-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <div
        ref={menuRef}
        className="page-nav-menu page-nav-menu-portal"
        role="menu"
        hidden={!open}
        onClick={(e) => e.stopPropagation()}
      >
        {pageGroups.map((group) => {
          const groupPages = group.pageIds
            .map((id) => pageById.get(id))
            .filter((p): p is NonNullable<typeof p> => Boolean(p))
          if (groupPages.length === 0) return null

          const hasActive = groupPages.some((p) => p.id === currentId)

          // Single leaf: one-level link
          if (groupPages.length === 1) {
            const p = groupPages[0]
            const keyN = shortcutOf.get(p.id) ?? 0
            return (
              <Link
                key={group.id}
                role="menuitem"
                className={`page-nav-item${p.id === currentId ? ' active' : ''}`}
                to={p.path}
                title={keyN ? `Alt+${keyN}` : undefined}
                onClick={() => setOpen(false)}
              >
                <span className="page-nav-item-main">
                  <span className="page-nav-item-title">{p.label}</span>
                  <span className="page-nav-item-desc">{p.desc}</span>
                </span>
                {keyN ? <kbd className="page-nav-item-key">Alt+{keyN}</kbd> : null}
              </Link>
            )
          }

          const isFlyout = flyout === group.id
          return (
            <div
              key={group.id}
              className={`page-nav-branch${hasActive ? ' has-active' : ''}${isFlyout ? ' open' : ''}`}
              onMouseEnter={() => setFlyout(group.id)}
            >
              <button
                type="button"
                role="menuitem"
                className={`page-nav-branch-btn${hasActive ? ' active' : ''}`}
                aria-expanded={isFlyout}
                aria-haspopup="true"
                onClick={() => setFlyout((prev) => (prev === group.id ? null : group.id))}
              >
                <span className="page-nav-item-main">
                  <span className="page-nav-item-title">{group.label}</span>
                  <span className="page-nav-item-desc">
                    {groupPages.map((p) => p.short || p.label).join(' · ')}
                  </span>
                </span>
                <span className="page-nav-branch-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
              {isFlyout ? (
                <div
                  className="page-nav-submenu"
                  role="menu"
                  aria-label={group.label}
                >
                  {groupPages.map((p) => {
                    const keyN = shortcutOf.get(p.id) ?? 0
                    return (
                      <Link
                        key={p.id}
                        role="menuitem"
                        className={`page-nav-item${p.id === currentId ? ' active' : ''}`}
                        to={p.path}
                        title={keyN ? `Alt+${keyN}` : undefined}
                        onClick={() => setOpen(false)}
                      >
                        <span className="page-nav-item-main">
                          <span className="page-nav-item-title">{p.label}</span>
                          <span className="page-nav-item-desc">{p.desc}</span>
                        </span>
                        {keyN ? <kbd className="page-nav-item-key">Alt+{keyN}</kbd> : null}
                      </Link>
                    )
                  })}
                </div>
              ) : null}
            </div>
          )
        })}
        <div className="page-nav-hint" role="note">
          {m.nav.adjacentHint}
        </div>
        {authRequired ? (
          <div className="page-nav-auth">
            <span className="page-nav-auth-user" title={m.nav.loggedIn}>
              {user?.username || m.nav.loggedIn}
            </span>
            <button
              type="button"
              className="page-nav-logout"
              disabled={loggingOut}
              onClick={async () => {
                setLoggingOut(true)
                try {
                  await logout()
                  setOpen(false)
                  navigate('/login', { replace: true })
                } finally {
                  setLoggingOut(false)
                }
              }}
            >
              {loggingOut ? m.nav.loggingOut : m.nav.logout}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}
