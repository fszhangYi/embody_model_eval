export type DatasetFormatId =
  | 'open_x'
  | 'openvla'
  | 'octo'
  | 'rtx'
  | 'lerobot'
  | 'robomimic'
  | 'act'
  | 'aloha'
  | 'openpi'
  | 'diffusion_policy'
  | 'other'

export type ConverterTab = 'inspect' | 'convert'

export type PreviewKind = 'image' | 'json' | 'text' | 'stub' | 'error'

export interface ImagePreview {
  kind: 'image'
  mime?: string
  sizeBytes?: number
  dataUrl?: string
  tooLarge?: boolean
  maxBytes?: number
}

export interface FormatCatalogEntry {
  id: DatasetFormatId
  labelKey: string
  extensions: string[]
  containers: Array<'file' | 'dir'>
  descKey: string
}

export interface ConversionEdge {
  from: DatasetFormatId
  to: DatasetFormatId
  status: 'planned' | 'beta' | 'stable'
}

export interface ConvertResult {
  ok: boolean
  stub?: boolean
  error?: string
  sourcePath?: string
  sourceFormat?: DatasetFormatId
  targetFormat?: DatasetFormatId
  pipeline?: string[]
  intermediatePath?: string
  outputPath?: string
  outputDir?: string
  numSteps?: number
  plannedOutput?: string
}

export interface IntermediateFormatSpec {
  id: string
  labelKey: string
  descKey: string
}

export interface ConverterSpec {
  ok: boolean
  formats: FormatCatalogEntry[]
  inspectableExtensions: string[]
  conversionMatrix: ConversionEdge[]
  intermediateFormat?: IntermediateFormatSpec
  limits: { maxInspectChars: number; maxFieldChars: number; maxImagePreviewBytes?: number }
  features: { detect: boolean; inspect: string | boolean; convert: string | boolean }
}

export interface DetectResult {
  ok: boolean
  path: string
  container: 'file' | 'dir'
  format: DatasetFormatId
  confidence: 'high' | 'medium' | 'low'
  signals: string[]
  suggestedFiles?: string[]
  sampleListing?: string[]
  error?: string
}

export interface InspectResult {
  ok: boolean
  path: string
  format: DatasetFormatId
  extension: string | null
  previewKind?: PreviewKind
  implemented: boolean
  truncated: boolean
  preview: unknown
  error?: string
}

export interface ConvertOptions {
  includeImages?: boolean
  sliceValid?: boolean
  outputDir?: string
}

export function isImagePreview(preview: unknown): preview is ImagePreview {
  return (
    typeof preview === 'object' &&
    preview !== null &&
    'kind' in preview &&
    (preview as ImagePreview).kind === 'image'
  )
}
