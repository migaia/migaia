import { UtilsAbortError } from '@migaia/utils/error'
import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { ObservableMap, ObservableSet, ObservableArray, ObservableObject } from '../src/index.js'

describe('store-indexed audit regressions', () => {
  it('SI-D01 invalidates all Map iteration views when insertion order changes', () => {
    /** Actual graph nodes derive every public insertion-order view. */
    const runtime = createRuntime()
    /** Same keys and values, different order, is a supported replace. */
    const map = new ObservableMap(
      [
        ['a', 1],
        ['b', 2]
      ],
      runtime
    )
    /** Track keys independently from entry/value/snapshot iteration. */
    const keys = runtime.computed(() => map.keys())
    /** Entry identity is not inspected; only its observable order matters. */
    const entries = runtime.computed(() => map.entries())
    /** Values follow the same native Map insertion order. */
    const values = runtime.computed(() => map.valuesArray())
    /** Snapshot consumers must also observe the replacement's order. */
    const snapshot = runtime.computed(() => [...map.snapshot()])
    expect(keys.value).toEqual(['a', 'b'])
    expect(entries.value).toEqual([
      ['a', 1],
      ['b', 2]
    ])
    expect(values.value).toEqual([1, 2])
    expect(snapshot.value).toEqual([
      ['a', 1],
      ['b', 2]
    ])
    map.replace([
      ['b', 2],
      ['a', 1]
    ])
    runtime.flush()
    expect(keys.value).toEqual(map.keys())
    expect(entries.value).toEqual(map.entries())
    expect(values.value).toEqual(map.valuesArray())
    expect(snapshot.value).toEqual([...map.snapshot()])
    snapshot.dispose()
    values.dispose()
    entries.dispose()
    keys.dispose()
    map.dispose()
  })

  it('SI-D01 invalidates Set iteration and snapshot views when insertion order changes', () => {
    /** A real Runtime owns both the collection and tracked readers. */
    const runtime = createRuntime()
    /** Native Set iteration order is part of both public projections. */
    const set = new ObservableSet(['a', 'b'], runtime)
    /** Derive the direct values projection. */
    const values = runtime.computed(() => set.valuesArray())
    /** Derive an independent snapshot projection. */
    const snapshot = runtime.computed(() => [...set.snapshot()])
    expect(values.value).toEqual(['a', 'b'])
    expect(snapshot.value).toEqual(['a', 'b'])
    set.replace(['b', 'a'])
    runtime.flush()
    expect(values.value).toEqual(set.valuesArray())
    expect(snapshot.value).toEqual([...set.snapshot()])
    snapshot.dispose()
    values.dispose()
    set.dispose()
  })
  it('SI-D02 rejects the same invalid JavaScript Map entry at construction and replacement', () => {
    /** Native Map entry admission must run before collection ownership is established. */
    expect(() => Reflect.construct(ObservableMap, [['ab']])).toThrow(
      expect.objectContaining({ source: '@migaia/store-indexed', code: 'INVALID_OPTION' })
    )
    /** Replacement must reject without disturbing the prior valid data. */
    const map = new ObservableMap([['old', 1]])
    expect(() => Reflect.apply(map.replace, map, [['ab']])).toThrow(
      expect.objectContaining({ source: '@migaia/store-indexed', code: 'INVALID_OPTION' })
    )
    expect(map.entries()).toEqual([['old', 1]])
    map.dispose()
  })

  it.each(['guard', 'updater'] as const)(
    'SI-D03 identifies native %s failure without committing the outer mutation',
    (kind) => {
      /** The callback owns its original native TypeError, message and stack. */
      const primary = new TypeError('application callback failed')
      /** One actual supported callback fails before any backing write. */
      const object = new ObservableObject(
        { count: 1 },
        undefined,
        kind === 'guard'
          ? {
              mutationGuard: {
                assertMutationAllowed() {
                  throw primary
                }
              }
            }
          : {}
      )
      expect(() =>
        kind === 'guard'
          ? object.set('count', 2)
          : object.update('count', () => {
              throw primary
            })
      ).toThrow(primary)
      expect(primary).toMatchObject({ source: '@migaia/store-indexed', code: 'CALLBACK_FAILED' })
      expect(primary).toBeInstanceOf(TypeError)
      expect(object.peek('count')).toBe(1)
      object.dispose()
    }
  )

  it('SI-D04 publishes array cells and revision as one synchronous batch', () => {
    /** The documented scheduler can flush effects synchronously. */
    const runtime = createRuntime({ schedulerStrategy: (flush) => flush() })
    /** Both public views must describe the same committed array. */
    const array = new ObservableArray([1], runtime)
    /** Capture actual effect observations, not private signal state. */
    const pairs: unknown[] = []
    /** Initial tracking materializes the cell and caches the revision snapshot. */
    const effect = runtime.effect(() => {
      pairs.push([array.at(0), array.snapshot()[0]])
    })
    runtime.flush()
    array.set(0, 2)
    runtime.flush()
    expect(pairs).toEqual([
      [1, 1],
      [2, 2]
    ])
    effect.dispose()
    array.dispose()
  })
  it('SI-D03 preserves an already coded foreign guard failure', () => {
    /** Use the dependency's public native cancellation error, not a fabricated identity. */
    const primary = new UtilsAbortError('application cancellation')
    /** The collection must not relabel its guard's actual owner. */
    const object = new ObservableObject({ count: 1 }, undefined, {
      mutationGuard: {
        assertMutationAllowed() {
          throw primary
        }
      }
    })
    expect(() => object.set('count', 2)).toThrow(primary)
    expect(primary).toMatchObject({ source: '@migaia/utils', code: 'ABORTED' })
    expect(object.peek('count')).toBe(1)
    object.dispose()
  })

  it('SI-D03 retains a frozen native updater failure on the coded cause', () => {
    /** Frozen native errors cannot accept identity properties. */
    const primary = Object.freeze(new TypeError('frozen updater failed'))
    /** Failure precedes the collection's commit boundary. */
    const object = new ObservableObject({ count: 1 })
    expect(() =>
      object.update('count', () => {
        throw primary
      })
    ).toThrow(
      expect.objectContaining({
        source: '@migaia/store-indexed',
        code: 'CALLBACK_FAILED',
        cause: primary
      })
    )
    expect(object.peek('count')).toBe(1)
    object.dispose()
  })
})
