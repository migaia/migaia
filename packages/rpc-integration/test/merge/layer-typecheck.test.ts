import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Final package roots own their independent platform-neutral type proof configs. */
const packageRoots = {
  contract: resolve(dirname(fileURLToPath(import.meta.url)), '../../../rpc-contract'),
  core: resolve(dirname(fileURLToPath(import.meta.url)), '../../../rpc-host')
} as const
/** Current owner files make the whole-package neutral type proof non-vacuous. */
const coreFiles = [
  '../utils/types/host-globals.d.ts',
  './src/host/rpc-host.ts',
  './src/host/error-owner.ts',
  './src/namespace/namespace.ts',
  './src/session/session.ts',
  './src/call/table.ts',
  './src/dispatch/dispatcher.ts',
  './src/forward/forwarder.ts'
]

/** Check the maintained package source through its actual neutral compiler configuration. */
function tsc(layer: keyof typeof packageRoots, args: string[]) {
  return spawnSync('pnpm', ['exec', 'tsc', ...args], {
    cwd: packageRoots[layer],
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  })
}

describe('platform-neutral type boundaries', () => {
  it.each(['contract', 'core'] as const)(
    'typechecks %s without DOM or ambient host types',
    (layer) => {
      const config = 'tsconfig.json'
      const check = tsc(layer, ['--noEmit', '-p', config])
      expect(check.status, `${config}\n${check.stdout}\n${check.stderr}`).toBe(0)
      const show = tsc(layer, ['--showConfig', '-p', config])
      expect(show.status, show.stderr).toBe(0)
      const parsed = JSON.parse(show.stdout) as {
        compilerOptions: { lib: string[]; types: string[] }
        files: string[]
      }
      expect(parsed.compilerOptions.lib).toEqual(['es2023', 'esnext.disposable'])
      expect(parsed.compilerOptions.types).toEqual([])
      expect(parsed.compilerOptions.lib).not.toContain('dom')
      if (layer === 'core') {
        for (const file of coreFiles) expect(parsed.files).toContain(file)
        expect(parsed.files).not.toContain('./src/core/composed.ts')
      } else {
        expect(
          parsed.files.every(
            (file) => file.startsWith('./src/') || file === '../utils/types/host-globals.d.ts'
          )
        ).toBe(true)
        expect(parsed.files).toContain('./src/wire/index.ts')
        expect(parsed.files).toContain('./src/interfaces/index.ts')
        expect(parsed.files).toContain('./src/error-code.ts')
      }
      // Two full tsc processes per case exceed Vitest's 5 s default under `--coverage` load.
    },
    30_000
  )
})
