import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, derivedDef } from '../src/index.js'

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

  it('leaves every atom unchanged and notifies nobody when a later updater throws', () => {
    const runtime = createRuntime()
    const store = createAtomStore(runtime)
    const a = atomDef(0)
    const b = atomDef(0)
    const business = new Error('business fixture')
    let notified = 0
    const stop = store.sub(a, () => {
      notified++
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
    expect(store.get(a)).toBe(0)
    expect(store.get(b)).toBe(0)
    expect(notified).toBe(0)
    stop()
    store.dispose()
  })

  it('rejects a read-only route before running any updater or writing', () => {
    const runtime = createRuntime()
    const store = createAtomStore(runtime)
    const a = atomDef(0)
    const readOnly = derivedDef(() => 5)
    let updaterRuns = 0
    expect(() =>
      store.setMany([
        [
          a,
          () => {
            updaterRuns++
            return 1
          }
        ],
        [readOnly as never, 2]
      ])
    ).toThrow(expect.objectContaining({ code: 'OVERRIDE_CONTRACT' }))
    expect(updaterRuns).toBe(0)
    expect(store.get(a)).toBe(0)
    store.dispose()
  })

  it('types each entry against its own definition', () => {
    const store = createAtomStore(createRuntime())
    const count = atomDef(0)
    const label = atomDef('guest')
    store.setMany([
      [count, (previous) => previous + 1],
      [label, 'Ada']
    ])
    // @ts-expect-error a string cannot be written to a number definition
    expect(() => store.setMany([[count, 'x']])).not.toThrow()
    expect(store.get(label)).toBe('Ada')
    store.dispose()
  })

  it('surfaces a final flush failure after the writes commit', () => {
    const runtime = createRuntime()
    const store = createAtomStore(runtime)
    const a = atomDef(0)
    const flush = new Error('flush fixture')
    const effect = runtime.effect(() => {
      if (store.get(a) > 0) throw flush
    })
    expect(() => store.setMany([[a, 1]])).toThrow(flush)
    expect(store.get(a)).toBe(1)
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
    expect(caught).toMatchObject({ source: 'reactive', code: 'CALLBACK_FAILED', cause: 7 })
    store.dispose()
  })
})
