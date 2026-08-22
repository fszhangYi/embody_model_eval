/**
 * Observation alignment & camera sync (F25–F27).
 *
 * Protocol (F26) — episode JSON:
 *   meta.cameras: [{ id, stream: "rgb"|"depth"|"attention", width, height, fps?, mount? }]
 *   meta.obs_alignment: {
 *     mode: "frame_index" | "nearest_timestamp",
 *     max_skew_ms: number,
 *     action_time_field: "timestamp"   // default
 *   }
 *   frames[i].timestamp: number (sec) — action clock
 *   frames[i].obs[cameraId]: {
 *     path: string,          // URL relative to site or episode
 *     t?: number,            // observation time (sec)
 *     overlays?: Overlay[]
 *   }
 *
 * Overlay:
 *   { type: "box", label?, xyxy: [x0,y0,x1,y1], color?, score? }
 *   { type: "keypoints", points: [[x,y],...], color? }
 *   { type: "heatmap", path?: string }  // drawn under RGB if provided
 */

export function getCameras(meta = {}) {
  return Array.isArray(meta.cameras) ? meta.cameras : [];
}

export function getAlignmentConfig(meta = {}) {
  const a = meta.obs_alignment || {};
  return {
    mode: a.mode === 'nearest_timestamp' ? 'nearest_timestamp' : 'frame_index',
    max_skew_ms: Number.isFinite(a.max_skew_ms) ? a.max_skew_ms : 50,
    action_time_field: a.action_time_field || 'timestamp',
  };
}

export function hasObservation(data) {
  const cams = getCameras(data?.meta);
  if (!cams.length) return false;
  const frames = data?.frames || [];
  return frames.some((f) => f?.obs && typeof f.obs === 'object' && Object.keys(f.obs).length);
}

/**
 * Resolve which obs entry to show for frame i / camera id.
 * @returns {{ ok: boolean, entry: object|null, skew_ms: number|null, reason: string, sourceFrame: number }}
 */
export function resolveObsForFrame(data, frameIdx, cameraId) {
  const frames = data?.frames || [];
  const n = frames.length;
  if (frameIdx < 0 || frameIdx >= n) {
    return { ok: false, entry: null, skew_ms: null, reason: 'frame_out_of_range', sourceFrame: frameIdx };
  }
  const align = getAlignmentConfig(data.meta);
  const f = frames[frameIdx];
  const direct = f?.obs?.[cameraId];
  if (align.mode === 'frame_index') {
    if (!direct || !direct.path) {
      return { ok: false, entry: null, skew_ms: 0, reason: 'missing_obs_at_frame', sourceFrame: frameIdx };
    }
    const actionT = Number(f[align.action_time_field] ?? f.timestamp ?? frameIdx);
    const obsT = Number(direct.t ?? actionT);
    const skew = (obsT - actionT) * 1000;
    return {
      ok: true,
      entry: direct,
      skew_ms: skew,
      reason: Math.abs(skew) > align.max_skew_ms ? 'skew_over_threshold' : 'aligned',
      sourceFrame: frameIdx,
    };
  }

  // nearest_timestamp: search obs with t across frames for this camera
  const actionT = Number(f[align.action_time_field] ?? f.timestamp ?? frameIdx);
  let best = null;
  let bestSkew = Infinity;
  let bestFi = frameIdx;
  for (let i = 0; i < n; i++) {
    const e = frames[i]?.obs?.[cameraId];
    if (!e?.path) continue;
    const obsT = Number(e.t ?? frames[i][align.action_time_field] ?? frames[i].timestamp ?? i);
    const skew = (obsT - actionT) * 1000;
    if (Math.abs(skew) < Math.abs(bestSkew)) {
      bestSkew = skew;
      best = e;
      bestFi = i;
    }
  }
  if (!best) {
    return { ok: false, entry: null, skew_ms: null, reason: 'no_obs_stream', sourceFrame: frameIdx };
  }
  const over = Math.abs(bestSkew) > align.max_skew_ms;
  return {
    ok: true,
    entry: best,
    skew_ms: bestSkew,
    reason: over ? 'skew_over_threshold' : 'aligned',
    sourceFrame: bestFi,
  };
}

/** Episode-level alignment audit (F26). */
export function auditObsAlignment(data) {
  const cams = getCameras(data?.meta);
  const frames = data?.frames || [];
  const align = getAlignmentConfig(data?.meta);
  const issues = [];
  const perCam = {};

  if (!cams.length) {
    return {
      available: false,
      align,
      cameras: [],
      issues: [{ level: 'info', code: 'no_cameras', msg: '未声明 meta.cameras（无观测流）' }],
      perCam,
    };
  }

  for (const cam of cams) {
    if (!cam?.id) {
      issues.push({ level: 'error', code: 'camera_missing_id', msg: 'cameras[] 存在无 id 项' });
      continue;
    }
    let present = 0;
    let skewFail = 0;
    let maxAbsSkew = 0;
    for (let i = 0; i < frames.length; i++) {
      const r = resolveObsForFrame(data, i, cam.id);
      if (r.entry?.path) present += 1;
      if (r.skew_ms != null) maxAbsSkew = Math.max(maxAbsSkew, Math.abs(r.skew_ms));
      if (r.reason === 'skew_over_threshold') skewFail += 1;
      if (r.reason === 'missing_obs_at_frame' && align.mode === 'frame_index') {
        // count later
      }
    }
    const missing = frames.length - present;
    perCam[cam.id] = {
      stream: cam.stream || 'rgb',
      present,
      missing,
      skewFail,
      maxAbsSkew_ms: maxAbsSkew,
    };
    if (missing > 0) {
      issues.push({
        level: missing === frames.length ? 'error' : 'warn',
        code: 'incomplete_stream',
        msg: `相机 ${cam.id}: ${present}/${frames.length} 帧有 path`,
      });
    }
    if (skewFail > 0) {
      issues.push({
        level: 'warn',
        code: 'skew',
        msg: `相机 ${cam.id}: ${skewFail} 帧 |skew| > ${align.max_skew_ms} ms（max ${maxAbsSkew.toFixed(1)} ms）`,
      });
    }
  }

  return {
    available: true,
    align,
    cameras: cams,
    issues,
    perCam,
  };
}

function resolveMediaUrl(path, episodePath) {
  if (!path) return null;
  if (/^(data:|https?:|blob:)/i.test(path)) return path;
  if (path.startsWith('./') || path.startsWith('/')) return path;
  // relative to episode JSON directory
  if (episodePath) {
    const base = episodePath.replace(/[^/]+$/, '');
    return base + path.replace(/^\.\//, '');
  }
  return './' + path.replace(/^\.\//, '');
}

/**
 * Draw image + overlays onto a canvas (F25 / F27).
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export function paintObsCanvas(canvas, {
  data,
  frameIdx,
  cameraId,
  episodePath = null,
  showBoxes = true,
  showKeypoints = true,
  showHeatmap = true,
  imageCache = null,
} = {}) {
  const ctx = canvas.getContext('2d');
  const w = canvas.clientWidth || 320;
  const h = canvas.clientHeight || 180;
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  ctx.fillStyle = '#0c121c';
  ctx.fillRect(0, 0, w, h);

  const resolved = resolveObsForFrame(data, frameIdx, cameraId);
  if (!resolved.entry?.path) {
    ctx.fillStyle = '#8b9bb4';
    ctx.font = '12px sans-serif';
    ctx.fillText(resolved.reason || '无观测', 12, 24);
    return Promise.resolve({ ok: false, reason: resolved.reason, skew_ms: resolved.skew_ms });
  }

  const url = resolveMediaUrl(resolved.entry.path, episodePath);
  const camMeta = getCameras(data.meta).find((c) => c.id === cameraId);
  const stream = camMeta?.stream || 'rgb';

  const loadImage = (src) => new Promise((resolve, reject) => {
    if (imageCache?.has(src)) {
      resolve(imageCache.get(src));
      return;
    }
    const img = new Image();
    img.onload = () => {
      imageCache?.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = src;
  });

  return (async () => {
    try {
      // optional heatmap underlay
      const heatOv = (resolved.entry.overlays || []).find((o) => o.type === 'heatmap' && o.path);
      if (showHeatmap && heatOv?.path) {
        try {
          const himg = await loadImage(resolveMediaUrl(heatOv.path, episodePath));
          drawContain(ctx, himg, w, h, stream === 'attention' ? 1 : 0.45);
        } catch (_) { /* ignore */ }
      }

      const img = await loadImage(url);
      const opacity = stream === 'attention' && !heatOv ? 1 : 1;
      drawContain(ctx, img, w, h, opacity, stream);

      if (showBoxes || showKeypoints) {
        const layout = containLayout(img.naturalWidth || img.width, img.naturalHeight || img.height, w, h);
        for (const ov of resolved.entry.overlays || []) {
          if (ov.type === 'box' && showBoxes) drawBox(ctx, ov, layout);
          if (ov.type === 'keypoints' && showKeypoints) drawKeypoints(ctx, ov, layout);
        }
      }

      // skew badge
      if (resolved.skew_ms != null) {
        const bad = resolved.reason === 'skew_over_threshold';
        ctx.fillStyle = bad ? 'rgba(248,113,113,0.85)' : 'rgba(18,26,38,0.7)';
        ctx.fillRect(8, h - 26, 118, 18);
        ctx.fillStyle = bad ? '#fff' : '#a8b6cc';
        ctx.font = '11px monospace';
        ctx.fillText(`skew ${resolved.skew_ms >= 0 ? '+' : ''}${resolved.skew_ms.toFixed(1)}ms`, 12, h - 13);
      }
      return { ok: true, skew_ms: resolved.skew_ms, reason: resolved.reason, url };
    } catch (e) {
      ctx.fillStyle = '#f87171';
      ctx.font = '12px sans-serif';
      ctx.fillText(`加载失败: ${url}`, 12, 24);
      return { ok: false, reason: 'image_load_failed', skew_ms: resolved.skew_ms };
    }
  })();
}

function containLayout(iw, ih, cw, ch) {
  const s = Math.min(cw / iw, ch / ih);
  const dw = iw * s;
  const dh = ih * s;
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;
  return { s, ox, oy, dw, dh, iw, ih };
}

function drawContain(ctx, img, cw, ch, alpha = 1, stream = 'rgb') {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const { ox, oy, dw, dh } = containLayout(iw, ih, cw, ch);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (stream === 'depth') {
    // slight cyan tint for depth readability
    ctx.drawImage(img, ox, oy, dw, dh);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(61,214,198,0.15)';
    ctx.fillRect(ox, oy, dw, dh);
    ctx.globalCompositeOperation = 'source-over';
  } else {
    ctx.drawImage(img, ox, oy, dw, dh);
  }
  ctx.restore();
}

function drawBox(ctx, ov, layout) {
  const [x0, y0, x1, y1] = ov.xyxy || [0, 0, 0, 0];
  const { s, ox, oy } = layout;
  const rx0 = ox + x0 * s;
  const ry0 = oy + y0 * s;
  const rw = (x1 - x0) * s;
  const rh = (y1 - y0) * s;
  ctx.strokeStyle = ov.color || '#3dd6c6';
  ctx.lineWidth = 2;
  ctx.strokeRect(rx0, ry0, rw, rh);
  if (ov.label) {
    const tag = ov.score != null ? `${ov.label} ${Number(ov.score).toFixed(2)}` : ov.label;
    ctx.font = '11px sans-serif';
    const tw = ctx.measureText(tag).width + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(rx0, Math.max(0, ry0 - 16), tw, 16);
    ctx.fillStyle = '#e7ecf3';
    ctx.fillText(tag, rx0 + 4, Math.max(12, ry0 - 4));
  }
}

function drawKeypoints(ctx, ov, layout) {
  const { s, ox, oy } = layout;
  ctx.fillStyle = ov.color || '#fbbf24';
  for (const pt of ov.points || []) {
    const x = ox + pt[0] * s;
    const y = oy + pt[1] * s;
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}
