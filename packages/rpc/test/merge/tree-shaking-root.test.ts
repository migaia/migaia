import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import legacyRoot from '../fixtures/legacy-tree-shaking-root.json'

/** New package root used to run the same tree-shaking measurement script. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** X14 r32 pins replay and P2-A after canonical cleanup reuse and removing the extra wrapper. */
const allowedIncrease = {
  rawBytes: 98954 / legacyRoot.rawBytes,
  gzipBytes: 24848 / legacyRoot.gzipBytes
} as const

/** The six existing additions plus four private authentication/native modules remain exact. */
const expectedModuleIncrease = 10

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
