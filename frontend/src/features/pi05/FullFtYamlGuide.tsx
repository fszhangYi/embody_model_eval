import { useEffect, useMemo, useState } from 'react'
import { useLocale } from '../../i18n/LocaleContext'
import { t } from '../../i18n/runtime'
import { inspectPi05Config } from './api'
import { FULL_FT_YAML_SECTIONS, type YamlParam, type YamlSection } from './fullFtYamlGuide'

function formatYamlValue(v: unknown): string {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function paramHelp(sec: YamlSection, key: string): YamlParam | undefined {
  return sec.params.find((p) => p.key === key)
}

/** Parse the selected full-FT YAML and explain each key with live values. */
export function Pi05FullFtYamlGuide({
  yamlPath,
  pi05Root,
}: {
  yamlPath: string
  pi05Root?: string
}) {
  const { locale } = useLocale()
  const zh = locale !== 'en'
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [fileName, setFileName] = useState('')
  const [yaml, setYaml] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    const path = yamlPath.trim()
    if (!path) {
      setYaml(null)
      setFileName('')
      setErr(t('pi05Setup.yamlGuide.needPath'))
      return
    }
    let cancelled = false
    setBusy(true)
    setErr('')
    void inspectPi05Config(path, pi05Root)
      .then((r) => {
        if (cancelled) return
        const data = r.yaml
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
          setYaml(null)
          setErr(t('pi05Setup.yamlGuide.parseFail'))
          return
        }
        setYaml(data as Record<string, unknown>)
        setFileName(r.name || path.split('/').pop() || path)
      })
      .catch((e: Error) => {
        if (cancelled) return
        setYaml(null)
        setErr(e.message || t('pi05Setup.yamlGuide.parseFail'))
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [yamlPath, pi05Root])

  const sections = useMemo(() => {
    if (!yaml) return []
    return FULL_FT_YAML_SECTIONS.map((sec) => {
      const block = yaml[sec.id]
      const entries: Array<{ key: string; value: string; help?: YamlParam }> = []
      if (block && typeof block === 'object' && !Array.isArray(block)) {
        for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
          entries.push({
            key,
            value: formatYamlValue(value),
            help: paramHelp(sec, key),
          })
        }
      }
      return { sec, entries }
    }).filter((x) => x.entries.length > 0)
  }, [yaml, zh])

  return (
    <article className="pi05s-yaml-guide compact">
      <header className="pi05s-yaml-guide-head">
        <h3>{t('pi05Setup.yamlGuide.title')}</h3>
        <p className="muted">
          {busy
            ? t('pi05Setup.yamlGuide.loading')
            : t('pi05Setup.yamlGuide.leadLive', { file: fileName || yamlPath || '—' })}
        </p>
        <code className="pi05s-detail-path" title={yamlPath}>
          {yamlPath || t('pi05Setup.pathPlaceholder')}
        </code>
      </header>
      {err ? <p className="pi05s-yaml-err">{err}</p> : null}
      {!busy && !err && sections.length === 0 ? (
        <p className="muted">{t('pi05Setup.yamlGuide.empty')}</p>
      ) : null}
      {sections.map(({ sec, entries }) => (
        <section key={sec.id} className="pi05s-yaml-section">
          <h4>{zh ? sec.titleZh : sec.titleEn}</h4>
          <p className="pi05s-yaml-intro muted">{zh ? sec.introZh : sec.introEn}</p>
          <dl className="pi05s-yaml-dl">
            {entries.map((row) => (
              <div key={row.key} className="pi05s-yaml-row">
                <dt>
                  <code>{row.key}</code>
                  <span className="pi05s-yaml-ex">{row.value}</span>
                </dt>
                <dd>
                  {row.help
                    ? zh
                      ? row.help.zh
                      : row.help.en
                    : t('pi05Setup.yamlGuide.unknownKey')}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </article>
  )
}
