import { expect, it } from 'vitest'
/** The built neutral entry publishes only the ordinary extension factory. */
it('publishes the exact Archive runtime surface', async () => {
  const entry = await import('@migaia/storage-plugin-archive')
  expect(Object.keys(entry).sort()).toEqual(['archivePlugin'])
  /** The error domain and code table come from storage-contract. */
  expect((await import('@migaia/storage-contract/error-code')).STORAGE_ARCHIVE_ERROR_SOURCE).toBe(
    'storage.backend.archive'
  )
})
