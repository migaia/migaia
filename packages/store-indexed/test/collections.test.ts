import { describe, expect, it } from 'vitest'
import { defaultRuntime } from '@migaia/reactive'
import { ObservableArray, ObservableMap, ObservableObject, ObservableSet } from '../src'

describe('store-indexed', () => {
  it('contains revoked collection options and invalid debug names', () => {
    const { proxy, revoke } = Proxy.revocable({}, {})
    revoke()
    expect(() => new ObservableObject({ a: 1 }, defaultRuntime, proxy as never)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-indexed',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
    expect(
      () => new ObservableObject({ a: 1 }, defaultRuntime, { debugName: Symbol('name') as never })
    ).toThrow(expect.objectContaining({ source: '@migaia/store-indexed', code: 'INVALID_OPTION' }))
  })
  it('rejects non-iterable function inputs before collection materialization', () => {
    expect(() => new ObservableArray((() => undefined) as never)).toThrow(
      '[store] observable collection input must be a non-null object or iterable'
    )
    expect(() => new ObservableMap((() => undefined) as never)).toThrow()
    expect(() => new ObservableSet((() => undefined) as never)).toThrow()
  })

  it('captures iterator getters once and invokes each iterator with its original receiver', () => {
    const createStatefulIterable = <T>(values: readonly T[]) => {
      let reads = 0
      let calls = 0
      const iterable = {
        get [Symbol.iterator]() {
          reads++
          if (reads > 1) throw new Error('iterator getter reread')
          return function (this: unknown) {
            calls++
            expect(this).toBe(iterable)
            return values[Symbol.iterator]()
          }
        }
      }
      return { iterable, counts: () => [reads, calls] as const }
    }
    const arrayInput = createStatefulIterable([1, 2])
    const array = new ObservableArray(arrayInput.iterable)
    const map = new ObservableMap<string, number>([['old', 0]])
    const mapInput = createStatefulIterable([['next', 1] as const])
    map.replace(mapInput.iterable)
    const set = new ObservableSet([0])
    const setInput = createStatefulIterable([1, 2])
    set.replace(setInput.iterable)

    expect(array.snapshot()).toEqual([1, 2])
    expect(map.snapshot()).toEqual(new Map([['next', 1]]))
    expect(set.snapshot()).toEqual(new Set([1, 2]))
    expect(arrayInput.counts()).toEqual([1, 1])
    expect(mapInput.counts()).toEqual([1, 1])
    expect(setInput.counts()).toEqual([1, 1])
    array.dispose()
    map.dispose()
    set.dispose()
  })

  it('accepts string iterables for Array/Set but rejects them for Map', () => {
    const array = new ObservableArray('ab')
    const set = new ObservableSet('aba')

    expect(array.snapshot()).toEqual(['a', 'b'])
    expect(set.snapshot()).toEqual(new Set(['a', 'b']))
    expect(() => new ObservableMap('ab' as never)).toThrow(
      expect.objectContaining({ source: '@migaia/store-indexed', code: 'INVALID_OPTION' })
    )
    array.dispose()
    set.dispose()
  })

  it('tags iterator getter/call failures and preserves replace state', () => {
    const getterFailure = new Error('iterator getter failed')
    const callFailure = new Error('iterator call failed')
    expect(
      () =>
        new ObservableArray(
          Object.defineProperty({}, Symbol.iterator, {
            get() {
              throw getterFailure
            }
          }) as never
        )
    ).toThrow(
      expect.objectContaining({
        source: '@migaia/store-indexed',
        code: 'INVALID_OPTION',
        cause: getterFailure
      })
    )
    const array = new ObservableArray([1, 2])
    expect(() =>
      array.replace({
        [Symbol.iterator]() {
          throw callFailure
        }
      })
    ).toThrow(
      expect.objectContaining({
        source: '@migaia/store-indexed',
        code: 'INVALID_OPTION',
        cause: callFailure
      })
    )
    expect(array.snapshot()).toEqual([1, 2])
    array.dispose()
  })

  it('tags malformed Map entries before replacing existing state', () => {
    const map = new ObservableMap<string, number>([['old', 1]])
    expect(() => map.replace([1] as never)).toThrow(
      expect.objectContaining({ source: '@migaia/store-indexed', code: 'INVALID_OPTION' })
    )
    expect(map.snapshot()).toEqual(new Map([['old', 1]]))
    map.dispose()
  })
  it('rejects null constructor options with a tagged configuration error', () => {
    expect(() => new ObservableObject({ value: 1 }, defaultRuntime, null as never)).toThrow(
      '[store] observable collection options must be an object'
    )
  })

  it('rejects null collection inputs with a tagged TypeError', () => {
    const message = '[store] observable collection input must be a non-null object or iterable'
    expect(() => new ObservableObject(null as never)).toThrow(message)
    expect(() => new ObservableArray(null as never)).toThrow(message)
    expect(() => new ObservableMap(null as never)).toThrow(message)
    expect(() => new ObservableSet(null as never)).toThrow(message)
  })

  it('rejects non-string object keys before mutation guard formatting', () => {
    const object = new ObservableObject({ value: 1 })
    for (const operation of [
      () => object.get(Symbol('key') as never),
      () => object.peek(Symbol('key') as never),
      () => object.has(Symbol('key') as never),
      () => (object.set as (key: unknown, value: unknown) => void)(Symbol('key'), 2),
      () => (object.update as (key: unknown, updater: unknown) => void)(Symbol('key'), () => 2),
      () => object.delete(Symbol('key') as never)
    ]) {
      expect(operation).toThrow('[store] ObservableObject key must be a string')
    }
    expect(object.snapshot()).toEqual({ value: 1 })
    object.dispose()
  })

  it('supports indexed collection reads and writes', () => {
    const collection = new ObservableArray([1, 2, 3])
    expect(collection.at(1)).toBe(2)
    collection.set(1, 4)
    expect(collection.at(1)).toBe(4)
    collection.dispose()
  })

  it('preserves native no-argument splice semantics and skips no-op notifications', () => {
    const collection = new ObservableArray([1, 2, 3])
    let runs = 0
    const dispose = defaultRuntime.effect(() => {
      collection.snapshot()
      runs++
    })

    expect((collection.splice as (...args: never[]) => readonly number[])()).toEqual([])
    expect(collection.splice(1, 0)).toEqual([])
    expect(collection.snapshot()).toEqual([1, 2, 3])
    expect(runs).toBe(1)

    dispose()
    collection.dispose()
  })

  it('ObservableMap.replace() atomically swaps content with a single structural notification', () => {
    const map = new ObservableMap<string, number>([
      ['a', 1],
      ['b', 2]
    ])
    let runs = 0
    const dispose = defaultRuntime.effect(() => {
      map.snapshot()
      runs++
    })
    expect(runs).toBe(1)

    map.replace([
      ['c', 3],
      ['d', 4]
    ])

    // One notification for the whole swap, not one per removed/added key.
    expect(runs).toBe(2)
    expect(map.snapshot()).toEqual(
      new Map([
        ['c', 3],
        ['d', 4]
      ])
    )
    expect(map.has('a')).toBe(false)
    expect(map.has('b')).toBe(false)
    expect(map.size).toBe(2)

    dispose()
    map.dispose()
  })

  it('ObservableMap.replace() accepts a ReadonlyMap and no-ops the notification when content is unchanged', () => {
    const map = new ObservableMap<string, number>([['a', 1]])
    let runs = 0
    const dispose = defaultRuntime.effect(() => {
      map.snapshot()
      runs++
    })
    expect(runs).toBe(1)

    map.replace(new Map([['a', 1]]))
    expect(runs).toBe(1)

    dispose()
    map.dispose()
  })

  it('ObservableSet.replace() atomically swaps content with a single structural notification', () => {
    const set = new ObservableSet<number>([1, 2])
    let runs = 0
    const dispose = defaultRuntime.effect(() => {
      set.snapshot()
      runs++
    })
    expect(runs).toBe(1)

    set.replace([3, 4, 5])

    // One notification for the whole swap, not one per removed/added value.
    expect(runs).toBe(2)
    expect(set.snapshot()).toEqual(new Set([3, 4, 5]))
    expect(set.has(1)).toBe(false)
    expect(set.has(2)).toBe(false)
    expect(set.size).toBe(3)

    dispose()
    set.dispose()
  })

  it('ObservableSet.replace() no-ops the notification when content is unchanged', () => {
    const set = new ObservableSet<number>([1, 2])
    let runs = 0
    const dispose = defaultRuntime.effect(() => {
      set.snapshot()
      runs++
    })
    expect(runs).toBe(1)

    set.replace([2, 1])
    expect(runs).toBe(1)

    dispose()
    set.dispose()
  })

  it('ObservableSet.clear() publishes one structural change and updates materialized cells', () => {
    const set = new ObservableSet<number>([1, 2, 3])
    let structuralRuns = 0
    let membershipRuns = 0
    const disposeStructure = defaultRuntime.effect(() => {
      set.snapshot()
      structuralRuns++
    })
    const disposeMembership = defaultRuntime.effect(() => {
      set.has(1)
      membershipRuns++
    })

    set.clear()

    expect(set.snapshot()).toEqual(new Set())
    expect(structuralRuns).toBe(2)
    expect(membershipRuns).toBe(2)

    disposeMembership()
    disposeStructure()
    set.dispose()
  })

  it('batch clear/replace invoke the mutation guard exactly once', () => {
    let calls = 0
    const mutationGuard = {
      assertMutationAllowed(): void {
        calls++
        if (calls > 1) throw new Error('nested mutation guard')
      }
    }
    const set = new ObservableSet([1, 2], defaultRuntime, { mutationGuard })
    set.clear()
    expect(calls).toBe(1)
    const object = new ObservableObject<Record<string, number>>({ a: 1, b: 2 }, defaultRuntime, {
      mutationGuard: {
        assertMutationAllowed(): void {
          calls++
          if (calls > 2) throw new Error('nested mutation guard')
        }
      }
    })
    object.replace({ c: 3 })
    expect(calls).toBe(2)
    set.dispose()
    object.dispose()
  })

  it('ObservableObject.replace() reads hostile getters before mutating existing keys', () => {
    const object = new ObservableObject({ a: 1, b: 2 })
    const next = {
      get a() {
        throw new Error('hostile getter')
      }
    } as unknown as { a: number; b: number }
    expect(() => object.replace(next)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-indexed',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
    expect(object.snapshot()).toEqual({ a: 1, b: 2 })
    object.dispose()
  })

  it('contains a revoked replacement proxy and preserves the old state', () => {
    const object = new ObservableObject({ a: 1, b: 2 })
    const { proxy, revoke } = Proxy.revocable({ a: 3 }, {})
    revoke()
    expect(() => object.replace(proxy as never)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-indexed',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    )
    expect(object.snapshot()).toEqual({ a: 1, b: 2 })
    object.dispose()
  })

  it('ObservableMap.replace() materializes a hostile iterator before committing', () => {
    const map = new ObservableMap<string, number>([
      ['a', 1],
      ['b', 2]
    ])
    const failure = new Error('hostile map iterator')
    const hostile = {
      *[Symbol.iterator](): IterableIterator<readonly [string, number]> {
        yield ['c', 3]
        throw failure
      }
    }
    expect(() => map.replace(hostile)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-indexed',
        code: 'INVALID_OPTION',
        cause: failure
      })
    )
    expect(map.snapshot()).toEqual(
      new Map([
        ['a', 1],
        ['b', 2]
      ])
    )
    map.dispose()
  })

  it('ObservableSet.replace() materializes a hostile iterator before committing', () => {
    const set = new ObservableSet<number>([1, 2])
    const failure = new Error('hostile set iterator')
    const hostile = {
      *[Symbol.iterator](): IterableIterator<number> {
        yield 3
        throw failure
      }
    }
    expect(() => set.replace(hostile)).toThrow(
      expect.objectContaining({
        source: '@migaia/store-indexed',
        code: 'INVALID_OPTION',
        cause: failure
      })
    )
    expect(set.snapshot()).toEqual(new Set([1, 2]))
    set.dispose()
  })
})

it('contains hostile object constructor proxies before ownership admission', () => {
  const initial = new Proxy(
    {},
    {
      ownKeys: () => {
        throw new Error('ownKeys failure')
      }
    }
  )
  try {
    new ObservableObject(initial as never)
    throw new Error('expected constructor to fail')
  } catch (error) {
    expect(error).toMatchObject({
      source: '@migaia/store-indexed',
      code: 'INVALID_OPTION',
      cause: expect.any(Error)
    })
  }
})

it('contains hostile iterable constructor failures before ownership admission', () => {
  const initial = {
    *[Symbol.iterator](): IterableIterator<number> {
      yield 1
      throw new Error('iterator failure')
    }
  }
  for (const create of [
    () => new ObservableArray(initial),
    () => new ObservableMap(initial as never),
    () => new ObservableSet(initial)
  ]) {
    try {
      create()
      throw new Error('expected constructor to fail')
    } catch (error) {
      expect(error).toMatchObject({
        source: '@migaia/store-indexed',
        code: 'INVALID_OPTION',
        cause: expect.any(Error)
      })
    }
  }
})
