/**
 * Top-level page registry for Embody eval UI.
 * Add new tab pages here so index / hub (and future pages) share one menu.
 */
export const PAGES = [
  {
    id: 'eval',
    href: './index.html',
    label: '单轨迹评测',
    short: '评测',
    desc: '三臂对照、TCP / 观测 / 任务回放',
  },
  {
    id: 'hub',
    href: './hub.html',
    label: 'Hub · 汇总',
    short: 'Hub',
    desc: '多 episode / 多模型对比',
  },
];

export function resolveCurrentPageId(pathname = location.pathname) {
  const base = pathname.split('/').pop() || '';
  if (/hub\.html$/i.test(base)) return 'hub';
  if (/index\.html$/i.test(base) || base === '' || base === '/') return 'eval';
  const hit = PAGES.find((p) => base && p.href.endsWith(base));
  return hit?.id || 'eval';
}

/**
 * Mount a dropdown page switcher into `root`.
 * @param {HTMLElement} root
 * @param {{ currentId?: string }} [opts]
 */
export function mountPageNav(root, opts = {}) {
  if (!root) return;
  const currentId = opts.currentId || resolveCurrentPageId();
  const current = PAGES.find((p) => p.id === currentId) || PAGES[0];

  root.classList.add('page-nav');
  root.innerHTML = `
    <button type="button" class="page-nav-btn pill" id="pageNavBtn" aria-expanded="false" aria-haspopup="true" title="切换页面">
      <span class="page-nav-label">${current.short || current.label}</span>
      <span class="page-nav-caret" aria-hidden="true">▾</span>
    </button>
    <div class="page-nav-menu" id="pageNavMenu" role="menu" hidden>
      ${PAGES.map((p) => `
        <a role="menuitem" class="page-nav-item${p.id === currentId ? ' active' : ''}"
           href="${p.href}" data-page="${p.id}">
          <span class="page-nav-item-title">${p.label}</span>
          <span class="page-nav-item-desc">${p.desc || ''}</span>
        </a>
      `).join('')}
    </div>
  `;

  const btn = root.querySelector('#pageNavBtn');
  const menu = root.querySelector('#pageNavMenu');
  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    root.classList.toggle('open', open);
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(menu.hidden);
  });
  document.addEventListener('click', (e) => {
    if (!root.contains(e.target)) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });
}
