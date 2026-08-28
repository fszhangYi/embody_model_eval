import { useCallback, useEffect, useMemo, useState } from 'react'
import { PathPickerModal } from '../components/PathPickerModal'
import { PageChrome } from '../components/PageChrome'
import { useLocale } from '../i18n/LocaleContext'
import {
  convertEpisode,
  detectEpisodePath,
  fetchConverterSpec,
  inspectPath,
} from '../features/datasetConverter/api'
import type {
  ConverterSpec,
  ConverterTab,
  DatasetFormatId,
  DetectResult,
  ImagePreview,
  InspectResult,
} from '../features/datasetConverter/types'
import { formatLabelKey } from '../features/datasetConverter/formatLabels'
import { isImagePreview } from '../features/datasetConverter/types'
import '../styles/dataset-converter.css'

function previewText(preview: unknown): string {
  if (preview == null) return ''
  if (typeof preview === 'string') return preview
  try {
    return JSON.stringify(preview, null, 2)
  } catch {
    return String(preview)
  }
}

function PreviewContent({
  inspect,
  emptyLabel,
  imageTooLargeLabel,
}: {
  inspect: InspectResult | null
  emptyLabel: string
  imageTooLargeLabel: string
}) {
  if (!inspect) {
    return <p className="dc-preview-empty muted">{emptyLabel}</p>
  }

  const { preview } = inspect
  if (isImagePreview(preview)) {
    const img = preview as ImagePreview
    if (img.tooLarge) {
      return (
        <p className="dc-preview-empty muted">
          {imageTooLargeLabel} ({img.sizeBytes != null ? `${Math.round(img.sizeBytes / 1024)} KB` : ''})
        </p>
      )
    }
    if (img.dataUrl) {
      return (
        <div className="dc-preview-image">
          <img src={img.dataUrl} alt="" />
        </div>
      )
    }
  }

  return <pre className="dc-preview">{previewText(preview)}</pre>
}

function confidenceClass(c: DetectResult['confidence'] | undefined): string {
  if (c === 'high') return 'ok'
  if (c === 'medium') return 'warn'
  return 'muted'
}

export function DatasetConverterPage() {
  const { t } = useLocale()
  const [tab, setTab] = useState<ConverterTab>('inspect')
  const [spec, setSpec] = useState<ConverterSpec | null>(null)
  const [actRoot, setActRoot] = useState('/root/autodl-tmp')
  const [episodePath, setEpisodePath] = useState('')
  const [filePath, setFilePath] = useState('')
  const [detect, setDetect] = useState<DetectResult | null>(null)
  const [inspect, setInspect] = useState<InspectResult | null>(null)
  const [targetFormat, setTargetFormat] = useState<DatasetFormatId>('lerobot')
  const [convertMsg, setConvertMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerTarget, setPickerTarget] = useState<'episode' | 'file'>('episode')
  const [options, setOptions] = useState({
    includeImages: true,
    sliceValid: false,
    outputDir: '',
  })

  useEffect(() => {
    fetchConverterSpec()
      .then(setSpec)
      .catch(() => setSpec(null))
    fetch('/api/fs/roots')
      .then((r) => r.json())
      .then((d) => {
        if (d?.roots?.act) setActRoot(d.roots.act)
      })
      .catch(() => {})
  }, [])

  const targetOptions = useMemo(() => {
    if (!spec || !detect?.format) return [] as DatasetFormatId[]
    const ids = spec.conversionMatrix
      .filter((e) => e.from === detect.format)
      .map((e) => e.to)
    return [...new Set(ids)]
  }, [spec, detect?.format])

  useEffect(() => {
    if (targetOptions.length && !targetOptions.includes(targetFormat)) {
      setTargetFormat(targetOptions[0])
    }
  }, [targetOptions, targetFormat])

  const onDetect = useCallback(async () => {
    const path = episodePath.trim()
    if (!path) {
      setError(t('datasetConverter.errNeedPath'))
      return
    }
    setBusy(true)
    setError('')
    setConvertMsg('')
    try {
      const out = await detectEpisodePath(path)
      setDetect(out)
      if (out.suggestedFiles?.length) {
        setFilePath(out.suggestedFiles[0])
      } else {
        setFilePath(path)
      }
    } catch (e) {
      setDetect(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [episodePath, t])

  const onInspect = useCallback(async () => {
    const path = filePath.trim() || episodePath.trim()
    if (!path) {
      setError(t('datasetConverter.errNeedFile'))
      return
    }
    setBusy(true)
    setError('')
    try {
      const out = await inspectPath(path, detect?.format)
      setInspect(out)
    } catch (e) {
      setInspect(null)
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [filePath, episodePath, detect?.format, t])

  const onConvert = useCallback(async () => {
    const path = episodePath.trim()
    if (!path || !detect?.format) {
      setError(t('datasetConverter.errNeedDetect'))
      return
    }
    setBusy(true)
    setError('')
    setConvertMsg('')
    try {
      const out = await convertEpisode({
        sourcePath: path,
        sourceFormat: detect.format,
        targetFormat,
        options: {
          includeImages: options.includeImages,
          sliceValid: options.sliceValid,
          outputDir: options.outputDir.trim() || undefined,
        },
      })
      if (out.ok && out.outputPath) {
        setConvertMsg(
          t('datasetConverter.convertSuccess', {
            output: out.outputPath,
            steps: out.numSteps ?? 0,
            pipeline: (out.pipeline ?? []).join(' → '),
            ir: out.intermediatePath ?? '',
          }),
        )
      } else if (out.plannedOutput) {
        setConvertMsg(
          t('datasetConverter.convertStubDetail', {
            output: out.plannedOutput,
            error: out.error || t('datasetConverter.convertStub'),
          }),
        )
      } else {
        setConvertMsg(out.error || t('datasetConverter.convertStub'))
      }
    } catch (e) {
      setConvertMsg('')
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [episodePath, detect?.format, targetFormat, options, t])

  const openPicker = (target: 'episode' | 'file') => {
    setPickerTarget(target)
    setPickerOpen(true)
  }

  return (
    <div className="dataset-converter-page">
      <header className="dc-header">
        <div className="dc-header-brand">
          <h1>{t('datasetConverter.title')}</h1>
          <p className="dc-header-blurb muted">{t('datasetConverter.subtitle')}</p>
        </div>
        <PageChrome />
      </header>

      <main className="dc-main">
        <section className="dc-toolbar card" aria-label={t('datasetConverter.toolbarAria')}>
          <div className="dc-tab-bar" role="tablist" aria-label={t('datasetConverter.tabsAria')}>
            {(['inspect', 'convert'] as ConverterTab[]).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={`dc-tab${tab === id ? ' active' : ''}`}
                onClick={() => setTab(id)}
              >
                {t(`datasetConverter.tab.${id}`)}
              </button>
            ))}
          </div>

          <label className="dc-field dc-field-grow">
            <span>{t('datasetConverter.episodePath')}</span>
            <div className="dc-path-row">
              <input
                type="text"
                value={episodePath}
                placeholder={t('datasetConverter.episodePlaceholder')}
                onChange={(e) => setEpisodePath(e.target.value)}
              />
              <button type="button" className="dc-btn ghost" onClick={() => openPicker('episode')}>
                {t('datasetConverter.browse')}
              </button>
              <button type="button" className="dc-btn primary" disabled={busy} onClick={() => void onDetect()}>
                {busy ? t('datasetConverter.detecting') : t('datasetConverter.detect')}
              </button>
            </div>
          </label>

          {detect ? (
            <div className="dc-detect card inset">
              <div className="dc-detect-head">
                <span className="dc-format-badge">{t(formatLabelKey(detect.format))}</span>
                <span className={`dc-confidence ${confidenceClass(detect.confidence)}`}>
                  {t(`datasetConverter.confidence.${detect.confidence}`)}
                </span>
                <span className="muted dc-detect-path">{detect.path}</span>
              </div>
              <ul className="dc-signals">
                {detect.signals.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              {detect.sampleListing?.length ? (
                <p className="muted dc-listing">
                  {t('datasetConverter.listing')}: {detect.sampleListing.join(', ')}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="muted dc-toolbar-hint">{t('datasetConverter.detectHint')}</p>
          )}

          {error ? <p className="dc-error">{error}</p> : null}
        </section>

        <div className="dc-layout">
          <aside className="dc-sidebar card" aria-label={t('datasetConverter.formatsAria')}>
            <h2>{t('datasetConverter.formatsTitle')}</h2>
            <p className="muted">{t('datasetConverter.formatsHint')}</p>
            <ul className="dc-format-list">
              {(spec?.formats ?? []).map((f) => (
                <li key={f.id} className={detect?.format === f.id ? 'active' : ''}>
                  <div className="dc-format-name">{t(formatLabelKey(f.id))}</div>
                  <div className="dc-format-desc muted">{t(f.descKey)}</div>
                  {f.extensions.length ? (
                    <div className="dc-format-ext">
                      {f.extensions.map((ext) => (
                        <code key={ext}>.{ext}</code>
                      ))}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </aside>

          <div className="dc-content">
            {tab === 'inspect' ? (
              <section className="card dc-panel" aria-labelledby="dc-inspect-title">
                <div className="dc-panel-head">
                  <h2 id="dc-inspect-title">{t('datasetConverter.inspectTitle')}</h2>
                  <p className="muted">{t('datasetConverter.inspectDesc')}</p>
                </div>

                <label className="dc-field">
                  <span>{t('datasetConverter.filePath')}</span>
                  <div className="dc-path-row">
                    <input
                      type="text"
                      value={filePath}
                      placeholder={t('datasetConverter.filePlaceholder')}
                      onChange={(e) => setFilePath(e.target.value)}
                    />
                    <button type="button" className="dc-btn ghost" onClick={() => openPicker('file')}>
                      {t('datasetConverter.browse')}
                    </button>
                    <button type="button" className="dc-btn primary" disabled={busy} onClick={() => void onInspect()}>
                      {busy ? t('datasetConverter.inspecting') : t('datasetConverter.inspect')}
                    </button>
                  </div>
                </label>

                {detect?.suggestedFiles?.length ? (
                  <div className="dc-suggested">
                    <span className="muted">{t('datasetConverter.suggestedFiles')}</span>
                    <div className="dc-suggested-list">
                      {detect.suggestedFiles.map((p) => (
                        <button
                          key={p}
                          type="button"
                          className={`dc-chip${filePath === p ? ' active' : ''}`}
                          onClick={() => setFilePath(p)}
                        >
                          {p.split('/').slice(-2).join('/')}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="dc-preview-wrap">
                  <div className="dc-preview-head">
                    <span>{t('datasetConverter.preview')}</span>
                    {inspect?.truncated ? (
                      <span className="dc-trunc-badge">{t('datasetConverter.truncated')}</span>
                    ) : null}
                    {inspect && !inspect.implemented ? (
                      <span className="dc-stub-badge">{t('datasetConverter.previewStub')}</span>
                    ) : null}
                  </div>
                  <PreviewContent
                    inspect={inspect}
                    emptyLabel={t('datasetConverter.previewEmpty')}
                    imageTooLargeLabel={t('datasetConverter.imageTooLarge')}
                  />
                </div>

                {spec?.inspectableExtensions?.length ? (
                  <p className="muted dc-ext-hint">
                    {t('datasetConverter.supportedExt')}:{' '}
                    {spec.inspectableExtensions.map((e) => `.${e}`).join(', ')}
                  </p>
                ) : null}
              </section>
            ) : (
              <section className="card dc-panel" aria-labelledby="dc-convert-title">
                <div className="dc-panel-head">
                  <h2 id="dc-convert-title">{t('datasetConverter.convertTitle')}</h2>
                  <p className="muted">{t('datasetConverter.convertDesc')}</p>
                </div>

                <div className="dc-convert-grid">
                  <label className="dc-field">
                    <span>{t('datasetConverter.sourceFormat')}</span>
                    <input
                      type="text"
                      readOnly
                      value={detect ? t(formatLabelKey(detect.format)) : '—'}
                    />
                  </label>
                  <label className="dc-field">
                    <span>{t('datasetConverter.targetFormat')}</span>
                    <select
                      value={targetFormat}
                      disabled={!targetOptions.length}
                      onChange={(e) => setTargetFormat(e.target.value as DatasetFormatId)}
                    >
                      {targetOptions.map((id) => (
                        <option key={id} value={id}>
                          {t(formatLabelKey(id))}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <fieldset className="dc-options">
                  <legend>{t('datasetConverter.optionsTitle')}</legend>
                  <label className="dc-check">
                    <input
                      type="checkbox"
                      checked={options.sliceValid}
                      onChange={(e) => setOptions((o) => ({ ...o, sliceValid: e.target.checked }))}
                    />
                    <span>{t('datasetConverter.optSliceValid')}</span>
                  </label>
                  <label className="dc-check">
                    <input
                      type="checkbox"
                      checked={options.includeImages}
                      onChange={(e) => setOptions((o) => ({ ...o, includeImages: e.target.checked }))}
                    />
                    <span>{t('datasetConverter.optIncludeImages')}</span>
                  </label>
                  <label className="dc-field">
                    <span>{t('datasetConverter.outputDir')}</span>
                    <input
                      type="text"
                      value={options.outputDir}
                      placeholder={t('datasetConverter.outputDirPlaceholder')}
                      onChange={(e) => setOptions((o) => ({ ...o, outputDir: e.target.value }))}
                    />
                  </label>
                </fieldset>

                <div className="dc-convert-actions">
                  <button
                    type="button"
                    className="dc-btn primary"
                    disabled={busy || !detect?.format || !targetOptions.length}
                    onClick={() => void onConvert()}
                  >
                    {t('datasetConverter.convert')}
                  </button>
                </div>

                {convertMsg ? <p className="muted dc-convert-msg">{convertMsg}</p> : null}

                {spec?.conversionMatrix?.length ? (
                  <div className="dc-matrix">
                    <h3>{t('datasetConverter.matrixTitle')}</h3>
                    <p className="muted">{t('datasetConverter.matrixHint')}</p>
                    <ul>
                      {spec.conversionMatrix.map((edge) => (
                        <li key={`${edge.from}-${edge.to}`}>
                          <code>{t(formatLabelKey(edge.from))}</code>
                          <span aria-hidden="true"> → </span>
                          <code>{t(formatLabelKey(edge.to))}</code>
                          <span className="dc-edge-status">{edge.status}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            )}
          </div>
        </div>
      </main>

      <PathPickerModal
        open={pickerOpen}
        title={
          pickerTarget === 'episode'
            ? t('datasetConverter.pickEpisodeTitle')
            : t('datasetConverter.pickFileTitle')
        }
        value={pickerTarget === 'episode' ? episodePath : filePath}
        browseRoot="act"
        roots={{ act: actRoot, embody: actRoot }}
        pathKind={pickerTarget === 'episode' ? 'dir' : 'file'}
        onClose={() => setPickerOpen(false)}
        onConfirm={(p) => {
          if (pickerTarget === 'episode') setEpisodePath(p)
          else setFilePath(p)
          setPickerOpen(false)
        }}
      />
    </div>
  )
}
