/**
 * Robot gallery — pick a model from robots.json and view its URDF in 3D.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import URDFLoader from 'urdf-loader';
import { mountPageNav } from './nav_pages.js';
import {
  loadRobotRegistry,
  listRobots,
  normalizeRobotProfile,
} from './robots_registry.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

mountPageNav(document.getElementById('pageNavRoot'), { currentId: 'robots' });

const els = {
  select: document.getElementById('robotSelect'),
  count: document.getElementById('robotCount'),
  title: document.getElementById('robotTitle'),
  desc: document.getElementById('robotDesc'),
  meta: document.getElementById('metaGrid'),
  joints: document.getElementById('jointList'),
  err: document.getElementById('statusErr'),
  viewer: document.getElementById('viewer'),
  loading: document.getElementById('loading'),
  loadText: document.getElementById('loadText'),
  loadBar: document.getElementById('loadBar'),
  loadMeta: document.getElementById('loadMeta'),
};

let registry = null;
let profiles = [];
let active = null;
let arm = null;
let loadToken = 0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b1018);
const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 40);
camera.position.set(0.85, 0.55, 0.95);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
els.viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0.2, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 0.85);
key.position.set(2.2, 3.4, 1.6);
scene.add(key);
const fill = new THREE.DirectionalLight(0xa8c4ff, 0.35);
fill.position.set(-2, 1.2, -1.5);
scene.add(fill);

const grid = new THREE.GridHelper(2.4, 24, 0x3a4d66, 0x1e2a3c);
grid.position.y = 0;
scene.add(grid);
const axes = new THREE.AxesHelper(0.18);
scene.add(axes);

function setLoadProgress(p, text, meta = '') {
  els.loading.hidden = false;
  els.loadText.textContent = text || '加载中…';
  els.loadBar.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
  els.loadMeta.textContent = meta || '';
}

function hideLoading() {
  els.loading.hidden = true;
}

function showError(msg) {
  els.err.hidden = !msg;
  els.err.textContent = msg || '';
}

function softMaterial(robot) {
  robot.traverse((c) => {
    if (!c.isMesh || !c.material) return;
    const mats = Array.isArray(c.material) ? c.material : [c.material];
    mats.forEach((m) => {
      if (!m) return;
      if (m.opacity < 1) {
        m.transparent = true;
        m.depthWrite = false;
      }
    });
  });
}

function loadRobot(urdfUrl, { onProgress, rootEulerDeg } = {}) {
  return new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    let robot = null;
    let settled = false;
    let meshesDone = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err instanceof Error ? err : new Error(String(err)));
    };
    const finish = () => {
      // LoadingManager.onLoad can race ahead of URDF onComplete (cached STLs).
      if (settled || !robot || !meshesDone) return;
      settled = true;
      clearTimeout(timer);
      softMaterial(robot);
      onProgress?.(1);
      resolve(robot);
    };
    const markMeshesDone = () => {
      meshesDone = true;
      finish();
    };
    const timer = setTimeout(() => {
      fail(new Error(`加载超时：${urdfUrl}`));
    }, 60000);
    manager.onProgress = (_url, loaded, total) => {
      const t = total > 0 ? loaded / total : 0;
      onProgress?.(Math.min(0.99, t));
    };
    manager.onLoad = markMeshesDone;
    manager.onError = (url) => fail(new Error('资源加载失败: ' + url));
    const loader = new URDFLoader(manager);
    loader.packages = '';
    loader.workingPath = urdfUrl.replace(/[^/]+$/, '');
    loader.load(
      urdfUrl,
      (r) => {
        robot = r;
        robot.ignoreLimits = true;
        const e = rootEulerDeg || [0, 0, 0];
        robot.rotation.set(
          (Number(e[0]) || 0) * DEG2RAD,
          (Number(e[1]) || 0) * DEG2RAD,
          (Number(e[2]) || 0) * DEG2RAD,
        );
        // If manager already finished while robot was still null, complete now.
        if (!manager.isLoading) markMeshesDone();
        else queueMicrotask(() => {
          if (!manager.isLoading) markMeshesDone();
          else finish();
        });
      },
      undefined,
      (err) => fail(err),
    );
  });
}

function setPose(robot, jointNames, qDeg) {
  if (!robot) return;
  for (let i = 0; i < jointNames.length; i++) {
    const joint = robot.joints?.[jointNames[i]];
    if (!joint) continue;
    joint.ignoreLimits = true;
    joint.setJointValue((Number(qDeg[i]) || 0) * DEG2RAD);
  }
  robot.updateMatrixWorld(true);
}

function fitCamera(robot) {
  if (!robot) return;
  const box = new THREE.Box3().setFromObject(robot);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.2);
  const dist = maxDim * 1.85;
  controls.target.copy(center);
  camera.position.set(center.x + dist * 0.75, center.y + dist * 0.45, center.z + dist * 0.85);
  camera.near = Math.max(0.005, dist / 200);
  camera.far = Math.max(40, dist * 20);
  camera.updateProjectionMatrix();
  controls.update();
}

function resize() {
  const w = els.viewer.clientWidth || 1;
  const h = els.viewer.clientHeight || 1;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}

function readJointDeg(name) {
  const joint = arm?.joints?.[name];
  if (!joint) return 0;
  return (joint.angle || 0) * RAD2DEG;
}

function renderMeta(profile) {
  els.title.textContent = profile.label;
  els.desc.textContent = profile.description || `机型 id：${profile.id}`;
  const rows = [
    ['id', profile.id],
    ['URDF', profile.urdf.preview || profile.urdf.cur],
    ['自由度', String(profile.joint_names.length)],
    ['TCP link', profile.tcp.link],
    ['TCP offset', profile.tcp.offset.map((x) => Number(x).toFixed(4)).join(', ')],
  ];
  els.meta.innerHTML = rows.map(([k, v]) =>
    `<div class="meta-item"><div class="k">${k}</div><div class="v">${v}</div></div>`,
  ).join('');
}

function renderJointSliders(profile) {
  els.joints.innerHTML = '';
  profile.joint_names.forEach((name, i) => {
    const row = document.createElement('div');
    row.className = 'joint-row';
    const val = readJointDeg(name);
    row.innerHTML = `
      <label><span>${name}</span><strong data-i="${i}">${val.toFixed(1)}°</strong></label>
      <input type="range" min="-180" max="180" step="0.5" value="${val}" data-joint="${name}" />
    `;
    const input = row.querySelector('input');
    const label = row.querySelector('strong');
    input.addEventListener('input', () => {
      if (!arm || !active) return;
      const q = active.joint_names.map((n) => readJointDeg(n));
      q[i] = Number(input.value);
      setPose(arm, active.joint_names, q);
      label.textContent = `${Number(input.value).toFixed(1)}°`;
    });
    els.joints.appendChild(row);
  });
}

function syncSliderLabels() {
  if (!active) return;
  active.joint_names.forEach((name, i) => {
    const input = els.joints.querySelector(`input[data-joint="${name}"]`);
    const label = els.joints.querySelector(`strong[data-i="${i}"]`);
    if (!input || !label) return;
    const v = readJointDeg(name);
    input.value = String(v);
    label.textContent = `${v.toFixed(1)}°`;
  });
}

async function loadProfile(profile) {
  const token = ++loadToken;
  active = profile;
  showError('');
  renderMeta(profile);
  els.joints.innerHTML = '';
  setLoadProgress(0.05, `加载 ${profile.label}…`, profile.urdf.preview || profile.urdf.cur);

  if (arm) {
    scene.remove(arm);
    arm = null;
  }

  try {
    const robot = await loadRobot(profile.urdf.preview || profile.urdf.cur, {
      rootEulerDeg: profile.root_rotation_euler_xyz_deg,
      onProgress: (p) => {
        if (token !== loadToken) return;
        setLoadProgress(0.08 + p * 0.9, `加载 ${profile.label}…`, `${Math.round(p * 100)}%`);
      },
    });
    if (token !== loadToken) return;
    arm = robot;
    scene.add(arm);
    const home = profile.home_q_deg?.length === profile.joint_names.length
      ? profile.home_q_deg
      : profile.joint_names.map(() => 0);
    setPose(arm, profile.joint_names, home);
    renderJointSliders(profile);
    fitCamera(arm);
    hideLoading();
  } catch (e) {
    if (token !== loadToken) return;
    hideLoading();
    showError(e?.message || String(e));
    els.joints.innerHTML = '';
  }
}

function populateSelect(defaultId) {
  const items = listRobots(registry);
  els.select.innerHTML = items.map((r) =>
    `<option value="${r.id}">${r.label} (${r.id})</option>`,
  ).join('');
  els.count.textContent = `${items.length} 机型`;
  const prefer = defaultId
    || new URLSearchParams(location.search).get('robot')
    || registry.default
    || items[0]?.id;
  if (prefer && items.some((r) => r.id === prefer)) els.select.value = prefer;
}

async function boot() {
  setLoadProgress(0.02, '加载机械臂配置…', 'robots.json');
  registry = await loadRobotRegistry('./robots.json');
  profiles = Object.keys(registry.robots || {}).map((id) =>
    normalizeRobotProfile(registry.robots[id], id),
  );
  populateSelect();
  const id = els.select.value;
  const profile = profiles.find((p) => p.id === id) || profiles[0];
  if (!profile) throw new Error('robots.json 中没有可用机型');
  await loadProfile(profile);
}

els.select.addEventListener('change', () => {
  const profile = profiles.find((p) => p.id === els.select.value);
  if (!profile) return;
  const url = new URL(location.href);
  url.searchParams.set('robot', profile.id);
  history.replaceState(null, '', url);
  loadProfile(profile);
});

document.getElementById('btnHome').addEventListener('click', () => {
  if (!arm || !active) return;
  const home = active.home_q_deg?.length === active.joint_names.length
    ? active.home_q_deg
    : active.joint_names.map(() => 0);
  setPose(arm, active.joint_names, home);
  syncSliderLabels();
});

document.getElementById('btnZero').addEventListener('click', () => {
  if (!arm || !active) return;
  setPose(arm, active.joint_names, active.joint_names.map(() => 0));
  syncSliderLabels();
});

document.getElementById('btnFit').addEventListener('click', () => fitCamera(arm));

window.addEventListener('resize', resize);
resize();

(function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
})();

boot().catch((e) => {
  hideLoading();
  showError(e?.message || String(e));
});
