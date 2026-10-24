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
  it('[BC2-CONCAT] retains one accumulator while synchronous conflicts observe current contents', () => {
    /** Frozen input proves descriptor preservation cannot make the private builder unwritable. */
    const shared = Object.freeze([1])
    /** Both keys in the first source must keep the same builder through every later concat. */
    const first = ownConfig({ items: shared, alias: shared })
    /** Callback observations are snapshots, while retained references remain live until completion. */
    const observed: unknown[][] = []
    /** Each callback receives the same private array rather than a newly copied prefix. */
    const retained: unknown[][] = []
    /** Scalar conflicts exercise the synchronous decision that made strict final observation cyclic. */
    const combined = combineConfig(
      [
        first,
        ownConfig({ items: 0 }),
        ownConfig({ items: [3] }),
        ownConfig({ items: 0 }),
        ownConfig({ items: [5] })
      ],
      {
        strategies: { array: 'concat' },
        onConflict: ({ left }) => {
          observed.push([...(left as unknown[])])
          retained.push(left as unknown[])
          return { kind: 'left' }
        }
      }
    )
    expect(observed).toEqual([[1], [1, 3]])
    expect(retained[0]).toBe(retained[1])
    expect(retained[0]).toEqual([1, 3, 5])
    expect(combined.items).toEqual([1, 3, 5])
    expect(combined.alias).toBe(combined.items)
    expect(combined.items).not.toBe(retained[0])
    expect(first.items).toEqual([1])
    expect(Object.getOwnPropertyDescriptor(first.items, 'length')?.writable).toBe(false)
  })

  it('[BC2-INDEX] keeps sparse index merges and retained aliases across multiple sources', () => {
    /** Initial aliases must follow index replacement and deletion on one frozen-input builder. */
    const shared = Object.freeze([1, 2, 3])
    /** A sparse incoming array changes only its present index, preserving earlier holes. */
    const later: number[] = []
    later[2] = 5
    /** The retained reference sees the final builder; copied observations preserve callback timing. */
    const retained: unknown[][] = []
    /** Hole presence is separately observable from an explicit undefined value. */
    const observed: { entries: unknown[]; firstPresent: boolean }[] = []
    /** All source arrays remain unchanged while the final owned graph shares its output alias. */
    const first = ownConfig({ items: shared, alias: shared })
    /** Index strategy remains synchronous and never copies an accumulated prefix. */
    const combined = combineConfig(
      [
        first,
        ownConfig({ items: 0 }),
        ownConfig({ items: [CONFIG_DELETE, 4] }),
        ownConfig({ items: 0 }),
        ownConfig({ items: later })
      ],
      {
        strategies: { array: 'mergeByIndex' },
        onConflict: ({ left }) => {
          retained.push(left as unknown[])
          observed.push({
            entries: [...(left as unknown[])],
            firstPresent: 0 in (left as unknown[])
          })
          return { kind: 'left' }
        }
      }
    )
    expect(observed).toEqual([
      { entries: [1, 2, 3], firstPresent: true },
      { entries: [undefined, 4, 3], firstPresent: false }
    ])
    expect(retained[0]).toBe(retained[1])
    expect(retained[0]).toEqual([undefined, 4, 5])
    expect(0 in retained[0]).toBe(false)
    expect(combined.items).toEqual([undefined, 4, 5])
    expect(0 in (combined.items as unknown[])).toBe(false)
    expect(combined.alias).toBe(combined.items)
    expect(combined.items).not.toBe(retained[0])
    expect(first.items).toEqual([1, 2, 3])
    expect(later.length).toBe(3)
    expect(later[2]).toBe(5)
    expect(0 in later).toBe(false)
  })

  it('[BC2-SOURCE-ALIAS] joins incoming aliases to the private accumulator without changing sources', () => {
    /** The right source supplies both an array alias and an element alias into the same graph. */
    const entry = { value: 2 }
    /** Frozen right arrays must never become the object receiving later in-place appends. */
    const rightItems = Object.freeze([entry])
    /** The later source must extend both the old left alias and the new right alias. */
    const right = ownConfig({ items: rightItems, rightAlias: rightItems, entry })
    /** Shared array identity survives a graph-edge cycle admitted by existing ownership. */
    const firstItems: unknown[] = [1]
    firstItems.push(firstItems)
    /** Source-local aliases are rebased before incoming elements are cloned. */
    const combined = combineConfig(
      [ownConfig({ items: firstItems, leftAlias: firstItems }), right, ownConfig({ items: [3] })],
      { strategies: { array: 'concat' } }
    )
    expect(combined.leftAlias).toBe(combined.items)
    expect(combined.rightAlias).toBe(combined.items)
    expect((combined.items as unknown[])[1]).toBe(combined.items)
    expect((combined.items as unknown[])[2]).toBe(combined.entry)
    expect((combined.items as unknown[])[3]).toBe(3)
    expect(right.items).toEqual([{ value: 2 }])
    expect(right.items[0]).toBe(right.entry)
    expect(Object.getOwnPropertyDescriptor(right.items, 'length')?.writable).toBe(false)
  })

  it('[BC2-STRATEGY-ALIAS] preserves holes until concat reaches the same shared accumulator', () => {
    /** Different path policies can visit the same builder through its two aliases in one source. */
    const shared = [1, 2]
    /** A later sparse write creates a gap which concat must densify without rescanning the prefix. */
    const sparse: number[] = []
    sparse[5] = 5
    /** The root's key order deliberately applies the index strategy before concat. */
    const combined = combineConfig(
      [
        ownConfig({ indexed: shared, appended: shared }),
        ownConfig({ indexed: [CONFIG_DELETE], appended: [3] }),
        ownConfig({ indexed: sparse, appended: [6] })
      ],
      {
        pathRules: [
          { prefix: ['indexed'], strategies: { array: 'mergeByIndex' } },
          { prefix: ['appended'], strategies: { array: 'concat' } }
        ]
      }
    )
    expect(combined.indexed).toBe(combined.appended)
    expect(combined.indexed).toEqual([undefined, 2, 3, undefined, undefined, 5, 6])
    expect(Object.keys(combined.indexed as unknown[])).toEqual(['0', '1', '2', '3', '4', '5', '6'])
  })

  it('[BC2-REPLACEMENT] privately adopts selected arrays and preserves untouched descriptor flags', () => {
    /** The resolver can select either an owned incoming array or a separate frozen replacement. */
    const right = ownConfig({ items: Object.freeze([2]), untouched: Object.freeze([9]) })
    /** A replacement is copied before later concat; the caller keeps its frozen source unchanged. */
    const replacement = Object.freeze([4])
    /** Scalar replacement ends the previous builder's lifetime instead of mutating old references. */
    const discarded: unknown[][] = []
    /** Explicit right and value decisions retain their source-ordered synchronous meaning. */
    const combined = combineConfig(
      [
        ownConfig({ items: 0 }),
        right,
        ownConfig({ items: [3] }),
        ownConfig({ items: 0 }),
        ownConfig({ items: [5] })
      ],
      {
        strategies: { array: 'concat' },
        onConflict: ({ left, right: incoming }) => {
          if (!Array.isArray(left)) return { kind: 'right' }
          discarded.push(left)
          return incoming === 0 ? { kind: 'value', value: replacement } : { kind: 'left' }
        }
      }
    )
    expect(discarded[0]).toEqual([2, 3])
    expect(combined.items).toEqual([4, 5])
    expect(right.items).toEqual([2])
    expect(replacement).toEqual([4])
    expect(Object.getOwnPropertyDescriptor(combined.untouched, 'length')?.writable).toBe(false)
    expect(Object.getOwnPropertyDescriptor(combined.untouched, '0')?.writable).toBe(false)
    expect(Object.getOwnPropertyDescriptor(combined.items, 'length')?.writable).toBe(true)
  })

  it('[BC2-INDEX-PROTOTYPE] preserves the default Array species result for custom prototypes', () => {
    /** Rich-runtime data can carry a custom prototype while still using the standard Array slice. */
    const prototype = Object.create(Array.prototype) as { tag?: string }
    prototype.tag = 'custom-prototype'
    /** Index merging previously discarded this inherited tag through default slice species. */
    const items = [1]
    Object.setPrototypeOf(items, prototype)
    /** A distinct untouched array verifies this normalization belongs only to actual merging. */
    const untouched = [3]
    Object.setPrototypeOf(untouched, prototype)
    /** Both roots use the same accepted rich-runtime profile. */
    const combined = combineConfig(
      [
        ownConfig({ items, untouched }, { profile: 'richRuntime' }),
        ownConfig({ items: [2] }, { profile: 'richRuntime' })
      ],
      { strategies: { array: 'mergeByIndex' } }
    )
    expect(combined.items).toEqual([2])
    expect(Object.getPrototypeOf(combined.items)).toBe(Array.prototype)
    expect('tag' in (combined.items as unknown[])).toBe(false)
    expect((combined.untouched as { tag?: string }).tag).toBe('custom-prototype')
    expect((Object.getPrototypeOf(items) as { tag?: string }).tag).toBe('custom-prototype')
  })

  it('[BC2-SELECTED-GRAPH] captures arrays inside resolver-selected records before nested conflicts', () => {
    /** Selecting this record must not lend its source array to the next nested callback. */
    const items = Object.freeze([1])
    /** A sibling alias must enter the same private builder at the record-selection boundary. */
    const selected = ownConfig({ branch: { items, alias: items } })
    /** The nested callback observes a current prefix and retains it until later concat completes. */
    let retained: unknown[] | undefined
    /** Capturing a selected object uses the same graph clone and existing source-order resolver. */
    const combined = combineConfig(
      [
        ownConfig({ branch: 0 }),
        selected,
        ownConfig({ branch: { items: 0 } }),
        ownConfig({ branch: { items: [2] } })
      ],
      {
        strategies: { array: 'concat' },
        onConflict: ({ path, left }) => {
          if (path.length === 1) return { kind: 'right' }
          expect(left).toEqual([1])
          retained = left as unknown[]
          return { kind: 'left' }
        }
      }
    )
    /** Publication retains graph aliases while separating the final root from callback builders. */
    const branch = combined.branch as { items: unknown[]; alias: unknown[] }
    expect(retained).toEqual([1, 2])
    expect(retained).not.toBe(selected.branch.items)
    expect(branch.items).toEqual([1, 2])
    expect(branch.items).toBe(branch.alias)
    expect(branch.items).not.toBe(retained)
    expect(selected.branch.items).toEqual([1])
    expect(selected.branch.items).toBe(selected.branch.alias)
  })

  it('[BC2-SELF-SOURCE] bounds concat when a callback places its retained builder into a later source', () => {
    /** The callback deliberately creates a source-to-builder alias after ownership was established. */
    const later = ownConfig({ items: [] as unknown[] })
    /** This reference must receive the finite result without appending during a live self-iteration. */
    let retained: unknown[] | undefined
    /** A self-alias snapshots only its actual incoming entries, never every ordinary source prefix. */
    const combined = combineConfig([ownConfig({ items: [1] }), ownConfig({ items: 0 }), later], {
      strategies: { array: 'concat' },
      onConflict: ({ left }) => {
        retained = left as unknown[]
        later.items = retained
        return { kind: 'left' }
      }
    })
    expect(retained).toEqual([1, 1])
    expect(later.items).toBe(retained)
    expect(combined.items).toEqual([1, 1])
    expect(combined.items).not.toBe(retained)
  })

  it('[BC-PATH-RULE-SNAPSHOT] reads each rule descriptor once and keeps longest-prefix declaration order', () => {
    /** Stable accessors expose exactly how often the input rule description is captured. */
    let prefixReads = 0
    /** Strategy access belongs to the same one-time snapshot, not each visited source property. */
    let strategyReads = 0
    /** Distinct sibling and nested arrays prove fallback, longest-prefix and equal-prefix behavior. */
    const combined = combineConfig(
      [
        ownConfig({ a: [1], b: [2], nested: { items: [3] } }),
        ownConfig({ a: [4], b: [5], nested: { items: [6] } })
      ],
      {
        pathRules: [
          { prefix: [], strategies: { array: 'concat' } },
          {
            get prefix() {
              prefixReads++
              return ['b']
            },
            get strategies() {
              strategyReads++
              return { array: 'replace' as const }
            }
          },
          { prefix: ['b'], strategies: { array: 'concat' } },
          { prefix: ['nested', 'items'], strategies: { array: 'replace' } }
        ]
      }
    )
    expect(prefixReads).toBe(1)
    expect(strategyReads).toBe(1)
    expect(combined).toEqual({ a: [1, 4], b: [5], nested: { items: [6] } })
  })

  it('rejects setMilliseconds through every readonly Date entry', () => {
    /** Both accessors must protect the same owned Date from supported native mutators. */
    const owned = ownConfig({ when: new Date(0) })
    /** Direct readonly view retains native Date reads while denying writes. */
    const view = readonlyConfig(owned)
    expect(() => view.when.setMilliseconds(123)).toThrowError(
      expect.objectContaining({ source: 'foundation.utils', code: 'CONFIG_READONLY' })
    )
    /** Path reads return a discriminated result whose value carries the same protection. */
    const read = readConfigPath(owned, 'when')
    expect(read.kind).toBe('value')
    if (read.kind === 'value')
      expect(() => (read.value as Date).setMilliseconds(123)).toThrowError(
        expect.objectContaining({ source: 'foundation.utils', code: 'CONFIG_READONLY' })
      )
    expect(owned.when.getTime()).toBe(0)
  })

  it('reads frozen nested descriptors through stable recursive readonly views', () => {
    /** Frozen arrays and records are valid owned data, including shared nested identities. */
    const nested = Object.freeze({ value: 1 })
    /** Ownership keeps source descriptors; the readonly facade must not violate Proxy invariants. */
    const owned = ownConfig(Object.freeze({ nested, items: Object.freeze([nested]) }))
    /** Repeated reads must share the same readonly view without exposing the mutable raw value. */
    const view = readonlyConfig(owned)
    expect(view.nested.value).toBe(1)
    expect(view.items[0]).toBe(view.nested)
    expect(readConfigPath(owned, 'nested')).toEqual({ kind: 'value', value: view.nested })
    expect(Array.isArray(view.items)).toBe(true)
    expect(Object.keys(view)).toEqual(['nested', 'items'])
    expect('nested' in view).toBe(true)
    expect(Object.getOwnPropertyDescriptor(owned, 'nested')?.configurable).toBe(false)
    expect(() => Reflect.set(view.nested, 'value', 2)).toThrowError(
      expect.objectContaining({ source: 'foundation.utils', code: 'CONFIG_READONLY' })
    )
    expect(owned.nested.value).toBe(1)
  })

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
