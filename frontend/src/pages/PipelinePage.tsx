import { useCallback } from 'react'
import pipelineShell from '../features/pipeline/pipelineShell.html?raw'
import { mountPipeline } from '../features/pipeline/mountPipeline'
import { PageChrome } from '../components/PageChrome'
import { LegacyShell } from '../components/LegacyShell'
import { useLocale } from '../i18n/LocaleContext'
import { applyDomI18n } from '../i18n/runtime'
import '../styles/pipeline.css'

export function PipelinePage() {
  const { locale } = useLocale()
  const onMount = useCallback(() => {
    applyDomI18n(document.querySelector('.pipeline-page') || document)
    mountPipeline()
  }, [locale])

  return (
    <div className="pipeline-page">
      <LegacyShell className="legacy-shell" html={pipelineShell} onMount={onMount} />
      <PageChrome />
    </div>
  )
}
