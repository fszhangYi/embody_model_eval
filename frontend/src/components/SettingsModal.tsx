import { memo, useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SettingOutlined } from '@ant-design/icons'
import { useAuth } from '../auth/AuthContext'
import {
  createUser,
  deleteUser,
  fetchUsers,
  updateUser,
  type ManagedUser,
  type UserRole,
} from '../auth/usersApi'
import { useLocale } from '../i18n/LocaleContext'
import type { MessageTree } from '../i18n/messages'
import type { DocsLocale, Locale } from '../i18n/types'
import { useAppearance } from '../prefs/AppearanceContext'
import type { DensityPref, ThemePref } from '../prefs/appearance'
import '../styles/settings.css'

type SettingsTab = 'appearance' | 'language' | 'auth' | 'users' | 'about'

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

type UsersLabels = MessageTree['settings']['users']

function roleLabelFrom(labels: UsersLabels, role: UserRole): string {
  if (role === 'admin') return labels.roleAdmin
  if (role === 'eval') return labels.roleEval
  return labels.roleGuest
}

const SettingsAddUserCard = memo(function SettingsAddUserCard({
  labels,
  busy,
  onAdd,
}: {
  labels: UsersLabels
  busy: boolean
  onAdd: (body: { username: string; password: string; role: UserRole }) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [pass, setPass] = useState('')
  const [role, setRole] = useState<UserRole>('eval')

  const submit = async () => {
    if (!name.trim() || !pass) return
    await onAdd({ username: name.trim(), password: pass, role })
    setName('')
    setPass('')
    setRole('eval')
  }

  return (
    <section className="settings-users-add-card" aria-label={labels.invite}>
      <div className="settings-users-card-head">
        <h4 className="settings-users-card-title">{labels.invite}</h4>
        <p className="settings-users-card-desc">{labels.inviteDesc}</p>
      </div>
      <div className="settings-users-add-grid">
        <label className="settings-users-field">
          <span className="settings-users-field-label">{labels.newUsername}</span>
          <input
            type="text"
            className="settings-users-input"
            placeholder={labels.newUsername}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="settings-users-field">
          <span className="settings-users-field-label">{labels.newPassword}</span>
          <input
            type="password"
            className="settings-users-input"
            placeholder={labels.newPassword}
            value={pass}
            disabled={busy}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        <label className="settings-users-field">
          <span className="settings-users-field-label">{labels.newRole}</span>
          <select
            className="settings-users-select"
            value={role}
            disabled={busy}
            onChange={(e) => setRole(e.target.value as UserRole)}
          >
            <option value="admin">{labels.roleAdmin}</option>
            <option value="eval">{labels.roleEval}</option>
            <option value="guest">{labels.roleGuest}</option>
          </select>
        </label>
        <div className="settings-users-field settings-users-add-action">
          <button
            type="button"
            className="settings-primary-btn settings-users-add-btn"
            disabled={busy || !name.trim() || !pass}
            onClick={() => void submit()}
          >
            {busy ? labels.adding : labels.addBtn}
          </button>
        </div>
      </div>
    </section>
  )
})

const SettingsUserCard = memo(function SettingsUserCard({
  row,
  meUsername,
  busy,
  labels,
  onRoleChange,
  onToggle,
  onDelete,
  onResetPassword,
}: {
  row: ManagedUser
  meUsername?: string
  busy: boolean
  labels: UsersLabels
  onRoleChange: (username: string, role: UserRole) => void
  onToggle: (row: ManagedUser) => void
  onDelete: (username: string) => void
  onResetPassword: (username: string, password: string) => void
}) {
  const [pw, setPw] = useState('')
  const isSelf = row.username === meUsername
  const statusClass = !row.enabled
    ? 'disabled'
    : row.online
      ? 'online'
      : 'offline'

  return (
    <article className="settings-user-card">
      <div className="settings-user-card-top">
        <div className="settings-user-card-ident">
          <span className="settings-user-card-name">{row.username}</span>
          {isSelf ? <span className="settings-badge">{labels.youBadge}</span> : null}
          <span className={`settings-user-status ${statusClass}`}>
            {!row.enabled
              ? labels.statusOff
              : row.online
                ? labels.statusOnline
                : labels.statusPlaceholder}
          </span>
        </div>
        <select
          className="settings-users-select settings-user-role-select"
          value={row.role}
          disabled={busy || isSelf}
          aria-label={`${labels.colRole} ${row.username}`}
          onChange={(e) => onRoleChange(row.username, e.target.value as UserRole)}
        >
          <option value="admin">{labels.roleAdmin}</option>
          <option value="eval">{labels.roleEval}</option>
          <option value="guest">{labels.roleGuest}</option>
        </select>
      </div>
      <div className="settings-user-card-actions">
        <div className="settings-user-card-actions-primary">
          <button
            type="button"
            className="settings-ghost-btn"
            disabled={busy || isSelf}
            onClick={() => onToggle(row)}
          >
            {row.enabled ? labels.disable : labels.enable}
          </button>
          <button
            type="button"
            className="settings-ghost-btn danger"
            disabled={busy || isSelf}
            onClick={() => onDelete(row.username)}
          >
            {labels.deleteBtn}
          </button>
        </div>
        <div className="settings-user-card-reset">
          <input
            type="password"
            className="settings-users-input"
            placeholder={labels.resetPasswordPlaceholder}
            value={pw}
            disabled={busy}
            onChange={(e) => setPw(e.target.value)}
          />
          <button
            type="button"
            className="settings-ghost-btn"
            disabled={busy || !pw.trim()}
            onClick={() => {
              onResetPassword(row.username, pw.trim())
              setPw('')
            }}
          >
            {labels.resetPassword}
          </button>
        </div>
      </div>
    </article>
  )
})

function PanelUsers() {
  const { m, t } = useLocale()
  const u = m.settings.users
  const { authRequired, user: me } = useAuth()
  const isAdmin = me?.role === 'admin'

  const [rows, setRows] = useState<ManagedUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true)
      setError(null)
      try {
        if (!authRequired) {
          setRows([])
          setError(u.authOff)
          return
        }
        if (!isAdmin) {
          setRows([])
          setError(u.forbidden)
          return
        }
        setRows(await fetchUsers())
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        setError(t('settings.users.loadFail', { msg }))
        setRows([])
      } finally {
        if (!opts?.silent) setLoading(false)
      }
    },
    [authRequired, isAdmin, u.authOff, u.forbidden, t],
  )

  useEffect(() => {
    void reload()
  }, [reload, me?.username])

  const runMutation = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true)
      setNotice(null)
      try {
        await fn()
        setNotice(u.saved)
        await reload({ silent: true })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [reload, u.saved],
  )

  const onAdd = useCallback(
    async (body: { username: string; password: string; role: UserRole }) => {
      await runMutation(async () => {
        await createUser(body)
      })
    },
    [runMutation],
  )

  const onRoleChange = useCallback(
    (username: string, role: UserRole) => {
      void runMutation(async () => {
        await updateUser(username, { role })
      })
    },
    [runMutation],
  )

  const onToggle = useCallback(
    (row: ManagedUser) => {
      if (row.username === me?.username && row.enabled) return
      void runMutation(async () => {
        await updateUser(row.username, { enabled: !row.enabled })
      })
    },
    [me?.username, runMutation],
  )

  const onResetPassword = useCallback(
    (username: string, password: string) => {
      if (!password) return
      void runMutation(async () => {
        await updateUser(username, { password })
      })
    },
    [runMutation],
  )

  const onDelete = useCallback(
    (username: string) => {
      if (username === me?.username) {
        setError(u.cannotDeleteSelf)
        return
      }
      if (!window.confirm(t('settings.users.deleteConfirm', { name: username }))) return
      void runMutation(async () => {
        await deleteUser(username)
      })
    },
    [me?.username, runMutation, t, u.cannotDeleteSelf],
  )

  const meRole = (me?.role as UserRole | undefined) ?? 'guest'

  return (
    <div className="settings-users-panel">
      <div className="settings-users-summary">
        <div>
          <p className="settings-users-summary-label">{u.current}</p>
          <p className="settings-users-summary-desc">{u.currentDesc}</p>
        </div>
        <span className="settings-pill">
          {me?.username ?? '—'}
          {me?.username ? ` · ${roleLabelFrom(u, meRole)}` : ''}
        </span>
      </div>

      {error ? <p className="settings-users-msg err">{error}</p> : null}
      {notice ? <p className="settings-users-msg ok">{notice}</p> : null}

      {isAdmin && authRequired ? (
        <>
          <SettingsAddUserCard labels={u} busy={busy} onAdd={onAdd} />
          <section className="settings-users-list-wrap" aria-label={u.tableAria}>
            <div className="settings-users-list-head">
              <h4 className="settings-users-card-title">{u.tableAria}</h4>
              <p className="settings-users-card-desc">{u.rolesDesc}</p>
            </div>
            {loading ? (
              <p className="settings-users-loading muted">…</p>
            ) : rows.length === 0 ? (
              <p className="settings-users-loading muted">—</p>
            ) : (
              <div className="settings-users-list">
                {rows.map((row) => (
                  <SettingsUserCard
                    key={row.username}
                    row={row}
                    meUsername={me?.username}
                    busy={busy}
                    labels={u}
                    onRoleChange={onRoleChange}
                    onToggle={onToggle}
                    onDelete={onDelete}
                    onResetPassword={onResetPassword}
                  />
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
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
        <SettingOutlined aria-hidden />
        <span className="settings-gear-label">{m.common.settings}</span>
      </button>
      <SettingsDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
