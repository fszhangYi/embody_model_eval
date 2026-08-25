import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import '../styles/settings.css'

type SettingsTab = 'appearance' | 'language' | 'auth' | 'users' | 'about'

const TABS: { id: SettingsTab; label: string; hint: string }[] = [
  { id: 'appearance', label: '外观', hint: '主题与界面密度' },
  { id: 'language', label: '语言', hint: '界面与文档语言' },
  { id: 'auth', label: '鉴权与安全', hint: '会话与细粒度权限' },
  { id: 'users', label: '用户管理', hint: '账号与角色' },
  { id: 'about', label: '关于', hint: '版本与占位说明' },
]

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
  badge = '占位',
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
          <span className="settings-badge">{badge}</span>
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
  const [dark, setDark] = useState(true)
  const [compact, setCompact] = useState(false)
  const [density, setDensity] = useState('comfortable')

  return (
    <>
      <SettingRow
        title="暗黑模式"
        desc="跟随系统或强制深色 / 浅色。当前仅 UI 演示，不会写入本地偏好。"
      >
        <Toggle checked={dark} onChange={() => setDark((v) => !v)} label="暗黑模式" />
      </SettingRow>
      <SettingRow title="紧凑布局" desc="缩小顶栏与模块卡片间距，适合小屏或密集操作。">
        <Toggle checked={compact} onChange={() => setCompact((v) => !v)} label="紧凑布局" />
      </SettingRow>
      <SettingRow title="界面密度" desc="参考 VS Code / Linear 的密度档位。">
        <Segmented
          ariaLabel="界面密度"
          value={density}
          onChange={setDensity}
          options={[
            { id: 'comfortable', label: '舒适' },
            { id: 'compact', label: '紧凑' },
            { id: 'dense', label: '密集' },
          ]}
        />
      </SettingRow>
    </>
  )
}

function PanelLanguage() {
  const [lang, setLang] = useState('zh')
  const [docs, setDocs] = useState('zh')

  return (
    <>
      <SettingRow title="界面语言" desc="中 / 英切换占位。文案与路由尚未接入 i18n。">
        <Segmented
          ariaLabel="界面语言"
          value={lang}
          onChange={setLang}
          options={[
            { id: 'zh', label: '中文' },
            { id: 'en', label: 'English' },
          ]}
        />
      </SettingRow>
      <SettingRow title="文档与提示语言" desc="影响 README 链接、空状态提示与 Agent Skills 说明。">
        <Segmented
          ariaLabel="文档语言"
          value={docs}
          onChange={setDocs}
          options={[
            { id: 'zh', label: '中文' },
            { id: 'en', label: 'English' },
            { id: 'auto', label: '跟随界面' },
          ]}
        />
      </SettingRow>
    </>
  )
}

function PanelAuth() {
  const [sessionTtl, setSessionTtl] = useState(true)
  const [csrf, setCsrf] = useState(true)
  const [rbac, setRbac] = useState(false)

  return (
    <>
      <SettingRow
        title="会话 Cookie 鉴权"
        desc="沿用现有 HttpOnly Cookie 登录流；此处为策略开关占位。"
      >
        <Toggle checked={sessionTtl} onChange={() => setSessionTtl((v) => !v)} label="会话鉴权" />
      </SettingRow>
      <SettingRow title="细粒度鉴权（RBAC）" desc="按模块授予 eval / hub / pipeline / chat 等读写真权限。">
        <Toggle checked={rbac} onChange={() => setRbac((v) => !v)} label="细粒度鉴权" />
      </SettingRow>
      <SettingRow title="CSRF / SameSite 加固" desc="对写接口强制同源与 SameSite=Lax 策略校验。">
        <Toggle checked={csrf} onChange={() => setCsrf((v) => !v)} label="CSRF 加固" />
      </SettingRow>
      <SettingRow title="API Token" desc="签发只读 / 读写 Personal Access Token（GitHub 风格）。">
        <button type="button" className="settings-ghost-btn" disabled>
          生成 Token（即将推出）
        </button>
      </SettingRow>
    </>
  )
}

function PanelUsers() {
  return (
    <>
      <SettingRow title="当前用户" desc="展示登录身份；真实资料编辑尚未接入。">
        <span className="settings-pill">embody</span>
      </SettingRow>
      <SettingRow title="邀请成员" desc="邮件邀请或分享一次性注册链接（占位）。">
        <button type="button" className="settings-ghost-btn" disabled>
          邀请…
        </button>
      </SettingRow>
      <SettingRow title="角色模板" desc="管理员 · 评测员 · 访客；参考 GitHub Org / Notion Workspace。">
        <button type="button" className="settings-ghost-btn" disabled>
          管理角色
        </button>
      </SettingRow>
      <div className="settings-table" role="table" aria-label="用户列表占位">
        <div className="settings-table-head" role="row">
          <span role="columnheader">用户</span>
          <span role="columnheader">角色</span>
          <span role="columnheader">状态</span>
        </div>
        {[
          { name: 'embody', role: '管理员', status: '在线' },
          { name: 'eval_bot', role: '评测员', status: '停用' },
          { name: 'guest', role: '访客', status: '占位' },
        ].map((u) => (
          <div key={u.name} className="settings-table-row" role="row">
            <span role="cell">{u.name}</span>
            <span role="cell">{u.role}</span>
            <span role="cell" className="muted">
              {u.status}
            </span>
          </div>
        ))}
      </div>
    </>
  )
}

function PanelAbout() {
  return (
    <div className="settings-about">
      <p>
        <strong>Embody Model Eval</strong> 设置面板为 UI 占位，交互状态仅保存在本次弹窗会话中，关闭后不持久化。
      </p>
      <ul>
        <li>布局参考：VS Code / Cursor Settings、Linear Preferences、GitHub Settings</li>
        <li>暗黑模式、中英切换、细粒度鉴权与用户管理将在后续迭代接入</li>
        <li>当前生产鉴权仍以 Cookie 会话为准</li>
      </ul>
    </div>
  )
}

function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const [tab, setTab] = useState<SettingsTab>('appearance')

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
            <p className="settings-kicker">Preferences</p>
            <h2 id={titleId}>设置</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="settings-close"
            aria-label="关闭设置"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="settings-body">
          <nav className="settings-nav" aria-label="设置分类">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`settings-nav-item${tab === t.id ? ' active' : ''}`}
                aria-current={tab === t.id ? 'page' : undefined}
                onClick={() => setTab(t.id)}
              >
                <span className="settings-nav-label">{t.label}</span>
                <span className="settings-nav-hint">{t.hint}</span>
              </button>
            ))}
          </nav>

          <div className="settings-panel" role="tabpanel">
            <h3 className="settings-panel-title">{TABS.find((t) => t.id === tab)?.label}</h3>
            {tab === 'appearance' ? <PanelAppearance /> : null}
            {tab === 'language' ? <PanelLanguage /> : null}
            {tab === 'auth' ? <PanelAuth /> : null}
            {tab === 'users' ? <PanelUsers /> : null}
            {tab === 'about' ? <PanelAbout /> : null}
          </div>
        </div>

        <footer className="settings-foot">
          <span className="muted">更改不会保存 · Esc 关闭</span>
          <button type="button" className="settings-primary-btn" onClick={onClose}>
            完成
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

/** Classic gear entry + preferences modal (placeholders only). */
export function SettingsGear() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        className="settings-gear-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="设置"
        onClick={() => setOpen(true)}
      >
        <GearIcon />
        <span className="settings-gear-label">设置</span>
      </button>
      <SettingsDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
