/** Cross-page handoff: stash a prompt for Chat to pick up on mount. */

export const CHAT_PENDING_PROMPT_KEY = 'embody_chat_pending_prompt_v1'
export const CHAT_STORAGE_KEY = 'embody_chat_v1'
export const CHAT_DSH_SESSION_KEY = 'embody_dsh_session'

export type PendingChatPrompt = {
  message: string
  /** When true, Chat will auto-send after boot. Default true. */
  autoSend?: boolean
  /** When true, clear chat history and backend session before handling. */
  newSession?: boolean
  source?: string
}

/** Clear persisted turns and dsh_agent session id; optionally keep skill selection. */
export function resetChatSession(preserveSkills = true): void {
  try {
    let selected: string[] = []
    if (preserveSkills) {
      const raw = localStorage.getItem(CHAT_STORAGE_KEY)
      if (raw) {
        const data = JSON.parse(raw) as { selected?: unknown }
        if (Array.isArray(data.selected)) {
          selected = data.selected.map(String)
        }
      }
    }
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify({ turns: [], selected }))
    localStorage.removeItem(CHAT_DSH_SESSION_KEY)
  } catch {
    try {
      localStorage.removeItem(CHAT_DSH_SESSION_KEY)
    } catch {
      /* ignore */
    }
  }
}

export function stashChatPendingPrompt(payload: PendingChatPrompt): void {
  try {
    sessionStorage.setItem(CHAT_PENDING_PROMPT_KEY, JSON.stringify(payload))
  } catch {
    /* quota / private mode */
  }
}

export function consumeChatPendingPrompt(): PendingChatPrompt | null {
  try {
    const raw = sessionStorage.getItem(CHAT_PENDING_PROMPT_KEY)
    if (!raw) return null
    sessionStorage.removeItem(CHAT_PENDING_PROMPT_KEY)
    const data = JSON.parse(raw) as PendingChatPrompt
    if (!data || typeof data.message !== 'string' || !data.message.trim()) return null
    return {
      message: data.message.trim(),
      autoSend: data.autoSend !== false,
      newSession: data.newSession === true,
      source: typeof data.source === 'string' ? data.source : undefined,
    }
  } catch {
    try {
      sessionStorage.removeItem(CHAT_PENDING_PROMPT_KEY)
    } catch {
      /* ignore */
    }
    return null
  }
}
