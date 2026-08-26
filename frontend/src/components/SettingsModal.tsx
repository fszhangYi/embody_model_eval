import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useLocale } from '../i18n/LocaleContext'
import type { DocsLocale, Locale } from '../i18n/types'
import { useAppearance } from '../prefs/AppearanceContext'
import type { DensityPref, ThemePref } from '../prefs/appearance'
import '../styles/settings.css'

type SettingsTab = 'appearance' | 'language' | 'auth' | 'users' | 'about'

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path
        d="M19.4 13.5a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V19a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H5a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9.5a1.65 1.65 0 0 0 1-1.51V5a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9.5c.26.6.9 1 1.51 1H19a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SettingRow({
  title,
  desc,
  badge,
  children,
}: {
  title: string
  desc: string
  badge?: string
  children: ReactNode
}) {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-title">
          <span>{title}</span>
          {badge ? <span className="settings-badge">{badge}</span> : null}
        </div>
        <p className="settings-row-desc">{desc}</p>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      className={`settings-toggle${checked ? ' on' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
    >
      <span className="settings-toggle-knob" />
    </button>
  )
}

function Segmented({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string
  options: { id: string; label: string }[]
  onChange: (id: string) => void
  ariaLabel: string
}) {
  return (
    <div className="settings-seg" role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          className={`settings-seg-btn${value === o.id ? ' active' : ''}`}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function PanelAppearance() {
  const { m } = useLocale()
  const { theme, compact, density, setTheme, setCompact, setDensity } = useAppearance()
  const a = m.settings.appearance
  const live = m.common.live

  return (
    <>
      <SettingRow title={a.theme} desc={a.themeDesc} badge={live}>
        <Segmented
          ariaLabel={a.theme}
          value={theme}
          onChange={(id) => setTheme(id as ThemePref)}
          options={[
            { id: 'system', label: a.themeSystem },
            { id: 'dark', label: a.themeDark },
            { id: 'light', label: a.themeLight },
          ]}
        />
      </SettingRow>
      <SettingRow title={a.compact} desc={a.compactDesc} badge={live}>
        <Toggle checked={compact} onChange={() => setCompact(!compact)} label={a.compact} />
      </SettingRow>
      <SettingRow title={a.density} desc={a.densityDesc} badge={live}>
        <Segmented
          ariaLabel={a.density}
          value={density}
          onChange={(id) => setDensity(id as DensityPref)}
          options={[
            { id: 'comfortable', label: a.densityComfortable },
            { id: 'compact', label: a.densityCompact },
            { id: 'dense', label: a.densityDense },
          ]}
        />
      </SettingRow>
    </>
  )
}

function PanelLanguage() {
  const { locale, docsLocale, effectiveDocsLocale, setLocale, setDocsLocale, m, t } = useLocale()
  const lang = m.settings.language
  const live = m.common.live

  return (
    <>
      <SettingRow title={lang.ui} desc={lang.uiDesc} badge={live}>
        <Segmented
          ariaLabel={lang.ui}
          value={locale}
          onChange={(id) => setLocale(id as Locale)}
          options={[
            { id: 'zh', label: '中文' },
            { id: 'en', label: 'English' },
          ]}
        />
      </SettingRow>
      <SettingRow title={lang.docs} desc={lang.docsDesc} badge={live}>
        <Segmented
          ariaLabel={lang.docs}
          value={docsLocale}
          onChange={(id) => setDocsLocale(id as DocsLocale)}
          options={[
            { id: 'zh', label: '中文' },
            { id: 'en', label: 'English' },
            { id: 'auto', label: lang.followUi },
          ]}
        />
      </SettingRow>
      <p className="settings-row-desc" style={{ marginTop: 4 }}>
        {t('settings.language.applied', {
          lang: effectiveDocsLocale === 'zh' ? '中文' : 'English',
        })}
      </p>
    </>
  )
}

function PanelAuth() {
  const { m } = useLocale()
  const a = m.settings.auth
  const badge = m.common.placeholder
  const [sessionTtl, setSessionTtl] = useState(true)
  const [csrf, setCsrf] = useState(true)
  const [rbac, setRbac] = useState(false)

  return (
    <>
      <SettingRow title={a.cookie} desc={a.cookieDesc} badge={badge}>
        <Toggle checked={sessionTtl} onChange={() => setSessionTtl((v) => !v)} label={a.cookie} />
      </SettingRow>
      <SettingRow title={a.rbac} desc={a.rbacDesc} badge={badge}>
        <Toggle checked={rbac} onChange={() => setRbac((v) => !v)} label={a.rbac} />
      </SettingRow>
      <SettingRow title={a.csrf} desc={a.csrfDesc} badge={badge}>
        <Toggle checked={csrf} onChange={() => setCsrf((v) => !v)} label={a.csrf} />
      </SettingRow>
      <SettingRow title={a.token} desc={a.tokenDesc} badge={badge}>
        <button type="button" className="settings-ghost-btn" disabled>
          {a.tokenBtn}
        </button>
      </SettingRow>
    </>
  )
}

function PanelUsers() {
  const { m } = useLocale()
  const u = m.settings.users
  const badge = m.common.placeholder

  return (
    <>
      <SettingRow title={u.current} desc={u.currentDesc} badge={badge}>
        <span className="settings-pill">embody</span>
      </SettingRow>
      <SettingRow title={u.invite} desc={u.inviteDesc} badge={badge}>
        <button type="button" className="settings-ghost-btn" disabled>
          {u.inviteBtn}
        </button>
      </SettingRow>
      <SettingRow title={u.roles} desc={u.rolesDesc} badge={badge}>
        <button type="button" className="settings-ghost-btn" disabled>
          {u.rolesBtn}
        </button>
      </SettingRow>
      <div className="settings-table" role="table" aria-label={u.tableAria}>
        <div className="settings-table-head" role="row">
          <span role="columnheader">{u.colUser}</span>
          <span role="columnheader">{u.colRole}</span>
          <span role="columnheader">{u.colStatus}</span>
        </div>
        {[
          { name: 'embody', role: u.roleAdmin, status: u.statusOnline },
          { name: 'eval_bot', role: u.roleEval, status: u.statusOff },
          { name: 'guest', role: u.roleGuest, status: u.statusPlaceholder },
        ].map((row) => (
          <div key={row.name} className="settings-table-row" role="row">
            <span role="cell">{row.name}</span>
            <span role="cell">{row.role}</span>
            <span role="cell" className="muted">
              {row.status}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

function PanelAbout() {
  const { m } = useLocale()
  const a = m.settings.about

  return (
    <div className="settings-about">
      <p>
        <strong>Embody Model Eval</strong> {a.p1}
      </p>
      <ul>
        <li>{a.li1}</li>
        <li>{a.li2}</li>
        <li>{a.li3}</li>
      </ul>
    </div>
  )
}

function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [tab, setTab] = useState<SettingsTab>('appearance')
  const { m } = useLocale()
  const tabs = m.settings.tabs

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose])

  if (!open) return null

  const tabIds = Object.keys(tabs) as SettingsTab[]

  return createPortal(
    <div
      className="settings-overlay"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-head">
          <div>
            <p className="settings-kicker">{m.settings.kicker}</p>
            <h2 id={titleId}>{m.settings.title}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="settings-close"
            aria-label={m.common.closeSettings}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" aria-label={m.settings.navAria}>
            {tabIds.map((id) => (
              <button
                key={id}
                type="button"
                className={`settings-nav-item${tab === id ? ' active' : ''}`}
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => setTab(id)}
              >
                <span className="settings-nav-label">{tabs[id].label}</span>
                <span className="settings-nav-hint">{tabs[id].hint}</span>
              </button>
            ))}
          </nav>

          <div className="settings-panel" role="tabpanel">
            <h3 className="settings-panel-title">{tabs[tab].label}</h3>
            {tab === 'appearance' ? <PanelAppearance /> : null}
            {tab === 'language' ? <PanelLanguage /> : null}
            {tab === 'auth' ? <PanelAuth /> : null}
            {tab === 'users' ? <PanelUsers /> : null}
            {tab === 'about' ? <PanelAbout /> : null}
          </div>
        </div>

        <footer className="settings-foot">
          <span className="muted">
            {tab === 'language'
              ? m.common.escHintSaved
              : tab === 'appearance'
                ? m.common.escHintAppearance
                : m.common.escHint}
          </span>
          <button type="button" className="settings-primary-btn" onClick={onClose}>
            {m.common.done}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/** Classic gear entry + preferences modal (appearance + language live; other tabs placeholders). */
export function SettingsGear() {
  const [open, setOpen] = useState(false)
  const { m } = useLocale()

  return (
    <>
      <button
        type="button"
        className="settings-gear-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        title={m.common.settings}
        onClick={() => setOpen(true)}
      >
        <GearIcon />
        <span className="settings-gear-label">{m.common.settings}</span>
      </button>
      <SettingsDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
