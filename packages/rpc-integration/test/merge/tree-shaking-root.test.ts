import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import legacyRoot from '../fixtures/legacy-tree-shaking-root.json'

/** New package root used to run the same tree-shaking measurement script. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../rpc-core')

/**
 * Portable convergence re-pins the root to 207 modules, 1006331 raw bytes and 248781 gzip bytes.
 * Main1437c404 retains 200/982595/241062. Seven portable owners account for the module increase;
 * exact emitted regions add 23730 bytes and framing adds six newlines. The unchanged identity
 * declaration moves between regions, and only observed chunk filenames change in shared code.
 * Whole-bundle gzip increases by 7719 bytes. Full module/source/map and exact substitution evidence
 * is in docs/serialize/portable-converge/phase-b/rebase-1437c404/reviewed-repin-comparison.json.
 * Neither byte cap contains headroom; the immutable legacy comparison stays unchanged.
 */
const allowedIncrease = {
  rawBytes: 414477 / legacyRoot.rawBytes,
  gzipBytes: 105869 / legacyRoot.gzipBytes
} as const

/** Exact portable delta from the immutable 157-module legacy root, including canonical owners. */
const expectedModuleIncrease = 50

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
