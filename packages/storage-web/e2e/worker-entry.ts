import { cookiesHost } from '../src/cookies.js'
import { indexedDbHost } from '../src/indexed-db.js'
import { localStorageHost } from '../src/local-storage.js'
import { memoryStorageHost } from '../src/memory.js'

type IWorkerResult = {
  readonly memory: string | null
  readonly indexedDb: string | null
  readonly localStorageCode: string | undefined
  readonly cookiesCode: string | undefined
}

const getFailureCode = (factory: () => unknown): string | undefined => {
  try {
    factory()
    return undefined
  } catch (error) {
    return (error as { code?: string }).code
  }
}

self.onmessage = async (): Promise<void> => {
  const memory = memoryStorageHost()
  await memory.set('worker-memory', 'ok')
  const database = indexedDbHost({ dbName: `worker-${crypto.randomUUID()}` })
  await database.set('worker-indexeddb', 'ok')
  const result: IWorkerResult = {
    memory: await memory.get('worker-memory'),
    indexedDb: await database.get('worker-indexeddb'),
    localStorageCode: getFailureCode(() => localStorageHost()),
    cookiesCode: getFailureCode(() => cookiesHost({ namespace: 'worker' }))
  }
  await memory.dispose()
  await database.dispose()
  self.postMessage(result)
}
