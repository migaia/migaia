import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import {
  localStorageHost,
  sessionStorageHost,
  memoryStorageHost,
  cookiesHost,
  indexedDbHost
} from '../../src/backends'
import { fakeWebStorage } from '../../src/testing/fake-web-storage'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document'
import { kvConformance } from './suite'

kvConformance('localStorageHost', async () =>
  localStorageHost({
    namespace: `test-${Math.random().toString(36).slice(2)}`,
    storage: fakeWebStorage()
  })
)

kvConformance('sessionStorageHost', async () =>
  sessionStorageHost({
    namespace: `test-${Math.random().toString(36).slice(2)}`,
    storage: fakeWebStorage()
  })
)

kvConformance('memory', async () => memoryStorageHost())

kvConformance('cookiesHost', async () =>
  cookiesHost({
    namespace: `test-${Math.random().toString(36).slice(2)}`,
    document: fakeCookieDocument()
  })
)

kvConformance('indexedDbHost', async () =>
  indexedDbHost({
    factory: new IDBFactory(),
    keyRange: IDBKeyRange,
    dbName: `test-${Math.random().toString(36).slice(2)}`
  })
)
