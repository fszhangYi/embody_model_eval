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
  {
    id: 'pipeline',
    href: './pipeline.html',
    label: '模型数据流',
    short: '数据流',
    desc: 'ComfyUI 风格：训练 / 推理流向演示',
  },
  {
    id: 'chat',
    href: './chat.html',
    label: 'AI Chat · Skills',
    short: 'Chat',
    desc: '选 skill、配 Agent 链接、发送诉求看回执',
  },
  {
    id: 'robots',
    href: './robots.html',
    label: '机械臂 3D',
    short: '机型',
    desc: '下拉选择机型，Three.js 浏览 URDF',
  },
  {
    id: 'sensors',
    href: './sensors.html',
    label: '传感器状态',
    short: '传感器',
    desc: '机械臂 / 夹爪 / 触觉 / RealSense / 六维力 / Gello',
  },
];

const PAGE_NAV_Z = '2147483000';

export function resolveCurrentPageId(pathname = location.pathname) {
  const base = pathname.split('/').pop() || '';
  if (/hub\.html$/i.test(base)) return 'hub';
  if (/pipeline\.html$/i.test(base)) return 'pipeline';
  if (/chat\.html$/i.test(base)) return 'chat';
  if (/robots\.html$/i.test(base)) return 'robots';
  if (/sensors\.html$/i.test(base)) return 'sensors';
  if (/index\.html$/i.test(base) || base === '' || base === '/') return 'eval';
  const hit = PAGES.find((p) => base && p.href.endsWith(base));
  return hit?.id || 'eval';
}

function isTypingTarget(el) {
  if (!el || !(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return !!el.closest?.('[contenteditable="true"]');
}

/**
 * Mount a dropdown page switcher into `root`.
 * Menu is portaled to document.body with position:fixed so Hub cards /
 * animated stacking contexts cannot cover it.
 *
 * Shortcuts (ignored while typing in inputs):
 *   Alt+1…N  → jump to page N
 *   Alt+←/→  or Alt+[/] → previous / next page
 *   Esc      → close menu
 *
 * @param {HTMLElement} root
 * @param {{ currentId?: string }} [opts]
 */
export function mountPageNav(root, opts = {}) {
  if (!root) return;
  const currentId = opts.currentId || resolveCurrentPageId();
  const current = PAGES.find((p) => p.id === currentId) || PAGES[0];
  const currentIdx = Math.max(0, PAGES.findIndex((p) => p.id === currentId));

  root.classList.add('page-nav');
  root.innerHTML = `
    <button type="button" class="page-nav-btn pill" id="pageNavBtn" aria-expanded="false" aria-haspopup="true"
      title="切换页面 · Alt+1–${PAGES.length} 直达 · Alt+←/→ 上/下页">
      <span class="page-nav-label">${current.short || current.label}</span>
      <span class="page-nav-caret" aria-hidden="true">▾</span>
    </button>
  `;

  const btn = root.querySelector('#pageNavBtn');
  const menu = document.createElement('div');
  menu.id = 'pageNavMenu';
  menu.className = 'page-nav-menu page-nav-menu-portal';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  menu.innerHTML = PAGES.map((p, i) => `
    <a role="menuitem" class="page-nav-item${p.id === currentId ? ' active' : ''}"
       href="${p.href}" data-page="${p.id}" data-idx="${i}"
       title="Alt+${i + 1}">
      <span class="page-nav-item-main">
        <span class="page-nav-item-title">${p.label}</span>
        <span class="page-nav-item-desc">${p.desc || ''}</span>
      </span>
      <kbd class="page-nav-item-key">Alt+${i + 1}</kbd>
    </a>
  `).join('') + `
    <div class="page-nav-hint" role="note">Alt+← / Alt+→ 切换相邻页</div>
  `;
  document.body.appendChild(menu);

  // Inject shared shortcut styles once (pages may not share a CSS file for this).
  if (!document.getElementById('pageNavShortcutStyle')) {
    const style = document.createElement('style');
    style.id = 'pageNavShortcutStyle';
    style.textContent = `
      .page-nav-item {
        display: flex; align-items: flex-start; justify-content: space-between;
        gap: 12px;
      }
      .page-nav-item-main { min-width: 0; flex: 1; }
      .page-nav-item-key {
        flex-shrink: 0; margin-top: 2px; padding: 1px 6px;
        font: 560 0.65rem/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        color: var(--muted, #8b9bb4);
        border: 1px solid rgba(148,163,184,0.35);
        border-radius: 4px; background: rgba(15,23,42,0.35);
      }
      .page-nav-hint {
        margin: 4px 8px 8px; padding-top: 6px;
        border-top: 1px solid rgba(148,163,184,0.2);
        font-size: 0.65rem; color: var(--muted, #8b9bb4);
      }
    `;
    document.head.appendChild(style);
  }

  const placeMenu = () => {
    const rect = btn.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${Math.round(rect.bottom + 6)}px`;
    menu.style.right = `${Math.round(Math.max(8, window.innerWidth - rect.right))}px`;
    menu.style.left = 'auto';
    menu.style.zIndex = PAGE_NAV_Z;
  };

  const setOpen = (open) => {
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    root.classList.toggle('open', open);
    if (open) placeMenu();
  };

  const goToIndex = (idx) => {
    if (idx < 0 || idx >= PAGES.length) return;
    const page = PAGES[idx];
    if (!page || page.id === currentId) return;
    location.href = page.href;
  };

  const cycle = (delta) => {
    const next = (currentIdx + delta + PAGES.length) % PAGES.length;
    goToIndex(next);
  };

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(menu.hidden);
  });
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => setOpen(false));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (isTypingTarget(e.target)) return;
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;

    // Alt+1 … Alt+N
    const digit = e.code?.startsWith('Digit')
      ? Number(e.code.slice(5))
      : (/^[1-9]$/.test(e.key) ? Number(e.key) : 0);
    if (digit >= 1 && digit <= PAGES.length) {
      e.preventDefault();
      goToIndex(digit - 1);
      return;
    }

    // Alt+← / Alt+[  previous · Alt+→ / Alt+]  next
    if (e.key === 'ArrowLeft' || e.key === '[' || e.code === 'BracketLeft') {
      e.preventDefault();
      cycle(-1);
      return;
    }
    if (e.key === 'ArrowRight' || e.key === ']' || e.code === 'BracketRight') {
      e.preventDefault();
      cycle(1);
    }
  });

  window.addEventListener('resize', () => {
    if (!menu.hidden) placeMenu();
  });
  window.addEventListener('scroll', () => {
    if (!menu.hidden) placeMenu();
  }, true);
}
