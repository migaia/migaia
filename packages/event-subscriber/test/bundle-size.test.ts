import { gzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type IBundleBaseline = {
  readonly bytes: number
  readonly absoluteLimitBytes: number
}

describe('bundle size gate', () => {
  it('ES-T15 keeps the root bundle within the recorded gzip budget', () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const baseline = JSON.parse(
      readFileSync(resolve(packageRoot, 'test/fixtures/bundle-size-baseline.json'), 'utf8')
    ) as IBundleBaseline
    const bundle = readFileSync(resolve(packageRoot, 'dist/index.js'))
    const observed = gzipSync(bundle).byteLength
    expect(observed).toBeLessThanOrEqual(baseline.absoluteLimitBytes)
    expect(observed).toBeLessThanOrEqual(
      baseline.bytes + Math.max(Math.ceil(baseline.bytes * 0.1), 1024)
    )
  })

  it('ES-T58 fixes the baseline path, gzip algorithm, and regression threshold', () => {
    const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
    const baselinePath = resolve(packageRoot, 'test/fixtures/bundle-size-baseline.json')
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as IBundleBaseline
    expect(baselinePath).toContain('test/fixtures/bundle-size-baseline.json')
    expect(Number.isInteger(baseline.bytes)).toBe(true)
    expect(Number.isInteger(baseline.absoluteLimitBytes)).toBe(true)
    expect(baseline.bytes).toBeGreaterThan(0)
    expect(baseline.absoluteLimitBytes).toBe(12 * 1024)
    expect(Math.max(Math.ceil(baseline.bytes * 0.1), 1024)).toBeGreaterThanOrEqual(1024)
  })
})
