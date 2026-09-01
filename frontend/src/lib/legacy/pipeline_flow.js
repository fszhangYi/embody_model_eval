/**
 * ComfyUI-inspired node canvas for ACT / SAM2Grasp / π0.5 dataflow demos.
 * Self-contained (no external graph lib) — wires on <canvas>, nodes as DOM.
 */

import { t } from '../../i18n/runtime';

function nodeFieldKey(graphKey, nodeId, field) {
  const m = String(graphKey || '').match(/^(.+)_(train|infer)$/);
  if (!m) return '';
  return `pipeline.node.${m[1]}.${m[2]}.${nodeId}.${field}`;
}

function localizedNodeField(graphKey, node, field) {
  const key = nodeFieldKey(graphKey, node.id, field);
  if (!key) return node[field] || '';
  const text = t(key);
  return text !== key ? text : (node[field] || '');
}

const KIND_COLORS = {
  data: '#3b82f6',
  vision: '#a855f7',
  model: '#f59e0b',
  loss: '#ef4444',
  robot: '#22c55e',
  cache: '#14b8a6',
  ctrl: '#64748b',
};

/** @typedef {{ id: string, title: string, kind: string, x: number, y: number, inputs?: string[], outputs?: string[], detail?: string, file?: string }} FlowNode */
/** @typedef {{ from: string, fromPort?: string, to: string, toPort?: string, label?: string }} FlowEdge */

/** Pipeline families shown in the dropdown. */
export const PIPELINES = [
  {
    id: 'sam2grasp',
    label: 'SAM2Grasp',
    desc: '冻结 SAM2 特征 + 确定性 ACT 头（默认 L2）',
  },
  {
    id: 'act',
    label: '纯 ACT (CVAE)',
    desc: 'ResNet 视觉骨干 + CVAE ACT（L1+KL）',
  },
  {
    id: 'pi05',
    label: 'π0.5 (VLA)',
    desc: 'PaliGemma 条件 + Action Expert · flow matching',
  },
];

export function graphKey(pipelineId, mode) {
  return `${pipelineId}_${mode}`;
}

const SAM2_TRAIN = {
  id: 'sam2grasp_train',
  label: 'SAM2Grasp · 训练',
  blurb: '冻结 SAM2 离线抽特征 → 只训 ACT 头（chunk L2）',
  nodes: /** @type {FlowNode[]} */ ([
    {
      id: 'raw', title: '演示 / Episode', kind: 'data', x: 40, y: 80,
      outputs: ['RGB', 'bbox', 'qpos', 'action'],
      detail: '原始示教：相机帧、目标框、关节/末端状态与专家动作。',
      file: 'convert_episodes.py',
    },
    {
      id: 'sam2', title: 'SAM2（冻结）', kind: 'vision', x: 320, y: 40,
      inputs: ['RGB', 'bbox'], outputs: ['F_t'],
      detail: '提示驱动感知：bbox 引导冻结 SAM2，输出物体中心特征图。',
      file: 'sam2_features.py / extract_sam2_features.py',
    },
    {
      id: 'cache', title: '特征缓存 F_t', kind: 'cache', x: 600, y: 40,
      inputs: ['F_t'], outputs: ['F_t'],
      detail: '离线缓存 [B,256,64,64]，训练不再跑 SAM2 前向。',
      file: 'HDF5 obs/sam2_feat',
    },
    {
      id: 'ds', title: 'SAM2EpisodicDataset', kind: 'data', x: 600, y: 260,
      inputs: ['F_t', 'qpos', 'action'], outputs: ['batch'],
      detail: '归一化 qpos/action，pad 到 chunk_size，产出训练 batch。',
      file: 'dataset.py',
    },
    {
      id: 'act', title: 'ACTSAM2 Head', kind: 'model', x: 900, y: 140,
      inputs: ['batch'], outputs: ['chunk'],
      detail: 'SpatialPool → Transformer Enc/Dec → action_head；输出 [B,K,action_dim]。',
      file: 'detr/models/act_sam2.py',
    },
    {
      id: 'loss', title: 'L2 Loss', kind: 'loss', x: 1180, y: 140,
      inputs: ['chunk', 'action'], outputs: ['grad'],
      detail: '对非 pad 位置的动作 chunk 做 L2（默认确定性头，非 CVAE）。',
      file: 'policy.py · ACTSAM2Policy',
    },
    {
      id: 'opt', title: 'AdamW / ckpt', kind: 'ctrl', x: 1460, y: 140,
      inputs: ['grad'], outputs: ['weights'],
      detail: '只更新 ACT 头参数；写出 policy_best.ckpt + policy_config。',
      file: 'train.py',
    },
    {
      id: 'qpos_t', title: '本体感觉 qpos', kind: 'robot', x: 320, y: 280,
      outputs: ['qpos'],
      detail: 'Proprio Prop_t，维数通常 7（含夹爪）。',
      file: 'dataset 字段 qpos',
    },
    {
      id: 'act_gt', title: '专家动作 chunk', kind: 'robot', x: 320, y: 420,
      outputs: ['action'],
      detail: '未来 K 步动作标签（joint / cartesian / SE(3) 相对等）。',
      file: 'convert_episodes.py',
    },
  ]),
  edges: /** @type {FlowEdge[]} */ ([
    { from: 'raw', fromPort: 'RGB', to: 'sam2', toPort: 'RGB', label: 'I_t' },
    { from: 'raw', fromPort: 'bbox', to: 'sam2', toPort: 'bbox', label: 'prompt' },
    { from: 'sam2', fromPort: 'F_t', to: 'cache', toPort: 'F_t' },
    { from: 'cache', fromPort: 'F_t', to: 'ds', toPort: 'F_t' },
    { from: 'qpos_t', fromPort: 'qpos', to: 'ds', toPort: 'qpos' },
    { from: 'act_gt', fromPort: 'action', to: 'ds', toPort: 'action' },
    { from: 'raw', fromPort: 'qpos', to: 'qpos_t', toPort: 'qpos' },
    { from: 'raw', fromPort: 'action', to: 'act_gt', toPort: 'action' },
    { from: 'ds', fromPort: 'batch', to: 'act', toPort: 'batch' },
    { from: 'act', fromPort: 'chunk', to: 'loss', toPort: 'chunk', label: 'pred' },
    { from: 'act_gt', fromPort: 'action', to: 'loss', toPort: 'action', label: 'GT' },
    { from: 'loss', fromPort: 'grad', to: 'opt', toPort: 'grad' },
  ]),
};

const SAM2_INFER = {
  id: 'sam2grasp_infer',
  label: 'SAM2Grasp · 推理',
  blurb: '在线 SAM2 特征 + ACT chunk → 缓冲回放 / 下发控制',
  nodes: /** @type {FlowNode[]} */ ([
    {
      id: 'cam', title: '相机 RGB', kind: 'data', x: 40, y: 120, outputs: ['RGB'],
      detail: '实时观测 I_t。', file: 'serve 客户端上报',
    },
    {
      id: 'bbox', title: '目标 bbox', kind: 'data', x: 40, y: 280, outputs: ['bbox'],
      detail: '点击 / 追踪得到的提示框，引导 SAM2。', file: 'serve 协议',
    },
    {
      id: 'sam2s', title: 'SAM2 Streaming', kind: 'vision', x: 320, y: 160,
      inputs: ['RGB', 'bbox'], outputs: ['F_t'],
      detail: '在线提取与训练同维的 F_t。', file: 'SAM2StreamingFeatureExtractor',
    },
    {
      id: 'prop', title: '机器人状态', kind: 'robot', x: 320, y: 360, outputs: ['qpos'],
      detail: '当前 Prop_t / qpos。', file: 'robot_state',
    },
    {
      id: 'ckpt', title: 'policy ckpt', kind: 'cache', x: 600, y: 40, outputs: ['weights'],
      detail: '训练得到的 ACT 头权重。', file: 'policy_best.ckpt',
    },
    {
      id: 'policy', title: 'ACTSAM2Policy', kind: 'model', x: 600, y: 200,
      inputs: ['F_t', 'qpos', 'weights'], outputs: ['chunk'],
      detail: '推理得到未来 K 步动作块 A_t。', file: 'policy.py / serve.py',
    },
    {
      id: 'buf', title: 'ClientState 缓冲', kind: 'ctrl', x: 900, y: 200,
      inputs: ['chunk'], outputs: ['cmd'],
      detail: '默认 chunk_replay；可选 temporal_agg 时序集成。', file: 'serve.py · ClientState',
    },
    {
      id: 'ctrl', title: '底层控制器', kind: 'robot', x: 1180, y: 200,
      inputs: ['cmd'], outputs: ['exec'],
      detail: '下发关节 / 末端指令到真机或仿真。', file: 'robot runtime',
    },
    {
      id: 'eval', title: 'Embody 评测页', kind: 'data', x: 1460, y: 200,
      inputs: ['exec'], outputs: [],
      detail: '落盘 episode 后可在本仓库 index/hub 回放与打分。', file: 'embody_model_eval',
    },
  ]),
  edges: /** @type {FlowEdge[]} */ ([
    { from: 'cam', fromPort: 'RGB', to: 'sam2s', toPort: 'RGB' },
    { from: 'bbox', fromPort: 'bbox', to: 'sam2s', toPort: 'bbox' },
    { from: 'sam2s', fromPort: 'F_t', to: 'policy', toPort: 'F_t' },
    { from: 'prop', fromPort: 'qpos', to: 'policy', toPort: 'qpos' },
    { from: 'ckpt', fromPort: 'weights', to: 'policy', toPort: 'weights' },
    { from: 'policy', fromPort: 'chunk', to: 'buf', toPort: 'chunk', label: 'A_t' },
    { from: 'buf', fromPort: 'cmd', to: 'ctrl', toPort: 'cmd' },
    { from: 'ctrl', fromPort: 'exec', to: 'eval', toPort: 'exec', label: 'log' },
  ]),
};

const ACT_TRAIN = {
  id: 'act_train',
  label: '纯 ACT · 训练',
  blurb: 'RGB→ResNet18 骨干 + CVAE 动作编码器 → Transformer chunk（L1+KL）',
  nodes: /** @type {FlowNode[]} */ ([
    {
      id: 'raw', title: 'Episode HDF5', kind: 'data', x: 40, y: 160,
      outputs: ['RGB', 'qpos', 'action'],
      detail: '示教数据：多相机 RGB、qpos、未来动作序列（无 SAM2 / bbox 条件）。',
      file: 'convert_episodes.py / dataset.py',
    },
    {
      id: 'norm', title: 'ImageNet Normalize', kind: 'vision', x: 300, y: 40,
      inputs: ['RGB'], outputs: ['img'],
      detail: 'mean/std 标准化后送入视觉骨干（ACTPolicy）。',
      file: 'policy.py · ACTPolicy',
    },
    {
      id: 'backbone', title: 'ResNet18 Backbone', kind: 'vision', x: 560, y: 40,
      inputs: ['img'], outputs: ['feat'],
      detail: '可训练视觉骨干，输出空间特征图（约 H/32 × W/32 tokens）。',
      file: 'detr/models/backbone.py',
    },
    {
      id: 'proj', title: 'input_proj', kind: 'model', x: 820, y: 40,
      inputs: ['feat'], outputs: ['vis'],
      detail: '1×1 Conv 将 backbone 通道投到 hidden_dim。',
      file: 'detr/models/detr_vae.py',
    },
    {
      id: 'cvae', title: 'CVAE Action Encoder', kind: 'model', x: 560, y: 280,
      inputs: ['qpos', 'action'], outputs: ['z'],
      detail: '训练时：CLS+qpos+a_seq → μ/logvar → 采样 latent z（dim≈32）。',
      file: 'DETRVAE encoder',
    },
    {
      id: 'tf', title: 'Transformer Enc/Dec', kind: 'model', x: 820, y: 200,
      inputs: ['vis', 'qpos', 'z'], outputs: ['hs'],
      detail: '视觉 tokens + proprio + latent 前缀；decoder queries = chunk_size。',
      file: 'detr/models/transformer.py',
    },
    {
      id: 'head', title: 'action_head', kind: 'model', x: 1080, y: 200,
      inputs: ['hs'], outputs: ['chunk'],
      detail: 'Linear → [B, K, action_dim]；另有 is_pad_head。',
      file: 'detr_vae.py · action_head',
    },
    {
      id: 'loss', title: 'L1 + KL', kind: 'loss', x: 1340, y: 200,
      inputs: ['chunk', 'action', 'z'], outputs: ['grad'],
      detail: 'mask 后 L1 重构 + kl_weight × KL(μ,σ)；对应原始 ACT。',
      file: 'policy.py · ACTPolicy',
    },
    {
      id: 'opt', title: 'AdamW / ckpt', kind: 'ctrl', x: 1600, y: 200,
      inputs: ['grad'], outputs: ['weights'],
      detail: '端到端更新 backbone + CVAE + Transformer。',
      file: 'train.py（非 --sam2 路径）',
    },
    {
      id: 'qpos', title: 'qpos', kind: 'robot', x: 300, y: 280, outputs: ['qpos'],
      detail: '本体感觉，与 action_dim 对齐（常为 7）。', file: 'dataset',
    },
    {
      id: 'agt', title: '专家 action seq', kind: 'robot', x: 300, y: 420, outputs: ['action'],
      detail: 'chunk 长度 = num_queries；训练时进入 CVAE 编码器。', file: 'dataset',
    },
  ]),
  edges: /** @type {FlowEdge[]} */ ([
    { from: 'raw', fromPort: 'RGB', to: 'norm', toPort: 'RGB', label: 'I_t' },
    { from: 'norm', fromPort: 'img', to: 'backbone', toPort: 'img' },
    { from: 'backbone', fromPort: 'feat', to: 'proj', toPort: 'feat' },
    { from: 'proj', fromPort: 'vis', to: 'tf', toPort: 'vis' },
    { from: 'raw', fromPort: 'qpos', to: 'qpos', toPort: 'qpos' },
    { from: 'raw', fromPort: 'action', to: 'agt', toPort: 'action' },
    { from: 'qpos', fromPort: 'qpos', to: 'cvae', toPort: 'qpos' },
    { from: 'agt', fromPort: 'action', to: 'cvae', toPort: 'action' },
    { from: 'cvae', fromPort: 'z', to: 'tf', toPort: 'z', label: 'latent' },
    { from: 'qpos', fromPort: 'qpos', to: 'tf', toPort: 'qpos' },
    { from: 'tf', fromPort: 'hs', to: 'head', toPort: 'hs' },
    { from: 'head', fromPort: 'chunk', to: 'loss', toPort: 'chunk', label: 'pred' },
    { from: 'agt', fromPort: 'action', to: 'loss', toPort: 'action', label: 'GT' },
    { from: 'cvae', fromPort: 'z', to: 'loss', toPort: 'z', label: 'KL' },
    { from: 'loss', fromPort: 'grad', to: 'opt', toPort: 'grad' },
  ]),
};

const ACT_INFER = {
  id: 'act_infer',
  label: '纯 ACT · 推理',
  blurb: '无动作 GT：CVAE 侧用先验采样 z，ResNet+Transformer 输出 chunk',
  nodes: /** @type {FlowNode[]} */ ([
    {
      id: 'cam', title: '相机 RGB', kind: 'data', x: 40, y: 120, outputs: ['RGB'],
      detail: '实时图像（可多相机堆叠）。', file: 'serve 客户端',
    },
    {
      id: 'prop', title: '机器人 qpos', kind: 'robot', x: 40, y: 300, outputs: ['qpos'],
      detail: '当前本体感觉。', file: 'robot_state',
    },
    {
      id: 'norm', title: 'Normalize', kind: 'vision', x: 300, y: 80,
      inputs: ['RGB'], outputs: ['img'],
      detail: '与训练相同的 ImageNet 归一化。', file: 'ACTPolicy',
    },
    {
      id: 'bb', title: 'ResNet18', kind: 'vision', x: 540, y: 80,
      inputs: ['img'], outputs: ['feat'],
      detail: '加载 ckpt 中的视觉骨干。', file: 'backbone.py',
    },
    {
      id: 'prior', title: 'CVAE 先验 z', kind: 'model', x: 540, y: 280,
      inputs: ['qpos'], outputs: ['z'],
      detail: '推理无 action GT：从标准正态 / 先验取 latent（不作 action 编码）。',
      file: 'detr_vae.py infer path',
    },
    {
      id: 'ckpt', title: 'ACT ckpt', kind: 'cache', x: 540, y: 420, outputs: ['weights'],
      detail: '含 backbone + transformer + heads。', file: 'policy_best.ckpt',
    },
    {
      id: 'policy', title: 'ACTPolicy / DETRVAE', kind: 'model', x: 820, y: 180,
      inputs: ['feat', 'qpos', 'z', 'weights'], outputs: ['chunk'],
      detail: '前向得到 a_hat chunk。', file: 'policy.py · ACTPolicy',
    },
    {
      id: 'buf', title: '动作缓冲', kind: 'ctrl', x: 1100, y: 180,
      inputs: ['chunk'], outputs: ['cmd'],
      detail: 'chunk 回放或 temporal aggregation。', file: 'serve.py',
    },
    {
      id: 'ctrl', title: '底层控制', kind: 'robot', x: 1360, y: 180,
      inputs: ['cmd'], outputs: ['exec'],
      detail: '下发到真机 / 仿真。', file: 'robot runtime',
    },
    {
      id: 'eval', title: 'Embody 评测', kind: 'data', x: 1600, y: 180,
      inputs: ['exec'], outputs: [],
      detail: '日志转 episode 后回放打分。', file: 'embody_model_eval',
    },
  ]),
  edges: /** @type {FlowEdge[]} */ ([
    { from: 'cam', fromPort: 'RGB', to: 'norm', toPort: 'RGB' },
    { from: 'norm', fromPort: 'img', to: 'bb', toPort: 'img' },
    { from: 'bb', fromPort: 'feat', to: 'policy', toPort: 'feat' },
    { from: 'prop', fromPort: 'qpos', to: 'prior', toPort: 'qpos' },
    { from: 'prop', fromPort: 'qpos', to: 'policy', toPort: 'qpos' },
    { from: 'prior', fromPort: 'z', to: 'policy', toPort: 'z', label: 'prior' },
    { from: 'ckpt', fromPort: 'weights', to: 'policy', toPort: 'weights' },
    { from: 'policy', fromPort: 'chunk', to: 'buf', toPort: 'chunk', label: 'A_t' },
    { from: 'buf', fromPort: 'cmd', to: 'ctrl', toPort: 'cmd' },
    { from: 'ctrl', fromPort: 'exec', to: 'eval', toPort: 'exec' },
  ]),
};

const PI05_TRAIN = {
  id: 'pi05_train',
  label: 'π0.5 · 训练',
  blurb: '多视角 + 语言 + 状态 → PaliGemma 条件 · Action Expert · flow matching',
  nodes: /** @type {FlowNode[]} */ ([
    {
      id: 'raw', title: 'LeRobot Episode', kind: 'data', x: 40, y: 100,
      outputs: ['RGB', 'state', 'action', 'prompt'],
      detail: '示教：多相机 RGB、本体状态、专家动作 chunk、任务文本（repo_id / camera_mapping）。',
      file: 'lerobot dataset / convert',
    },
    {
      id: 'norm', title: 'norm_stats', kind: 'cache', x: 320, y: 40,
      inputs: ['state', 'action'], outputs: ['state_n', 'action_n'],
      detail: '数据集 mean/std；无 stats 时尺度与预训练先验不对齐。换数据必须重算。',
      file: 'artifacts/assets · compute_norm_stats',
    },
    {
      id: 'ds', title: 'Train batch', kind: 'data', x: 600, y: 100,
      inputs: ['RGB', 'state_n', 'action_n', 'prompt'], outputs: ['batch'],
      detail: '归一化后的观测 / 动作 / 文本组成 batch；action_dim 常 pad 到 Expert 宽度。',
      file: 'pi05_jax_sft · data loader',
    },
    {
      id: 'siglip', title: 'SigLIP 视觉', kind: 'vision', x: 880, y: 40,
      inputs: ['batch'], outputs: ['vtok'],
      detail: '各视角 RGB → 视觉 token；视角数与分辨率决定序列长度与显存。',
      file: 'PaliGemma / SigLIP',
    },
    {
      id: 'lang', title: '文本 + 状态 token', kind: 'data', x: 880, y: 220,
      inputs: ['batch'], outputs: ['ltok'],
      detail: '任务 prompt（及可选离散状态）tokenize；受 max_token_len 约束。',
      file: 'tokenizer',
    },
    {
      id: 'vlm', title: 'PaliGemma 条件', kind: 'model', x: 1140, y: 100,
      inputs: ['vtok', 'ltok'], outputs: ['cond'],
      detail: '视觉与语言 token 交叉注意力，得到当前情境表征（条件侧）。',
      file: 'paligemma_variant=gemma_2b',
    },
    {
      id: 'noise', title: '噪声 ε', kind: 'model', x: 1140, y: 300,
      inputs: ['action_n'], outputs: ['path'],
      detail: '在动作空间构造噪声 ↔ 示教动作的插值路径（flow matching）。',
      file: 'flow matching schedule',
    },
    {
      id: 'expert', title: 'Action Expert', kind: 'model', x: 1400, y: 140,
      inputs: ['cond', 'path'], outputs: ['vel'],
      detail: 'Gemma≈300M，与 VLM 联合注意力；预测速度场（或等价目标）→ action_horizon chunk。',
      file: 'action_expert_variant=gemma_300m',
    },
    {
      id: 'loss', title: 'Flow matching loss', kind: 'loss', x: 1660, y: 140,
      inputs: ['vel', 'path'], outputs: ['grad'],
      detail: '条件 flow：拟合示教动作流形；勿随意改成一步 MSE（与预训练目标不一致）。',
      file: 'train_pytorch · flow loss',
    },
    {
      id: 'opt', title: 'FSDP / ckpt', kind: 'ctrl', x: 1920, y: 140,
      inputs: ['grad'], outputs: ['weights'],
      detail: '全参或 LoRA；按 exp_name/step 写出 checkpoint，供推理与分析页。',
      file: 'artifacts/checkpoints',
    },
  ]),
  edges: /** @type {FlowEdge[]} */ ([
    { from: 'raw', fromPort: 'state', to: 'norm', toPort: 'state' },
    { from: 'raw', fromPort: 'action', to: 'norm', toPort: 'action' },
    { from: 'raw', fromPort: 'RGB', to: 'ds', toPort: 'RGB', label: 'views' },
    { from: 'raw', fromPort: 'prompt', to: 'ds', toPort: 'prompt' },
    { from: 'norm', fromPort: 'state_n', to: 'ds', toPort: 'state_n' },
    { from: 'norm', fromPort: 'action_n', to: 'ds', toPort: 'action_n' },
    { from: 'ds', fromPort: 'batch', to: 'siglip', toPort: 'batch' },
    { from: 'ds', fromPort: 'batch', to: 'lang', toPort: 'batch' },
    { from: 'siglip', fromPort: 'vtok', to: 'vlm', toPort: 'vtok' },
    { from: 'lang', fromPort: 'ltok', to: 'vlm', toPort: 'ltok' },
    { from: 'norm', fromPort: 'action_n', to: 'noise', toPort: 'action_n', label: 'GT' },
    { from: 'vlm', fromPort: 'cond', to: 'expert', toPort: 'cond' },
    { from: 'noise', fromPort: 'path', to: 'expert', toPort: 'path' },
    { from: 'expert', fromPort: 'vel', to: 'loss', toPort: 'vel', label: 'pred' },
    { from: 'noise', fromPort: 'path', to: 'loss', toPort: 'path' },
    { from: 'loss', fromPort: 'grad', to: 'opt', toPort: 'grad' },
  ]),
};

const PI05_INFER = {
  id: 'pi05_infer',
  label: 'π0.5 · 推理',
  blurb: 'JPEG + state + prompt → VLM 条件 · flow 采样动作 chunk → 真机 / 评测',
  nodes: /** @type {FlowNode[]} */ ([
    {
      id: 'cam', title: '多相机 RGB', kind: 'data', x: 40, y: 80, outputs: ['RGB'],
      detail: '真机 / raw：多视角 JPEG（与训练 camera_mapping 对齐）。',
      file: 'serve / infer_from_raw',
    },
    {
      id: 'prop', title: '机器人状态', kind: 'robot', x: 40, y: 240, outputs: ['state'],
      detail: '本体感觉（TCP / qpos 等）；须用训练同套 norm_stats。',
      file: 'robot_state',
    },
    {
      id: 'prompt', title: '任务 prompt', kind: 'data', x: 40, y: 400, outputs: ['prompt'],
      detail: '自然语言任务描述；与训练 tokenizer / max_token_len 一致。',
      file: 'client request',
    },
    {
      id: 'ckpt', title: 'π0.5 ckpt', kind: 'cache', x: 320, y: 320,
      outputs: ['weights', 'stats'],
      detail: 'checkpoint + assets/*/norm_stats.json（asset_id / repo_id 须匹配）。',
      file: 'artifacts/checkpoints · assets',
    },
    {
      id: 'policy', title: 'VLM + Expert', kind: 'model', x: 560, y: 140,
      inputs: ['RGB', 'state', 'prompt', 'weights', 'stats'], outputs: ['cond'],
      detail: '加载权重与 norm；SigLIP+语言条件 → 情境表征（无示教 GT）。',
      file: 'serve.py / evaluate',
    },
    {
      id: 'sample', title: 'Flow 采样', kind: 'model', x: 840, y: 140,
      inputs: ['cond'], outputs: ['chunk'],
      detail: '从噪声积分到动作 chunk（action_horizon）；再反归一化到控制维。',
      file: 'flow sampler',
    },
    {
      id: 'buf', title: '动作缓冲', kind: 'ctrl', x: 1100, y: 140,
      inputs: ['chunk'], outputs: ['cmd'],
      detail: 'chunk 回放或 temporal aggregation 平滑。',
      file: 'serve runtime',
    },
    {
      id: 'ctrl', title: '底层控制', kind: 'robot', x: 1360, y: 140,
      inputs: ['cmd'], outputs: ['exec'],
      detail: '下发真机 / 仿真执行器。',
      file: 'robot runtime',
    },
    {
      id: 'eval', title: 'Embody 评测', kind: 'data', x: 1620, y: 140,
      inputs: ['exec'], outputs: [],
      detail: '离线 infer JSON → 轨迹对照 / Hub 汇总。',
      file: 'embody_model_eval',
    },
  ]),
  edges: /** @type {FlowEdge[]} */ ([
    { from: 'cam', fromPort: 'RGB', to: 'policy', toPort: 'RGB' },
    { from: 'prop', fromPort: 'state', to: 'policy', toPort: 'state' },
    { from: 'prompt', fromPort: 'prompt', to: 'policy', toPort: 'prompt' },
    { from: 'ckpt', fromPort: 'weights', to: 'policy', toPort: 'weights' },
    { from: 'ckpt', fromPort: 'stats', to: 'policy', toPort: 'stats', label: 'norm' },
    { from: 'policy', fromPort: 'cond', to: 'sample', toPort: 'cond' },
    { from: 'sample', fromPort: 'chunk', to: 'buf', toPort: 'chunk', label: 'A_t' },
    { from: 'buf', fromPort: 'cmd', to: 'ctrl', toPort: 'cmd' },
    { from: 'ctrl', fromPort: 'exec', to: 'eval', toPort: 'exec' },
  ]),
};

export const GRAPHS = {
  sam2grasp_train: SAM2_TRAIN,
  sam2grasp_infer: SAM2_INFER,
  act_train: ACT_TRAIN,
  act_infer: ACT_INFER,
  pi05_train: PI05_TRAIN,
  pi05_infer: PI05_INFER,
  // backwards-compatible aliases
  train: SAM2_TRAIN,
  infer: SAM2_INFER,
};

export const CANONICAL_GRAPH_KEYS = [
  'sam2grasp_train',
  'sam2grasp_infer',
  'act_train',
  'act_infer',
  'pi05_train',
  'pi05_infer',
];

const KIND_OPTIONS = Object.keys(KIND_COLORS);

function syncAliases() {
  if (GRAPHS.sam2grasp_train) GRAPHS.train = GRAPHS.sam2grasp_train;
  if (GRAPHS.sam2grasp_infer) GRAPHS.infer = GRAPHS.sam2grasp_infer;
}

/** Apply server-saved graph overrides onto in-memory GRAPHS. */
export function applyServerGraphs(graphs) {
  if (!graphs || typeof graphs !== 'object') return 0;
  let n = 0;
  for (const [k, g] of Object.entries(graphs)) {
    if (!g || typeof g !== 'object' || !Array.isArray(g.nodes)) continue;
    GRAPHS[k] = structuredClone(g);
    n += 1;
  }
  syncAliases();
  return n;
}

/** Snapshot of editable graphs for PUT /api/pipeline/graphs. */
export function exportCanonicalGraphs() {
  const out = {};
  for (const k of CANONICAL_GRAPH_KEYS) {
    if (GRAPHS[k]) out[k] = structuredClone(GRAPHS[k]);
  }
  return out;
}

function portKey(side, name) {
  return `${side}:${name}`;
}

export class FlowCanvas {
  /**
   * @param {{ stage: HTMLElement, canvas: HTMLCanvasElement, detailEl: HTMLElement, titleEl?: HTMLElement, blurbEl?: HTMLElement }} els
   */
  constructor(els) {
    this.stage = els.stage;
    this.canvas = els.canvas;
    this.ctx = els.canvas.getContext('2d');
    this.detailEl = els.detailEl;
    this.titleEl = els.titleEl || null;
    this.blurbEl = els.blurbEl || null;

    this.graph = null;
    this.graphKey = null;
    this.nodeEls = new Map();
    this.selectedId = null;
    this.editingId = null;
    this.dirty = false;
    this.onDirtyChange = typeof els.onDirtyChange === 'function' ? els.onDirtyChange : null;
    this.animT = 0;
    this.animating = false;
    this.raf = 0;

    this.view = { x: 40, y: 40, scale: 1 };
    this._drag = null; // { type:'node'|'pan', id?, ox, oy, vx, vy }
    this._moved = false;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.stage);

    this.stage.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointermove', (e) => this.onPointerMove(e));
    window.addEventListener('pointerup', () => this.onPointerUp());
    this.stage.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
  }

  markDirty(on = true) {
    this.dirty = !!on;
    this.onDirtyChange?.(this.dirty);
  }

  commitGraphToStore() {
    if (!this.graphKey || !this.graph) return;
    GRAPHS[this.graphKey] = structuredClone(this.graph);
    syncAliases();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  setGraph(key) {
    const g = GRAPHS[key];
    if (!g) return;
    this.graphKey = key;
    this.graph = structuredClone(g);
    this.editingId = null;
    if (this.titleEl) {
      const labelKey = `pipeline.graph.${key}.label`;
      const labelText = t(labelKey);
      const title = labelText !== labelKey ? labelText : g.label;
      this.titleEl.textContent = title;
      this.titleEl.setAttribute('title', title);
    }
    if (this.blurbEl) {
      const blurbKey = `pipeline.graph.${key}.blurb`;
      const blurb = t(blurbKey);
      const blurbText = blurb && blurb !== blurbKey ? blurb : (g.blurb || '');
      this.blurbEl.textContent = blurbText;
      this.blurbEl.setAttribute('title', blurbText);
    }
    this.selectedId = null;
    this.renderNodes();
    this.resize();
    this.showDetail(null);
  }

  renderNodes() {
    for (const el of this.nodeEls.values()) el.remove();
    this.nodeEls.clear();
    if (!this.graph) return;

    for (const n of this.graph.nodes) {
      const title = localizedNodeField(this.graphKey, n, 'title');
      const el = document.createElement('div');
      el.className = 'flow-node';
      el.dataset.id = n.id;
      el.style.setProperty('--kind', KIND_COLORS[n.kind] || '#64748b');
      el.innerHTML = `
        <div class="flow-node-title">${escapeHtml(title)}</div>
        <div class="flow-node-kind">${escapeHtml(n.kind)}</div>
        <div class="flow-ports">
          <div class="flow-ports-in">
            ${(n.inputs || []).map((p) => `
              <div class="flow-port" data-port="${escapeHtml(portKey('in', p))}">
                <i class="dot"></i><span>${escapeHtml(p)}</span>
              </div>`).join('')}
          </div>
          <div class="flow-ports-out">
            ${(n.outputs || []).map((p) => `
              <div class="flow-port out" data-port="${escapeHtml(portKey('out', p))}">
                <span>${escapeHtml(p)}</span><i class="dot"></i>
              </div>`).join('')}
          </div>
        </div>
        ${n.file ? `<div class="flow-node-file">${escapeHtml(n.file)}</div>` : ''}
      `;
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        this.selectNode(n.id);
        this._moved = false;
        const rect = el.getBoundingClientRect();
        this._drag = {
          type: 'node',
          id: n.id,
          ox: e.clientX - rect.left,
          oy: e.clientY - rect.top,
          sx: e.clientX,
          sy: e.clientY,
        };
        el.setPointerCapture?.(e.pointerId);
      });
      el.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._drag = null;
        this.openNodeEditor(n.id);
      });
      this.stage.appendChild(el);
      this.nodeEls.set(n.id, el);
    }
    this.syncNodePositions();
  }

  syncNodePositions() {
    if (!this.graph) return;
    const { x: vx, y: vy, scale: s } = this.view;
    for (const n of this.graph.nodes) {
      const el = this.nodeEls.get(n.id);
      if (!el) continue;
      el.style.transform = `translate(${vx + n.x * s}px, ${vy + n.y * s}px) scale(${s})`;
      el.style.transformOrigin = '0 0';
      el.classList.toggle('selected', n.id === this.selectedId);
    }
    this.draw();
  }

  selectNode(id) {
    this.selectedId = id;
    const n = this.graph?.nodes.find((x) => x.id === id) || null;
    if (this.editingId && this.editingId !== id) {
      this.editingId = null;
    }
    if (this.editingId === id) this.openNodeEditor(id);
    else this.showDetail(n);
    this.syncNodePositions();
  }

  showDetail(n) {
    if (!this.detailEl) return;
    if (!n) {
      this.detailEl.innerHTML = `<p class="muted">${escapeHtml(t('pipeline.nodeEmpty'))}</p>`;
      return;
    }
    const title = localizedNodeField(this.graphKey, n, 'title');
    const detail = localizedNodeField(this.graphKey, n, 'detail');
    const io = t('pipeline.nodeInputs', {
      inputs: (n.inputs || []).join(', ') || '—',
      outputs: (n.outputs || []).join(', ') || '—',
    });
    this.detailEl.innerHTML = `
      <div class="detail-kicker" style="color:${KIND_COLORS[n.kind] || KIND_COLORS[n.kind] || '#94a3b8'}">${escapeHtml(n.kind)}</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(detail || '')}</p>
      ${n.file ? `<p class="mono">↪ ${escapeHtml(n.file)}</p>` : ''}
      <p class="muted">${escapeHtml(io)}</p>
      <p class="muted" style="margin-top:10px">${escapeHtml(t('pipeline.nodeEditHint'))}</p>
    `;
  }

  openNodeEditor(id) {
    const n = this.nodeById(id);
    if (!n || !this.detailEl) return;
    this.editingId = id;
    this.selectedId = id;
    this.syncNodePositions();
    const kindOpts = KIND_OPTIONS.map((k) =>
      `<option value="${escapeHtml(k)}"${k === n.kind ? ' selected' : ''}>${escapeHtml(k)}</option>`
    ).join('');
    this.detailEl.innerHTML = `
      <form class="node-edit-form" id="nodeEditForm">
        <div class="detail-kicker" style="color:${KIND_COLORS[n.kind] || '#94a3b8'}">编辑节点 · ${escapeHtml(n.id)}</div>
        <label>标题
          <input name="title" type="text" value="${escapeAttr(n.title || '')}" autocomplete="off" />
        </label>
        <label>类型
          <select name="kind">${kindOpts}</select>
        </label>
        <label>说明
          <textarea name="detail" rows="5">${escapeHtml(n.detail || '')}</textarea>
        </label>
        <label>文件 / 路径
          <input name="file" type="text" value="${escapeAttr(n.file || '')}" autocomplete="off" />
        </label>
        <div class="node-edit-actions">
          <button type="submit">应用</button>
          <button type="button" id="nodeEditCancel">取消</button>
        </div>
      </form>
    `;
    const form = this.detailEl.querySelector('#nodeEditForm');
    form?.querySelector('input[name="title"]')?.focus();
    form?.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      this.applyNodeEdit(id, {
        title: String(fd.get('title') || '').trim() || n.title,
        kind: String(fd.get('kind') || n.kind),
        detail: String(fd.get('detail') || ''),
        file: String(fd.get('file') || '').trim(),
      });
    });
    this.detailEl.querySelector('#nodeEditCancel')?.addEventListener('click', () => {
      this.editingId = null;
      this.showDetail(this.nodeById(id));
    });
  }

  applyNodeEdit(id, patch) {
    const n = this.nodeById(id);
    if (!n) return;
    n.title = patch.title;
    n.kind = KIND_COLORS[patch.kind] ? patch.kind : n.kind;
    n.detail = patch.detail;
    n.file = patch.file;
    this.editingId = null;
    this.commitGraphToStore();
    this.markDirty(true);
    this.renderNodes();
    this.selectNode(id);
  }

  portAnchor(nodeId, side, portName) {
    const el = this.nodeEls.get(nodeId);
    if (!el) return null;
    const key = portKey(side === 'out' ? 'out' : 'in', portName);
    const safe = (window.CSS && CSS.escape) ? CSS.escape(key) : key.replace(/"/g, '\\"');
    const port = el.querySelector(`[data-port="${safe}"] .dot`)
      || el.querySelector(`[data-port="${safe}"]`);
    const stageRect = this.stage.getBoundingClientRect();
    if (port) {
      const r = port.getBoundingClientRect();
      return {
        x: r.left + r.width / 2 - stageRect.left,
        y: r.top + r.height / 2 - stageRect.top,
      };
    }
    const r = el.getBoundingClientRect();
    return {
      x: (side === 'out' ? r.right : r.left) - stageRect.left,
      y: r.top + r.height / 2 - stageRect.top,
    };
  }

  draw() {
    const ctx = this.ctx;
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    ctx.clearRect(0, 0, w, h);
    this.drawGrid(w, h);
    if (!this.graph) return;

    for (const e of this.graph.edges) {
      const a = this.portAnchor(e.from, 'out', e.fromPort || (this.nodeById(e.from)?.outputs || [])[0] || 'out');
      const b = this.portAnchor(e.to, 'in', e.toPort || (this.nodeById(e.to)?.inputs || [])[0] || 'in');
      if (!a || !b) continue;
      const fromNode = this.nodeById(e.from);
      const color = KIND_COLORS[fromNode?.kind] || '#64748b';
      this.drawWire(a.x, a.y, b.x, b.y, color, e.label);
    }
  }

  drawGrid(w, h) {
    const ctx = this.ctx;
    const step = 24 * this.view.scale;
    const ox = ((this.view.x % step) + step) % step;
    const oy = ((this.view.y % step) + step) % step;
    ctx.strokeStyle = 'rgba(58,77,102,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = ox; x < w; x += step) {
      ctx.moveTo(x, 0); ctx.lineTo(x, h);
    }
    for (let y = oy; y < h; y += step) {
      ctx.moveTo(0, y); ctx.lineTo(w, y);
    }
    ctx.stroke();
  }

  drawWire(x1, y1, x2, y2, color, label) {
    const ctx = this.ctx;
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.45);
    const c1x = x1 + dx;
    const c2x = x2 - dx;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(c1x, y1, c2x, y2, x2, y2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (this.animating) {
      const t = (this.animT + hashLabel(label || color) * 0.17) % 1;
      const p = bezierPoint(x1, y1, c1x, y1, c2x, y2, x2, y2, t);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#e7ecf3';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (label) {
      const mid = bezierPoint(x1, y1, c1x, y1, c2x, y2, x2, y2, 0.5);
      ctx.font = '11px "IBM Plex Sans", sans-serif';
      ctx.fillStyle = 'rgba(18,26,38,0.85)';
      const tw = ctx.measureText(label).width + 10;
      ctx.fillRect(mid.x - tw / 2, mid.y - 18, tw, 16);
      ctx.fillStyle = '#c5d0e0';
      ctx.textAlign = 'center';
      ctx.fillText(label, mid.x, mid.y - 6);
      ctx.textAlign = 'left';
    }
  }

  nodeById(id) {
    return this.graph?.nodes.find((n) => n.id === id) || null;
  }

  onPointerDown(e) {
    if (e.target !== this.stage && e.target !== this.canvas) return;
    if (e.button !== 0) return;
    this._drag = { type: 'pan', ox: e.clientX, oy: e.clientY, vx: this.view.x, vy: this.view.y };
    this.selectNode(null);
  }

  onPointerMove(e) {
    if (!this._drag) return;
    if (this._drag.type === 'pan') {
      this.view.x = this._drag.vx + (e.clientX - this._drag.ox);
      this.view.y = this._drag.vy + (e.clientY - this._drag.oy);
      this.syncNodePositions();
      return;
    }
    if (this._drag.type === 'node') {
      if (this._drag.sx != null) {
        const dx = e.clientX - this._drag.sx;
        const dy = e.clientY - this._drag.sy;
        if (dx * dx + dy * dy > 16) this._moved = true;
      }
      const n = this.nodeById(this._drag.id);
      const el = this.nodeEls.get(this._drag.id);
      if (!n || !el) return;
      const stageRect = this.stage.getBoundingClientRect();
      const s = this.view.scale;
      n.x = (e.clientX - stageRect.left - this.view.x - this._drag.ox) / s;
      n.y = (e.clientY - stageRect.top - this.view.y - this._drag.oy) / s;
      this.syncNodePositions();
    }
  }

  onPointerUp() {
    if (this._drag?.type === 'node' && this._moved) {
      this.commitGraphToStore();
      this.markDirty(true);
    }
    this._drag = null;
    this._moved = false;
  }

  onWheel(e) {
    e.preventDefault();
    const old = this.view.scale;
    const next = Math.min(1.6, Math.max(0.55, old * (e.deltaY > 0 ? 0.92 : 1.08)));
    const rect = this.stage.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // zoom around cursor
    this.view.x = mx - ((mx - this.view.x) / old) * next;
    this.view.y = my - ((my - this.view.y) / old) * next;
    this.view.scale = next;
    this.syncNodePositions();
  }

  startAnim() {
    this.animating = true;
    const tick = () => {
      if (!this.animating) return;
      this.animT = (this.animT + 0.012) % 1;
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(tick);
  }

  stopAnim() {
    this.animating = false;
    cancelAnimationFrame(this.raf);
    this.draw();
  }

  /**
   * Composite stage (wires canvas + DOM nodes) onto an offscreen canvas stream for MediaRecorder.
   * @param {number} [fps=30]
   * @returns {{ stream: MediaStream, stop: () => void }}
   */
  beginCapture(fps = 30) {
    this.endCapture();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let cssW = Math.max(1, this.stage.clientWidth);
    let cssH = Math.max(1, this.stage.clientHeight);
    const cap = document.createElement('canvas');
    cap.width = Math.max(1, Math.floor(cssW * dpr));
    cap.height = Math.max(1, Math.floor(cssH * dpr));
    const ctx = cap.getContext('2d');
    this._cap = { canvas: cap, ctx, dpr, cssW, cssH, raf: 0, active: true };

    const paint = () => {
      const c = this._cap;
      if (!c || !c.active) return;
      const w = Math.max(1, this.stage.clientWidth);
      const h = Math.max(1, this.stage.clientHeight);
      if (w !== c.cssW || h !== c.cssH) {
        c.cssW = w;
        c.cssH = h;
        c.dpr = Math.min(window.devicePixelRatio || 1, 2);
        c.canvas.width = Math.max(1, Math.floor(w * c.dpr));
        c.canvas.height = Math.max(1, Math.floor(h * c.dpr));
      }
      this.paintComposite(c.ctx, c.cssW, c.cssH, c.dpr);
      c.raf = requestAnimationFrame(paint);
    };
    paint();

    const stream = cap.captureStream(fps);
    return {
      stream,
      stop: () => this.endCapture(),
    };
  }

  endCapture() {
    if (!this._cap) return;
    this._cap.active = false;
    cancelAnimationFrame(this._cap.raf);
    this._cap = null;
  }

  /**
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} cssW
   * @param {number} cssH
   * @param {number} dpr
   */
  paintComposite(ctx, cssW, cssH, dpr) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b1018';
    ctx.fillRect(0, 0, cssW, cssH);
    // Wires + grid (already CSS-pixel sized via ctx transform on flow canvas)
    try {
      ctx.drawImage(this.canvas, 0, 0, cssW, cssH);
    } catch (_) { /* tainted / zero size */ }

    const stageRect = this.stage.getBoundingClientRect();
    for (const el of this.nodeEls.values()) {
      const r = el.getBoundingClientRect();
      const x = r.left - stageRect.left;
      const y = r.top - stageRect.top;
      if (r.width < 2 || r.height < 2) continue;
      if (x + r.width < 0 || y + r.height < 0 || x > cssW || y > cssH) continue;
      this._paintNodeCard(ctx, el, x, y, r.width, r.height);
    }
  }

  /**
   * Approximate DOM node card for the recording composite.
   * @param {CanvasRenderingContext2D} ctx
   * @param {HTMLElement} el
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   */
  _paintNodeCard(ctx, el, x, y, w, h) {
    const kind = (getComputedStyle(el).getPropertyValue('--kind') || '#64748b').trim() || '#64748b';
    const selected = el.classList.contains('selected');
    const title = el.querySelector('.flow-node-title')?.textContent?.trim() || '';
    const kindLabel = el.querySelector('.flow-node-kind')?.textContent?.trim() || '';
    const file = el.querySelector('.flow-node-file')?.textContent?.trim() || '';
    const radius = Math.min(10, w * 0.06);

    ctx.save();
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, radius);
    else {
      ctx.rect(x, y, w, h);
    }
    ctx.fillStyle = 'rgba(18, 26, 38, 0.96)';
    ctx.fill();
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? '#3dd6c6' : 'rgba(58, 77, 102, 0.85)';
    ctx.stroke();

    // Title bar
    const titleH = Math.max(28, Math.min(36, h * 0.28));
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') {
      ctx.roundRect(x, y, w, titleH, [radius, radius, 0, 0]);
    } else {
      ctx.rect(x, y, w, titleH);
    }
    ctx.fillStyle = 'rgba(12, 18, 28, 0.65)';
    ctx.fill();
    ctx.fillStyle = kind;
    ctx.fillRect(x, y, 3, titleH);

    ctx.fillStyle = '#e7ecf3';
    ctx.font = `600 ${Math.max(11, Math.min(13, w * 0.062))}px "IBM Plex Sans", "Segoe UI", sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(truncateCanvasText(ctx, title, w - 52), x + 10, y + titleH / 2);

    if (kindLabel) {
      ctx.fillStyle = kind;
      ctx.font = `600 ${Math.max(9, Math.min(10, w * 0.05))}px "IBM Plex Sans", "Segoe UI", sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText(kindLabel.toUpperCase(), x + w - 8, y + titleH / 2);
      ctx.textAlign = 'left';
    }

    // Ports
    const inPorts = [...el.querySelectorAll('.flow-ports-in .flow-port span')].map((s) => s.textContent.trim());
    const outPorts = [...el.querySelectorAll('.flow-ports-out .flow-port span')].map((s) => s.textContent.trim());
    const portSize = Math.max(9, Math.min(11, w * 0.05));
    ctx.font = `${portSize}px "IBM Plex Sans", "Segoe UI", sans-serif`;
    ctx.fillStyle = '#8b9bb4';
    ctx.textBaseline = 'middle';
    let py = y + titleH + 14;
    const rows = Math.max(inPorts.length, outPorts.length, 1);
    for (let i = 0; i < rows; i++) {
      if (inPorts[i]) {
        ctx.beginPath();
        ctx.fillStyle = kind;
        ctx.arc(x + 12, py, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8b9bb4';
        ctx.textAlign = 'left';
        ctx.fillText(truncateCanvasText(ctx, inPorts[i], w * 0.4), x + 20, py);
      }
      if (outPorts[i]) {
        ctx.beginPath();
        ctx.fillStyle = kind;
        ctx.arc(x + w - 12, py, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#8b9bb4';
        ctx.textAlign = 'right';
        ctx.fillText(truncateCanvasText(ctx, outPorts[i], w * 0.4), x + w - 20, py);
      }
      py += portSize + 8;
    }
    ctx.textAlign = 'left';

    if (file) {
      ctx.fillStyle = '#7f8fa8';
      ctx.font = `${Math.max(9, Math.min(10, w * 0.048))}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;
      ctx.fillText(truncateCanvasText(ctx, file, w - 20), x + 10, y + h - 12);
    }
    ctx.restore();
  }

  fitView() {
    if (!this.graph?.nodes.length) return;
    let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
    for (const n of this.graph.nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + 220);
      maxY = Math.max(maxY, n.y + 140);
    }
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    const s = Math.min(1.1, Math.max(0.55, Math.min((w - 80) / (maxX - minX), (h - 80) / (maxY - minY))));
    this.view.scale = s;
    this.view.x = (w - (maxX - minX) * s) / 2 - minX * s;
    this.view.y = (h - (maxY - minY) * s) / 2 - minY * s;
    this.syncNodePositions();
  }
}

function bezierPoint(x1, y1, c1x, c1y, c2x, c2y, x2, y2, t) {
  const u = 1 - t;
  return {
    x: u * u * u * x1 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x2,
    y: u * u * u * y1 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y2,
  };
}

function hashLabel(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
  return escapeHtml(s).replace(/'/g, '&#39;');
}

/** @param {CanvasRenderingContext2D} ctx */
function truncateCanvasText(ctx, text, maxW) {
  const s = String(text || '');
  if (ctx.measureText(s).width <= maxW) return s;
  let out = s;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxW) {
    out = out.slice(0, -1);
  }
  return `${out}…`;
}
