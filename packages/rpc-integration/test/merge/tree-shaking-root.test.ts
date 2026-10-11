import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import legacyRoot from '../fixtures/legacy-tree-shaking-root.json'

/** New package root used to run the same tree-shaking measurement script. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../rpc-core')

/**
 * C5 final re-pins the fresh six-package root: 200 modules, 985824 raw bytes and 240805 gzip bytes.
 * The C4 root was 198/977832/239477; K290 retains Utils string/object and C5 owner-only error
 * identity accounts for the measured byte change. Exact source, module and byte attribution lives
 * in docs/rpc/scratch/package-split/c5-tree-final-attribution.json. These measured caps contain no
 * headroom; the immutable legacy comparison remains unchanged.
 */
const allowedIncrease = {
  rawBytes: 393970 / legacyRoot.rawBytes,
  gzipBytes: 97893 / legacyRoot.gzipBytes
} as const

/** Exact C5 delta from the immutable 157-module legacy root, including canonical Utils owners. */
const expectedModuleIncrease = 43

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
