/** Landing counts of extraction and usage conversion; counts only, no target judgement. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { IExtractedComponent } from '../extract.ts'
import type { IPageResult } from '../usage/convert.ts'

/** Pattern counts from `--probe`; null fields when no probe ran. */
export type IPatternSummary = {
  readonly patternChecked: number | null
  readonly patternPassed: number | null
}

/** Summary of a component extraction. */
export type IExtractSummary = IPatternSummary & {
  readonly components: number
  readonly componentsClean: number
}

/** Counts of an extraction. */
export function extractSummary(
  components: readonly IExtractedComponent[],
  pattern: { readonly checked: number; readonly passed: number } | undefined
): IExtractSummary {
  /** Components without uncertain items. */
  let clean = 0
  /** Entries that are parts; form-file wrappers such as `Form` and `FormField` get none. */
  let parts = 0
  for (const entry of components) {
    if (entry.partId === '') continue
    parts += 1
    if (entry.uncertain.length === 0) clean += 1
  }
  return {
    components: parts,
    componentsClean: clean,
    patternChecked: pattern?.checked ?? null,
    patternPassed: pattern?.passed ?? null
  }
}

/** Rewrites `report.json` with the components and the summary. */
export function writeReport(
  outDir: string,
  components: readonly IExtractedComponent[],
  summary: IExtractSummary
): void {
  writeFileSync(join(outDir, 'report.json'), JSON.stringify({ components, summary }, null, 2))
}

/** Summary of a usage conversion. */
export type IUsageSummary = {
  readonly usageNodes: number
  readonly usageConverted: number
  readonly blackboxes: number
}

/**
 * Counts of a usage conversion: JSX elements the pages contain (structural `Form` and `FormField`
 * wrappers excluded), those that became non-black-box nodes without uncertain items, and black
 * boxes.
 */
export function usageSummary(results: readonly IPageResult[]): IUsageSummary {
  /** Running totals. */
  const summary = { usageNodes: 0, usageConverted: 0, blackboxes: 0 }
  for (const result of results) {
    summary.usageNodes += result.usageNodes
    summary.usageConverted += result.usageConverted
    summary.blackboxes += result.blackboxes.length
  }
  return summary
}
