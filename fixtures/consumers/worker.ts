import { dedicatedWorkerPlugin } from '@migaia/rpc-plugin-browser'
import { indexedDbBackendPlugin } from '@migaia/storage-plugin-browser/indexed-db'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { WorkerAdapter } from '@migaia/store-worker'
import { sharedInt32 } from '@migaia/store-shared'

declare const self: DedicatedWorkerGlobalScope

/** The current cold transport definition borrows the real Worker parent only during installation. */
const plugin = dedicatedWorkerPlugin({ worker: self })
void plugin

/** Worker declarations support IndexedDB and neutral memory without DOM storage globals. */
const storage = await createStorageHost({
  plugins: [indexedDbBackendPlugin(), memoryBackendPlugin()]
})
await storage.dispose()
void WorkerAdapter
void sharedInt32
