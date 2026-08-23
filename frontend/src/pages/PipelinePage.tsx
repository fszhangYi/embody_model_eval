import { useCallback } from 'react'
import pipelineShell from '../features/pipeline/pipelineShell.html?raw'
import { mountPipeline } from '../features/pipeline/mountPipeline'
import { PageNav } from '../components/PageNav'
import { LegacyShell } from '../components/LegacyShell'
import '../styles/pipeline.css'

export function PipelinePage() {
  const onMount = useCallback(() => mountPipeline(), [])

  return (
    <div className="pipeline-page">
      <LegacyShell className="legacy-shell" html={pipelineShell} onMount={onMount} />
      <div className="page-nav-floating">
        <PageNav />
      </div>
    </div>
  )
}
