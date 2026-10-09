import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import legacyRoot from '../fixtures/legacy-tree-shaking-root.json'

/** New package root used to run the same tree-shaking measurement script. */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * X14(iii) pins the exact K285 root measured in bundle-resolution/final.json, without headroom. The
 * required C9 runtime-api contract/normalize/provider-executor and C10 binary lane explain the
 * growth; size reduction belongs to rpc-core-refactor. Rendered-byte increases since C6:
 * provider-executor +29940, outbound-attachment +22164, runtime-api/binary +18088,
 * runtime-api/normalize +15081, middleware/error-text +8739, outbound-sender +7375. K285 real
 * base/final builds add outbound-envelope +721 and utils scheduler +162 rendered bytes; root raw
 * grows by exactly 883 bytes and gzip by 283 bytes. The final 179-module root is pinned without
 * headroom at 903733 raw bytes and 219350 gzip bytes (legacy deltas below).
 */
const allowedIncrease = {
  rawBytes: 311879 / legacyRoot.rawBytes,
  gzipBytes: 76438 / legacyRoot.gzipBytes
} as const

/** Exact C9/C10 module increase includes the canonical provider implementation identity move. */
const expectedModuleIncrease = 22

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
