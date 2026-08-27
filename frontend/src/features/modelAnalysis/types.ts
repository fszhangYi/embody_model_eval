export type ArtifactKey = 'dataset_stats' | 'policy_config' | 'train_history'

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
  }
}
