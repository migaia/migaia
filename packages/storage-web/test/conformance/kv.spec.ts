import { describe, expect, it } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { runConformance, type IConformanceHarness } from '@migaia/storage-contract/conformance'
import {
  kv,
  records,
  ttl,
  counter,
  vector,
  rdf,
  blob,
  type IStorageCapabilities
} from '@migaia/storage-contract'
import {
  createLocalTestStore,
  createSessionTestStore,
  createCookieTestStore,
  createIndexedDbTestStore,
  createMemoryTestStore
} from '../helpers/installed-backends.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.js'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document.js'

/** The same runner supplies assertions; the canonical suite owns every fresh case fixture. */
const harness: IConformanceHarness = { describe, expect, it }
/** Each declared field is independently compared with the backend's actual immutable facts. */
const textFeatures: IStorageCapabilities = {
  syncRead: true,
  binary: false,
  records: false,
  transactions: false,
  iteration: false,
  secondaryIndexes: false,
  changeFeed: false,
  maxValueBytes: 5 * 1024 * 1024,
  opaqueEntries: false
}

runConformance(harness, {
  name: 'localStorageHost',
  capabilities: [kv],
  features: textFeatures,
  create: () => createLocalTestStore({ namespace: 'conformance-local', storage: fakeWebStorage() })
})
runConformance(harness, {
  name: 'sessionStorageHost',
  capabilities: [kv],
  features: textFeatures,
  create: () =>
    createSessionTestStore({ namespace: 'conformance-session', storage: fakeWebStorage() })
})
runConformance(harness, {
  name: 'cookiesHost',
  capabilities: [kv],
  features: { ...textFeatures, maxValueBytes: 4096, opaqueEntries: true },
  create: () =>
    createCookieTestStore({ namespace: 'conformance-cookie', document: fakeCookieDocument() })
})
runConformance(harness, {
  name: 'indexedDbHost',
  capabilities: [kv, records, ttl],
  features: {
    ...textFeatures,
    syncRead: false,
    binary: true,
    records: true,
    transactions: true,
    iteration: true,
    secondaryIndexes: true,
    maxValueBytes: undefined
  },
  create: () =>
    createIndexedDbTestStore({
      factory: new IDBFactory(),
      keyRange: IDBKeyRange,
      dbName: 'conformance-indexed-db'
    })
})
runConformance(harness, {
  name: 'memory',
  capabilities: [kv, records, ttl, counter, vector, rdf, blob],
  features: {
    ...textFeatures,
    binary: true,
    records: true,
    transactions: true,
    iteration: true,
    changeFeed: true,
    maxValueBytes: undefined
  },
  create: () => createMemoryTestStore()
})
