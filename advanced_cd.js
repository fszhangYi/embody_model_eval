/**
 * Advanced eval helpers — C (protocol/data) + D (safety/executability).
 * Pure JS, no Three.js. Keep allocations modest (reuse arrays where possible).
 */

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return NaN;
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] * (1 - (idx - lo)) + sortedAsc[hi] * (idx - lo);
}

function summarize(arr) {
  const vals = arr.filter((x) => Number.isFinite(x));
  if (!vals.length) return { mean: NaN, p95: NaN, max: NaN, n: 0 };
  const sorted = vals.slice().sort((a, b) => a - b);
  const sum = vals.reduce((s, v) => s + v, 0);
  return {
    mean: sum / vals.length,
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    n: vals.length,
  };
}

/** SO-100 practical limits in deg (URDF rad converted; shoulder_lift widened for common datasets). */
export const SO100_LIMITS_DEG = {
  shoulder_pan: { lower: -114.59, upper: 114.59, velocity: 57.3 },
  // URDF says ≥0, but many logs use negative lift; keep wide band, override via meta.joint_limits
  shoulder_lift: { lower: -120, upper: 200.54, velocity: 57.3 },
  elbow_flex: { lower: -180, upper: 180, velocity: 57.3 },
  wrist_flex: { lower: -143.24, upper: 120, velocity: 57.3 },
  wrist_roll: { lower: -180, upper: 180, velocity: 57.3 },
  gripper: { lower: -20, upper: 120, velocity: 57.3 },
};

/**
 * C15 — Heuristic unit / action_mode validation.
 * Degrees typically |q|≫2π for some joints; radians usually |q|≲π+ε for arm joints.
 */
export function validateUnitsAndActionMode(data) {
  const meta = data.meta || {};
  const names = meta.joint_names || [];
  const frames = data.frames || [];
  const issues = [];
  const warnings = [];

  const mode = meta.action_mode;
  if (!mode) {
    warnings.push({ code: 'missing_action_mode', msg: 'meta.action_mode 未标注（absolute / delta / tcp_target…）' });
  } else if (!['absolute', 'delta', 'tcp_target', 'relative'].includes(String(mode))) {
    warnings.push({ code: 'unknown_action_mode', msg: `未知 action_mode: ${mode}` });
  }

  if (!frames.length) {
    return { ok: false, inferred_unit: null, issues: [{ code: 'empty', msg: '无 frames' }], warnings };
  }

  const sample = frames.slice(0, Math.min(frames.length, 80));
  let maxAbs = 0;
  let maxDelta = 0;
  for (const f of sample) {
    for (const key of ['current', 'next_gt', 'next_pred']) {
      const q = f[key];
      if (!Array.isArray(q)) continue;
      for (const v of q) {
        const a = Math.abs(v);
        if (a > maxAbs) maxAbs = a;
      }
    }
    if (Array.isArray(f.next_gt) && Array.isArray(f.next_pred)) {
      for (let j = 0; j < f.next_gt.length; j++) {
        const d = Math.abs(f.next_pred[j] - f.next_gt[j]);
        if (d > maxDelta) maxDelta = d;
      }
    }
  }

  let inferred = 'unknown';
  if (maxAbs > 2 * Math.PI + 0.5) inferred = 'deg';
  else if (maxAbs <= Math.PI + 0.35) inferred = 'rad';
  else inferred = 'ambiguous';

  const declared = meta.joint_unit || meta.angle_unit || null;
  if (declared && inferred !== 'unknown' && inferred !== 'ambiguous' && declared !== inferred) {
    issues.push({
      code: 'unit_mismatch',
      msg: `声明单位 ${declared} 与数据启发式推断 ${inferred} 不一致（max|q|=${maxAbs.toFixed(3)}）`,
    });
  }
  if (!declared) {
    warnings.push({
      code: 'unit_inferred',
      msg: `未声明 joint_unit；启发式推断为 ${inferred}（max|q|=${maxAbs.toFixed(3)}）`,
    });
  }

  if (mode === 'delta' && maxAbs > 30 && inferred === 'deg') {
    warnings.push({
      code: 'delta_looks_absolute',
      msg: 'action_mode=delta 但关节角幅度像绝对值，请核对是否应为 absolute',
    });
  }
  if (mode === 'absolute' && maxAbs < 0.5 && names.length) {
    warnings.push({
      code: 'absolute_looks_small',
      msg: 'action_mode=absolute 但 |q| 很小，可能是 rad 或几乎静止',
    });
  }

  // length consistency
  for (let i = 0; i < Math.min(frames.length, 20); i++) {
    const f = frames[i];
    for (const key of ['current', 'next_gt', 'next_pred']) {
      if (Array.isArray(f[key]) && names.length && f[key].length !== names.length) {
        issues.push({
          code: 'dof_mismatch',
          msg: `帧 ${i} ${key}.length=${f[key].length} ≠ joint_names(${names.length})`,
        });
        break;
      }
    }
  }

  return {
    ok: issues.length === 0,
    inferred_unit: inferred,
    declared_unit: declared,
    max_abs_q: maxAbs,
    max_pred_gt_delta: maxDelta,
    action_mode: mode ?? null,
    issues,
    warnings,
  };
}

/**
 * C16 — Normalize / surface provenance metadata for export & UI.
 */
export function extractProvenance(meta = {}) {
  return {
    robot: meta.robot ?? meta.robot_id ?? meta.robot_model ?? meta.arm ?? null,
    dataset_id: meta.dataset_id ?? meta.dataset ?? null,
    policy: meta.policy ?? meta.policy_name ?? null,
    ckpt: meta.ckpt ?? meta.checkpoint ?? null,
    obs_modality: meta.obs_modality ?? meta.obs ?? null,
    seed: meta.seed ?? null,
    source: meta.source ?? null,
    action_mode: meta.action_mode ?? null,
    joint_unit: meta.joint_unit ?? meta.angle_unit ?? null,
    episode_id: meta.episode_id ?? meta.episode ?? null,
    task: meta.task ?? meta.task_name ?? null,
  };
}

/**
 * C13 — Summarize one episode from compare JSON (+ optional tcp from computeTcpMetrics result).
 */
export function summarizeEpisode(data, tcp = null, thresholds = {}) {
  const meta = data.meta || {};
  const frames = data.frames || [];
  const n = frames.length || meta.n_frames || 0;
  const thrEp = thresholds.pass_ep_mm ?? meta.tcp_thresholds?.ep_mm ?? 5;
  const thrEr = thresholds.pass_eR_deg ?? meta.tcp_thresholds?.eR_deg ?? 5;

  let meanL2 = meta.mean_l2;
  let maxL2 = meta.max_l2;
  if (meanL2 == null && frames.length) {
    const errs = frames.map((f) => Number(f.err_l2) || 0);
    meanL2 = errs.reduce((a, b) => a + b, 0) / errs.length;
    maxL2 = Math.max(...errs);
  }

  let passEp = null;
  let passEr = null;
  let passBoth = null;
  let tcpEpMean = null;
  let tcpErMean = null;
  if (tcp?.series?.ep_mm) {
    const ep = tcp.series.ep_mm;
    const eR = tcp.series.eR_deg;
    passEp = ep.filter((v) => v < thrEp).length / ep.length;
    passEr = eR.filter((v) => v < thrEr).length / eR.length;
    passBoth = ep.filter((v, i) => v < thrEp && eR[i] < thrEr).length / ep.length;
    tcpEpMean = tcp.summary.ep_mm.mean;
    tcpErMean = tcp.summary.eR_deg.mean;
  }

  const unit = validateUnitsAndActionMode(data);
  const prov = extractProvenance(meta);

  return {
    title: meta.title || prov.episode_id || 'episode',
    robot: prov.robot,
    n_frames: n,
    fps: meta.fps ?? null,
    mean_l2: meanL2,
    max_l2: maxL2,
    tcp_ep_mean_mm: tcpEpMean,
    tcp_eR_mean_deg: tcpErMean,
    pass_ep_rate: passEp,
    pass_eR_rate: passEr,
    pass_both_rate: passBoth,
    thr_ep_mm: thrEp,
    thr_eR_deg: thrEr,
    provenance: prov,
    unit,
  };
}

/**
 * C13 — Aggregate many episode summaries.
 */
export function aggregateEpisodes(rows) {
  if (!rows.length) {
    return { n: 0, mean_l2: null, pass_ep_rate: null, pass_both_rate: null };
  }
  const avg = (key) => {
    const vals = rows.map((r) => r[key]).filter((x) => Number.isFinite(x));
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  return {
    n: rows.length,
    mean_l2: avg('mean_l2'),
    max_l2: Math.max(...rows.map((r) => r.max_l2).filter(Number.isFinite)),
    tcp_ep_mean_mm: avg('tcp_ep_mean_mm'),
    tcp_eR_mean_deg: avg('tcp_eR_mean_deg'),
    pass_ep_rate: avg('pass_ep_rate'),
    pass_eR_rate: avg('pass_eR_rate'),
    pass_both_rate: avg('pass_both_rate'),
    success_episodes: rows.filter((r) => (r.pass_both_rate ?? 0) >= 0.9).length,
  };
}

/**
 * C14 — Side-by-side model comparison from episode summaries.
 * Each row: { id, label, summary }.
 */
export function compareModels(entries) {
  return entries.map((e) => ({
    id: e.id,
    label: e.label || e.id,
    mean_l2: e.summary.mean_l2,
    max_l2: e.summary.max_l2,
    tcp_ep_mean_mm: e.summary.tcp_ep_mean_mm,
    tcp_eR_mean_deg: e.summary.tcp_eR_mean_deg,
    pass_ep_rate: e.summary.pass_ep_rate,
    pass_both_rate: e.summary.pass_both_rate,
    n_frames: e.summary.n_frames,
    provenance: e.summary.provenance,
  }));
}

/**
 * C17-ish extended failure taxonomy (beyond Top-K e_p).
 */
export function classifyFailureFrames(tcp, { epMm = 15, eRDeg = 15, vErr = 0.15 } = {}) {
  if (!tcp?.series) return [];
  const out = [];
  const n = tcp.n;
  for (let i = 0; i < n; i++) {
    const reasons = [];
    if (tcp.series.ep_mm[i] >= epMm) reasons.push('large_ep');
    if (tcp.series.eR_deg[i] >= eRDeg) reasons.push('large_eR');
    if (tcp.series.v_err_mps[i] >= vErr) reasons.push('jitter');
    if (!reasons.length) continue;
    out.push({
      i,
      ep_mm: tcp.series.ep_mm[i],
      eR_deg: tcp.series.eR_deg[i],
      v_err_mps: tcp.series.v_err_mps[i],
      reasons,
    });
  }
  return out.sort((a, b) => b.ep_mm - a.ep_mm);
}

function resolveLimits(meta = {}) {
  const base = { ...SO100_LIMITS_DEG };
  const custom = meta.joint_limits || {};
  for (const [k, v] of Object.entries(custom)) {
    base[k] = { ...base[k], ...v };
  }
  return base;
}

/**
 * D18 — Joint limit proximity + simple singularity proxy from finite-diff Jacobian.
 * @param {number[][]} qSeries deg arrays (pred)
 * @param {object} opts
 * @param {function(number[]): {x,y,z}} opts.fkPos maps q(deg) → TCP pos (m)
 */
export function analyzeLimitsAndSingularity(qSeries, names, meta, { fkPos, marginDeg = 8, singThresh = 1e-4, stride = 1 } = {}) {
  const limits = resolveLimits(meta);
  const n = qSeries.length;
  const dof = names.length;
  const nearLimit = [];
  const overLimit = [];
  const singFrames = [];
  const manip = [];
  const step = Math.max(1, stride | 0);

  for (let i = 0; i < n; i++) {
    const q = qSeries[i];
    for (let j = 0; j < dof; j++) {
      const name = names[j];
      const lim = limits[name];
      if (!lim) continue;
      const v = q[j];
      if (v < lim.lower || v > lim.upper) {
        overLimit.push({ i, joint: name, q: v, lower: lim.lower, upper: lim.upper });
      } else if (v < lim.lower + marginDeg || v > lim.upper - marginDeg) {
        nearLimit.push({ i, joint: name, q: v, lower: lim.lower, upper: lim.upper });
      }
    }

    if (typeof fkPos === 'function' && i % step === 0) {
      const eps = 0.35; // deg
      const J = [];
      const p0 = fkPos(q);
      for (let j = 0; j < dof; j++) {
        const qp = q.slice();
        qp[j] += eps;
        const p1 = fkPos(qp);
        J.push([
          (p1.x - p0.x) / eps,
          (p1.y - p0.y) / eps,
          (p1.z - p0.z) / eps,
        ]);
      }
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let j = 0; j < dof; j++) {
        const col = J[j];
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) A[r][c] += col[r] * col[c];
        }
      }
      const det =
        A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1])
        - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0])
        + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
      const w = Math.sqrt(Math.max(0, det));
      manip.push(w);
      if (w < singThresh) singFrames.push({ i, manipulability: w });
    }
  }

  const cap = (arr, m = 40) => arr.slice(0, m);
  return {
    limits,
    over_limit: cap(overLimit),
    near_limit: cap(nearLimit),
    singularity_frames: cap(singFrames),
    manipulability: manip,
    manip_summary: summarize(manip.filter((x) => x > 0)),
    n_over: overLimit.length,
    n_near: nearLimit.length,
    n_sing: singFrames.length,
    stride: step,
  };
}

/**
 * D19 — Coarse self-collision + table plane check using link sample points (meters).
 * @param { {name:string, pos:{x,y,z}}[][] } linkSeries per-frame link centers
 */
export function analyzeCollisions(linkSeries, {
  tableZ = 0.0,
  tableClearance = 0.01,
  selfMinDist = 0.035,
  skipAdjacent = 1,
} = {}) {
  const tableHits = [];
  const selfHits = [];
  const n = linkSeries.length;
  for (let i = 0; i < n; i++) {
    const links = linkSeries[i];
    if (!links?.length) continue;
    for (let a = 0; a < links.length; a++) {
      if (links[a].pos.z < tableZ + tableClearance) {
        tableHits.push({ i, link: links[a].name, z: links[a].pos.z });
      }
      for (let b = a + 1 + skipAdjacent; b < links.length; b++) {
        const pa = links[a].pos;
        const pb = links[b].pos;
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
        if (d < selfMinDist) {
          selfHits.push({
            i,
            a: links[a].name,
            b: links[b].name,
            dist_mm: d * 1000,
          });
        }
      }
    }
  }
  const cap = (arr, m = 40) => arr.slice(0, m);
  return {
    table_hits: cap(tableHits),
    self_hits: cap(selfHits),
    n_table: tableHits.length,
    n_self: selfHits.length,
  };
}

/**
 * D20 — Smoothness / executability vs velocity limits.
 * qSeries in deg, fps Hz.
 */
export function analyzeSmoothness(qSeries, names, meta, fps = 30) {
  const limits = resolveLimits(meta);
  const dt = 1 / Math.max(1e-6, fps);
  const n = qSeries.length;
  const dof = names.length;
  const overSpeed = [];
  const jumpFrames = [];
  const speedMax = new Float64Array(dof);
  const absJerk = [];

  for (let i = 1; i < n; i++) {
    let frameJump = 0;
    for (let j = 0; j < dof; j++) {
      const dq = qSeries[i][j] - qSeries[i - 1][j];
      const spd = Math.abs(dq) / dt; // deg/s
      if (spd > speedMax[j]) speedMax[j] = spd;
      const vmax = limits[names[j]]?.velocity ?? 57.3;
      if (spd > vmax * 1.05) {
        overSpeed.push({ i, joint: names[j], deg_s: spd, limit: vmax });
      }
      frameJump += dq * dq;
    }
    const jump = Math.sqrt(frameJump);
    if (jump > 25) jumpFrames.push({ i, l2_deg: jump }); // large inter-frame jump
    if (i >= 2) {
      let j2 = 0;
      for (let j = 0; j < dof; j++) {
        const d1 = qSeries[i][j] - qSeries[i - 1][j];
        const d0 = qSeries[i - 1][j] - qSeries[i - 2][j];
        const jerk = (d1 - d0) / (dt * dt);
        j2 += jerk * jerk;
      }
      absJerk.push(Math.sqrt(j2));
    }
  }

  const cap = (arr, m = 40) => arr.slice(0, m);
  const overRatio = n > 1 ? overSpeed.length / ((n - 1) * Math.max(1, dof)) : 0;
  return {
    over_speed: cap(overSpeed),
    jump_frames: cap(jumpFrames.sort((a, b) => b.l2_deg - a.l2_deg)),
    n_over_speed: overSpeed.length,
    over_speed_ratio: overRatio,
    speed_max_deg_s: Object.fromEntries(names.map((n, j) => [n, speedMax[j]])),
    jerk_summary: summarize(absJerk),
  };
}

/** Bundle D18–D20 for UI. */
export function buildSafetyReport({
  qPredSeries,
  names,
  meta,
  fps,
  fkPos,
  linkSeries = null,
  stride = 1,
}) {
  const limits = analyzeLimitsAndSingularity(qPredSeries, names, meta, { fkPos, stride });
  const smooth = analyzeSmoothness(qPredSeries, names, meta, fps);
  const collision = linkSeries
    ? analyzeCollisions(linkSeries)
    : { table_hits: [], self_hits: [], n_table: 0, n_self: 0, skipped: true };
  return { limits, smooth, collision };
}
