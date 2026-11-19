import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { isModuleName, type IIssue, type IRemoteModuleRef } from '@migaia/part-contract'
import { ExitCode, flag, type IArgs } from '../args.ts'
import { PartCliErrorCode } from '../error-code.ts'
import { createPartCliError, PartCliText, serializeCause } from '../errors.ts'
import { buildEntry } from './build.ts'
import { contractTest } from './contract.ts'
import { checkRemoteRules, parseErrors } from './rules.ts'
import { RemoteRule, RemoteText } from './text.ts'
import { typecheckEntry } from './typecheck.ts'

/** Directory inside the project that holds temporary work, so bare imports resolve from it. */
export const PROJECT_TEMP_DIR = '.partom-tmp'

/** Inputs of one remote build run. */
export type IRemoteBuildInput = {
  readonly entries: readonly string[]
  readonly out: string
  readonly root: string
  readonly project: string
}

/** Outcome of one remote build run. */
export type IRemoteBuildResult = {
  readonly modules: readonly IRemoteModuleRef[]
  readonly failed: readonly string[]
  readonly issues: readonly IIssue[]
}

/** True when `path` equals `directory` or lies inside it. */
function inside(directory: string, path: string): boolean {
  return path === directory || path.startsWith(`${directory}${sep}`)
}

/** Issue for an entry that fails before any check (outside the root, bad name, parse error). */
function entryIssue(path: string, rule: string, basis: string): IIssue {
  return {
    address: '',
    facet: 'module',
    path,
    code: rule,
    rule,
    messageKey: rule,
    severity: 'error',
    basis
  }
}

/** Placement problem of an entry: outside the root or the project, or an invalid module name. */
function placementIssue(input: IRemoteBuildInput, entry: string, name: string): IIssue | undefined {
  if (!inside(input.project, input.root))
    return entryIssue(
      entry,
      PartCliErrorCode.remoteEntryOutside,
      RemoteText.entryOutside(input.root, input.project)
    )
  if (!inside(input.root, entry))
    return entryIssue(
      entry,
      PartCliErrorCode.remoteEntryOutside,
      RemoteText.entryOutside(entry, input.root)
    )
  if (!isModuleName(name))
    return entryIssue(entry, PartCliErrorCode.remoteEntryOutside, RemoteText.nameInvalid(name))
  return undefined
}

/**
 * Checks and builds one entry inside its own temporary directory: parse and code rules, type check,
 * build, contract test. Returns the module reference, or the issues that stopped it.
 */
async function buildOne(
  input: IRemoteBuildInput,
  entry: string,
  name: string,
  tempDir: string
): Promise<{ readonly module?: IRemoteModuleRef; readonly issues: readonly IIssue[] }> {
  /** Entry source. */
  const source = readFileSync(entry, 'utf8')
  /** Parse failures. */
  const parse = parseErrors(name, source)
  if (parse.length > 0)
    return { issues: parse.map((message) => entryIssue(name, RemoteRule.parse, message)) }
  /** Rule and type issues. */
  const issues = [
    ...checkRemoteRules(name, source),
    ...typecheckEntry(input.project, entry, name, tempDir)
  ]
  if (issues.length > 0) return { issues }
  /** Built bytes and hashes. */
  const built = await buildEntry(entry, input.project)
  /** Contract test result. */
  const contract = await contractTest(input.project, tempDir, built.bytes, name)
  if (contract.issues.length > 0) return { issues: contract.issues }
  mkdirSync(join(input.out, 'm'), { recursive: true })
  writeFileSync(join(input.out, 'm', built.file), built.bytes)
  return {
    module: {
      name,
      id: built.id,
      url: `m/${built.file}`,
      integrity: built.integrity,
      exports: contract.exports
    },
    issues: []
  }
}

/**
 * Runs the remote pipeline over every entry independently. Each entry gets its own temporary
 * directory under `<project>/.partom-tmp/`, removed on every path. Writes `<out>/modules.json`
 * (entry order) and the built files under `<out>/m/`.
 */
export async function remoteBuild(input: IRemoteBuildInput): Promise<IRemoteBuildResult> {
  /** Built references in entry order. */
  const modules: IRemoteModuleRef[] = []
  /** Failed entries. */
  const failed: string[] = []
  /** Every issue. */
  const issues: IIssue[] = []
  /** Temporary root inside the project. */
  const tempRoot = join(input.project, PROJECT_TEMP_DIR)
  mkdirSync(tempRoot, { recursive: true })
  for (const raw of input.entries) {
    /** Absolute entry path. */
    const entry = resolve(raw)
    /** Module name relative to the root, `/`-separated. */
    const name = relative(input.root, entry).split(sep).join('/')
    /** Placement problem, if any. */
    const placement = placementIssue(input, entry, name)
    if (placement !== undefined) {
      failed.push(raw)
      issues.push(placement)
      continue
    }
    /** This entry's temporary directory. */
    const tempDir = mkdtempSync(join(tempRoot, 'build-'))
    try {
      /** Outcome of the entry. */
      const outcome = await buildOne(input, entry, name, tempDir)
      if (outcome.module === undefined) failed.push(raw)
      else modules.push(outcome.module)
      issues.push(...outcome.issues)
    } finally {
      rmSync(tempDir, { recursive: true, force: true })
    }
  }
  if (readdirSync(tempRoot).length === 0) rmSync(tempRoot, { recursive: true, force: true })
  mkdirSync(input.out, { recursive: true })
  writeFileSync(join(input.out, 'modules.json'), `${JSON.stringify(modules, null, 2)}\n`)
  return { modules, failed, issues }
}

/** Runs `partom remote build <entries…> --out <dir> --root <dir> [--project <dir>]`. */
export async function remoteCommand(args: IArgs): Promise<number> {
  /** Output directory. */
  const out = flag(args, '--out')
  /** Remote module root. */
  const root = flag(args, '--root')
  /** Entries after `remote build`. */
  const entries = args.positional.slice(2)
  if (
    args.positional[1] !== 'build' ||
    out === undefined ||
    root === undefined ||
    entries.length === 0
  )
    throw createPartCliError(PartCliErrorCode.usageInvalid, PartCliText.usage)
  try {
    /** Run result. */
    const result = await remoteBuild({
      entries,
      out: resolve(out),
      root: resolve(root),
      project: resolve(flag(args, '--project') ?? process.cwd())
    })
    console.log(JSON.stringify(result))
    return result.failed.length === 0 ? ExitCode.ok : ExitCode.problems
  } catch (error) {
    if ((error as { code?: unknown }).code !== PartCliErrorCode.projectDependencyMissing)
      throw error
    console.error(JSON.stringify({ error: serializeCause(error) }))
    return ExitCode.environment
  }
}
