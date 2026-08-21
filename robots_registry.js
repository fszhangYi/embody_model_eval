/**
 * Robot registry helpers — load robots.json and resolve episode meta.robot.
 */

export async function loadRobotRegistry(path = './robots.json') {
  const res = await fetch(path + (path.includes('?') ? '&' : '?') + '_=' + Date.now());
  if (!res.ok) throw new Error(`无法加载机械臂配置 ${path} → ${res.status}`);
  const cfg = await res.json();
  if (!cfg?.robots || typeof cfg.robots !== 'object') {
    throw new Error('robots.json 缺少 robots 映射');
  }
  return cfg;
}

/** Accept meta.robot / robot_id / robot_model / arm. */
export function readEpisodeRobotId(meta = {}) {
  const raw = meta.robot ?? meta.robot_id ?? meta.robot_model ?? meta.arm ?? null;
  if (raw == null || raw === '') return null;
  return String(raw).trim();
}

/**
 * Resolve a robot profile for an episode.
 * @throws if robot id missing or unknown (unless allowDefault).
 */
export function resolveRobot(registry, meta = {}, { allowDefault = false } = {}) {
  const robots = registry?.robots || {};
  let id = readEpisodeRobotId(meta);
  if (!id) {
    if (allowDefault && registry?.default && robots[registry.default]) {
      id = registry.default;
    } else {
      throw new Error(
        'episode 未声明机械臂型号：请在 meta.robot 填写 robots.json 中的 id（例如 "so100"）',
      );
    }
  }
  const profile = robots[id];
  if (!profile) {
    const known = Object.keys(robots).join(', ') || '(无)';
    throw new Error(`未知机械臂型号 meta.robot="${id}"；当前可用：${known}`);
  }
  return normalizeRobotProfile(profile, id);
}

export function normalizeRobotProfile(profile, fallbackId) {
  const id = profile.id || fallbackId;
  const joint_names = Array.isArray(profile.joint_names) ? profile.joint_names.slice() : [];
  if (!joint_names.length) throw new Error(`robots.json 中 ${id} 缺少 joint_names`);
  const urdf = profile.urdf || {};
  if (!urdf.cur || !urdf.gt || !urdf.pred) {
    throw new Error(`robots.json 中 ${id} 需提供 urdf.cur / urdf.gt / urdf.pred`);
  }
  const tcp = profile.tcp || {};
  const offset = Array.isArray(tcp.offset) && tcp.offset.length >= 3
    ? [Number(tcp.offset[0]), Number(tcp.offset[1]), Number(tcp.offset[2])]
    : [0, 0, 0];
  const root = Array.isArray(profile.root_rotation_euler_xyz_deg)
    && profile.root_rotation_euler_xyz_deg.length >= 3
    ? profile.root_rotation_euler_xyz_deg.map(Number)
    : [0, 0, 0];
  const colors = {
    cur: profile.colors?.cur || '#9ca3af',
    gt: profile.colors?.gt || '#ef4444',
    pred: profile.colors?.pred || '#3b82f6',
  };
  const home = Array.isArray(profile.home_q_deg)
    ? profile.home_q_deg.map(Number)
    : joint_names.map(() => 0);
  const scaleRaw = Number(profile.model_scale);
  const model_scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;
  return {
    id,
    label: profile.label || id,
    description: profile.description || '',
    joint_names,
    urdf: {
      preview: urdf.preview || urdf.cur,
      cur: urdf.cur,
      gt: urdf.gt,
      pred: urdf.pred,
    },
    root_rotation_euler_xyz_deg: root,
    model_scale,
    tcp: {
      link: tcp.link || 'gripper',
      offset,
    },
    colors,
    home_q_deg: home,
  };
}

export function listRobots(registry) {
  return Object.keys(registry?.robots || {}).sort().map((id) => {
    const p = registry.robots[id];
    return { id, label: p.label || id, description: p.description || '' };
  });
}

/** Soft check: episode joint_names vs robot profile. */
export function jointNamesMismatch(meta, robot) {
  const a = meta?.joint_names;
  const b = robot?.joint_names;
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  if (a.length !== b.length) {
    return `joint_names 长度 ${a.length} ≠ 机型 ${robot.id} 的 ${b.length}`;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return `joint_names[${i}]="${a[i]}" ≠ 机型 "${b[i]}"`;
  }
  return null;
}

/**
 * Fool-proof validation for Hub / loaders.
 * @returns {{ ok: boolean, errors: string[], warnings: string[], robot: object|null }}
 */
export function validateEpisodeAgainstRegistry(data, registry) {
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['不是 JSON 对象'], warnings, robot: null };
  }
  const meta = data.meta;
  if (!meta || typeof meta !== 'object') {
    return { ok: false, errors: ['缺少 meta'], warnings, robot: null };
  }
  if (!Array.isArray(data.frames) || data.frames.length === 0) {
    errors.push('缺少非空 frames[]');
  }

  let robot = null;
  try {
    robot = resolveRobot(registry, meta, { allowDefault: false });
  } catch (e) {
    errors.push(e.message || String(e));
  }

  if (robot) {
    const mm = jointNamesMismatch(meta, robot);
    if (mm) errors.push(mm);
    else if (!Array.isArray(meta.joint_names)) {
      warnings.push('meta.joint_names 缺失，将使用 robots.json 中的关节名');
    }

    const dof = robot.joint_names.length;
    const keys = ['current', 'next_gt', 'next_pred'];
    const nCheck = Math.min(data.frames?.length || 0, 8);
    for (let i = 0; i < nCheck; i++) {
      const f = data.frames[i];
      if (!f || typeof f !== 'object') {
        errors.push(`frames[${i}] 非法`);
        break;
      }
      for (const k of keys) {
        if (!Array.isArray(f[k])) {
          errors.push(`frames[${i}].${k} 缺失或非数组`);
          break;
        }
        if (f[k].length !== dof) {
          errors.push(`frames[${i}].${k}.length=${f[k].length} ≠ 机型自由度 ${dof}`);
          break;
        }
      }
      if (errors.length > 6) break;
    }
  }

  return { ok: errors.length === 0, errors, warnings, robot };
}
