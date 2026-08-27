import { useCallback, useEffect, useState } from 'react'
import { useLocale } from '../../i18n/LocaleContext'
import {
  defaultAgentBaseUrl,
  defaultAgentPath,
  fetchAgentConfig,
  needsAgentUrl,
  probeAgentConnection,
  saveAgentConfig,
  type AgentConfigInput,
  type AgentMode,
} from './agentApi'

type ProbeState = 'unknown' | 'checking' | 'ok' | 'fail'

export function AgentLinkModal({
  open,
  onClose,
  onReady,
}: {
  open: boolean
  onClose: () => void
  onReady: () => void
}) {
  const { t } = useLocale()
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [probeState, setProbeState] = useState<ProbeState>('unknown')
  const [probeMessage, setProbeMessage] = useState('')
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState<AgentConfigInput>({
    mode: 'dry_run',
    baseUrl: '',
    path: '/chat/completions',
    model: '',
    systemPrompt: '',
    apiKey: '',
  })
  const [apiKeyPlaceholder, setApiKeyPlaceholder] = useState('')

  const resetProbe = () => {
    setProbeState('unknown')
    setProbeMessage('')
    setFormError('')
  }

  const loadConfig = useCallback(async () => {
    setLoading(true)
    setFormError('')
    resetProbe()
    try {
      const out = await fetchAgentConfig()
      if (!out.ok) throw new Error(out.error || t('chat.configApiFail'))
      const cfg = out.config
      setForm({
        mode: cfg.mode || 'dry_run',
        baseUrl: cfg.baseUrl || '',
        path: cfg.path || defaultAgentPath(cfg.mode || 'dry_run'),
        model: cfg.model || '',
        systemPrompt: cfg.systemPrompt || '',
        apiKey: '',
      })
      setApiKeyPlaceholder(
        cfg.apiKeySet
          ? t('chat.apiKeySaved', { masked: cfg.apiKeyMasked || '***' })
          : t('chat.apiKeyPlaceholder'),
      )
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    if (open) void loadConfig()
  }, [open, loadConfig])

  const patchForm = (patch: Partial<AgentConfigInput>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch }
      if (patch.mode && patch.mode !== prev.mode) {
        if (!prev.baseUrl.trim() || prev.baseUrl === defaultAgentBaseUrl(prev.mode)) {
          next.baseUrl = defaultAgentBaseUrl(patch.mode)
        }
        if (!prev.path.trim() || prev.path === defaultAgentPath(prev.mode)) {
          next.path = defaultAgentPath(patch.mode)
        }
      }
      return next
    })
    resetProbe()
  }

  const buildPayload = (): Partial<AgentConfigInput> => {
    const payload: Partial<AgentConfigInput> = {
      mode: form.mode,
      baseUrl: form.baseUrl.trim(),
      path: form.path.trim() || defaultAgentPath(form.mode),
      model: form.model.trim(),
      systemPrompt: form.systemPrompt,
    }
    const key = form.apiKey.trim()
    if (key) payload.apiKey = key
    return payload
  }

  const runProbe = async (): Promise<boolean> => {
    setBusy(true)
    setProbeState('checking')
    setProbeMessage(t('chat.agentStatusChecking'))
    setFormError('')
    try {
      const out = await probeAgentConnection(buildPayload())
      if (!out.ok) {
        const msg = out.message || out.error || t('chat.probeFail')
        setProbeState('fail')
        setProbeMessage(msg)
        return false
      }
      const msg = out.message || t('chat.probeOk')
      setProbeState('ok')
      setProbeMessage(msg)
      return true
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setProbeState('fail')
      setProbeMessage(msg)
      return false
    } finally {
      setBusy(false)
    }
  }

  const onProbeClick = async () => {
    await runProbe()
  }

  const onSendClick = async () => {
    if (busy) return
    const ok = await runProbe()
    if (!ok) {
      setFormError(t('modelAnalysis.agentProbeBlocked'))
      return
    }
    setBusy(true)
    setFormError('')
    try {
      const saved = await saveAgentConfig(buildPayload())
      if (!saved.ok) throw new Error(saved.error || t('chat.saveFail'))
      onReady()
      onClose()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const showUrlFields = needsAgentUrl(form.mode)

  return (
    <div className="ma-agent-overlay" role="presentation" onClick={onClose}>
      <div
        className="ma-agent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ma-agent-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ma-agent-head">
          <div>
            <h3 id="ma-agent-title">{t('modelAnalysis.agentModalTitle')}</h3>
            <p className="muted ma-agent-desc">{t('modelAnalysis.agentModalDesc')}</p>
          </div>
          <button type="button" className="ma-agent-close" onClick={onClose} aria-label={t('pathPicker.closeAria')}>
            ×
          </button>
        </header>

        {loading ? (
          <p className="muted ma-agent-loading">{t('chat.bootConfig')}</p>
        ) : (
          <div className="ma-agent-body">
            <div className="ma-agent-probe-row">
              <span className={`ma-agent-status ${probeState}`} data-state={probeState}>
                {probeState === 'checking'
                  ? t('chat.agentStatusChecking')
                  : probeState === 'ok'
                    ? t('chat.agentStatusOk')
                    : probeState === 'fail'
                      ? t('chat.agentStatusFail')
                      : t('chat.agentStatusUnknown')}
              </span>
              <button type="button" className="ma-btn ghost compact" disabled={busy} onClick={() => void onProbeClick()}>
                {t('chat.btnProbeAgent')}
              </button>
            </div>
            {probeMessage ? <p className={`ma-agent-probe-msg ${probeState}`}>{probeMessage}</p> : null}
            {formError ? <p className="ma-agent-error">{formError}</p> : null}

            <label className="ma-field">
              <span>{t('chat.modeLabel')}</span>
              <select
                value={form.mode}
                onChange={(e) => patchForm({ mode: e.target.value as AgentMode })}
              >
                <option value="dry_run">{t('chat.modeDryRun')}</option>
                <option value="openai">{t('chat.modeOpenai')}</option>
                <option value="webhook">{t('chat.modeWebhook')}</option>
                <option value="cursor_sdk">{t('chat.modeCursorSdk')}</option>
                <option value="dsh_agent">{t('chat.modeDshAgent')}</option>
              </select>
            </label>

            {showUrlFields ? (
              <>
                <label className="ma-field">
                  <span>Base URL</span>
                  <input
                    type="text"
                    value={form.baseUrl}
                    placeholder={t('chat.baseUrlPlaceholder')}
                    onChange={(e) => patchForm({ baseUrl: e.target.value })}
                  />
                </label>
                <label className="ma-field">
                  <span>Path</span>
                  <input
                    type="text"
                    value={form.path}
                    placeholder={t('chat.pathPlaceholder')}
                    onChange={(e) => patchForm({ path: e.target.value })}
                  />
                </label>
              </>
            ) : null}

            <label className="ma-field">
              <span>Model</span>
              <input
                type="text"
                value={form.model}
                placeholder="composer-2.5 / gpt-4o-mini …"
                onChange={(e) => patchForm({ model: e.target.value })}
              />
            </label>

            <label className="ma-field">
              <span>API Key</span>
              <input
                type="password"
                value={form.apiKey}
                placeholder={apiKeyPlaceholder}
                autoComplete="off"
                onChange={(e) => patchForm({ apiKey: e.target.value })}
              />
            </label>

            <p className="muted ma-agent-hint">{t('modelAnalysis.agentModalHint')}</p>
          </div>
        )}

        <footer className="ma-agent-foot">
          <button type="button" className="ma-btn ghost" onClick={onClose} disabled={busy}>
            {t('pathPicker.cancel')}
          </button>
          <button type="button" className="ma-btn primary" disabled={busy || loading} onClick={() => void onSendClick()}>
            {busy ? t('chat.agentStatusChecking') : t('modelAnalysis.agentProbeAndSend')}
          </button>
        </footer>
      </div>
    </div>
  )
}
