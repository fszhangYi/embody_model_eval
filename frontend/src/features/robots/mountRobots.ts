// @ts-nocheck

/** Auto-ported */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import URDFLoader from 'urdf-loader';
import {
  loadRobotRegistry,
  listRobots,
  normalizeRobotProfile,
} from '../../lib/legacy/robots_registry.js';
import { mountViewTools } from '../../lib/legacy/view_tools.js';

export function mountRobots(): void {
const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;



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

mountViewTools(els.viewer, controls, {
  onFit: () => fitCamera(arm),
});

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

function loadRobot(urdfUrl, { onProgress, rootEulerDeg, modelScale } = {}) {
  return new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    // URDF 结构一就绪就结束 loading；网格会异步补进场景，避免卡在 99%。
    const hardTimer = setTimeout(() => {
      fail(new Error(`加载超时：${urdfUrl}`));
    }, 30000);

    manager.onProgress = (_url, loaded, total) => {
      if (settled || total <= 0) return;
      // 仅作参考进度；完成态由 URDF 回调决定
      onProgress?.(Math.min(0.95, loaded / total));
    };
    manager.onError = (url) => {
      console.warn('[robots_view] asset error', url);
    };

    const loader = new URDFLoader(manager);
    loader.parseCollision = false;
    loader.packages = '';
    // Strip query so mesh resolve stays under ec616/
    const cleanUrl = urdfUrl.split('?')[0];
    loader.workingPath = cleanUrl.replace(/[^/]+$/, '');

    loader.load(
      urdfUrl,
      (robot) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        try {
          robot.ignoreLimits = true;
          const e = rootEulerDeg || [0, 0, 0];
          robot.rotation.set(
            (Number(e[0]) || 0) * DEG2RAD,
            (Number(e[1]) || 0) * DEG2RAD,
            (Number(e[2]) || 0) * DEG2RAD,
          );
          const s = Number(modelScale);
          robot.scale.setScalar(Number.isFinite(s) && s > 0 ? s : 1);
          softMaterial(robot);
          onProgress?.(1);
          resolve(robot);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      },
      undefined,
      (err) => fail(err),
    );
  });
}

/** Controllable joints: profile order first, then any extra revolute/continuous from URDF. */
function resolveJointNames(profile, robot) {
  const preferred = Array.isArray(profile.joint_names) ? profile.joint_names.slice() : [];
  const fromUrdf = [];
  if (robot?.joints) {
    for (const [name, joint] of Object.entries(robot.joints)) {
      const t = joint.jointType || joint.type;
      if (t === 'revolute' || t === 'continuous' || t === 'prismatic') {
        fromUrdf.push(name);
      }
    }
  }
  const seen = new Set();
  const out = [];
  for (const n of preferred.concat(fromUrdf)) {
    if (!n || seen.has(n)) continue;
    if (robot?.joints && !robot.joints[n]) continue;
    seen.add(n);
    out.push(n);
  }
  return out.length ? out : preferred;
}

function setPose(robot, jointNames, qDeg) {
  if (!robot) return;
  const qMap = {};
  for (let i = 0; i < jointNames.length; i++) {
    qMap[jointNames[i]] = Number(qDeg[i]) || 0;
  }
  // Open command is shared; gripper_2 is mesh-mirrored so drive opposite sign.
  if (qMap.gripper_1_joint != null && robot.joints?.gripper_2_joint) {
    const cmd = qMap.gripper_1_joint;
    qMap.gripper_1_joint = cmd;
    qMap.gripper_2_joint = -cmd;
  } else if (qMap.gripper_2_joint != null && robot.joints?.gripper_1_joint) {
    const cmd = qMap.gripper_2_joint;
    qMap.gripper_1_joint = cmd;
    qMap.gripper_2_joint = -cmd;
  }
  for (const [name, deg] of Object.entries(qMap)) {
    const joint = robot.joints?.[name];
    if (!joint) continue;
    joint.ignoreLimits = true;
    joint.setJointValue(deg * DEG2RAD);
  }
  robot.updateMatrixWorld(true);
}

function fitCamera(robot) {
  if (!robot) return;
  const box = new THREE.Box3().setFromObject(robot);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (![size.x, size.y, size.z, center.x, center.y, center.z].every(Number.isFinite)) return;
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
  let deg = (joint.angle || 0) * RAD2DEG;
  if (name === 'gripper_2_joint') deg = -deg;
  return deg;
}

function renderMeta(profile) {
  els.title.textContent = profile.label;
  els.desc.textContent = profile.description || `机型 id：${profile.id}`;
  const rows = [
    ['id', profile.id],
    ['URDF', profile.urdf.preview || profile.urdf.cur],
    ['自由度', String(profile.joint_names.length)],
    ['显示缩放', String(profile.model_scale ?? 1)],
    ['TCP link', profile.tcp.link],
    ['TCP offset', profile.tcp.offset.map((x) => Number(x).toFixed(4)).join(', ')],
    ['TCP 标定', (profile.tcp.calibration?.xyz || [0, 0, 0]).map((x) => Number(x).toFixed(4)).join(', ')],
    ['碰撞', profile.collision?.method || 'hull'],
    ['限位条目', String(Object.keys(profile.joint_limits || {}).length)],
  ];
  els.meta.innerHTML = rows.map(([k, v]) =>
    `<div class="meta-item"><div class="k">${k}</div><div class="v">${v}</div></div>`,
  ).join('');
}

function renderJointSliders(profile, jointNames) {
  els.joints.innerHTML = '';
  const names = jointNames || resolveJointNames(profile, arm);
  names.forEach((name, i) => {
    const row = document.createElement('div');
    row.className = 'joint-row';
    const val = readJointDeg(name);
    const joint = arm?.joints?.[name];
    let min = -180;
    let max = 180;
    const lim = profile.joint_limits?.[name];
    if (lim && Number.isFinite(lim.lower) && Number.isFinite(lim.upper)) {
      min = lim.lower;
      max = lim.upper;
      if (min > max) [min, max] = [max, min];
    } else if (name === 'gripper_1_joint' || name === 'gripper_2_joint') {
      // UI shows open command in degrees (0 = closed).
      min = 0;
      max = 0.7 * RAD2DEG;
    } else if (joint?.limit && Number.isFinite(joint.limit.lower) && Number.isFinite(joint.limit.upper)
      && !(joint.limit.lower === 0 && joint.limit.upper === 0)) {
      min = joint.limit.lower * RAD2DEG;
      max = joint.limit.upper * RAD2DEG;
      if (min > max) [min, max] = [max, min];
      if (max - min < 1) { min = -180; max = 180; }
    }
    const clamped = Math.min(max, Math.max(min, val));
    row.innerHTML = `
      <label><span>${name}</span><strong data-i="${i}">${clamped.toFixed(1)}°</strong></label>
      <input type="range" min="${min}" max="${max}" step="0.5" value="${clamped}" data-joint="${name}" />
    `;
    const input = row.querySelector('input');
    const label = row.querySelector('strong');
    input.addEventListener('input', () => {
      if (!arm || !active) return;
      const q = names.map((n) => readJointDeg(n));
      q[i] = Number(input.value);
      // Parallel jaws: drag either finger, mirror the other.
      if (name === 'gripper_1_joint' || name === 'gripper_2_joint') {
        const j1 = names.indexOf('gripper_1_joint');
        const j2 = names.indexOf('gripper_2_joint');
        if (j1 >= 0) q[j1] = Number(input.value);
        if (j2 >= 0) q[j2] = Number(input.value);
      }
      setPose(arm, names, q);
      names.forEach((n, idx) => {
        const inp = els.joints.querySelector(`input[data-joint="${n}"]`);
        const lab = els.joints.querySelector(`strong[data-i="${idx}"]`);
        if (!inp || !lab) return;
        const v = readJointDeg(n);
        inp.value = String(v);
        lab.textContent = `${v.toFixed(1)}°`;
      });
    });
    els.joints.appendChild(row);
  });
}

function syncSliderLabels() {
  if (!active) return;
  const names = active._uiJoints || active.joint_names || [];
  names.forEach((name, i) => {
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
      modelScale: profile.model_scale,
      onProgress: (p) => {
        if (token !== loadToken) return;
        setLoadProgress(0.08 + p * 0.9, `加载 ${profile.label}…`, `${Math.round(p * 100)}%`);
      },
    });
    if (token !== loadToken) return;
    arm = robot;
    scene.add(arm);
    const jointNames = resolveJointNames(profile, arm);
    active._uiJoints = jointNames;
    const homeSrc = profile.home_q_deg || [];
    const home = jointNames.map((n, i) => {
      const idx = profile.joint_names.indexOf(n);
      if (idx >= 0 && homeSrc[idx] != null) return Number(homeSrc[idx]);
      if (homeSrc[i] != null && profile.joint_names[i] === n) return Number(homeSrc[i]);
      return 0;
    });
    setPose(arm, jointNames, home);
    renderJointSliders(profile, jointNames);
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
  registry = await loadRobotRegistry('/config/robots.json');
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
  const names = active._uiJoints || resolveJointNames(active, arm);
  const homeSrc = active.home_q_deg || [];
  const home = names.map((n) => {
    const idx = active.joint_names.indexOf(n);
    return idx >= 0 && homeSrc[idx] != null ? Number(homeSrc[idx]) : 0;
  });
  setPose(arm, names, home);
  syncSliderLabels();
});

document.getElementById('btnZero').addEventListener('click', () => {
  if (!arm || !active) return;
  const names = active._uiJoints || resolveJointNames(active, arm);
  setPose(arm, names, names.map(() => 0));
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
}
