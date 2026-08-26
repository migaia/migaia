import { describe, expect, it } from 'vitest'
import {
  CONFIG_DELETE,
  combineConfig,
  ownConfig,
  parseConfigPath,
  patchConfig,
  readConfigPath,
  readonlyConfig
} from '../src/config.js'

describe('config primitives', () => {
  it('supports owned copy-on-write and stable empty identity', () => {
    const base = ownConfig({ a: 1, nested: { ok: true } })
    expect(patchConfig(base, {})).toBe(base)
    expect(patchConfig(base, { a: 2 }).a).toBe(2)
    expect(patchConfig(base, { a: 2 }).nested).toBe(base.nested)
    const cyclic = ownConfig({ nested: {} as { back?: unknown } })
    ;(cyclic.nested as { back?: unknown }).back = cyclic
    const rebased = patchConfig(cyclic, { a: 2 })
    expect(rebased.nested).not.toBe(cyclic.nested)
    expect((rebased.nested as { back?: unknown }).back).toBe(rebased)
    const mapRoot = ownConfig({ values: new Map<string, unknown>() })
    ;(mapRoot.values as Map<string, unknown>).set('root', mapRoot)
    const mapRebased = patchConfig(mapRoot, { value: true })
    expect((mapRebased.values as Map<string, unknown>).get('root')).toBe(mapRebased)
    const setRoot = ownConfig({ values: new Set<unknown>() })
    ;(setRoot.values as Set<unknown>).add(setRoot)
    const setRebased = patchConfig(setRoot, { value: true })
    expect([...(setRebased.values as Set<unknown>)][0]).toBe(setRebased)
    const other = ownConfig({ b: 2 })
    expect(combineConfig([base, other])).toEqual({ a: 1, nested: { ok: true }, b: 2 })
    expect(combineConfig([base])).toBe(base)
    expect(() => readonlyConfig({ a: 1 } as never)).toThrow()
    expect(() => ownConfig({ fn: () => undefined })).toThrow()
    const view = readonlyConfig(base)
    expect(() => {
      ;(view as { a: number }).a = 2
    }).toThrow()
    const collection = ownConfig({
      map: new Map([['x', { ok: true }]]),
      set: new Set([1]),
      date: new Date(0),
      regexp: /x/g
    })
    const collectionView = readonlyConfig(collection)
    expect(collectionView.map.get('x')).toEqual({ ok: true })
    expect(() => {
      ;(collectionView.map.get('x') as { ok: boolean }).ok = false
    }).toThrow(/readonly/)
    expect(collectionView.map.size).toBe(1)
    expect([...collectionView.map.entries()][0][1]).toEqual({ ok: true })
    const objectKey = {}
    const keyed = ownConfig({ map: new Map([[objectKey, 'value']]) })
    const keyedView = readonlyConfig(keyed)
    const facadeKey = [...keyedView.map.keys()][0]
    expect(keyedView.map.get(facadeKey)).toBe('value')
    let callbackMap!: [unknown, unknown, unknown]
    keyedView.map.forEach((value, key, map) => {
      callbackMap = [value, key, map]
    })
    expect(callbackMap[0]).toBe('value')
    expect(callbackMap[2]).toBe(keyedView.map)
    expect(() => (collectionView.map as Map<string, unknown>).set('y', 2)).toThrow()
    expect(collectionView.set.has(1)).toBe(true)
    expect(collectionView.set.size).toBe(1)
    expect([...collectionView.set.values()]).toEqual([1])
    expect(() => collectionView.set.add(2)).toThrow()
    expect(collectionView.date.getTime()).toBe(0)
    expect(collectionView.regexp.exec('x')?.[0]).toBe('x')
    expect(collectionView.regexp.lastIndex).toBe(0)
    expect(() => Object.preventExtensions(collectionView)).toThrow(/readonly/)
    expect(() => collectionView.date.setUTCFullYear(2020)).toThrow(/readonly/)
    const callable = ownConfig({ fn: (value: number) => value + 1 }, { profile: 'richRuntime' })
    const callableView = readonlyConfig(callable)
    expect(callableView.fn(2)).toBe(3)
    expect(callableView.fn).not.toBe(callable.fn)
    const constructable = function (this: { value?: number }, value: number) {
      this.value = value
    }
    Object.defineProperty(constructable, 'label', {
      value: { text: 'owned' },
      writable: true,
      configurable: true
    })
    const callableConfig = ownConfig({ constructable }, { profile: 'richRuntime' })
    type IConstructable = {
      new (value: number): { value?: number }
      readonly label: { text: string }
    }
    const clonedConstructor = callableConfig.constructable as unknown as IConstructable
    expect(new clonedConstructor(4).value).toBe(4)
    expect(clonedConstructor.label).not.toBe(
      (constructable as typeof constructable & { label: { text: string } }).label
    )
    const first = ownConfig({ list: [1, 2], keep: true, remove: 1 })
    const second = ownConfig({ list: [3], keep: undefined })
    expect(
      combineConfig([first, second], { strategies: { array: 'concat', undefined: 'ignore' } })
    ).toMatchObject({ list: [1, 2, 3], keep: true })
    expect(patchConfig(first, { remove: CONFIG_DELETE }).remove).toBeUndefined()
    const maps = combineConfig(
      [ownConfig({ values: new Map([['a', 1]]) }), ownConfig({ values: new Map([['b', 2]]) })],
      { strategies: { map: 'merge' } }
    )
    expect([...(maps.values as Map<string, number>).entries()]).toEqual([
      ['a', 1],
      ['b', 2]
    ])
    const sets = combineConfig(
      [ownConfig({ values: new Set([1]) }), ownConfig({ values: new Set([2]) })],
      { strategies: { set: 'union' } }
    )
    expect([...(sets.values as Set<number>)]).toEqual([1, 2])
    const ruled = combineConfig(
      [ownConfig({ nested: { value: [1] } }), ownConfig({ nested: { value: [2] } })],
      {
        strategies: { array: 'replace' },
        pathRules: [{ prefix: ['nested', 'value'], strategies: { array: 'concat' } }]
      }
    )
    expect((ruled.nested as { value: number[] }).value).toEqual([1, 2])
    const resolved = combineConfig([ownConfig({ value: 1 }), ownConfig({ value: 2 })], {
      onConflict: () => ({ kind: 'value', value: 3 })
    })
    expect(resolved.value).toBe(3)
    const paths: PropertyKey[][] = []
    combineConfig([ownConfig({ nested: { value: 1 } }), ownConfig({ nested: { value: 2 } })], {
      onConflict: (context) => {
        paths.push([...context.path])
        return { kind: 'right' }
      }
    })
    expect(paths).toEqual([['nested', 'value']])
    expect(() =>
      combineConfig([ownConfig({ value: 1 }), ownConfig({ value: 2 })], {
        onConflict: () => Promise.resolve({ kind: 'right' }) as never
      })
    ).toThrow(/synchronous/)
    const deleted = combineConfig([ownConfig({ value: 1 }), ownConfig({ value: CONFIG_DELETE })])
    expect(Object.hasOwn(deleted, 'value')).toBe(false)
    const deletedIndex = combineConfig(
      [ownConfig({ values: [1, 2] }), ownConfig({ values: [CONFIG_DELETE, 3] })],
      { strategies: { array: 'mergeByIndex' } }
    )
    expect(0 in (deletedIndex.values as unknown[])).toBe(false)
    const deletedMap = combineConfig(
      [
        ownConfig({ values: new Map([['x', 1]]) }),
        ownConfig({ values: new Map([['x', CONFIG_DELETE]]) })
      ],
      { strategies: { map: 'merge' } }
    )
    expect((deletedMap.values as Map<string, unknown>).has('x')).toBe(false)
    expect(() =>
      combineConfig(
        [ownConfig({ values: new Set([1]) }), ownConfig({ values: new Set([CONFIG_DELETE]) })],
        { strategies: { set: 'union' } }
      )
    ).toThrow(/delete is not valid/)
  })

  it('fails closed on root symbols and graph resource limits', () => {
    const symbol = Symbol('root')
    expect(() => ownConfig({ [symbol]: true })).toThrow(/unsupported config value/)
    expect(() => ownConfig({ nested: { value: 1 } }, { limits: { maxNodes: 1 } })).toThrow(
      /limit exceeded/
    )
    expect(() => ownConfig({ a: 1, b: 2 }, { limits: { maxKeys: 1 } })).toThrow(/limit exceeded/)
  })

  it('preserves config bracket text while delegating canonical path validation', () => {
    expect(parseConfigPath('items.[01].value')).toEqual(['items', '01', 'value'])
  })

  it('preserves exact identity for repeated ownership with matching metadata', () => {
    const owned = ownConfig({ value: 1 })
    expect(ownConfig(owned)).toBe(owned)
    expect(() => ownConfig(owned, { profile: 'richRuntime' })).toThrow(/config conflict/)
    expect(() => ownConfig(owned, { limits: { maxDepth: 1 } })).toThrow(/config conflict/)
  })

  it('snapshots config options before validation and cloning', () => {
    let profileReads = 0
    let limitsReads = 0
    const ownOptions = {
      get profile() {
        profileReads++
        return 'data' as const
      },
      get limits() {
        limitsReads++
        return { maxDepth: 8 }
      }
    }
    const owned = ownConfig({ nested: { value: 1 } }, ownOptions)
    expect(profileReads).toBe(1)
    expect(limitsReads).toBe(1)
    expect(() => ownConfig(owned, ownOptions)).not.toThrow()

    let patchProfileReads = 0
    let patchLimitsReads = 0
    const patched = patchConfig(
      owned,
      { value: 2 },
      {
        get profile() {
          patchProfileReads++
          return 'data' as const
        },
        get limits() {
          patchLimitsReads++
          return { maxDepth: 8 }
        }
      }
    )
    expect((patched as Record<PropertyKey, unknown>).value).toBe(2)
    expect(patchProfileReads).toBe(1)
    expect(patchLimitsReads).toBe(1)

    let combineProfileReads = 0
    let combineLimitsReads = 0
    const combined = combineConfig([owned, ownConfig({ other: true })], {
      get profile() {
        combineProfileReads++
        return 'data' as const
      },
      get limits() {
        combineLimitsReads++
        return { maxDepth: 8 }
      }
    })
    expect(combined.other).toBe(true)
    expect(combineProfileReads).toBe(1)
    expect(combineLimitsReads).toBe(1)
  })

  it('clones custom prototype graphs and preserves prototype cycles in richRuntime', () => {
    const prototype = { inherited: { value: 1 } } as {
      inherited: { value: number }
      root?: unknown
    }
    prototype.root = prototype
    const source = Object.create(prototype) as { own: number }
    source.own = 2
    const owned = ownConfig({ source }, { profile: 'richRuntime' })
    const ownedSource = owned.source as typeof source
    const ownedPrototype = Object.getPrototypeOf(ownedSource) as typeof prototype
    expect(ownedPrototype).not.toBe(prototype)
    expect(ownedPrototype.root).toBe(ownedPrototype)
    expect(ownedPrototype.inherited).not.toBe(prototype.inherited)
  })

  it('preserves richRuntime collection and temporal subclass brands', () => {
    class IMapSubclass extends Map<string, number> {
      read(): number | undefined {
        return this.get('value')
      }
    }
    class ISetSubclass extends Set<number> {
      hasValue(): boolean {
        return this.has(1)
      }
    }
    class IDateSubclass extends Date {
      marker = 'date'
    }
    const raw = {
      map: new IMapSubclass([['value', 2]]),
      set: new ISetSubclass([1]),
      date: new IDateSubclass(0)
    }
    expect([...raw.map.entries()]).toEqual([['value', 2]])
    const source = ownConfig(raw, { profile: 'richRuntime' })
    expect((source.map as IMapSubclass).read()).toBe(2)
    expect((source.set as ISetSubclass).hasValue()).toBe(true)
    expect(source.date).toBeInstanceOf(IDateSubclass)
    expect((source.date as IDateSubclass).getTime()).toBe(0)
    const view = readonlyConfig(source)
    expect((view.map as IMapSubclass).read()).toBe(2)
    expect((view.set as ISetSubclass).hasValue()).toBe(true)
    expect((view.date as IDateSubclass).getTime()).toBe(0)
    const mapPrototype = Object.getPrototypeOf(source.map)
    const readonlyMapPrototype = Object.getPrototypeOf(view.map)
    expect(readonlyMapPrototype).not.toBe(mapPrototype)
    expect(typeof (readonlyMapPrototype as IMapSubclass).read).toBe('function')
    expect(() => {
      ;((readonlyMapPrototype as { nested?: { value: number } }).nested ??= { value: 1 }).value = 2
    }).toThrow(/readonly/)
    const callable = function (this: { value: number }, increment: number): number {
      return this.value + increment
    }
    const callableOwned = ownConfig({ callable }, { profile: 'richRuntime' })
    const callableView = readonlyConfig(callableOwned)
    const holder = { value: 7, fn: callableView.callable as typeof callable }
    expect(holder.fn(2)).toBe(9)
    const explicitResult = { kind: 'explicit' }
    const explicit = () => explicitResult
    const explicitOwned = ownConfig({ explicit }, { profile: 'richRuntime' })
    const explicitView = readonlyConfig(explicitOwned)
    const returned = (explicitView.explicit as () => typeof explicitResult)()
    expect(returned).not.toBe(explicitResult)
    expect(() => {
      returned.kind = 'mutated'
    }).toThrow(/readonly/)

    class IConstructor {
      value: number
      constructor(value: number) {
        this.value = value
      }
    }
    const constructorOwned = ownConfig({ ctor: IConstructor }, { profile: 'richRuntime' })
    const constructorView = readonlyConfig(constructorOwned)
    const instance = new (constructorView.ctor as typeof IConstructor)(4)
    expect(instance.value).toBe(4)
    instance.value = 5
    expect(instance.value).toBe(5)
    let rawExplicitConstructed!: { kind: string }
    const explicitResultConstructor = function () {
      rawExplicitConstructed = { kind: 'explicit-constructor' }
      return rawExplicitConstructed
    }
    const explicitConstructorOwned = ownConfig(
      { ctor: explicitResultConstructor },
      { profile: 'richRuntime' }
    )
    const explicitConstructorView = readonlyConfig(explicitConstructorOwned)
    type IExplicitConstructor = { new (): { kind: string } }
    const explicitConstructed =
      new (explicitConstructorView.ctor as unknown as IExplicitConstructor)()
    expect(explicitConstructed).not.toBe(rawExplicitConstructed)
    expect(() => {
      explicitConstructed.kind = 'mutated'
    }).toThrow(/readonly/)
  })

  it('rejects hostile or non-record patches before publishing a root', () => {
    const base = ownConfig({ value: 1 })
    const getterPatch = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => {
        throw new Error('patch getter')
      }
    })
    expect(() => patchConfig(base, getterPatch)).toThrow(/accessor unsupported/)
    expect(() => patchConfig(base, new Map() as never)).toThrow(/plain record required/)
    expect(() => patchConfig(base, { [Symbol('patch')]: true })).toThrow(/symbol key/)
    const narrow = ownConfig({ value: 1 }, { limits: { maxDepth: 8 } })
    expect(() => patchConfig(narrow, { value: 2 }, { limits: { maxDepth: 9 } })).toThrow(
      /cannot widen/
    )
    expect(base.value).toBe(1)
  })

  it('rebases custom prototype root edges during richRuntime copy-on-write', () => {
    const prototype = { stable: { value: 1 }, root: undefined as unknown }
    const branch = Object.create(prototype) as { value: number }
    branch.value = 2
    const base = ownConfig({ branch, alias: branch }, { profile: 'richRuntime' })
    ;(Object.getPrototypeOf(base.branch) as typeof prototype).root = base
    const next = patchConfig(base, { changed: true }, { profile: 'richRuntime' })
    expect(next.branch).not.toBe(base.branch)
    expect(next.branch).toBe(next.alias)
    const nextPrototype = Object.getPrototypeOf(next.branch) as typeof prototype
    const basePrototype = Object.getPrototypeOf(base.branch) as typeof prototype
    expect(nextPrototype).not.toBe(basePrototype)
    expect(nextPrototype.root).toBe(next)
    expect(nextPrototype.stable).toBe(basePrototype.stable)
  })

  it('rebases callable prototype root aliases during richRuntime copy-on-write', () => {
    const callable = function (value: number): number {
      return value + 1
    }
    const prototype = { root: undefined as unknown, stable: { value: 1 } }
    Object.setPrototypeOf(callable, prototype)
    const base = ownConfig({ callable, alias: callable }, { profile: 'richRuntime' })
    ;(Object.getPrototypeOf(base.callable) as typeof prototype).root = base
    const next = patchConfig(base, { changed: true }, { profile: 'richRuntime' })
    expect(next.callable).not.toBe(base.callable)
    expect(next.callable).toBe(next.alias)
    const nextPrototype = Object.getPrototypeOf(next.callable) as typeof prototype
    expect(nextPrototype.root).toBe(next)
    expect(nextPrototype.stable).toBe(
      (Object.getPrototypeOf(base.callable) as typeof prototype).stable
    )
  })

  it('combines cyclic roots while preserving root and shared aliases', () => {
    const left = { value: 1, shared: { marker: true } } as {
      value: number
      shared: { marker: boolean }
      self?: unknown
      alias?: unknown
    }
    left.self = left
    left.alias = left.shared
    const right = { value: 2 } as { value: number; self?: unknown }
    right.self = right
    const result = combineConfig([
      ownConfig(left, { profile: 'richRuntime' }),
      ownConfig(right, { profile: 'richRuntime' })
    ])
    expect(result.value).toBe(2)
    expect(result.self).toBe(result)
    expect(result.alias).toBe(result.shared)
  })

  it('combines nested cyclic records without recursive overflow', () => {
    const leftNested = { left: true } as { left?: boolean; right?: boolean; self?: unknown }
    leftNested.self = leftNested
    const rightNested = { right: true } as { left?: boolean; right?: boolean; self?: unknown }
    rightNested.self = rightNested
    const result = combineConfig([
      ownConfig({ nested: leftNested }),
      ownConfig({ nested: rightNested })
    ])
    const nested = result.nested as typeof leftNested
    expect(nested.left).toBe(true)
    expect(nested.right).toBe(true)
    expect(nested.self).toBe(nested)
  })

  it('combines collection root edges and aliases without leaking source roots', () => {
    const left = { values: new Map<string, unknown>(), items: new Set<unknown>() }
    left.values.set('self', left)
    left.values.set('nested', { back: left })
    left.items.add(left)
    const right = { values: new Map<string, unknown>(), items: new Set<unknown>() }
    right.values.set('right', right)
    right.items.add(right)
    const result = combineConfig([ownConfig(left), ownConfig(right)], {
      strategies: { map: 'merge', set: 'union' }
    })
    const resultValues = result.values as Map<string, unknown>
    const resultItems = result.items as Set<unknown>
    expect(resultValues.get('self')).toBe(result)
    expect(resultValues.get('right')).toBe(result)
    expect((resultValues.get('nested') as { back: unknown }).back).toBe(result)
    expect([...resultItems].every((item) => item === result)).toBe(true)
  })

  it('validates array-form config paths instead of bypassing dangerous-key admission', () => {
    const config = ownConfig({ nested: { value: 1 } })
    expect(readConfigPath(config, ['nested', 'value'])).toMatchObject({ kind: 'value', value: 1 })
    expect(() => readConfigPath(config, ['__proto__'])).toThrow(/invalid config path/)
    expect(() => readConfigPath(config, [''])).toThrow(/invalid config path/)
    expect(() =>
      readConfigPath(
        config,
        Array.from({ length: 4097 }, () => 'nested')
      )
    ).toThrow(/invalid config path/)
  })
})
