export type PageId = 'eval' | 'hub' | 'pipeline' | 'chat' | 'robots' | 'actPipeline' | 'sensors'

export interface PageDef {
  id: PageId
  path: string
  label: string
  short: string
  desc: string
}

export const PAGES: PageDef[] = [
  {
    id: 'eval',
    path: '/',
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
    id: 'sensors',
    path: '/sensors',
    label: '传感器状态',
    short: '传感器',
    desc: '机械臂 / 夹爪 / 触觉 / RealSense / 六维力 / Gello',
  },
]

export function pageById(id: PageId): PageDef {
  return PAGES.find((p) => p.id === id) ?? PAGES[0]
}
