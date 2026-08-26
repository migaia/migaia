import { describe, expect, it } from 'vitest'
import { raceWithAsyncControl, waitWithSignal } from '../../src/internal/async-control'

describe('async control', () => {
  it('settles on timeout and ignores late operation completion', async () => {
    await expect(
      raceWithAsyncControl({
        operation: () => new Promise((resolve) => setTimeout(() => resolve('late'), 20)),
        timeoutMs: 1,
        createTimeoutError: () => new Error('timeout'),
        createAbortError: () => new Error('aborted')
      })
    ).rejects.toThrow('timeout')
  })

  it('removes abort listeners when delay completes', async () => {
    const controller = new AbortController()
    await waitWithSignal(0, [controller.signal], () => new Error('aborted'))
    controller.abort()
  })
  it('does not start a lazy operation after pre-cancellation', async () => {
    const controller = new AbortController()
    controller.abort()
    let started = false
    await expect(
      raceWithAsyncControl({
        operation: () => {
          started = true
          return Promise.resolve('late')
        },
        signals: [controller.signal],
        createTimeoutError: () => new Error('timeout'),
        createAbortError: () => new Error('aborted')
      })
    ).rejects.toThrow('aborted')
    expect(started).toBe(false)
  })
  it('contains synchronous timeout callbacks and observes diagnostics', async () => {
    const diagnostics: unknown[] = []
    await expect(
      raceWithAsyncControl({
        operation: () => new Promise(() => undefined),
        timeoutMs: 0,
        onTimeout: () => {
          throw new Error('callback')
        },
        onDiagnostic: (error) => diagnostics.push(error),
        createTimeoutError: () => new Error('timeout'),
        createAbortError: () => new Error('aborted')
      })
    ).rejects.toThrow('timeout')
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(diagnostics).toHaveLength(1)
  })
  it('starts the timeout side effect before settling the timeout', async () => {
    const order: string[] = []
    await expect(
      raceWithAsyncControl({
        operation: () => new Promise(() => undefined),
        timeoutMs: 0,
        onTimeout: () => {
          order.push('effect')
        },
        createTimeoutError: () => {
          order.push('error')
          return new Error('timeout')
        },
        createAbortError: () => new Error('aborted')
      })
    ).rejects.toThrow('timeout')
    expect(order).toEqual(['effect', 'error'])
  })
  it('does not start an operation after synchronous signal cancellation', async () => {
    let started = false
    const signal = {
      aborted: false,
      addEventListener(_type: string, callback: () => void) {
        callback()
      },
      removeEventListener() {}
    } as unknown as AbortSignal
    await expect(
      raceWithAsyncControl({
        operation: () => {
          started = true
          return Promise.resolve()
        },
        signals: [signal],
        createTimeoutError: () => new Error('timeout'),
        createAbortError: () => new Error('aborted')
      })
    ).rejects.toThrow('aborted')
    expect(started).toBe(false)
  })
  it('does not register later signals after an earlier synchronous abort', async () => {
    let laterAdded = 0
    const first = {
      aborted: false,
      addEventListener(_type: string, callback: () => void) {
        callback()
      },
      removeEventListener() {}
    } as unknown as AbortSignal
    const second = {
      aborted: false,
      addEventListener() {
        laterAdded += 1
      },
      removeEventListener() {}
    } as unknown as AbortSignal
    await expect(
      raceWithAsyncControl({
        operation: () => Promise.resolve('late'),
        signals: [first, second],
        createTimeoutError: () => new Error('timeout'),
        createAbortError: () => new Error('aborted')
      })
    ).rejects.toThrow('aborted')
    expect(laterAdded).toBe(0)
    await expect(waitWithSignal(0, [first, second], () => new Error('aborted'))).rejects.toThrow(
      'aborted'
    )
    expect(laterAdded).toBe(0)
  })
  it('starts the operation only after control checks', async () => {
    let started = false
    await expect(
      raceWithAsyncControl({
        operation: () => {
          started = true
          return Promise.resolve('ok')
        },
        createTimeoutError: () => new Error('timeout'),
        createAbortError: () => new Error('aborted'),
        signals: [AbortSignal.abort()]
      })
    ).rejects.toThrow('aborted')
    expect(started).toBe(false)
  })
  it('rolls back earlier signal listeners when a later registration fails', async () => {
    let removed = 0
    const first = {
      aborted: false,
      addEventListener() {},
      removeEventListener() {
        removed += 1
      }
    } as unknown as AbortSignal
    const second = {
      aborted: false,
      addEventListener() {
        throw new Error('registration failed')
      },
      removeEventListener() {}
    } as unknown as AbortSignal
    await expect(
      raceWithAsyncControl({
        operation: () => Promise.resolve('late'),
        signals: [first, second],
        createTimeoutError: () => new Error('timeout'),
        createAbortError: () => new Error('aborted')
      })
    ).rejects.toThrow('registration failed')
    expect(removed).toBe(1)
  })
  it('rolls back earlier delay listeners when a later registration fails', async () => {
    let removed = 0
    const first = {
      aborted: false,
      addEventListener() {},
      removeEventListener() {
        removed += 1
      }
    } as unknown as AbortSignal
    const second = {
      aborted: false,
      addEventListener() {
        throw new Error('registration failed')
      },
      removeEventListener() {}
    } as unknown as AbortSignal
    await expect(waitWithSignal(100, [first, second], () => new Error('aborted'))).rejects.toThrow(
      'registration failed'
    )
    expect(removed).toBe(1)
  })
  it('observes delay listener cleanup failures without replacing the result', async () => {
    const diagnostics: unknown[] = []
    const controller = new AbortController()
    const signal = {
      aborted: false,
      addEventListener: (
        type: 'abort',
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions
      ) => controller.signal.addEventListener(type, listener, options),
      removeEventListener() {
        throw new Error('remove failed')
      }
    } as unknown as AbortSignal
    await expect(
      waitWithSignal(
        0,
        [signal],
        () => new Error('aborted'),
        (error) => {
          diagnostics.push(error)
          throw new Error('diagnostic failed')
        }
      )
    ).resolves.toBeUndefined()
    expect(diagnostics).toHaveLength(1)
  })
  it('observes race listener cleanup failures without replacing the result', async () => {
    const diagnostics: unknown[] = []
    const signal = {
      aborted: false,
      addEventListener() {},
      removeEventListener() {
        throw new Error('remove failed')
      }
    } as unknown as AbortSignal
    await expect(
      raceWithAsyncControl({
        operation: () => Promise.resolve('ok'),
        signals: [signal],
        createTimeoutError: () => new Error('timeout'),
        createAbortError: () => new Error('aborted'),
        onDiagnostic: (error) => {
          diagnostics.push(error)
          throw new Error('diagnostic failed')
        }
      })
    ).resolves.toBe('ok')
    expect(diagnostics).toHaveLength(1)
  })
})
