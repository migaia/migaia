import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import legacyRoot from '../fixtures/legacy-tree-shaking-root.json'

/** New package root used to run the same tree-shaking measurement script. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../rpc-core')

/**
 * C4 re-pins the fresh six-package root: 198 modules, 977832 raw bytes and 239477 gzip bytes. The
 * prior C10 root was 191/959391/234430; seven actual owner/guard modules account for the module
 * increase. Raw and per-module attribution: docs/rpc/scratch/package-split/c4-tree-*.json. These
 * measured caps contain no headroom; the immutable legacy comparison remains unchanged.
 */
const allowedIncrease = {
  rawBytes: 385978 / legacyRoot.rawBytes,
  gzipBytes: 96565 / legacyRoot.gzipBytes
} as const

/** Exact C4 delta from the immutable 157-module legacy root, including both instance guards. */
const expectedModuleIncrease = 41

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
