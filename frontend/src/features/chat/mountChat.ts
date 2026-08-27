// @ts-nocheck

import { t } from '../../i18n/runtime';

/** Auto-ported */

import {
  createLoader,
  withLoader,
  hideLoader,
  inlineLoadingHtml,
} from '../../lib/legacy/loading.js';
import { consumeChatPendingPrompt, CHAT_DSH_SESSION_KEY, CHAT_STORAGE_KEY, resetChatSession } from './pendingPrompt';
import { bubbleMarkdown, downloadMarkdown, downloadMarkdownAsPdf } from './bubbleExport';
import { renderMarkdownHtml } from './renderMarkdown';

export function mountChat(): void | (() => void) {
const shellRoot = document.querySelector('.chat-page .legacy-shell');
if (!shellRoot) return;
const $ = (sel) => shellRoot.querySelector(sel);
const mountAc = new AbortController();
const ls = { signal: mountAc.signal };
const STORAGE_KEY = CHAT_STORAGE_KEY;
const pageLoader = createLoader(document.querySelector('.chat-page'), { mode: 'page', id: 'chatPageLoader' });
hideLoader(pageLoader);



const state = {
  managed: [],
  sources: {},
  scanned: [],
  cursorHome: '',
  selected: new Set(),
  config: null,
  busy: false,
  abort: null,
  /** @type {{role:string, content:string, meta?:string, receipt?:any, skillIds?:string[]}[]} */
  turns: [],
  previewId: null,
};

function api(path, opts = {}) {
  return fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  }).then(async (res) => {
    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      if (opts.signal?.aborted || (err && err.name === 'AbortError')) throw err;
      data = { ok: false, error: `HTTP ${res.status}` };
    }
    if (!res.ok) {
      if (data && data.ok === undefined) data.ok = false;
      if (res.status === 401 && data && !data.error) {
        data.error = 'unauthorized';
        data.authRequired = true;
      }
    }
    return data;
  });
}

function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
}

async function copyText(text) {
  const value = String(text || '');
  try {
    await navigator.clipboard.writeText(value);
    toast(t('chat.copied'), 'ok');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = value;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast(t('chat.copied'), 'ok');
  }
}

function downloadText(filename, text) {
  downloadMarkdown(filename, text);
}

function bubbleTitle(role) {
  return role === 'user' ? t('chat.whoYou') : 'Agent';
}

function exportBubbleMd(role, text, meta) {
  const md = bubbleMarkdown(bubbleTitle(role), text, meta);
  const prefix = role === 'user' ? 'chat-ask' : 'chat-reply';
  downloadText(`${prefix}-${Date.now()}.md`, md);
  toast(t('chat.exported'), 'ok');
}

async function exportBubblePdf(role, text, meta) {
  const md = bubbleMarkdown(bubbleTitle(role), text, meta);
  const prefix = role === 'user' ? 'chat-ask' : 'chat-reply';
  try {
    await downloadMarkdownAsPdf(`${prefix}-${Date.now()}.pdf`, md);
    toast(t('chat.exportedPdf'), 'ok');
  } catch (err) {
    toast(String(err?.message || err), 'err');
  }
}

function appendBubbleActions(div, role, text, meta) {
  const actions = document.createElement('div');
  actions.className = 'bubble-actions';

  const btnCopy = document.createElement('button');
  btnCopy.type = 'button';
  btnCopy.textContent = t('chat.btnCopy');
  btnCopy.addEventListener('click', () => copyText(text));
  actions.appendChild(btnCopy);

  const btnMd = document.createElement('button');
  btnMd.type = 'button';
  btnMd.textContent = t('chat.btnExportMd');
  btnMd.addEventListener('click', () => exportBubbleMd(role, text, meta));
  actions.appendChild(btnMd);

  const btnPdf = document.createElement('button');
  btnPdf.type = 'button';
  btnPdf.textContent = t('chat.btnExportPdf');
  btnPdf.addEventListener('click', () => {
    void exportBubblePdf(role, text, meta);
  });
  actions.appendChild(btnPdf);

  div.appendChild(actions);
}

function persistTurns() {
  try {
    const slim = state.turns
      .filter((t) => t.role === 'user' || t.role === 'assistant')
      .map((t) => ({
        role: t.role,
        content: t.content,
        meta: t.meta || '',
        skillIds: t.skillIds || [],
        receipt: t.receipt || null,
      }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ turns: slim, selected: [...state.selected] }));
  } catch (_) { /* quota / private mode */ }
}

function restoreTurns() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.turns)) state.turns = data.turns;
    if (Array.isArray(data.selected)) {
      state.selected = new Set(data.selected.map(String));
    }
  } catch (_) { /* ignore */ }
}

function historyForApi() {
  return state.turns
    .filter((t) => t.role === 'user' || t.role === 'assistant')
    .map((t) => ({ role: t.role, content: t.content }));
}

function syncTurnHint() {
  const n = historyForApi().length;
  $('#turnHint').textContent = n ? t('chat.turnCount', { n }) : t('chat.turnNew');
}

function setSendBusy(busy) {
  state.busy = busy;
  const btn = $('#btnSend');
  if (busy) {
    btn.textContent = t('chat.btnCancel');
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-cancel');
    btn.disabled = false;
    btn.title = t('chat.btnCancelTitle');
  } else {
    btn.textContent = t('chat.btnSend');
    btn.classList.add('btn-primary');
    btn.classList.remove('btn-cancel');
    btn.disabled = false;
    btn.title = '';
    state.abort = null;
  }
}

function cancelChat() {
  if (!state.busy || !state.abort) return;
  state.abort.abort();
}

function appendBubble(role, text, { meta, receipt, skillIds, persist = true } = {}) {
  const log = $('#chatLog');
  if (!log) return;
  const div = document.createElement('div');
  div.className = `bubble bubble-${role}`;
  const who = role === 'user' ? t('chat.whoYou') : role === 'assistant' ? 'Agent' : t('chat.whoSystem');
  div.innerHTML = `<div class="bubble-who">${who}</div><div class="bubble-text"></div>`;
  const body = div.querySelector('.bubble-text');
  if (role === 'user' || role === 'assistant') {
    body.classList.add('bubble-md');
    body.innerHTML = renderMarkdownHtml(text);
  } else {
    body.textContent = text;
  }

  if (meta) {
    const m = document.createElement('div');
    m.className = 'bubble-meta';
    m.textContent = meta;
    div.appendChild(m);
  }

  if (role === 'user' || role === 'assistant') {
    appendBubbleActions(div, role, text, meta);
  }

  log.appendChild(div);
  log.scrollTop = log.scrollHeight;

  if (persist && (role === 'user' || role === 'assistant')) {
    state.turns.push({
      role,
      content: text,
      meta: meta || '',
      receipt: receipt || null,
      skillIds: skillIds || [],
    });
    persistTurns();
    syncTurnHint();
  } else if (persist && role === 'system') {
    // ephemeral system lines are not stored
  }
}

function renderChatFromState() {
  const log = $('#chatLog');
  log.innerHTML = '';
  if (!state.turns.length) {
    appendBubble('system', t('chat.systemStart'), { persist: false });
    syncTurnHint();
    return;
  }
  for (const t of state.turns) {
    appendBubble(t.role, t.content, {
      meta: t.meta,
      receipt: t.receipt,
      skillIds: t.skillIds,
      persist: false,
    });
  }
  syncTurnHint();
}

function clearChat() {
  if (state.busy) return toast(t('chat.clearBusy'), 'err');
  if (state.turns.length && !confirm(t('chat.confirmClear'))) return;
  state.turns = [];
  persistTurns();
  renderChatFromState();
  toast(t('chat.cleared'), 'ok');
}

function exportChatMd() {
  const lines = [`# ${t('chat.exportTitle')}`, ''];
  for (const t of state.turns) {
    const who = t.role === 'user' ? 'User' : 'Assistant';
    lines.push(`## ${who}`);
    if (t.meta) lines.push(`_${t.meta}_`, '');
    lines.push(t.content, '');
  }
  if (lines.length <= 2) return toast(t('chat.exportEmpty'), 'err');
  downloadText(`chat-session-${Date.now()}.md`, `${lines.join('\n')}\n`);
  toast(t('chat.exportedSession'), 'ok');
}

function syncSelectedHint() {
  const n = state.selected.size;
  $('#selectedHint').textContent = n ? t('chat.selectedHint', { n }) : t('chat.selectedFallback');
}

async function showSkillPreview(id) {
  state.previewId = id;
  const box = $('#skillPreview');
  const title = $('#previewTitle');
  const body = $('#previewBody');
  box.hidden = false;
  title.textContent = t('chat.previewOf', { id });
  body.innerHTML = inlineLoadingHtml(t('chat.previewLoading'));
  const out = await api(`/api/skills/${encodeURIComponent(id)}`);
  if (state.previewId !== id) return;
  if (!out.ok) {
    body.textContent = out.error || t('chat.previewLoadFail');
    return;
  }
  const skill = out.skill || {};
  title.textContent = t('chat.previewOf', { id: skill.name || id });
  body.textContent = skill.content || t('chat.previewEmpty');
}

function hideSkillPreview() {
  state.previewId = null;
  $('#skillPreview').hidden = true;
}

function renderSkillList() {
  const box = $('#managedSkills');
  if (!state.managed.length) {
    box.innerHTML = `<p class="muted empty">${t('chat.managedEmpty')}</p>`;
    return;
  }
  box.innerHTML = state.managed.map((s) => {
    const checked = state.selected.has(s.id) ? 'checked' : '';
    const desc = (s.description || '').replace(/</g, '&lt;');
    return `
      <label class="skill-card">
        <input type="checkbox" data-skill="${s.id}" ${checked} />
        <span class="skill-card-body">
          <span class="skill-name" data-preview="${s.id}" title="${(s.name || s.id).replace(/"/g, '&quot;')}">${s.name || s.id}</span>
          <span class="skill-id" title="${s.id.replace(/"/g, '&quot;')}">${s.id}</span>
          <span class="skill-desc">${desc}</span>
        </span>
        <button type="button" class="skill-del" data-del="${s.id}" title=t('chat.btnDeleteSkill')>×</button>
      </label>`;
  }).join('');

  box.querySelectorAll('input[data-skill]').forEach((inp) => {
    inp.addEventListener('change', () => {
      if (inp.checked) state.selected.add(inp.dataset.skill);
      else state.selected.delete(inp.dataset.skill);
      syncSelectedHint();
      persistTurns();
      if (inp.checked) showSkillPreview(inp.dataset.skill);
    });
  });
  box.querySelectorAll('[data-preview]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showSkillPreview(el.dataset.preview);
    });
  });
  box.querySelectorAll('button[data-del]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.del;
      if (!confirm(t('chat.confirmDeleteSkill', { id }))) return;
      const out = await api(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!out.ok) return toast(out.error || t('chat.deleteFail'), 'err');
      state.selected.delete(id);
      if (state.previewId === id) hideSkillPreview();
      await refreshSkills();
      persistTurns();
      toast(t('chat.deleted', { id }), 'ok');
    });
  });
  syncSelectedHint();
}

function renderSources() {
  const box = $('#sourceSkills');
  const scanned = state.scanned || [];
  if (!scanned.length) {
    box.innerHTML = `<p class="muted empty">${t('chat.sourcesEmpty')}</p>`;
    return;
  }

  const parts = ['<div class="source-block">'];
  for (const s of scanned) {
    const already = state.managed.some((m) => m.id === s.id);
    const desc = (s.description || '').trim();
    parts.push(`
      <div class="source-row" title="${escAttr(desc)}">
        <div>
          <div class="skill-name">${escHtml(s.name || s.id)}</div>
          ${desc ? `<div class="skill-desc">${escHtml(desc)}</div>` : ''}
        </div>
        <button type="button" class="btn-sm" data-rel="${escAttr(s.rel)}" ${already ? 'disabled' : ''}>
          ${already ? t('chat.btnManaged') : t('chat.btnImport')}
        </button>
      </div>`);
  }
  parts.push('</div>');
  box.innerHTML = parts.join('');

  box.querySelectorAll('button[data-rel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const rel = btn.dataset.rel;
      if (!rel) return;
      btn.disabled = true;
      const out = await api('/api/skills/import', {
        method: 'POST',
        body: JSON.stringify({ rel }),
      });
      if (!out.ok) {
        btn.disabled = false;
        return toast(out.error || t('chat.importFail'), 'err');
      }
      const id = (out.skill && out.skill.id) || rel.split('/').pop();
      state.selected.add(id);
      await refreshSkills();
      persistTurns();
      showSkillPreview(id);
    });
  });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(s) {
  return escHtml(s).replace(/'/g, '&#39;');
}

function setApiStatus(ok, text) {
  const el = $('#apiStatus');
  if (!el) return;
  el.textContent = text ?? (ok ? t('chat.apiConnected') : t('chat.apiDisconnected'));
  if (ok === null || ok === undefined) {
    delete el.dataset.ok;
  } else {
    el.dataset.ok = ok ? '1' : '0';
  }
}

function setAgentStatus(state, detail) {
  const el = $('#agentStatus');
  if (!el) return;
  el.dataset.state = state;
  const labels = {
    unknown: t('chat.agentStatusUnknown'),
    checking: t('chat.agentStatusChecking'),
    ok: t('chat.agentStatusOk'),
    fail: t('chat.agentStatusFail'),
  };
  el.textContent = detail || labels[state] || labels.unknown;
  if (state === 'ok') el.dataset.ok = '1';
  else if (state === 'fail') el.dataset.ok = '0';
  else delete el.dataset.ok;
}

async function checkApiHealth() {
  setApiStatus(null, t('chat.apiChecking'));
  const health = await api('/api/health');
  if (!health.ok) throw new Error(t('chat.apiUnavailable'));
  setApiStatus(true);
  return health;
}

function readConfigOverride() {
  const configOverride = {
    mode: $('#cfgMode').value,
    baseUrl: $('#cfgBaseUrl').value.trim(),
    path: $('#cfgPath').value.trim(),
    model: $('#cfgModel').value.trim(),
    systemPrompt: $('#cfgSystem').value,
  };
  const key = $('#cfgApiKey').value.trim();
  if (key) configOverride.apiKey = key;
  return configOverride;
}

async function probeAgentConnection() {
  const btn = $('#btnProbeAgent');
  if (btn) btn.disabled = true;
  setAgentStatus('checking');
  try {
    const out = await api('/api/agent/probe', {
      method: 'POST',
      body: JSON.stringify({ config: readConfigOverride() }),
    });
    if (!out.ok) {
      const msg = out.message || out.error || t('chat.probeFail');
      setAgentStatus('fail', msg);
      toast(msg, 'err');
      return false;
    }
    const msg = out.message || t('chat.probeOk');
    setAgentStatus('ok', msg);
    toast(msg, out.authWarning ? 'info' : 'ok');
    return true;
  } catch (err) {
    const msg = String(err?.message || err);
    setAgentStatus('fail', msg);
    toast(msg, 'err');
    return false;
  } finally {
    if (btn) btn.disabled = false;
  }
}

function fillConfigForm(cfg) {
  state.config = cfg;
  $('#cfgMode').value = cfg.mode || 'dry_run';
  $('#cfgBaseUrl').value = cfg.baseUrl || '';
  $('#cfgPath').value = cfg.path || '/chat/completions';
  $('#cfgModel').value = cfg.model || '';
  {
    const zhDefault = '你是评测助手。优先遵循用户选中的 Agent Skill 指令。';
    const raw = cfg.systemPrompt || '';
    const isDefault = !raw || raw === zhDefault || raw === t('chat.defaultSystem');
    $('#cfgSystem').value = isDefault ? t('chat.defaultSystem') : raw;
  }
  $('#cfgApiKey').value = '';
  $('#cfgApiKey').placeholder = cfg.apiKeySet
    ? t('chat.apiKeySaved', { masked: cfg.apiKeyMasked })
    : t('chat.apiKeyPlaceholder');
  toggleLinkFields();
  setAgentStatus('unknown');
}

function toggleLinkFields() {
  const mode = $('#cfgMode').value;
  const needUrl = mode === 'openai' || mode === 'webhook' || mode === 'dsh_agent';
  $('#linkFields').hidden = !needUrl;
  if (mode === 'dsh_agent') {
    if (!$('#cfgBaseUrl').value.trim()) $('#cfgBaseUrl').value = 'http://127.0.0.1:8790';
    if (!$('#cfgPath').value.trim() || $('#cfgPath').value.trim() === '/chat/completions') {
      $('#cfgPath').value = '/agent/run';
    }
    $('#cfgBaseUrl').placeholder = 'http://127.0.0.1:8790（embody_dsh_agent bridge）';
    $('#cfgPath').placeholder = '/agent/run';
  }
}

async function refreshSkills() {
  const [managed, sources] = await Promise.all([
    api('/api/skills'),
    api('/api/skills/sources'),
  ]);
  if (!managed.ok) throw new Error(managed.error || t('chat.skillsApiFail'));
  state.managed = managed.skills || [];
  state.sources = (sources && sources.sources) || {};
  state.scanned = (sources && sources.scanned) || [];
  state.cursorHome = (sources && sources.cursorHome) || '';
  const head = $('#sourceHeading');
  if (head) {
    const n = state.scanned.length;
    head.textContent = n ? t('chat.sourcesCount', { n }) : t('chat.sourcesTitle');
  }
  for (const id of [...state.selected]) {
    if (!state.managed.some((s) => s.id === id)) state.selected.delete(id);
  }
  renderSkillList();
  renderSources();
}

async function refreshConfig() {
  const out = await api('/api/agent/config');
  if (!out.ok) throw new Error(out.error || t('chat.configApiFail'));
  fillConfigForm(out.config);
}

async function saveConfig() {
  const body = {
    mode: $('#cfgMode').value,
    baseUrl: $('#cfgBaseUrl').value.trim(),
    path: $('#cfgPath').value.trim(),
    model: $('#cfgModel').value.trim(),
    systemPrompt: $('#cfgSystem').value,
  };
  const key = $('#cfgApiKey').value.trim();
  if (key) body.apiKey = key;
  const out = await api('/api/agent/config', { method: 'PUT', body: JSON.stringify(body) });
  if (!out.ok) return toast(out.error || t('chat.saveFail'), 'err');
  fillConfigForm(out.config);
  toast(t('chat.configSaved'), 'ok');
  setAgentStatus('unknown');
}

async function sendChat() {
  if (state.busy) return;
  const message = $('#chatInput').value.trim();
  if (!message) return toast(t('chat.needInput'), 'err');

  const configOverride = readConfigOverride();
  const skillIds = [...state.selected];
  const history = historyForApi();

  const abort = new AbortController();
  state.abort = abort;
  setSendBusy(true);
  appendBubble('user', message, {
    meta: [
      skillIds.length ? `skills=${skillIds.join(',')}` : t('chat.metaNoSkill'),
      history.length ? t('chat.metaHistory', { n: history.length }) : t('chat.metaFirstTurn'),
    ].join(' · '),
    skillIds,
  });
  $('#chatInput').value = '';
  const sendingHint =
    configOverride.mode === 'dsh_agent' ? t('chat.sendingDsh') : t('chat.sending');
  appendBubble('system', sendingHint, { persist: false });

  try {
    const body = {
      message,
      skillIds,
      history,
      config: configOverride,
    };
    if (configOverride.mode === 'dsh_agent') {
      let sid = '';
      try {
        sid = localStorage.getItem(CHAT_DSH_SESSION_KEY) || '';
      } catch (_) {
        /* ignore */
      }
      if (!sid) {
        sid = `chat-${Date.now().toString(36)}`;
        try {
          localStorage.setItem(CHAT_DSH_SESSION_KEY, sid);
        } catch (_) {
          /* ignore */
        }
      }
      body.sessionId = sid;
    }
    const out = await api('/api/chat', {
      method: 'POST',
      signal: abort.signal,
      body: JSON.stringify(body),
    });
    const log = $('#chatLog');
    const last = log.lastElementChild;
    if (last && last.classList.contains('bubble-system')) last.remove();

    if (!out.ok) {
      const errMsg =
        out.authRequired
          ? t('chat.authRequired')
          : out.error || JSON.stringify(out.detail || out);
      appendBubble('system', t('chat.failPrefix', { msg: errMsg }), { persist: false });
      toast(errMsg, 'err');
    } else {
      if (out.meta?.sessionId) {
        try {
          localStorage.setItem(CHAT_DSH_SESSION_KEY, out.meta.sessionId);
        } catch (_) {
          /* ignore */
        }
      }
      const meta = out.meta
        ? `mode=${out.meta.mode} · skills=${(out.meta.skillIds || []).join(',') || '-'} · history=${out.meta.historyTurns ?? out.meta.historyTurns ?? 0} · model=${out.meta.model || '-'}`
        : '';
      appendBubble('assistant', out.reply || t('chat.emptyReply'), {
        meta,
        receipt: out.receipt || null,
        skillIds,
      });
    }
  } catch (err) {
    const log = $('#chatLog');
    const last = log.lastElementChild;
    if (last && last.classList.contains('bubble-system')) last.remove();
    if (err?.name === 'AbortError' || abort.signal.aborted) {
      appendBubble('system', t('chat.canceled'), { persist: false });
      toast(t('chat.cancelWait'), 'info');
    } else {
      appendBubble('system', String(err), { persist: false });
      toast(t('chat.networkErr'), 'err');
    }
  } finally {
    setSendBusy(false);
  }
}

$('#cfgMode').addEventListener('change', () => {
  toggleLinkFields();
  setAgentStatus('unknown');
}, ls);
$('#btnSaveConfig').addEventListener('click', () => saveConfig(), ls);
$('#btnCheckApi').addEventListener('click', async () => {
  try {
    await checkApiHealth();
    toast(t('chat.apiConnected'), 'ok');
  } catch (e) {
    toast(String(e.message || e), 'err');
  }
}, ls);
$('#btnProbeAgent').addEventListener('click', () => probeAgentConnection(), ls);
$('#btnRefresh').addEventListener('click', async () => {
  try {
    await withLoader(pageLoader, async (progress) => {
      progress(0.25, t('chat.refreshSkills'), 'agent_skills/');
      await refreshSkills();
      progress(0.75, t('chat.refreshConfig'), t('chat.agentTitle'));
      await refreshConfig();
    }, { text: t('chat.refreshTitle'), detail: t('chat.refreshDetail') });
  } catch (e) {
    toast(String(e.message || e), 'err');
  }
}, ls);
$('#btnSend').addEventListener('click', () => {
  if (state.busy) cancelChat();
  else sendChat();
}, ls);
$('#btnClearChat').addEventListener('click', () => clearChat(), ls);
$('#btnExportChat').addEventListener('click', () => exportChatMd(), ls);
$('#btnClosePreview').addEventListener('click', () => hideSkillPreview(), ls);
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!state.busy) sendChat();
  }
}, ls);

(async function boot() {
  const pending = consumeChatPendingPrompt();
  if (pending?.newSession) {
    resetChatSession();
    state.turns = [];
  } else {
    restoreTurns();
  }
  setApiStatus(null, t('chat.apiUnknown'));
  setAgentStatus('unknown');
  try {
    await withLoader(pageLoader, async (progress) => {
      progress(0.15, t('chat.bootConnect'), '/api/health');
      await checkApiHealth();
      progress(0.45, t('chat.bootSkills'), 'agent_skills/');
      await refreshSkills();
      progress(0.8, t('chat.bootConfig'), t('chat.agentTitle'));
      await refreshConfig();
      progress(1, t('chat.bootReady'), t('chat.bootReadyDetail'));
    }, { text: t('chat.bootTitle'), detail: t('chat.bootDetail') });
    renderChatFromState();
  } catch (e) {
    setApiStatus(false);
    renderChatFromState();
    appendBubble('system', String(e.message || e) + '\n' + t('chat.staticServerHint'), { persist: false });
  }

  if (pending?.message) {
    const input = $('#chatInput');
    if (input) input.value = pending.message;
    if (pending.autoSend) {
      // Defer so boot UI settles and skills/config are applied.
      setTimeout(() => {
        if (!state.busy && $('#chatInput')?.value.trim()) sendChat();
      }, 80);
    } else {
      toast(t('chat.pendingPromptReady'), 'ok');
      input?.focus();
    }
  }
})();

return () => {
  mountAc.abort();
  if (state.abort) state.abort.abort();
};
}
