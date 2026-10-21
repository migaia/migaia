import { describe, expect, it } from 'vitest'
import { createRuntime } from '@migaia/reactive'
import { ObservableArray, ObservableMap, ObservableSet } from '../src/index.js'

describe('public collection subscriptions', () => {
  it('tracks an array tail and a growing fixed index through structural edits', () => {
    /** An isolated Runtime owns both collection subscriptions. */
    const runtime = createRuntime()
    /** The fixed index starts absent and becomes present after a push. */
    const array = new ObservableArray([1], runtime)
    /** Visible tail values prove structural reads move to the new final cell. */
    const tails: Array<number | undefined> = []
    /** Fixed-index observers must survive transitions through an absent value. */
    const fixed: Array<number | undefined> = []
    /** This effect uses only the documented relative-index read. */
    const tailEffect = runtime.effect(() => {
      tails.push(array.at(-1))
    })
    /** This effect observes a future index without materializing private state. */
    const fixedEffect = runtime.effect(() => {
      fixed.push(array.at(2))
    })
    try {
      expect(array.push(2, 3)).toBe(3)
      array.set(0, 9)
      expect(tails).toEqual([1, 3])
      expect(fixed).toEqual([undefined, 3])
      array.set(2, 4)
      expect(array.pop()).toBe(4)
      array.replace([7, 8, 9])
      array.clear()
      expect(array.pop()).toBeUndefined()
      expect(tails).toEqual([1, 3, 4, 2, 9, undefined])
      expect(fixed).toEqual([undefined, 3, 4, undefined, 9, undefined])
      expect(array.length).toBe(0)
      expect(array.at(-2)).toBeUndefined()
    } finally {
      tailEffect.dispose()
      fixedEffect.dispose()
      array.dispose()
    }
  })

  it('keeps array snapshots stable until content changes and rejects invalid writes atomically', () => {
    /** Public snapshot identity avoids rebuilding unchanged application render data. */
    const array = new ObservableArray([1, 2])
    try {
      /** This frozen view must remain detached from all subsequent edits. */
      const original = array.snapshot()
      expect(Object.isFrozen(original)).toBe(true)
      array.set(0, 1)
      expect(array.push()).toBe(2)
      expect(array.snapshot()).toBe(original)
      /** Native splice results remain frozen and distinct from the cached snapshot. */
      const removed = array.splice(1, 1, 5)
      expect(removed).toEqual([2])
      expect(Object.isFrozen(removed)).toBe(true)
      expect(array.snapshot()).toEqual([1, 5])
      expect(array.snapshot()).not.toBe(original)
      expect(original).toEqual([1, 2])
      expect(array.splice(1)).toEqual([5])
      expect(array.peek()).toEqual([1])
      expect(() => array.at(0.5)).toThrow(
        expect.objectContaining({
          name: 'TypeError',
          source: '@migaia/store-indexed',
          code: 'INVALID_INDEX'
        })
      )
      expect(() => array.set(-1, 8)).toThrow(
        expect.objectContaining({
          name: 'RangeError',
          source: '@migaia/store-indexed',
          code: 'INDEX_OUT_OF_RANGE'
        })
      )
      expect(() => array.set(1, 8)).toThrow(expect.objectContaining({ code: 'INDEX_OUT_OF_RANGE' }))
      expect(array.snapshot()).toEqual([1])
    } finally {
      array.dispose()
    }
    expect(() => array.snapshot()).toThrow(expect.objectContaining({ code: 'COLLECTION_DISPOSED' }))
  })

  it('isolates map key observers and preserves deleted-key subscriptions through prune', () => {
    /** Target and sibling keys share a collection but not a reactive dependency. */
    const runtime = createRuntime()
    /** Reinsertion uses normal native Map insertion ordering. */
    const map = new ObservableMap<string, number>(
      [
        ['target', 1],
        ['other', 2]
      ],
      runtime
    )
    /** Application output observes both lookup value and membership for one key. */
    const values: Array<readonly [number | undefined, boolean]> = []
    /** This observer must remain connected while its key is absent. */
    const effect = runtime.effect(() => {
      values.push([map.get('target'), map.has('target')])
    })
    try {
      map.set('other', 3)
      map.set('target', 1)
      expect(values).toEqual([[1, true]])
      map.set('target', 2)
      expect(map.delete('target')).toBe(true)
      expect(map.prune()).toBe(0)
      expect(values).toEqual([
        [1, true],
        [2, true],
        [undefined, false]
      ])
      map.set('target', 4)
      expect(map.peek('target')).toBe(4)
      expect(map.size).toBe(2)
      expect(map.keys()).toEqual(['other', 'target'])
      expect(map.valuesArray()).toEqual([3, 4])
      expect(map.entries()).toEqual([
        ['other', 3],
        ['target', 4]
      ])
      expect(Object.isFrozen(map.entries()[0])).toBe(true)
      /** A detached snapshot must not observe later key replacement. */
      const snapshot = map.snapshot()
      map.clear()
      map.clear()
      expect(map.delete('missing')).toBe(false)
      expect([...snapshot]).toEqual([
        ['other', 3],
        ['target', 4]
      ])
      expect(values).toEqual([
        [1, true],
        [2, true],
        [undefined, false],
        [4, true],
        [undefined, false]
      ])
    } finally {
      effect.dispose()
      map.dispose()
    }
    expect(() => map.get('target')).toThrow(
      expect.objectContaining({ source: '@migaia/store-indexed', code: 'COLLECTION_DISPOSED' })
    )
  })

  it('keeps map key iteration unchanged on value updates while publishing value iteration', () => {
    /** Iteration dependencies are distinct from membership and per-key lookup dependencies. */
    const runtime = createRuntime()
    /** A stable key set lets value-only replacement exercise the separate public views. */
    const map = new ObservableMap<string, number>(
      [
        ['a', 1],
        ['b', 2]
      ],
      runtime
    )
    /** Key observations count only structural changes. */
    const keys: Array<readonly string[]> = []
    /** Value observations must publish changes even when keys stay the same. */
    const values: Array<readonly number[]> = []
    /** This effect intentionally reads only the public key view. */
    const keyEffect = runtime.effect(() => {
      keys.push(map.keys())
    })
    /** This effect intentionally reads only the public value view. */
    const valueEffect = runtime.effect(() => {
      values.push(map.valuesArray())
    })
    try {
      map.replace([
        ['a', 3],
        ['b', 4]
      ])
      expect(keys).toEqual([['a', 'b']])
      expect(values).toEqual([
        [1, 2],
        [3, 4]
      ])
      map.replace([
        ['b', 4],
        ['a', 3]
      ])
      expect(keys).toEqual([
        ['a', 'b'],
        ['b', 'a']
      ])
      expect(values).toEqual([
        [1, 2],
        [3, 4],
        [4, 3]
      ])
    } finally {
      keyEffect.dispose()
      valueEffect.dispose()
      map.dispose()
    }
  })

  it('keeps set membership selective across delete, reinsert and replacement', () => {
    /** One isolated graph owns the membership observer and its cleanup. */
    const runtime = createRuntime()
    /** Sibling edits must not invalidate the observed target membership. */
    const set = new ObservableSet(['target', 'other'], runtime)
    /** Public membership output records only meaningful target changes. */
    const present: boolean[] = []
    /** This subscription must survive a tombstone that prune cannot reclaim. */
    const effect = runtime.effect(() => {
      present.push(set.has('target'))
    })
    try {
      expect(set.add('sibling')).toBe(set)
      set.add('target')
      expect(set.delete('missing')).toBe(false)
      expect(present).toEqual([true])
      expect(set.delete('target')).toBe(true)
      expect(set.prune()).toBe(0)
      set.add('target')
      set.replace(['other'])
      set.replace(['target', 'other'])
      expect(set.size).toBe(2)
      expect(set.valuesArray()).toEqual(['target', 'other'])
      /** Snapshot membership stays detached after the source collection is cleared. */
      const snapshot = set.snapshot()
      set.clear()
      set.clear()
      expect([...snapshot]).toEqual(['target', 'other'])
      expect(present).toEqual([true, false, true, false, true, false])
    } finally {
      effect.dispose()
      set.dispose()
    }
    expect(() => set.add('later')).toThrow(expect.objectContaining({ code: 'COLLECTION_DISPOSED' }))
  })
})
