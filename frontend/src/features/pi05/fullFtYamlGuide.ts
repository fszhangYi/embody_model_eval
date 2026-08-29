/** Parameter glossary for Tl full-FT YAML (e.g. pi05_tonglu0630_full_ft_two_view.yaml). */

export type YamlParam = {
  key: string
  example?: string
  zh: string
  en: string
}

export type YamlSection = {
  id: string
  titleZh: string
  titleEn: string
  introZh: string
  introEn: string
  params: YamlParam[]
}

export const FULL_FT_YAML_FILE = 'configs/pi05_tonglu0630_full_ft_two_view.yaml'

export const FULL_FT_YAML_SECTIONS: YamlSection[] = [
  {
    id: 'project',
    titleZh: 'project · 实验命名',
    titleEn: 'project · run naming',
    introZh: '决定 checkpoint 落盘路径：artifacts/checkpoints/<name>/<exp_name>/<step>/。与 wandb / serve 挂载约定一致。',
    introEn: 'Controls checkpoint layout: artifacts/checkpoints/<name>/<exp_name>/<step>/. Must match wandb / serve conventions.',
    params: [
      {
        key: 'name',
        example: 'pi05_tonglu0630_mlu',
        zh: '项目目录名（第一层）。同一数据配方下可共用，用于归类多次实验。',
        en: 'Top-level project folder name. Shared across related runs of the same data recipe.',
      },
      {
        key: 'exp_name',
        example: 'mlu_full_ft_two_view',
        zh: '实验名（第二层）。serve.sh 默认挂载的就是这个名字；改名后推理脚本也要跟着改。',
        en: 'Experiment folder name. serve.sh defaults to this; rename requires updating serve scripts.',
      },
      {
        key: 'project_name',
        example: 'pi05-tonglu0630',
        zh: '对外追踪用的项目名（如 wandb project）；不影响本地路径。',
        en: 'Remote tracking project name (e.g. wandb); does not change local paths.',
      },
    ],
  },
  {
    id: 'data',
    titleZh: 'data · 数据与相机',
    titleEn: 'data · dataset & cameras',
    introZh: '描述 Tonglu 原始数据 → LeRobot 转换与训练读取约定。raw/annotation 必须在训练机真实存在，或改成你的路径。',
    introEn: 'Tonglu raw → LeRobot conversion and train-time read contract. raw/annotation must exist on the train host or be rewritten.',
    params: [
      {
        key: 'repo_id',
        example: 'company/tonglu0630_two_view_terminated',
        zh: 'LeRobot / HF 风格数据集 ID。转换后目录名与训练 DataLoader 的 repo 标识。',
        en: 'LeRobot/HF-style dataset id. Names the converted dataset and train DataLoader repo.',
      },
      {
        key: 'dataset_format',
        example: 'tonglu_annotation',
        zh: '原始数据解析器类型。tonglu_annotation 走 Tonglu 标注 JSON + raw 帧布局，不可写成 ACT HDF5。',
        en: 'Raw parser type. tonglu_annotation expects Tonglu annotation JSON + raw frames — not ACT HDF5.',
      },
      {
        key: 'raw_root',
        example: '/root/autodl-tmp/datasets/tonglu0630/raw_data',
        zh: '原始视频/图像根目录。prepare_dataset 从此读帧；路径错则转换空跑或失败。',
        en: 'Root of raw video/images. prepare_dataset reads frames here; wrong path → empty or failed convert.',
      },
      {
        key: 'annotation_root',
        example: '/root/autodl-tmp/datasets/tonglu0630/annotation',
        zh: '标注 JSON 根目录（episode 有效区间、任务元数据等）。与 raw_root 成对。',
        en: 'Annotation JSON root (valid ranges, task meta). Paired with raw_root.',
      },
      {
        key: 'hf_lerobot_home',
        example: './data/lerobot',
        zh: 'LeRobot 输出根（相对 π0.5 根）。训练从此读 parquet/图像；须落在数据盘，勿放系统盘。',
        en: 'LeRobot output root (relative to π0.5 root). Train reads parquet/images here; keep on data disk.',
      },
      {
        key: 'robot_type',
        example: 'custom',
        zh: '机器人类型标签，写入数据集 meta；自定义机型一般用 custom。',
        en: 'Robot type tag written into dataset meta; custom for non-stock robots.',
      },
      {
        key: 'fps',
        example: '15',
        zh: '数据采集帧率。影响时间戳与评测时序；须与真实采集一致。',
        en: 'Capture FPS. Affects timestamps and eval timing; must match real collection.',
      },
      {
        key: 'chest_image_prefix',
        example: 'null',
        zh: '胸腔相机文件前缀。two_view 配方为 null（不用第三路胸腔相机）。',
        en: 'Chest camera filename prefix. null in two_view recipe (no third chest cam).',
      },
      {
        key: 'top_image_prefix',
        example: 'rgb_top',
        zh: '俯视相机文件名前缀，对应观测键。',
        en: 'Top camera filename prefix → observation key.',
      },
      {
        key: 'wrist_image_prefix',
        example: 'rgb_wrist_2',
        zh: '腕部相机文件名前缀。two_view = top + wrist。',
        en: 'Wrist camera filename prefix. two_view = top + wrist.',
      },
      {
        key: 'task_name',
        example: 'pick the workpiece…',
        zh: '默认任务自然语言描述；prompt_from_task=false 时作固定 prompt。',
        en: 'Default task NL string; used as fixed prompt when prompt_from_task is false.',
      },
      {
        key: 'task_prompt_template',
        example: '…{row} row, {column} column…',
        zh: '带占位符的 prompt 模板。从标注填 row/column 等，生成每 episode 指令。',
        en: 'Prompt template with placeholders (row/column, …) filled from annotations per episode.',
      },
      {
        key: 'prompt_from_task',
        example: 'true',
        zh: 'true：用模板/任务字段生成语言条件；false：退回固定 task_name。',
        en: 'true: build language conditioning from template/task fields; false: fixed task_name.',
      },
      {
        key: 'normalize_rx_to_2pi',
        example: 'true',
        zh: '是否把 rx 旋转角规范到 [0, 2π)。与 Tonglu 姿态约定对齐，乱改会导致动作分布偏移。',
        en: 'Normalize rx into [0, 2π). Matches Tonglu pose convention; changing shifts action distribution.',
      },
      {
        key: 'gripper_action_source',
        example: 'next_observation',
        zh: '夹爪动作从何处取：next_observation = 用下一帧观测中的夹爪态作监督（Tonglu 常用）。',
        en: 'Where gripper targets come from; next_observation uses next-frame gripper state (Tonglu common).',
      },
      {
        key: 'max_episodes',
        example: 'null',
        zh: '最多转换/训练的 episode 数。null = 全量；调试可设小数如 8。',
        en: 'Cap on episodes for convert/train. null = all; use a small int for debug.',
      },
    ],
  },
  {
    id: 'model',
    titleZh: 'model · 结构与动作头',
    titleEn: 'model · architecture',
    introZh: '全参配方关键：双 backbone 均为全参（非 LoRA）。variant 决定参数量与显存占用。',
    introEn: 'Full-FT key: dual full backbones (not LoRA). Variants set parameter count and VRAM.',
    params: [
      {
        key: 'action_horizon',
        example: '10',
        zh: '一次预测的动作 chunk 长度（步数）。与 embody chunk 评测、RTC 缓冲相关。',
        en: 'Predicted action chunk length (steps). Ties to embody chunk eval and RTC buffering.',
      },
      {
        key: 'max_token_len',
        example: '200',
        zh: '语言/离散 token 序列最大长度。过小截断指令，过大浪费显存。',
        en: 'Max language/discrete token length. Too small truncates prompts; too large wastes VRAM.',
      },
      {
        key: 'discrete_state_input',
        example: 'true',
        zh: '是否把状态离散化后喂给 PaliGemma。π0.5 默认 true，与基座权重假设一致。',
        en: 'Feed discretized state into PaliGemma. π0.5 default true; matches base weight assumptions.',
      },
      {
        key: 'paligemma_variant',
        example: 'gemma_2b',
        zh: '视觉语言模型骨干。全参配方默认 gemma_2b（非 *_lora）。',
        en: 'VLM backbone. Full-FT default is gemma_2b (not *_lora).',
      },
      {
        key: 'action_expert_variant',
        example: 'gemma_300m',
        zh: '动作专家网络。全参配方固定 gemma_300m（全参）。',
        en: 'Action expert net. Full-FT locks gemma_300m (full weights).',
      },
      {
        key: 'rtc_simulated_delay',
        example: 'null',
        zh: 'RTC 仿真延迟（步）。null = 关闭。serve_rtc / filter 配方才可能非空。',
        en: 'RTC simulated delay (steps). null = off. Non-null mainly for serve_rtc / filter recipes.',
      },
    ],
  },
  {
    id: 'training',
    titleZh: 'training · 优化与并行',
    titleEn: 'training · optim & parallelism',
    introZh: '全局 batch=256、fsdp_devices=8 是本配方默认值。单卡 32GB 建议改走 LoRA 冒烟线，而不是下调这两个参数。',
    introEn: 'Global batch 256 + fsdp_devices 8 are this recipe’s defaults. On 32GB, prefer the LoRA smoke path instead of shrinking these two.',
    params: [
      {
        key: 'seed',
        example: '42',
        zh: '随机种子（数据打乱、dropout 等）。复现实验时保持一致。',
        en: 'RNG seed (shuffle, dropout, …). Keep fixed for reproduce.',
      },
      {
        key: 'batch_size',
        example: '256',
        zh: '全局 batch（跨卡合计）。与 hww 对齐；缩小会改变有效学习率与收敛。',
        en: 'Global batch across GPUs. hww-aligned; shrinking changes effective LR / convergence.',
      },
      {
        key: 'fsdp_devices',
        example: '8',
        zh: 'FSDP 切分的 GPU 数。preflight 要求可见卡数 ≥ 该值。',
        en: 'GPU count for FSDP shard. Preflight requires visible GPUs ≥ this.',
      },
      {
        key: 'num_workers',
        example: '8',
        zh: 'DataLoader worker 数。过大占 CPU/内存，过小饿死 GPU。',
        en: 'DataLoader workers. Too many → CPU/RAM pressure; too few → GPU starve.',
      },
      {
        key: 'num_train_steps',
        example: '16000',
        zh: '总优化步数。two_view 默认 16000，与 serve.sh 保留 step 一致。',
        en: 'Total optim steps. two_view default 16000 matches serve.sh kept step.',
      },
      {
        key: 'log_interval',
        example: '100',
        zh: '每隔多少 step 打日志 / 上报指标。',
        en: 'Log / metric every N steps.',
      },
      {
        key: 'save_interval',
        example: '2000',
        zh: '每隔多少 step 写一次 checkpoint。',
        en: 'Checkpoint every N steps.',
      },
      {
        key: 'keep_period',
        example: '10000',
        zh: '长期保留周期：除最近若干外，按该周期保留历史 ckpt，避免盘满。',
        en: 'Long-term keep period for older ckpts (besides recent ones) to limit disk use.',
      },
      {
        key: 'peak_lr',
        example: '5.0e-5',
        zh: '学习率峰值（warmup 结束后）。',
        en: 'Peak learning rate after warmup.',
      },
      {
        key: 'decay_lr',
        example: '5.0e-5',
        zh: '衰减末端学习率。此处与 peak 相同表示近似恒定 LR。',
        en: 'End-of-schedule LR. Equal to peak ≈ constant LR.',
      },
      {
        key: 'warmup_steps',
        example: '500',
        zh: '线性 warmup 步数，从接近 0 升到 peak_lr。',
        en: 'Linear warmup steps from ~0 to peak_lr.',
      },
      {
        key: 'decay_steps',
        example: '20000',
        zh: 'LR 衰减时间轴长度。可大于 num_train_steps（衰减未跑完就停）。',
        en: 'LR decay horizon. May exceed num_train_steps (stop before full decay).',
      },
      {
        key: 'ema_decay',
        example: 'null',
        zh: 'EMA 权重衰减系数。null = 关闭 EMA。',
        en: 'EMA decay; null disables EMA.',
      },
      {
        key: 'clip_gradient_norm',
        example: '1.0',
        zh: '梯度裁剪阈值（全局范数）。抑制全参大模型爆炸。',
        en: 'Global grad-norm clip. Stabilizes full large-model FT.',
      },
      {
        key: 'wandb_enabled',
        example: 'false',
        zh: '是否启用 Weights & Biases。离线机保持 false。',
        en: 'Enable Weights & Biases. Keep false offline.',
      },
      {
        key: 'overwrite',
        example: 'false',
        zh: 'true 时允许覆盖已有同名 checkpoint 目录（危险）。',
        en: 'If true, may overwrite existing same-name checkpoint dirs (dangerous).',
      },
      {
        key: 'resume',
        example: 'false',
        zh: 'true 时从最近 checkpoint 续训；需目录内有可恢复状态。',
        en: 'Resume from latest checkpoint when true; needs restorable state on disk.',
      },
    ],
  },
  {
    id: 'paths',
    titleZh: 'paths · 产物路径',
    titleEn: 'paths · artifact paths',
    introZh: '相对路径均相对 π0.5 项目根。改 base 或 checkpoint 根后，分析页 / serve 也要指向同一树。',
    introEn: 'Relative paths are vs π0.5 project root. Changing base/ckpt roots must match analysis / serve.',
    params: [
      {
        key: 'assets_base_dir',
        example: './artifacts/assets',
        zh: 'norm_stats 等资产目录。compute_norm_stats 写入，训练读取。',
        en: 'Assets dir (norm_stats, …). Written by compute_norm_stats; read by train.',
      },
      {
        key: 'checkpoint_base_dir',
        example: './artifacts/checkpoints',
        zh: '训练 checkpoint 根。分析页扫描的就是这里的 project/exp/step。',
        en: 'Checkpoint root. Analysis page scans project/exp/step under this.',
      },
      {
        key: 'base_checkpoint_path',
        example: './checkpoints/pi05_base_pytorch',
        zh: 'PyTorch 预训练初始化目录，内必须有 model.safetensors。',
        en: 'PyTorch pretrained init dir; must contain model.safetensors.',
      },
      {
        key: 'eval_output_dir',
        example: './artifacts/eval',
        zh: '离线评测 / evaluate_checkpoint 输出目录。',
        en: 'Offline eval / evaluate_checkpoint output directory.',
      },
    ],
  },
]
