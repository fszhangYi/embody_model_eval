/**
 * AI Chat tab — skill picker + agent link config + send/receive.
 */
import { mountPageNav } from './nav_pages.js';

const $ = (sel) => document.querySelector(sel);

mountPageNav(document.getElementById('pageNavRoot'), { currentId: 'chat' });

const state = {
  managed: [],
  sources: {},
  selected: new Set(),
  config: null,
  busy: false,
  abort: null,
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  let data = null;
  try {
    data = await res.json();
  } catch (err) {
    if (opts.signal?.aborted || (err && err.name === 'AbortError')) throw err;
    data = { ok: false, error: `HTTP ${res.status}` };
  }
  if (!res.ok && data && data.ok === undefined) data.ok = false;
  return data;
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

function toast(msg, kind = 'info') {
  const el = $('#toast');
  el.textContent = msg;
  el.dataset.kind = kind;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3200);
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
          <span class="skill-name">${s.name || s.id}</span>
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
      await refreshSkills();
      toast(`已删除 ${id}`, 'ok');
    });
  });
  syncSelectedHint();
}

function syncSelectedHint() {
  const n = state.selected.size;
  $('#selectedHint').textContent = n ? `已选 ${n} 个 skill` : '未选择 skill（仍可纯对话）';
}

function renderSources() {
  const box = $('#sourceSkills');
  const rows = [];
  for (const [key, info] of Object.entries(state.sources || {})) {
    const skills = info.skills || [];
    for (const s of skills) {
      const already = state.managed.some((m) => m.id === s.id);
      rows.push(`
        <div class="source-row">
          <div>
            <div class="skill-name">${s.name || s.id}</div>
            <div class="skill-id">${s.id}</div>
          </div>
          <button type="button" class="btn-sm" data-import="${key}:${s.id}" ${already ? 'disabled' : ''}>
            ${already ? '已托管' : '导入'}
          </button>
        </div>`);
    }
  }
  box.innerHTML = rows.join('') || '<p class="muted empty">暂无可导入 skill</p>';
  box.querySelectorAll('button[data-import]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const [source, id] = btn.dataset.import.split(':');
      btn.disabled = true;
      const out = await api('/api/skills/import', {
        method: 'POST',
        body: JSON.stringify({ source, id }),
      });
      if (!out.ok) {
        btn.disabled = false;
        return toast(out.error || '导入失败', 'err');
      }
      state.selected.add(id);
      await refreshSkills();
      toast(`已导入 ${id}`, 'ok');
    });
  });
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
  $('#cursorHint').hidden = mode !== 'cursor_sdk';
  $('#dryHint').hidden = mode !== 'dry_run';
}

async function refreshSkills() {
  const [managed, sources] = await Promise.all([
    api('/api/skills'),
    api('/api/skills/sources'),
  ]);
  if (!managed.ok) throw new Error(managed.error || 'skills API 不可用（请用 ./serve.sh 启动）');
  state.managed = managed.skills || [];
  state.sources = (sources && sources.sources) || {};
  // drop selected that no longer exist
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

function appendBubble(role, text, meta) {
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
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
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

  const abort = new AbortController();
  state.abort = abort;
  setSendBusy(true);
  appendBubble('user', message, [...state.selected].join(', ') || '无 skill');
  $('#chatInput').value = '';
  appendBubble('system', '发送中…');

  try {
    const out = await api('/api/chat', {
      method: 'POST',
      signal: abort.signal,
      body: JSON.stringify({
        message,
        skillIds: [...state.selected],
        config: configOverride,
      }),
    });
    const log = $('#chatLog');
    const last = log.lastElementChild;
    if (last && last.classList.contains('bubble-system')) last.remove();

    if (!out.ok) {
      appendBubble('system', `失败：${out.error || JSON.stringify(out.detail || out)}`);
      toast(out.error || '调用失败', 'err');
    } else {
      const meta = out.meta
        ? `mode=${out.meta.mode} · skills=${(out.meta.skillIds || []).join(',') || '-'} · model=${out.meta.model || '-'}`
        : '';
      appendBubble('assistant', out.reply || '(空回执)', meta);
    }
  } catch (err) {
    const log = $('#chatLog');
    const last = log.lastElementChild;
    if (last && last.classList.contains('bubble-system')) last.remove();
    if (err?.name === 'AbortError' || abort.signal.aborted) {
      appendBubble('system', '已取消');
      toast('已取消等待', 'info');
    } else {
      appendBubble('system', String(err));
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
    toast('已刷新', 'ok');
  } catch (e) {
    toast(String(e.message || e), 'err');
  }
});
$('#btnSend').addEventListener('click', () => {
  if (state.busy) cancelChat();
  else sendChat();
});
$('#chatInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (!state.busy) sendChat();
  }
});

(async function boot() {
  try {
    const health = await api('/api/health');
    if (!health.ok) throw new Error('API 不可用');
    $('#apiStatus').textContent = 'API 已连接';
    $('#apiStatus').dataset.ok = '1';
    await refreshSkills();
    await refreshConfig();
  } catch (e) {
    $('#apiStatus').textContent = 'API 未连接 — 请用 ./serve.sh 启动';
    $('#apiStatus').dataset.ok = '0';
    appendBubble('system', String(e.message || e) + '\n静态 python -m http.server 没有 /api/*，需 scripts/agent_server.py。');
  }
})();
