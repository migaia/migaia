import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore } from '../src/index.js'

/** Bulk writes retain the established primitive updater, notification, and failure semantics. */
describe('AtomStore.setMany', () => {
  it('writes duplicates in order and notifies each subscriber after the complete batch', () => {
    const runtime = createRuntime()
    const store = createAtomStore(runtime)
    const a = atomDef(0)
    const b = atomDef(0)
    const sequence: string[] = []
    const stopA = store.sub(a, () => {
      sequence.push(`a:${store.get(a)}:${store.get(b)}`)
    })
    const stopB = store.sub(b, () => {
      sequence.push(`b:${store.get(a)}:${store.get(b)}`)
    })
    store.setMany([
      [a, 1],
      [a, (previous) => previous + 2],
      [b, 7]
    ])
    expect(sequence).toEqual(['a:3:7', 'b:3:7'])
    stopA()
    stopB()
    store.dispose()
  })

  it('keeps updater reads outside the calling observer dependency frame', () => {
    const runtime = createRuntime()
    const store = createAtomStore(runtime)
    const a = atomDef(0)
    const unrelated = runtime.signal(1)
    let runs = 0
    const effect = runtime.effect(() => {
      runs++
      store.setMany([[a, () => unrelated.value]])
    })
    unrelated.value = 2
    runtime.flush()
    expect(runs).toBe(1)
    expect(store.get(a)).toBe(1)
    effect.dispose()
    store.dispose()
    unrelated.dispose()
  })

  it('retains the first write and business error identity when final flush also fails', () => {
    const runtime = createRuntime()
    const store = createAtomStore(runtime)
    const a = atomDef(0)
    const b = atomDef(0)
    const business = new Error('business fixture')
    const flush = new Error('flush fixture')
    const effect = runtime.effect(() => {
      if (store.get(a) > 0) throw flush
    })
    let caught: unknown
    try {
      store.setMany([
        [a, 1],
        [
          b,
          () => {
            throw business
          }
        ]
      ])
    } catch (error) {
      caught = error
    }
    expect(caught).toBe(business)
    expect(business.cause).toBe(flush)
    expect(store.get(a)).toBe(1)
    expect(store.get(b)).toBe(0)
    effect.dispose()
    store.dispose()
  })

  it('uses the existing reactive callback error identity for non-Error updater failures', () => {
    const runtime = createRuntime()
    const store = createAtomStore(runtime)
    const a = atomDef(0)
    let caught: unknown
    try {
      store.setMany([
        [
          a,
          () => {
            throw 7
          }
        ]
      ])
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ source: '@migaia/reactive', code: 'CALLBACK_FAILED', cause: 7 })
    store.dispose()
  })
})
