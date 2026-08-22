/**
 * On-canvas view tools: switch OrbitControls left-drag between rotate / pan / zoom.
 */
import * as THREE from 'three';

const MODES = [
  { id: 'rotate', label: '旋转', title: '左键拖动旋转视角' },
  { id: 'pan', label: '平移', title: '左键拖动平移画面' },
  { id: 'zoom', label: '缩放', title: '左键上下拖动缩放；滚轮仍可用' },
];

const HINTS = {
  rotate: '旋转 · 左键拖动旋转 · 滚轮缩放 · 右键平移',
  pan: '平移 · 左键拖动平移 · 滚轮缩放',
  zoom: '缩放 · 左键上下拖动缩放 · 滚轮也可缩放',
};

/**
 * @param {HTMLElement} container
 * @param {import('three/examples/jsm/controls/OrbitControls.js').OrbitControls} controls
 * @param {{ onFit?: () => void, initialMode?: string }} [opts]
 */
export function mountViewTools(container, controls, opts = {}) {
  if (!container || !controls) return { setMode() {}, getMode: () => 'rotate', el: null };

  let mode = opts.initialMode || 'rotate';
  const root = document.createElement('div');
  root.className = 'view-tools';
  root.setAttribute('role', 'toolbar');
  root.setAttribute('aria-label', '视图操作');

  const btns = {};
  for (const m of MODES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.mode = m.id;
    b.textContent = m.label;
    b.title = m.title;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setMode(m.id);
    });
    root.appendChild(b);
    btns[m.id] = b;
  }

  if (typeof opts.onFit === 'function') {
    const fit = document.createElement('button');
    fit.type = 'button';
    fit.className = 'view-tools-fit';
    fit.textContent = '适配';
    fit.title = '按模型包围盒重置相机';
    fit.addEventListener('click', (e) => {
      e.stopPropagation();
      opts.onFit();
    });
    root.appendChild(fit);
  }

  const hint = document.createElement('div');
  hint.className = 'view-tools-hint';
  root.appendChild(hint);

  // Keep pointer events on toolbar from collapsing side rails / bubbling oddly.
  root.addEventListener('pointerdown', (e) => e.stopPropagation());

  container.appendChild(root);

  function applyMode(next) {
    controls.enableRotate = true;
    controls.enablePan = true;
    controls.enableZoom = true;

    if (next === 'pan') {
      controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
      controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
      controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
      controls.touches.ONE = THREE.TOUCH.PAN;
      controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    } else if (next === 'zoom') {
      controls.mouseButtons.LEFT = THREE.MOUSE.DOLLY;
      controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
      controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
      // One-finger dolly isn't in THREE.TOUCH; keep pan + pinch-zoom.
      controls.touches.ONE = THREE.TOUCH.PAN;
      controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    } else {
      next = 'rotate';
      controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
      controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
      controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
      controls.touches.ONE = THREE.TOUCH.ROTATE;
      controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    }

    mode = next;
    for (const id of Object.keys(btns)) {
      btns[id].classList.toggle('active', id === mode);
      btns[id].setAttribute('aria-pressed', id === mode ? 'true' : 'false');
    }
    hint.textContent = HINTS[mode] || HINTS.rotate;
    container.dataset.viewMode = mode;
  }

  function setMode(next) {
    applyMode(next);
  }

  applyMode(mode);

  return {
    el: root,
    setMode,
    getMode: () => mode,
  };
}
