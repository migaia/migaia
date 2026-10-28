import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { createStoreDevTools, type IStoreDevTools } from '../src/index.ts'

describe('store-devtools audit regressions', () => {
  it('classifies a replay clone failure and restores history capture afterwards', async () => {
    /** The real Store remains borrowed by the diagnostic session throughout replay. */
    const store = createStore(
      { count: 0 },
      { runtime: createRuntime({ schedulerStrategy: (run) => run() }) }
    )
    /** Initial recording succeeds before the application callback starts failing. */
    let fail = false
    /** Native identity and stack must survive the same clone boundary used for recording. */
    const original = new TypeError('replay clone failed')
    /** Disable unrelated trace capture so only history publication is observed. */
    const session = createStoreDevTools(store, {
      captureRuntimeTrace: false,
      clone(state) {
        if (fail) throw original
        return { ...state }
      }
    })
    try {
      fail = true
      expect(() => session.jumpTo(session.history[0]!.id)).toThrow(original)
      expect(original).toMatchObject({ source: 'store.devtools', code: 'CALLBACK_FAILED' })
      expect(original.stack).toBeTruthy()
      expect(store.count).toBe(0)
      expect(session.history).toHaveLength(1)
      fail = false
      store.count++
      expect(session.history).toHaveLength(2)
      expect(session.history[1]!.id).toBe(2)
      expect(session.history[1]!.state.count).toBe(1)
    } finally {
      session.dispose()
      await store.$dispose()
    }
  })

  it('rejects publication when cloning disposes the actual session', async () => {
    /** Business Store ownership is independent of the diagnostic session. */
    const store = createStore({ count: 0 })
    /** Closure is enabled only after the initial snapshot and subscriptions exist. */
    let close = false
    /** The public session is the only lifecycle entry used by the callback. */
    let session!: IStoreDevTools
    session = createStoreDevTools(store, {
      captureRuntimeTrace: false,
      clone(state) {
        if (close) session.dispose()
        return { ...state }
      }
    })
    try {
      /** Terminal queues must preserve this exact existing history. */
      const before = session.history
      close = true
      expect(() => session.record('retired-in-clone')).toThrow(
        expect.objectContaining({ source: 'store.devtools', code: 'SESSION_DISPOSED' })
      )
      expect(session.history).toEqual(before)
      expect(session.history).toHaveLength(1)
    } finally {
      session.dispose()
      await store.$dispose()
    }
  })

  it('rejects action publication when the clock disposes the session', async () => {
    /** The same terminal publication boundary applies to the actual action queue. */
    const store = createStore({ count: 0 })
    /** Initial creation remains active before the callback can access the returned session. */
    let close = false
    /** The supported clock may synchronously reenter session lifecycle operations. */
    let session!: IStoreDevTools
    session = createStoreDevTools(store, {
      captureRuntimeTrace: false,
      now() {
        if (close) session.dispose()
        return 1
      }
    })
    try {
      close = true
      expect(() => session.recordAction({ name: 'terminal' })).toThrow(
        expect.objectContaining({ source: 'store.devtools', code: 'SESSION_DISPOSED' })
      )
      expect(session.actions).toHaveLength(0)
    } finally {
      session.dispose()
      await store.$dispose()
    }
  })

  it('codes a manual clock failure without consuming a history id', async () => {
    /** Only the diagnostic preparation fails; the real Store remains usable. */
    const store = createStore({ count: 0 })
    /** The callback starts failing after the initial successful history entry. */
    let fail = false
    /** Native identity and the original stack must survive annotation. */
    const original = new TypeError('clock failed')
    /** No trace callback introduces additional clock reads into this narrow regression. */
    const session = createStoreDevTools(store, {
      captureRuntimeTrace: false,
      now() {
        if (fail) throw original
        return 1
      }
    })
    try {
      fail = true
      expect(() => session.record()).toThrow(original)
      expect(original).toMatchObject({ source: 'store.devtools', code: 'CALLBACK_FAILED' })
      expect(session.history.map((entry) => entry.id)).toEqual([1])
      fail = false
      expect(session.record().id).toBe(2)
      expect(original.stack).toBeTruthy()
    } finally {
      session.dispose()
      await store.$dispose()
    }
  })

  it.each(['native', 'frozen'] as const)(
    'retains the %s action getter failure and leaves the queue unchanged',
    async (kind) => {
      /** Public action metadata can contain a supported application getter. */
      const store = createStore({ count: 0 })
      /** No unrelated runtime trace modifies this queue. */
      const session = createStoreDevTools(store, { captureRuntimeTrace: false })
      /** Frozen errors cannot receive metadata but must remain reachable by exact cause identity. */
      const original = new TypeError('action name failed')
      if (kind === 'frozen') Object.freeze(original)
      /** Observe the actual public boundary failure. */
      let failure: unknown
      try {
        try {
          session.recordAction({
            get name(): string {
              throw original
            }
          })
        } catch (error) {
          failure = error
        }
        expect(failure).toMatchObject({ source: 'store.devtools', code: 'CALLBACK_FAILED' })
        if (kind === 'native') expect(failure).toBe(original)
        else expect((failure as Error).cause).toBe(original)
        expect(session.actions).toHaveLength(0)
      } finally {
        session.dispose()
        await store.$dispose()
      }
    }
  )
})
