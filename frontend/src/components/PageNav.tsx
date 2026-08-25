import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useLocale } from '../i18n/LocaleContext'
import type { PageId } from '../config/pages'

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
  if (pathname.startsWith('/sensors')) return 'sensors'
  return 'home'
}

export function PageNav() {
  const location = useLocation()
  const navigate = useNavigate()
  const { authRequired, user, logout } = useAuth()
  const { pages, t, m } = useLocale()
  const currentId = resolvePageId(location.pathname)
  const currentIdx = Math.max(0, pages.findIndex((p) => p.id === currentId))
  const current = pages[currentIdx]
  const [open, setOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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
      if (digit >= 1 && digit <= pages.length) {
        e.preventDefault()
        const page = pages[digit - 1]
        if (page.id !== currentId) navigate(page.path)
        return
      }
      if (e.key === 'ArrowLeft' || e.key === '[' || e.code === 'BracketLeft') {
        e.preventDefault()
        const next = (currentIdx - 1 + pages.length) % pages.length
        navigate(pages[next].path)
      }
      if (e.key === 'ArrowRight' || e.key === ']' || e.code === 'BracketRight') {
        e.preventDefault()
        const next = (currentIdx + 1) % pages.length
        navigate(pages[next].path)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [currentId, currentIdx, navigate, pages])

  useEffect(() => {
    if (!open || !btnRef.current || !menuRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const menu = menuRef.current
    menu.style.top = `${Math.round(rect.bottom + 6)}px`
    menu.style.right = `${Math.round(Math.max(8, window.innerWidth - rect.right))}px`
  }, [open])

  return (
    <div className={`page-nav${open ? ' open' : ''}`}>
      <button
        ref={btnRef}
        type="button"
        className="page-nav-btn pill"
        aria-expanded={open}
        aria-haspopup="true"
        title={t('nav.switchPages', { n: pages.length })}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <span className="page-nav-label">{current.short || current.label}</span>
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
        {pages.map((p, i) => (
          <Link
            key={p.id}
            role="menuitem"
            className={`page-nav-item${p.id === currentId ? ' active' : ''}`}
            to={p.path}
            title={`Alt+${i + 1}`}
            onClick={() => setOpen(false)}
          >
            <span className="page-nav-item-main">
              <span className="page-nav-item-title">{p.label}</span>
              <span className="page-nav-item-desc">{p.desc}</span>
            </span>
            <kbd className="page-nav-item-key">Alt+{i + 1}</kbd>
          </Link>
        ))}
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
