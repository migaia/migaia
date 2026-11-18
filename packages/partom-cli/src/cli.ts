#!/usr/bin/env bun
import { resolve } from 'node:path'
import { formatJson, formatText, runDoctor } from './doctor.ts'
import { PartCliErrorCode } from './error-code.ts'
import { createPartCliError, PartCliText, serializeCause } from './errors.ts'
import { extractFile, readReport, writeDrafts, type IExtractedComponent } from './extract.ts'
import { probe, verify } from './probe.ts'
import { Project } from './project.ts'

/** Version printed by `--version`. */
const VERSION = '0.0.1'
/** Exit codes: success, problems found, configuration or environment error. */
const ExitCode = { ok: 0, problems: 1, environment: 2 } as const

/** Parsed command line. */
type IArgs = {
  readonly positional: readonly string[]
  readonly flags: ReadonlyMap<string, string | true>
}

/** Flags that take a value. */
const VALUE_FLAGS: ReadonlySet<string> = new Set([
  '--only',
  '--browser',
  '--config',
  '--out',
  '--project'
])

/** Parses argv into positional arguments and flags. */
function parseArgs(argv: readonly string[]): IArgs {
  /** Positional arguments. */
  const positional: string[] = []
  /** Flags. */
  const flags = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    /** Current token. */
    const token = argv[index] as string
    if (!token.startsWith('--')) positional.push(token)
    else if (VALUE_FLAGS.has(token)) {
      flags.set(token, argv[index + 1] ?? '')
      index += 1
    } else flags.set(token, true)
  }
  return { positional, flags }
}

/** String flag value. */
function flag(args: IArgs, name: string): string | undefined {
  /** Raw value. */
  const value = args.flags.get(name)
  return typeof value === 'string' ? value : undefined
}

/** Runs `partom doctor`. */
async function doctor(args: IArgs): Promise<number> {
  /** Project rooted at the current directory or `--project`. */
  const project = new Project(flag(args, '--project') ?? process.cwd())
  /** Doctor result. */
  const result = await runDoctor(project, {
    config: flag(args, '--config'),
    rendered: args.flags.has('--rendered'),
    only: flag(args, '--only'),
    browser: flag(args, '--browser')
  })
  console.log(args.flags.has('--json') ? formatJson(result) : formatText(result))
  return result.issues.some((issue) => issue.severity === 'error') ? ExitCode.problems : ExitCode.ok
}

/** Runs `partom extract`. */
async function extract(args: IArgs): Promise<number> {
  /** Output directory. */
  const out = flag(args, '--out')
  if (out === undefined || args.positional.length < 2)
    throw createPartCliError(PartCliErrorCode.usageInvalid, PartCliText.usage)
  /** Extracted components of every readable file. */
  const components: IExtractedComponent[] = []
  /** Whether any file failed to parse. */
  let failed = false
  for (const file of args.positional.slice(1)) {
    try {
      components.push(...extractFile(resolve(file)))
    } catch (error) {
      failed = true
      console.error(JSON.stringify(serializeCause(error)))
    }
  }
  if (args.flags.has('--verify')) return verifyExisting(args, out)
  writeDrafts(components, out)
  if (args.flags.has('--probe')) {
    /** Project for the check page. */
    const project = new Project(flag(args, '--project') ?? process.cwd())
    await probe(
      project,
      project.configPath(flag(args, '--config')),
      components,
      out,
      flag(args, '--browser')
    )
  }
  return failed ? ExitCode.problems : ExitCode.ok
}

/** Verifies the components of an existing report against their part-host rendering. */
async function verifyExisting(args: IArgs, out: string): Promise<number> {
  /** Project for the check page. */
  const project = new Project(flag(args, '--project') ?? process.cwd())
  /** Differences found. */
  const differences = await verify(
    project,
    project.configPath(flag(args, '--config')),
    readReport(out),
    flag(args, '--browser')
  )
  console.log(JSON.stringify({ differences }))
  return differences.length === 0 ? ExitCode.ok : ExitCode.problems
}

/** Runs `partom browser install` through Playwright's installer. */
async function installBrowser(): Promise<number> {
  /** Installer process; the user asked for this download explicitly. */
  const child = Bun.spawn(['bunx', 'playwright-core@1.62.1', 'install', 'chromium'], {
    stdout: 'inherit',
    stderr: 'inherit'
  })
  return (await child.exited) === 0 ? ExitCode.ok : ExitCode.environment
}

/** Dispatches a command and maps errors to exit codes. */
export async function main(argv: readonly string[]): Promise<number> {
  /** Parsed arguments. */
  const args = parseArgs(argv)
  try {
    if (args.flags.has('--version')) {
      console.log(VERSION)
      return ExitCode.ok
    }
    /** Command name. */
    const command = args.positional[0]
    if (command === 'doctor') return await doctor(args)
    if (command === 'extract') return await extract(args)
    if (command === 'browser' && args.positional[1] === 'install') return await installBrowser()
    throw createPartCliError(PartCliErrorCode.usageInvalid, PartCliText.usage)
  } catch (error) {
    console.error(JSON.stringify({ error: serializeCause(error) }))
    return ExitCode.environment
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
