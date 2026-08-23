/**
 * TCP / base calibration helpers (I36).
 * Pure math — no Three.js dependency.
 */

function asVec3(v, fallback = [0, 0, 0]) {
  if (!Array.isArray(v) || v.length < 3) return fallback.slice();
  return [Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0];
}

/** XYZ intrinsic RPY (deg) → quaternion {x,y,z,w}. */
export function rpyDegToQuat(rpyDeg) {
  const [rd, pd, yd] = asVec3(rpyDeg);
  const r = (rd * Math.PI) / 180;
  const p = (pd * Math.PI) / 180;
  const y = (yd * Math.PI) / 180;
  const cr = Math.cos(r * 0.5);
  const sr = Math.sin(r * 0.5);
  const cp = Math.cos(p * 0.5);
  const sp = Math.sin(p * 0.5);
  const cy = Math.cos(y * 0.5);
  const sy = Math.sin(y * 0.5);
  return {
    w: cr * cp * cy + sr * sp * sy,
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy,
  };
}

export function quatMul(a, b) {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Rotate vector by unit quaternion. */
export function quatRotateVec(q, v) {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  const qx = q.x;
  const qy = q.y;
  const qz = q.z;
  const qw = q.w;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ];
}

/**
 * Resolve TCP offset in link frame: robots.json offset + profile calibration + meta.tcp_calibration.
 * @returns {{ xyz: number[], rpy_deg: number[] }}
 */
export function resolveTcpCalibration(robotTcp = {}, meta = {}) {
  const base = asVec3(robotTcp.offset);
  const calProf = robotTcp.calibration || {};
  const calMeta = meta.tcp_calibration || {};
  const dProf = asVec3(calProf.xyz || calProf.t);
  const dMeta = asVec3(calMeta.xyz || calMeta.t);
  const rpyProf = asVec3(calProf.rpy_deg || calProf.rpy);
  const rpyMeta = asVec3(calMeta.rpy_deg || calMeta.rpy);
  return {
    xyz: [base[0] + dProf[0] + dMeta[0], base[1] + dProf[1] + dMeta[1], base[2] + dProf[2] + dMeta[2]],
    rpy_deg: [rpyProf[0] + rpyMeta[0], rpyProf[1] + rpyMeta[1], rpyProf[2] + rpyMeta[2]],
  };
}

/**
 * Optional base-in-world extrinsics from meta.extrinsics.
 * @returns {{ xyz: number[], quat: {x,y,z,w} } | null}
 */
export function resolveBaseExtrinsics(meta = {}) {
  const ex = meta.extrinsics || meta.base_extrinsics || null;
  if (!ex || typeof ex !== 'object') return null;
  const frame = ex.base_in_world || ex.base_T_world || ex;
  const xyz = asVec3(frame.xyz || frame.t || frame.translation);
  let quat;
  if (Array.isArray(frame.quaternion) && frame.quaternion.length >= 4) {
    const [x, y, z, w] = frame.quaternion.map(Number);
    quat = { x, y, z, w };
  } else if (frame.xyzw && Array.isArray(frame.xyzw)) {
    const [x, y, z, w] = frame.xyzw.map(Number);
    quat = { x, y, z, w };
  } else {
    quat = rpyDegToQuat(frame.rpy_deg || frame.rpy || [0, 0, 0]);
  }
  const identity =
    Math.abs(xyz[0]) + Math.abs(xyz[1]) + Math.abs(xyz[2]) < 1e-12
    && Math.abs(quat.x) + Math.abs(quat.y) + Math.abs(quat.z) < 1e-12
    && Math.abs(Math.abs(quat.w) - 1) < 1e-9;
  if (identity) return null;
  return { xyz, quat };
}

/**
 * Apply base extrinsics to a world-frame pose (pos array + quat).
 */
export function applyExtrinsicsToPose(pos, quat, extrinsics) {
  if (!extrinsics) return { pos, quat };
  const p0 = [pos.x ?? pos[0], pos.y ?? pos[1], pos.z ?? pos[2]];
  const rotated = quatRotateVec(extrinsics.quat, p0);
  const posOut = {
    x: rotated[0] + extrinsics.xyz[0],
    y: rotated[1] + extrinsics.xyz[1],
    z: rotated[2] + extrinsics.xyz[2],
  };
  const quatOut = quatMul(extrinsics.quat, quat);
  return { pos: posOut, quat: quatOut };
}
