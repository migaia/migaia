import { expect, it } from 'vitest'
/** The built neutral entry publishes only the ordinary extension factory and its error identity. */
it('publishes the exact Archive runtime surface', async () => {
  const entry = await import('@migaia/storage-plugin-archive')
  expect(Object.keys(entry).sort()).toEqual(['ArchiveErrorCode', 'ERROR_SOURCE', 'archivePlugin'])
  expect(entry.ERROR_SOURCE).toBe('storage.backend.archive')
})
