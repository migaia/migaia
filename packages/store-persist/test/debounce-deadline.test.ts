import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { memoryStorageHost } from '@migaia/storage-web/memory'
import { persist } from '../src/light-index.js'
import { StorePersistErrorCode } from '../src/error-code.js'

describe('bounded persistence debounce', () => {
  it('enqueues the latest continuous change at maxWait and starts a fresh next window', async () => {
    /** The persistence timer is fully controlled without changing the reactive graph clock. */
    const scheduler = createManualScheduler()
    /** Existing runtime flush supplies real store notifications. */
    const runtime = createRuntime()
    /** Writes carry real encoded envelopes through the memory storage adapter. */
    const storage = memoryStorageHost()
    /** Captures the actual values delivered, not only timer counts. */
    const written: unknown[] = []
    /** Original storage method remains the underlying delivery owner. */
    const set = storage.set
    storage.set = async (key, value, context) => {
      written.push(JSON.parse(String(value)).state)
      await set(key, value, context)
    }
    /** The store changes faster than the quiet interval for the entire first window. */
    const store = createStore({ count: 0 }, { runtime })
    /** Optional maximum starts with the first post-hydration notification. */
    const handle = persist(store, {
      key: 'bounded',
      storage,
      debounceMs: 100,
      maxWaitMs: 250,
      scheduler
    })
    await handle.ready
    try {
      store.count = 1
      runtime.flush()
      scheduler.advance(90)
      store.count = 2
      runtime.flush()
      scheduler.advance(90)
      store.count = 3
      runtime.flush()
      scheduler.advance(69)
      expect(written).toEqual([])
      scheduler.advance(1)
      await vi.waitFor(() => expect(written).toEqual([{ count: 3 }]))
      expect(scheduler.pendingCount).toBe(0)
      store.count = 4
      runtime.flush()
      scheduler.advance(100)
      await vi.waitFor(() => expect(written).toEqual([{ count: 3 }, { count: 4 }]))
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      handle.dispose()
      await store.$dispose()
    }
  })

  it.each([false, true])(
    'retains the final snapshot and exposes final write failure=%s',
    async (reject) => {
      /** Disposal must cancel the pending timer and snapshot before the store is released. */
      const scheduler = createManualScheduler()
      /** Local graph makes the subscription notification explicit. */
      const runtime = createRuntime()
      /** Successful final writes use the same real storage as normal writes. */
      const storage = memoryStorageHost()
      /** The exact adapter error remains the public writeError. */
      const failure = new Error('final storage write fixture')
      if (reject)
        storage.set = async () => {
          throw failure
        }
      /** Pending debounce owns the latest value that must survive disposal. */
      const store = createStore({ count: 0 }, { runtime })
      /** An unexpired maximum/quiet window still owes one final write. */
      const handle = persist(store, {
        key: 'final',
        storage,
        debounceMs: 100,
        maxWaitMs: 250,
        scheduler
      })
      await handle.ready
      store.count = 7
      runtime.flush()
      expect(scheduler.pendingCount).toBe(1)
      handle.dispose()
      await store.$dispose()
      expect(scheduler.pendingCount).toBe(0)
      if (reject) await vi.waitFor(() => expect(handle.writeError.value).toBe(failure))
      else
        await vi.waitFor(async () =>
          expect(JSON.parse(String(await storage.get('final'))).state).toEqual({ count: 7 })
        )
      expect(handle.disposed).toBe(true)
    }
  )

  it('rejects invalid maximum windows before status subscription or timers', async () => {
    /** Shared adapters remain untouched by rejected option values. */
    const store = createStore({ count: 0 }, { runtime: createRuntime() })
    /** No persistence timer can be created before option validation. */
    const scheduler = createManualScheduler()
    /** Existing storage proves validation needs no host timer or special test backend. */
    const storage = memoryStorageHost()
    try {
      for (const maxWaitMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, 2147483648]) {
        expect(() =>
          persist(store, { key: 'invalid-window', storage, debounceMs: 100, maxWaitMs, scheduler })
        ).toThrow(
          expect.objectContaining({
            source: '@migaia/store-persist',
            code: StorePersistErrorCode.invalidOption,
            name: 'TypeError'
          })
        )
      }
      expect(scheduler.pendingCount).toBe(0)
    } finally {
      await store.$dispose()
    }
  })
})
