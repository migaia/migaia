import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** New package root used to run the same tree-shaking measurement script. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../rpc-core')

/**
 * Root cost re-pinned on 2026-10-13 at rpc-devtools closure 52e0537d: 210 modules, 1051638 raw
 * bytes, 257939 gzip bytes. The previous pin (main 9cd4497a: 207 / 1006331 / 248781) was exceeded
 * by the devtools probe emit sites in Core (+28840 raw bytes at hub a3a4645c, +1165 at closure);
 * root consumers carry them even without an installed probe. Reviewed and accepted by the user.
 * Caps allow 3% growth so ordinary merges pass without a re-pin; growth past a cap needs review and
 * a new measured baseline.
 */
const rootCap = {
  moduleCount: 216,
  rawBytes: 1083187,
  gzipBytes: 265677
} as const

describe('root tree-shaking cost', () => {
  it('keeps module count and both byte costs within the reviewed caps', () => {
    const run = spawnSync('node', ['test/core/tree-shaking-baseline.mjs'], {
      cwd: packageRoot,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024
    })
    expect(run.status, `${run.stdout.slice(-1000)}\n${run.stderr.slice(-1000)}`).toBe(0)
    const measured = JSON.parse(run.stdout) as { root: Record<keyof typeof rootCap, number> }
    for (const metric of ['moduleCount', 'rawBytes', 'gzipBytes'] as const) {
      expect(measured.root[metric], metric).toBeLessThanOrEqual(rootCap[metric])
    }
  })
})
