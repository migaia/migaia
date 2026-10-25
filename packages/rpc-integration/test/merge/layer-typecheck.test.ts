import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Final package roots own their independent platform-neutral type proof configs. */
const packageRoots = {
  contract: resolve(dirname(fileURLToPath(import.meta.url)), '../../../rpc-contract'),
  core: resolve(dirname(fileURLToPath(import.meta.url)), '../../../rpc-host')
} as const
/**
 * Files the core type proof must include after the source move, spelled as `tsc --showConfig` lists
 * them.
 */
const coreFiles = [
  '../utils/types/host-globals.d.ts',
  './src/core/composed.ts',
  './src/core/endpoint-kernel.ts',
  './src/core/errors.ts',
  './src/core/error-text.ts',
  './src/core/transport.ts',
  './src/core/typing.ts',
  './src/core/adapters/message-port.ts'
]

/** Execute TypeScript exactly as the package-level proof script does. */
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
      const config = `tsconfig.${layer}.json`
      const check = tsc(layer, ['--noEmit', '-p', config])
      expect(check.status, `${config}\n${check.stdout}\n${check.stderr}`).toBe(0)
      const show = tsc(layer, ['--showConfig', '-p', config])
      expect(show.status, show.stderr).toBe(0)
      const parsed = JSON.parse(show.stdout) as {
        compilerOptions: { lib: string[]; types: string[] }
        files: string[]
      }
      expect(parsed.compilerOptions.lib).toEqual([layer === 'contract' ? 'es2024' : 'es2023'])
      expect(parsed.compilerOptions.types).toEqual([])
      expect(parsed.compilerOptions.lib).not.toContain('dom')
      if (layer === 'core') {
        for (const file of coreFiles) expect(parsed.files).toContain(file)
        expect(parsed.files).not.toContain('./src/core/adapters/memory.ts')
      } else {
        expect(
          parsed.files.every(
            (file) =>
              file.startsWith('./src/contract/') ||
              file === './test/types/runtime-encoding-globals.proof.d.ts'
          )
        ).toBe(true)
      }
      // Two full tsc processes per case exceed Vitest's 5 s default under `--coverage` load.
    },
    30_000
  )
})
