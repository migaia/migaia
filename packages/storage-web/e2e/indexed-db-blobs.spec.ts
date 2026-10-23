import { expect, test } from '@playwright/test'

test('native Blob File clone retains metadata and shares record rollback after reopen', async ({
  page
}) => {
  await page.goto('/')
  /** A direct native File write distinguishes unavailable engine support from backend failures. */
  const nativeFailure = await page.evaluate(async () => {
    const name = 'native-file-admission-' + crypto.randomUUID()
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open(name)
      opening.onupgradeneeded = () => opening.result.createObjectStore('files')
      opening.onerror = () => reject(opening.error)
      opening.onsuccess = () => resolve(opening.result)
    })
    try {
      return await new Promise<{ name: string; code: number; message: string } | undefined>(
        (resolve) => {
          const transaction = database.transaction('files', 'readwrite')
          transaction.oncomplete = () => resolve(undefined)
          transaction.onabort = () => {
            const error = transaction.error!
            resolve({ name: error.name, code: error.code, message: error.message })
          }
          transaction.objectStore('files').put(new File(['native'], 'native.txt'), 'file')
        }
      )
    } finally {
      database.close()
      await new Promise<void>((resolve, reject) => {
        const deletion = indexedDB.deleteDatabase(name)
        deletion.onsuccess = () => resolve()
        deletion.onerror = () => reject(deletion.error)
      })
    }
  })
  if (nativeFailure) {
    if (
      nativeFailure.name !== 'UnknownError' ||
      nativeFailure.message !== 'Error preparing Blob/File data to be stored in object store'
    )
      throw new Error(JSON.stringify(nativeFailure))
    test.skip(
      true,
      'Environment: direct native IndexedDB File clone failed: ' + JSON.stringify(nativeFailure)
    )
  }
  expect(await page.evaluate(() => window.runBrowserIndexedDbBlobsScenario())).toEqual({
    metadata: true,
    contents: true,
    atomicRollback: true,
    isolated: true
  })
})
