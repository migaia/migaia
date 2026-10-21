import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { memoryStorageHost } from '@migaia/storage-web/memory'
import { persist } from '../src/light-index.js'
import { StorePersistErrorCode } from '../src/error-code.js'
import { persistUnit } from '../src/index.js'

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

  it.each([false, true])(
    'awaits the final disposal write even when it fails=%s',
    async (reject) => {
      /** Manual debounce guarantees a final snapshot remains queued at synchronous disposal. */
      const scheduler = createManualScheduler()
      /** Borrowed graph drives the real store subscription. */
      const runtime = createRuntime()
      /** Archive inspection still uses the real memory backend. */
      const storage = memoryStorageHost()
      /** Original adapter operation preserves successful envelope encoding. */
      const set = storage.set
      /** Storage admission and completion are independently controlled. */
      const started = Promise.withResolvers<void>()
      /** Ignoring abort models an already admitted asynchronous backend write. */
      const gate = Promise.withResolvers<void>()
      /** Final storage failure stays on writeError rather than rejecting completion. */
      const failure = new Error('deferred final write failure')
      storage.set = async (key, value, context) => {
        started.resolve()
        await gate.promise
        if (reject) throw failure
        await set(key, value, context)
      }
      /** Store remains borrowed and may be released after its final snapshot was taken. */
      const store = createStore({ count: 0 }, { runtime })
      /** Awaitable disposal drains the same write chain as ordinary disposal. */
      const handle = persist(store, { key: 'drain-final', storage, debounceMs: 100, scheduler })
      await handle.ready
      try {
        store.count = 7
        runtime.flush()
        expect(handle.dispose()).toBeUndefined()
        /** Calling after synchronous disposal must still wait for the final snapshot. */
        const completion = handle.disposeAsync()
        /** Completion cannot mean only that abort was requested. */
        let completed = false
        void completion.then(() => {
          completed = true
        })
        expect(handle.disposed).toBe(true)
        await started.promise
        await Promise.resolve()
        expect(completed).toBe(false)
        gate.resolve()
        await completion
        expect(completed).toBe(true)
        await handle.disposeAsync()
        if (reject) expect(handle.writeError.value).toBe(failure)
        else
          expect(JSON.parse(String(await storage.get('drain-final'))).state).toEqual({ count: 7 })
      } finally {
        gate.resolve()
        await handle.disposeAsync()
        await store.$dispose()
      }
    }
  )

  it('awaits the queued final write before rejecting a subscription cleanup failure', async () => {
    /** This scheduler leaves exactly one final debounce snapshot owed at disposal. */
    const scheduler = createManualScheduler()
    /** The adapter completion is controlled independently of the cleanup failure. */
    const gate = Promise.withResolvers<void>()
    /** Observes the final storage call without depending on a count of Promise turns. */
    const started = Promise.withResolvers<void>()
    /** Exact synchronous cleanup failure must survive the asynchronous drain. */
    const failure = new Error('subscription cleanup failed')
    /** Backing state of this public persistence unit. */
    let count = 0
    /** Registered callback drives the existing debounce scheduling seam. */
    let changed!: () => void
    /** Backend blocks the final write after it was admitted. */
    const storage = memoryStorageHost()
    /** Original operation keeps the archive assertions grounded in the real backend. */
    const set = storage.set
    storage.set = async (key, value, context) => {
      started.resolve()
      await gate.promise
      await set(key, value, context)
    }
    /** Public unit provides a failing unsubscribe without modifying production internals. */
    const handle = persistUnit(
      {
        snapshot: () => ({ count }),
        restore: (state) => {
          count = state.count
        },
        subscribe: (listener) => {
          changed = listener
          return () => {
            throw failure
          }
        }
      },
      { key: 'cleanup-drain', storage, runtime: createRuntime(), debounceMs: 100, scheduler }
    )
    await handle.ready
    count = 9
    changed()
    /** Rejection stays pending until the already queued final write has settled. */
    const completion = handle.disposeAsync()
    /** Attach the rejection assertion before releasing the deliberately blocked backend. */
    const outcome = expect(completion).rejects.toBe(failure)
    /** Both resolve and reject count as settlement for the completion-order assertion. */
    let completed = false
    void completion.then(
      () => {
        completed = true
      },
      () => {
        completed = true
      }
    )
    try {
      expect(handle.disposed).toBe(true)
      await started.promise
      expect(completed).toBe(false)
      gate.resolve()
      await outcome
      expect(JSON.parse(String(await storage.get('cleanup-drain'))).state).toEqual({ count: 9 })
    } finally {
      gate.resolve()
      await outcome
    }
  })

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
