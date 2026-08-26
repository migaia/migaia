import { describe, expect, it } from 'vitest'
import { createRuntime } from '../src/index.js'
import { createObserverBinding } from '../src/runtime/observer-binding.js'

describe('RT24 effect terminal reentrancy', () => {
  it('RT24-T01: cleanup self-disposal stops rerun, removes edges, and leaves queue empty', () => {
    const scheduled: Array<() => void> = []
    const runtime = createRuntime()
    runtime.setSchedulerStrategy((flush) => {
      scheduled.push(flush)
    })
    const source = runtime.signal(0)
    let runs = 0
    let cleanups = 0
    let stop: (() => void) | undefined

    stop = runtime.effect(() => {
      runs++
      void source.value
      return () => {
        cleanups++
        stop?.()
      }
    })

    source.value = 1
    expect(scheduled).toHaveLength(1)
    scheduled.shift()?.()

    expect(runs).toBe(1)
    expect(cleanups).toBe(1)
    expect(source.subs).toHaveLength(0)
    expect(runtime.flush()).toBe('completed')
    expect(scheduled).toHaveLength(0)

    stop()
    stop()
    expect(cleanups).toBe(1)
    source.dispose()
  })

  it('RT24-T02: cleanup-triggered binding retrack returns terminal no-observer', () => {
    const runtime = createRuntime()
    const source = runtime.signal(0)
    const binding = createObserverBinding(runtime)
    let runs = 0
    let cleanups = 0
    let stop: (() => void) | undefined

    stop = binding.observe(() => {
      runs++
      void source.value
      return () => {
        cleanups++
        stop?.()
      }
    })

    expect(binding.retrack()).toBe('no-observer')
    expect(runs).toBe(1)
    expect(cleanups).toBe(1)
    expect(source.subs).toHaveLength(0)
    expect(binding.retrack()).toBe('no-observer')

    stop()
    stop()
    expect(cleanups).toBe(1)
    source.dispose()
  })

  it('RT24-T03: body self-disposal cannot commit its captured dependency edge', () => {
    const runtime = createRuntime()
    const source = runtime.signal(0)
    let runs = 0
    let cleanups = 0
    let shouldDispose = false
    let stop: (() => void) | undefined

    stop = runtime.effect(() => {
      runs++
      void source.value
      if (shouldDispose) stop?.()
      return () => {
        cleanups++
      }
    })

    shouldDispose = true
    source.value = 1
    expect(runtime.flush()).toBe('completed')
    expect(runs).toBe(2)
    expect(cleanups).toBe(2)
    expect(source.subs).toHaveLength(0)

    stop()
    stop()
    expect(cleanups).toBe(2)
    source.dispose()
  })

  it('RT30-T01: switching A to B rolls back B when B onObserved disposes the effect', () => {
    const runtime = createRuntime()
    const sourceA = runtime.signal(0)
    const sourceB = runtime.signal(0)
    let runs = 0
    let readB = false
    let stop: (() => void) | undefined

    sourceB.addObservedHooks({
      onObserved: () => {
        stop?.()
      }
    })
    stop = runtime.effect(() => {
      runs++
      if (readB) void sourceB.value
      else void sourceA.value
    })

    readB = true
    sourceA.value = 1
    expect(runtime.flush()).toBe('completed')
    expect(runs).toBe(2)
    expect(stop).toBeDefined()
    expect(sourceA.subs).toHaveLength(0)
    expect(sourceB.subs).toHaveLength(0)

    sourceA.value = 2
    sourceB.value = 1
    expect(runtime.flush()).toBe('completed')
    expect(runs).toBe(2)

    stop?.()
    sourceA.dispose()
    sourceB.dispose()
  })
})
