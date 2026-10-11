import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import legacyRoot from '../fixtures/legacy-tree-shaking-root.json'

/** New package root used to run the same tree-shaking measurement script. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../rpc-core')

/**
 * K289 re-pins the fresh root to exactly 200 modules, 982595 raw bytes and 241062 gzip bytes.
 * Main's C5 predecessor was 200/985824/240805. The error-chain move accounts for -3229 rendered
 * bytes, zero framing delta and +257 whole-bundle gzip bytes; verified shared Utils imports and
 * private binding substitutions account for derived changes. The complete 200-module evidence is in
 * docs/rpc/scratch/k289/repin/comparison.json. Neither byte cap contains headroom; the immutable
 * legacy comparison stays unchanged.
 */
const allowedIncrease = {
  rawBytes: 390741 / legacyRoot.rawBytes,
  gzipBytes: 98150 / legacyRoot.gzipBytes
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
