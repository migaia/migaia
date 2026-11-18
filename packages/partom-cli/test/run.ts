import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/** Directory of the fixture projects. */
export const FIXTURES = join(import.meta.dirname, 'fixtures')
/** CLI source entry run through Bun. */
const CLI = join(import.meta.dirname, '..', 'src', 'cli.ts')

/** Result of one CLI run. */
export type IRun = { readonly code: number; readonly stdout: string; readonly stderr: string }

/** Runs the CLI with Bun in a fixture directory. */
export function partom(
  fixture: string,
  args: readonly string[],
  command: readonly string[] = ['bun', CLI]
): IRun {
  /** Child result. */
  const result = spawnSync(command[0] as string, [...command.slice(1), ...args], {
    cwd: join(FIXTURES, fixture),
    encoding: 'utf8',
    timeout: 240000
  })
  return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr }
}

/** Parses the JSON document printed on stdout. */
export function json<T>(run: IRun): T {
  return JSON.parse(run.stdout.trim().split('\n').pop() as string) as T
}
