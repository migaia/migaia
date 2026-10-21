import { describe, expect, it } from 'vitest'
import { createRuntime, ReactiveErrorCode } from '../src/index.js'
import { Signal } from '../src/reactive/signal.class.js'
import { createStaticObserver } from '../src/runtime/static-observer.js'

/** Known-source observers retain graph lifecycle and post-callback version semantics. */
describe('static observers', () => {
  it('retains observed hooks and consumes callback reentrant writes only once', () => {
    const runtime = createRuntime()
    const signal = new Signal(0, runtime)
    const sequence: string[] = []
    signal.addObservedHooks({
      onObserved: () => {
        sequence.push('observed')
      },
      onUnobserved: () => {
        sequence.push('unobserved')
      }
    })
    const source = { node: signal, read: () => signal.value }
    const observer = createStaticObserver(
      runtime,
      () => source,
      () => {
        sequence.push(`value:${signal.peek()}`)
        if (signal.peek() === 1) signal.value = 2
      }
    )
    signal.value = 1
    runtime.flush()
    expect(sequence).toEqual(['observed', 'value:1'])
    signal.value = 3
    runtime.flush()
    observer.dispose()
    observer.dispose()
    expect(sequence).toEqual(['observed', 'value:1', 'value:3', 'unobserved'])
    signal.dispose()
  })

  it('rejects cross-runtime source reads through the existing tracking entry point', () => {
    const runtime = createRuntime()
    const foreign = new Signal(0, createRuntime())
    expect(() =>
      createStaticObserver(
        runtime,
        () => ({ node: foreign, read: () => foreign.value }),
        () => undefined
      )
    ).toThrowError(expect.objectContaining({ code: ReactiveErrorCode.crossRuntime }))
    foreign.dispose()
  })

  it('stops after a trace-start listener disposes the subscription', () => {
    let observer: ReturnType<typeof createStaticObserver> | undefined
    const runtime = createRuntime({
      onTrace: (event) => {
        if (event.type === 'observer-run' && event.phase === 'start') observer?.dispose()
      }
    })
    const signal = new Signal(0, runtime)
    const source = { node: signal, read: () => signal.value }
    let calls = 0
    observer = createStaticObserver(
      runtime,
      () => source,
      () => {
        calls++
      }
    )
    signal.value = 1
    expect(() => runtime.flush()).not.toThrow()
    expect(observer.disposed).toBe(true)
    expect(calls).toBe(0)
    expect(signal.observed).toBe(false)
    signal.dispose()
  })
})
