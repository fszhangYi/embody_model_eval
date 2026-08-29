export type PageId =
  | 'home'
  | 'eval'
  | 'hub'
  | 'pipeline'
  | 'chat'
  | 'robots'
  | 'actPipeline'
  | 'modelAnalysis'
  | 'datasetConverter'
  | 'pi05Pipeline'
  | 'pi05Analysis'
  | 'pi05Setup'
  | 'sensors'

export type PageGroupId = 'overview' | 'eval' | 'act' | 'pi05' | 'tools' | 'hardware'

export interface PageDef {
  id: PageId
  path: string
  label: string
  short: string
  desc: string
}

export interface PageGroupDef {
  id: PageGroupId
  /** Default ZH labels; overridden via i18n. */
  label: string
  short: string
  pageIds: PageId[]
}

export const PAGES: PageDef[] = [
  {
    id: 'home',
    path: '/',
    label: '项目总览',
    short: '总览',
    desc: 'Embody 平台介绍与入口导航',
  },
  {
    id: 'eval',
    path: '/eval',
    label: '单轨迹评测',
    short: '评测',
    desc: '三臂对照、TCP / 观测 / 任务回放',
  },
  {
    id: 'hub',
    path: '/hub',
    label: 'Hub · 汇总',
    short: 'Hub',
    desc: '多 episode / 多模型对比',
  },
  {
    id: 'pipeline',
    path: '/pipeline',
    label: '模型数据流',
    short: '数据流',
    desc: 'ComfyUI 风格：训练 / 推理流向演示',
  },
  {
    id: 'chat',
    path: '/chat',
    label: 'AI Chat · Skills',
    short: 'Chat',
    desc: '选 skill、配 Agent 链接、发送诉求看回执',
  },
  {
    id: 'robots',
    path: '/robots',
    label: '机械臂 3D',
    short: '机型',
    desc: '下拉选择机型，Three.js 浏览 URDF',
  },
  {
    id: 'actPipeline',
    path: '/act-pipeline',
    label: 'ACT 数据流水线',
    short: 'ACT',
    desc: 'raw → HDF5 → 训练 → 推理 → embody JSON',
  },
  {
    id: 'modelAnalysis',
    path: '/model-analysis',
    label: 'ACT 模型分析',
    short: '分析',
    desc: '解析 ckpt 目录：stats / 优化器 / 权重 / 配置 / 曲线',
  },
  {
    id: 'datasetConverter',
    path: '/dataset-converter',
    label: '数据集格式转换',
    short: '转换',
    desc: '异构具身数据：预览常见文件并在 RLDS / LeRobot / HDF5 间转换',
  },
  {
    id: 'pi05Pipeline',
    path: '/pi05-pipeline',
    label: 'π0.5 数据流水线',
    short: 'π0.5',
    desc: 'raw → LeRobot → norm_stats → 训练 → 评测 → 推理服务',
  },
  {
    id: 'pi05Analysis',
    path: '/pi05-analysis',
    label: 'π0.5 模型分析',
    short: '分析',
    desc: '解析配置 / norm_stats / checkpoint 与路径健康',
  },
  {
    id: 'pi05Setup',
    path: '/pi05-setup',
    label: 'π0.5 环境说明',
    short: '环境',
    desc: '相对 ACT 的差异、路径检查与文档入口',
  },
  {
    id: 'sensors',
    path: '/sensors',
    label: '传感器状态',
    short: '传感器',
    desc: '机械臂 / 夹爪 / 触觉 / RealSense / 六维力 / Gello',
  },
]

/** Multi-level nav: related pages share a parent group. */
export const PAGE_GROUPS: PageGroupDef[] = [
  { id: 'overview', label: '总览', short: '总览', pageIds: ['home'] },
  { id: 'eval', label: '评测', short: '评测', pageIds: ['eval', 'hub'] },
  {
    id: 'act',
    label: 'ACT',
    short: 'ACT',
    pageIds: ['actPipeline', 'modelAnalysis', 'datasetConverter'],
  },
  {
    id: 'pi05',
    label: 'π0.5',
    short: 'π0.5',
    pageIds: ['pi05Pipeline', 'pi05Analysis', 'pi05Setup'],
  },
  { id: 'tools', label: '工具', short: '工具', pageIds: ['pipeline', 'chat'] },
  { id: 'hardware', label: '硬件', short: '硬件', pageIds: ['robots', 'sensors'] },
]

export function pageById(id: PageId): PageDef {
  return PAGES.find((p) => p.id === id) ?? PAGES[0]
}

export function groupForPage(pageId: PageId): PageGroupDef | undefined {
  return PAGE_GROUPS.find((g) => g.pageIds.includes(pageId))
}

/** Flat page order for Alt+N / adjacent shortcuts (follows group order). */
export function pagesInNavOrder(): PageDef[] {
  const byId = new Map(PAGES.map((p) => [p.id, p]))
  const ordered: PageDef[] = []
  for (const g of PAGE_GROUPS) {
    for (const id of g.pageIds) {
      const p = byId.get(id)
      if (p) ordered.push(p)
    }
  }
  return ordered
}
