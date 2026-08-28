import type { GpuAnalyzeResult, GpuStatus, ModelCompareResult } from './types'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return data as T
}

export function fetchGpuStatus() {
  return api<GpuStatus>('/api/model-analysis/gpu-status')
}

export function compareCkptDirs(ckptDirs: string[]) {
  return api<ModelCompareResult>('/api/model-analysis/compare', {
    method: 'POST',
    body: JSON.stringify({ ckptDirs }),
  })
}

export function analyzeGpuArtifacts(ckptDirs: string[]) {
  return api<GpuAnalyzeResult>('/api/model-analysis/analyze-gpu', {
    method: 'POST',
    body: JSON.stringify({ ckptDirs }),
  })
}

export function mergeGpuAnalyzeResult(
  base: ModelCompareResult,
  gpu: GpuAnalyzeResult,
): ModelCompareResult {
  const gpuByPath = new Map(gpu.runs.map((run) => [run.path, run]))
  return {
    ...base,
    runs: base.runs.map((run) => {
      const gpuRun = gpuByPath.get(run.path)
      if (!gpuRun) return run
      return {
        ...run,
        artifacts: {
          ...run.artifacts,
          optimizer: gpuRun.artifacts.optimizer,
          policy_best: gpuRun.artifacts.policy_best,
        },
      }
    }),
    compare: {
      ...base.compare,
      optimizer: gpu.compare.optimizer,
      policy_best: gpu.compare.policy_best,
    },
  }
}
