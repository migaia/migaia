/** `partom import <openapi> --out <dir>`: generates models, resources and the HTTP Feature. */
import { resolve } from 'node:path'
import { ExitCode, flag, type IArgs } from '../args.ts'
import { PartCliErrorCode } from '../error-code.ts'
import { createPartCliError, PartCliText } from '../errors.ts'
import { resolveFromNodeModules } from '../project.ts'
import { generatedFiles } from './emit.ts'
import { planImport } from './mapping.ts'
import { readOpenApi, type IUncertain } from './openapi.ts'
import { staleFiles, WriteOutcome, writeGenerated } from './ownership.ts'
import { ImportReason } from './text.ts'

/** Packages the generated code imports from the project; checked before anything is written. */
const GENERATED_DEPENDENCIES = [
  'zod',
  '@migaia/part-contract',
  '@migaia/part-host',
  '@migaia/plugin-host'
]

/** Report printed on stdout. */
export type IImportReport = {
  readonly models: number
  resources: number
  commands: number
  readonly written: string[]
  readonly unchanged: string[]
  readonly takenOver: string[]
  readonly stale: string[]
  readonly uncertain: readonly { readonly pointer: string; readonly reason: string }[]
}

/**
 * Throws PROJECT_DEPENDENCY_MISSING for the first package missing from the project's `node_modules`
 * chain. Bun's own resolver is not used here: it may resolve from its global cache, which the
 * project's build and type check would not see.
 */
function requireDependencies(dir: string): void {
  for (const name of GENERATED_DEPENDENCIES)
    if (resolveFromNodeModules(name, dir) === undefined)
      throw createPartCliError(
        PartCliErrorCode.projectDependencyMissing,
        PartCliText.projectDependencyMissing(name)
      )
}

/** Uncertain items with duplicates (same pointer and reason) removed, first occurrence kept. */
function distinct(items: readonly IUncertain[]): IUncertain[] {
  /** Keys already kept. */
  const seen = new Set<string>()
  /** Kept items. */
  const kept: IUncertain[] = []
  for (const item of items) {
    /** Identity of the item. */
    const key = `${item.reason}\u0000${item.pointer}`
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(item)
  }
  return kept
}

/** Runs the import and prints the report; exits 0 even with uncertain items. */
export function importCommand(args: IArgs): number {
  /** Output directory. */
  const out = flag(args, '--out')
  /** Input document. */
  const input = args.positional[1]
  if (out === undefined || input === undefined)
    throw createPartCliError(PartCliErrorCode.usageInvalid, PartCliText.usage)
  /** Parsed document. */
  const document = readOpenApi(resolve(input))
  requireDependencies(process.cwd())
  /** Import plan. */
  const plan = planImport(document)
  /** Report being filled. */
  const report: IImportReport = {
    models: plan.models.length,
    resources: 0,
    commands: 0,
    written: [],
    unchanged: [],
    takenOver: [],
    stale: [],
    uncertain: plan.uncertain
  }
  for (const tag of plan.tags) {
    report.resources += tag.resources.length
    for (const resource of tag.resources) report.commands += resource.commands.length
  }
  /** Files of this run. */
  const files = generatedFiles(plan)
  /** Paths generated in this run. */
  const current = new Set<string>()
  for (const file of files) {
    current.add(file.path)
    /** Outcome of the write. */
    const outcome = writeGenerated(out, file.path, file.body)
    if (outcome === WriteOutcome.outside)
      plan.uncertain.push({ pointer: '', reason: ImportReason.pathOutside })
    else report[outcome].push(file.path)
  }
  report.stale.push(...staleFiles(out, current))
  console.log(JSON.stringify({ ...report, uncertain: distinct(plan.uncertain) }))
  return ExitCode.ok
}
