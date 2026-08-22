/**
 * TCP pose metrics for pred vs GT (embodied policy eval).
 * Pure math — no Three.js dependency. Positions in meters, quats as {x,y,z,w}.
 */

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

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
  if (!vals.length) {
    return { mean: NaN, p95: NaN, max: NaN, n: 0 };
  }
  const sorted = vals.slice().sort((a, b) => a - b);
  const sum = vals.reduce((s, v) => s + v, 0);
  return {
    mean: sum / vals.length,
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1],
    n: vals.length,
  };
}

function quatNormalize(q) {
  const n = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / n, y: q.y / n, z: q.z / n, w: q.w / n };
}

function quatConjugate(q) {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

function quatMul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Geodesic angle (rad) between two unit quaternions. */
export function quatAngle(qA, qB) {
  const a = quatNormalize(qA);
  const b = quatNormalize(qB);
  let dot = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  dot = clamp(dot, 0, 1);
  return 2 * Math.acos(dot);
}

/** Relative rotation q_gt^{-1} ⊗ q_pred → XYZ Euler (rad, URDF/fixed XYZ-ish via ZYX extract). */
function relativeEulerXYZ(qGt, qPred) {
  const rel = quatNormalize(quatMul(quatConjugate(quatNormalize(qGt)), quatNormalize(qPred)));
  // Three.js/Order XYZ intrinsic ≈ apply X then Y then Z; extract from quat:
  const { x, y, z, w } = rel;
  const sinr_cosp = 2 * (w * x + y * z);
  const cosr_cosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr_cosp, cosr_cosp);
  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
  const siny_cosp = 2 * (w * z + x * y);
  const cosy_cosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp);
  return { roll, pitch, yaw };
}

function finiteDiff(series, dt) {
  const out = new Array(series.length).fill(0);
  for (let i = 1; i < series.length; i++) {
    out[i] = (series[i] - series[i - 1]) / dt;
  }
  if (series.length > 1) out[0] = out[1];
  return out;
}

function angVelDegPerSec(quats, dt) {
  const w = new Array(quats.length).fill(0);
  for (let i = 1; i < quats.length; i++) {
    w[i] = (quatAngle(quats[i - 1], quats[i]) / dt) * (180 / Math.PI);
  }
  if (quats.length > 1) w[0] = w[1];
  return w;
}

/**
 * Classic DTW on 3D paths. Caps length to avoid O(n²) memory blowups
 * (two Float64 rows ≈ 16*(m+1) bytes; length capped at DTW_MAX_N).
 */
const DTW_MAX_N = 800;

function subsamplePath(path, maxN) {
  if (path.length <= maxN) return path;
  const out = new Array(maxN);
  const last = path.length - 1;
  for (let i = 0; i < maxN; i++) {
    out[i] = path[Math.round((i / (maxN - 1)) * last)];
  }
  return out;
}

function dtwPosition(gtIn, predIn) {
  const gt = subsamplePath(gtIn, DTW_MAX_N);
  const pred = subsamplePath(predIn, DTW_MAX_N);
  const n = gt.length;
  const m = pred.length;
  if (!n || !m) return { distance_m: NaN, normalized_m: NaN };
  const INF = 1e30;
  // two-row DP to keep memory ~O(m) instead of O(n*m)
  let prev = new Float64Array(m + 1).fill(INF);
  let curr = new Float64Array(m + 1).fill(INF);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    curr[0] = INF;
    const a = gt[i - 1];
    for (let j = 1; j <= m; j++) {
      const b = pred[j - 1];
      const c = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      curr[j] = c + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
    curr.fill(INF);
  }
  const distance_m = prev[m];
  return { distance_m, normalized_m: distance_m / Math.max(n, m) };
}

/**
 * Search lag (pred delayed by +lag frames vs GT) minimizing mean ||pred(t)-gt(t+lag)||.
 * Positive lag ⇒ pred lags behind GT (慢半拍).
 */
function bestLag(gt, pred, maxLag) {
  const n = Math.min(gt.length, pred.length);
  let bestLag = 0;
  let bestMean = Infinity;
  let bestCorr = 0;
  const lim = Math.min(maxLag, Math.floor(n / 4));

  for (let lag = -lim; lag <= lim; lag++) {
    let sum = 0;
    let cnt = 0;
    let sumGp = 0;
    let sumG2 = 0;
    let sumP2 = 0;
    for (let t = 0; t < n; t++) {
      const tg = t + lag;
      if (tg < 0 || tg >= n) continue;
      const g = gt[tg];
      const p = pred[t];
      const e = Math.hypot(p.x - g.x, p.y - g.y, p.z - g.z);
      sum += e;
      cnt++;
      // scalar proxy for correlation: z height (stable vertical signal)
      sumGp += g.z * p.z;
      sumG2 += g.z * g.z;
      sumP2 += p.z * p.z;
    }
    if (!cnt) continue;
    const mean = sum / cnt;
    const den = Math.sqrt(sumG2 * sumP2) || 1;
    const corr = sumGp / den;
    if (mean < bestMean) {
      bestMean = mean;
      bestLag = lag;
      bestCorr = corr;
    }
  }
  return { lag_frames: bestLag, mean_ep_m: bestMean, z_corr: bestCorr };
}

function pathLength(pos) {
  let L = 0;
  for (let i = 1; i < pos.length; i++) {
    const a = pos[i - 1];
    const b = pos[i];
    L += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  return L;
}

function vecNormalize(v) {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

/** Rotate vector by unit quaternion (q * v * q^{-1}). */
function quatRotateVec(qIn, v) {
  const q = quatNormalize(qIn);
  const qv = { x: v.x, y: v.y, z: v.z, w: 0 };
  const r = quatMul(quatMul(q, qv), quatConjugate(q));
  return { x: r.x, y: r.y, z: r.z };
}

/** Unit approach direction from goalPose.approach or −Z of goal quat. */
function goalApproachDir(goalPose) {
  if (goalPose?.approach) return vecNormalize(goalPose.approach);
  if (goalPose?.quat) return vecNormalize(quatRotateVec(goalPose.quat, { x: 0, y: 0, z: -1 }));
  return { x: 0, y: 0, z: -1 };
}

/** Gripper approach proxy: −Y of TCP quat (SO-100 gripper local −Y ≈ tip direction). */
function tcpApproachDir(quat, localAxis = { x: 0, y: -1, z: 0 }) {
  return vecNormalize(quatRotateVec(quat, localAxis));
}

function approachAngleDeg(a, b) {
  const dot = clamp(a.x * b.x + a.y * b.y + a.z * b.z, -1, 1);
  return Math.acos(dot) * (180 / Math.PI);
}

/** Split by cumulative GT path length into 4 equal segments. */
function segmentByPathLength(gtPos, ep, eR) {
  const names = ['approach', 'contact', 'transport', 'retreat'];
  const n = gtPos.length;
  const total = pathLength(gtPos) || 1;
  const cum = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const a = gtPos[i - 1];
    const b = gtPos[i];
    cum[i] = cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  }
  const cuts = [0, 0.25, 0.5, 0.75, 1].map((f) => f * total);
  const segs = {};
  for (let s = 0; s < 4; s++) {
    const i0 = cum.findIndex((c) => c >= cuts[s] - 1e-12);
    let i1 = n - 1;
    for (let i = n - 1; i >= 0; i--) {
      if (cum[i] <= cuts[s + 1] + 1e-12) {
        i1 = i;
        break;
      }
    }
    const start = Math.max(0, i0 < 0 ? 0 : i0);
    const end = Math.max(start, endIdx(i1, n));
    const sliceEp = ep.slice(start, end + 1);
    const sliceEr = eR.slice(start, end + 1);
    segs[names[s]] = {
      i0: start,
      i1: end,
      ep_mm: summarize(sliceEp.map((v) => v * 1000)),
      eR_deg: summarize(sliceEr),
    };
  }
  return segs;

  function endIdx(i, nn) {
    return Math.min(nn - 1, Math.max(0, i));
  }
}

/**
 * @param {object} opts
 * @param {{x,y,z}[]} opts.gtPos
 * @param {{x,y,z}[]} opts.predPos
 * @param {{x,y,z,w}[]} opts.gtQuat
 * @param {{x,y,z,w}[]} opts.predQuat
 * @param {number} opts.fps
 * @param {object|null} [opts.goalPose] optional task frame {pos, quat} in same world
 */
export function computeTcpMetrics({ gtPos, predPos, gtQuat, predQuat, fps, goalPose = null }) {
  const n = Math.min(gtPos.length, predPos.length, gtQuat.length, predQuat.length);
  const dt = 1 / Math.max(1e-6, fps || 30);
  const RAD2DEG = 180 / Math.PI;

  const ep = new Array(n);
  const eR = new Array(n);
  const dx = new Array(n);
  const dy = new Array(n);
  const dz = new Array(n);
  const droll = new Array(n);
  const dpitch = new Array(n);
  const dyaw = new Array(n);

  for (let i = 0; i < n; i++) {
    const g = gtPos[i];
    const p = predPos[i];
    dx[i] = (p.x - g.x) * 1000;
    dy[i] = (p.y - g.y) * 1000;
    dz[i] = (p.z - g.z) * 1000;
    ep[i] = Math.hypot(p.x - g.x, p.y - g.y, p.z - g.z);
    eR[i] = quatAngle(gtQuat[i], predQuat[i]) * RAD2DEG;
    const eu = relativeEulerXYZ(gtQuat[i], predQuat[i]);
    droll[i] = eu.roll * RAD2DEG;
    dpitch[i] = eu.pitch * RAD2DEG;
    dyaw[i] = eu.yaw * RAD2DEG;
  }

  const epMm = ep.map((v) => v * 1000);
  const vGt = {
    x: finiteDiff(gtPos.map((p) => p.x), dt),
    y: finiteDiff(gtPos.map((p) => p.y), dt),
    z: finiteDiff(gtPos.map((p) => p.z), dt),
  };
  const vPred = {
    x: finiteDiff(predPos.map((p) => p.x), dt),
    y: finiteDiff(predPos.map((p) => p.y), dt),
    z: finiteDiff(predPos.map((p) => p.z), dt),
  };
  const vErr = new Array(n);
  for (let i = 0; i < n; i++) {
    vErr[i] = Math.hypot(
      vPred.x[i] - vGt.x[i],
      vPred.y[i] - vGt.y[i],
      vPred.z[i] - vGt.z[i],
    );
  }
  const wGt = angVelDegPerSec(gtQuat, dt);
  const wPred = angVelDegPerSec(predQuat, dt);
  const wErr = wPred.map((w, i) => Math.abs(w - wGt[i]));

  // Acceleration (m/s²) from linear velocity magnitude of TCP
  const speedGt = vGt.x.map((_, i) => Math.hypot(vGt.x[i], vGt.y[i], vGt.z[i]));
  const speedPred = vPred.x.map((_, i) => Math.hypot(vPred.x[i], vPred.y[i], vPred.z[i]));
  const aGt = finiteDiff(speedGt, dt);
  const aPred = finiteDiff(speedPred, dt);
  const aErr = aPred.map((a, i) => Math.abs(a - aGt[i]));

  const lag = bestLag(gtPos.slice(0, n), predPos.slice(0, n), 30);
  const dtw = dtwPosition(gtPos.slice(0, n), predPos.slice(0, n));

  let task = {
    available: false,
    reason: 'compare_result 未提供目标物 / grasp frame 位姿（meta.goal_pose: {pos,quat,approach?}）',
  };
  if (goalPose?.pos && goalPose?.quat) {
    const gp = goalPose.pos;
    const gq = goalPose.quat;
    const gApproach = goalApproachDir(goalPose);
    const localAxis = goalPose.tcp_approach_local || { x: 0, y: -1, z: 0 };
    const gtTask = new Array(n);
    const predTask = new Array(n);
    for (let i = 0; i < n; i++) {
      const gtApp = tcpApproachDir(gtQuat[i], localAxis);
      const predApp = tcpApproachDir(predQuat[i], localAxis);
      gtTask[i] = {
        ep_mm: Math.hypot(gtPos[i].x - gp.x, gtPos[i].y - gp.y, gtPos[i].z - gp.z) * 1000,
        eR_deg: quatAngle(gtQuat[i], gq) * RAD2DEG,
        approach_deg: approachAngleDeg(gtApp, gApproach),
      };
      predTask[i] = {
        ep_mm: Math.hypot(predPos[i].x - gp.x, predPos[i].y - gp.y, predPos[i].z - gp.z) * 1000,
        eR_deg: quatAngle(predQuat[i], gq) * RAD2DEG,
        approach_deg: approachAngleDeg(predApp, gApproach),
      };
    }
    const last = n - 1;
    const pack = (rows) => ({
      ep_mm: summarize(rows.map((x) => x.ep_mm)),
      eR_deg: summarize(rows.map((x) => x.eR_deg)),
      approach_deg: summarize(rows.map((x) => x.approach_deg)),
      final: rows[last],
    });
    task = {
      available: true,
      goal: { pos: gp, quat: gq, approach: gApproach },
      gt: pack(gtTask),
      pred: pack(predTask),
      // pred vs GT relative to same goal (positive ⇒ pred farther/worse than GT)
      delta_final: {
        ep_mm: predTask[last].ep_mm - gtTask[last].ep_mm,
        eR_deg: predTask[last].eR_deg - gtTask[last].eR_deg,
        approach_deg: predTask[last].approach_deg - gtTask[last].approach_deg,
      },
      series: { gt: gtTask, pred: predTask },
    };
  }

  return {
    fps,
    n,
    summary: {
      ep_mm: summarize(epMm),
      eR_deg: summarize(eR),
      dx_mm: summarize(dx.map(Math.abs)),
      dy_mm: summarize(dy.map(Math.abs)),
      dz_mm: summarize(dz.map(Math.abs)),
      v_err_mps: summarize(vErr),
      w_err_dps: summarize(wErr),
      a_err_mps2: summarize(aErr),
    },
    series: {
      ep_mm: epMm,
      eR_deg: eR,
      dx_mm: dx,
      dy_mm: dy,
      dz_mm: dz,
      droll_deg: droll,
      dpitch_deg: dpitch,
      dyaw_deg: dyaw,
      v_err_mps: vErr,
      w_err_dps: wErr,
      a_err_mps2: aErr,
    },
    temporal: {
      lag_frames: lag.lag_frames,
      lag_s: lag.lag_frames * dt,
      mean_ep_at_lag_mm: lag.mean_ep_m * 1000,
      z_corr_at_lag: lag.z_corr,
      dtw_distance_m: dtw.distance_m,
      dtw_normalized_m: dtw.normalized_m,
    },
    segments: segmentByPathLength(gtPos.slice(0, n), ep, eR),
    task,
  };
}

export function formatSummaryLine(s) {
  if (!s || !Number.isFinite(s.mean)) return '—';
  return `μ ${s.mean.toFixed(2)} · p95 ${s.p95.toFixed(2)} · max ${s.max.toFixed(2)}`;
}
