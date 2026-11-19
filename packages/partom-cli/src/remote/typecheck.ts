import { existsSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import type { IIssue } from '@migaia/part-contract'
import { PartCliErrorCode } from '../error-code.ts'
import { createPartCliError, PartCliText } from '../errors.ts'
import { RemoteRule } from './text.ts'

/** One `tsc` diagnostic line: `file(line,col): error TSnnnn: message`. */
const DIAGNOSTIC = /^(.+)\((\d+),(\d+)\): error (TS\d+): (.*)$/

/** The project's `tsc` executable, found by walking up `node_modules/.bin`; undefined when absent. */
export function projectTsc(project: string): string | undefined {
  /** Directory being searched. */
  let directory = project
  while (true) {
    /** Candidate executable. */
    const candidate = join(directory, 'node_modules', '.bin', 'tsc')
    if (existsSync(candidate)) return candidate
    /** Parent directory. */
    const parent = dirname(directory)
    if (parent === directory) return undefined
    directory = parent
  }
}

/** Issues parsed from `tsc` output lines, with paths shown as the module name. */
function issuesOf(output: string, name: string, entry: string, tempDir: string): IIssue[] {
  /** Collected issues. */
  const issues: IIssue[] = []
  for (const line of output.split('\n')) {
    /** Parsed diagnostic. */
    const match = DIAGNOSTIC.exec(line.trim())
    if (match === null) continue
    /** File as `tsc` printed it, relative to the temporary tsconfig. */
    const file = join(tempDir, match[1] as string)
    issues.push({
      address: '',
      facet: 'module',
      path: `${file === entry ? name : relative(tempDir, file)}:${match[2]}:${match[3]}`,
      code: match[4] as string,
      rule: RemoteRule.types,
      messageKey: RemoteRule.types,
      severity: 'error',
      basis: match[5] as string
    })
  }
  return issues
}

/**
 * Type-checks one entry with the project's own `tsc`: writes a tsconfig in `tempDir` extending the
 * project's tsconfig (when present) with only this entry in `files`, and runs `tsc -p`. Throws
 * PROJECT_DEPENDENCY_MISSING when the project has no TypeScript.
 */
export function typecheckEntry(
  project: string,
  entry: string,
  name: string,
  tempDir: string
): IIssue[] {
  /** The project's compiler. */
  const tsc = projectTsc(project)
  if (tsc === undefined)
    throw createPartCliError(
      PartCliErrorCode.projectDependencyMissing,
      PartCliText.projectDependencyMissing('typescript')
    )
  /** Project tsconfig, extended when present. */
  const base = join(project, 'tsconfig.json')
  /** Generated config path. */
  const config = join(tempDir, 'tsconfig.json')
  writeFileSync(
    config,
    JSON.stringify({
      ...(existsSync(base) ? { extends: base } : {}),
      compilerOptions: { noEmit: true },
      files: [entry],
      include: []
    })
  )
  /** Compiler run. */
  const result = Bun.spawnSync([tsc, '-p', config], {
    cwd: tempDir,
    env: { PATH: process.env.PATH ?? '' }
  })
  return result.exitCode === 0 ? [] : issuesOf(result.stdout.toString(), name, entry, tempDir)
}
