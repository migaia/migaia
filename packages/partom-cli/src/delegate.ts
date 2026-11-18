import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PARTOM_VERSION } from './args.ts'

/**
 * Environment variable that makes a Bun single-file executable behave as the `bun` CLI. The
 * executable re-runs itself with it, so no separate Bun install is needed.
 */
const BE_BUN_VARIABLE = 'BUN_BE_BUN'

/**
 * Path of the doctor runner embedded in the executable, set by the platform entry before the CLI
 * loads. `undefined` when running from source, where doctor runs in process.
 */
let embeddedRunner: string | undefined

/** Records the embedded doctor runner; only executable entries call this. */
export function setDoctorRunner(path: string): void {
  embeddedRunner = path
}

/** Whether doctor must run in a child Bun process (compiled executable only). */
export function shouldDelegateDoctor(): boolean {
  return embeddedRunner !== undefined
}

/**
 * Copies the embedded runner to a versioned file in the system temp directory, rewriting it only
 * when the content differs. Compiled-mode module resolution cannot follow scoped, symlinked project
 * packages, so the runner must run from a real file.
 */
async function materializeRunner(embedded: string): Promise<string> {
  /** Directory of materialized runners. */
  const directory = join(tmpdir(), 'partom')
  /** Runner file for this version. */
  const target = join(directory, `doctor-runner-${PARTOM_VERSION}.js`)
  /** Embedded runner bytes. */
  const bytes = await Bun.file(embedded).bytes()
  if (!existsSync(target) || !Buffer.from(bytes).equals(readFileSync(target))) {
    mkdirSync(directory, { recursive: true })
    writeFileSync(target, bytes)
  }
  return target
}

/**
 * Command line and environment that run `partom doctor <args>` in a fresh child process: the
 * materialized runner under `BUN_BE_BUN` in the executable, or `bun src/cli.ts` from source. Each
 * child loads the current config and part definitions with no module cache.
 */
export async function doctorChildCommand(
  args: readonly string[]
): Promise<{ readonly cmd: readonly string[]; readonly env: Record<string, string | undefined> }> {
  if (embeddedRunner === undefined)
    return {
      cmd: [process.execPath, join(import.meta.dir, 'cli.ts'), 'doctor', ...args],
      env: { ...process.env }
    }
  return {
    cmd: [process.execPath, await materializeRunner(embeddedRunner), 'doctor', ...args],
    env: { ...process.env, [BE_BUN_VARIABLE]: '1' }
  }
}

/**
 * Runs doctor in a child process: the executable itself in `BUN_BE_BUN` mode, executing the
 * materialized runner in the current directory with inherited stdio. Resolves with the child's exit
 * code, so exit codes match an in-process run.
 */
export async function delegateDoctor(argv: readonly string[]): Promise<number> {
  /** Materialized runner script. */
  const script = await materializeRunner(embeddedRunner as string)
  /** Child Bun process. */
  const child = Bun.spawn([process.execPath, script, ...argv], {
    env: { ...process.env, [BE_BUN_VARIABLE]: '1' },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit'
  })
  return await child.exited
}
