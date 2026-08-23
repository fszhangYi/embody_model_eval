// @ts-nocheck

/** Auto-ported */



export function mountChat(): void {
const $ = (sel) => document.querySelector(sel);
const STORAGE_KEY = 'embody_chat_v1';



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
    if (!res.ok && data && data.ok === undefined) data.ok = false;
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
    toast('已复制', 'ok');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = value;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    toast('已复制', 'ok');
  }
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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
  $('#turnHint').textContent = n ? `本会话 ${n} 条` : '新会话';
}

function setSendBusy(busy) {
  state.busy = busy;
  const btn = $('#btnSend');
  if (busy) {
    btn.textContent = '取消';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-cancel');
    btn.disabled = false;
    btn.title = '取消等待';
  } else {
    btn.textContent = '发送';
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
  const div = document.createElement('div');
  div.className = `bubble bubble-${role}`;
  const who = role === 'user' ? '你' : role === 'assistant' ? 'Agent' : '系统';
  div.innerHTML = `<div class="bubble-who">${who}</div><pre class="bubble-text"></pre>`;
  div.querySelector('.bubble-text').textContent = text;

  if (meta) {
    const m = document.createElement('div');
    m.className = 'bubble-meta';
    m.textContent = meta;
    div.appendChild(m);
  }

  if (role === 'user' || role === 'assistant') {
    const actions = document.createElement('div');
    actions.className = 'bubble-actions';
    const btnCopy = document.createElement('button');
    btnCopy.type = 'button';
    btnCopy.textContent = '复制';
    btnCopy.addEventListener('click', () => copyText(text));
    actions.appendChild(btnCopy);

    if (role === 'assistant') {
      const btnMd = document.createElement('button');
      btnMd.type = 'button';
      btnMd.textContent = '导出此条';
      btnMd.addEventListener('click', () => {
        downloadText(`chat-reply-${Date.now()}.md`, `# Agent 回执\n\n${text}\n`);
        toast('已导出', 'ok');
      });
      actions.appendChild(btnMd);

      if (receipt) {
        const btnReceipt = document.createElement('button');
        btnReceipt.type = 'button';
        btnReceipt.textContent = '复制打包 JSON';
        btnReceipt.title = '复制 dry_run receipt（含 messages）';
        btnReceipt.addEventListener('click', () => {
          copyText(JSON.stringify(receipt, null, 2));
        });
        actions.appendChild(btnReceipt);
      }
    }
    div.appendChild(actions);
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
    appendBubble('system', '开始对话：可先勾选 skill，或点下方模板填入诉求。', { persist: false });
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
  if (state.busy) return toast('请先取消进行中的请求', 'err');
  if (state.turns.length && !confirm('清空本页对话历史？')) return;
  state.turns = [];
  persistTurns();
  renderChatFromState();
  toast('已清空对话', 'ok');
}

function exportChatMd() {
  const lines = ['# AI Chat 导出', ''];
  for (const t of state.turns) {
    const who = t.role === 'user' ? 'User' : 'Assistant';
    lines.push(`## ${who}`);
    if (t.meta) lines.push(`_${t.meta}_`, '');
    lines.push(t.content, '');
  }
  if (lines.length <= 2) return toast('暂无对话可导出', 'err');
  downloadText(`chat-session-${Date.now()}.md`, `${lines.join('\n')}\n`);
  toast('已导出会话', 'ok');
}

function syncSelectedHint() {
  const n = state.selected.size;
  $('#selectedHint').textContent = n ? `已选 ${n} 个 skill · 点击名称可预览` : '未选择 skill（仍可纯对话）';
}

async function showSkillPreview(id) {
  state.previewId = id;
  const box = $('#skillPreview');
  const title = $('#previewTitle');
  const body = $('#previewBody');
  box.hidden = false;
  title.textContent = `预览 · ${id}`;
  body.textContent = '加载中…';
  const out = await api(`/api/skills/${encodeURIComponent(id)}`);
  if (state.previewId !== id) return;
  if (!out.ok) {
    body.textContent = out.error || '加载失败';
    return;
  }
  const skill = out.skill || {};
  title.textContent = `预览 · ${skill.name || id}`;
  body.textContent = skill.content || '(空)';
}

function hideSkillPreview() {
  state.previewId = null;
  $('#skillPreview').hidden = true;
}

function renderSkillList() {
  const box = $('#managedSkills');
  if (!state.managed.length) {
    box.innerHTML = '<p class="muted empty">托管目录尚无 skill，可从下方导入。</p>';
    return;
  }
  box.innerHTML = state.managed.map((s) => {
    const checked = state.selected.has(s.id) ? 'checked' : '';
    const desc = (s.description || '').replace(/</g, '&lt;');
    return `
      <label class="skill-card">
        <input type="checkbox" data-skill="${s.id}" ${checked} />
        <span class="skill-card-body">
          <span class="skill-name" data-preview="${s.id}">${s.name || s.id}</span>
          <span class="skill-id">${s.id}</span>
          <span class="skill-desc">${desc}</span>
        </span>
        <button type="button" class="skill-del" data-del="${s.id}" title="从托管目录删除">×</button>
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
      if (!confirm(`从托管目录删除 skill「${id}」？`)) return;
      const out = await api(`/api/skills/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (!out.ok) return toast(out.error || '删除失败', 'err');
      state.selected.delete(id);
      if (state.previewId === id) hideSkillPreview();
      await refreshSkills();
      persistTurns();
      toast(`已删除 ${id}`, 'ok');
    });
  });
  syncSelectedHint();
}

function renderSources() {
  const box = $('#sourceSkills');
  const scanned = state.scanned || [];
  if (!scanned.length) {
    box.innerHTML = '<p class="muted empty">暂无可导入 skill</p>';
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
          ${already ? '已托管' : '导入'}
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
        return toast(out.error || '导入失败', 'err');
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

function fillConfigForm(cfg) {
  state.config = cfg;
  $('#cfgMode').value = cfg.mode || 'dry_run';
  $('#cfgBaseUrl').value = cfg.baseUrl || '';
  $('#cfgPath').value = cfg.path || '/chat/completions';
  $('#cfgModel').value = cfg.model || '';
  $('#cfgSystem').value = cfg.systemPrompt || '';
  $('#cfgApiKey').value = '';
  $('#cfgApiKey').placeholder = cfg.apiKeySet
    ? `已保存 (${cfg.apiKeyMasked})，留空保留`
    : '可选 Bearer Token / CURSOR_API_KEY';
  toggleLinkFields();
}

function toggleLinkFields() {
  const mode = $('#cfgMode').value;
  const needUrl = mode === 'openai' || mode === 'webhook';
  $('#linkFields').hidden = !needUrl;
}

async function refreshSkills() {
  const [managed, sources] = await Promise.all([
    api('/api/skills'),
    api('/api/skills/sources'),
  ]);
  if (!managed.ok) throw new Error(managed.error || 'skills API 不可用（请用 ./serve.sh 启动）');
  state.managed = managed.skills || [];
  state.sources = (sources && sources.sources) || {};
  state.scanned = (sources && sources.scanned) || [];
  state.cursorHome = (sources && sources.cursorHome) || '';
  const head = $('#sourceHeading');
  if (head) {
    const n = state.scanned.length;
    head.textContent = n ? `可导入 · ${n}` : '可导入';
  }
  for (const id of [...state.selected]) {
    if (!state.managed.some((s) => s.id === id)) state.selected.delete(id);
  }
  renderSkillList();
  renderSources();
}

async function refreshConfig() {
  const out = await api('/api/agent/config');
  if (!out.ok) throw new Error(out.error || 'config API 失败');
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
  if (!out.ok) return toast(out.error || '保存失败', 'err');
  fillConfigForm(out.config);
  toast('Agent 链接已保存', 'ok');
}

async function sendChat() {
  if (state.busy) return;
  const message = $('#chatInput').value.trim();
  if (!message) return toast('请输入诉求', 'err');

  const configOverride = {
    mode: $('#cfgMode').value,
    baseUrl: $('#cfgBaseUrl').value.trim(),
    path: $('#cfgPath').value.trim(),
    model: $('#cfgModel').value.trim(),
    systemPrompt: $('#cfgSystem').value,
  };
  const key = $('#cfgApiKey').value.trim();
  if (key) configOverride.apiKey = key;

  const skillIds = [...state.selected];
  const history = historyForApi();

  const abort = new AbortController();
  state.abort = abort;
  setSendBusy(true);
  appendBubble('user', message, {
    meta: [
      skillIds.length ? `skills=${skillIds.join(',')}` : '无 skill',
      history.length ? `上文 ${history.length} 条` : '首轮',
    ].join(' · '),
    skillIds,
  });
  $('#chatInput').value = '';
  appendBubble('system', '发送中…', { persist: false });

  try {
    const out = await api('/api/chat', {
      method: 'POST',
      signal: abort.signal,
      body: JSON.stringify({
        message,
        skillIds,
        history,
        config: configOverride,
      }),
    });
    const log = $('#chatLog');
    const last = log.lastElementChild;
    if (last && last.classList.contains('bubble-system')) last.remove();

    if (!out.ok) {
      appendBubble('system', `失败：${out.error || JSON.stringify(out.detail || out)}`, { persist: false });
      toast(out.error || '调用失败', 'err');
    } else {
      const meta = out.meta
        ? `mode=${out.meta.mode} · skills=${(out.meta.skillIds || []).join(',') || '-'} · history=${out.meta.historyTurns ?? 0} · model=${out.meta.model || '-'}`
        : '';
      appendBubble('assistant', out.reply || '(空回执)', {
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
      appendBubble('system', '已取消', { persist: false });
      toast('已取消等待', 'info');
    } else {
      appendBubble('system', String(err), { persist: false });
      toast('网络或服务错误', 'err');
    }
  } finally {
    setSendBusy(false);
  }
}

$('#cfgMode').addEventListener('change', toggleLinkFields);
$('#btnSaveConfig').addEventListener('click', () => saveConfig());
$('#btnRefresh').addEventListener('click', async () => {
  try {
    await Promise.all([refreshSkills(), refreshConfig()]);
  } catch (e) {
    toast(String(e.message || e), 'err');
  }
});
$('#btnSend').addEventListener('click', () => {
  if (state.busy) cancelChat();
  else sendChat();
});
$('#btnClearChat').addEventListener('click', () => clearChat());
$('#btnExportChat').addEventListener('click', () => exportChatMd());
$('#btnClosePreview').addEventListener('click', () => hideSkillPreview());
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!state.busy) sendChat();
  }
});

(async function boot() {
  restoreTurns();
  try {
    const health = await api('/api/health');
    if (!health.ok) throw new Error('API 不可用');
    $('#apiStatus').textContent = 'API 已连接';
    $('#apiStatus').dataset.ok = '1';
    await refreshSkills();
    await refreshConfig();
    renderChatFromState();
  } catch (e) {
    $('#apiStatus').textContent = 'API 未连接 — 请用 ./serve.sh 启动';
    $('#apiStatus').dataset.ok = '0';
    renderChatFromState();
    appendBubble('system', String(e.message || e) + '\n静态 python -m http.server 没有 /api/*，需 scripts/agent_server.py。', { persist: false });
  }
})();
}
