/**
 * Build a compact HTML / JSON eval report from already-computed TCP metrics.
 * Keep payloads small: tables + text, optional one downscaled screenshot.
 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmt(s) {
  if (!s || !Number.isFinite(s.mean)) return '—';
  return `μ ${s.mean.toFixed(2)} · p95 ${s.p95.toFixed(2)} · max ${s.max.toFixed(2)}`;
}

function topKWorst(epMm, k = 8) {
  return epMm
    .map((v, i) => ({ i, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, k);
}

/**
 * @param {object} opts
 * @param {object} opts.meta compare_result.meta
 * @param {object} opts.tcp from computeTcpMetrics
 * @param {object} [opts.gates] threshold gate result
 * @param {string|null} [opts.screenshotDataUrl] optional small jpeg/png data URL
 */
export function buildReportSummary({ meta, tcp, gates = null, screenshotDataUrl = null }) {
  const worst = topKWorst(tcp.series.ep_mm, 8);
  return {
    generated_at: new Date().toISOString(),
    title: meta.title || 'Embody eval report',
    meta: {
      n_frames: meta.n_frames,
      fps: meta.fps,
      action_mode: meta.action_mode ?? null,
      source: meta.source ?? null,
      mean_l2: meta.mean_l2 ?? null,
      max_l2: meta.max_l2 ?? null,
      joint_names: meta.joint_names ?? null,
      robot: meta.robot ?? meta.robot_id ?? null,
      dataset_id: meta.dataset_id ?? null,
      policy: meta.policy ?? null,
      ckpt: meta.ckpt ?? null,
    },
    tcp: {
      summary: tcp.summary,
      temporal: tcp.temporal,
      segments: tcp.segments,
      task: tcp.task?.available
        ? {
            pred: tcp.task.pred,
            gt: tcp.task.gt,
            delta_final: tcp.task.delta_final,
          }
        : { available: false, reason: tcp.task?.reason },
    },
    worst_frames: worst,
    gates,
    has_screenshot: Boolean(screenshotDataUrl),
  };
}

export function buildReportHtml({ meta, tcp, gates = null, screenshotDataUrl = null }) {
  const summary = buildReportSummary({ meta, tcp, gates, screenshotDataUrl });
  const worstRows = summary.worst_frames
    .map((w) => `<tr><td>${w.i}</td><td>${w.v.toFixed(2)}</td></tr>`)
    .join('');
  const segRows = Object.entries(tcp.segments || {})
    .map(([name, s]) =>
      `<tr><td>${esc(name)}</td><td>${fmt(s.ep_mm)}</td><td>${fmt(s.eR_deg)}</td></tr>`)
    .join('');
  const gateRows = gates?.checks
    ? gates.checks.map((c) =>
      `<tr><td>${esc(c.name)}</td><td>${esc(c.actual)}</td><td>${esc(c.limit)}</td>`
      + `<td style="color:${c.ok ? '#16a34a' : '#dc2626'}">${c.ok ? 'PASS' : 'FAIL'}</td></tr>`).join('')
    : '<tr><td colspan="4">未配置门禁</td></tr>';
  const shot = screenshotDataUrl
    ? `<h2>关键帧截图</h2><p><img src="${screenshotDataUrl}" alt="viewport" style="max-width:100%;height:auto;border:1px solid #ccc"/></p>`
    : '';
  const taskBlock = tcp.task?.available
    ? `<p>任务 e_p μ=${tcp.task.pred.ep_mm.mean.toFixed(2)} mm · 接近角 μ=${tcp.task.pred.approach_deg.mean.toFixed(2)}°`
      + ` · 末帧 e_p ${tcp.task.pred.final.ep_mm.toFixed(2)} mm</p>`
    : `<p>任务误差：未提供 meta.goal_pose</p>`;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>${esc(summary.title)}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,sans-serif;margin:24px;color:#111;line-height:1.45;max-width:920px}
  h1{font-size:1.35rem;margin:0 0 8px} h2{font-size:1.05rem;margin:22px 0 8px}
  table{border-collapse:collapse;width:100%;font-size:0.9rem}
  th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}
  th{background:#f5f5f5} .muted{color:#666;font-size:0.85rem}
  .badge{display:inline-block;padding:2px 8px;border-radius:4px;font-weight:600}
  .pass{background:#dcfce7;color:#166534}.fail{background:#fee2e2;color:#991b1b}
</style>
</head>
<body>
<h1>${esc(summary.title)}</h1>
<p class="muted">生成于 ${esc(summary.generated_at)} · n=${meta.n_frames} · fps=${meta.fps}
 · action=${esc(meta.action_mode ?? '—')} · source=${esc(meta.source ?? '—')}</p>
<p>门禁：
<span class="badge ${gates?.passed ? 'pass' : (gates ? 'fail' : '')}">${
  gates ? (gates.passed ? 'PASS' : 'FAIL') : 'N/A'
}</span></p>

<h2>TCP 汇总</h2>
<table>
<tr><th>指标</th><th>统计</th></tr>
<tr><td>e_p (mm)</td><td>${fmt(tcp.summary.ep_mm)}</td></tr>
<tr><td>e_R (°)</td><td>${fmt(tcp.summary.eR_deg)}</td></tr>
<tr><td>|Δx| / |Δy| / |Δz| (mm)</td><td>${fmt(tcp.summary.dx_mm)} / ${fmt(tcp.summary.dy_mm)} / ${fmt(tcp.summary.dz_mm)}</td></tr>
<tr><td>‖Δv‖ (m/s)</td><td>${fmt(tcp.summary.v_err_mps)}</td></tr>
<tr><td>‖Δω‖ (°/s)</td><td>${fmt(tcp.summary.w_err_dps)}</td></tr>
<tr><td>滞后 / DTW</td><td>${tcp.temporal.lag_frames} 帧 (${tcp.temporal.lag_s.toFixed(3)}s) · DTW ${
  (tcp.temporal.dtw_normalized_m * 1000).toFixed(2)
} mm/步</td></tr>
</table>
${taskBlock}

<h2>分段</h2>
<table><tr><th>段</th><th>e_p (mm)</th><th>e_R (°)</th></tr>${segRows}</table>

<h2>最差帧 Top‑K（e_p mm）</h2>
<table><tr><th>帧</th><th>e_p</th></tr>${worstRows}</table>

<h2>阈值门禁</h2>
<table><tr><th>检查项</th><th>实际</th><th>阈值</th><th>结果</th></tr>${gateRows}</table>

${shot}

<p class="muted">由 Embody Model Eval 导出 · 轻量 HTML，便于归档与评审。</p>
</body></html>`;
}

/** Evaluate numeric thresholds against meta + tcp summary. */
export function evaluateGates(meta, tcp, thresholds = {}) {
  const checks = [];
  const add = (name, actual, limit, ok) => {
    checks.push({
      name,
      actual: Number.isFinite(actual) ? Number(actual.toFixed(4)) : String(actual),
      limit,
      ok: Boolean(ok),
    });
  };

  if (thresholds.max_mean_l2 != null && meta.mean_l2 != null) {
    add('mean_l2', meta.mean_l2, `≤ ${thresholds.max_mean_l2}`, meta.mean_l2 <= thresholds.max_mean_l2);
  }
  if (thresholds.max_tcp_ep_mean_mm != null) {
    const v = tcp.summary.ep_mm.mean;
    add('tcp_ep_mean_mm', v, `≤ ${thresholds.max_tcp_ep_mean_mm}`, v <= thresholds.max_tcp_ep_mean_mm);
  }
  if (thresholds.max_tcp_ep_p95_mm != null) {
    const v = tcp.summary.ep_mm.p95;
    add('tcp_ep_p95_mm', v, `≤ ${thresholds.max_tcp_ep_p95_mm}`, v <= thresholds.max_tcp_ep_p95_mm);
  }
  if (thresholds.max_tcp_eR_mean_deg != null) {
    const v = tcp.summary.eR_deg.mean;
    add('tcp_eR_mean_deg', v, `≤ ${thresholds.max_tcp_eR_mean_deg}`, v <= thresholds.max_tcp_eR_mean_deg);
  }
  if (thresholds.min_pass_ep_rate != null) {
    const thr = thresholds.pass_ep_mm ?? 5;
    const rate = tcp.series.ep_mm.filter((x) => x < thr).length / Math.max(1, tcp.n);
    add(`pass_rate e_p<${thr}mm`, rate, `≥ ${thresholds.min_pass_ep_rate}`, rate >= thresholds.min_pass_ep_rate);
  }

  const passed = checks.length ? checks.every((c) => c.ok) : true;
  return { passed, checks, thresholds };
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function downloadText(filename, text, mime = 'text/plain;charset=utf-8') {
  downloadBlob(filename, new Blob([text], { type: mime }));
}
