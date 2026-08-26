import type { BuildGuideResponse, ArmKinBuildStep } from './armApi'
import { t } from '../../i18n/runtime'

function buildSteps(): ArmKinBuildStep[] {
  return Array.from({ length: 12 }, (_, i) => {
    const step = i + 1
    const modules = [
      'model.py',
      'constants.py',
      'teach.py',
      'dh.py',
      'config.py',
      'fk.py',
      'ik.py',
      'robot_xml.py',
      'rmp.py',
      'robot_fk.py',
      '__init__.py',
      'tests/test_arm_kin.py',
    ]
    return {
      step,
      module: modules[i],
      title: t(`sensors.guide.step${step}.title`),
      acceptance: t(`sensors.guide.step${step}.accept`),
    }
  })
}

export function parseMarkdownSections(md: string) {
  const sections: BuildGuideResponse['sections'] = []
  let current: { id: string; level: number; title: string; body: string } | null = null
  const buf: string[] = []
  for (const line of md.split('\n')) {
    if (line.startsWith('## ')) {
      if (current) {
        current.body = buf.join('\n').trim()
        sections.push(current)
      }
      const title = line.slice(3).trim()
      const slug = title
        .replace(/[^\w\u4e00-\u9fff]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase()
        .slice(0, 40)
      const idx = sections.length + 1
      current = { id: `sec-${idx}-${slug}`, level: 2, title, body: '' }
      buf.length = 0
    } else {
      buf.push(line)
    }
  }
  if (current) {
    current.body = buf.join('\n').trim()
    sections.push(current)
  }
  return sections
}

export async function loadBuildGuideFallback(): Promise<BuildGuideResponse> {
  const res = await fetch('/arm_kin-build-guide.md', { cache: 'no-store' })
  if (!res.ok) {
    return { ok: false, error: t('sensors.guide.staticHttpFail', { status: res.status }) }
  }
  const markdown = await res.text()
  if (markdown.trim().startsWith('<')) {
    return { ok: false, error: t('sensors.guide.staticHtmlErr') }
  }
  return {
    ok: true,
    sourcePath: '/arm_kin-build-guide.md',
    title: t('sensors.guide.staticTitle'),
    markdown,
    sections: parseMarkdownSections(markdown),
    buildSteps: buildSteps(),
  }
}
