/**
 * Task success, contact events, and dynamic object/grasp targets (G28–G30).
 *
 * Schema:
 *   meta.task_outcome: {
 *     task?: string,                    // e.g. pick_place
 *     outcome: "success" | "fail" | "partial" | "unknown",
 *     labels?: string[],                // achieved subgoals: grasp, place, …
 *     reason_code?: string,             // ok | miss_grasp | slip | timeout | collision | …
 *     reason?: string,
 *     score?: number,                   // 0..1
 *     judged_at_frame?: number
 *   }
 *   meta.objects?: [{ id, label?, color? }]
 *
 *   events?: [                          // episode-level event stream (G29)
 *     { t?: number, frame?: number, type: string,
 *       force_n?, slip_mm?, width_mm?, object?, link?, note? }
 *   ]
 *
 *   frames[i].contact?: {               // optional dense contact (G29)
 *     in_contact?: boolean, force_n?, slip_mm?, width_mm?
 *   }
 *   frames[i].objects?: {               // dynamic object / grasp frames (G30)
 *     [objectId]: { pos:{x,y,z}, quat?:{x,y,z,w}, grasp?: {pos, quat?} }
 *   }
 *   frames[i].goal_pose?: {…}           // per-frame target override (G30)
 */

const OUTCOME_OK = new Set(['success', 'ok', 'pass', 'true', true, 1, '1']);
const OUTCOME_FAIL = new Set(['fail', 'failed', 'failure', 'false', false, 0, '0']);
const OUTCOME_PARTIAL = new Set(['partial', 'incomplete']);

export function normalizeOutcome(raw) {
  if (raw == null || raw === '') return 'unknown';
  const s = String(raw).toLowerCase();
  if (OUTCOME_OK.has(raw) || OUTCOME_OK.has(s)) return 'success';
  if (OUTCOME_FAIL.has(raw) || OUTCOME_FAIL.has(s)) return 'fail';
  if (OUTCOME_PARTIAL.has(s)) return 'partial';
  return s;
}

export function getTaskOutcome(meta = {}) {
  const src = meta.task_outcome || meta.task_result || null;
  if (!src || typeof src !== 'object') {
    return {
      available: false,
      outcome: 'unknown',
      labels: [],
      reason_code: null,
      reason: null,
      score: null,
      task: meta.task || meta.task_name || null,
      judged_at_frame: null,
    };
  }
  const outcome = normalizeOutcome(src.outcome ?? src.success ?? src.result);
  const labels = Array.isArray(src.labels) ? src.labels.map(String) : [];
  let score = Number.isFinite(src.score) ? src.score : null;
  if (score == null) {
    if (outcome === 'success') score = 1;
    else if (outcome === 'fail') score = 0;
    else if (outcome === 'partial') score = labels.length ? Math.min(1, labels.length / 2) : 0.5;
  }
  return {
    available: true,
    outcome,
    labels,
    reason_code: src.reason_code || src.code || null,
    reason: src.reason || src.message || null,
    score,
    task: src.task || meta.task || meta.task_name || null,
    judged_at_frame: Number.isFinite(src.judged_at_frame) ? src.judged_at_frame : null,
  };
}

export function getDeclaredObjects(meta = {}) {
  return Array.isArray(meta.objects) ? meta.objects.filter((o) => o && o.id) : [];
}

export function getEvents(data) {
  const list = data?.events || data?.meta?.events || data?.contact_events || [];
  return Array.isArray(list) ? list : [];
}

function frameFromEvent(ev, frames, fps = 30) {
  if (Number.isFinite(ev.frame)) return Math.max(0, Math.min(frames.length - 1, Math.round(ev.frame)));
  if (Number.isFinite(ev.t) && frames.length) {
    // prefer matching timestamp
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < frames.length; i++) {
      const ti = Number(frames[i].timestamp ?? i / fps);
      const d = Math.abs(ti - ev.t);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }
  return 0;
}

/** Normalize events with resolved frame index. */
export function normalizeEvents(data) {
  const frames = data?.frames || [];
  const fps = data?.meta?.fps || 30;
  return getEvents(data).map((ev, idx) => {
    const type = String(ev.type || ev.kind || 'event');
    const frame = frameFromEvent(ev, frames, fps);
    const t = Number.isFinite(ev.t)
      ? ev.t
      : Number(frames[frame]?.timestamp ?? frame / fps);
    return {
      id: ev.id || `ev${idx}`,
      type,
      frame,
      t,
      force_n: Number.isFinite(ev.force_n) ? ev.force_n : null,
      slip_mm: Number.isFinite(ev.slip_mm) ? ev.slip_mm : null,
      width_mm: Number.isFinite(ev.width_mm) ? ev.width_mm : null,
      object: ev.object || null,
      link: ev.link || null,
      note: ev.note || ev.msg || null,
      raw: ev,
    };
  }).sort((a, b) => a.frame - b.frame || a.t - b.t);
}

/** Dense contact series from frames[].contact and/or events. */
export function buildContactSeries(data) {
  const frames = data?.frames || [];
  const n = frames.length;
  const force = new Array(n).fill(null);
  const slip = new Array(n).fill(null);
  const width = new Array(n).fill(null);
  const inContact = new Array(n).fill(false);

  for (let i = 0; i < n; i++) {
    const c = frames[i]?.contact;
    if (!c) continue;
    if (typeof c.in_contact === 'boolean') inContact[i] = c.in_contact;
    if (Number.isFinite(c.force_n)) {
      force[i] = c.force_n;
      if (c.force_n > 0.05) inContact[i] = true;
    }
    if (Number.isFinite(c.slip_mm)) slip[i] = c.slip_mm;
    if (Number.isFinite(c.width_mm)) width[i] = c.width_mm;
  }

  // stamp event spikes onto series if dense missing
  for (const ev of normalizeEvents(data)) {
    const i = ev.frame;
    if (i < 0 || i >= n) continue;
    if (ev.type.includes('contact') || ev.type.includes('grasp') || ev.type === 'force') {
      inContact[i] = true;
    }
    if (ev.force_n != null && force[i] == null) force[i] = ev.force_n;
    if (ev.slip_mm != null && slip[i] == null) slip[i] = ev.slip_mm;
    if (ev.width_mm != null && width[i] == null) width[i] = ev.width_mm;
    if (ev.type === 'slip' || ev.type === 'slip_start') inContact[i] = true;
  }

  const forceVals = force.filter((x) => x != null);
  const slipVals = slip.filter((x) => x != null);
  return {
    available: forceVals.length > 0 || slipVals.length > 0 || inContact.some(Boolean) || normalizeEvents(data).length > 0,
    force_n: force,
    slip_mm: slip,
    width_mm: width,
    in_contact: inContact,
    n_contact_frames: inContact.filter(Boolean).length,
    max_force_n: forceVals.length ? Math.max(...forceVals) : null,
    max_slip_mm: slipVals.length ? Math.max(...slipVals) : null,
  };
}

function readPose(obj) {
  if (!obj?.pos) return null;
  const p = obj.pos;
  const pos = {
    x: Number(p.x ?? p[0]),
    y: Number(p.y ?? p[1]),
    z: Number(p.z ?? p[2]),
  };
  if (![pos.x, pos.y, pos.z].every(Number.isFinite)) return null;
  let quat = null;
  if (obj.quat) {
    const q = obj.quat;
    quat = {
      x: Number(q.x ?? q[0] ?? 0),
      y: Number(q.y ?? q[1] ?? 0),
      z: Number(q.z ?? q[2] ?? 0),
      w: Number(q.w ?? q[3] ?? 1),
    };
  }
  return { pos, quat, grasp: obj.grasp ? readPose(obj.grasp) : null };
}

/** Per-object trajectories from frames[].objects (G30). */
export function buildObjectTrajectories(data) {
  const frames = data?.frames || [];
  const declared = getDeclaredObjects(data?.meta);
  const ids = new Set(declared.map((o) => o.id));
  for (const f of frames) {
    if (f?.objects && typeof f.objects === 'object') {
      for (const id of Object.keys(f.objects)) ids.add(id);
    }
  }
  const traj = {};
  for (const id of ids) {
    const pos = [];
    const quat = [];
    const graspPos = [];
    let present = 0;
    for (let i = 0; i < frames.length; i++) {
      const pose = readPose(frames[i]?.objects?.[id]);
      if (pose) {
        present += 1;
        pos.push(pose.pos);
        quat.push(pose.quat);
        graspPos.push(pose.grasp?.pos || null);
      } else {
        pos.push(null);
        quat.push(null);
        graspPos.push(null);
      }
    }
    if (present === 0) continue;
    const metaObj = declared.find((o) => o.id === id) || { id };
    traj[id] = {
      id,
      label: metaObj.label || id,
      color: metaObj.color || null,
      present,
      pos,
      quat,
      grasp_pos: graspPos,
    };
  }
  return {
    available: Object.keys(traj).length > 0,
    objects: traj,
    ids: Object.keys(traj),
  };
}

/** Per-frame goal (static meta.goal_pose or frames[i].goal_pose). */
export function resolveGoalAtFrame(data, frameIdx) {
  const f = data?.frames?.[frameIdx];
  if (f?.goal_pose?.pos) return f.goal_pose;
  return data?.meta?.goal_pose || null;
}

export function distMm(a, b) {
  if (!a || !b) return null;
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz) * 1000;
}

/**
 * Distance from TCP path to primary object / grasp frame (mm).
 * @param {Array<{x,y,z}>} tcpPath
 */
export function buildObjectTcpDistances(data, tcpPath, objectId = null) {
  const ot = buildObjectTrajectories(data);
  if (!ot.available || !tcpPath?.length) {
    return { available: false, series: {}, primary: null };
  }
  const primary = objectId && ot.objects[objectId]
    ? objectId
    : ot.ids[0];
  const series = {};
  for (const id of ot.ids) {
    const tr = ot.objects[id];
    const toObj = [];
    const toGrasp = [];
    for (let i = 0; i < tcpPath.length; i++) {
      toObj.push(distMm(tcpPath[i], tr.pos[i]));
      toGrasp.push(distMm(tcpPath[i], tr.grasp_pos[i]));
    }
    series[id] = { to_object_mm: toObj, to_grasp_mm: toGrasp };
  }
  return { available: true, series, primary, trajectories: ot };
}

/** Full G audit for UI / Hub. */
export function analyzeTaskEpisode(data) {
  const outcome = getTaskOutcome(data?.meta);
  const events = normalizeEvents(data);
  const contact = buildContactSeries(data);
  const objects = buildObjectTrajectories(data);
  const hasDynamicGoal = (data?.frames || []).some((f) => f?.goal_pose?.pos);

  return {
    outcome,
    events,
    contact,
    objects,
    has_dynamic_goal: hasDynamicGoal,
    has_g28: outcome.available,
    has_g29: contact.available || events.length > 0,
    has_g30: objects.available || hasDynamicGoal,
  };
}

export function outcomeTagClass(outcome) {
  const o = normalizeOutcome(outcome);
  if (o === 'success') return 'ok';
  if (o === 'fail') return 'bad';
  if (o === 'partial') return 'warn';
  return '';
}
