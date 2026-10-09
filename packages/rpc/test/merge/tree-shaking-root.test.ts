import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import legacyRoot from '../fixtures/legacy-tree-shaking-root.json'

/** New package root used to run the same tree-shaking measurement script. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * C12 pins the integrated canonical root graph, including every dynamically emitted codec chunk.
 * Held runtime resources add 1095 raw bytes and 271 gzip bytes over the C8 graph. Receipt:
 * docs/rpc/scratch/core-refactor-impl/c12-integration/graph-integrated/root.json. No headroom or
 * A27 approval is added.
 */
const allowedIncrease = {
  rawBytes: 365107 / legacyRoot.rawBytes,
  gzipBytes: 90833 / legacyRoot.gzipBytes
} as const

/** Exact C9/C10 module increase includes the canonical provider implementation identity move. */
const expectedModuleIncrease = 33

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
