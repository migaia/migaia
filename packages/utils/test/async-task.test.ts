import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  AsyncTaskStrategy,
  asyncTask,
  isAsyncTaskSupported,
  resolveAsyncTaskStrategy,
  yieldToHost
} from '../src/scheduler.js'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('asyncTask', () => {
  it('runs every Node-supported strategy and resolves the callback result', async () => {
    for (const strategy of [
      'promise',
      'microtask',
      'nextTick',
      'timeout',
      'immediate',
      'messageChannel',
      'auto'
    ] as const) {
      expect(isAsyncTaskSupported(strategy)).toBe(true)
      /** Context received by the callback. */
      const context = await asyncTask(strategy, (ctx) => ctx)
      expect(context.strategy).toBe(strategy === 'auto' ? 'messageChannel' : strategy)
    }
    await expect(asyncTask('promise', () => Promise.resolve(5))).resolves.toBe(5)
  })

  it('orders tick, microtask and macrotask queues like the host', async () => {
    /** Observed run order. */
    const order: string[] = []
    // Schedule from a macrotask: inside a promise job Node drains microtasks before ticks.
    /** Tasks scheduled in reverse queue order. */
    const tasks = await new Promise<Promise<unknown>[]>((resolve) =>
      setImmediate(() =>
        resolve([
          asyncTask('timeout', () => order.push('timeout')),
          asyncTask('immediate', () => order.push('immediate')),
          asyncTask('promise', () => order.push('promise')),
          asyncTask('nextTick', () => order.push('nextTick'))
        ])
      )
    )
    await Promise.all(tasks)
    expect(order.slice(0, 2)).toEqual(['nextTick', 'promise'])
    expect(order.slice(2).sort()).toEqual(['immediate', 'timeout'])
  })

  it('waits the delay before using the queue', async () => {
    vi.useFakeTimers()
    /** Callback that must not run before the delay. */
    const callback = vi.fn(() => 'done')
    /** Pending task. */
    const task = asyncTask('microtask', callback, 50)
    await vi.advanceTimersByTimeAsync(49)
    expect(callback).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(task).resolves.toBe('done')
  })

  it('throws synchronously for unknown strategies, invalid delays and missing host APIs', () => {
    expect(() => asyncTask('nope' as never, () => 1)).toThrowError(
      expect.objectContaining({ name: 'TypeError', code: 'INVALID_ARGUMENT' })
    )
    expect(() => asyncTask([] as never, () => 1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => asyncTask('timeout', () => 1, -1)).toThrowError(
      expect.objectContaining({ name: 'RangeError', code: 'INVALID_ARGUMENT' })
    )
    expect(() => asyncTask('timeout', 1 as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(isAsyncTaskSupported('animationFrame')).toBe(false)
    expect(() => asyncTask('animationFrame', () => 1)).toThrowError(
      expect.objectContaining({
        code: 'ENV_UNSUPPORTED',
        message: expect.stringContaining('requestAnimationFrame')
      })
    )
    expect(isAsyncTaskSupported('nope' as never)).toBe(false)
  })

  it('falls back through a preference list', async () => {
    expect(resolveAsyncTaskStrategy(['animationFrame', 'idleCallback', 'timeout'])).toBe('timeout')
    /** Context of the fallback that ran. */
    const context = await asyncTask(['animationFrame', 'immediate'], (ctx) => ctx.strategy)
    expect(context).toBe('immediate')
    expect(() => resolveAsyncTaskStrategy(['animationFrame', 'idleCallback'])).toThrowError(
      expect.objectContaining({ code: 'ENV_UNSUPPORTED' })
    )
  })

  it('passes frame and idle data from browser hosts and cancels them on abort', async () => {
    /** Fake frame host. */
    const cancelAnimationFrame = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => {
      queueMicrotask(() => callback(16.5))
      return 7
    })
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
    /** Frame context, typed with frameTime. */
    const frame = await asyncTask('animationFrame', (ctx) => {
      expectTypeOf(ctx.frameTime).toEqualTypeOf<number>()
      return ctx.frameTime
    })
    expect(frame).toBe(16.5)
    /** Fake idle host recording its options. */
    const requestIdleCallback = vi.fn(
      (callback: (deadline: { didTimeout: boolean; timeRemaining(): number }) => void) => {
        setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 3 }), 0)
        return 9
      }
    )
    vi.stubGlobal('requestIdleCallback', requestIdleCallback)
    vi.stubGlobal('cancelIdleCallback', vi.fn())
    /** Idle context. */
    const idle = await asyncTask('idleCallback', (ctx) => [ctx.didTimeout, ctx.timeRemaining()], {
      idleTimeout: 100
    })
    expect(idle).toEqual([true, 3])
    expect(requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 100 })
    /** Controller aborting a pending frame. */
    const controller = new AbortController()
    vi.stubGlobal('requestAnimationFrame', () => 11)
    /** Pending frame task. */
    const pending = asyncTask('animationFrame', () => 1, { signal: controller.signal })
    controller.abort('cancel')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED', cause: 'cancel' })
    expect(cancelAnimationFrame).toHaveBeenCalledWith(11)
  })

  it('uses postTask priorities with native delay and yield continuations', async () => {
    /** Recorded postTask options. */
    const postTask = vi.fn(
      (callback: () => void, options: { readonly priority: string; readonly delay: number }) => {
        setTimeout(callback, options.delay)
        return Promise.resolve()
      }
    )
    vi.stubGlobal('scheduler', { postTask, yield: () => Promise.resolve() })
    await expect(asyncTask('postTaskBackground', () => 'bg', 5)).resolves.toBe('bg')
    expect(postTask).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ priority: 'background', delay: 5 })
    )
    await expect(asyncTask('schedulerYield', (ctx) => ctx.strategy)).resolves.toBe('schedulerYield')
    expect(resolveAsyncTaskStrategy('auto')).toBe('schedulerYield')
    expect(Object.keys(AsyncTaskStrategy)).toContain('postTaskUserBlocking')
  })

  it('rejects for an already aborted signal and passes callback errors through by identity', async () => {
    /** Aborted controller. */
    const controller = new AbortController()
    controller.abort('early')
    /** Callback that must never run. */
    const callback = vi.fn()
    await expect(
      asyncTask('timeout', callback, { signal: controller.signal })
    ).rejects.toMatchObject({
      code: 'ABORTED'
    })
    expect(callback).not.toHaveBeenCalled()
    /** Original failure. */
    const failure = new TypeError('callback')
    await expect(
      asyncTask('microtask', () => {
        throw failure
      })
    ).rejects.toBe(failure)
    /** Abort after start has no effect. */
    const late = new AbortController()
    await expect(
      asyncTask(
        'promise',
        () => {
          late.abort()
          return 'ran'
        },
        { signal: late.signal }
      )
    ).resolves.toBe('ran')
  })

  it('yields to the host', async () => {
    await expect(yieldToHost()).resolves.toBeUndefined()
    await expect(yieldToHost(['animationFrame', 'timeout'])).resolves.toBeUndefined()
  })
})
