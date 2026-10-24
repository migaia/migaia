import { expect, it } from 'vitest'

/** Built package consumers must observe exactly the runtime names maintained by the public baseline. */
it('exports only the common public cache contract', async () => {
  const root = await import('@migaia/storage-plugin-cache')
  expect(Object.keys(root).sort()).toEqual([
    'CacheErrorCode',
    'CacheWriteMode',
    'ERROR_SOURCE',
    'cacheBackendKind',
    'cacheKey',
    'cachePlugin'
  ])
  expect(root.ERROR_SOURCE).toBe('storage.backend.cache')
})
