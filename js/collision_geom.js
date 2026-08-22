/**
 * URDF collision / convex-hull style sampling + pairwise checks (I35).
 * Three.js optional: sampleCollisionClouds requires a loaded URDFRobot.
 */

/**
 * @typedef {{ name: string, points: {x:number,y:number,z:number}[], radius: number }} HullCloud
 */

function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function minDistClouds(aPts, bPts) {
  let best = Infinity;
  for (let i = 0; i < aPts.length; i++) {
    for (let j = 0; j < bPts.length; j++) {
      const d2 = dist2(aPts[i], bPts[j]);
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}

/**
 * Sample world-frame point clouds from URDF collision meshes (fallback: visuals).
 * Positions are returned in **meters of the robot's current matrixWorld**
 * (caller should divide by model_scale if the robot was display-scaled).
 *
 * @param {object} robot URDFRobot (three)
 * @param {object} THREE three module namespace
 * @param {{ links?: string[], maxPointsPerLink?: number, invScale?: number }} [opts]
 * @returns {HullCloud[]}
 */
export function sampleCollisionClouds(robot, THREE, opts = {}) {
  if (!robot || !THREE) return [];
  const maxPts = Math.max(4, Math.min(64, opts.maxPointsPerLink || 28));
  const invScale = Number(opts.invScale) > 0 ? Number(opts.invScale) : 1;
  const linkNames = Array.isArray(opts.links) && opts.links.length
    ? opts.links.slice()
    : Object.keys(robot.links || {});

  const _v = new THREE.Vector3();
  const clouds = [];

  for (const name of linkNames) {
    const link = robot.links?.[name];
    if (!link) continue;

    const meshEntries = [];
    link.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry) return;
      let n = obj.parent;
      let isCollision = false;
      let isVisual = false;
      while (n && n !== link) {
        if (n.isURDFCollider) {
          isCollision = true;
          break;
        }
        if (n.isURDFVisual) {
          isVisual = true;
          break;
        }
        n = n.parent;
      }
      meshEntries.push({ mesh: obj, isCollision, isVisual });
    });

    const cols = meshEntries.filter((m) => m.isCollision);
    const use = cols.length ? cols : meshEntries;
    const points = [];
    let radius = 0.015;

    for (const { mesh } of use) {
      const geom = mesh.geometry;
      if (!geom.boundingSphere) geom.computeBoundingSphere();
      if (geom.boundingSphere) {
        radius = Math.max(radius, geom.boundingSphere.radius * Math.max(mesh.scale.x, mesh.scale.y, mesh.scale.z));
      }
      const posAttr = geom.getAttribute?.('position');
      if (!posAttr || !posAttr.count) {
        mesh.getWorldPosition(_v);
        points.push({
          x: _v.x * invScale,
          y: _v.y * invScale,
          z: _v.z * invScale,
        });
        continue;
      }
      const step = Math.max(1, Math.floor(posAttr.count / maxPts));
      mesh.updateWorldMatrix(true, false);
      for (let i = 0; i < posAttr.count; i += step) {
        _v.fromBufferAttribute(posAttr, i);
        _v.applyMatrix4(mesh.matrixWorld);
        points.push({
          x: _v.x * invScale,
          y: _v.y * invScale,
          z: _v.z * invScale,
        });
        if (points.length >= maxPts) break;
      }
      if (points.length >= maxPts) break;
    }

    if (!points.length) {
      link.getWorldPosition(_v);
      points.push({
        x: _v.x * invScale,
        y: _v.y * invScale,
        z: _v.z * invScale,
      });
    }

    clouds.push({
      name,
      points,
      radius: radius * invScale,
    });
  }
  return clouds;
}

/**
 * Hull / point-cloud collision check (table plane + self).
 * @param {HullCloud[][]} hullSeries per-frame hull clouds
 * @param {object} [cfg]
 */
export function analyzeHullCollisions(hullSeries, cfg = {}) {
  const tableZ = Number(cfg.table_z ?? 0);
  const tableClearance = Number(cfg.table_clearance_m ?? 0.008);
  const selfMin = Number(cfg.self_min_dist_m ?? 0.02);
  const skipAdjacent = Math.max(0, cfg.skip_adjacent | 0);
  const tableHits = [];
  const selfHits = [];

  for (let i = 0; i < hullSeries.length; i++) {
    const clouds = hullSeries[i];
    if (!clouds?.length) continue;

    for (let a = 0; a < clouds.length; a++) {
      const ca = clouds[a];
      for (const p of ca.points) {
        if (p.z < tableZ + tableClearance) {
          tableHits.push({ i, link: ca.name, z: p.z, method: 'hull' });
          break;
        }
      }
      for (let b = a + 1 + skipAdjacent; b < clouds.length; b++) {
        const cb = clouds[b];
        const d = minDistClouds(ca.points, cb.points);
        const pad = 0.25 * (ca.radius + cb.radius);
        if (d < selfMin + pad * 0.15) {
          selfHits.push({
            i,
            a: ca.name,
            b: cb.name,
            dist_mm: d * 1000,
            method: 'hull',
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
    method: 'hull',
  };
}
