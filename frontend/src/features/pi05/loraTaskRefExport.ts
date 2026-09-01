/**
 * Build the π0.5 LoRA task workspace JSON described by ref.txt.
 * Only address (AUTODL_TMP) + taskName vary; tool roots are derived.
 *
 * Train / infer field keys match Pi05PipelinePage form keys (camelCase)
 * so「快速导入」can apply without a separate schema. Legacy snake_case
 * keys from older exports are accepted by {@link normalizeStepFields}.
 */

export type LoraTaskRefExport = {
  TASK_NAME: string
  AUTODL_TMP: string
  PI_LORA_TASK: string
  PI05_ROOT: string
  ACT_ROBOT_ROOT: string
  EMBODY_ROOT: string
  REPO_ID: string
  PROJECT_NAME: string
  EXP_NAME: string
  WANDB_PROJECT: string
  SUITE_ID: string
  SUITE_ID_CHUNK: string
  steps: LoraTaskRefStep[]
}

export type LoraTaskRefStep = {
  id: string
  step: string
  title: string
  fields: Record<string, string | number | boolean | null>
}

export type LoraStepParams = Record<string, string | number | boolean>

const PROJECT_NAME = 'pi05_lora'
const EXP_NAME = 'convert_lora'
const WANDB_PROJECT = 'pi05-lora'

/** Legacy export key → current form key (train-only conflicts handled in normalize). */
const FIELD_ALIASES: Record<string, string> = {
  name: 'projectName',
  exp_name: 'expName',
  project_name: 'wandbProject',
  repo_id: 'repoId',
  hf_lerobot_home: 'hfLerobotHome',
  action_horizon: 'actionHorizon',
  max_token_len: 'maxTokenLen',
  discrete_state_input: 'discreteStateInput',
  paligemma_variant: 'paligemmaVariant',
  action_expert_variant: 'actionExpertVariant',
  rtc_simulated_delay: 'rtcSimulatedDelay',
  batch_size: 'batchSize',
  fsdp_devices: 'fsdpDevices',
  num_workers: 'numWorkers',
  num_train_steps: 'numTrainSteps',
  log_interval: 'logInterval',
  save_interval: 'saveInterval',
  keep_period: 'keepPeriod',
  peak_lr: 'peakLr',
  decay_lr: 'decayLr',
  warmup_steps: 'warmupSteps',
  decay_steps: 'decaySteps',
  ema_decay: 'emaDecay',
  clip_gradient_norm: 'clipGradientNorm',
  wandb_enabled: 'wandbEnabled',
  assets_base_dir: 'assetsBaseDir',
  checkpoint_base_dir: 'checkpointBaseDir',
  base_checkpoint_path: 'baseCheckpointPath',
  eval_output_dir: 'evalOutputDir',
}

const TRAIN_ONLY_ALIASES: Record<string, string> = {
  overwrite: 'trainOverwrite',
  resume: 'trainResume',
}

/** Keys that live in train YAML `data:` but not on the train form. */
const TRAIN_YAML_DATA_KEYS = [
  'dataset_format',
  'raw_root',
  'annotation_root',
  'fps',
  'max_episodes',
  'chest_image_prefix',
  'top_image_prefix',
  'wrist_image_prefix',
  'task_name',
  'gripper_action_source',
  'normalize_rx_to_2pi',
  'prompt_from_task',
] as const

function joinPath(base: string, ...parts: string[]): string {
  const root = base.replace(/\/+$/, '')
  const rest = parts
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
  return rest ? `${root}/${rest}` : root
}

function sanitizeTaskName(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
  return cleaned || 'pi_lora_task'
}

function yamlScalar(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return 'null'
    if (Number.isInteger(v)) return String(v)
    // Prefer compact scientific for tiny lr values when clean.
    return String(v)
  }
  const s = String(v)
  if (s === '') return '""'
  if (/^[\w./:@+-]+$/.test(s)) return s
  return JSON.stringify(s)
}

/** Expand ref.txt into a JSON document for the given address + task name. */
export function buildLoraTaskRefJson(address: string, taskName: string): LoraTaskRefExport {
  const AUTODL_TMP = (address.trim() || '/root/autodl-tmp').replace(/\/+$/, '')
  const TASK_NAME = sanitizeTaskName(taskName)
  const PI_LORA_TASK = joinPath(AUTODL_TMP, TASK_NAME)
  const PI05_ROOT = joinPath(AUTODL_TMP, 'pi05')
  const ACT_ROBOT_ROOT = joinPath(AUTODL_TMP, 'act_robot')
  const EMBODY_ROOT = joinPath(AUTODL_TMP, 'embody_model_eval')
  const REPO_ID = `company/${TASK_NAME}`
  const SUITE_ID = TASK_NAME
  const SUITE_ID_CHUNK = `${TASK_NAME}_chunk`

  const steps: LoraTaskRefStep[] = [
    {
      id: 'quality',
      step: '1',
      title: '质量过滤',
      fields: {
        scriptPath: joinPath(ACT_ROBOT_ROOT, 'scripts/check_episode_quality.py'),
        inputDir: joinPath(PI_LORA_TASK, 'raw'),
        annotationDir: joinPath(PI_LORA_TASK, 'annotation'),
        writePassJson: joinPath(PI_LORA_TASK, 'quality_pass.json'),
        writeFailList: joinPath(PI_LORA_TASK, 'quality_fail.txt'),
        outputJson: joinPath(PI_LORA_TASK, 'quality_report.json'),
        zeroEps: 0.001,
        minPeak: 0.05,
        sentinelValue: 0.14651000499725342,
        sentinelMinRun: 20,
        valueTol: 1e-9,
        strict: false,
      },
    },
    {
      id: 'convert',
      step: '2',
      title: '转 LeRobot',
      fields: {
        scriptPath: joinPath(PI05_ROOT, 'scripts/prepare_dataset.sh'),
        inputDir: joinPath(PI_LORA_TASK, 'raw'),
        outputDir: joinPath(PI_LORA_TASK, 'lerobot'),
        annotationDir: joinPath(PI_LORA_TASK, 'annotation'),
        filterJson: joinPath(PI_LORA_TASK, 'quality_pass.json'),
        repoId: REPO_ID,
        datasetFormat: 'tonglu_annotation',
        cameraNames: 'chest top wrist_2',
        stride: 1,
        seed: 42,
        dryRun: false,
        resume: true,
        imageWriterThreads: 4,
        imageWriterProcesses: 2,
      },
    },
    {
      id: 'norm_stats',
      step: '3',
      title: '计算 norm_stats',
      fields: {
        scriptPath: joinPath(PI05_ROOT, 'scripts/compute_norm_stats.sh'),
        inputDir: joinPath(PI_LORA_TASK, 'lerobot'),
        repoId: REPO_ID,
        outputDir: joinPath(PI_LORA_TASK, 'artifacts/assets', PROJECT_NAME, REPO_ID),
        maxFrames: 0,
      },
    },
    {
      id: 'train',
      step: '4',
      title: '训练 π0.5（JAX LoRA）',
      fields: {
        scriptPath: joinPath(PI05_ROOT, 'scripts/train_8gpu.sh'),
        configPath: joinPath(PI_LORA_TASK, 'configs/pi05.yaml'),
        printOnly: false,
        projectName: PROJECT_NAME,
        expName: EXP_NAME,
        wandbProject: WANDB_PROJECT,
        repoId: REPO_ID,
        hfLerobotHome: joinPath(PI_LORA_TASK, 'lerobot'),
        actionHorizon: 10,
        maxTokenLen: 200,
        discreteStateInput: true,
        paligemmaVariant: 'gemma_2b_lora',
        actionExpertVariant: 'gemma_300m_lora',
        rtcSimulatedDelay: null,
        seed: 42,
        batchSize: 2,
        fsdpDevices: 1,
        numWorkers: 2,
        numTrainSteps: 10000,
        logInterval: 50,
        saveInterval: 2000,
        keepPeriod: 5000,
        peakLr: 0.0001,
        decayLr: 1e-5,
        warmupSteps: 200,
        decaySteps: 10000,
        emaDecay: null,
        clipGradientNorm: 1,
        wandbEnabled: false,
        trainOverwrite: true,
        trainResume: false,
        assetsBaseDir: joinPath(PI_LORA_TASK, 'artifacts/assets'),
        checkpointBaseDir: joinPath(PI_LORA_TASK, 'artifacts/checkpoints'),
        baseCheckpointPath: joinPath(PI05_ROOT, 'checkpoints/pi0.5_base/params'),
        evalOutputDir: joinPath(PI_LORA_TASK, 'artifacts/eval'),
        // YAML data: extras (not shown on train form; used by buildLoraTrainYamlText)
        dataset_format: 'tonglu_annotation',
        raw_root: joinPath(PI_LORA_TASK, 'raw'),
        annotation_root: joinPath(PI_LORA_TASK, 'annotation'),
        fps: 15,
        max_episodes: null,
        chest_image_prefix: 'rgb_chest',
        top_image_prefix: 'rgb_top',
        wrist_image_prefix: 'rgb_wrist_2',
        task_name: '',
        gripper_action_source: 'next_observation',
        normalize_rx_to_2pi: true,
        prompt_from_task: true,
      },
    },
    {
      id: 'infer_single',
      step: '5',
      title: '样本推理',
      fields: {
        scriptPath: joinPath(PI05_ROOT, 'src/pi05_jax_sft/infer_from_raw.py'),
        configPath: joinPath(PI_LORA_TASK, 'configs/pi05.yaml'),
        ckptDir: joinPath(PI_LORA_TASK, 'artifacts/checkpoints', PROJECT_NAME, EXP_NAME),
        rawDir: joinPath(PI_LORA_TASK, 'raw'),
        annotationDir: joinPath(PI_LORA_TASK, 'annotation'),
        inferDir: joinPath(PI_LORA_TASK, 'infer/lora'),
        episode: 1,
        checkpointStep: null,
        actionHorizon: 10,
        stride: 1,
        maxFrames: 0,
        taskPrompt: null,
      },
    },
    {
      id: 'embody',
      step: '6',
      title: '转 embody（chunk 第 0 步）',
      fields: {
        scriptPath: joinPath(ACT_ROBOT_ROOT, 'scripts/infer_to_embody_eval.py'),
        inferDir: joinPath(PI_LORA_TASK, 'infer/lora'),
        inferJson: null,
        rawDir: joinPath(PI_LORA_TASK, 'raw'),
        outputDir: joinPath(EMBODY_ROOT, 'data', SUITE_ID),
        suite: SUITE_ID,
        refreshIndex: false,
        fps: 15.0,
        embodyRoot: EMBODY_ROOT,
        tcpToolZM: 0.18,
        ikEnforceLimits: false,
      },
    },
    {
      id: 'embody_chunk',
      step: '6b',
      title: '转 embody（完整 chunk）',
      fields: {
        scriptPath: joinPath(ACT_ROBOT_ROOT, 'scripts/infer_to_embody_eval_chunk.py'),
        inferDir: joinPath(PI_LORA_TASK, 'infer/lora'),
        inferJson: null,
        rawDir: joinPath(PI_LORA_TASK, 'raw'),
        outputDir: joinPath(EMBODY_ROOT, 'data', SUITE_ID_CHUNK),
        suite: SUITE_ID_CHUNK,
        refreshIndex: false,
        fps: 15.0,
        embodyRoot: EMBODY_ROOT,
        tcpToolZM: 0.18,
        ikEnforceLimits: false,
      },
    },
  ]

  return {
    TASK_NAME,
    AUTODL_TMP,
    PI_LORA_TASK,
    PI05_ROOT,
    ACT_ROBOT_ROOT,
    EMBODY_ROOT,
    REPO_ID,
    PROJECT_NAME,
    EXP_NAME,
    WANDB_PROJECT,
    SUITE_ID,
    SUITE_ID_CHUNK,
    steps,
  }
}

function downloadBlob(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function downloadLoraTaskRefJson(doc: LoraTaskRefExport) {
  downloadBlob(`pi05_lora_${doc.TASK_NAME}.json`, `${JSON.stringify(doc, null, 2)}\n`, 'application/json;charset=utf-8')
}

/** Train config YAML for configPath (same shape as pi05_act_robot_smoke.yaml). */
export function buildLoraTrainYamlText(doc: LoraTaskRefExport): string {
  const f = doc.steps.find((s) => s.id === 'train')?.fields || {}
  const g = (camel: string, snake: string) =>
    f[camel] !== undefined ? f[camel] : f[snake]

  const lines: string[] = [
    '# ============================================================',
    `# pi0.5 LoRA — task ${doc.TASK_NAME}`,
    `# Generated from embody_model_eval LoRA task export`,
    '# ============================================================',
    '',
    'project:',
    `  name: ${yamlScalar(g('projectName', 'name') ?? doc.PROJECT_NAME)}`,
    `  exp_name: ${yamlScalar(g('expName', 'exp_name') ?? doc.EXP_NAME)}`,
    `  project_name: ${yamlScalar(g('wandbProject', 'project_name') ?? doc.WANDB_PROJECT)}`,
    '',
    'data:',
    `  repo_id: ${yamlScalar(g('repoId', 'repo_id') ?? doc.REPO_ID)}`,
    `  dataset_format: ${yamlScalar(f.dataset_format ?? 'tonglu_annotation')}`,
    `  raw_root: ${yamlScalar(f.raw_root ?? joinPath(doc.PI_LORA_TASK, 'raw'))}`,
    `  annotation_root: ${yamlScalar(f.annotation_root ?? joinPath(doc.PI_LORA_TASK, 'annotation'))}`,
    `  hf_lerobot_home: ${yamlScalar(g('hfLerobotHome', 'hf_lerobot_home') ?? joinPath(doc.PI_LORA_TASK, 'lerobot'))}`,
    '  robot_type: custom',
    `  fps: ${yamlScalar(f.fps ?? 15)}`,
    `  chest_image_prefix: ${yamlScalar(f.chest_image_prefix ?? 'rgb_chest')}`,
    `  top_image_prefix: ${yamlScalar(f.top_image_prefix ?? 'rgb_top')}`,
    `  wrist_image_prefix: ${yamlScalar(f.wrist_image_prefix ?? 'rgb_wrist_2')}`,
    `  task_name: ${yamlScalar(f.task_name ?? '')}`,
    `  prompt_from_task: ${yamlScalar(f.prompt_from_task ?? true)}`,
    `  normalize_rx_to_2pi: ${yamlScalar(f.normalize_rx_to_2pi ?? true)}`,
    `  gripper_action_source: ${yamlScalar(f.gripper_action_source ?? 'next_observation')}`,
    `  max_episodes: ${yamlScalar(f.max_episodes ?? null)}`,
    '',
    'model:',
    `  action_horizon: ${yamlScalar(g('actionHorizon', 'action_horizon') ?? 10)}`,
    `  max_token_len: ${yamlScalar(g('maxTokenLen', 'max_token_len') ?? 200)}`,
    `  discrete_state_input: ${yamlScalar(g('discreteStateInput', 'discrete_state_input') ?? true)}`,
    `  paligemma_variant: ${yamlScalar(g('paligemmaVariant', 'paligemma_variant') ?? 'gemma_2b_lora')}`,
    `  action_expert_variant: ${yamlScalar(g('actionExpertVariant', 'action_expert_variant') ?? 'gemma_300m_lora')}`,
  ]

  const rtc = g('rtcSimulatedDelay', 'rtc_simulated_delay')
  if (rtc !== undefined && rtc !== null && rtc !== '') {
    lines.push(`  rtc_simulated_delay: ${yamlScalar(rtc as string | number | boolean)}`)
  }

  lines.push(
    '',
    'training:',
    `  seed: ${yamlScalar(f.seed ?? 42)}`,
    `  batch_size: ${yamlScalar(g('batchSize', 'batch_size') ?? 2)}`,
    `  fsdp_devices: ${yamlScalar(g('fsdpDevices', 'fsdp_devices') ?? 1)}`,
    `  num_workers: ${yamlScalar(g('numWorkers', 'num_workers') ?? 2)}`,
    `  num_train_steps: ${yamlScalar(g('numTrainSteps', 'num_train_steps') ?? 10000)}`,
    `  log_interval: ${yamlScalar(g('logInterval', 'log_interval') ?? 50)}`,
    `  save_interval: ${yamlScalar(g('saveInterval', 'save_interval') ?? 2000)}`,
    `  keep_period: ${yamlScalar(g('keepPeriod', 'keep_period') ?? 5000)}`,
    `  peak_lr: ${yamlScalar(g('peakLr', 'peak_lr') ?? 0.0001)}`,
    `  decay_lr: ${yamlScalar(g('decayLr', 'decay_lr') ?? 1e-5)}`,
    `  warmup_steps: ${yamlScalar(g('warmupSteps', 'warmup_steps') ?? 200)}`,
    `  decay_steps: ${yamlScalar(g('decaySteps', 'decay_steps') ?? 10000)}`,
    `  ema_decay: ${yamlScalar(g('emaDecay', 'ema_decay') ?? null)}`,
    `  clip_gradient_norm: ${yamlScalar(g('clipGradientNorm', 'clip_gradient_norm') ?? 1)}`,
    `  wandb_enabled: ${yamlScalar(g('wandbEnabled', 'wandb_enabled') ?? false)}`,
    `  overwrite: ${yamlScalar(g('trainOverwrite', 'overwrite') ?? true)}`,
    `  resume: ${yamlScalar(g('trainResume', 'resume') ?? false)}`,
    '',
    'paths:',
    `  assets_base_dir: ${yamlScalar(g('assetsBaseDir', 'assets_base_dir') ?? joinPath(doc.PI_LORA_TASK, 'artifacts/assets'))}`,
    `  checkpoint_base_dir: ${yamlScalar(g('checkpointBaseDir', 'checkpoint_base_dir') ?? joinPath(doc.PI_LORA_TASK, 'artifacts/checkpoints'))}`,
    `  base_checkpoint_path: ${yamlScalar(g('baseCheckpointPath', 'base_checkpoint_path') ?? joinPath(doc.PI05_ROOT, 'checkpoints/pi0.5_base/params'))}`,
    `  eval_output_dir: ${yamlScalar(g('evalOutputDir', 'eval_output_dir') ?? joinPath(doc.PI_LORA_TASK, 'artifacts/eval'))}`,
    '',
  )

  void TRAIN_YAML_DATA_KEYS
  return lines.join('\n')
}

/** Shell snippet to create task workspace dirs (raw/annotation must be filled by hand). */
export function buildLoraTaskMkdirSh(doc: LoraTaskRefExport): string {
  const task = doc.PI_LORA_TASK
  return [
    'mkdir -p \\',
    `  ${task}/{raw,annotation,lerobot,configs,infer/lora} \\`,
    `  ${task}/artifacts/{assets/${doc.PROJECT_NAME}/${doc.REPO_ID},checkpoints/${doc.PROJECT_NAME}/${doc.EXP_NAME},eval} \\`,
    `  ${doc.EMBODY_ROOT}/data/{${doc.SUITE_ID},${doc.SUITE_ID_CHUNK}}`,
  ].join('\n')
}

/** Downloadable .sh with shebang wrapping {@link buildLoraTaskMkdirSh}. */
export function buildLoraTaskMkdirShFile(doc: LoraTaskRefExport): string {
  return [
    '#!/usr/bin/env bash',
    `# Create LoRA task dirs for ${doc.TASK_NAME}`,
    'set -euo pipefail',
    '',
    buildLoraTaskMkdirSh(doc),
    '',
    `echo "ok: ${doc.PI_LORA_TASK}"`,
    '',
  ].join('\n')
}

/** Download JSON + train YAML + mkdir.sh (staggered to avoid browser blocking). */
export function downloadLoraTaskBundle(doc: LoraTaskRefExport) {
  const base = `pi05_lora_${doc.TASK_NAME}`
  const configName = (() => {
    const p = String(doc.steps.find((s) => s.id === 'train')?.fields.configPath || '')
    const leaf = p.split('/').filter(Boolean).pop()
    return leaf && leaf.endsWith('.yaml') ? leaf : 'pi05.yaml'
  })()

  downloadBlob(`${base}.json`, `${JSON.stringify(doc, null, 2)}\n`, 'application/json;charset=utf-8')
  window.setTimeout(() => {
    downloadBlob(configName, buildLoraTrainYamlText(doc), 'text/yaml;charset=utf-8')
  }, 120)
  window.setTimeout(() => {
    downloadBlob(`${base}_mkdir.sh`, buildLoraTaskMkdirShFile(doc), 'text/x-shellscript;charset=utf-8')
  }, 240)
}

export function parseLoraTaskRefJson(raw: unknown): LoraTaskRefExport {
  if (!raw || typeof raw !== 'object') throw new Error('invalid JSON root')
  const doc = raw as LoraTaskRefExport
  if (!Array.isArray(doc.steps)) throw new Error('missing steps[]')
  return doc
}

/** Normalize export fields → form keys; null → '' for UI. */
export function normalizeStepFields(
  fields: Record<string, string | number | boolean | null>,
  stepId?: string,
): LoraStepParams {
  const out: LoraStepParams = {}
  for (const [k, v] of Object.entries(fields)) {
    if (TRAIN_YAML_DATA_KEYS.includes(k as (typeof TRAIN_YAML_DATA_KEYS)[number])) continue
    let key = FIELD_ALIASES[k] || k
    if (stepId === 'train' && TRAIN_ONLY_ALIASES[k]) key = TRAIN_ONLY_ALIASES[k]
    if (v === null || v === undefined) {
      out[key] = ''
    } else {
      out[key] = v
    }
  }
  return out
}

/**
 * Pick one step from the export and return form-ready params.
 * When `allowedKeys` is set, only those keys are returned (intersect with step schema).
 */
export function applyLoraTaskRefStep(
  doc: LoraTaskRefExport,
  stepId: string,
  allowedKeys?: Iterable<string>,
): LoraStepParams {
  const step = doc.steps.find((s) => s.id === stepId)
  if (!step) throw new Error(`step not found: ${stepId}`)
  const normalized = normalizeStepFields(step.fields, stepId)
  if (!allowedKeys) return normalized
  const allow = new Set(allowedKeys)
  const out: LoraStepParams = {}
  for (const [k, v] of Object.entries(normalized)) {
    if (allow.has(k)) out[k] = v
  }
  return out
}

export const DEFAULT_LORA_ADDRESS = '/root/autodl-tmp'
export const DEFAULT_LORA_TASK_NAME = 'pi_lora_task'
