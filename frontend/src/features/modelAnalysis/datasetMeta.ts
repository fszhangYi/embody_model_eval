import type { DatasetMeta, DatasetMetaSource } from './types'

export function formatEpisodeCount(v: unknown): string {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return '—'
}

export function hasEpisodeMeta(meta: DatasetMeta | null | undefined): boolean {
  return (
    meta?.trainEpisodes != null ||
    meta?.valEpisodes != null ||
    meta?.totalEpisodes != null
  )
}

export function datasetMetaSourceLabel(
  source: DatasetMetaSource | null | undefined,
  t: (key: string) => string,
): string {
  if (!source) return t('modelAnalysis.episodeSource.unavailable')
  return t(`modelAnalysis.episodeSource.${source}`)
}

export function formatDatasetMetaBrief(
  meta: DatasetMeta | null | undefined,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (!hasEpisodeMeta(meta)) {
    return t('modelAnalysis.episodeUnavailable')
  }
  const parts: string[] = []
  if (meta!.trainEpisodes != null) {
    parts.push(t('modelAnalysis.episodeTrainBrief', { n: meta!.trainEpisodes }))
  }
  if (meta!.valEpisodes != null) {
    parts.push(t('modelAnalysis.episodeValBrief', { n: meta!.valEpisodes }))
  }
  if (meta!.totalEpisodes != null) {
    parts.push(t('modelAnalysis.episodeTotalBrief', { n: meta!.totalEpisodes }))
  }
  return parts.join(' · ')
}

export function scalarFieldLabel(key: string, t: (key: string) => string): string {
  const map: Record<string, string> = {
    train_episodes: 'modelAnalysis.scalarTrainEpisodes',
    val_episodes: 'modelAnalysis.scalarValEpisodes',
    total_episodes: 'modelAnalysis.scalarTotalEpisodes',
    state_dim: 'state_dim',
    max_episode_len: 'max_episode_len',
    chunk_size_for_delta: 'chunk_size_for_delta',
  }
  const i18nKey = map[key]
  return i18nKey?.startsWith('modelAnalysis.') ? t(i18nKey) : key
}

const EPISODE_SCALAR_KEYS = new Set(['train_episodes', 'val_episodes', 'total_episodes'])

export function isEpisodeScalarKey(key: string): boolean {
  return EPISODE_SCALAR_KEYS.has(key)
}
