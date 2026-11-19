import { mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { IIssue, IRemoteModuleRef } from '@migaia/part-contract'
import { CatalogRule, REMOTE_BUILD_TIMEOUT_MS } from './text.ts'

/** Outcome of building one draft module. */
export type IDraftBuild = {
  readonly module?: IRemoteModuleRef
  readonly bytes?: Uint8Array
  readonly issues: readonly IIssue[]
}

/** Command that runs `partom`: `bun <partom-cli>/src/cli.ts`, resolved from this app's packages. */
export function partomCommand(): string[] {
  /** Package manifest of the CLI. */
  const manifest = Bun.resolveSync('@migaia/partom-cli/package.json', import.meta.dir)
  return [process.execPath, join(dirname(manifest), 'src', 'cli.ts')]
}

/** Issue for a build that did not report, keeping the child's output as basis. */
function buildIssue(name: string, rule: string, basis: string): IIssue {
  return {
    address: '',
    facet: 'module',
    path: name,
    code: rule,
    rule,
    messageKey: rule,
    severity: 'error',
    basis
  }
}

/**
 * Builds one draft module with `partom remote build` in a request directory under
 * `<project>/.partom-tmp/drafts/`, with only `PATH` in the child environment and a 60-second limit.
 * The request directory is removed on every path.
 */
export async function buildDraftModule(
  projectDir: string,
  name: string,
  source: string
): Promise<IDraftBuild> {
  /** Parent of request directories. */
  const parent = join(projectDir, '.partom-tmp', 'drafts')
  mkdirSync(parent, { recursive: true })
  /** Request directory. */
  const dir = mkdtempSync(join(parent, 'request-'))
  try {
    /** Source root and output directory. */
    const root = join(dir, 'src')
    /** Entry file of the module. */
    const entry = join(root, name)
    mkdirSync(dirname(entry), { recursive: true })
    writeFileSync(entry, source)
    /** Output directory. */
    const out = join(dir, 'out')
    /** Child process. */
    const child = Bun.spawn(
      [
        ...partomCommand(),
        'remote',
        'build',
        entry,
        '--out',
        out,
        '--root',
        root,
        '--project',
        projectDir
      ],
      {
        cwd: projectDir,
        env: { PATH: process.env.PATH ?? '' },
        stdout: 'pipe',
        stderr: 'pipe'
      }
    )
    /** Kill timer. */
    const timer = setTimeout(() => child.kill(), REMOTE_BUILD_TIMEOUT_MS)
    /** Child output. */
    const stdout = await new Response(child.stdout).text()
    /** Exit code; a killed child has a signal and no report. */
    const code = await child.exited
    clearTimeout(timer)
    if (child.signalCode !== null)
      return { issues: [buildIssue(name, CatalogRule.buildTimeout, '')] }
    /** Parsed report. */
    let report: { modules: IRemoteModuleRef[]; issues: IIssue[] }
    try {
      report = JSON.parse(stdout) as typeof report
    } catch {
      return {
        issues: [
          buildIssue(
            name,
            CatalogRule.remoteBuild,
            `${code}: ${(await new Response(child.stderr).text()).slice(0, 500)}`
          )
        ]
      }
    }
    /** Built module of the entry. */
    const module = report.modules[0]
    if (module === undefined) return { issues: report.issues }
    return { module, bytes: readFileSync(join(out, module.url)), issues: [] }
  } finally {
    rmSync(dir, { recursive: true, force: true })
    removeIfEmpty(parent)
    removeIfEmpty(dirname(parent))
  }
}

/**
 * Removes a temporary parent directory when no other request still uses it, so builds leave the
 * project directory as they found it. A concurrent request may refill it; then it stays.
 */
function removeIfEmpty(path: string): void {
  try {
    rmdirSync(path)
  } catch (error) {
    // Not empty (another request is building) or already gone: both leave nothing to clean.
    /** Errno code of the failure. */
    const code = (error as { code?: unknown }).code
    if (code !== 'ENOTEMPTY' && code !== 'ENOENT') throw error
  }
}
