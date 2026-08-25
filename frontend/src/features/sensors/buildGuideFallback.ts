import type { BuildGuideResponse, ArmKinBuildStep } from './armApi'

const BUILD_STEPS: ArmKinBuildStep[] = [
  { step: 1, module: 'model.py', title: '统一数据模型', acceptance: '类型可独立 import，无算法依赖' },
  { step: 2, module: 'constants.py', title: '集中常量事实', acceptance: '数值与厂家手册 / XML 一致' },
  { step: 3, module: 'teach.py', title: '示教语义层', acceptance: 'mm↔m、欧拉序与现场一致' },
  { step: 4, module: 'dh.py', title: 'DH 数学核', acceptance: '全链 FK、中间连杆位姿' },
  { step: 5, module: 'config.py', title: '配置组装与缓存', acceptance: 'T_base 正交、cache 可清' },
  { step: 6, module: 'fk.py', title: '正运动学 API', acceptance: '示教 FK 误差 < 0.01 mm' },
  { step: 7, module: 'ik.py', title: 'IK 残差与求解', acceptance: '精确初值回环、扰动收敛' },
  { step: 8, module: 'robot_xml.py', title: 'XML 装载', acceptance: '与 constants 几何一致' },
  { step: 9, module: 'rmp.py', title: 'RMP 兼容壳', acceptance: 'pose16 与 fk_flange 对齐' },
  { step: 10, module: 'robot_fk.py', title: '对外聚合入口', acceptance: '单文件 import 可用' },
  { step: 11, module: '__init__.py', title: '包级导出', acceptance: 'from arm_kin import fk_flange' },
  { step: 12, module: 'tests/test_arm_kin.py', title: '自动化回归', acceptance: 'pytest 全绿' },
]

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
    return { ok: false, error: `静态构建说明加载失败 (HTTP ${res.status})` }
  }
  const markdown = await res.text()
  if (markdown.trim().startsWith('<')) {
    return { ok: false, error: '静态构建说明返回了 HTML 而非 Markdown' }
  }
  return {
    ok: true,
    sourcePath: '/arm_kin-build-guide.md',
    title: 'arm_kin 机械臂正逆解 — 构建思路与集成参考',
    markdown,
    sections: parseMarkdownSections(markdown),
    buildSteps: BUILD_STEPS,
  }
}
