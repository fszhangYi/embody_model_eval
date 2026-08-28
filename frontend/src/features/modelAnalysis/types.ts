export type ArtifactKey =
  | 'dataset_stats'
  | 'policy_config'
  | 'train_history'
  | 'optimizer'
  | 'policy_best'

export type AnalysisMode = 'compare' | 'single'

export interface ArtifactLoadResult {
  ok: boolean
  filename?: string
  sizeBytes?: number
  data?: Record<string, unknown>
  error?: string
}

export type DatasetMetaSource = 'dataset_stats' | 'dataset_info' | 'train_log' | 'hdf5_count'

export interface DatasetMeta {
  trainEpisodes?: number | null
  valEpisodes?: number | null
  totalEpisodes?: number | null
  source?: DatasetMetaSource | null
  sourcePath?: string | null
  dataDir?: string | null
}

export interface OptimizerParamGroup {
  lr?: number
  initialLr?: number
  weightDecay?: number
  betas?: [number, number]
  eps?: number
  amsgrad?: boolean
  maximize?: boolean
  foreach?: boolean
  capturable?: boolean
  fused?: boolean
  decoupledWeightDecay?: boolean
  paramCount?: number
}

export interface TensorBufferStats {
  min?: number
  max?: number
  mean?: number
  std?: number
  absMean?: number
  norm?: number
}

export interface OptimizerStateBuffer {
  name: string
  shape?: number[]
  dtype?: string
  bytes?: number
  value?: number
  stats?: TensorBufferStats
}

export interface OptimizerStateSlot {
  paramIndex: number | string
  step?: number | null
  bytes?: number
  buffers?: OptimizerStateBuffer[]
}

export interface OptimizerStateSummary {
  globalStep?: number | null
  stepMin?: number | null
  stepMax?: number | null
  stepUniform?: boolean
  expAvg?: TensorBufferStats | null
  expAvgSq?: TensorBufferStats | null
}

export interface OptimizerData {
  epoch?: number
  optimizerType?: string
  paramGroups?: OptimizerParamGroup[]
  scheduler?: {
    lastEpoch?: number
    TMax?: number
    etaMin?: number
    lastLr?: number[]
    baseLrs?: number[]
    stepCount?: number
    isInitial?: boolean
  } | null
  stateTensorCount?: number
  stateBytes?: number
  slotCount?: number
  bufferTypes?: { name: string; count: number }[]
  stateSummary?: OptimizerStateSummary
  topStateSlots?: OptimizerStateSlot[]
}

export interface PolicyModuleSummary {
  prefix: string
  params: number
  elements: number
}

export interface PolicyTensorSummary {
  name: string
  shape?: number[]
  dtype?: string
  numel?: number
  bytes?: number
}

export interface PolicyWeightStats {
  min?: number
  max?: number
  mean?: number
  absMean?: number
  sampledTensors?: number
}

export interface PolicyModuleBar {
  label: string
  elements: number
  pct: number
}

export interface PolicyHistogram {
  bins: number
  counts: number[]
  min?: number | null
  max?: number | null
  sampleSize?: number
  totalElements?: number
}

export interface PolicyHeatmap {
  name: string
  height: number
  width: number
  sourceShape?: number[]
  min?: number
  max?: number
  values: number[]
}

export interface PolicyGraphNode {
  id: string
  label: string
  column: number
  row?: number
  params: number
  elements: number
  children?: { id: string; label: string; params: number; elements: number }[]
}

export interface PolicyGraphEdge {
  from: string
  to: string
}

export interface PolicyModelGraph {
  nodes: PolicyGraphNode[]
  edges: PolicyGraphEdge[]
}

export interface PolicyVisualization {
  modelGraph?: PolicyModelGraph
  moduleBars?: PolicyModuleBar[]
  histogram?: PolicyHistogram
  heatmaps?: PolicyHeatmap[]
}

export interface PolicyBestData {
  paramCount?: number
  totalParams?: number
  totalBytes?: number
  modules?: PolicyModuleSummary[]
  topTensors?: PolicyTensorSummary[]
  weightStats?: PolicyWeightStats
  dtypeBreakdown?: { dtype: string; count: number }[]
  visualization?: PolicyVisualization
}

export interface OptimizerCompareResult {
  labels: string[]
  scalarRows: DatasetStatsScalarRow[]
  groupRows: {
    groupIndex: number
    lr: { values: unknown[]; same: boolean; present: boolean }
    weightDecay: { values: unknown[]; same: boolean; present: boolean }
    paramCount: { values: unknown[]; same: boolean; present: boolean }
  }[]
  schedulerRows: DatasetStatsScalarRow[]
  diffCount: number
}

export interface PolicyBestSummary {
  label: string
  ok: boolean
  error?: string
  paramCount?: number
  totalParams?: number
  totalBytes?: number
}

export interface PolicyWeightDiffRow {
  key: string
  maxAbsDiff: number
  meanAbsDiff: number
  relL2: number
  perRun: ({ maxAbs?: number; meanAbs?: number; relL2?: number } | null)[]
}

export interface PolicyBestCompareResult {
  labels: string[]
  summaries: PolicyBestSummary[]
  scalarRows: DatasetStatsScalarRow[]
  shapeRows: { key: string; shapes: (number[] | null)[]; same: boolean; present: boolean }[]
  weightRows: PolicyWeightDiffRow[]
  diffCount: number
}

export interface GpuStatus {
  ok: boolean
  available: boolean
  torchInstalled?: boolean
  torchVersion?: string
  deviceName?: string | null
  deviceCount?: number
  error?: string
}

export interface GpuAnalyzeResult {
  ok: boolean
  gpu?: GpuStatus
  runs: Array<{
    label: string
    path: string
    artifacts: Pick<Record<ArtifactKey, ArtifactLoadResult>, 'optimizer' | 'policy_best'>
  }>
  compare: {
    optimizer: OptimizerCompareResult
    policy_best: PolicyBestCompareResult
  }
}

export interface CkptRun {
  label: string
  path: string
  artifacts: Record<ArtifactKey, ArtifactLoadResult>
  datasetMeta?: DatasetMeta
}

export interface DatasetStatsScalarRow {
  key: string
  values: (number | null)[]
  same: boolean
  present: boolean
}

export interface DatasetStatsDimRow {
  dim: number
  values: (number | null)[]
  delta: number
  same: boolean
  pctFromBaseline?: (number | null)[]
}

export interface DatasetStatsVectorRow {
  key: string
  dims: number
  rows: DatasetStatsDimRow[]
  maxDelta: number
  same: boolean
  present: boolean
  diffCount?: number
}

export interface PolicyConfigRow {
  key: string
  values: unknown[]
  same: boolean
  present: boolean
  group?: string
}

export interface PolicyConsistencyCheck {
  field: string
  config: unknown
  stats: unknown
  match: boolean
}

export interface TrainHistorySummary {
  label: string
  ok: boolean
  error?: string
  epochsTrain?: number
  epochsVal?: number
  bestVal?: { epoch: number; loss?: number; l1?: number; kl?: number } | null
  finalTrain?: Record<string, unknown> | null
  finalVal?: Record<string, unknown> | null
}

export interface TrainHistoryChartSeries {
  metric: string
  label: string
  values: (number | null)[]
}

export interface ModelCompareResult {
  ok: boolean
  runs: CkptRun[]
  compare: {
    dataset_stats: {
      labels: string[]
      dimLabels?: string[]
      scalarRows: DatasetStatsScalarRow[]
      vectorRows: DatasetStatsVectorRow[]
      scalarDiffCount?: number
      vectorDiffCount?: number
    }
    policy_config: {
      labels: string[]
      rows: PolicyConfigRow[]
      diffCount: number
      consistency: { label: string; checks: PolicyConsistencyCheck[] }[]
    }
    train_history: {
      labels: string[]
      maxEpochs: number
      summaries: TrainHistorySummary[]
      chartSeries: TrainHistoryChartSeries[]
      bestValSpread: number
      bestRunIndex?: number | null
    }
    optimizer?: OptimizerCompareResult
    policy_best?: PolicyBestCompareResult
  }
}
