import { memoryTestFeatures } from '../test/helpers/memory-features.js'
import { indexedDbTestFeatures } from '../test/helpers/indexed-db-features.js'
import { walkErrorCauses } from '@migaia/utils/error'
import { STORAGE_BROWSER_SOURCE } from '../src/index.js'
import { cookieBackendPlugin } from '../src/cookies.js'
import { indexedDbBackendPlugin } from '../src/indexed-db.js'
import { localStorageBackendPlugin } from '../src/local-storage.js'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'

type IWorkerResult = {
  readonly memory: string | null
  readonly indexedDb: string | null
  readonly localStorageCode: string | undefined
  readonly cookiesCode: string | undefined
}

/** Worker admission failures come from the same public asynchronous installation as applications. */
const getFailureCode = async (
  factory: () => Promise<{ dispose(): Promise<void> }>
): Promise<string | undefined> => {
  try {
    const host = await factory()
    await host.dispose()
    return undefined
  } catch (error) {
    const native = walkErrorCauses(error).find(
      (cause) =>
        cause !== null &&
        typeof cause === 'object' &&
        'source' in cause &&
        cause.source === STORAGE_BROWSER_SOURCE
    )
    return (native as { code?: string } | undefined)?.code
  }
}

self.onmessage = async (): Promise<void> => {
  const memoryHost = await createStorageHost({
    plugins: [memoryBackendPlugin({}, memoryTestFeatures)]
  })
  const memory = memoryHost.backend('memory')
  await memory.set('worker-memory', 'ok')
  const databaseHost = await createStorageHost({
    plugins: [
      indexedDbBackendPlugin({ dbName: `worker-${crypto.randomUUID()}` }, indexedDbTestFeatures)
    ]
  })
  const database = databaseHost.backend('indexed-db')
  await database.set('worker-indexeddb', 'ok')
  const result: IWorkerResult = {
    memory: await memory.get('worker-memory'),
    indexedDb: await database.get('worker-indexeddb'),
    localStorageCode: await getFailureCode(() =>
      createStorageHost({ plugins: [localStorageBackendPlugin()] })
    ),
    cookiesCode: await getFailureCode(() =>
      createStorageHost({ plugins: [cookieBackendPlugin({ namespace: 'worker' })] })
    )
  }
  await memoryHost.dispose()
  await databaseHost.dispose()
  self.postMessage(result)
}
