import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import legacyRoot from '../fixtures/legacy-tree-shaking-root.json'

/** New package root used to run the same tree-shaking measurement script. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * C10 pins the actual canonical root graph, including every dynamically emitted codec chunk.
 * Error-family ownership and bound ingress add 2430 raw bytes and 685 gzip bytes over C12. Receipt:
 * docs/rpc/scratch/core-refactor-impl/c10/graph-final/root.json. No headroom or A27 approval is
 * added.
 */
const allowedIncrease = {
  rawBytes: 367537 / legacyRoot.rawBytes,
  gzipBytes: 91518 / legacyRoot.gzipBytes
} as const

/** Exact C10 module increase includes the new canonical Error.name owner. */
const expectedModuleIncrease = 34

describe('A9 root tree-shaking cost', () => {
  it('keeps module count exact and both byte costs within reviewed caps', () => {
    const run = spawnSync('node', ['test/core/tree-shaking-baseline.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
    expect(run.status, `${run.stdout.slice(-1000)}\n${run.stderr.slice(-1000)}`).toBe(0)
    const measured = JSON.parse(run.stdout) as { root: typeof legacyRoot }
    expect(measured.root.moduleCount).toBe(legacyRoot.moduleCount + expectedModuleIncrease)
    for (const metric of ['rawBytes', 'gzipBytes'] as const) {
      expect(
        Math.abs(measured.root[metric] - legacyRoot[metric]) / legacyRoot[metric],
        metric
      ).toBeLessThanOrEqual(allowedIncrease[metric])
    }
  })
})
