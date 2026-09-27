import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Merged package root for the two platform-neutral type proofs. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
/** Files the core type proof must include after the S3 move. */
const coreFiles = [
  'src/core/ambient.d.ts',
  'src/core/composed.ts',
  'src/core/endpoint-kernel.ts',
  'src/core/errors.ts',
  'src/core/error-code.ts',
  'src/core/error-text.ts',
  'src/core/transport.ts',
  'src/core/typing.ts',
  'src/core/adapters/memory.ts',
  'src/core/adapters/message-port.ts'
]

/** Execute TypeScript exactly as the package-level proof script does. */
function tsc(args: string[]) {
  return spawnSync('pnpm', ['exec', 'tsc', ...args], {
    cwd: packageRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024
  })
}

describe('A3 platform-neutral type boundaries', () => {
  it.each(['contract', 'core'])(
    'typechecks %s without DOM or ambient host types',
    (layer) => {
      const config = `tsconfig.${layer}.json`
      const check = tsc(['--noEmit', '-p', config])
      expect(check.status, `${config}\n${check.stdout}\n${check.stderr}`).toBe(0)
      const show = tsc(['--showConfig', '-p', config])
      expect(show.status, show.stderr).toBe(0)
      const parsed = JSON.parse(show.stdout) as {
        compilerOptions: { lib: string[]; types: string[] }
        files: string[]
      }
      expect(parsed.compilerOptions.lib).toEqual([layer === 'contract' ? 'es2024' : 'es2023'])
      expect(parsed.compilerOptions.types).toEqual([])
      expect(parsed.compilerOptions.lib).not.toContain('dom')
      if (layer === 'core') {
        for (const file of coreFiles) expect(parsed.files).toContain(`./${file}`)
      } else {
        expect(parsed.files.every((file) => file.startsWith('./src/contract/'))).toBe(true)
      }
      // Two full tsc processes per case exceed Vitest's 5 s default under `--coverage` load.
    },
    30_000
  )
})
