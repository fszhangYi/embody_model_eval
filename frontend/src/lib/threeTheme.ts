import * as THREE from 'three';

export type ThreeSceneTheme = {
  background: number;
  fog: number;
  gridCenter: number;
  gridEdge: number;
};

export function isLightTheme(): boolean {
  return document.documentElement.dataset.theme === 'light';
}

export function getThreeSceneTheme(): ThreeSceneTheme {
  if (isLightTheme()) {
    return {
      background: 0xe8edf4,
      fog: 0xe8edf4,
      gridCenter: 0x94a3b8,
      gridEdge: 0xc5d4e4,
    };
  }
  return {
    background: 0x0b1018,
    fog: 0x0b1018,
    gridCenter: 0x3a4d66,
    gridEdge: 0x243247,
  };
}

function applyGridColors(grid: THREE.GridHelper, theme: ThreeSceneTheme): void {
  const mat = grid.material as THREE.Material | THREE.Material[];
  if (Array.isArray(mat) && mat.length >= 2) {
    (mat[0] as THREE.LineBasicMaterial).color.setHex(theme.gridCenter);
    (mat[1] as THREE.LineBasicMaterial).color.setHex(theme.gridEdge);
    return;
  }
  if (mat && !Array.isArray(mat) && 'color' in mat) {
    (mat as THREE.LineBasicMaterial).color.setHex(theme.gridEdge);
  }
}

export function applyThreeSceneTheme(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  options?: { fog?: THREE.Fog | null; grid?: THREE.GridHelper | null },
): void {
  const theme = getThreeSceneTheme();
  scene.background = new THREE.Color(theme.background);
  renderer.setClearColor(theme.background, 1);
  if (options?.fog) options.fog.color.setHex(theme.fog);
  if (options?.grid) applyGridColors(options.grid, theme);
}

export function watchThreeSceneTheme(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  options?: { fog?: THREE.Fog | null; grid?: THREE.GridHelper | null },
): () => void {
  const apply = () => applyThreeSceneTheme(scene, renderer, options);
  apply();
  const obs = new MutationObserver(apply);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => obs.disconnect();
}
