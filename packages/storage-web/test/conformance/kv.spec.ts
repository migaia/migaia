import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import {
  createLocalTestStore,
  createSessionTestStore,
  createCookieTestStore,
  createIndexedDbTestStore
} from '../helpers/installed-backends.js'
import { createMemoryTestStore } from '../helpers/installed-backends.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document'
import { kvConformance } from './suite'

kvConformance('localStorageHost', async () =>
  createLocalTestStore({
    namespace: `test-${Math.random().toString(36).slice(2)}`,
    storage: fakeWebStorage()
  })
)

kvConformance('sessionStorageHost', async () =>
  createSessionTestStore({
    namespace: `test-${Math.random().toString(36).slice(2)}`,
    storage: fakeWebStorage()
  })
)

kvConformance('memory', async () => await createMemoryTestStore())

kvConformance('cookiesHost', async () =>
  createCookieTestStore({
    namespace: `test-${Math.random().toString(36).slice(2)}`,
    document: fakeCookieDocument()
  })
)

kvConformance('indexedDbHost', async () =>
  createIndexedDbTestStore({
    factory: new IDBFactory(),
    keyRange: IDBKeyRange,
    dbName: `test-${Math.random().toString(36).slice(2)}`
  })
)
