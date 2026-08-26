/**
 * On-canvas view tools: switch OrbitControls left-drag between rotate / pan / zoom.
 */
import * as THREE from 'three';
import { t } from '../../i18n/runtime';

function viewModes() {
  return [
    { id: 'rotate', label: t('view.mode.rotate'), title: t('view.title.rotate') },
    { id: 'pan', label: t('view.mode.pan'), title: t('view.title.pan') },
    { id: 'zoom', label: t('view.mode.zoom'), title: t('view.title.zoom') },
  ];
}

function viewHints() {
  return {
    rotate: t('view.hint.rotate'),
    pan: t('view.hint.pan'),
    zoom: t('view.hint.zoom'),
  };
}

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
  root.setAttribute('aria-label', t('view.toolbarAria'));

  const btns = {};
  for (const m of viewModes()) {
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
    fit.textContent = t('view.mode.fit');
    fit.title = t('view.title.fit');
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
    const hints = viewHints();
    hint.textContent = hints[mode] || hints.rotate;
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
