import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** New package root used to run the same tree-shaking measurement script. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../rpc-core')

/**
 * Root cost measured on main 9cd4497a: 207 modules, 1006331 raw bytes, 248781 gzip bytes. Caps
 * allow 3% growth so ordinary merges pass without a re-pin; growth past a cap needs review and a
 * new measured baseline.
 */
const rootCap = {
  moduleCount: 213,
  rawBytes: 1036520,
  gzipBytes: 256244
} as const

describe('A9 root tree-shaking cost', () => {
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
