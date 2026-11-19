/**
 * `partom extract --usage <pages…> --parts <dir> --out <dir>`: converts page JSX into blueprints,
 * seed plugins, effect drafts, black-box parts and native-element parts. Only parses source; no
 * project module is loaded, so the compiled executable runs it directly.
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { parseSync } from 'oxc-parser'
import { ExitCode, flag, type IArgs } from '../args.ts'
import { PartCliErrorCode } from '../error-code.ts'
import { createPartCliError, PartCliText, serializeCause } from '../errors.ts'
import { readReport } from '../extract.ts'
import { usageSummary, type IUsageSummary } from '../extract/summary.ts'
import { WriteOutcome, writeGenerated } from '../import/ownership.ts'
import type { INode } from './ast.ts'
import {
  PageConverter,
  PartIndex,
  type IPageResult,
  type IUsageFile,
  type IUsageItem
} from './convert.ts'
import { effectsModule, htmlModule, seedModule } from './emit.ts'
import { PageScope } from './scope.ts'
import { UsageReason } from './text.ts'

/** Report printed on stdout. */
export type IUsageReport = {
  readonly pages: {
    readonly file: string
    readonly blueprint: string | null
    readonly seeds: Readonly<Record<string, unknown>>
  }[]
  readonly written: string[]
  readonly unchanged: string[]
  readonly takenOver: string[]
  readonly failed: string[]
  readonly uncertain: IUsageItem[]
  summary?: IUsageSummary
}

/** Files of one converted page, paths relative to the output root. */
function pageFiles(file: string, result: IPageResult): IUsageFile[] {
  /** File name of the page without extension. */
  const name = basename(file, extname(file))
  if (result.blueprint === undefined) return []
  return [
    { path: `${name}.blueprint.json`, body: JSON.stringify(result.blueprint, null, 2) },
    { path: `${name}.seed.ts`, body: seedModule(result.blueprintId, result.seeds) },
    { path: `effects/${name}.ts`, body: effectsModule(result.blueprintId, result.drafts) },
    ...result.blackboxes
  ]
}

/** Parses and converts one page; parse errors are PARSE_FAILED. */
function convertPage(file: string, parts: PartIndex, out: string): IPageResult {
  /** Source text. */
  const source = readFileSync(file, 'utf8')
  /** Parse result. */
  const parsed = parseSync(file, source)
  if (parsed.errors.length > 0)
    throw createPartCliError(
      PartCliErrorCode.parseFailed,
      PartCliText.parseFailed(file),
      parsed.errors
    )
  return new PageConverter(
    file,
    source,
    new PageScope(parsed.program as unknown as INode, source),
    parts,
    out
  ).convert()
}

/** Writes files and records each outcome in the report. */
function writeFiles(out: string, files: readonly IUsageFile[], report: IUsageReport): void {
  for (const file of files) {
    /** Outcome of the write. */
    const outcome = writeGenerated(out, file.path, file.body)
    if (outcome !== WriteOutcome.outside) report[outcome].push(file.path)
  }
}

/** Reads the component report of `--parts`; a missing report is CONFIG_INVALID (exit 2). */
function readParts(dir: string): PartIndex {
  /** Report path. */
  const path = join(resolve(dir), 'report.json')
  if (!existsSync(path))
    throw createPartCliError(PartCliErrorCode.configInvalid, PartCliText.partsReportMissing(path))
  return new PartIndex(readReport(resolve(dir)))
}

/** Runs the conversion and prints the report; exits 1 when a page failed to parse. */
export function usageCommand(args: IArgs): number {
  /** Output root. */
  const out = flag(args, '--out')
  /** Component extraction directory. */
  const partsDir = flag(args, '--parts')
  /** Page files. */
  const files = args.positional.slice(1)
  if (out === undefined || partsDir === undefined || files.length === 0)
    throw createPartCliError(PartCliErrorCode.usageInvalid, PartCliText.usage)
  /** Extracted components. */
  const parts = readParts(partsDir)
  /** Report being filled. */
  const report: IUsageReport = {
    pages: [],
    written: [],
    unchanged: [],
    takenOver: [],
    failed: [],
    uncertain: []
  }
  /** Converted pages. */
  const results: IPageResult[] = []
  /** Native tags used by any page, in first-use order. */
  const tags = new Set<string>()
  /** Page file names already converted; output files and blueprint ids derive from them. */
  const names = new Set<string>()
  for (const file of files) {
    /** Absolute page path. */
    const absolute = resolve(file)
    /** File name without extension. */
    const name = basename(absolute, extname(absolute))
    if (names.has(name)) {
      report.uncertain.push({ file: absolute, line: 1, reason: UsageReason.duplicatePage })
      continue
    }
    names.add(name)
    try {
      /** Converted page. */
      const result = convertPage(absolute, parts, resolve(out))
      results.push(result)
      for (const tag of result.tags) tags.add(tag)
      report.uncertain.push(...result.items)
      report.pages.push({
        file: absolute,
        blueprint: result.blueprint === undefined ? null : result.blueprintId,
        seeds: Object.fromEntries(result.seeds)
      })
      writeFiles(out, pageFiles(absolute, result), report)
    } catch (error) {
      report.failed.push(absolute)
      console.error(JSON.stringify(serializeCause(error)))
    }
  }
  /** Plugin name of the native-element parts, after the first converted page. */
  const htmlName = `${results.find((result) => result.blueprint !== undefined)?.blueprintId ?? 'page'}-html`
  writeFiles(out, [{ path: 'parts/html.ts', body: htmlModule(htmlName, tags) }], report)
  report.summary = usageSummary(results)
  console.log(JSON.stringify(report))
  return report.failed.length > 0 ? ExitCode.problems : ExitCode.ok
}
