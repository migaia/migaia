import { createStorageHost } from '@migaia/storage-host'
import { storageLogStore } from '@migaia/storage-host/journal'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'

/** Each page retains only its own original host and borrowed log until explicit fixture cleanup. */
let current:
  | {
      readonly close: () => Promise<void>
      readonly append: () => Promise<readonly number[]>
      readonly lastSeq: () => Promise<number>
    }
  | undefined

/** Actual native Web Locks must exclude a second page before it can read a cached journal index. */
async function openIndexedDbJournal(dbName: string, wrapFactory = false): Promise<number | string> {
  /** This distinct legal factory object still forwards the exact same persistent browser database. */
  const factory: IDBFactory | undefined = wrapFactory
    ? {
        open: (name, version) => indexedDB.open(name, version),
        deleteDatabase: (name) => indexedDB.deleteDatabase(name),
        databases: () => indexedDB.databases(),
        cmp: (first, second) => indexedDB.cmp(first, second)
      }
    : undefined
  const host = await createStorageHost({ plugins: [indexedDbBackendPlugin({ dbName, factory })] })
  try {
    const log = await storageLogStore(host, 'indexed-db', { prefix: 'history' })
    current = {
      append: () => log.append([{ kind: 'browser', payload: null }]),
      lastSeq: () => log.lastSeq(),
      close: async () => {
        await log.dispose()
        await host.dispose()
      }
    }
    return await log.lastSeq()
  } catch (error) {
    await host.dispose()
    return (error as { code: string }).code
  }
}

/** Fixture calls preserve actual native commit/reopen behavior without manufacturing a lock port. */
async function appendIndexedDbJournal() {
  const appended = await current!.append()
  return { appended, lastSeq: await current!.lastSeq() }
}

/** Release through the original resource owner; the next page must then acquire that exact lock. */
async function closeIndexedDbJournal() {
  const previous = current
  current = undefined
  await previous?.close()
}

/** Declaration merging adds only the existing browser harness's callable fixture hooks. */
declare global {
  interface Window {
    openIndexedDbJournal: typeof openIndexedDbJournal
    appendIndexedDbJournal: typeof appendIndexedDbJournal
    closeIndexedDbJournal: typeof closeIndexedDbJournal
  }
}
Object.assign(window, { openIndexedDbJournal, appendIndexedDbJournal, closeIndexedDbJournal })
