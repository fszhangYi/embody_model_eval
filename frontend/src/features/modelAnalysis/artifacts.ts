import type { ArtifactKey } from './types'

export type ModelArtifactId =
  | 'dataset_stats'
  | 'optimizer'
  | 'policy_best'
  | 'policy_config'
  | 'train_history'

export interface ModelArtifactDef {
  id: ModelArtifactId
  filename: string
  formatKey: string
}

export const MODEL_ARTIFACTS: ModelArtifactDef[] = [
  { id: 'dataset_stats', filename: 'dataset_stats.pkl', formatKey: 'modelAnalysis.format.pickle' },
  { id: 'policy_config', filename: 'policy_config.json', formatKey: 'modelAnalysis.format.json' },
  { id: 'train_history', filename: 'train_history.json', formatKey: 'modelAnalysis.format.json' },
  { id: 'optimizer', filename: 'optimizer.pt', formatKey: 'modelAnalysis.format.pytorch' },
  { id: 'policy_best', filename: 'policy_best.ckpt', formatKey: 'modelAnalysis.format.pytorch' },
]

export const COMPARE_ARTIFACT_IDS: ArtifactKey[] = [
  'dataset_stats',
  'policy_config',
  'train_history',
]

export const ALL_ARTIFACT_IDS: ArtifactKey[] = [
  ...COMPARE_ARTIFACT_IDS,
  'optimizer',
  'policy_best',
]

export const GPU_ARTIFACT_IDS = new Set<ModelArtifactId>(['optimizer', 'policy_best'])
