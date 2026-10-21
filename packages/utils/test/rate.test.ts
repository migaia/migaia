import { afterEach, describe, expect, it, vi } from 'vitest'
import { coalesce, debounce, repeat, throttle } from '../src/scheduler.js'
import { createManualScheduler } from '../src/testing.js'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('debounce', () => {
  it('invokes once on the trailing edge with the latest arguments', () => {
    /** Deterministic clock. */
    const scheduler = createManualScheduler()
    /** Wrapped spy. */
    const fn = vi.fn((value: number) => value * 2)
    /** Debounced function. */
    const debounced = debounce(fn, 100, { scheduler })
    debounced(1)
    scheduler.advance(50)
    debounced(2)
    expect(debounced.pending()).toBe(true)
    scheduler.advance(99)
    expect(fn).not.toHaveBeenCalled()
    scheduler.advance(1)
    expect(fn).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledWith(2)
    expect(debounced.flush()).toBe(4)
  })

  it('supports leading edge, maxWait, flush and cancel', () => {
    /** Deterministic clock. */
    const scheduler = createManualScheduler()
    /** Wrapped spy. */
    const fn = vi.fn((value: number) => value)
    /** Debounced function with a cap. */
    const debounced = debounce(fn, 100, { scheduler, leading: true, maxWait: 250 })
    debounced(1)
    expect(fn).toHaveBeenLastCalledWith(1)
    for (let step = 0; step < 5; step += 1) {
      scheduler.advance(60)
      debounced(step + 2)
    }
    // A continuous burst still invokes once maxWait elapsed.
    expect(fn).toHaveBeenCalledTimes(2)
    expect(debounced.flush()).toBe(6)
    // flush() ended the burst, so the next call is a new leading edge.
    debounced(7)
    expect(fn).toHaveBeenLastCalledWith(7)
    debounced(8)
    debounced.cancel()
    scheduler.advance(1000)
    expect(fn).toHaveBeenCalledTimes(4)
  })

  it('reports trailing failures and stops after abort', () => {
    /** Deterministic clock. */
    const scheduler = createManualScheduler()
    /** Host error queue stand-in. */
    const queued: (() => void)[] = []
    vi.stubGlobal('queueMicrotask', (callback: () => void) => queued.push(callback))
    /** Original failure. */
    const failure = new Error('trailing')
    /** Controller that disposes the debounce. */
    const controller = new AbortController()
    /** Debounced thrower. */
    const debounced = debounce(
      () => {
        throw failure
      },
      10,
      { scheduler, signal: controller.signal }
    )
    debounced()
    scheduler.advance(10)
    expect(queued).toHaveLength(1)
    expect(queued[0]).toThrow(failure)
    controller.abort()
    debounced()
    expect(debounced.pending()).toBe(false)
  })

  it('validates arguments', () => {
    expect(() => debounce(1 as never, 1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => debounce(() => 1, -1)).toThrowError(
      expect.objectContaining({ name: 'RangeError', code: 'INVALID_ARGUMENT' })
    )
  })
})

describe('throttle', () => {
  it('invokes at most once per window on leading and trailing edges', () => {
    /** Deterministic clock. */
    const scheduler = createManualScheduler()
    /** Wrapped spy. */
    const fn = vi.fn()
    /** Throttled function. */
    const throttled = throttle(fn, 100, { scheduler })
    throttled(1)
    throttled(2)
    throttled(3)
    expect(fn).toHaveBeenCalledTimes(1)
    scheduler.advance(100)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith(3)
  })

  it('throttles to animation frames with the latest arguments', async () => {
    /** Frame callbacks waiting to run. */
    const frames: ((time: number) => void)[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) =>
      frames.push(callback)
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    /** Wrapped spy. */
    const fn = vi.fn()
    /** Frame-throttled function. */
    const throttled = throttle(fn, 'animationFrame')
    throttled(1)
    throttled(2)
    expect(frames).toHaveLength(1)
    frames[0](16)
    await Promise.resolve()
    expect(fn).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledWith(2)
  })
})

describe('coalesce', () => {
  it('delivers all calls of one tick in one invocation', async () => {
    /** Wrapped spy. */
    const fn = vi.fn()
    /** Coalesced function. */
    const track = coalesce<[string]>(fn)
    track('a')
    track('b')
    expect(track.size).toBe(2)
    await Promise.resolve()
    await Promise.resolve()
    expect(fn).toHaveBeenCalledOnce()
    expect(fn).toHaveBeenCalledWith([['a'], ['b']])
    track('c')
    track.flush()
    expect(fn).toHaveBeenLastCalledWith([['c']])
    track('d')
    track.cancel()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(fn).toHaveBeenCalledTimes(2)
  })
})

describe('repeat', () => {
  it('runs without overlap until maxIterations', async () => {
    /** Deterministic clock. */
    const scheduler = createManualScheduler()
    /** Iterations seen. */
    const iterations: number[] = []
    /** Running loop. */
    const loop = repeat(
      ({ iteration }) => {
        iterations.push(iteration)
      },
      100,
      { scheduler, maxIterations: 3, immediate: true }
    )
    scheduler.advance(0)
    expect(iterations).toEqual([0])
    scheduler.advance(100)
    scheduler.advance(100)
    await expect(loop.done).resolves.toBeUndefined()
    expect(iterations).toEqual([0, 1, 2])
    expect(loop.running).toBe(false)
  })

  it('waits for async iterations before scheduling the next', async () => {
    /** Deterministic clock. */
    const scheduler = createManualScheduler()
    /** Resolver of the in-flight iteration. */
    let finish!: () => void
    /** Iteration spy. */
    const task = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    /** Running loop. */
    const loop = repeat(task, 10, { scheduler })
    scheduler.advance(10)
    scheduler.advance(50)
    expect(task).toHaveBeenCalledTimes(1)
    finish()
    await Promise.resolve()
    await Promise.resolve()
    scheduler.advance(0)
    expect(task).toHaveBeenCalledTimes(2)
    loop.stop()
    await expect(loop.done).resolves.toBeUndefined()
  })

  it('stops on error by default and continues with reporting when asked', async () => {
    /** Deterministic clock. */
    const scheduler = createManualScheduler()
    /** Original failure. */
    const failure = new Error('iteration')
    /** Loop stopping on the failure. */
    const stopping = repeat(
      () => {
        throw failure
      },
      10,
      { scheduler }
    )
    scheduler.advance(10)
    await expect(stopping.done).rejects.toBe(failure)
    /** Host error queue stand-in. */
    const queued: (() => void)[] = []
    vi.stubGlobal('queueMicrotask', (callback: () => void) => queued.push(callback))
    /** Loop continuing after failures. */
    const continuing = repeat(
      () => {
        throw failure
      },
      10,
      { scheduler, onError: 'continue', maxIterations: 2 }
    )
    scheduler.advance(10)
    scheduler.advance(10)
    vi.unstubAllGlobals()
    await expect(continuing.done).resolves.toBeUndefined()
    expect(queued).toHaveLength(2)
  })

  it('stops through the external signal and aborts the iteration signal', async () => {
    /** Deterministic clock. */
    const scheduler = createManualScheduler()
    /** External controller. */
    const controller = new AbortController()
    /** Signal passed to the first iteration. */
    let iterationSignal: { aborted: boolean } | undefined
    /** Running loop. */
    const loop = repeat(
      ({ signal }) => {
        iterationSignal = signal
      },
      10,
      { scheduler, signal: controller.signal, immediate: true }
    )
    scheduler.advance(0)
    controller.abort()
    await expect(loop.done).resolves.toBeUndefined()
    expect(iterationSignal?.aborted).toBe(true)
    expect(scheduler.pendingCount).toBe(0)
  })
})
