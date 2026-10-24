import { describe, expect, it } from 'vitest'
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { defineEntity } from '@migaia/storage-host/entity'
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
  createIndexedDbBackfillTestStore,
  createMemoryTestStore
} from '../helpers/installed-backends.js'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.js'
import { fakeCookieDocument } from '../../src/testing/fake-cookie-document.js'

/** The same runner supplies assertions; the canonical suite owns every fresh case fixture. */
const harness: IConformanceHarness = { describe, expect, it, skip: it.skip }
/** Each declared field is independently compared with the backend's actual immutable facts. */
const textFeatures: IStorageCapabilities = {
  batch: false,
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
/** The original runner executes fresh fixtures serially and cleanup closes each original owner. */
let indexFixture: Awaited<ReturnType<typeof createIndexedDbBackfillTestStore>>
runConformance(harness, {
  name: 'indexedDbHost',
  capabilities: [kv, records, ttl],
  features: {
    ...textFeatures,
    syncRead: false,
    batch: true,
    binary: true,
    records: true,
    transactions: true,
    iteration: true,
    secondaryIndexes: true,
    maxValueBytes: undefined
  },
  create: async () => {
    indexFixture = await createIndexedDbBackfillTestStore({
      factory: new IDBFactory(),
      keyRange: IDBKeyRange,
      dbName: 'conformance-indexed-db'
    })
    return indexFixture.store
  },
  prepareSecondaryIndexes: async (store, handle) => {
    expect(store).toBe(indexFixture.store)
    const session = await indexFixture.capability.openBackfillSession(handle, {
      range: { lower: '', upper: '\uffff' },
      allowComplete: true
    })
    try {
      const batch = await session.readBatch()
      expect(batch.candidates).toEqual([])
      await session.commitBatch({
        generation: handle.generation,
        ownerToken: session.ownerToken,
        checkpoint: undefined,
        nextCheckpoint: undefined,
        endOfScan: true,
        projections: []
      })
    } finally {
      await session.release()
    }
    const repository = defineEntity<{ id: string }>({ name: handle.scope, key: 'id' }).connect(
      store
    )
    return (key: string) => repository.lockKey(key).key
  }
})
runConformance(harness, {
  name: 'memory',
  capabilities: [kv, records, ttl, counter, vector, rdf, blob],
  features: {
    ...textFeatures,
    batch: true,
    binary: true,
    records: true,
    transactions: true,
    iteration: true,
    changeFeed: true,
    maxValueBytes: undefined
  },
  create: () => createMemoryTestStore()
})
