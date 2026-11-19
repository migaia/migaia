#!/usr/bin/env bun
import { resolve } from 'node:path'
import { ExitCode, PARTOM_VERSION, failureExit, flag, parseArgs, type IArgs } from './args.ts'
import { delegateDoctor, shouldDelegateDoctor } from './delegate.ts'
import { doctorCommand } from './doctor-command.ts'
import { PartCliErrorCode } from './error-code.ts'
import { createPartCliError, PartCliText, serializeCause } from './errors.ts'
import { extractFile, readReport, writeDrafts, type IExtractedComponent } from './extract.ts'
import { importCommand } from './import/command.ts'
import { previewCommand } from './preview/server.ts'
import { typesCommand } from './types/command.ts'
import { usageCommand } from './usage/command.ts'
import { extractSummary, writeReport } from './extract/summary.ts'
import { probe, verify, type IPatternCounts } from './probe.ts'
import { Project } from './project.ts'

/** Runs `partom extract`. */
async function extract(args: IArgs): Promise<number> {
  if (args.flags.has('--usage')) return usageCommand(args)
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
  // `--verify` alone checks drafts written earlier, which may carry reviewed edits; only together
  // with `--probe` does one run write, probe and then verify.
  if (args.flags.has('--verify') && !args.flags.has('--probe'))
    return await verifyExisting(args, out)
  writeDrafts(components, out)
  /** Pattern counts of a probe run. */
  let pattern: IPatternCounts | undefined
  if (args.flags.has('--probe')) {
    /** Project for the check page. */
    const project = new Project(flag(args, '--project') ?? process.cwd())
    pattern = await probe(
      project,
      project.configPath(flag(args, '--config')),
      wrapped(components),
      out,
      flag(args, '--browser')
    )
  }
  /** Clean-component and pattern counts of this extraction. */
  const summary = extractSummary(components, pattern)
  writeReport(out, components, summary)
  console.log(JSON.stringify({ summary }))
  if (args.flags.has('--verify')) {
    /** Verification exit code. */
    const verified = await verifyExisting(args, out)
    if (verified !== ExitCode.ok) return verified
  }
  return failed ? ExitCode.problems : ExitCode.ok
}

/** Components wrapped as they are; substitutes are generated modules, not checked against originals. */
function wrapped(components: readonly IExtractedComponent[]): IExtractedComponent[] {
  return components.filter((entry) => entry.substitute === undefined)
}

/** Verifies the components of an existing report against their part-host rendering. */
async function verifyExisting(args: IArgs, out: string): Promise<number> {
  /** Project for the check page. */
  const project = new Project(flag(args, '--project') ?? process.cwd())
  /** Differences found. */
  const differences = await verify(
    project,
    project.configPath(flag(args, '--config')),
    wrapped(readReport(out)),
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

/**
 * Dispatches a command and maps errors to exit codes. In the compiled executable `doctor` runs in a
 * child Bun process (see `delegate.ts`); everything else runs in process.
 */
export async function main(argv: readonly string[]): Promise<number> {
  /** Parsed arguments. */
  const args = parseArgs(argv)
  try {
    if (args.flags.has('--version')) {
      console.log(PARTOM_VERSION)
      return ExitCode.ok
    }
    /** Command name. */
    const command = args.positional[0]
    if (command === 'doctor')
      return shouldDelegateDoctor() ? await delegateDoctor(argv) : await doctorCommand(args)
    if (command === 'extract') return await extract(args)
    if (command === 'preview') return await previewCommand(args)
    if (command === 'import') return importCommand(args)
    if (command === 'types') return await typesCommand(args)
    if (command === 'browser' && args.positional[1] === 'install') return await installBrowser()
    throw createPartCliError(PartCliErrorCode.usageInvalid, PartCliText.usage)
  } catch (error) {
    return failureExit(error)
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)))
