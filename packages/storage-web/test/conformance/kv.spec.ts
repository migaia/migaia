import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { localStorage, sessionStorage, memoryStorage, cookies, indexedDb } from '../../src/backends'
import { fakeWebStorage } from '../../src/testing/fake-web-storage'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document'
import { kvConformance } from './suite'

kvConformance('localStorage', async () =>
  localStorage({
    namespace: `test-${Math.random().toString(36).slice(2)}`,
    storage: fakeWebStorage()
  })
)

kvConformance('sessionStorage', async () =>
  sessionStorage({
    namespace: `test-${Math.random().toString(36).slice(2)}`,
    storage: fakeWebStorage()
  })
)

kvConformance('memory', async () => memoryStorage())

kvConformance('cookies', async () =>
  cookies({
    namespace: `test-${Math.random().toString(36).slice(2)}`,
    document: fakeCookieDocument()
  })
)

kvConformance('indexedDb', async () =>
  indexedDb({
    factory: new IDBFactory(),
    keyRange: IDBKeyRange,
    dbName: `test-${Math.random().toString(36).slice(2)}`
  })
)
