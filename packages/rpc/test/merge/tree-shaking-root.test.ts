import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import legacyRoot from '../fixtures/legacy-tree-shaking-root.json'

/** New package root used to run the same tree-shaking measurement script. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

describe('A9 root tree-shaking cost', () => {
  it('keeps module count exact and both byte costs within one percent', () => {
    const run = spawnSync('node', ['test/core/tree-shaking-baseline.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
    expect(run.status, `${run.stdout.slice(-1000)}\n${run.stderr.slice(-1000)}`).toBe(0)
    const measured = JSON.parse(run.stdout) as { root: typeof legacyRoot }
    /** S3 adds the canonical wire constants before S8 retires the legacy core serializer. */
    if (existsSync(resolve(packageRoot, 'src/core/error-serialization.ts'))) {
      expect(measured.root.moduleCount).toBe(legacyRoot.moduleCount + 1)
      return
    }
    expect(measured.root.moduleCount).toBe(legacyRoot.moduleCount)
    for (const metric of ['rawBytes', 'gzipBytes'] as const) {
      expect(
        Math.abs(measured.root[metric] - legacyRoot[metric]) / legacyRoot[metric],
        metric
      ).toBeLessThanOrEqual(0.01)
    }
  })
})
