import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Each runtime executes its built adapter in a separate real process. */
const folder = fileURLToPath(new URL('.', import.meta.url))
/** Missing runtimes remain skipped instead of being presented as platform PASS. */
const hasBun = spawnSync('bun', ['--version'], { encoding: 'utf8' }).status === 0
const hasDeno = spawnSync('deno', ['--version'], { encoding: 'utf8' }).status === 0

/** Parse only the probe's last JSON line; diagnostics remain separate. */
function probe(command: string, args: string[]) {
  const run = spawnSync(command, args, { encoding: 'utf8', timeout: 15_000 })
  expect(run.status, run.stderr).toBe(0)
  const line = run.stdout.trim().split('\n').at(-1)
  return JSON.parse(line ?? '') as {
    ok: boolean
    capabilities: Record<string, string>
  }
}

describe('native runtime launchers', () => {
  it.skipIf(!hasBun)(
    '[A8/A10] Bun runs a framed stdio child and authenticated TCP listener',
    () => {
      const result = probe('bun', [resolve(folder, 'fixtures/bun-parent.mjs')])
      expect(result.ok).toBe(true)
      expect(Object.keys(result.capabilities).sort()).toEqual([
        'bootstrap-fd',
        'bootstrap-stdin',
        'cpu-time-limit',
        'fault-isolation',
        'memory-limit',
        'permissions',
        'termination'
      ])
      expect(result.capabilities['bootstrap-stdin']).toBe('enforced')
      expect(result.capabilities['bootstrap-fd']).toBe('unsupported')
      expect(result.capabilities.termination).toBe('unsupported')
    }
  )

  it.skipIf(!hasDeno)(
    '[A8/A10] Deno runs a framed stdio child and authenticated TCP listener',
    () => {
      const result = probe('deno', ['run', '-A', resolve(folder, 'fixtures/deno-parent.mjs')])
      expect(result.ok).toBe(true)
      expect(Object.keys(result.capabilities).sort()).toEqual([
        'bootstrap-fd',
        'bootstrap-stdin',
        'cpu-time-limit',
        'fault-isolation',
        'memory-limit',
        'permissions',
        'termination'
      ])
      expect(result.capabilities['bootstrap-stdin']).toBe('enforced')
      expect(result.capabilities['bootstrap-fd']).toBe('unsupported')
      expect(result.capabilities.termination).toBe('unsupported')
    }
  )
})
