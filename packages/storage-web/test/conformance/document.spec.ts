import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { createMemoryTestStore } from '../helpers/installed-backends.js'
import { createLocalTestStore, createIndexedDbTestStore } from '../helpers/installed-backends.js'
import { asRecordStore } from '../../src/types'
import { fakeWebStorage } from '../../src/testing/fake-web-storage'
import { recordConformance } from './suite'

recordConformance('memory', async () => await createMemoryTestStore())

recordConformance('indexedDbHost', async () =>
  createIndexedDbTestStore({
    factory: new IDBFactory(),
    keyRange: IDBKeyRange,
    dbName: `test-${Math.random().toString(36).slice(2)}`
  })
)

describe('L0-only 后端上的 L1 能力', () => {
  it('localStorageHost 在能力探测上声明 records: false', async () => {
    const store = await createLocalTestStore({ namespace: 'l1-check', storage: fakeWebStorage() })
    expect(store.capabilities.records).toBe(false)
  })

  it('asRecordStore(localStorageHost) 抛 UNSUPPORTED_CAPABILITY', async () => {
    const store = await createLocalTestStore({ namespace: 'l1-check', storage: fakeWebStorage() })
    expect(() => asRecordStore(store)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
  })
})
