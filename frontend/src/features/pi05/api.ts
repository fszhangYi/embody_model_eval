import type { PipelineJob, PipelineSpec } from '../actPipeline/types'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
  }
  return data as T
}

export function fetchPi05Spec(pi05Root?: string, route?: string) {
  const qs = new URLSearchParams()
  if (pi05Root) qs.set('pi05Root', pi05Root)
  if (route) qs.set('route', route)
  const q = qs.toString()
  return api<PipelineSpec & { route?: string; routeModes?: Array<Record<string, unknown>> }>(
    `/api/pi05-pipeline/spec${q ? `?${q}` : ''}`,
  )
}

export function fetchPi05Jobs() {
  return api<{ ok: boolean; jobs: PipelineJob[] }>('/api/pi05-pipeline/jobs')
}

export function fetchPi05Job(id: string) {
  return api<{ ok: boolean; job: PipelineJob }>(
    `/api/pi05-pipeline/jobs/${encodeURIComponent(id)}`,
  )
}

export function runPi05Step(
  stepId: string,
  params: Record<string, unknown>,
  pi05Root: string,
  route?: string,
) {
  return api<{ ok: boolean; job: PipelineJob }>('/api/pi05-pipeline/run', {
    method: 'POST',
    body: JSON.stringify({ stepId, params, pi05Root, route }),
  })
}

export function cancelPi05Job(id: string) {
  return api<{ ok: boolean; job: PipelineJob }>(
    `/api/pi05-pipeline/jobs/${encodeURIComponent(id)}/cancel`,
    { method: 'POST' },
  )
}

export function deletePi05Job(id: string) {
  return api<{ ok: boolean; deleted: string }>(
    `/api/pi05-pipeline/jobs/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export interface Pi05ConfigBrief {
  projectName?: string
  expName?: string
  repoId?: string
  batchSize?: number
  fsdpDevices?: number
  numTrainSteps?: number
  paligemma?: string
  actionExpert?: string
  maxEpisodes?: number
  error?: string
}

export interface Pi05ConfigItem {
  name: string
  path: string
  size?: number
  mtime?: number
  brief?: Pi05ConfigBrief
}

export interface Pi05VariantMeta {
  variant?: string
  approxParams?: string
  width?: number | null
  depth?: number | null
  mlpDim?: number | null
  lora?: boolean
  loraRank?: number
  short?: string
}

export interface Pi05StructureNode {
  id: string
  label: string
  role: string
  column: number
  row?: number
  detail?: string
  tags?: string[]
  variant?: Pi05VariantMeta
}

export interface Pi05ModelStructure {
  family?: string
  nodes: Pi05StructureNode[]
  edges: Array<{ from: string; to: string }>
  meta?: {
    actionHorizon?: number
    maxTokenLen?: number
    discreteStateInput?: boolean
    paligemma?: Pi05VariantMeta
    actionExpert?: Pi05VariantMeta
    repoId?: string
    cameras?: string[]
  }
}

export interface Pi05NormGroup {
  name: string
  dim: number
  mean: number[]
  std: number[]
  q01: number[]
  q99: number[]
}

export interface Pi05CkptStep {
  name: string
  path: string
  mtime?: number
  size?: number
  totalBytes?: number
  hasModel?: boolean
  hasOptimizer?: boolean
  hasMetadata?: boolean
  hasAssets?: boolean
  files?: Record<string, { size?: number; isDir?: boolean }>
}

export interface Pi05CkptRun {
  project: string
  exp: string
  path: string
  stepCount: number
  steps: Pi05CkptStep[]
  latestStep?: string | null
  latestPath?: string | null
  totalBytes?: number
  hasModel?: boolean
  adaptation?: 'full_ft' | 'lora' | 'mixed' | 'unknown' | string
}

export interface Pi05WeightModule {
  id: string
  label: string
  params: number
  elements: number
  children?: Array<{ id: string; label: string; params: number; elements: number }>
}

export interface Pi05WeightStructure {
  tensorCount: number
  totalElements: number
  approxParams?: string
  dtypeBreakdown?: Array<{ dtype: string; count: number }>
  modules: Pi05WeightModule[]
  modelGraph?: {
    nodes: Array<{
      id: string
      label: string
      column: number
      row?: number
      params: number
      elements: number
      children?: Pi05WeightModule['children']
    }>
    edges: Array<{ from: string; to: string }>
  }
  sampleKeys?: string[]
}

export interface Pi05CheckpointInspect {
  ok: boolean
  error?: string
  path?: string
  name?: string
  totalBytes?: number
  hasModel?: boolean
  hasOptimizer?: boolean
  hasMetadata?: boolean
  hasAssets?: boolean
  files?: Record<string, { size?: number; isDir?: boolean }>
  metadata?: {
    globalStep?: number
    timestamp?: number
    config?: Record<string, unknown>
  }
  metadataError?: string
  weights?: Pi05WeightStructure
  weightsError?: string
  modelStructure?: Pi05ModelStructure | null
  weightGraph?: Pi05WeightStructure['modelGraph']
  normStats?: Array<{ path: string; groups?: Pi05NormGroup[]; keys?: string[]; error?: string }>
}

export interface Pi05PrepareItem {
  path: string
  name: string
  summary?: {
    repoId?: string
    episodes?: number
    frames?: number
    datasetFormat?: string
    skipped?: number
    configPath?: string
  }
  preview?: Record<string, unknown>
  error?: string
}

export interface Pi05AnalyzeResult {
  ok: boolean
  error?: string
  pi05Root?: string
  route?: string
  healthHint?: string
  defaultRoot?: string
  selectedPath?: string
  checkpointScope?: string | null
  checks?: Record<string, string | boolean | number>
  paths?: Record<string, string>
  presets?: { hww?: string; pi05?: string }
  configs?: Pi05ConfigItem[]
  checkpoints?: {
    checkpointRoot: string
    runs: Pi05CkptRun[]
    route?: string
    scope?: string | null
    selectedPath?: string
    pi05Root?: string
  }
  normStats?: Array<{
    path: string
    size?: number
    keys?: string[]
    preview?: unknown
    groups?: Pi05NormGroup[]
    error?: string
  }>
  prepare?: Pi05PrepareItem[]
  config?: {
    path: string
    name: string
    yaml: unknown
    text: string
  }
  modelStructure?: Pi05ModelStructure | null
  checkpoint?: Pi05CheckpointInspect | null
}

export function analyzePi05(
  pi05Root?: string,
  configPath?: string,
  checkpointPath?: string,
  route?: string,
) {
  return api<Pi05AnalyzeResult>('/api/pi05-analysis/analyze', {
    method: 'POST',
    body: JSON.stringify({ pi05Root, configPath, checkpointPath, route }),
  })
}

export function probeFsPath(path: string, expect?: 'dir' | 'file' | 'pytorch_base') {
  const qs = new URLSearchParams()
  if (path) qs.set('path', path)
  if (expect) qs.set('expect', expect)
  return api<{
    ok: boolean
    path: string
    exists: boolean
    isFile: boolean
    isDir: boolean
    healthy?: boolean
    expect?: string | null
    detail?: string | null
    reason?: string
    error?: string
  }>(`/api/fs/stat?${qs}`)
}

export function fetchPi05GpuStatus() {
  return api<{
    ok: boolean
    gpuCount: number
    enoughForFullFt: boolean
    minForFullFt: number
  }>('/api/pi05-pipeline/gpu')
}

export function inspectPi05Config(configPath: string, pi05Root?: string) {
  return api<NonNullable<Pi05AnalyzeResult['config']> & { ok: boolean }>(
    '/api/pi05-analysis/inspect-config',
    {
      method: 'POST',
      body: JSON.stringify({ configPath, pi05Root }),
    },
  )
}

export function loadPi05TrainYaml(configPath: string, pi05Root?: string) {
  return api<{
    ok: boolean
    path: string
    yaml: unknown
    params: Record<string, string | number | boolean>
  }>('/api/pi05-pipeline/load-train-yaml', {
    method: 'POST',
    body: JSON.stringify({ configPath, pi05Root }),
  })
}

export function savePi05TrainYaml(opts: {
  savePath: string
  params: Record<string, unknown>
  pi05Root?: string
  mergeFrom?: string
}) {
  return api<{ ok: boolean; path: string; bytes: number }>('/api/pi05-pipeline/save-train-yaml', {
    method: 'POST',
    body: JSON.stringify(opts),
  })
}

export function inspectPi05Checkpoint(checkpointPath: string, pi05Root?: string) {
  return api<Pi05CheckpointInspect>('/api/pi05-analysis/inspect-checkpoint', {
    method: 'POST',
    body: JSON.stringify({ checkpointPath, pi05Root }),
  })
}
