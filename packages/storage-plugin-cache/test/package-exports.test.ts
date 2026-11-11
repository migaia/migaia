import { expect, it } from 'vitest'

/** Built package consumers must observe exactly the runtime names maintained by the public baseline. */
it('exports only the declared cache entries', async () => {
  const root = await import('@migaia/storage-plugin-cache')
  expect(Object.keys(root).sort()).toEqual([
    'CacheErrorCode',
    'CacheWriteMode',
    'STORAGE_CACHE_ERROR_SOURCE',
    'cacheBackendKind',
    'cacheKey',
    'cachePlugin'
  ])
  const feature = await import('@migaia/storage-plugin-cache/features/semantic')
  expect(Object.keys(feature)).toEqual(['semanticCacheFeature'])
  expect(root).not.toHaveProperty('semanticCacheFeature')
  expect(root.STORAGE_CACHE_ERROR_SOURCE).toBe('storage.backend.cache')
  expect(await import('@migaia/storage-contract/error-code')).not.toHaveProperty(
    'STORAGE_CACHE_ERROR_SOURCE'
  )
})
