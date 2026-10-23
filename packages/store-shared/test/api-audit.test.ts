import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { createManualScheduler } from '@migaia/utils/testing'
import { UtilsAbortError } from '@migaia/utils/promise'
import { sharedInt32, sharedInt32Array, SharedInt32Signal } from '../src/index.js'

describe('store-shared audit regressions', () => {
  it('preserves unseen remote cells across a local write to another cell', () => {
    /** Each real Runtime owns its own wrapper over the same buffer. */
    const writer = sharedInt32Array(createRuntime(), 2)
    /** Observe only the remote index so local notification cannot accidentally pull it. */
    const runtime = createRuntime()
    /** A local write must not acknowledge the whole shared generation. */
    const reader = sharedInt32Array(runtime, 2, { buffer: writer.buffer })
    /** Record actual graph publication rather than merely reading current shared bytes. */
    const values: number[] = []
    /** This subscription makes the stale-cache effect visible. */
    const effect = runtime.effect(() => {
      values.push(reader.get(0))
    })
    try {
      writer.set(0, 4)
      reader.set(1, 9)
      expect(reader.sync()).toBe(1)
      runtime.flush()
      expect(values).toEqual([0, 4])
      expect(reader.sync()).toBe(0)
    } finally {
      effect.dispose()
      reader.dispose()
      writer.dispose()
    }
  })

  it.each(['signal', 'array'] as const)(
    'reconciles the native %s watch rearm gap',
    async (kind) => {
      /** The native waiter is not replaced; the canonical scheduler controls only the yielding task. */
      const clock = createManualScheduler()
      /** Writer and reader graphs remain separate actual owners. */
      const writerRuntime = createRuntime()
      /** Only this graph receives the local watch publication. */
      const runtime = createRuntime()
      /** Both public wrappers share the same private watchSlot implementation. */
      const source =
        kind === 'signal' ? sharedInt32(writerRuntime) : sharedInt32Array(writerRuntime, 1)
      /** Attach without replacing any ABI or runtime identity. */
      const mirror =
        source instanceof SharedInt32Signal
          ? sharedInt32(runtime, 0, source.buffer)
          : sharedInt32Array(runtime, 1, { buffer: source.buffer })
      /** Record public graph output, not scheduler timing. */
      const values: number[] = []
      /** The graph source is the actual signal or array cell. */
      const effect = runtime.effect(() => {
        values.push(mirror instanceof SharedInt32Signal ? mirror.value : mirror.get(0))
      })
      /** Duplicate watch retains the first scheduler and stop identity. */
      const stop = mirror.watch(clock)
      try {
        expect(mirror.watch()).toBe(stop)
        if (source instanceof SharedInt32Signal) source.value = 1
        else source.set(0, 1)
        await vi.waitFor(() => {
          runtime.flush()
          expect(values).toEqual([0, 1])
          expect(clock.pendingCount).toBe(1)
        })
        if (source instanceof SharedInt32Signal) source.value = 2
        else source.set(0, 2)
        clock.advance(0)
        runtime.flush()
        expect(values).toEqual([0, 1, 2])
      } finally {
        stop()
        stop()
        effect.dispose()
        mirror.dispose()
        source.dispose()
      }
    }
  )

  it('stops a real initial-values generator at the required prefix and closes it', () => {
    /** Any second pull would fail even though the required initial prefix is complete. */
    let pulls = 0
    /** IteratorClose remains responsible for this generator cleanup. */
    let closed = 0
    /** This is a genuine lazy iterator, not a materialized array fixture. */
    function* initialValues() {
      try {
        pulls++
        yield 7
        pulls++
        throw new Error('unexpected tail read')
      } finally {
        closed++
      }
    }
    /** Construction must not read application data beyond its fixed public length. */
    const array = sharedInt32Array(createRuntime(), 1, { initialValues: initialValues() })
    try {
      expect(array.get(0)).toBe(7)
      expect(pulls).toBe(1)
      expect(closed).toBe(1)
    } finally {
      array.dispose()
    }
  })

  it('publishes the stop handle before initial reconciliation can reenter or dispose', () => {
    /** A missed write before watch starts can synchronously notify this real graph observer. */
    const source = sharedInt32(createRuntime())
    /** The observer closes the actual wrapper while its initial watch synchronization is running. */
    const runtime = createRuntime({ schedulerStrategy: (run) => run() })
    /** The graph and native memory are the same supported public wrappers as the normal watch path. */
    const mirror = sharedInt32(runtime, 0, source.buffer)
    /** A reentrant watch must return the already published handle. */
    let reentrant: (() => void) | undefined
    /** This callback is the supported synchronous fanout that can dispose its source. */
    const effect = runtime.effect(() => {
      if (mirror.value === 1) {
        reentrant = mirror.watch()
        mirror.dispose()
      }
    })
    source.value = 1
    /** Start publishes the disposer before pulling the initial missed write. */
    const stop = mirror.watch()
    try {
      expect(reentrant).toBe(stop)
      expect(mirror.disposed).toBe(true)
      stop()
      stop()
    } finally {
      stop()
      effect.dispose()
      mirror.dispose()
      source.dispose()
    }
  })

  it.each(['native', 'frozen', 'foreign'] as const)(
    'preserves %s updater failure identity and lock usability',
    (kind) => {
      /** Real foreign identity and non-extensible native values share the same public updater path. */
      const original = kind === 'foreign' ? new UtilsAbortError() : new TypeError('updater failed')
      if (kind === 'frozen') Object.freeze(original)
      /** The updater executes before lock acquisition on the actual shared cell. */
      const array = sharedInt32Array(createRuntime(), 1)
      /** Observe the thrown boundary result without replacing the original fixture. */
      let failure: unknown
      try {
        try {
          array.update(0, () => {
            throw original
          })
        } catch (error) {
          failure = error
        }
        expect(failure).toMatchObject(
          kind === 'foreign'
            ? { source: 'foundation.utils', code: 'ABORTED' }
            : {
                source: 'store.shared',
                code: 'UPDATE_FAILED',
                ...(kind === 'frozen' ? { cause: original } : {})
              }
        )
        if (kind !== 'frozen') expect(failure).toBe(original)
        expect(original.stack).toBeTruthy()
        array.set(0, 8)
        expect(array.get(0)).toBe(8)
      } finally {
        array.dispose()
      }
    }
  )

  it('publishes a low-level write before copying its observed cursor', () => {
    /** The documented extension recipe must notify an already materialized local cell. */
    const runtime = createRuntime()
    /** The public low-level primitives retain their separate responsibilities. */
    const array = sharedInt32Array(runtime, 1)
    /** Observe the existing graph source rather than only the backing value. */
    const values: number[] = []
    /** Register the local cell before performing the raw write. */
    const effect = runtime.effect(() => {
      values.push(array.get(0))
    })
    try {
      /** Only an actual changed write requires wake/publication work. */
      const version = array.writeCell(0, 5)
      expect(version).toBeTypeOf('bigint')
      if (version !== undefined) {
        array.notifyWaiters()
        expect(array.sync(0)).toBe(1)
        array.recordObservedVersion(0, version)
      }
      runtime.flush()
      expect(values).toEqual([0, 5])
    } finally {
      effect.dispose()
      array.dispose()
    }
  })
})
