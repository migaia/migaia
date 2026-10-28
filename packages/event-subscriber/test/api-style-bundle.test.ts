/** Event API style bundle and hot path. Cases preserve the existing behavioral assertions. */
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { resolve } from 'node:path'

it('proves the default hot path is style-free and stays within the bundle bound', () => {
  const packageRoot = resolve(import.meta.dirname, '..')
  const source = readFileSync(resolve(packageRoot, 'src/internal/channel-dispatch.ts'), 'utf8')
  const dispatchStart = source.indexOf('#dispatchValue(value: T)')
  const publishStart = source.indexOf('publish(initialValue: T)', dispatchStart)
  const hotPath = source.slice(dispatchStart, publishStart)
  expect(hotPath).not.toContain('style')
  expect(hotPath).not.toContain('projectEventApiStyle')

  const baseline = JSON.parse(
    readFileSync(resolve(packageRoot, 'test/fixtures/bundle-size-baseline.json'), 'utf8')
  ) as { readonly bytes: number; readonly absoluteLimitBytes: number }
  const observed = gzipSync(readFileSync(resolve(packageRoot, 'dist/index.js'))).byteLength
  expect(observed).toBeLessThanOrEqual(baseline.absoluteLimitBytes)
  expect(observed).toBeLessThanOrEqual(
    baseline.bytes + Math.max(Math.ceil(baseline.bytes * 0.1), 1024)
  )
})
