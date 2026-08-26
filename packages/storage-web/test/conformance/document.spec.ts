import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { memoryStorage, localStorage, indexedDb } from '../../src/backends'
import { asRecordStore } from '../../src/types'
import { fakeWebStorage } from '../../src/testing/fake-web-storage'
import { recordConformance } from './suite'

recordConformance('memory', async () => memoryStorage())

recordConformance('indexedDb', async () =>
  indexedDb({
    factory: new IDBFactory(),
    keyRange: IDBKeyRange,
    dbName: `test-${Math.random().toString(36).slice(2)}`
  })
)

describe('L0-only 后端上的 L1 能力', () => {
  it('localStorage 在能力探测上声明 records: false', () => {
    const store = localStorage({ namespace: 'l1-check', storage: fakeWebStorage() })
    expect(store.capabilities.records).toBe(false)
  })

  it('asRecordStore(localStorage) 抛 UNSUPPORTED_CAPABILITY', () => {
    const store = localStorage({ namespace: 'l1-check', storage: fakeWebStorage() })
    expect(() => asRecordStore(store)).toThrow(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
  })
})
