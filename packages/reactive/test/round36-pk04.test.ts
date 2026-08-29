import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '../src/runtime/runtime.class.js'
import { ReactiveErrorCode } from '../src/error-code.js'
import { Scheduler } from '../src/runtime/scheduler.class.js'

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

describe('PK-04 synchronous callback admission', () => {
  it('rejects async Effect bodies and observes their rejection', async () => {
    const reported: unknown[] = []
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    const rejection = new Error('async effect rejection')
    expect(() => runtime.effect((async () => Promise.reject(rejection)) as never)).toThrow(
      expect.objectContaining({ code: ReactiveErrorCode.invalidOption })
    )
    await flush()
    expect(reported).toContain(rejection)
  })

  it('rejects terminal cleanup thenables and reports their late rejection', async () => {
    const reported: unknown[] = []
    const scheduled: Array<() => void> = []
    const rejection = new Error('terminal cleanup rejection')
    const runtime = createRuntime({ onError: (error) => reported.push(error) })
    runtime.setSchedulerStrategy((flush) => {
      scheduled.push(flush)
    })
    const source = runtime.signal(0)
    let runs = 0
    let stop: (() => void) | undefined

    stop = runtime.effect(() => {
      runs++
      void source.value
      if (runs === 2) stop?.()
      return runs === 2 ? ((() => Promise.reject(rejection)) as never) : undefined
    })

    source.value = 1
    expect(scheduled.shift()).toBeDefined()
    expect(() => runtime.flush()).toThrow(
      expect.objectContaining({ code: ReactiveErrorCode.invalidOption })
    )
    expect(runs).toBe(2)
    expect(reported).toEqual([])
    await flush()
    expect(reported).toEqual([rejection])
    expect(source.subs).toHaveLength(0)
    source.dispose()
  })

  it('rejects async batch callbacks before flushing', () => {
    const runtime = createRuntime()
    expect(() => runtime.batch(async () => undefined)).toThrow(
      expect.objectContaining({ code: ReactiveErrorCode.invalidOption })
    )
  })

  it('snapshots observed hook getters once and removes the captured callbacks', () => {
    const runtime = createRuntime()
    const signal = runtime.signal(0)
    const onObserved = vi.fn()
    const onUnobserved = vi.fn()
    let observedReads = 0
    let unobservedReads = 0
    const hooks = {
      get onObserved() {
        observedReads++
        return onObserved
      },
      get onUnobserved() {
        unobservedReads++
        return onUnobserved
      }
    }
    const remove = signal.addObservedHooks(hooks)
    remove()
    expect(observedReads).toBe(1)
    expect(unobservedReads).toBe(1)
    signal.dispose()
  })
})

describe('PK-04 scheduler ownership', () => {
  it('continues a long acyclic effect chain instead of treating depth as a cycle', () => {
    const runtime = createRuntime({
      adapter: { scheduleMicrotask: (task) => task() }
    })
    const signals = Array.from({ length: 130 }, (_, index) => runtime.signal(index))
    const disposers = signals.slice(0, -1).map((source, index) =>
      runtime.effect(() => {
        signals[index + 1].value = source.value
      })
    )
    signals[0].value = 999
    expect(signals.at(-1)?.value).toBe(999)
    for (const dispose of disposers) dispose()
    for (const signal of signals) signal.dispose()
  })

  it('records unprocessed same-batch peers when the observer budget trips', () => {
    const scheduler = new Scheduler(undefined, 1, () => undefined)
    let peerExecuted = false
    const cycle: { debugName: string; tick: () => void } = {
      debugName: 'cycle',
      tick: () => scheduler.enqueue(cycle)
    }
    const peer = {
      debugName: 'peer',
      tick: () => {
        peerExecuted = true
      }
    }
    const starter = {
      debugName: 'starter',
      tick: () => scheduler.enqueue(peer)
    }
    scheduler.enqueue(cycle)
    scheduler.enqueue(starter)

    let caught: unknown
    try {
      scheduler.flush()
    } catch (error) {
      caught = error
    }

    expect(caught).toEqual(
      expect.objectContaining({
        code: ReactiveErrorCode.flushLoop,
        message: expect.stringContaining('dropped 2 pending item(s): cycle, peer')
      })
    )
    expect(peerExecuted).toBe(false)
  })

  it('reports idle admission failure and still releases a computed dependency', async () => {
    const idleError = new Error('idle unavailable')
    const reported: unknown[] = []
    let idleCalls = 0
    const runtime = createRuntime({
      onError: (error) => reported.push(error),
      scheduleIdle: () => {
        idleCalls++
        throw idleError
      }
    })
    const source = runtime.signal(1)
    const computed = runtime.computed(() => source.value + 1)
    expect(computed.value).toBe(2)
    await flush()
    expect(idleCalls).toBe(1)
    expect(reported).toContain(idleError)
    expect(source.subs.size).toBe(0)
    source.dispose()
    computed.dispose()
  })
})
