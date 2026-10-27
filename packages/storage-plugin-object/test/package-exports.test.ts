import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
/** Export expectations remain under the repository's original baseline owner. */
const baseline = JSON.parse(
  readFileSync(
    new URL('../../../scripts/fixtures/public-exports.baseline.json', import.meta.url),
    'utf8'
  )
) as { readonly packages: Record<string, Record<string, readonly string[]>> }
describe('object package entries', () => {
  it('keeps the root and both native drivers behind their declared finite boundaries', async () => {
    const root = await import('@migaia/storage-plugin-object')
    expect(Object.keys(root).sort()).toEqual(
      baseline.packages['@migaia/storage-plugin-object']!['.']
    )
    expect(root).not.toHaveProperty('fsObjectDriver')
    expect(root).not.toHaveProperty('s3ObjectDriver')
    expect(root).not.toHaveProperty('objectPresignFeature')
    expect((await import('@migaia/storage-contract/error-code')).STORAGE_OBJECT_ERROR_SOURCE).toBe(
      'storage.backend.object'
    )
    const fs = await import('@migaia/storage-plugin-object/fs')
    const s3 = await import('@migaia/storage-plugin-object/s3')
    const feature = await import('@migaia/storage-plugin-object/features/presign')
    expect(Object.keys(fs)).toEqual(baseline.packages['@migaia/storage-plugin-object']!['./fs'])
    expect(Object.keys(s3)).toEqual(baseline.packages['@migaia/storage-plugin-object']!['./s3'])
    expect(Object.keys(feature)).toEqual(
      baseline.packages['@migaia/storage-plugin-object']!['./features/presign']
    )
  })
})
