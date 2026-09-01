// @ts-nocheck

import { applyDomI18n, onLocaleChange, t, trText } from '../../i18n/runtime';
import { trEvalData, trUnitMsg } from '../../i18n/evalContentI18n';
import { getThreeSceneTheme, watchThreeSceneTheme } from '../../lib/threeTheme';
/** Auto-extracted from legacy/index.html */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import URDFLoader from 'urdf-loader';
import { computeTcpMetrics, formatSummaryLine } from '../../lib/legacy/tcp_metrics.js';
import {
  buildReportHtml,
  buildReportSummary,
  evaluateGates,
  downloadText,
} from '../../lib/legacy/export_report.js';
import {
  validateUnitsAndActionMode,
  extractProvenance,
  classifyFailureFrames,
  buildSafetyReport,
} from '../../lib/legacy/advanced_cd.js';
import {
  loadRobotRegistry,
  resolveRobot,
  jointNamesMismatch,
  validateEpisodeAgainstRegistry,
} from '../../lib/legacy/robots_registry.js';
import {
  hasObservation,
  getCameras,
  auditObsAlignment,
  paintObsCanvas,
} from '../../lib/legacy/obs_align.js';
import {
  analyzeTaskEpisode,
  outcomeTagClass,
  buildObjectTcpDistances,
  resolveGoalAtFrame,
} from '../../lib/legacy/task_events.js';
import {
  resolveTcpCalibration,
  resolveBaseExtrinsics,
  applyExtrinsicsToPose,
} from '../../lib/legacy/kinematics_cal.js';
import { sampleCollisionClouds, analyzeHullCollisions, makeCollisionCloudPoints, syncCollisionCloudPoints, setRobotMeshesVisible } from '../../lib/legacy/collision_geom.js';
import { mountViewTools } from '../../lib/legacy/view_tools.js';
import {
  bindLoader,
  setLoadProgress as updateLoadProgress,
  hideLoader,
  failLoader,
} from '../../lib/legacy/loading.js';

let evalLocaleRefresh = null;

export function refreshEvalLocale() {
  applyDomI18n(document.querySelector('.eval-page') || document);
  if (evalLocaleRefresh) evalLocaleRefresh();
}

onLocaleChange(() => refreshEvalLocale());

export async function bootstrapEval(): Promise<void> {

const DEG2RAD = Math.PI / 180;
const COLOR_CUR = 0x9ca3af;
const COLOR_GT = 0xef4444;
const COLOR_PRED = 0x3b82f6;
const TCP_WINDOW = 15;
const TCP_MAX = TCP_WINDOW * 2 + 1;

/** Active robot profile for this page load (from robots.json + episode meta.robot). */
let ACTIVE_ROBOT = null;
/** Episode meta (extrinsics / tcp_calibration). */
let ACTIVE_META = {};
let JOINTS = [];
const TCP_OFFSET = new THREE.Vector3(0, -0.1062, 0);
const TCP_CAL_RPY = new THREE.Euler(0, 0, 0, 'XYZ');
const _tcpCalQuat = new THREE.Quaternion();
const _tcpLinkQuat = new THREE.Quaternion();
let TCP_LINK = 'gripper';
/** Visual-only uniform scale (EC616 shrinks to SO-100 size). Metrics use unscaled meters. */
let MODEL_SCALE = 1;

function hexToInt(hex, fallback) {
  if (typeof hex !== 'string') return fallback;
  const s = hex.trim().replace('#', '');
  const n = Number.parseInt(s, 16);
  return Number.isFinite(n) ? n : fallback;
}

function applyActiveRobot(robot, meta = {}) {
  ACTIVE_ROBOT = robot;
  ACTIVE_META = meta && typeof meta === 'object' ? meta : {};
  JOINTS = robot.joint_names.slice();
  TCP_LINK = robot.tcp.link || 'gripper';
  const cal = resolveTcpCalibration(robot.tcp || {}, ACTIVE_META);
  TCP_OFFSET.set(cal.xyz[0], cal.xyz[1], cal.xyz[2]);
  TCP_CAL_RPY.set(
    (cal.rpy_deg[0] || 0) * DEG2RAD,
    (cal.rpy_deg[1] || 0) * DEG2RAD,
    (cal.rpy_deg[2] || 0) * DEG2RAD,
    'XYZ',
  );
  const sc = Number(robot.model_scale);
  MODEL_SCALE = Number.isFinite(sc) && sc > 0 ? sc : 1;
}

function applyModelScale(robot) {
  if (!robot) return;
  robot.scale.setScalar(MODEL_SCALE);
  robot.updateMatrixWorld(true);
}

function toDisplayPos(p) {
  if (!p) return p;
  const s = MODEL_SCALE;
  if (s === 1) return { x: Number(p.x) || 0, y: Number(p.y) || 0, z: Number(p.z) || 0 };
  return { x: (Number(p.x) || 0) * s, y: (Number(p.y) || 0) * s, z: (Number(p.z) || 0) * s };
}

function pathsToMeters(paths) {
  const s = MODEL_SCALE;
  const inv = (v) => {
    if (!v) return v;
    if (s === 1) return { x: v.x, y: v.y, z: v.z };
    return { x: v.x / s, y: v.y / s, z: v.z / s };
  };
  return {
    cur: (paths.cur || []).map(inv),
    gt: (paths.gt || []).map(inv),
    pred: (paths.pred || []).map(inv),
    gtQuat: paths.gtQuat,
    predQuat: paths.predQuat,
  };
}

/** 左右栏默认收起：悬停展开，移出自动收缩；点击侧边标签钉住/取消。 */
function setupAutoCollapsingRails() {
  const CLOSE_MS = 420;
  const rails = [...document.querySelectorAll('.drawer-rail')];

  rails.forEach((rail) => {
    let closeTimer = null;
    const tab = rail.querySelector('.rail-tab');
    const drawers = [...rail.querySelectorAll('details.drawer')];

    const setOpen = (on) => {
      rail.classList.toggle('is-open', on);
      tab?.setAttribute('aria-expanded', on ? 'true' : 'false');
    };

    const scheduleClose = () => {
      if (rail.classList.contains('is-pinned')) return;
      clearTimeout(closeTimer);
      closeTimer = setTimeout(() => setOpen(false), CLOSE_MS);
    };

    rail.addEventListener('pointerenter', () => {
      clearTimeout(closeTimer);
      setOpen(true);
    });
    rail.addEventListener('pointerleave', scheduleClose);

    tab?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const pinned = rail.classList.toggle('is-pinned');
      tab.classList.toggle('pinned', pinned);
      tab.setAttribute('aria-pressed', pinned ? 'true' : 'false');
      tab.title = pinned
        ? t('eval.dyn.pinned')
        : t('eval.dyn.unpinHover');
      if (pinned) {
        clearTimeout(closeTimer);
        setOpen(true);
      } else {
        scheduleClose();
      }
    });

    // 同侧手风琴：一次只展开一个抽屉，减少遮挡
    drawers.forEach((d) => {
      d.addEventListener('toggle', () => {
        if (!d.open) return;
        drawers.forEach((other) => {
          if (other !== d) other.open = false;
        });
      });
    });
  });

  const collapseUnpinned = () => {
    rails.forEach((rail) => {
      if (rail.classList.contains('is-pinned')) return;
      rail.classList.remove('is-open');
      rail.querySelector('.rail-tab')?.setAttribute('aria-expanded', 'false');
    });
  };

  document.getElementById('arm3d')?.addEventListener('pointerdown', collapseUnpinned);
}

setupAutoCollapsingRails();

/** 名词 / 指标释义：悬停带 data-tip 的文字时，在左下角半透明浮窗展示。 */
const TERM_GLOSSARY = {
  robot: {
    title: '机型（meta.robot）',
    body: '本条 episode 使用的机械臂型号 id，必须在 robots.json 中登记。页面据此加载对应 URDF、关节名与 TCP 定义。',
  },
  cur: {
    title: 'cur（current）',
    body: '当前时刻观测到的机械臂状态（灰色）。用于对照「此刻真实在哪」，不参与 pred vs GT 的主误差计算。',
  },
  gt: {
    title: 'GT（Ground Truth）',
    body: '下一时刻的真值关节 / TCP（红色）。评测时作为正确目标，与 predict 对比。',
  },
  pred: {
    title: 'pred（predict）',
    body: '模型预测的下一时刻关节 / TCP（蓝色）。与 GT 的差即策略误差，是本页评测核心。',
  },
  hub: {
    title: 'Hub · 汇总',
    body: '跨多条轨迹 / 多模型的汇总对比页。在顶栏「页面」菜单中打开；按 data/<suite> 加载合法 episode。',
  },
  pages: {
    title: '页面切换',
    body: '顶栏下拉入口，可在单轨迹评测、Hub 汇总等页面间跳转。快捷键：Alt+1–9 / Alt+0 直达；Alt+←/→（或 Alt+[/]）切换相邻页；输入框内不生效。',
  },
  play: {
    title: '播放控制',
    body: '空格：播放/暂停；←/→：上一帧/下一帧；Home：重置到第 0 帧。下方热力轴按 TCP e_p 着色，点击跳帧。',
  },
  record: {
    title: '录制',
    body: '把当前 3D 画布录成 WebM。快捷键：R 开始 · T 停止 · S 保存（输入框内不触发）。',
  },
  frame: {
    title: '帧索引 t',
    body: '当前评测时间步。标签中的 err 为关节 L2，e_p 为该帧 TCP 位置误差（mm）。',
  },
  speed: {
    title: '播放速度',
    body: '相对原始数据 FPS 的倍率。0.2× 表示以约 1/5 实时速度回放，便于观察偏差。',
  },
  heatmap: {
    title: 'e_p 热力时间轴',
    body: '整段轨迹的 TCP 位置误差条带：颜色越红/亮表示该帧 e_p 越大。点击即可跳到对应帧。',
  },
  visibility: {
    title: '显示机械臂',
    body: '切换灰/红/蓝三臂显隐，以及整段 TCP 轨迹、误差矢量与点云视图（collision 采样点）。',
  },
  full_path: {
    title: '整段轨迹',
    body: '绘制整条 TCP 路径；颜色与对应机械臂一致（灰/红/蓝），沿时间从浅到深，便于区分起止与走向。',
  },
  err_arrow: {
    title: '误差矢量',
    body: '当前帧从 GT TCP 指向 pred TCP 的箭头，直观显示「差在哪个方向、差多远」。',
  },
  cloud_view: {
    title: '点云视图',
    body: '切换后隐藏实体 mesh，显示当前帧 URDF collision 采样点（与安全栏桌面碰/自碰同一套点云）。灰/红/蓝分别对应三臂。',
  },
  camera: {
    title: '相机',
    body: '预设视角与 Orbit 自由旋转。跟随模式下相机会跟踪 GT 的 TCP；拖拽画面会退出跟随。',
  },
  cam_side: { title: '侧视', body: '从侧面观察臂体与 TCP，适合看高度与前后伸展。' },
  cam_top: { title: '顶视', body: '俯视工作平面，适合看 XY 平面上的轨迹与横向偏差。' },
  cam_follow: {
    title: '跟随 TCP',
    body: '相机目标锁定 GT 末端。便于近距离看抓取姿态；手动 Orbit 后自动回到自由模式。',
  },
  obs_f: {
    title: '观测相机 (F)',
    body: 'F25：RGB/Depth 与关节/TCP 同帧回放。数据来自 meta.cameras + frames[].obs。无观测时本栏提示缺失。',
  },
  obs_align: {
    title: 'obs 时间戳对齐 (F26)',
    body: 'meta.obs_alignment：frame_index 按帧号一一对应；nearest_timestamp 按 timestamp 最近邻。|skew| 超过 max_skew_ms 会告警。',
  },
  obs_cam: {
    title: t('eval.dyn.obsStream'),
    body: '切换 wrist / front / depth 等相机 id。stream 可为 rgb、depth、attention。',
  },
  obs_sync: {
    title: t('eval.dyn.syncView'),
    body: '画布随帧滑条与播放器更新；角标显示该帧观测相对 action 时钟的 skew（ms）。',
  },
  obs_overlay: {
    title: '关键帧叠加 (F27)',
    body: '在 RGB 上叠加目标框 (xyxy)、关键点与注意力热图（overlays[].type = box / keypoints / heatmap）。',
  },
  task_g: {
    title: '任务 / 接触 (G)',
    body: 'G28 任务成功标签；G29 接触与力事件流；G30 物体/夹取目标动态位姿。与纯 GT 位姿误差互补，面向成功率评测。',
  },
  task_outcome: {
    title: '任务成功标签 (G28)',
    body: 'meta.task_outcome：outcome（success/fail/partial）+ labels（grasp/place…）+ reason_code。产业评测最终看成功率与失败原因码。',
  },
  contact_events: {
    title: '接触 / 力事件 (G29)',
    body: 'episode.events 与 frames[].contact：接触时刻、夹紧力、滑移、夹爪宽度。点击事件跳到对应帧。',
  },
  contact_force: {
    title: '接触力 / 滑移',
    body: '逐帧 force_n（N）与 slip_mm。许多失败发生在接触之后，开环 e_p 覆盖不到。',
  },
  object_pose: {
    title: '物体 / 夹取目标位姿 (G30)',
    body: 'frames[].objects 与可选 frames[].goal_pose 动态目标序列；曲线为 pred TCP 到物体/grasp 的距离（mm）。',
  },
  gate: {
    title: '导出 / 门禁',
    body: '导出 HTML/JSON 报告，并按阈值文件（或 meta.thresholds）判定 PASS/FAIL。未过项会列在提示里。',
  },
  export_html: { title: '导出 HTML', body: '生成可读评测报告网页，含 TCP 汇总与门禁结果，便于分享。' },
  export_json: { title: '导出 JSON', body: '导出结构化摘要（eval_summary），可供 batch_score / 门禁 CLI 继续使用。' },
  export_shot: {
    title: '附带画布缩略图',
    body: '把当前渲染画面编码进报告。方便肉眼对照，但会明显增加内存与文件体积。',
  },
  overview: {
    title: '概览',
    body: '整段评测的关键标量：关节 L2、TCP 误差分位数、阈值达标率、action_mode，以及时间对齐提示。',
  },
  tcp: {
    title: 'TCP（Tool Center Point）',
    body: '末端执行器参考点。本页取夹爪指尖中点，在世界系下比较 pred 与 GT 的位置与姿态。',
  },
  ep: {
    title: 'e_p · TCP 位置误差',
    body: '‖p_pred − p_gt‖，单位 mm。衡量末端位置偏了多少；μ/p95/max 分别是均值、95 分位与最差。',
  },
  er: {
    title: 'e_R · TCP 姿态误差',
    body: 'pred 与 GT 姿态之间的测地角（旋转最短角），单位 °。对抓取朝向、吸盘/夹爪对准很敏感。',
  },
  ep_er: {
    title: 'TCP 位置 / 姿态误差',
    body: '同图展示 e_p（mm）与 e_R（°）随时间变化，用于判断是「位置飘」还是「姿态拧」。',
  },
  ep_mean: {
    title: 'TCP e_p μ',
    body: '整段 TCP 位置误差的算术平均（mm）。越低越好；常与 p95 一起看，避免被少数尖峰掩盖。',
  },
  ep_p95: {
    title: 'TCP e_p p95',
    body: '位置误差的第 95 百分位（mm）。比均值更能反映「偶尔严重失手」的尾部风险。',
  },
  er_mean: {
    title: 'TCP e_R μ',
    body: '整段姿态误差均值（°）。',
  },
  er_p95: {
    title: 'TCP e_R p95',
    body: '姿态误差第 95 百分位（°），关注最差约 5% 帧的朝向偏差。',
  },
  dxyz: {
    title: '分轴 Δxyz',
    body: 'TCP 位置误差在世界系 x/y/z 上的分量（mm）。可区分高度飘、前后偏或左右偏。',
  },
  dx: { title: '|Δx| μ', body: 'x 轴位置误差绝对值的均值（mm）。' },
  dy: { title: '|Δy| μ', body: 'y 轴位置误差绝对值的均值（mm）。' },
  dz: { title: '|Δz| μ', body: 'z 轴（常为高度）位置误差绝对值的均值（mm）。' },
  drpy: {
    title: '姿态分轴 Δrpy',
    body: '把姿态差分解为 roll / pitch / yaw（°），便于定位「绕哪根轴拧错了」。',
  },
  vel_acc: {
    title: '速度 / 加速度误差',
    body: '对 TCP 轨迹求导后，比较 pred 与 GT 的线速度、角速度、线加速度差。更能暴露抖动、过冲与滞后。',
  },
  dv: { title: '‖Δv‖ μ', body: 'TCP 线速度误差范数的均值（m/s）。' },
  dw: { title: '‖Δω‖ μ', body: 'TCP 角速度误差范数的均值（°/s）。' },
  da: { title: '‖Δa‖ μ', body: 'TCP 线加速度误差范数的均值（m/s²）。' },
  segments: {
    title: '分段 TCP 误差',
    body: '按路径弧长等分为接近 / 接触 / 搬运 / 回撤四段，分别统计 e_p、e_R，避免全程平均掩盖关键阶段失败。',
  },
  task: {
    title: '任务 / 接近向量误差',
    body: '相对 meta.goal_pose 的目标位姿误差：位置、姿态，以及接近方向夹角。需数据提供 goal_pose 才可算。',
  },
  task_ep: { title: '任务 e_p μ', body: '相对目标物/抓取目标位姿的位置误差均值（mm），不只是相对 GT TCP。' },
  approach: {
    title: '接近角',
    body: 'pred 接近向量与目标接近向量的夹角（°）。接近方向错了，即使 TCP 位置接近也可能抓偏。',
  },
  task_ep_final: { title: '末帧任务 e_p', body: '最后一帧相对 goal 的位置误差（mm），常对应放下/抓取瞬间。' },
  approach_final: { title: '末帧接近角', body: '最后一帧的接近方向夹角（°）。' },
  temporal: {
    title: '时间对齐（DTW / 滞后）',
    body: '除逐帧误差外，用 DTW 或最佳帧滞后估计「形状对但慢半拍」还是「系统性偏置」。正滞后表示 pred 偏晚。',
  },
  err_curves: {
    title: '误差曲线',
    body: '关节空间总误差 L2 随时间，以及各关节 MAE 柱图，与 TCP 指标互补。',
  },
  l2: {
    title: 'L2 误差',
    body: '关节角向量的欧氏范数 ‖pred − gt‖₂（通常以度为单位汇总）。反映整体关节偏差大小。',
  },
  l2_mean: { title: '平均 L2', body: '全时段关节 L2 误差的平均值。' },
  l2_max: { title: '最大 L2', body: '全时段关节 L2 误差的峰值，对应最差一帧。' },
  n_frames: { title: '帧数', body: '本条 episode 的采样帧数 n。' },
  fps: { title: '数据 FPS', body: '评测数据标注的采样帧率，用于播放与速度/加速度差分。' },
  mae: {
    title: '逐关节 MAE',
    body: '每个关节角的平均绝对误差（deg）。可看出是肩/肘/腕哪一轴系统性偏大。',
  },
  joint_traj: {
    title: '关节轨迹',
    body: '选定关节上 current / GT / pred 三条角度曲线，检查跟踪形状、相位与幅值。',
  },
  frame_values: {
    title: '当前帧数值',
    body: '列出当前帧各关节角与误差，并给出关节扰动对 TCP 的贡献分解。',
  },
  joint: { title: '关节', body: 'URDF 中的可控自由度名称，顺序须与评测 JSON 一致。' },
  joint_err: { title: '关节误差', body: '该关节 pred − GT（deg）。正负表示相对真值的方向。' },
  contrib: {
    title: '关节→TCP 贡献',
    body: '用雅可比近似 ‖Jᵢ Δqᵢ‖：各关节角误差对 TCP 位置偏移的贡献（mm）。高柱关节更「拖累」末端。',
  },
  worst_ws: {
    title: '最差帧 / 工作空间',
    body: '按 e_p Top‑K 列出最差帧可点击跳转；下方俯视 XY 散点用颜色表示 e_p，观察误差的空间聚集。',
  },
  workspace: {
    title: '工作空间俯视',
    body: 'GT（红）与 pred（蓝）TCP 在 XY 平面的投影。点击最近点可跳转到对应帧。',
  },
  protocol_c: {
    title: '协议 / 元数据 (C)',
    body: '检查单位与 action_mode、导出 provenance，并按大 e_p / 大 e_R / 抖动做失败帧分类。',
  },
  action_mode: {
    title: 'action_mode / 单位',
    body: '策略输出是绝对角还是增量、deg 还是 rad。不一致会导致「数值看起来对、姿态全错」。',
  },
  provenance: {
    title: 'provenance',
    body: '数据来源元信息：数据集、策略名、checkpoint、观测配置等，保证评测可复现、可对比。',
  },
  fail_class: {
    title: '失败分类',
    body: '自动挑出位置失败、姿态失败或抖动帧，点击可跳转排查，而不是只看全程平均。',
  },
  safety_d: {
    title: '安全 / 可执行 (D)',
    body: '关节限位、近奇异、超速/跳变、桌面与自碰（URDF collision 点云）。偏部署前风险筛查，抽样计算以控内存。',
  },
  limit_over: { title: '越限', body: '关节角超出 URDF/配置限位的帧次数。真机上可能导致力矩饱和或保护停机。' },
  limit_near: { title: '近限位', body: '接近限位但尚未越界的帧数，提示工作空间余量不足。' },
  sing: {
    title: '近奇异',
    body: '可操作度过低的姿态附近。此时小关节变化会引起大 TCP 跳动，控制变脆。',
  },
  overspeed: { title: '超速事件', body: '关节角速度超过阈值的次数，反映指令是否过于激进、难跟踪。' },
  table_hit: { title: '桌面碰', body: 'URDF collision 点云相对桌面平面过近/穿透的命中次数（抽样，非完整物理仿真）。' },
  self_hit: { title: '自碰', body: '臂体 link 之间 collision 点云最小距离过近的命中次数，用于发现明显自干涉。' },
  collision: {
    title: '碰撞检测',
    body: '优先对 URDF collision mesh 采样点云（凸包式）估计桌面碰撞与自碰；无 collision 时回退 visual。阈值见 robots.json collision。',
  },
  pass_ep: {
    title: 'e_p 阈值达标率',
    body: 'TCP 位置误差低于阈值（默认 5 mm）的帧占比。越高说明位置跟踪越稳。',
  },
  pass_er: {
    title: 'e_R 阈值达标率',
    body: 'TCP 姿态误差低于阈值（默认 5°）的帧占比。',
  },
  pass_both: {
    title: '双阈值达标',
    body: '同一帧同时满足 e_p 与 e_R 阈值的比例，比单指标更能代表「位姿都合格」。',
  },
  action: {
    title: 'action',
    body: 'meta.action_mode 的简写展示，例如绝对关节角 / delta 等，需与模型训练设定一致。',
  },
  gate_stat: {
    title: '门禁结果',
    body: '综合阈值检查是否全部通过。FAIL 时请看导出报告或门禁提示中的未过项。',
  },
  help: {
    title: '说明',
    body: '使用导读。带虚下划线的文字可悬停，解释会出现在左下角半透明浮窗。',
  },
};

function setupTermTips() {
  const tipEl = document.getElementById('termTip');
  const titleEl = document.getElementById('termTipTitle');
  const bodyEl = document.getElementById('termTipBody');
  if (!tipEl || !titleEl || !bodyEl) return;

  let hideTimer = null;
  let activeEl = null;

  const hide = () => {
    tipEl.classList.remove('show');
    tipEl.setAttribute('aria-hidden', 'true');
    if (activeEl) activeEl.classList.remove('is-active');
    activeEl = null;
  };

  const show = (el) => {
    const key = el.getAttribute('data-tip');
    const entry = TERM_GLOSSARY[key];
    if (!entry) return;
    clearTimeout(hideTimer);
    if (activeEl && activeEl !== el) activeEl.classList.remove('is-active');
    activeEl = el;
    el.classList.add('is-active');
    titleEl.textContent = t(`eval.gloss.${key}.title`) || entry.title;
    bodyEl.textContent = t(`eval.gloss.${key}.body`) || entry.body;
    tipEl.classList.add('show');
    tipEl.setAttribute('aria-hidden', 'false');
  };

  const scheduleHide = () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hide, 120);
  };

  document.addEventListener('pointerover', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el || !TERM_GLOSSARY[el.getAttribute('data-tip')]) return;
    show(el);
  });
  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest('[data-tip]');
    if (!el) return;
    const to = e.relatedTarget instanceof Element ? e.relatedTarget.closest('[data-tip]') : null;
    if (to === el) return;
    scheduleHide();
  });
  document.addEventListener('focusin', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el && TERM_GLOSSARY[el.getAttribute('data-tip')]) show(el);
  });
  document.addEventListener('focusout', (e) => {
    const el = e.target.closest('[data-tip]');
    if (el) scheduleHide();
  });
}

function appendStat(box, label, value, tipKey) {
  if (!box) return;
  const d = document.createElement('div');
  d.className = 'stat';
  const shown = tipKey ? t(`eval.gloss.${tipKey}.title`) : trText(String(label));
  const labelHtml = tipKey
    ? `<div class="label tip" data-tip="${tipKey}" data-gloss-tip="${tipKey}" tabindex="0">${shown}</div>`
    : `<div class="label">${shown}</div>`;
  d.innerHTML = `${labelHtml}<div class="value">${value}</div>`;
  box.appendChild(d);
}

/** Cached eval payload for locale refresh without full reload. */
let EVAL_LOCALE_STATE = null;

function refreshGateHint(gates) {
  const gateEl = document.getElementById('gateHint');
  if (!gateEl || !gates) return;
  const failed = gates.checks.filter((c) => !c.ok).map((c) => c.name);
  gateEl.textContent = gates.checks.length
    ? t('eval.dyn.gateResult', { status: gates.passed ? 'PASS' : 'FAIL', n: gates.checks.length })
      + (failed.length ? t('eval.dyn.gateFailed', { items: failed.join(', ') }) : '')
    : t('eval.dyn.gateNone');
}

function formatTemporalHint(tcp) {
  const lagSign = tcp.temporal.lag_frames > 0
    ? t('eval.dyn.lagBehind')
    : (tcp.temporal.lag_frames < 0 ? t('eval.dyn.lagAhead') : t('eval.dyn.lagNone'));
  return t('eval.dyn.temporalSummary', {
    lag: tcp.temporal.lag_frames,
    sec: tcp.temporal.lag_s.toFixed(3),
    sign: lagSign,
    ep: tcp.temporal.mean_ep_at_lag_mm.toFixed(2),
    dtw: (tcp.temporal.dtw_normalized_m * 1000).toFixed(2),
  });
}

function formatTaskHint(tcp) {
  if (!tcp.task.available) {
    return t('eval.dyn.taskErr', { reason: tcp.task.reason });
  }
  const pf = tcp.task.pred.final;
  const gf = tcp.task.gt.final;
  const dlt = tcp.task.delta_final;
  return t('eval.dyn.taskSummary', {
    predEp: tcp.task.pred.ep_mm.mean.toFixed(2),
    predAp: tcp.task.pred.approach_deg.mean.toFixed(2),
    finalPredEp: pf.ep_mm.toFixed(2),
    finalPredAp: pf.approach_deg.toFixed(2),
    deltaEp: dlt.ep_mm.toFixed(2),
    deltaAp: dlt.approach_deg.toFixed(2),
    gtFinalEp: gf.ep_mm.toFixed(2),
  });
}

function rebuildMainStats(meta, robotCfg) {
  const stats = document.getElementById('stats');
  if (!stats) return;
  stats.innerHTML = '';
  for (const [label, value, tipKey] of [
    ['机型', robotCfg.label, 'robot'],
    ['平均 L2', meta.mean_l2.toFixed(3), 'l2_mean'],
    ['最大 L2', meta.max_l2.toFixed(3), 'l2_max'],
    ['帧数', String(meta.n_frames), 'n_frames'],
    ['数据 FPS', String(meta.fps), 'fps'],
  ]) {
    appendStat(stats, label, value, tipKey);
  }
}

function rebuildTcpStatsPanel(state) {
  const { meta, tcp, thrEp, thrEr, passEp, passEr, passBoth, gates } = state;
  fillTcpOverview(tcp);
  const tcpStats = document.getElementById('tcpStats');
  for (const [label, value, tipKey] of [
    [`e_p<${thrEp}mm`, `${(passEp * 100).toFixed(1)}%`, 'pass_ep'],
    [`e_R<${thrEr}°`, `${(passEr * 100).toFixed(1)}%`, 'pass_er'],
    [t('eval.dyn.passBoth'), `${(passBoth * 100).toFixed(1)}%`, 'pass_both'],
    ['action', String(meta.action_mode ?? '—'), 'action'],
  ]) {
    appendStat(tcpStats, label, value, tipKey);
  }
  appendStat(
    tcpStats,
    t('eval.dyn.gateWord'),
    gates.checks.length ? (gates.passed ? 'PASS' : 'FAIL') : '—',
    'gate_stat',
  );
  refreshGateHint(gates);
  const temporalEl = document.getElementById('tcpTemporalHint');
  if (temporalEl) temporalEl.textContent = formatTemporalHint(tcp);
  const taskEl = document.getElementById('tcpTaskHint');
  if (taskEl) taskEl.textContent = formatTaskHint(tcp);
}

function rebuildSafetyPanel(safety, stride) {
  const sBox = document.getElementById('safetyStats');
  if (sBox) {
    sBox.innerHTML = '';
    for (const [label, value, tipKey] of [
      [t('eval.kw.limitOver'), String(safety.limits.n_over), 'limit_over'],
      [t('eval.gloss.limit_near.title'), String(safety.limits.n_near), 'limit_near'],
      [t('eval.kw.nearSingular'), String(safety.limits.n_sing), 'sing'],
      [t('eval.gloss.overspeed.title'), String(safety.smooth.n_over_speed), 'overspeed'],
      [t('eval.collisionTable'), String(safety.collision.n_table), 'table_hit'],
      [t('eval.collisionSelf'), String(safety.collision.n_self), 'self_hit'],
    ]) {
      appendStat(sBox, label, value, tipKey);
    }
  }
  const sList = document.getElementById('safetyList');
  if (sList) {
    const items = [];
    for (const h of safety.limits.over_limit.slice(0, 12)) {
      items.push({
        i: h.i,
        cls: 'bad',
        text: t('eval.dyn.limitEvent', { t: h.i, joint: h.joint, q: h.q.toFixed(1) }),
      });
    }
    for (const h of safety.limits.singularity_frames.slice(0, 8)) {
      items.push({
        i: h.i,
        cls: 'warn',
        text: t('eval.dyn.singEvent', { t: h.i, w: h.manipulability.toExponential(2) }),
      });
    }
    for (const h of safety.smooth.over_speed.slice(0, 8)) {
      items.push({
        i: h.i,
        cls: 'warn',
        text: t('eval.dyn.speedEvent', { t: h.i, joint: h.joint, deg: h.deg_s.toFixed(0) }),
      });
    }
    for (const h of safety.smooth.jump_frames.slice(0, 6)) {
      items.push({
        i: h.i,
        cls: 'warn',
        text: t('eval.dyn.jumpEvent', { t: h.i, l2: h.l2_deg.toFixed(1) }),
      });
    }
    sList.innerHTML = items.map((x) =>
      `<li data-frame="${x.i}" class="${x.cls}">${x.text}</li>`
    ).join('') || `<li>${t('eval.dyn.noSafetyAlert')}</li>`;
  }
  const colHint = document.getElementById('collisionHint');
  if (colHint) {
    const th = safety.collision.table_hits[0];
    const sh = safety.collision.self_hits[0];
    const method = safety.collision.method || 'hull';
    colHint.textContent =
      `${t('eval.gloss.collision.title')}(${method}) stride=${stride} · ${t('eval.gloss.table_hit.title')} ${safety.collision.n_table}`
      + (th ? t('eval.dyn.collisionExample', { t: th.i, link: th.link, z: th.z.toFixed(3) }) : '')
      + ` · ${t('eval.gloss.self_hit.title')} ${safety.collision.n_self}`
      + (sh ? t('eval.dyn.selfCollisionExample', { t: sh.i, a: sh.a, b: sh.b, dist: sh.dist_mm.toFixed(1) }) : '')
      + t('eval.dyn.collisionSample');
  }
}

function refreshUnitHint(unitCheck) {
  const unitEl = document.getElementById('unitHint');
  if (!unitEl || !unitCheck) return;
  const tags = [
    `<span class="tag ${unitCheck.ok ? 'ok' : 'bad'}">${unitCheck.ok ? t('eval.dyn.unitOk') : t('eval.dyn.unitBad')}</span>`,
    `<span class="tag">${t('eval.dyn.inferred', { unit: unitCheck.inferred_unit })}</span>`,
    `<span class="tag">${t('eval.dyn.declared', { unit: unitCheck.declared_unit || '—' })}</span>`,
    `<span class="tag">mode ${unitCheck.action_mode || '—'}</span>`,
  ].join('');
  const msgs = [...unitCheck.issues, ...unitCheck.warnings].map((x) => trUnitMsg(x)).join('；') || t('eval.dyn.noExtraWarn');
  unitEl.innerHTML = `${tags}<br>${msgs}`;
}

function refreshTaskOutcomeHint(outcome, analysis) {
  const hint = document.getElementById('taskOutcomeHint');
  if (!hint) return;
  if (!outcome.available) {
    hint.innerHTML = `<span class="tag">${t('eval.dyn.tagNoTask')}</span> ${t('eval.dyn.noTaskOutcome')}`;
    return;
  }
  const cls = outcomeTagClass(outcome.outcome);
  const labels = (outcome.labels || []).map((l) => `<span class="tag">${l}</span>`).join('') || '—';
  hint.innerHTML =
    `<span class="tag ${cls}">${outcome.outcome}</span>`
    + `<span class="tag">${outcome.reason_code || '—'}</span>`
    + ` ${outcome.task || 'task'} · score ${outcome.score ?? '—'}<br>`
    + `labels: ${labels}<br>${trEvalData(outcome.reason)}`;
  const stats = document.getElementById('taskStats');
  if (stats) {
    stats.innerHTML = '';
    for (const [label, value, tipKey] of [
      [t('eval.dyn.result'), outcome.available ? outcome.outcome : '—', 'task_outcome'],
      [t('eval.dyn.reasonCode'), outcome.reason_code || '—', 'task_outcome'],
      [t('eval.dyn.contactFrame'), String(analysis.contact.n_contact_frames), 'contact_events'],
      [t('eval.dyn.events'), String(analysis.events.length), 'contact_events'],
      [t('eval.dyn.objects'), analysis.objects.ids.join(',') || '—', 'object_pose'],
    ]) {
      appendStat(stats, label, value, tipKey);
    }
  }
  const list = document.getElementById('taskEventList');
  if (list) {
    list.innerHTML = analysis.events.length
      ? analysis.events.map((ev) => {
        const bits = [
          `t=${ev.frame}`,
          ev.type,
          ev.force_n != null ? `F=${ev.force_n.toFixed(1)}N` : null,
          ev.slip_mm != null ? `slip=${ev.slip_mm.toFixed(1)}mm` : null,
          ev.note ? trEvalData(ev.note) : null,
        ].filter(Boolean).join(' · ');
        const cls = /slip|miss|fail|collision/i.test(ev.type) ? 'bad'
          : /place|success|grasp_force|contact_end/i.test(ev.type) ? '' : 'warn';
        return `<li class="${cls}" data-frame="${ev.frame}">${bits}</li>`;
      }).join('')
      : `<li class="muted">${t('eval.dyn.noEvents')}</li>`;
  }
}

function refreshEvalLocaleDynamic() {
  document.querySelectorAll('[data-gloss-tip]').forEach((el) => {
    const key = el.getAttribute('data-gloss-tip');
    if (key) el.textContent = t(`eval.gloss.${key}.title`);
  });
  const btnPlay = document.getElementById('btnPlay');
  if (btnPlay && typeof playing !== 'undefined') {
    btnPlay.textContent = playing ? t('eval.btnPause') : t('eval.btnPlay');
  }
  if (!EVAL_LOCALE_STATE) return;
  const st = EVAL_LOCALE_STATE;
  rebuildMainStats(st.meta, st.robotCfg);
  rebuildTcpStatsPanel(st);
  if (st.safety) rebuildSafetyPanel(st.safety, st.stride);
  if (st.unitCheck) refreshUnitHint(st.unitCheck);
  if (st.taskAnalysis) {
    refreshTaskOutcomeHint(st.taskAnalysis.outcome, st.taskAnalysis);
  }
  const sub = document.getElementById('subtitle');
  if (sub && st.meta && st.robotCfg) {
    sub.textContent = t('eval.dyn.metaSubtitle', {
      id: st.robotCfg.id,
      source: st.meta.source,
      frames: st.meta.n_frames,
      at: st.meta.generated_at,
    });
  }
  const guardEl = document.getElementById('robotGuard');
  if (guardEl && st.guard) {
    if (st.guard.warnings?.length) {
      guardEl.className = 'robot-guard warn show';
      guardEl.textContent = t('eval.dyn.guardWarn', {
        id: st.robotCfg.id,
        warnings: st.guard.warnings.join('；'),
      });
    } else if (st.mismatch) {
      guardEl.className = 'robot-guard show';
      guardEl.textContent = t('eval.dyn.guardMismatch', { mismatch: st.mismatch });
    }
  }
  if (st.tcp && typeof frameIdx !== 'undefined') {
    updateTcpFrameHint(st.tcp, frameIdx);
  }
}

setupTermTips();
evalLocaleRefresh = refreshEvalLocaleDynamic;


async function loadData() {
  const qs = new URLSearchParams(location.search);
  const dataPath = qs.get('data') || '/data/20260819/episode_1.json';
  const res = await fetch(dataPath + (dataPath.includes('?') ? '&' : '?') + '_=' + Date.now());
  if (!res.ok) throw new Error(t('eval.dyn.cannotLoad', { path: dataPath }));
  const json = await res.json();
  json.__data_path = dataPath;
  return json;
}

function softMaterial(robot) {
  if (!robot) return;
  robot.traverse((c) => {
    if (!c.isMesh || !c.material) return;
    const mats = Array.isArray(c.material) ? c.material : [c.material];
    mats.forEach((m) => {
      if (!m) return;
      if (m.opacity < 1) {
        m.transparent = true;
        m.depthWrite = false;
      }
    });
  });
}

/** Tint meshes when cur/gt/pred share one URDF (e.g. EC616 has no colored copies). */
function tintRobot(robot, colorHex, opacity = 0.72) {
  if (!robot) return;
  robot.userData.roleTint = { colorHex, opacity };
  applyRoleTint(robot);
}

function applyRoleTint(robot) {
  const spec = robot?.userData?.roleTint;
  if (!spec) return;
  const color = new THREE.Color(spec.colorHex);
  const opacity = spec.opacity;
  robot.traverse((c) => {
    if (!c.isMesh || !c.material) return;
    const mats = Array.isArray(c.material) ? c.material : [c.material];
    mats.forEach((m) => {
      if (!m?.color) return;
      m.color.copy(color);
      m.transparent = true;
      m.opacity = opacity;
      m.depthWrite = opacity >= 0.95;
      m.needsUpdate = true;
    });
  });
}

function refreshRobotLook(robot) {
  softMaterial(robot);
  applyRoleTint(robot);
}

function fitEvalCamera(camera, controls, robot, { fog } = {}) {
  if (!robot) return;
  const box = new THREE.Box3().setFromObject(robot);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  if (![size.x, size.y, size.z, center.x, center.y, center.z].every(Number.isFinite)) return;
  const maxDim = Math.max(size.x, size.y, size.z, 0.25);
  const dist = maxDim * 1.9;
  controls.target.copy(center);
  camera.position.set(center.x + dist * 0.75, center.y + dist * 0.45, center.z + dist * 0.85);
  camera.near = Math.max(0.01, maxDim / 200);
  camera.far = Math.max(20, maxDim * 20);
  camera.updateProjectionMatrix();
  controls.update();
  if (fog) {
    fog.near = Math.max(0.5, maxDim * 1.2);
    fog.far = Math.max(fog.near + 1, maxDim * 4.5);
  }
}

function setPose(robot, qDeg) {
  if (!robot) return;
  for (let i = 0; i < JOINTS.length; i++) {
    const joint = robot.joints?.[JOINTS[i]];
    if (!joint) continue;
    joint.ignoreLimits = true;
    joint.setJointValue(qDeg[i] * DEG2RAD);
  }
  robot.updateMatrixWorld(true);
}

const _tcpPos = new THREE.Vector3();
const _tcpQuat = new THREE.Quaternion();

function getTcpPose(robot, pos = _tcpPos, quat = _tcpQuat) {
  const link = robot.links?.[TCP_LINK];
  if (!link) {
    pos.set(0, 0, 0);
    quat.identity();
    return { pos, quat };
  }
  link.updateWorldMatrix(true, false);
  // Link frame → TCP: offset (+ meta/profile calibration translation already folded into TCP_OFFSET)
  pos.copy(TCP_OFFSET).applyMatrix4(link.matrixWorld);
  link.getWorldQuaternion(_tcpLinkQuat);
  _tcpCalQuat.setFromEuler(TCP_CAL_RPY);
  quat.copy(_tcpLinkQuat).multiply(_tcpCalQuat);

  const ex = resolveBaseExtrinsics(ACTIVE_META);
  if (ex) {
    const applied = applyExtrinsicsToPose(
      { x: pos.x, y: pos.y, z: pos.z },
      { x: quat.x, y: quat.y, z: quat.z, w: quat.w },
      ex,
    );
    pos.set(applied.pos.x, applied.pos.y, applied.pos.z);
    quat.set(applied.quat.x, applied.quat.y, applied.quat.z, applied.quat.w);
  }
  return { pos, quat };
}

function getTcp(robot, out = new THREE.Vector3()) {
  return getTcpPose(robot, out).pos;
}

const evalLoader = bindLoader(document.getElementById('loadHint'));

function setLoadProgress(ratio, text, detail) {
  updateLoadProgress(evalLoader, ratio, text, detail);
}

function loadRobot(urdfUrl, { onProgress, label, rootEulerDeg } = {}) {
  return new Promise((resolve, reject) => {
    const manager = new THREE.LoadingManager();
    let settled = false;
    let robotRef = null;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      reject(err instanceof Error ? err : new Error(String(err)));
    };

    const hardTimer = setTimeout(() => {
      fail(new Error(t('eval.dyn.loadTimeout', { url: urdfUrl })));
    }, 45000);

    const retint = () => {
      if (robotRef) refreshRobotLook(robotRef);
    };

    manager.onProgress = (_url, loaded, total) => {
      if (total > 0) onProgress?.(Math.min(0.95, loaded / total), label || _url);
      // Meshes stream in after URDF resolve — keep role colors applied.
      retint();
    };
    manager.onLoad = () => {
      retint();
      onProgress?.(1, label || urdfUrl);
    };
    manager.onError = (url) => {
      console.warn('[eval] asset error', url);
    };

    const loader = new URDFLoader(manager);
    loader.packages = '';
    loader.parseCollision = false;
    // Strip ?v= cache-bust so mesh paths stay under the robot folder (not broken by query).
    const cleanUrl = String(urdfUrl).split('?')[0];
    loader.workingPath = cleanUrl.replace(/[^/]+$/, '');

    loader.load(
      urdfUrl,
      (robot) => {
        if (settled) return;
        settled = true;
        clearTimeout(hardTimer);
        try {
          robotRef = robot;
          robot.ignoreLimits = true;
          const e = rootEulerDeg || [0, 0, 0];
          robot.rotation.set(
            (Number(e[0]) || 0) * DEG2RAD,
            (Number(e[1]) || 0) * DEG2RAD,
            (Number(e[2]) || 0) * DEG2RAD,
          );
          refreshRobotLook(robot);
          onProgress?.(1, label || urdfUrl);
          resolve(robot);
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      },
      undefined,
      (err) => fail(err),
    );
  });
}

function makeScatter(colorHex) {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(TCP_MAX * 3);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({
    color: colorHex, size: 0.016, sizeAttenuation: true,
    transparent: true, opacity: 0.92, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = 10;
  pts.frustumCulled = false;
  return pts;
}

function updateScatter(pointsObj, path, frameIdx) {
  const start = Math.max(0, frameIdx - TCP_WINDOW);
  const end = Math.min(path.length - 1, frameIdx + TCP_WINDOW);
  const attr = pointsObj.geometry.getAttribute('position');
  let n = 0;
  for (let i = start; i <= end; i++) {
    const p = path[i];
    attr.setXYZ(n++, p.x, p.y, p.z);
  }
  attr.needsUpdate = true;
  pointsObj.geometry.setDrawRange(0, n);
  pointsObj.geometry.computeBoundingSphere();
}

function makeTcpAxes(originColor = 0xffffff, axisLen = 0.048, shaftR = 0.0024) {
  const g = new THREE.Group();
  const yUp = new THREE.Vector3(0, 1, 0);
  const addAxis = (dir, color) => {
    const shaftLen = axisLen * 0.72;
    const tipLen = axisLen * 0.28;
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 10),
      new THREE.MeshBasicMaterial({ color }),
    );
    const tip = new THREE.Mesh(
      new THREE.ConeGeometry(shaftR * 2.4, tipLen, 12),
      new THREE.MeshBasicMaterial({ color }),
    );
    shaft.position.y = shaftLen / 2;
    tip.position.y = shaftLen + tipLen / 2;
    const axis = new THREE.Group();
    axis.add(shaft, tip);
    axis.quaternion.setFromUnitVectors(yUp, dir.clone().normalize());
    g.add(axis);
  };
  addAxis(new THREE.Vector3(1, 0, 0), 0xff3333);
  addAxis(new THREE.Vector3(0, 1, 0), 0x33cc55);
  addAxis(new THREE.Vector3(0, 0, 1), 0x3388ff);
  g.add(new THREE.Mesh(
    new THREE.SphereGeometry(0.0038, 12, 10),
    new THREE.MeshBasicMaterial({ color: originColor }),
  ));
  g.renderOrder = 30;
  return g;
}

function syncTcpAxes(axes, robot) {
  const { pos, quat } = getTcpPose(robot);
  axes.position.copy(pos);
  axes.quaternion.copy(quat);
}

/** 轨迹着色：沿时间从浅 → 深，色相与对应机械臂一致（非跨色相热力）。 */
function shadeArmColor(baseHex, t, out = new THREE.Color()) {
  const u = Math.max(0, Math.min(1, t));
  const base = new THREE.Color(baseHex);
  const light = base.clone().lerp(new THREE.Color(0xffffff), 0.62);
  const dark = base.clone().lerp(new THREE.Color(0x000000), 0.28);
  return out.copy(light).lerp(dark, u);
}

function makeTimedPathLine(points, baseHex) {
  const n = points.length;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const p = points[i];
    positions[i * 3] = p.x;
    positions[i * 3 + 1] = p.y;
    positions[i * 3 + 2] = p.z;
    const t = n <= 1 ? 1 : i / (n - 1);
    shadeArmColor(baseHex, t, c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.renderOrder = 8;
  line.userData.baseHex = baseHex;
  return line;
}

function paintPathArmColors(line, points) {
  const baseHex = line.userData.baseHex ?? 0xffffff;
  const colors = line.geometry.getAttribute('color');
  const n = points.length;
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 1 : i / (n - 1);
    shadeArmColor(baseHex, t, c);
    colors.setXYZ(i, c.r, c.g, c.b);
  }
  colors.needsUpdate = true;
}

function makeErrArrow() {
  const dir = new THREE.Vector3(0, 1, 0);
  const arrow = new THREE.ArrowHelper(dir, new THREE.Vector3(), 0.05, 0xfbbf24, 0.012, 0.008);
  arrow.frustumCulled = false;
  arrow.renderOrder = 40;
  return arrow;
}

const _errDir = new THREE.Vector3();
function syncErrArrow(arrow, from, to) {
  _errDir.subVectors(to, from);
  const len = _errDir.length();
  if (len < 1e-5) {
    arrow.visible = false;
    return;
  }
  arrow.visible = true;
  arrow.position.copy(from);
  arrow.setDirection(_errDir.normalize());
  const head = Math.min(0.014, len * 0.35);
  arrow.setLength(len, head, head * 0.65);
}

/** Per-frame joint contribution ‖J_i Δq_i‖ in mm (finite-diff Jacobian at GT). */
function computeJointTcpContrib(probe, frames) {
  const epsDeg = 0.35;
  const n = frames.length;
  const out = Array.from({ length: n }, () => new Float32Array(JOINTS.length));
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const qWork = new Array(JOINTS.length);

  for (let fi = 0; fi < n; fi++) {
    const qGt = frames[fi].next_gt;
    const qPred = frames[fi].next_pred;
    setPose(probe, qGt);
    getTcp(probe, p0);
    for (let j = 0; j < JOINTS.length; j++) qWork[j] = qGt[j];
    for (let j = 0; j < JOINTS.length; j++) {
      qWork[j] = qGt[j] + epsDeg;
      setPose(probe, qWork);
      getTcp(probe, p1);
      const jLen = p1.distanceTo(p0) / epsDeg; // m/deg
      out[fi][j] = jLen * Math.abs(qPred[j] - qGt[j]) * 1000;
      qWork[j] = qGt[j];
    }
  }
  setPose(probe, frames[0].next_gt);
  return out;
}

function computeTcpPaths(probe, frames) {
  const cur = [], gt = [], pred = [];
  const gtQuat = [], predQuat = [];
  const tmp = new THREE.Vector3();
  const q = new THREE.Quaternion();
  for (const f of frames) {
    setPose(probe, f.current);
    cur.push(getTcp(probe, tmp).clone());
    setPose(probe, f.next_gt);
    {
      const pose = getTcpPose(probe, tmp, q);
      gt.push(pose.pos.clone());
      gtQuat.push(pose.quat.clone());
    }
    setPose(probe, f.next_pred);
    {
      const pose = getTcpPose(probe, tmp, q);
      pred.push(pose.pos.clone());
      predQuat.push(pose.quat.clone());
    }
  }
  return { cur, gt, pred, gtQuat, predQuat };
}

async function initScene(container, frames, robotCfg) {
  applyActiveRobot(robotCfg, ACTIVE_META || {});
  const colorCur = hexToInt(robotCfg.colors?.cur, COLOR_CUR);
  const colorGt = hexToInt(robotCfg.colors?.gt, COLOR_GT);
  const colorPred = hexToInt(robotCfg.colors?.pred, COLOR_PRED);
  const rootEuler = robotCfg.root_rotation_euler_xyz_deg;

  const w = container.clientWidth || window.innerWidth;
  const h = container.clientHeight || window.innerHeight;
  const scene = new THREE.Scene();
  const theme = getThreeSceneTheme();
  scene.fog = new THREE.Fog(theme.fog, 1.8, 5.5);

  const camera = new THREE.PerspectiveCamera(40, w / h, 0.01, 20);
  camera.position.set(0.7, 0.42, 0.9);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.setClearColor(theme.background, 1);
  container.appendChild(renderer.domElement);
  const grid = new THREE.GridHelper(1.6, 16, theme.gridCenter, theme.gridEdge);
  watchThreeSceneTheme(scene, renderer, { fog: scene.fog, grid });

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.16, 0);
  controls.enableDamping = true;

  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(1.5, 2.5, 1.2); scene.add(key);
  const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
  fill.position.set(-1.5, 1.0, -1.0); scene.add(fill);
  scene.add(grid);

  setLoadProgress(
    0.02,
    t('eval.dyn.loadUrdf3', { label: robotCfg.label }),
    t('eval.dyn.parseModelMesh', { id: robotCfg.id }),
  );
  const robotProgress = [0, 0, 0];
  const robotLabels = [t('eval.dyn.grayCur'), t('eval.dyn.redGt'), t('eval.dyn.bluePred')];
  const bumpRobots = () => {
    const avg = (robotProgress[0] + robotProgress[1] + robotProgress[2]) / 3;
    const parts = robotLabels
      .map((name, i) => `${name} ${Math.round(robotProgress[i] * 100)}%`)
      .join(' · ');
    setLoadProgress(0.02 + avg * 0.73, t('eval.dyn.loadModel', { label: robotCfg.label }), parts);
  };

  const [armCur, armGT, armPred] = await Promise.all([
    loadRobot(robotCfg.urdf.cur, {
      label: robotLabels[0],
      rootEulerDeg: rootEuler,
      onProgress: (p) => { robotProgress[0] = p; bumpRobots(); },
    }),
    loadRobot(robotCfg.urdf.gt, {
      label: robotLabels[1],
      rootEulerDeg: rootEuler,
      onProgress: (p) => { robotProgress[1] = p; bumpRobots(); },
    }),
    loadRobot(robotCfg.urdf.pred, {
      label: robotLabels[2],
      rootEulerDeg: rootEuler,
      onProgress: (p) => { robotProgress[2] = p; bumpRobots(); },
    }),
  ]);
  // Same mesh file for all three roles → force distinct colors (SO-100 already has colored URDFs).
  const sharedUrdf = robotCfg.urdf.cur === robotCfg.urdf.gt
    && robotCfg.urdf.gt === robotCfg.urdf.pred;
  if (sharedUrdf) {
    tintRobot(armCur, colorCur, 0.58);
    tintRobot(armGT, colorGt, 0.64);
    tintRobot(armPred, colorPred, 0.70);
    // STL finishes after URDF resolve; re-apply a few times so gray/red/blue stick.
    const retintAll = () => {
      refreshRobotLook(armCur);
      refreshRobotLook(armGT);
      refreshRobotLook(armPred);
    };
    requestAnimationFrame(retintAll);
    setTimeout(retintAll, 120);
    setTimeout(retintAll, 600);
    setTimeout(retintAll, 1800);
  }
  applyModelScale(armCur);
  applyModelScale(armGT);
  applyModelScale(armPred);
  scene.add(armCur, armGT, armPred);
  fitEvalCamera(camera, controls, armGT, { fog: scene.fog });

  setLoadProgress(0.78, t('eval.dyn.computeTcp'), `${robotCfg.id} · ${t('eval.dyn.fkSample')}`);
  const paths = computeTcpPaths(armGT, frames);
  setLoadProgress(0.90, t('eval.dyn.buildScene'), t('eval.dyn.trajScatter'));
  const scatterCur = makeScatter(colorCur);
  const scatterGT = makeScatter(colorGt);
  const scatterPred = makeScatter(colorPred);
  scene.add(scatterCur, scatterGT, scatterPred);

  const tcpCur = makeTcpAxes(colorCur);
  const tcpGT = makeTcpAxes(colorGt);
  const tcpPred = makeTcpAxes(colorPred);
  scene.add(tcpCur, tcpGT, tcpPred);

  const pathLineCur = makeTimedPathLine(paths.cur, colorCur);
  const pathLineGT = makeTimedPathLine(paths.gt, colorGt);
  const pathLinePred = makeTimedPathLine(paths.pred, colorPred);
  pathLineCur.material.opacity = 0.78;
  pathLineGT.material.opacity = 0.88;
  pathLinePred.material.opacity = 0.95;
  scene.add(pathLineCur, pathLineGT, pathLinePred);

  const colCfgInit = robotCfg.collision || {};
  const cloudCap = Math.max(128, (colCfgInit.links?.length || 8) * (colCfgInit.max_points_per_link || 28));
  const cloudCur = makeCollisionCloudPoints(THREE, colorCur, cloudCap);
  const cloudGT = makeCollisionCloudPoints(THREE, colorGt, cloudCap);
  const cloudPred = makeCollisionCloudPoints(THREE, colorPred, cloudCap);
  scene.add(cloudCur, cloudGT, cloudPred);

  const errArrow = makeErrArrow();
  scene.add(errArrow);

  const followOffset = new THREE.Vector3(0.45, 0.28, 0.55);
  let camMode = 'free'; // free | follow

  function setPathArmColors() {
    paintPathArmColors(pathLineCur, paths.cur);
    paintPathArmColors(pathLineGT, paths.gt);
    paintPathArmColors(pathLinePred, paths.pred);
  }

  function applyCameraPreset(mode) {
    camMode = mode === 'follow' ? 'follow' : 'free';
    if (mode === 'side') {
      camera.position.set(0.95, 0.28, 0.05);
      controls.target.set(0.05, 0.14, 0);
    } else if (mode === 'top') {
      camera.position.set(0.05, 1.15, 0.001);
      controls.target.set(0.05, 0, 0);
    } else if (mode === 'follow') {
      // position updated in showFrame / render
    }
    controls.update();
  }

  function updateFollowCam(lookAt) {
    if (camMode !== 'follow' || !lookAt) return;
    controls.target.lerp(lookAt, 0.35);
    const desired = _errDir.copy(lookAt).add(followOffset);
    camera.position.lerp(desired, 0.25);
  }

  function resize() {
    const ww = container.clientWidth || window.innerWidth;
    const hh = container.clientHeight || window.innerHeight;
    camera.aspect = ww / hh;
    camera.updateProjectionMatrix();
    renderer.setSize(ww, hh);
  }
  window.addEventListener('resize', resize);

  setLoadProgress(1, t('eval.dyn.loadDone'), t('eval.dyn.enterEvalView', { label: robotCfg.label }));
  return {
    robot: robotCfg,
    scene,
    armCur, armGT, armPred,
    scatterCur, scatterGT, scatterPred,
    tcpCur, tcpGT, tcpPred,
    pathLineCur, pathLineGT, pathLinePred, errArrow,
    cloudCur, cloudGT, cloudPred,
    setPathArmColors, applyCameraPreset, updateFollowCam,
    getCamMode: () => camMode,
    setCamMode: (m) => { camMode = m; },
    fitCamera: () => fitEvalCamera(camera, controls, armGT, { fog: scene.fog }),
    paths,
    camera, controls,
    canvas: renderer.domElement,
    resize,
    render() { controls.update(); renderer.render(scene, camera); },
  };
}

function makeAreaGradient(ctx, colorTop, colorBot) {
  const g = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height || 160);
  g.addColorStop(0, colorTop);
  g.addColorStop(1, colorBot);
  return g;
}

function baseChartOpts(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 450, easing: 'easeOutQuart' },
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: {
        display: true,
        position: 'top',
        align: 'end',
        labels: {
          color: '#a8b6cc',
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 10,
          font: { size: 10, family: "'IBM Plex Sans', sans-serif" },
        },
      },
      tooltip: {
        backgroundColor: 'rgba(12,18,28,0.92)',
        titleColor: '#e7ecf3',
        bodyColor: '#c5d0e0',
        borderColor: 'rgba(61,214,198,0.35)',
        borderWidth: 1,
        padding: 10,
        displayColors: true,
        cornerRadius: 8,
      },
    },
    scales: {
      x: {
        border: { display: false },
        ticks: {
          color: '#7f8fa8', maxTicksLimit: 5, font: { size: 9 },
          padding: 4,
        },
        grid: { color: 'rgba(58,77,102,0.28)', drawTicks: false },
      },
      y: {
        border: { display: false },
        ticks: {
          color: '#7f8fa8', font: { size: 9 }, padding: 6,
          callback: (v) => (Number.isFinite(v) ? (+v).toFixed(2) : v),
        },
        grid: { color: 'rgba(58,77,102,0.22)', drawTicks: false },
      },
    },
    ...extra,
  };
}

function setupTcpCharts(DATA, tcp) {
  const charts = [];
  const labels = DATA.series.t;
  document.getElementById('tcpErrSub').textContent =
    `ep ${formatSummaryLine(tcp.summary.ep_mm)} mm · eR ${formatSummaryLine(tcp.summary.eR_deg)}°`;

  const line = (label, data, color, width = 1.8, dash = []) => ({
    label,
    data,
    borderColor: color,
    borderWidth: width,
    borderDash: dash,
    backgroundColor: 'transparent',
    tension: 0.28,
    pointRadius: 0,
    pointHoverRadius: 3,
    pointHoverBackgroundColor: color,
  });

  charts.push(new Chart(document.getElementById('tcpErrChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        line('e_p (mm)', tcp.series.ep_mm, '#f87171', 2),
        line('e_R (°)', tcp.series.eR_deg, '#60a5fa', 2),
      ],
    },
    options: baseChartOpts(),
  }));

  charts.push(new Chart(document.getElementById('tcpAxisChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        line('Δx', tcp.series.dx_mm, '#f87171'),
        line('Δy', tcp.series.dy_mm, '#34d399'),
        line('Δz', tcp.series.dz_mm, '#60a5fa'),
      ],
    },
    options: baseChartOpts(),
  }));

  charts.push(new Chart(document.getElementById('tcpRpyChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        line('Δroll', tcp.series.droll_deg, '#f87171'),
        line('Δpitch', tcp.series.dpitch_deg, '#34d399'),
        line('Δyaw', tcp.series.dyaw_deg, '#60a5fa'),
      ],
    },
    options: baseChartOpts(),
  }));

  charts.push(new Chart(document.getElementById('tcpVelChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        line('‖Δv‖ (m/s)', tcp.series.v_err_mps, '#fbbf24', 2),
        line('‖Δω‖ (°/s)', tcp.series.w_err_dps, '#c084fc', 1.6, [4, 3]),
        line('‖Δa‖ (m/s²)', tcp.series.a_err_mps2, '#94a3b8', 1.4, [2, 2]),
      ],
    },
    options: baseChartOpts(),
  }));

  const segNames = ['approach', 'contact', 'transport', 'retreat'];
  const segLabels = [t('eval.dyn.segApproach'), t('eval.dyn.segContact'), t('eval.dyn.segTransport'), t('eval.dyn.segRetract')];
  charts.push(new Chart(document.getElementById('tcpSegChart'), {
    type: 'bar',
    data: {
      labels: segLabels,
      datasets: [
        {
          label: 'e_p mean (mm)',
          data: segNames.map((k) => tcp.segments[k].ep_mm.mean),
          backgroundColor: 'rgba(248,113,113,0.75)',
          borderRadius: 3,
          maxBarThickness: 18,
        },
        {
          label: 'e_R mean (°)',
          data: segNames.map((k) => tcp.segments[k].eR_deg.mean),
          backgroundColor: 'rgba(96,165,250,0.75)',
          borderRadius: 3,
          maxBarThickness: 18,
        },
      ],
    },
    options: {
      ...baseChartOpts(),
      scales: {
        ...baseChartOpts().scales,
        x: {
          ...baseChartOpts().scales.x,
          grid: { display: false },
        },
      },
    },
  }));

  const lagSign = tcp.temporal.lag_frames > 0
    ? t('eval.dyn.lagBehind')
    : (tcp.temporal.lag_frames < 0 ? t('eval.dyn.lagAhead') : t('eval.dyn.lagNone'));
  document.getElementById('tcpTemporalHint').textContent = formatTemporalHint(tcp);

  const taskEl = document.getElementById('tcpTaskHint');
  if (tcp.task.available) {
    const labels = DATA.frames.map((_, i) => i);
    charts.push(new Chart(document.getElementById('tcpTaskChart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          line(t('eval.dyn.chartPredGoalEp'), tcp.task.series.pred.map((x) => x.ep_mm), '#60a5fa', 2),
          line(t('eval.dyn.chartGtGoalEp'), tcp.task.series.gt.map((x) => x.ep_mm), '#f87171', 1.5, [4, 3]),
          line(t('eval.dyn.chartPredApproach'), tcp.task.series.pred.map((x) => x.approach_deg), '#fbbf24', 2),
          line(t('eval.dyn.chartGtApproach'), tcp.task.series.gt.map((x) => x.approach_deg), '#a3e635', 1.5, [4, 3]),
        ],
      },
      options: baseChartOpts(),
    }));
    const pf = tcp.task.pred.final;
    const gf = tcp.task.gt.final;
    const dlt = tcp.task.delta_final;
    taskEl.textContent = formatTaskHint(tcp);
  } else {
    taskEl.textContent = t('eval.dyn.taskErr', { reason: tcp.task.reason });
    const ctx = document.getElementById('tcpTaskChart');
    if (ctx) {
      charts.push(new Chart(ctx, {
        type: 'line',
        data: { labels: [], datasets: [] },
        options: {
          ...baseChartOpts(),
          plugins: {
            ...baseChartOpts().plugins,
            title: {
              display: true,
              text: t('eval.dyn.needGoalPose'),
              color: '#9db0c9',
              font: { size: 11 },
            },
          },
        },
      }));
    }
  }

  document.querySelectorAll('details.drawer').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (!d.open) return;
      requestAnimationFrame(() => {
        charts.forEach((c) => { try { c.resize(); } catch (_) {} });
      });
    });
  });
  return charts;
}

/** G28–G30: task outcome, contact timeline, object markers + charts. */
function setupTaskGPanel(DATA, tcp, world, onJumpFrame) {
  const analysis = analyzeTaskEpisode(DATA);
  const outcome = analysis.outcome;
  refreshTaskOutcomeHint(outcome, analysis);
  const list = document.getElementById('taskEventList');
  const objHint = document.getElementById('objectFrameHint');

  if (list) {
    list.onclick = (e) => {
      const li = e.target.closest('li[data-frame]');
      if (li && onJumpFrame) onJumpFrame(Number(li.dataset.frame));
    };
  }

  const labels = DATA.series?.t || analysis.contact.force_n.map((_, i) => i);
  const line = (label, data, color, width = 1.8, dash = []) => ({
    label,
    data,
    borderColor: color,
    borderWidth: width,
    borderDash: dash,
    backgroundColor: 'transparent',
    tension: 0.25,
    pointRadius: 0,
    spanGaps: true,
  });

  const contactCtx = document.getElementById('contactChart');
  if (contactCtx) {
    new Chart(contactCtx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          line('force (N)', analysis.contact.force_n, '#fbbf24', 2),
          line('slip (mm)', analysis.contact.slip_mm, '#f87171', 1.6, [4, 3]),
          line('width (mm)', analysis.contact.width_mm, '#60a5fa', 1.2, [2, 2]),
        ],
      },
      options: baseChartOpts(),
    });
  }

  const dist = buildObjectTcpDistances(
    DATA,
    // Compare in physical meters (unscaled), matching episode object poses.
    (tcp && world?.paths?.pred)
      ? pathsToMeters({ pred: world.paths.pred }).pred
      : [],
  );
  const distCtx = document.getElementById('objectDistChart');
  if (distCtx) {
    const datasets = [];
    if (dist.available) {
      for (const id of dist.trajectories.ids) {
        datasets.push(line(`${id}→TCP`, dist.series[id].to_object_mm, '#fbbf24', 2));
        datasets.push(line(`${id} grasp→TCP`, dist.series[id].to_grasp_mm, '#34d399', 1.5, [4, 3]));
      }
    }
    new Chart(distCtx, {
      type: 'line',
      data: { labels, datasets },
      options: baseChartOpts({
        plugins: {
          ...baseChartOpts().plugins,
          title: datasets.length ? undefined : {
            display: true,
            text: t('eval.dyn.needObjects'),
            color: '#9db0c9',
            font: { size: 11 },
          },
        },
      }),
    });
  }

  // 3D object markers
  const markers = {};
  if (world?.scene && analysis.objects.available) {
    for (const id of analysis.objects.ids) {
      const tr = analysis.objects.objects[id];
      let color = 0xfbbf24;
      if (typeof tr.color === 'string' && tr.color.startsWith('#')) {
        color = Number.parseInt(tr.color.slice(1), 16) || color;
      }
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.014, 16, 12),
        new THREE.MeshBasicMaterial({ color }),
      );
      const grasp = new THREE.Mesh(
        new THREE.SphereGeometry(0.008, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x34d399 }),
      );
      mesh.visible = false;
      grasp.visible = false;
      world.scene.add(mesh, grasp);
      markers[id] = { mesh, grasp, traj: tr };
    }
  }

  function sync(frameIdx) {
    for (const id of Object.keys(markers)) {
      const { mesh, grasp, traj } = markers[id];
      const p = traj.pos[frameIdx];
      if (p) {
        mesh.visible = true;
        const d = toDisplayPos(p);
        mesh.position.set(d.x, d.y, d.z);
      } else {
        mesh.visible = false;
      }
      const g = traj.grasp_pos[frameIdx];
      if (g) {
        grasp.visible = true;
        const d = toDisplayPos(g);
        grasp.position.set(d.x, d.y, d.z);
      } else {
        grasp.visible = false;
      }
    }
    if (objHint) {
      const goal = resolveGoalAtFrame(DATA, frameIdx);
      const c = DATA.frames[frameIdx]?.contact;
      const parts = [];
      if (c) {
        parts.push(c.in_contact ? t('eval.dyn.inContact') : t('eval.dyn.noContact'));
        if (Number.isFinite(c.force_n)) parts.push(`F=${c.force_n.toFixed(1)}N`);
        if (Number.isFinite(c.slip_mm)) parts.push(`slip=${c.slip_mm.toFixed(1)}mm`);
      }
      if (goal?.pos) {
        parts.push(`goal (${goal.pos.x.toFixed(3)}, ${goal.pos.y.toFixed(3)}, ${goal.pos.z.toFixed(3)})`);
      }
      const primary = analysis.objects.ids[0];
      if (primary && dist.available) {
        const dObj = dist.series[primary].to_object_mm[frameIdx];
        if (dObj != null) parts.push(`${primary}→TCP ${dObj.toFixed(1)}mm`);
      }
      objHint.textContent = parts.join(' · ') || t('eval.dyn.noObjContact');
    }
  }

  return { analysis, sync };
}

function fillTcpOverview(tcp) {
  const box = document.getElementById('tcpStats');
  box.innerHTML = '';
  const rows = [
    ['TCP e_p μ', `${tcp.summary.ep_mm.mean.toFixed(2)} mm`, 'ep_mean'],
    ['TCP e_p p95', `${tcp.summary.ep_mm.p95.toFixed(2)} mm`, 'ep_p95'],
    ['TCP e_R μ', `${tcp.summary.eR_deg.mean.toFixed(2)}°`, 'er_mean'],
    ['TCP e_R p95', `${tcp.summary.eR_deg.p95.toFixed(2)}°`, 'er_p95'],
    ['|Δx| μ', `${tcp.summary.dx_mm.mean.toFixed(2)} mm`, 'dx'],
    ['|Δy| μ', `${tcp.summary.dy_mm.mean.toFixed(2)} mm`, 'dy'],
    ['|Δz| μ', `${tcp.summary.dz_mm.mean.toFixed(2)} mm`, 'dz'],
    ['‖Δv‖ μ', `${tcp.summary.v_err_mps.mean.toFixed(4)} m/s`, 'dv'],
    ['‖Δω‖ μ', `${tcp.summary.w_err_dps.mean.toFixed(2)} °/s`, 'dw'],
    ['‖Δa‖ μ', `${tcp.summary.a_err_mps2.mean.toFixed(3)} m/s²`, 'da'],
  ];
  if (tcp.task?.available) {
    rows.push(
      ['任务 e_p μ', `${tcp.task.pred.ep_mm.mean.toFixed(2)} mm`, 'task_ep'],
      ['接近角 μ', `${tcp.task.pred.approach_deg.mean.toFixed(2)}°`, 'approach'],
      ['末帧任务 e_p', `${tcp.task.pred.final.ep_mm.toFixed(2)} mm`, 'task_ep_final'],
      ['末帧接近角', `${tcp.task.pred.final.approach_deg.toFixed(2)}°`, 'approach_final'],
    );
  }
  for (const [label, value, tipKey] of rows) {
    appendStat(box, label, value, tipKey);
  }
}

function updateTcpFrameHint(tcp, i) {
  const el = document.getElementById('tcpFrameHint');
  if (!el || !tcp?.series) return;
  const s = tcp.series;
  if (i < 0 || i >= s.ep_mm.length) {
    el.textContent = '';
    return;
  }
  let text =
    `TCP · e_p ${s.ep_mm[i].toFixed(2)} mm · e_R ${s.eR_deg[i].toFixed(2)}° · `
    + `Δxyz (${s.dx_mm[i].toFixed(1)}, ${s.dy_mm[i].toFixed(1)}, ${s.dz_mm[i].toFixed(1)}) mm · `
    + `Δrpy (${s.droll_deg[i].toFixed(1)}, ${s.dpitch_deg[i].toFixed(1)}, ${s.dyaw_deg[i].toFixed(1)})° · `
    + `‖Δv‖ ${s.v_err_mps[i].toFixed(4)} m/s`;
  if (tcp.task?.available) {
    const pt = tcp.task.series.pred[i];
    text += ` · 任务 e_p ${pt.ep_mm.toFixed(2)} mm · 接近 ${pt.approach_deg.toFixed(2)}°`;
  }
  el.textContent = text;
}

function paintErrHeatmap(canvas, epMm) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, canvas.clientWidth || canvas.parentElement?.clientWidth || 200);
  const h = Math.max(1, canvas.clientHeight || 16);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const n = epMm.length;
  const epMax = Math.max(...epMm, 1e-6);
  for (let i = 0; i < n; i++) {
    const t = epMm[i] / epMax;
    const r = Math.round(40 + 200 * t);
    const g = Math.round(190 * (1 - t));
    const b = Math.round(180 * (1 - t) + 40 * t);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    const x0 = (i / n) * w;
    const x1 = ((i + 1) / n) * w;
    ctx.fillRect(x0, 0, Math.max(1, x1 - x0), h);
  }
}

function setHeatmapCursor(i, n) {
  const el = document.getElementById('errHeatmapCursor');
  if (!el || n <= 1) return;
  el.style.left = `${(i / (n - 1)) * 100}%`;
}

function fillWorstList(epMm, topK = 8) {
  const ul = document.getElementById('worstList');
  if (!ul) return [];
  const ranked = epMm
    .map((v, i) => ({ i, v }))
    .sort((a, b) => b.v - a.v)
    .slice(0, topK);
  ul.innerHTML = ranked.map((r, k) =>
    `<li data-frame="${r.i}"><span>#${k + 1} · t=${r.i}</span><span class="ep">${r.v.toFixed(2)} mm</span></li>`
  ).join('');
  return ranked;
}

function paintWorkspace(canvas, gtPos, predPos, epMm, frameIdx) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, canvas.clientWidth || 280);
  const h = Math.max(1, canvas.clientHeight || 168);
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const consider = (p) => {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  };
  gtPos.forEach(consider);
  predPos.forEach(consider);
  const pad = 0.04;
  minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const epMax = Math.max(...epMm, 1e-6);

  const toXY = (p) => ({
    x: ((p.x - minX) / spanX) * (w - 16) + 8,
    y: h - (((p.y - minY) / spanY) * (h - 16) + 8),
  });

  // grid
  ctx.strokeStyle = 'rgba(58,77,102,0.45)';
  ctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const x = 8 + ((w - 16) * g) / 4;
    const y = 8 + ((h - 16) * g) / 4;
    ctx.beginPath(); ctx.moveTo(x, 8); ctx.lineTo(x, h - 8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(w - 8, y); ctx.stroke();
  }

  const drawPts = (pos, hollow) => {
    for (let i = 0; i < pos.length; i++) {
      const t = epMm[i] / epMax;
      const { x, y } = toXY(pos[i]);
      const r = 2.2 + 2.5 * t;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      if (hollow) {
        ctx.strokeStyle = `rgba(59,130,246,${0.35 + 0.55 * t})`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = `rgba(239,68,68,${0.25 + 0.65 * t})`;
        ctx.fill();
      }
    }
  };
  drawPts(gtPos, false);
  drawPts(predPos, true);

  // current frame markers
  if (frameIdx >= 0 && frameIdx < gtPos.length) {
    const a = toXY(gtPos[frameIdx]);
    const b = toXY(predPos[frameIdx]);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(a.x, a.y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#93c5fd';
    ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2); ctx.fill();
  }

  canvas._wsMap = { minX, maxX, minY, maxY, w, h, gtPos, predPos };
}

function workspaceHitFrame(canvas, clientX, clientY) {
  const map = canvas._wsMap;
  if (!map) return -1;
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * map.w;
  const y = ((clientY - rect.top) / rect.height) * map.h;
  const spanX = map.maxX - map.minX;
  const spanY = map.maxY - map.minY;
  const wx = map.minX + ((x - 8) / (map.w - 16)) * spanX;
  const wy = map.minY + ((map.h - 8 - y) / (map.h - 16)) * spanY;
  let best = -1;
  let bestD = 0.03 ** 2;
  const consider = (pos, i) => {
    const dx = pos[i].x - wx;
    const dy = pos[i].y - wy;
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = i; }
  };
  for (let i = 0; i < map.gtPos.length; i++) {
    consider(map.gtPos, i);
    consider(map.predPos, i);
  }
  return best;
}

function setupJointContribChart(names) {
  const chart = new Chart(document.getElementById('jointContribChart'), {
    type: 'bar',
    data: {
      labels: names.map((n) => n.split('_')[0]),
      datasets: [{
        label: 'contrib mm',
        data: names.map(() => 0),
        backgroundColor: 'rgba(251,191,36,0.75)',
        borderRadius: 3,
        maxBarThickness: 14,
      }],
    },
    options: {
      ...baseChartOpts(),
      animation: { duration: 180 },
      plugins: {
        ...baseChartOpts().plugins,
        legend: { display: false },
      },
      scales: {
        ...baseChartOpts().scales,
        x: {
          ...baseChartOpts().scales.x,
          grid: { display: false },
          ticks: { color: '#9db0c9', font: { size: 9 }, maxRotation: 0 },
        },
      },
    },
  });
  return chart;
}

function setupCharts(DATA) {
  const meta = DATA.meta;
  const names = meta.joint_names;
  const charts = [];

  document.getElementById('errSub').textContent =
    `mean ${meta.mean_l2.toFixed(2)} · max ${meta.max_l2.toFixed(2)}`;

  const errCanvas = document.getElementById('errChart');
  const errCtx = errCanvas.getContext('2d');
  charts.push(new Chart(errCtx, {
    type: 'line',
    data: {
      labels: DATA.series.t,
      datasets: [{
        label: '‖pred−gt‖₂',
        data: DATA.series.err_l2,
        borderColor: '#f87171',
        borderWidth: 2,
        backgroundColor: (c) => makeAreaGradient(
          c.chart.ctx, 'rgba(248,113,113,0.35)', 'rgba(248,113,113,0.02)',
        ),
        fill: true,
        tension: 0.35,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHoverBackgroundColor: '#fecaca',
      }],
    },
    options: {
      ...baseChartOpts(),
      plugins: {
        ...baseChartOpts().plugins,
        legend: { display: false },
      },
    },
  }));

  charts.push(new Chart(document.getElementById('maeChart'), {
    type: 'bar',
    data: {
      labels: names.map((n) => n.split('_')[0]),
      datasets: [{
        label: 'MAE',
        data: names.map((n) => meta.per_joint_mae[n]),
        backgroundColor: 'rgba(61,214,198,0.72)',
        borderColor: 'rgba(61,214,198,0.95)',
        borderWidth: 1,
        borderRadius: 3,
        borderSkipped: false,
        maxBarThickness: 10,
        categoryPercentage: 0.55,
        barPercentage: 0.45,
      }],
    },
    options: {
      ...baseChartOpts(),
      plugins: {
        ...baseChartOpts().plugins,
        legend: { display: false },
      },
      scales: {
        ...baseChartOpts().scales,
        x: {
          ...baseChartOpts().scales.x,
          grid: { display: false },
          ticks: { color: '#9db0c9', font: { size: 9 }, maxRotation: 0 },
        },
      },
    },
  }));

  const sel = document.getElementById('jointSelect');
  names.forEach((n, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = n; sel.appendChild(o);
  });

  let trajChart;
  function renderTraj(j) {
    const line = (label, data, color, width = 2, dash = []) => ({
      label,
      data,
      borderColor: color,
      borderWidth: width,
      borderDash: dash,
      backgroundColor: 'transparent',
      tension: 0.32,
      pointRadius: 0,
      pointHoverRadius: 3.5,
      pointHoverBackgroundColor: color,
    });
    if (trajChart) trajChart.destroy();
    trajChart = new Chart(document.getElementById('trajChart'), {
      type: 'line',
      data: {
        labels: DATA.series.t,
        datasets: [
          line('current', DATA.series.current.map((r) => r[j]), '#9ca3af', 1.5, [4, 3]),
          line('GT', DATA.series.next_gt.map((r) => r[j]), '#f87171', 2.2),
          line('predict', DATA.series.next_pred.map((r) => r[j]), '#60a5fa', 2.2),
        ],
      },
      options: baseChartOpts(),
    });
    charts[2] = trajChart;
  }
  sel.addEventListener('change', () => renderTraj(Number(sel.value)));
  renderTraj(0);

  document.querySelectorAll('details.drawer').forEach((d) => {
    d.addEventListener('toggle', () => {
      if (!d.open) return;
      requestAnimationFrame(() => {
        charts.forEach((c) => { try { c.resize(); } catch (_) {} });
      });
    });
  });
  return charts;
}

function formatMMSS(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function pickMimeType() {
  const cands = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const t of cands) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(t)) return t;
  }
  return '';
}

try {
  setLoadProgress(0.01, t('eval.dyn.loadEval'), t('eval.dyn.readEpisodeJson'));
  const DATA = await loadData();
  const meta = DATA.meta;
  const names = meta.joint_names;

  setLoadProgress(0.04, t('eval.dyn.loadRobotCfg'), 'robots.json');
  const robotRegistry = await loadRobotRegistry('/config/robots.json');
  const guard = validateEpisodeAgainstRegistry(DATA, robotRegistry);
  if (!guard.ok) {
    throw new Error(t('eval.dyn.guardFail', { errors: guard.errors.join('；') }));
  }
  const robotCfg = guard.robot || resolveRobot(robotRegistry, meta, { allowDefault: false });
  applyActiveRobot(robotCfg, meta);
  const mismatch = jointNamesMismatch(meta, robotCfg);
  const guardEl = document.getElementById('robotGuard');
  if (guard.warnings.length && guardEl) {
    guardEl.className = 'robot-guard warn show';
    guardEl.textContent = t('eval.dyn.guardWarn', { id: robotCfg.id, warnings: guard.warnings.join('；') });
  } else if (mismatch && guardEl) {
    // should already be in errors; keep as safety net
    guardEl.className = 'robot-guard show';
    guardEl.textContent = t('eval.dyn.guardMismatch', { mismatch });
  }

  document.getElementById('title').textContent = `Embody · ${robotCfg.label}`;
  document.getElementById('subtitle').textContent = t('eval.dyn.metaSubtitle', {
    id: robotCfg.id,
    source: meta.source,
    frames: meta.n_frames,
    at: meta.generated_at,
  });
  setLoadProgress(0.08, t('eval.dyn.initUi'), t('eval.dyn.initUiFrames', { label: robotCfg.label, n: meta.n_frames }));

  const stats = document.getElementById('stats');
  for (const [label, value, tipKey] of [
    ['机型', robotCfg.label, 'robot'],
    ['平均 L2', meta.mean_l2.toFixed(3), 'l2_mean'],
    ['最大 L2', meta.max_l2.toFixed(3), 'l2_max'],
    ['帧数', String(meta.n_frames), 'n_frames'],
    ['数据 FPS', String(meta.fps), 'fps'],
  ]) {
    appendStat(stats, label, value, tipKey);
  }

  setupCharts(DATA);
  setLoadProgress(0.12, t('eval.dyn.loadModel', { label: robotCfg.label }), t('eval.dyn.downloadUrdf'));

  const world = await initScene(document.getElementById('arm3d'), DATA.frames, robotCfg);
  hideLoader(evalLoader, { remove: true });
  world.resize();
  mountViewTools(document.getElementById('arm3d'), world.controls, {
    onFit: () => {
      world.applyCameraPreset('free');
      world.fitCamera();
      const camHintEl = document.getElementById('camHint');
      if (camHintEl) camHintEl.textContent = t('eval.dyn.camFree');
    },
  });

  const toPlainPos = (p) => ({ x: p.x, y: p.y, z: p.z });
  const toPlainQuat = (q) => ({ x: q.x, y: q.y, z: q.z, w: q.w });
  // Paths are in display space (model_scale); metrics need physical meters.
  const pathsM = pathsToMeters(world.paths);
  const tcp = computeTcpMetrics({
    gtPos: pathsM.gt.map(toPlainPos),
    predPos: pathsM.pred.map(toPlainPos),
    gtQuat: world.paths.gtQuat.map(toPlainQuat),
    predQuat: world.paths.predQuat.map(toPlainQuat),
    fps: meta.fps,
    goalPose: meta.goal_pose || null,
  });
  fillTcpOverview(tcp);
  setupTcpCharts(DATA, tcp);
  world.setPathArmColors();

  let taskPanelSync = () => {};
  // task panel wired after pauseJump exists (below)

  // C13-ish: TCP threshold attainment (fixed defaults; override via meta.tcp_thresholds)
  const thrEp = meta.tcp_thresholds?.ep_mm ?? 5;
  const thrEr = meta.tcp_thresholds?.eR_deg ?? 5;
  const passEp = tcp.series.ep_mm.filter((v) => v < thrEp).length / tcp.n;
  const passEr = tcp.series.eR_deg.filter((v) => v < thrEr).length / tcp.n;
  const passBoth = tcp.series.ep_mm.filter((v, i) => v < thrEp && tcp.series.eR_deg[i] < thrEr).length / tcp.n;
  for (const [label, value, tipKey] of [
    [`e_p<${thrEp}mm`, `${(passEp * 100).toFixed(1)}%`, 'pass_ep'],
    [`e_R<${thrEr}°`, `${(passEr * 100).toFixed(1)}%`, 'pass_er'],
    [t('eval.dyn.passBoth'), `${(passBoth * 100).toFixed(1)}%`, 'pass_both'],
    ['action', String(meta.action_mode ?? '—'), 'action'],
  ]) {
    appendStat(document.getElementById('tcpStats'), label, value, tipKey);
  }

  // E23: load thresholds (meta.thresholds overrides example file)
  let thresholds = meta.thresholds || null;
  if (!thresholds) {
    try {
      const tr = await fetch('./scripts/thresholds.example.json?_=' + Date.now());
      if (tr.ok) thresholds = await tr.json();
    } catch (_) { /* offline / missing */ }
  }
  const gates = evaluateGates(meta, tcp, {
    ...thresholds,
    min_pass_ep_rate: thresholds?.min_pass_ep_rate,
    pass_ep_mm: thresholds?.pass_ep_mm ?? thrEp,
  });
  const gateEl = document.getElementById('gateHint');
  if (gateEl) {
    const failed = gates.checks.filter((c) => !c.ok).map((c) => c.name);
    gateEl.textContent = gates.checks.length
      ? t('eval.dyn.gateResult', { status: gates.passed ? 'PASS' : 'FAIL', n: gates.checks.length })
        + (failed.length ? t('eval.dyn.gateFailed', { items: failed.join(', ') }) : '')
      : t('eval.dyn.gateNone');
  }
  {
    appendStat(
      document.getElementById('tcpStats'),
      t('eval.dyn.gateWord'),
      gates.checks.length ? (gates.passed ? 'PASS' : 'FAIL') : '—',
      'gate_stat',
    );
  }

  function captureShot() {
    if (!document.getElementById('chkExportShot')?.checked) return null;
    try {
      // downscale via temp canvas to limit memory
      const src = world.canvas;
      const maxW = 960;
      const scale = Math.min(1, maxW / Math.max(1, src.width));
      const w = Math.max(1, Math.round(src.width * scale));
      const h = Math.max(1, Math.round(src.height * scale));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(src, 0, 0, w, h);
      return c.toDataURL('image/jpeg', 0.72);
    } catch (_) {
      return null;
    }
  }

  document.getElementById('btnExportHtml')?.addEventListener('click', () => {
    const html = buildReportHtml({
      meta,
      tcp,
      gates,
      screenshotDataUrl: captureShot(),
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadText(`embody_report_${stamp}.html`, html, 'text/html;charset=utf-8');
  });
  document.getElementById('btnExportJson')?.addEventListener('click', () => {
    const summary = buildReportSummary({ meta, tcp, gates, screenshotDataUrl: null });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadText(`eval_summary_${stamp}.json`, JSON.stringify(summary, null, 2), 'application/json');
  });

  const jointContrib = computeJointTcpContrib(world.armGT, DATA.frames);
  const contribChart = setupJointContribChart(names);

  const heatCanvas = document.getElementById('errHeatmap');
  const paintHeat = () => paintErrHeatmap(heatCanvas, tcp.series.ep_mm);
  paintHeat();
  window.addEventListener('resize', paintHeat);
  fillWorstList(tcp.series.ep_mm);
  document.getElementById('worstList').addEventListener('click', (e) => {
    const li = e.target.closest('li[data-frame]');
    if (!li) return;
    playing = false;
    document.getElementById('btnPlay').textContent = t('eval.btnPlay');
    document.getElementById('btnPlay').classList.remove('active');
    showFrame(Number(li.dataset.frame));
  });

  const wsCanvas = document.getElementById('workspaceCanvas');
  const paintWs = (idx) => paintWorkspace(
    wsCanvas, world.paths.gt, world.paths.pred, tcp.series.ep_mm, idx,
  );
  paintWs(0);
  window.addEventListener('resize', () => paintWs(frameIdx));
  wsCanvas.addEventListener('click', (e) => {
    const hit = workspaceHitFrame(wsCanvas, e.clientX, e.clientY);
    if (hit < 0) return;
    playing = false;
    document.getElementById('btnPlay').textContent = t('eval.btnPlay');
    document.getElementById('btnPlay').classList.remove('active');
    showFrame(hit);
  });

  document.getElementById('errHeatmapWrap').addEventListener('click', (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(t * (meta.n_frames - 1));
    playing = false;
    document.getElementById('btnPlay').textContent = t('eval.btnPlay');
    document.getElementById('btnPlay').classList.remove('active');
    showFrame(idx);
  });

  const slider = document.getElementById('frameSlider');
  const frameLabel = document.getElementById('frameLabel');
  const frameTable = document.getElementById('frameTable');
  slider.max = String(meta.n_frames - 1);

  let frameIdx = 0;
  let playing = false;
  const visibility = { cur: true, gt: true, pred: true, paths: true, errArrow: true, cloudView: false };
  const cloudSampleOpts = () => {
    const cfg = ACTIVE_ROBOT?.collision || {};
    return {
      links: (cfg.links && cfg.links.length)
        ? cfg.links
        : ['base', 'shoulder', 'upper_arm', 'lower_arm', 'wrist', 'gripper'],
      maxPointsPerLink: cfg.max_points_per_link || 28,
      invScale: 1,
    };
  };

  function refreshCollisionClouds() {
    if (!visibility.cloudView) return;
    // Late-loaded STL meshes may reappear; keep them suppressed in cloud mode.
    setRobotMeshesVisible(world.armCur, false);
    setRobotMeshesVisible(world.armGT, false);
    setRobotMeshesVisible(world.armPred, false);
    const opts = cloudSampleOpts();
    if (visibility.cur) syncCollisionCloudPoints(world.cloudCur, world.armCur, THREE, opts);
    if (visibility.gt) syncCollisionCloudPoints(world.cloudGT, world.armGT, THREE, opts);
    if (visibility.pred) syncCollisionCloudPoints(world.cloudPred, world.armPred, THREE, opts);
  }

  function applyVisibility() {
    const cloudOn = visibility.cloudView;
    // Keep arm groups "visible" so FK / matrixWorld still update; hide meshes in cloud mode.
    world.armCur.visible = visibility.cur;
    world.armGT.visible = visibility.gt;
    world.armPred.visible = visibility.pred;
    setRobotMeshesVisible(world.armCur, visibility.cur && !cloudOn);
    setRobotMeshesVisible(world.armGT, visibility.gt && !cloudOn);
    setRobotMeshesVisible(world.armPred, visibility.pred && !cloudOn);

    world.scatterCur.visible = visibility.cur && !cloudOn;
    world.tcpCur.visible = visibility.cur;
    world.scatterGT.visible = visibility.gt && !cloudOn;
    world.tcpGT.visible = visibility.gt;
    world.scatterPred.visible = visibility.pred && !cloudOn;
    world.tcpPred.visible = visibility.pred;

    world.pathLineCur.visible = visibility.paths && visibility.cur && !cloudOn;
    world.pathLineGT.visible = visibility.paths && visibility.gt && !cloudOn;
    world.pathLinePred.visible = visibility.paths && visibility.pred && !cloudOn;
    world.errArrow.visible = visibility.errArrow && !cloudOn;

    world.cloudCur.visible = cloudOn && visibility.cur;
    world.cloudGT.visible = cloudOn && visibility.gt;
    world.cloudPred.visible = cloudOn && visibility.pred;
    if (cloudOn) refreshCollisionClouds();
  }

  function wireToggle(btnId, key) {
    const btn = document.getElementById(btnId);
    btn.addEventListener('click', () => {
      visibility[key] = !visibility[key];
      btn.classList.toggle('on', visibility[key]);
      btn.classList.toggle('off', !visibility[key]);
      applyVisibility();
    });
  }
  wireToggle('btnToggleCur', 'cur');
  wireToggle('btnToggleGT', 'gt');
  wireToggle('btnTogglePred', 'pred');
  wireToggle('btnTogglePaths', 'paths');
  wireToggle('btnToggleErrArrow', 'errArrow');
  wireToggle('btnToggleCloud', 'cloudView');

  const camHint = document.getElementById('camHint');
  function setCamButtons(activeId) {
    for (const id of ['btnCamSide', 'btnCamTop', 'btnCamFollow']) {
      document.getElementById(id).classList.toggle('active', id === activeId);
    }
  }
  document.getElementById('btnCamSide').addEventListener('click', () => {
    world.applyCameraPreset('side');
    setCamButtons('btnCamSide');
    camHint.textContent = t('eval.dyn.camSideHint');
  });
  document.getElementById('btnCamTop').addEventListener('click', () => {
    world.applyCameraPreset('top');
    setCamButtons('btnCamTop');
    camHint.textContent = t('eval.dyn.camTopHint');
  });
  document.getElementById('btnCamFollow').addEventListener('click', () => {
    const on = world.getCamMode() !== 'follow';
    world.applyCameraPreset(on ? 'follow' : 'free');
    setCamButtons(on ? 'btnCamFollow' : '');
    camHint.textContent = on ? t('eval.dyn.camFollowHint') : t('eval.dyn.camFree');
  });
  world.controls.addEventListener('start', () => {
    if (world.getCamMode() === 'follow') {
      world.setCamMode('free');
      setCamButtons('');
      camHint.textContent = t('eval.dyn.camFree');
    }
  });

  // ---- Observation sync (F25–F27) ----
  const obsCamSelect = document.getElementById('obsCamSelect');
  const obsCanvas = document.getElementById('obsCanvas');
  const obsAlignHint = document.getElementById('obsAlignHint');
  const obsFrameHint = document.getElementById('obsFrameHint');
  const obsImageCache = new Map();
  const obsAudit = auditObsAlignment(DATA);
  const obsCams = getCameras(meta);
  let obsPaintToken = 0;

  if (obsAlignHint) {
    if (!obsAudit.available) {
      obsAlignHint.innerHTML = `<span class="tag">${t('eval.dyn.tagNoCameras')}</span> ${t('eval.dyn.noCameras')}`;
    } else {
      const issueTags = obsAudit.issues.slice(0, 4).map((x) => {
        const cls = x.level === 'error' ? 'bad' : x.level === 'warn' ? 'warn' : 'ok';
        return `<span class="tag ${cls}">${x.code}</span>`;
      }).join('') || '<span class="tag ok">aligned</span>';
      obsAlignHint.innerHTML = `${issueTags}<br>mode=${obsAudit.align.mode} · max_skew=${obsAudit.align.max_skew_ms}ms · ${obsCams.map((c) => c.id).join(', ')}`;
    }
  }
  if (obsCamSelect) {
    obsCamSelect.innerHTML = obsCams.length
      ? obsCams.map((c) => `<option value="${c.id}">${c.id} · ${c.stream || 'rgb'}</option>`).join('')
      : '<option value="">—</option>';
  }

  function refreshObsView(i) {
    if (!obsCanvas) return;
    const camId = obsCamSelect?.value || '';
    if (!camId || !hasObservation(DATA)) {
      const ctx = obsCanvas.getContext('2d');
      const w = obsCanvas.clientWidth || 320;
      const h = obsCanvas.clientHeight || 168;
      obsCanvas.width = w;
      obsCanvas.height = h;
      ctx.fillStyle = '#0c121c';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#8b9bb4';
      ctx.font = '12px sans-serif';
      ctx.fillText(t('eval.dyn.noObsFrames'), 12, 28);
      if (obsFrameHint) obsFrameHint.textContent = t('eval.dyn.noObsMedia');
      return;
    }
    const token = ++obsPaintToken;
    paintObsCanvas(obsCanvas, {
      data: DATA,
      frameIdx: i,
      cameraId: camId,
      episodePath: DATA.__data_path || null,
      showBoxes: document.getElementById('chkObsBox')?.checked !== false,
      showKeypoints: document.getElementById('chkObsKp')?.checked !== false,
      showHeatmap: document.getElementById('chkObsHeat')?.checked !== false,
      imageCache: obsImageCache,
    }).then((r) => {
      if (token !== obsPaintToken || !obsFrameHint) return;
      const skew = r.skew_ms == null ? '—' : `${r.skew_ms >= 0 ? '+' : ''}${r.skew_ms.toFixed(1)}ms`;
      obsFrameHint.textContent = r.ok
        ? `帧 ${i} · ${camId} · ${r.reason} · skew ${skew}`
        : `帧 ${i} · ${camId} · ${r.reason || '失败'} · skew ${skew}`;
    });
  }
  obsCamSelect?.addEventListener('change', () => refreshObsView(frameIdx));
  for (const id of ['chkObsBox', 'chkObsKp', 'chkObsHeat']) {
    document.getElementById(id)?.addEventListener('change', () => refreshObsView(frameIdx));
  }
  window.addEventListener('resize', () => refreshObsView(frameIdx));

  function showFrame(i) {
    frameIdx = i;
    slider.value = String(i);
    const f = DATA.frames[i];
    frameLabel.textContent = `t=${i} · err ${f.err_l2.toFixed(3)} · e_p ${tcp.series.ep_mm[i].toFixed(1)}mm`;

    setPose(world.armCur, f.current);
    setPose(world.armGT, f.next_gt);
    setPose(world.armPred, f.next_pred);

    updateScatter(world.scatterCur, world.paths.cur, i);
    updateScatter(world.scatterGT, world.paths.gt, i);
    updateScatter(world.scatterPred, world.paths.pred, i);

    syncTcpAxes(world.tcpCur, world.armCur);
    syncTcpAxes(world.tcpGT, world.armGT);
    syncTcpAxes(world.tcpPred, world.armPred);

    syncErrArrow(world.errArrow, world.paths.gt[i], world.paths.pred[i]);
    if (!visibility.errArrow || visibility.cloudView) world.errArrow.visible = false;

    if (visibility.cloudView) refreshCollisionClouds();

    world.updateFollowCam(world.paths.gt[i]);

    updateTcpFrameHint(tcp, i);
    setHeatmapCursor(i, meta.n_frames);
    paintWs(i);
    refreshObsView(i);
    taskPanelSync(i);

    const row = jointContrib[i];
    contribChart.data.datasets[0].data = Array.from(row);
    contribChart.update('none');

    frameTable.innerHTML = names.map((n, j) =>
      `<tr><td>${n}</td><td>${f.current[j].toFixed(2)}</td><td>${f.next_gt[j].toFixed(2)}</td><td>${f.next_pred[j].toFixed(2)}</td><td>${f.err[j].toFixed(2)}</td></tr>`
    ).join('');
  }

  // ---- Advanced C / D (local-only features; not pushed) ----
  function pauseJump(i) {
    playing = false;
    document.getElementById('btnPlay').textContent = t('eval.btnPlay');
    document.getElementById('btnPlay').classList.remove('active');
    showFrame(i);
  }

  const taskPanel = setupTaskGPanel(DATA, tcp, world, pauseJump);
  taskPanelSync = taskPanel.sync;
  taskPanelSync(frameIdx);

  const unitCheck = validateUnitsAndActionMode(DATA);
  const provenance = extractProvenance(meta);
  refreshUnitHint(unitCheck);
  const provEl = document.getElementById('provHint');
  if (provEl) {
    provEl.textContent = [
      `dataset=${provenance.dataset_id || '—'}`,
      `policy=${provenance.policy || '—'}`,
      `ckpt=${provenance.ckpt || '—'}`,
      `obs=${provenance.obs_modality || '—'}`,
      `seed=${provenance.seed ?? '—'}`,
      `episode=${provenance.episode_id || '—'}`,
      `task=${provenance.task || '—'}`,
      `src=${DATA.__data_path || provenance.source || '—'}`,
    ].join(' · ');
  }

  const fails = classifyFailureFrames(tcp, { epMm: Math.max(12, thrEp * 2), eRDeg: Math.max(12, thrEr * 2) });
  const failList = document.getElementById('failClassList');
  if (failList) {
    failList.innerHTML = fails.slice(0, 24).map((f) =>
      `<li data-frame="${f.i}" class="${f.reasons.includes('large_ep') ? 'bad' : 'warn'}">`
      + `t=${f.i} · e_p ${f.ep_mm.toFixed(1)} · e_R ${f.eR_deg.toFixed(1)} · ${f.reasons.join('+')}`
      + `</li>`
    ).join('') || `<li class="hint">${t('eval.dyn.noFailThresh')}</li>`;
    failList.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-frame]');
      if (li) pauseJump(Number(li.dataset.frame));
    });
  }

  const qPredSeries = DATA.frames.map((f) => f.next_pred);
  const probeQ = DATA.frames[0].next_pred.slice();
  const fkPos = (qDeg) => {
    setPose(world.armGT, qDeg);
    const { pos } = getTcpPose(world.armGT);
    // getTcpPose reads scaled matrixWorld; convert to meters for singularity / gates
    const inv = MODEL_SCALE !== 1 ? 1 / MODEL_SCALE : 1;
    return { x: pos.x * inv, y: pos.y * inv, z: pos.z * inv };
  };
  const colCfg = ACTIVE_ROBOT?.collision || {};
  const LINK_SAMPLE = (colCfg.links && colCfg.links.length)
    ? colCfg.links
    : ['base', 'shoulder', 'upper_arm', 'lower_arm', 'wrist', 'gripper'];
  const stride = Math.max(1, Math.ceil(DATA.frames.length / 60));
  const linkSeries = [];
  const hullSeries = [];
  const invScale = MODEL_SCALE !== 1 ? 1 / MODEL_SCALE : 1;
  for (let i = 0; i < DATA.frames.length; i += stride) {
    setPose(world.armPred, DATA.frames[i].next_pred);
    world.armPred.updateMatrixWorld(true);
    const clouds = sampleCollisionClouds(world.armPred, THREE, {
      links: LINK_SAMPLE,
      maxPointsPerLink: colCfg.max_points_per_link || 28,
      invScale,
    });
    hullSeries.push(clouds);
    if (clouds.length) clouds._frame = i;
    // legacy center samples (fallback / UI)
    const links = clouds.map((c) => {
      const pts = c.points;
      let sx = 0; let sy = 0; let sz = 0;
      for (const p of pts) { sx += p.x; sy += p.y; sz += p.z; }
      const n = Math.max(1, pts.length);
      return { name: c.name, pos: { x: sx / n, y: sy / n, z: sz / n } };
    });
    linkSeries.push(links);
    if (links.length) links._frame = i;
  }
  const safety = buildSafetyReport({
    qPredSeries,
    names,
    meta,
    fps: meta.fps || 30,
    fkPos,
    linkSeries,
    hullSeries,
    collisionCfg: colCfg,
    robotProfile: ACTIVE_ROBOT,
    stride,
    analyzeHullCollisions,
  });
  // restore poses for current frame later via showFrame(0)
  setPose(world.armGT, probeQ);

  // rewrite collision frame indices from subsampled → real
  const mapHit = (hits) => hits.map((h) => {
    const series = hullSeries.length ? hullSeries : linkSeries;
    const real = (series[h.i] && series[h.i]._frame != null)
      ? series[h.i]._frame
      : h.i * stride;
    return { ...h, i: real };
  });
  safety.collision.table_hits = mapHit(safety.collision.table_hits || []);
  safety.collision.self_hits = mapHit(safety.collision.self_hits || []);

  rebuildSafetyPanel(safety, stride);
  const sList = document.getElementById('safetyList');
  if (sList) {
    sList.addEventListener('click', (e) => {
      const li = e.target.closest('li[data-frame]');
      if (li) pauseJump(Number(li.dataset.frame));
    });
  }
  const colHint = document.getElementById('collisionHint');
  if (colHint) {
    const th = safety.collision.table_hits[0];
    const sh = safety.collision.self_hits[0];
    const method = safety.collision.method || 'hull';
    colHint.textContent =
      `${t('eval.collisionDetect')}(${method}) stride=${stride} · ${t('eval.collisionTable')} ${safety.collision.n_table}`
      + (th ? t('eval.dyn.collisionExample', { t: th.i, link: th.link, z: th.z.toFixed(3) }) : '')
      + ` · ${t('eval.collisionSelf')} ${safety.collision.n_self}`
      + (sh ? t('eval.dyn.selfCollisionExample', { t: sh.i, a: sh.a, b: sh.b, dist: sh.dist_mm.toFixed(1) }) : '')
      + t('eval.dyn.collisionSample');
  }

  // enrich export provenance into gates summary path already uses meta

  slider.addEventListener('input', () => {
    playing = false;
    document.getElementById('btnPlay').textContent = t('eval.btnPlay');
    document.getElementById('btnPlay').classList.remove('active');
    showFrame(Number(slider.value));
  });
  document.getElementById('btnPlay').addEventListener('click', () => {
    playing = !playing;
    const b = document.getElementById('btnPlay');
    b.textContent = playing ? t('eval.btnPause') : t('eval.btnPlay');
    b.classList.toggle('active', playing);
  });
  document.getElementById('btnReset').addEventListener('click', () => {
    playing = false;
    document.getElementById('btnPlay').textContent = t('eval.btnPlay');
    document.getElementById('btnPlay').classList.remove('active');
    showFrame(0);
  });

  // ---- Recording (canvas → WebM) ----
  const btnRecStart = document.getElementById('btnRecStart');
  const btnRecStop = document.getElementById('btnRecStop');
  const btnRecSave = document.getElementById('btnRecSave');
  const recStatus = document.getElementById('recStatus');
  const recPill = document.getElementById('recPill');
  const recTimerEl = document.getElementById('recTimer');

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = (el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  function setPlaying(on) {
    playing = !!on;
    const b = document.getElementById('btnPlay');
    b.textContent = playing ? t('eval.btnPause') : t('eval.btnPlay');
    b.classList.toggle('active', playing);
  }

  function stepFrame(delta) {
    setPlaying(false);
    const n = meta.n_frames;
    const next = Math.max(0, Math.min(n - 1, frameIdx + delta));
    showFrame(next);
  }

  // 快捷键：空格播放/暂停；←/→ 切帧；R/T/S 录制；Home 重置
  window.addEventListener('keydown', (e) => {
    if (isTypingTarget(e.target)) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;

    if (e.code === 'Space' || e.key === ' ') {
      e.preventDefault();
      document.getElementById('btnPlay').click();
      return;
    }
    if (e.code === 'ArrowLeft' || e.key === 'ArrowLeft') {
      e.preventDefault();
      stepFrame(-1);
      return;
    }
    if (e.code === 'ArrowRight' || e.key === 'ArrowRight') {
      e.preventDefault();
      stepFrame(1);
      return;
    }
    if (e.code === 'Home' || e.key === 'Home') {
      e.preventDefault();
      document.getElementById('btnReset').click();
      return;
    }
    const key = (e.key || '').toLowerCase();
    if (key === 'r' && !e.shiftKey) {
      e.preventDefault();
      if (!btnRecStart.disabled) btnRecStart.click();
      return;
    }
    if (key === 't') {
      e.preventDefault();
      if (!btnRecStop.disabled) btnRecStop.click();
      return;
    }
    if (key === 's') {
      e.preventDefault();
      if (!btnRecSave.disabled) btnRecSave.click();
    }
  });

  let mediaRecorder = null;
  let recChunks = [];
  let recBlob = null;
  let recStartedAt = 0;
  let recTimerId = null;

  function setRecUI(state) {
    // state: idle | recording | ready
    btnRecStart.disabled = state === 'recording';
    btnRecStop.disabled = state !== 'recording';
    btnRecSave.disabled = state !== 'ready';
    btnRecStart.classList.toggle('recording', state === 'recording');
    btnRecStop.classList.toggle('recording', state === 'recording');
    recPill.classList.toggle('on', state === 'recording');
    recStatus.classList.toggle('hot', state === 'recording');
  }

  btnRecStart.addEventListener('click', () => {
    if (!window.MediaRecorder) {
      recStatus.textContent = t('eval.dyn.recUnsupported');
      return;
    }
    const mime = pickMimeType();
    if (!mime) {
      recStatus.textContent = t('eval.dyn.recNoWebm');
      return;
    }
    try {
      const stream = world.canvas.captureStream(30);
      recChunks = [];
      recBlob = null;
      mediaRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recChunks.push(e.data);
      };
      mediaRecorder.onstop = () => {
        recBlob = new Blob(recChunks, { type: mime.split(';')[0] });
        stream.getTracks().forEach((t) => t.stop());
        if (recTimerId) { clearInterval(recTimerId); recTimerId = null; }
        const sec = ((performance.now() - recStartedAt) / 1000).toFixed(1);
        const mb = (recBlob.size / (1024 * 1024)).toFixed(2);
        recStatus.textContent = t('eval.dyn.recStopped', { sec, mb });
        setRecUI('ready');
      };
      mediaRecorder.start(200);
      recStartedAt = performance.now();
      recTimerEl.textContent = '00:00';
      recTimerId = setInterval(() => {
        recTimerEl.textContent = formatMMSS(performance.now() - recStartedAt);
      }, 250);
      recStatus.textContent = t('eval.dyn.recRecording');
      setRecUI('recording');
    } catch (e) {
      console.error(e);
      recStatus.textContent = t('eval.dyn.recFail', { msg: e.message });
    }
  });

  btnRecStop.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  });

  btnRecSave.addEventListener('click', () => {
    if (!recBlob) return;
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = URL.createObjectURL(recBlob);
    a.download = `embody_model_eval_${stamp}.webm`;
    a.click();
    URL.revokeObjectURL(a.href);
    recStatus.textContent = t('eval.dyn.recSaved', { name: a.download });
  });


  EVAL_LOCALE_STATE = {
    meta,
    robotCfg,
    tcp,
    thrEp,
    thrEr,
    passEp,
    passEr,
    passBoth,
    gates,
    safety: typeof safety !== 'undefined' ? safety : null,
    stride: typeof stride !== 'undefined' ? stride : 1,
    guard,
    mismatch,
    unitCheck,
    taskAnalysis: taskPanel.analysis,
  };

  setRecUI('idle');
  applyVisibility();
  showFrame(0);

  const speedSlider = document.getElementById('speedSlider');
  const speedLabel = document.getElementById('speedLabel');
  let speedMul = Number(speedSlider.value);
  function refreshSpeedLabel() {
    speedMul = Number(speedSlider.value);
    const fps = meta.fps * speedMul;
    speedLabel.textContent = `${speedMul.toFixed(2)}× (${fps.toFixed(1)} fps)`;
  }
  speedSlider.addEventListener('input', refreshSpeedLabel);
  refreshSpeedLabel();

  let last = performance.now();
  function loop(now) {
    const frameMs = 1000 / Math.max(0.05, meta.fps * speedMul);
    if (playing && now - last >= frameMs) {
      last = now;
      showFrame((frameIdx + 1) % meta.n_frames);
    }
    world.render();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
} catch (err) {
  document.getElementById('subtitle').textContent = t('eval.loadFail', { msg: err.message });
  failLoader(evalLoader, t('eval.dyn.failLoadTitle'), err.message);
  const fill = document.getElementById('loadBarFill');
  if (fill) fill.style.background = 'linear-gradient(90deg, #7f1d1d, #f87171)';
  console.error(err);
}

}
