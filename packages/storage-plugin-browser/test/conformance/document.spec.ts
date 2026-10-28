import { describe, expect, it } from 'vitest'
import { createLocalTestStore } from '../helpers/installed-backends.ts'
import { asRecordStore } from '@migaia/storage-contract'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.ts'

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
