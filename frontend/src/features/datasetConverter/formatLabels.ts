/** Pipeline step ids may include the CIR hub (`cir`). */
export function formatLabelKey(id: string): string {
  return `datasetConverter.format.${id}`
}
