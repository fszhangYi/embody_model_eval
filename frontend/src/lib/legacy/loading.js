/**
 * Unified loading overlay for resource fetch / 3D asset loads.
 */

const SPINNER_HTML =
  '<div class="emb-load-spinner" aria-hidden="true"><span></span><span></span><span></span></div>';

/**
 * @param {ParentNode} host
 * @param {{ id?: string, mode?: 'overlay' | 'page' }} [opts]
 */
export function createLoader(host, opts = {}) {
  if (!host) throw new Error('createLoader: host element required');
  const existing = host.querySelector(':scope > .emb-load, .emb-load');
  if (existing) return bindLoader(existing);

  const wrap = document.createElement('div');
  wrap.className = 'emb-load';
  if (opts.id) wrap.id = opts.id;
  if (opts.mode === 'page') wrap.classList.add('emb-load--page');
  wrap.hidden = true;
  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');
  wrap.innerHTML = `
    <div class="emb-load-card">
      ${SPINNER_HTML}
      <div class="emb-load-text">加载中…</div>
      <div class="emb-load-bar" aria-hidden="true"><div class="emb-load-bar-fill"></div></div>
      <div class="emb-load-meta">
        <span class="emb-load-detail"></span>
        <span class="emb-load-pct">0%</span>
      </div>
    </div>`;
  host.appendChild(wrap);
  return bindLoader(wrap);
}

/** Upgrade legacy markup (loading-card / loadText ids). */
export function bindLoader(root) {
  const wrap = root.classList?.contains('emb-load')
    ? root
    : root.closest?.('.emb-load') || root;

  if (!wrap.querySelector('.emb-load-spinner') && wrap.querySelector('.loading-card, .emb-load-card')) {
    const card = wrap.querySelector('.loading-card, .emb-load-card');
    card.classList.add('emb-load-card');
    wrap.classList.add('emb-load');
    const spinner = document.createElement('div');
    spinner.className = 'emb-load-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    spinner.innerHTML = '<span></span><span></span><span></span>';
    card.insertBefore(spinner, card.firstChild);
  }

  wrap.querySelector('.loading-text')?.classList.add('emb-load-text');
  wrap.querySelector('.loading-bar')?.classList.add('emb-load-bar');
  wrap.querySelector('.loading-bar-fill')?.classList.add('emb-load-bar-fill');
  wrap.querySelector('.loading-meta')?.classList.add('emb-load-meta');

  const bar =
    wrap.querySelector('.emb-load-bar-fill') ||
    wrap.querySelector('#loadBarFill') ||
    wrap.querySelector('#loadBar');

  const detail =
    wrap.querySelector('.emb-load-detail') ||
    wrap.querySelector('#loadDetail') ||
    wrap.querySelector('#loadMeta');

  const pct = wrap.querySelector('.emb-load-pct') || wrap.querySelector('#loadPct');

  return {
    wrap,
    text: wrap.querySelector('.emb-load-text') || wrap.querySelector('#loadText'),
    bar,
    detail,
    pct,
  };
}

/**
 * @param {ReturnType<typeof bindLoader>} loader
 * @param {number} ratio 0–1
 * @param {string} [text]
 * @param {string} [detail]
 */
export function setLoadProgress(loader, ratio, text, detail) {
  if (!loader) return;
  const pct = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0));
  if (loader.bar) loader.bar.style.width = `${(pct * 100).toFixed(1)}%`;
  if (loader.pct) loader.pct.textContent = `${Math.round(pct * 100)}%`;
  if (text != null && loader.text) loader.text.textContent = text;
  if (detail != null) {
    const target = loader.detail || loader.pct;
    if (target) target.textContent = detail;
  }
  showLoader(loader);
}

/** @param {ReturnType<typeof bindLoader>} loader */
export function showLoader(loader) {
  if (!loader?.wrap) return;
  loader.wrap.hidden = false;
  loader.wrap.classList.remove('emb-load--done', 'emb-load--error');
}

/** @param {ReturnType<typeof bindLoader>} loader */
export function hideLoader(loader, { remove = false } = {}) {
  if (!loader?.wrap) return;
  if (remove) {
    loader.wrap.remove();
    return;
  }
  loader.wrap.classList.add('emb-load--done');
  loader.wrap.hidden = true;
}

/** @param {ReturnType<typeof bindLoader>} loader */
export function failLoader(loader, text, detail) {
  if (!loader) return;
  setLoadProgress(loader, 1, text || '加载失败', detail || '');
  loader.wrap?.classList.add('emb-load--error');
}

/**
 * @param {ReturnType<typeof bindLoader>} loader
 * @param {() => Promise<void>} fn
 * @param {{ text?: string, detail?: string }} [opts]
 */
export async function withLoader(loader, fn, opts = {}) {
  showLoader(loader);
  setLoadProgress(loader, 0, opts.text || '加载中…', opts.detail || '');
  try {
    await fn((ratio, text, detail) => setLoadProgress(loader, ratio, text, detail));
  } finally {
    hideLoader(loader);
  }
}

/** Inline spinner HTML for status lines / preview boxes. */
export function inlineLoadingHtml(label = '加载中…') {
  return `<span class="emb-load-inline">${SPINNER_HTML}<span class="emb-load-inline-text">${label}</span></span>`;
}
