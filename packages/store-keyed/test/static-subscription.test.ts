import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { atomDef, atomDefFactory, createAtomStore } from '../src/index.js'

/** Static ticks must preserve the dynamic work that occurs only while a definition materializes. */
describe('known-source store subscriptions', () => {
  it('retains incidental lazy-factory dependencies until the first ordinary retrack', () => {
    const runtime = createRuntime()
    const store = createAtomStore(runtime)
    const external = runtime.signal(1)
    const definition = atomDefFactory(() => external.value)
    let calls = 0
    const stop = store.sub(definition, () => {
      calls++
    })
    external.value = 2
    runtime.flush()
    expect(calls).toBe(1)
    expect(store.get(definition)).toBe(1)
    external.value = 3
    runtime.flush()
    expect(calls).toBe(1)
    store.set(definition, 4)
    expect(calls).toBe(2)
    stop()
    store.dispose()
    external.dispose()
  })

  it('rebinds an override changed inside the listener before the next notification', () => {
    const runtime = createRuntime()
    const store = createAtomStore(runtime)
    const definition = atomDef(0)
    const replacement = atomDef(7)
    const seen: number[] = []
    const stop = store.sub(definition, () => {
      seen.push(store.get(definition))
      if (seen.length === 1) store.override(definition, replacement)
    })
    store.set(definition, 1)
    expect(seen).toEqual([1, 7])
    store.set(definition, 2)
    expect(seen).toEqual([1, 7, 2])
    stop()
    store.dispose()
  })

  it('does not reread a released source while committing the current notification', () => {
    const runtime = createRuntime()
    const store = createAtomStore(runtime)
    const definition = atomDef(0)
    const seen: number[] = []
    const stop = store.sub(definition, () => {
      seen.push(store.get(definition))
      if (seen.length === 1) store.release(definition)
    })
    store.set(definition, 1)
    expect(seen).toEqual([1, 0])
    store.set(definition, 2)
    expect(seen).toEqual([1, 0, 2])
    stop()
    store.dispose()
  })
})
