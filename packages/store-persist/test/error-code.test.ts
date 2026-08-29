import { describe, expect, it } from 'vitest'
import { memoryStorage } from '@migaia/storage-web/memory'
import { createStore } from '@migaia/store-light'
import { persist } from '../src/light-index'
import {
  createStorePersistAbortError,
  StorePersistErrorCode,
  STORE_PERSIST_SOURCE
} from '../src/errors'

describe('store-persist error-code contract (E-T9)', () => {
  it('declares 8 unique codes under the package source', () => {
    const codes = Object.values(StorePersistErrorCode)
    expect(codes).toHaveLength(8)
    expect(new Set(codes).size).toBe(8)
    expect(STORE_PERSIST_SOURCE).toBe('@migaia/store-persist')
  })

  it('preserves DOMException AbortError type and cause through shared attachment', () => {
    const cause = new Error('disposed')
    const error = createStorePersistAbortError(
      StorePersistErrorCode.abortedByDispose,
      'aborted',
      cause
    )
    expect(error).toBeInstanceOf(DOMException)
    expect(error.name).toBe('AbortError')
    expect(error).toMatchObject({
      source: STORE_PERSIST_SOURCE,
      code: 'ABORTED_BY_DISPOSE',
      cause
    })
    expect(error.stack).toContain('aborted')
  })
})

describe('store-persist hydration failure boundary', () => {
  it('HYDRATE failure remains the original cause and blocks a subsequent write', async () => {
    const storage = memoryStorage()
    // Version mismatch makes hydration fail (no migrate provided).
    await storage.set('both-fail', JSON.stringify({ version: 5, state: { count: 1 } }))
    const store = createStore({ count: 0 })
    const handle = persist(store, { key: 'both-fail', storage, version: 1 })
    await expect(handle.ready).rejects.toThrow(/provide migrate/)

    // A failed hydration must not permit a write to race the unknown persisted state.
    storage.set = async () => {
      throw new Error('disk full')
    }
    store.count = 2
    await expect(handle.flush()).rejects.toThrow(/provide migrate/)
    expect(handle.error.value).toMatchObject({
      source: STORE_PERSIST_SOURCE,
      code: StorePersistErrorCode.envelopeInvalid
    })
    handle.dispose()
    store.$dispose()
  })
})
