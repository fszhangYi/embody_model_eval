export type FieldType = 'path' | 'text' | 'number' | 'select' | 'checkbox'
export type PathKind = 'file' | 'dir'
export type BrowseRoot = 'act' | 'embody' | 'pi05'

export type FieldIo = 'input' | 'output' | 'config'

export interface StepField {
  key: string
  label: string
  type: FieldType
  io?: FieldIo
  default?: string | number | boolean
  options?: string[]
  pathKind?: PathKind
  browseRoot?: BrowseRoot
  hint?: string
  hidden?: boolean
}

export interface PipelineStep {
  id: string
  step: number
  title: string
  subtitle: string
  description: string
  variant?: boolean
  outputs?: string[]
  ui?: string
  fields: StepField[]
}

export interface PipelineSpec {
  ok: boolean
  paths: Record<string, string>
  browseRoots?: Record<BrowseRoot, string>
  steps: PipelineStep[]
  checks: Record<string, string | boolean>
  actLinkName?: string
  link?: ActLinkStatus
}

export interface ActLinkStatus {
  ok: boolean
  linked: boolean
  matches?: boolean
  linkPath?: string
  linkName?: string
  target?: string
  embodyRoot?: string
  actRoot?: string
  created?: boolean
  error?: string
}

export interface PipelineJob {
  id: string
  stepId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  params?: Record<string, unknown>
  command?: string
  exitCode?: number
  error?: string
  logPath?: string
  scriptLogPath?: string
  logTail?: string
  createdAt?: number
  startedAt?: number
  finishedAt?: number
}

export interface FsEntry {
  name: string
  path: string
  isDir: boolean
}

export interface FsListResponse {
  ok: boolean
  rootKey: string
  root: string
  path: string
  entries: FsEntry[]
}
