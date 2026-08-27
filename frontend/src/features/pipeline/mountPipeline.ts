// @ts-nocheck

import { t, onLocaleChange } from '../../i18n/runtime';

/** Auto-ported from pipeline.html */

import {
  FlowCanvas,
  PIPELINES,
  graphKey,
  applyServerGraphs,
  exportCanonicalGraphs,
} from '../../lib/legacy/pipeline_flow.js';
import {
  createLoader,
  withLoader,
  hideLoader,
} from '../../lib/legacy/loading.js';

export async function mountPipeline(): Promise<void> {

const stageLoader = createLoader(document.querySelector('.pipeline-page .stage-wrap'), {
  id: 'pipelineStageLoader',
});
hideLoader(stageLoader);
const btnSaveGraph = document.getElementById('btnSaveGraph');
const saveStatus = document.getElementById('saveStatus');

const flow = new FlowCanvas({
  stage: document.getElementById('flowStage'),
  canvas: document.getElementById('flowCanvas'),
  detailEl: document.getElementById('nodeDetail'),
  titleEl: document.getElementById('graphTitle'),
  blurbEl: document.getElementById('graphBlurb'),
  onDirtyChange: (dirty) => {
    btnSaveGraph.classList.toggle('dirty', dirty);
    if (dirty) {
      saveStatus.textContent = t('pipeline.unsaved');
      saveStatus.className = 'save-status';
    }
  },
});

const layoutEl = document.getElementById('pipelineLayout');
if (!layoutEl) {
  console.error('pipeline: #pipelineLayout not found');
  return;
}
const SIDE_KEY = 'pipeline_side_collapsed';
function setSideCollapsed(collapsed) {
  layoutEl.classList.toggle('side-collapsed', collapsed);
  try { sessionStorage.setItem(SIDE_KEY, collapsed ? '1' : '0'); } catch (_) {}
  requestAnimationFrame(() => flow.fitView());
}
const btnHideSide = document.getElementById('btnHideSide');
const btnShowSide = document.getElementById('btnShowSide');
if (btnHideSide) btnHideSide.addEventListener('click', () => setSideCollapsed(true));
if (btnShowSide) btnShowSide.addEventListener('click', () => setSideCollapsed(false));
try {
  if (sessionStorage.getItem(SIDE_KEY) === '1') layoutEl.classList.add('side-collapsed');
} catch (_) {}

const pipelineSelect = document.getElementById('pipelineSelect');
const btnTrain = document.getElementById('btnTrain');
const btnInfer = document.getElementById('btnInfer');
const btnAnim = document.getElementById('btnAnim');

pipelineSelect.innerHTML = PIPELINES.map((p) => {
  const descKey = `pipeline.family.${p.id}`;
  const labelKey = `pipeline.family.${p.id}.label`;
  const desc = t(descKey);
  const label = t(labelKey);
  const descText = desc && desc !== descKey ? desc : p.desc;
  const labelText = label && label !== labelKey ? label : p.label;
  return `<option value="${p.id}" title="${descText}">${labelText}</option>`;
}).join('');

let mode = 'train';

function refresh() {
  const pipelineId = pipelineSelect.value || 'sam2grasp';
  const meta = PIPELINES.find((p) => p.id === pipelineId);
  if (btnTrain) btnTrain.classList.toggle('active', mode === 'train');
  if (btnInfer) btnInfer.classList.toggle('active', mode === 'infer');
  flow.setGraph(graphKey(pipelineId, mode));
  if (meta && flow.blurbEl) {
    // keep graph blurb; append family hint in title already from graph
  }
  flow.fitView();
  flow.stopAnim();
  if (btnAnim) {
    btnAnim.textContent = t('pipeline.btnAnim');
    btnAnim.classList.remove('active');
  }
}

async function loadServerGraphs() {
  await withLoader(stageLoader, async (progress) => {
    progress(0.2, t('pipeline.loaderGraphs'), 'pipeline_graphs.json');
    try {
      const res = await fetch('/api/pipeline/graphs', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      progress(0.75, t('pipeline.loaderApply'), t('pipeline.graphsCount', { n: Object.keys(data.graphs || {}).length }));
      const n = applyServerGraphs(data.graphs || {});
      if (n > 0) {
        saveStatus.textContent = t('pipeline.graphsLoaded', { n });
        saveStatus.className = 'save-status ok';
      }
      progress(1, t('pipeline.loaderReady'), n > 0 ? t('pipeline.graphsLoadedDetail', { n }) : t('pipeline.loaderDefault'));
    } catch (err) {
      console.warn('pipeline graphs load skipped', err);
      progress(1, t('pipeline.loaderDefault'), String(err.message || err));
    }
  }, { text: t('pipeline.loaderTitle'), detail: '/api/pipeline/graphs' });
}

async function saveGraphsToServer() {
  flow.commitGraphToStore();
  btnSaveGraph.disabled = true;
  saveStatus.textContent = t('pipeline.saving');
  saveStatus.className = 'save-status';
  try {
    const res = await fetch('/api/pipeline/graphs', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graphs: exportCanonicalGraphs() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    flow.markDirty(false);
    saveStatus.textContent = t('pipeline.saved', { path: data.path || 'config/pipeline_graphs.json' });
    saveStatus.className = 'save-status ok';
  } catch (err) {
    saveStatus.textContent = t('pipeline.saveFail', { msg: err.message || err });
    saveStatus.className = 'save-status err';
  } finally {
    btnSaveGraph.disabled = false;
  }
}

pipelineSelect.addEventListener('change', refresh);
if (btnTrain) btnTrain.addEventListener('click', () => { mode = 'train'; refresh(); });
if (btnInfer) btnInfer.addEventListener('click', () => { mode = 'infer'; refresh(); });
const btnFit = document.getElementById('btnFit');
if (btnFit) btnFit.addEventListener('click', () => flow.fitView());
if (btnSaveGraph) btnSaveGraph.addEventListener('click', () => { saveGraphsToServer(); });
if (btnAnim) btnAnim.addEventListener('click', () => {
  if (flow.animating) {
    flow.stopAnim();
    btnAnim.textContent = t('pipeline.btnAnim');
    btnAnim.classList.remove('active');
  } else {
    flow.startAnim();
    btnAnim.textContent = t('pipeline.btnAnimStop');
    btnAnim.classList.add('active');
  }
});

// ---- Recording (composite stage → WebM) ----
const btnRecStart = document.getElementById('btnRecStart');
const btnRecStop = document.getElementById('btnRecStop');
const btnRecSave = document.getElementById('btnRecSave');
const recStatus = document.getElementById('recStatus');
const recPill = document.getElementById('recPill');
const recTimerEl = document.getElementById('recTimer');

if (btnRecStart && btnRecStop && btnRecSave && recStatus && recPill) {
let mediaRecorder = null;
let recChunks = [];
let recBlob = null;
let recStartedAt = 0;
let recTimerId = null;
let captureHandle = null;
let recAutoAnim = false;

function formatMMSS(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function pickMimeType() {
  const cands = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const t of cands) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

function setRecUI(state) {
  btnRecStart.disabled = state === 'recording';
  btnRecStop.disabled = state !== 'recording';
  btnRecSave.disabled = state !== 'ready';
  btnRecStart.classList.toggle('recording', state === 'recording');
  btnRecStop.classList.toggle('recording', state === 'recording');
  recPill.classList.toggle('on', state === 'recording');
  recStatus.classList.toggle('hot', state === 'recording');
}

function syncAnimButton() {
  btnAnim.textContent = flow.animating ? t('pipeline.btnAnimStop') : t('pipeline.btnAnim');
  btnAnim.classList.toggle('active', flow.animating);
}

function isTypingTarget(el) {
  if (!el) return false;
  const tag = (el.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
}

btnRecStart.addEventListener('click', () => {
  if (typeof flow.beginCapture !== 'function') {
    recStatus.textContent = t('pipeline.recModuleMissing');
    return;
  }
  if (!window.MediaRecorder) {
    recStatus.textContent = t('pipeline.recNoMediaRecorder');
    return;
  }
  const mime = pickMimeType();
  if (!mime) {
    recStatus.textContent = t('pipeline.recNoWebm');
    return;
  }
  try {
    recAutoAnim = !flow.animating;
    if (recAutoAnim) {
      flow.startAnim();
      syncAnimButton();
    }
    captureHandle = flow.beginCapture(30);
    if (!captureHandle || !captureHandle.stream) {
      throw new Error(t('pipeline.recCaptureFail'));
    }
    const stream = captureHandle.stream;
    recChunks = [];
    recBlob = null;
    mediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5_000_000 });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) recChunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      recBlob = new Blob(recChunks, { type: mime.split(';')[0] });
      stream.getTracks().forEach((t) => t.stop());
      captureHandle?.stop();
      captureHandle = null;
      if (recAutoAnim) {
        flow.stopAnim();
        syncAnimButton();
        recAutoAnim = false;
      }
      if (recTimerId) { clearInterval(recTimerId); recTimerId = null; }
      const sec = ((performance.now() - recStartedAt) / 1000).toFixed(1);
      const mb = (recBlob.size / (1024 * 1024)).toFixed(2);
      recStatus.textContent = t('pipeline.recStopped', { sec, mb });
      setRecUI('ready');
    };
    mediaRecorder.start(200);
    recStartedAt = performance.now();
    if (recTimerEl) recTimerEl.textContent = '00:00';
    recTimerId = setInterval(() => {
      if (recTimerEl) recTimerEl.textContent = formatMMSS(performance.now() - recStartedAt);
    }, 250);
    recStatus.textContent = t('pipeline.recording');
    setRecUI('recording');
  } catch (e) {
    console.error(e);
    captureHandle?.stop();
    captureHandle = null;
    if (recAutoAnim) {
      flow.stopAnim();
      syncAnimButton();
      recAutoAnim = false;
    }
    recStatus.textContent = t('pipeline.recStartFail', { msg: e && e.message ? e.message : e });
    setRecUI('idle');
  }
});

btnRecStop.addEventListener('click', () => {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
  }
});

btnRecSave.addEventListener('click', () => {
  if (!recBlob) return;
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  a.href = URL.createObjectURL(recBlob);
  a.download = `embody_pipeline_${stamp}.webm`;
  a.click();
  URL.revokeObjectURL(a.href);
  recStatus.textContent = t('pipeline.recDownloaded', { filename: a.download });
});

window.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return;
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  const key = (e.key || '').toLowerCase();
  if (key === 'r' && !e.shiftKey) {
    e.preventDefault();
    if (!btnRecStart.disabled) btnRecStart.click();
    return;
  }
  if (key === 't') {
    e.preventDefault();
    if (!btnRecStop.disabled) btnRecStop.click();
    return;
  }
  if (key === 's') {
    e.preventDefault();
    if (!btnRecSave.disabled) btnRecSave.click();
  }
});

setRecUI('idle');
}

await loadServerGraphs();
refresh();
onLocaleChange(() => refresh());

}
