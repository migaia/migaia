/** Stable build-tool prerequisite diagnostic consumed by the source bundle CLI. */
export const missingBuildTool = 'Installed rolldown is required'
/** Budget diagnostics retain both measured bytes and the maintained ceiling. */
export function exceededBudget(actual: number, ceiling: number): string {
  return `gzip ${actual} exceeds ${ceiling}`
}
/** Unexpected non-Node externals would hide dependency bytes from the measured artifact. */
export function unexpectedExternal(path: string): string {
  return `unexpected external ${path}`
}
/** Han diagnostics identify the measured output offset and its original source candidates. */
export function hanOutput(index: number, text: string, sources: readonly string[]): string {
  return `Han at ${index}: ${text}; source candidates ${sources.join(', ')}`
}
/** Forbidden diagnostics name the actual resolved source input rather than its package spelling. */
export function forbiddenInput(path: string): string {
  return `forbidden ${path}`
}
