// @ts-nocheck

/** Auto-ported from hub.html */

import { summarizeEpisode, aggregateEpisodes, extractProvenance } from '../../lib/legacy/advanced_cd.js';
import {
  loadRobotRegistry,
  listRobots,
  validateEpisodeAgainstRegistry,
} from '../../lib/legacy/robots_registry.js';
import { hasObservation, getCameras } from '../../lib/legacy/obs_align.js';
import { analyzeTaskEpisode, outcomeTagClass } from '../../lib/legacy/task_events.js';
import {
  createLoader,
  withLoader,
  hideLoader,
} from '../../lib/legacy/loading.js';

export function mountHub(): void {
const DATA_ROOT = '/data';
const SKIP_JSON = new Set(['index.json', 'catalog.json', 'manifest.json']);

const $ = (id) => document.getElementById(id);
const rows = []; // { id, label, model, path, summary }
let robotRegistry = null;
let epPage = 1;
let epPageSize = 25;
const pageLoader = createLoader(document.querySelector('.hub-page'), { mode: 'page', id: 'hubPageLoader' });
hideLoader(pageLoader);

function fmt(x, d = 2) {
  return Number.isFinite(x) ? x.toFixed(d) : '—';
}
function pct(x) {
  return Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '—';
}

async function fetchJson(path) {
  const res = await fetch(path + (path.includes('?') ? '&' : '?') + '_=' + Date.now());
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

async function ensureRobotRegistry() {
  if (robotRegistry) return robotRegistry;
  robotRegistry = await loadRobotRegistry('/config/robots.json');
  return robotRegistry;
}

/**
 * 解析 Python http.server 目录页中的链接。
 * @returns {{ name: string, isDir: boolean }[]}
 */
function parseDirListing(html) {
  const out = [];
  const re = /href=["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    let href = m[1];
    try { href = decodeURIComponent(href); } catch (_) { /* keep raw */ }
    if (!href || href === '../' || href.startsWith('?') || href.startsWith('#') || href.startsWith('/')) continue;
    if (href.startsWith('http:') || href.startsWith('https:')) continue;
    const isDir = href.endsWith('/');
    const name = href.replace(/\/$/, '').split('/').pop();
    if (!name || name === '.' || name === '..') continue;
    if (name.startsWith('.')) continue;
    out.push({ name, isDir });
  }
  const seen = new Set();
  return out.filter((x) => {
    const k = `${x.isDir ? 'd' : 'f'}:${x.name}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function listDir(url) {
  const base = url.endsWith('/') ? url : `${url}/`;
  const res = await fetch(base + '?_=' + Date.now());
  if (!res.ok) throw new Error(`无法列出 ${base} → ${res.status}`);
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  const text = await res.text();
  if (ct.includes('json')) {
    // unexpected JSON directory API — ignore
    throw new Error(`${base} 返回 JSON，无法作为目录列表`);
  }
  return parseDirListing(text);
}

async function discoverSuites() {
  try {
    const entries = await listDir(DATA_ROOT);
    const suites = entries.filter((e) => e.isDir).map((e) => e.name).sort();
    if (suites.length) return suites;
  } catch (_) { /* fall through */ }

  const idx = await fetchJson(`${DATA_ROOT}/index.json`);
  const suites = (idx.suites || []).map((s) => (typeof s === 'string' ? s : s.id)).filter(Boolean);
  if (!suites.length) throw new Error('data/ 下没有子目录，且 index.json 为空');
  return suites;
}

async function listEpisodeFiles(suiteId) {
  const dir = `${DATA_ROOT}/${suiteId}`;
  try {
    const entries = await listDir(dir);
    return entries
      .filter((e) => !e.isDir && e.name.toLowerCase().endsWith('.json'))
      .map((e) => e.name)
      .filter((n) => !SKIP_JSON.has(n.toLowerCase()))
      .sort();
  } catch (_) {
    const idx = await fetchJson(`${DATA_ROOT}/index.json`);
    const suite = (idx.suites || []).find((s) => (typeof s === 'string' ? s : s.id) === suiteId);
    if (!suite || typeof suite === 'string') return [];
    return (suite.episodes || []).slice().sort();
  }
}

function renderEpisodeTable() {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / epPageSize));
  if (epPage > totalPages) epPage = totalPages;
  if (epPage < 1) epPage = 1;

  const start = (epPage - 1) * epPageSize;
  const pageRows = rows.slice(start, start + epPageSize);

  $('epBody').innerHTML = pageRows.map((r) => {
    const u = r.summary.unit;
    const unitCls = u.ok ? 'ok' : 'bad';
    const obsLabel = r.has_obs
      ? (r.obs_cams?.length ? r.obs_cams.join(',') : 'yes')
      : '—';
    const oc = r.task?.outcome;
    const ocCls = outcomeTagClass(oc?.outcome);
    const taskLabel = oc?.available
      ? `${oc.outcome}${oc.reason_code ? '/' + oc.reason_code : ''}`
      : '—';
    return `<tr>
      <td>${r.id}</td>
      <td>${r.label}</td>
      <td>${r.summary.robot || '—'}</td>
      <td>${r.model || '—'}</td>
      <td>${r.summary.n_frames}</td>
      <td>${fmt(r.summary.mean_l2, 3)}</td>
      <td>${fmt(r.summary.tcp_ep_mean_mm)}</td>
      <td>${pct(r.summary.pass_both_rate)}</td>
      <td class="${ocCls}">${taskLabel}</td>
      <td class="${unitCls}">${u.inferred_unit || '—'}${u.issues.length ? '!' : ''}</td>
      <td>${r.summary.provenance.action_mode || '—'}</td>
      <td class="muted">${obsLabel}</td>
      <td><a href="/eval?data=${encodeURIComponent(r.path)}">评测</a></td>
    </tr>`;
  }).join('') || '<tr><td colspan="13" class="muted">暂无 episode</td></tr>';

  const pagination = $('epPagination');
  const pageInfo = $('epPageInfo');
  const prevBtn = $('epPagePrev');
  const nextBtn = $('epPageNext');
  const sizeSelect = $('epPageSize');
  if (!pagination || !pageInfo || !prevBtn || !nextBtn || !sizeSelect) return;

  if (total <= epPageSize) {
    pagination.hidden = true;
    return;
  }

  pagination.hidden = false;
  const from = start + 1;
  const to = Math.min(start + epPageSize, total);
  pageInfo.textContent = `第 ${epPage} / ${totalPages} 页 · 显示 ${from}–${to} / 共 ${total} 条`;
  prevBtn.disabled = epPage <= 1;
  nextBtn.disabled = epPage >= totalPages;
  if (String(epPageSize) !== sizeSelect.value) sizeSelect.value = String(epPageSize);
}

function render() {
  const agg = aggregateEpisodes(rows.map((r) => r.summary));
  $('aggStats').innerHTML = [
    ['episodes', agg.n],
    ['mean L2', fmt(agg.mean_l2, 3)],
    ['TCP e_p μ', fmt(agg.tcp_ep_mean_mm)],
    ['双阈值达标', pct(agg.pass_both_rate)],
    ['高达标 episode', `${agg.success_episodes ?? 0}`],
  ].map(([l, v]) => `<div class="stat"><div class="l">${l}</div><div class="v">${v}</div></div>`).join('');

  renderEpisodeTable();

  const byModel = new Map();
  for (const r of rows) {
    const m = r.model || 'default';
    if (!byModel.has(m)) byModel.set(m, []);
    byModel.get(m).push(r);
  }
  $('modelBody').innerHTML = [...byModel.entries()].map(([mid, list]) => {
    const aggM = aggregateEpisodes(list.map((x) => x.summary));
    const prov = list[0]?.summary.provenance || {};
    return `<tr>
      <td>${mid}</td>
      <td>${list.length}</td>
      <td>${fmt(aggM.mean_l2, 3)}</td>
      <td>${fmt(aggM.tcp_ep_mean_mm)}</td>
      <td>${pct(aggM.pass_both_rate)}</td>
      <td class="muted">${prov.ckpt || '—'} / ${prov.policy || '—'}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" class="muted">暂无模型</td></tr>';
}

async function enrichFromSidecar(path, summary) {
  try {
    const side = path.replace(/[^/]+\.json$/, 'eval_summary.json');
    if (side === path) return;
    const s = await fetchJson(side);
    if (s?.tcp?.summary) {
      summary.tcp_ep_mean_mm = s.tcp.summary.ep_mm?.mean ?? summary.tcp_ep_mean_mm;
      summary.tcp_eR_mean_deg = s.tcp.summary.eR_deg?.mean ?? summary.tcp_eR_mean_deg;
    }
  } catch (_) { /* optional */ }
}

async function ingest(path, { id, label, model } = {}) {
  const registry = await ensureRobotRegistry();
  const data = await fetchJson(path);
  const check = validateEpisodeAgainstRegistry(data, registry);
  if (!check.ok) {
    throw new Error(`${path} 防呆失败：${check.errors.join('；')}`);
  }
  const summary = summarizeEpisode(data, null);
  await enrichFromSidecar(path, summary);
  const base = path.split('/').pop().replace(/\.json$/i, '');
  const epId = id || base || `ep${rows.length}`;
  const task = analyzeTaskEpisode(data);
  rows.push({
    id: epId,
    label: label || data.meta?.title || epId,
    model: model || data.meta?.policy || data.meta?.model || 'default',
    path,
    summary,
    has_obs: hasObservation(data),
    obs_cams: getCameras(data.meta).map((c) => c.id),
    task,
  });
}

async function loadSuite(suiteId) {
  if (!suiteId) throw new Error('请选择数据套件');
  await withLoader(pageLoader, async (progress) => {
    const registry = await ensureRobotRegistry();
    rows.length = 0;
    epPage = 1;
    progress(0.06, `扫描 ${DATA_ROOT}/${suiteId}/`, '列出 episode 文件');
    const files = await listEpisodeFiles(suiteId);
    const skipped = [];
    const total = Math.max(files.length, 1);
    for (let i = 0; i < files.length; i++) {
      const name = files[i];
      progress(0.1 + 0.82 * ((i + 1) / total), `加载 ${name}`, `${i + 1} / ${files.length}`);
      const path = `${DATA_ROOT}/${suiteId}/${name}`;
      try {
        const data = await fetchJson(path);
        const check = validateEpisodeAgainstRegistry(data, registry);
        if (!check.ok) {
          skipped.push(`${name}（${check.errors[0] || '校验失败'}）`);
          continue;
        }
        const summary = summarizeEpisode(data, null);
        await enrichFromSidecar(path, summary);
        const epId = name.replace(/\.json$/i, '');
        const task = analyzeTaskEpisode(data);
        rows.push({
          id: epId,
          label: data.meta?.title || epId,
          model: data.meta?.policy || data.meta?.model || 'default',
          path,
          summary,
          has_obs: hasObservation(data),
          obs_cams: getCameras(data.meta).map((c) => c.id),
          task,
        });
      } catch (e) {
        skipped.push(`${name}（${e.message}）`);
      }
    }
    const known = listRobots(registry).map((r) => r.id).join(', ');
    let msg = `套件 ${suiteId} · 已加载 ${rows.length} episode · 可用机型 [${known}]`;
    if (files.length === 0) msg += ' · 目录下无 .json';
    if (skipped.length) msg += ` · 跳过 ${skipped.length}：${skipped.join('；')}`;
    progress(0.96, '渲染表格…', msg);
    $('status').textContent = msg;
    render();
  }, { text: `加载套件 ${suiteId}`, detail: '读取 episode JSON' });
}

async function refreshSuiteSelect(preferred) {
  const sel = $('suiteSelect');
  sel.disabled = true;
  sel.innerHTML = '<option value="">扫描中…</option>';
  try {
    return await withLoader(pageLoader, async (progress) => {
      progress(0.2, '扫描 data/ 套件…', '读取 index.json');
      const suites = await discoverSuites();
      const placeholder = '<option value="">请选择数据套件</option>';
      sel.innerHTML = suites.length
        ? placeholder + suites.map((id) => `<option value="${id}">${id}</option>`).join('')
        : '<option value="">（无可用套件）</option>';
      sel.disabled = !suites.length;
      // Only preselect when caller asks (e.g. ?suite= or reload preserving current).
      // Fresh Hub entry uses preferred='' → show placeholder, do not auto-pick.
      const pick = preferred && suites.includes(preferred) ? preferred : '';
      sel.value = pick;
      sel.classList.toggle('placeholder', !pick);
      progress(0.9, '套件列表就绪', pick || (suites.length ? '待选择' : '无可用套件'));
      return pick;
    }, { text: '扫描数据套件', detail: 'data/' });
  } catch (e) {
    sel.innerHTML = '<option value="">扫描失败</option>';
    throw e;
  }
}

async function loadManifest(path) {
  await withLoader(pageLoader, async (progress) => {
    rows.length = 0;
    epPage = 1;
    const registry = await ensureRobotRegistry();
    progress(0.12, `加载 manifest`, path);
    const man = await fetchJson(path);
    const thr = man.thresholds || {};
    const skipped = [];
    const episodes = man.episodes || [];
    const total = Math.max(episodes.length, 1);
    for (let i = 0; i < episodes.length; i++) {
      const ep = episodes[i];
      progress(0.15 + 0.8 * ((i + 1) / total), `加载 ${ep.id || ep.path}`, `${i + 1} / ${episodes.length}`);
      const data = await fetchJson(ep.path);
      const check = validateEpisodeAgainstRegistry(data, registry);
      if (!check.ok) {
        skipped.push(`${ep.id || ep.path}（${check.errors[0] || '校验失败'}）`);
        continue;
      }
      const summary = summarizeEpisode(data, null, thr);
      rows.push({
        id: ep.id,
        label: ep.label || summary.title,
        model: ep.model || summary.provenance.policy || 'default',
        path: ep.path,
        summary,
      });
    }
    let msg = `已加载 ${rows.length} episode · ${man.title || path}`;
    if (skipped.length) msg += ` · 跳过 ${skipped.length}：${skipped.join('；')}`;
    $('status').textContent = msg;
    render();
  }, { text: '加载 manifest', detail: path });
}

$('btnReloadSuites').onclick = () => {
  const current = $('suiteSelect').value;
  refreshSuiteSelect(current).then((id) => {
    $('status').textContent = id
      ? `已刷新套件列表 · 当前 ${id}`
      : '已刷新套件列表 · 请选择数据套件';
  }).catch((e) => {
    $('status').innerHTML = `<span class="bad">${e.message}</span>`;
  });
};

$('btnLoadSuite').onclick = () => {
  loadSuite($('suiteSelect').value).catch((e) => {
    $('status').innerHTML = `<span class="bad">${e.message}</span>`;
  });
};

$('suiteSelect').addEventListener('change', () => {
  const id = $('suiteSelect').value;
  $('suiteSelect').classList.toggle('placeholder', !id);
  if (!id) return;
  loadSuite(id).catch((e) => {
    $('status').innerHTML = `<span class="bad">${e.message}</span>`;
  });
});

$('btnLoad').onclick = () => loadManifest($('manifestPath').value.trim()).catch((e) => {
  $('status').innerHTML = `<span class="bad">${e.message}</span>`;
});

$('btnAdd').onclick = async () => {
  const raw = $('extraPaths').value.trim();
  if (!raw) return;
  try {
    for (const p of raw.split(',').map((s) => s.trim()).filter(Boolean)) {
      await ingest(p);
    }
    $('status').textContent = `当前 ${rows.length} 条`;
    render();
  } catch (e) {
    $('status').innerHTML = `<span class="bad">${e.message}</span>`;
  }
};

$('epPagePrev').onclick = () => {
  if (epPage <= 1) return;
  epPage -= 1;
  renderEpisodeTable();
};

$('epPageNext').onclick = () => {
  const totalPages = Math.max(1, Math.ceil(rows.length / epPageSize));
  if (epPage >= totalPages) return;
  epPage += 1;
  renderEpisodeTable();
};

$('epPageSize').onchange = () => {
  const next = Number($('epPageSize').value);
  epPageSize = Number.isFinite(next) && next > 0 ? next : 25;
  epPage = 1;
  renderEpisodeTable();
};

(async () => {
  try {
    await ensureRobotRegistry();
    const qs = new URLSearchParams(location.search);
    // Only auto-load when URL explicitly asks (?suite=...); otherwise show placeholder.
    const preferred = qs.get('suite') || '';
    const id = await refreshSuiteSelect(preferred);
    if (id) await loadSuite(id);
    else {
      $('status').textContent = preferred
        ? `未找到套件 ${preferred}，请重新选择`
        : '请选择数据套件后加载';
      render();
    }
  } catch (e) {
    $('status').innerHTML = `<span class="warn">初始化失败：${e.message}</span>`;
    render();
  }
})();
}
