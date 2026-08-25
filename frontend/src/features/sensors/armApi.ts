/** Arm kinematics API (backed by embody_model_eval built-in arm_kin). */

export interface ArmMetric {
  label: string
  value: string
}

export interface ArmPose {
  jointDeg: number[]
  tcpMm: number[]
  tcpRxyzDeg: number[]
  T: number[][]
  withinSoftLimits: boolean
  jointText: string
  tcpText: string
  rpyText: string
}

export interface ArmConfig {
  armKinRoot: string
  robotXml: string | null
  robotXmlExists: boolean
  manipulatorType: number
  linkLengthMm: number[]
  jointOffsetDeg: number[]
  jointDirection: number[]
  softMinDeg: number[]
  softMaxDeg: number[]
  teachPoseCount: number
  modelName: string
  backend: string
}

export interface ArmTeachSample {
  index: number
  jointDeg: number[]
  refMm: number[]
  fkMm: number[]
  errMm: number
  ok: boolean
}

export interface ArmTeachCheck {
  n: number
  maxErrMm: number
  meanErrMm: number
  passed: boolean
  thresholdMm: number
  samples: ArmTeachSample[]
}

export interface ArmIkRoundtrip {
  success: boolean
  nfev: number
  residualNorm: number
  message: string
  jointDeg: number[]
  jointErrDegL2: number
}

export interface ArmStatusResponse {
  ok: boolean
  available: boolean
  status: 'offline' | 'unknown' | 'ok' | 'warn' | 'error'
  id: string
  name: string
  model: string
  endpoint: string
  message?: string
  error?: string
  hardwareLinked?: boolean
  pose?: ArmPose
  config?: ArmConfig
  teachCheck?: ArmTeachCheck | null
  ikRoundtrip?: ArmIkRoundtrip | null
  metrics: ArmMetric[]
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  })
  const raw = await res.text()
  let data: T & { error?: string }
  try {
    data = JSON.parse(raw) as T & { error?: string }
  } catch {
    if (raw.trim().startsWith('<')) {
      throw new Error(
        'API 返回了 HTML 页面（多为 agent_server 未重启或 /api 路由未生效）。请执行: python3 scripts/agent_server.py 6006',
      )
    }
    throw new Error(`API 响应非 JSON: ${raw.slice(0, 120)}`)
  }
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`)
  }
  return data
}

export function fetchArmStatus() {
  return api<ArmStatusResponse>('/api/sensors/arm')
}

export function testArm() {
  return api<ArmStatusResponse>('/api/sensors/arm/test', {
    method: 'POST',
    body: '{}',
  })
}

export function refreshArm(body?: { jointDeg?: number[]; useTeachIndex?: number }) {
  return api<ArmStatusResponse>('/api/sensors/arm/refresh', {
    method: 'POST',
    body: JSON.stringify(body || {}),
  })
}

export interface ArmKinModule {
  file: string
  layer: string
  role: string
  depends: string[]
}

export interface ArmKinBuildStep {
  step: number
  module: string
  title: string
  acceptance: string
}

export interface ArmKinApiEntry {
  symbol: string
  module: string
  summary: string
  unit: string
}

export interface ArmKinDependency {
  name: string
  spec: string
  dev?: boolean
}

export interface ArmKinDhRow {
  joint: number
  thetaOffsetRad: number
  dM: number
  aM: number
  alphaRad: number
}

export interface ArmKinOverview {
  ok: boolean
  embodyRoot?: string
  armKinRoot: string
  armKinSrc?: string
  importError?: string
  paths?: {
    robotXml: string
    robotXmlExists: boolean
    buildGuide: string
    buildGuideExists: boolean
    readme: string
    tests: string
    pyproject: string
  }
  install?: {
    pipEditable: string
    pipRequirements: string
    pytest: string
    selfCheck: string
  }
  dependencies?: ArmKinDependency[]
  modules?: ArmKinModule[]
  apiCatalog?: ArmKinApiEntry[]
  buildSteps?: ArmKinBuildStep[]
  packageFiles?: { path: string; size: number }[]
  tree?: { path: string; type: string; size?: number }[]
  dhTable?: ArmKinDhRow[]
  integrationNote?: string
}

export interface BuildGuideSection {
  id: string
  level: number
  title: string
  body: string
}

export interface BuildGuideResponse {
  ok: boolean
  error?: string
  sourcePath?: string
  title?: string
  markdown?: string
  sections?: BuildGuideSection[]
  buildSteps?: ArmKinBuildStep[]
}

export interface ArmKinBundle {
  ok: boolean
  guide: BuildGuideResponse
  overview: ArmKinOverview
}

export function fetchArmKinBundle() {
  return api<ArmKinBundle>('/api/sensors/arm/kin')
}

export function fetchArmKinOverview() {
  return api<ArmKinOverview>('/api/sensors/arm/kin/overview')
}

export function fetchBuildGuide() {
  return api<BuildGuideResponse>('/api/sensors/arm/kin/build-guide')
}
