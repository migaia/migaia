import { describe, expect, it } from 'vitest'
import { createRuntime, type IReactiveNodeOptions } from '../src/index.ts'

/** A11: `runtime.signal` honours an owner `equals` after the identity short-circuit. */
describe('signal equals option', () => {
  it('runs equals(prev, next) only after Object.is and keeps the old value when equal', () => {
    const runtime = createRuntime()
    /** Recorded `[prev, next]` pairs prove call count and argument order. */
    const calls: [unknown, unknown][] = []
    /** Initial object whose identity must survive an equal write. */
    const first = { id: 1, n: 1 }
    const source = runtime.signal(first, {
      equals: (prev, next) => {
        calls.push([prev, next])
        return prev.id === next.id && prev.n <= next.n
      }
    })
    /** Recompute count of the dependent computed. */
    let runs = 0
    const derived = runtime.computed(() => {
      runs++
      return source.value
    })
    expect(derived.value).toBe(first)
    expect(runs).toBe(1)
    const version = source.version

    source.value = first
    expect(calls).toEqual([])

    const raised = { id: 1, n: 2 }
    source.value = raised
    expect(calls).toEqual([[first, raised]])
    expect(source.peek()).toBe(first)
    expect(source.version).toBe(version)
    expect(derived.value).toBe(first)
    expect(runs).toBe(1)

    // Asymmetric: n decreasing is a change. A reversed (next, prev) call would treat it as equal.
    const lowered = { id: 1, n: 0 }
    source.value = lowered
    expect(source.peek()).toBe(lowered)
    expect(derived.value).toBe(lowered)
    expect(runs).toBe(2)

    const other = { id: 2, n: 1 }
    source.value = other
    expect(source.peek()).toBe(other)
    expect(derived.value).toBe(other)
    expect(runs).toBe(3)
    derived.dispose()
    source.dispose()
  })

  it('fails a write atomically with the original error when equals throws', () => {
    const runtime = createRuntime()
    /** Error identity thrown by the owner comparator. */
    const failure = new Error('E8')
    const initial = { v: 1 }
    const source = runtime.signal(initial, {
      equals: () => {
        throw failure
      }
    })
    let runs = 0
    const derived = runtime.computed(() => {
      runs++
      return source.value
    })
    expect(derived.value).toBe(initial)
    const version = source.version
    expect(() => {
      source.value = { v: 2 }
    }).toThrow(failure)
    expect(source.peek()).toBe(initial)
    expect(source.version).toBe(version)
    expect(derived.value).toBe(initial)
    expect(runs).toBe(1)
    derived.dispose()
    source.dispose()
  })

  it('keeps identity-only behaviour without equals', () => {
    const runtime = createRuntime()
    const source = runtime.signal({ v: 1 })
    let runs = 0
    const derived = runtime.computed(() => {
      runs++
      return source.value
    })
    expect(derived.value).toEqual({ v: 1 })
    const next = { v: 1 }
    source.value = next
    expect(source.peek()).toBe(next)
    expect(derived.value).toBe(next)
    expect(runs).toBe(2)
    derived.dispose()
    source.dispose()
  })

  it('keeps equals off the effect option type', () => {
    /** Type-level guard: effect options stay IReactiveNodeOptions. */
    const options: IReactiveNodeOptions = { debugName: 'e' }
    /** Effect option type under test. */
    type IEffectOptions = Parameters<ReturnType<typeof createRuntime>['effect']>[1]
    // @ts-expect-error effect options do not accept equals
    const invalid: IEffectOptions = { equals: () => true }
    expect(options.debugName).toBe('e')
    expect(invalid).toBeDefined()
  })
})
