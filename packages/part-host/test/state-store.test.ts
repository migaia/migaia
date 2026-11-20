import { defineFeature } from '@migaia/plugin-host/features'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createPartHost,
  defineDerive,
  defineEffect,
  definePart,
  definePartPlugin,
  composeStore,
  partCorePlugin,
  defineResource,
  defineStateStore,
  defaultStateStore,
  PartHostErrorCode,
  type IPartPlugin,
  type IStateStatus,
  type IStateStore,
  type IStateStoreContext,
  type IStateStoreLayer,
  type IStateStoreMiddleware
} from '../src/index.ts'
import {
  AsyncCalls,
  bind,
  codeOf,
  Deferred,
  derive,
  settle,
  Tracked,
  until,
  type IAsyncCall
} from './store-support.ts'
import { definePlugin } from '@migaia/plugin-host'

/** Map-backed synchronous store recording every call; `set('items')` also updates `count`. */
class CartStore {
  /** Values by key. */
  readonly data = new Map<string, unknown>()
  /** Calls as `[name, key]`. */
  readonly calls: [string, string][] = []
  /** Context of the last `create`. */
  context: IStateStoreContext | undefined

  /** Store definition over this map. */
  define(namespace = 'cart') {
    return defineStateStore<CartStore>({
      namespace,
      create: (ctx) => {
        this.context = ctx
        return this
      },
      get: (store, key) => {
        store.calls.push(['get', key])
        return store.data.get(key)
      },
      set: (store, key, value) => {
        store.calls.push(['set', key])
        store.data.set(key, value)
        if (key !== 'items') return
        store.data.set('count', (value as unknown[]).length)
        return ['count']
      },
      has: (store, key) => {
        store.calls.push(['has', key])
        return store.data.has(key)
      }
    })
  }
}

describe('external stores (A1)', () => {
  it('routes, compares on write, merges outside changes and seeds through has', async () => {
    const cart = new CartStore()
    cart.data.set('items', [])
    cart.data.set('count', 0)
    cart.data.set('pre', 'x')
    const errors: unknown[] = []
    const plugin = definePartPlugin({
      name: 'cart',
      parts: [definePart({ id: 'button@1' })],
      stores: [cart.define()],
      derives: [
        defineDerive({
          id: 'cart.total@1',
          compute: (state) =>
            `${(state.read('cart.items') as unknown[]).length}/${String(state.read('cart.count'))}`
        }),
        defineDerive({
          id: 'mixed@1',
          compute: (state) => `${String(state.read('page.n'))}:${String(state.read('cart.count'))}`
        })
      ],
      effects: [
        defineEffect({
          id: 'buy@1',
          run: (_event, ctx) => {
            ctx.state.write('cart.items' as never, ['a', 'b'] as never)
            seen.push(
              ctx.state.read('cart.items' as never),
              host.state.resolve({} as never, { $derive: 'cart.total@1' }),
              host.state.resolve({} as never, { $derive: 'mixed@1' })
            )
            ctx.state.write('page.n' as never, 7 as never)
            seen.push(host.state.resolve({} as never, { $derive: 'mixed@1' }))
          }
        }),
        defineEffect({
          id: 'flag@1',
          run: (_event, ctx) => ctx.state.write('cart.flag' as never, 2 as never)
        })
      ]
    })
    /** Values the effect read. */
    const seen: unknown[] = []
    const host = await createPartHost({ plugins: [plugin], onError: (error) => errors.push(error) })
    await host.blueprint.load({
      id: 'bp',
      version: 1,
      root: {
        tag: 'button@1',
        id: 'b',
        facets: { events: { click: { handler: 'buy@1' }, flag: { handler: 'flag@1' } } }
      }
    })
    const nodeA = bind(host, 'cart.items')
    const nodeB = bind(host, 'cart.count')
    const total = derive(host, 'cart.total@1')
    await settle(host)

    // (1) Writes compare at once; `count` is compared because `set` returned it.
    await host.dispatch('b', 'click', null)
    expect(seen).toEqual([['a', 'b'], '2/2', 'undefined:2', '7:2'])
    await settle(host)
    expect(nodeA.last).toEqual(['a', 'b'])
    expect(nodeB.last).toBe(2)
    expect(cart.calls.filter(([name]) => name === 'set')).toEqual([['set', 'items']])

    // (2) Outside change with invalidate: visible after the microtask emission.
    const runsA = nodeA.runs
    const runsB = nodeB.runs
    const runsTotal = total.runs
    cart.data.set('count', 5)
    cart.context?.invalidate(['count'])
    expect(host.state.resolve({} as never, { $derive: 'cart.total@1' })).toBe('2/2')
    await settle(host)
    expect(host.state.resolve({} as never, { $derive: 'cart.total@1' })).toBe('2/5')
    expect(nodeB.runs).toBe(runsB + 1)
    expect(total.runs).toBe(runsTotal + 1)
    expect(nodeA.runs).toBe(runsA)

    // (3) Outside change without invalidate: nothing changes.
    cart.data.set('items', ['z'])
    await settle(host)
    expect(nodeA.last).toEqual(['a', 'b'])

    // (6) Change and change back before the emission: equal at emission, no notification.
    const before = nodeB.runs
    cart.data.set('count', 9)
    cart.context?.invalidate(['count'])
    cart.data.set('count', 5)
    cart.context?.invalidate(['count'])
    await settle(host)
    expect(nodeB.runs).toBe(before)

    // (4) Seed consults has; a host write in between wins.
    cart.calls.length = 0
    host.state.seed('cart.flag', 1)
    await host.dispatch('b', 'flag', null)
    host.state.seed('cart.flag', 1)
    expect(cart.calls).toContainEqual(['has', 'flag'])
    expect(cart.data.get('flag')).toBe(2)

    // (7) Seed does not overwrite a value the store already has.
    cart.calls.length = 0
    host.state.seed('cart.pre', 'y')
    expect(cart.calls).toEqual([['has', 'pre']])
    expect(host.state.read('cart.pre')).toBe('x')

    // (5) Unknown namespace.
    expect(() => host.state.read('cart2.x')).toThrow(
      expect.objectContaining({ code: PartHostErrorCode.stateNamespaceUnknown })
    )
    expect(errors.map(codeOf)).toEqual([])
    nodeA.dispose()
    nodeB.dispose()
    total.dispose()
    await host.dispose()
  })
})

/** Store over a plain object with a subscription, for outside-change tests. */
class ListStore {
  /** Values by key. */
  readonly data: Record<string, unknown> = {}
  /** Keys passed to `get`. */
  readonly gets: string[] = []
  /** Subscribed listener. */
  listener: ((keys?: readonly string[]) => void) | undefined
  /** Context of `create`. */
  context: IStateStoreContext | undefined
  /** Reader used by `get`; tests swap it to return copies. */
  read: (key: string) => unknown = (key) => this.data[key]
}

describe('equality (A2)', () => {
  it('compares outside changes with equals, longest equalsBy prefix and identity first', async () => {
    const list = new ListStore()
    list.data.items = [1, 2]
    list.data['items.meta'] = { tag: 'm' }
    list.data.other = { v: 1 }
    list.data.never = 0
    /** Calls of the plain comparator. */
    let equalsCalls = 0
    /** Behaviour of the plain comparator. */
    let equalsMode: 'false' | 'throw' = 'false'
    const failure = new Error('E')
    const store = defineStateStore<ListStore>({
      namespace: 'list',
      create: (ctx) => {
        list.context = ctx
        return list
      },
      get: (handle, key) => {
        handle.gets.push(key)
        return handle.read(key)
      },
      set: (handle, key, value) => {
        handle.data[key] = value
      },
      subscribe: (handle, listener) => {
        handle.listener = listener
        return () => (handle.listener = undefined)
      },
      equals: () => {
        equalsCalls += 1
        if (equalsMode === 'throw') throw failure
        return false
      },
      equalsBy: {
        items: (a, b) => (a as unknown[]).length === (b as unknown[]).length,
        'items.meta': () => false
      }
    })
    const errors: unknown[] = []
    const host = await createPartHost({
      plugins: [definePartPlugin({ name: 'list', stores: [store] })],
      onError: (error) => errors.push(error)
    })
    const items = bind(host, 'list.items')
    const meta = bind(host, 'list.items.meta')
    const other = bind(host, 'list.other')
    await settle(host)
    const counts = () => [items.runs, meta.runs, other.runs]
    const start = counts()

    // Same-length array (equalsBy items: equal) and a new meta object (items.meta: changed).
    list.data.items = [3, 4]
    list.data['items.meta'] = { tag: 'm' }
    list.listener?.(['items', 'items.meta'])
    await settle(host)
    expect(counts()).toEqual([start[0], (start[1] as number) + 1, start[2]])

    // Different length: items changes.
    list.data.items = [5]
    list.listener?.(['items'])
    await settle(host)
    expect(items.runs).toBe((start[0] as number) + 1)

    // No-argument listener compares every read key; `never` is not read.
    list.gets.length = 0
    list.data.other = { v: 2 }
    list.data.never = 1
    const otherRuns = other.runs
    list.listener?.()
    await settle(host)
    expect([...list.gets].sort()).toEqual(['items', 'items.meta', 'other'])
    expect(other.runs).toBe(otherRuns + 1)

    // In-place mutation: same reference is equal before equals runs; a copy notifies.
    const inPlace = list.data.other as { v: number }
    inPlace.v = 3
    const callsBefore = equalsCalls
    const runsBefore = other.runs
    list.context?.invalidate(['other'])
    await settle(host)
    expect(other.runs).toBe(runsBefore)
    expect(equalsCalls).toBe(callsBefore)
    list.read = (key) => (key === 'other' ? { ...(list.data.other as object) } : list.data[key])
    list.context?.invalidate(['other'])
    await settle(host)
    expect(other.runs).toBe(runsBefore + 1)

    // A throwing equals is reported and counts as changed.
    list.read = (key) => list.data[key]
    equalsMode = 'throw'
    list.data.other = { v: 4 }
    const throwRuns = other.runs
    list.listener?.(['other'])
    await settle(host)
    expect(other.runs).toBe(throwRuns + 1)
    expect(errors.map(codeOf)).toEqual([PartHostErrorCode.stateEqualsFailed])
    expect((errors[0] as { cause?: unknown }).cause).toBe(failure)

    // Equal by equalsBy keeps the cached old array.
    const cached = host.state.read('list.items')
    list.data.items = [9]
    list.listener?.(['items'])
    await settle(host)
    expect(host.state.read('list.items')).toBe(cached)
    items.dispose()
    meta.dispose()
    other.dispose()
    await host.dispose()
  })

  it('applies defaultStateStore equality to page paths and drops it on removal', async () => {
    const failure = new Error('E9')
    const errors: unknown[] = []
    const host = await createPartHost({ onError: (error) => errors.push(error) })
    const a = bind(host, 'page.a')
    const total = new (await import('./store-support.ts')).Tracked(
      host,
      () => (host.state.read('page.a') as { n?: number } | undefined)?.n
    )
    await settle(host)
    await host.use(
      definePartPlugin({
        name: 'D',
        stores: [
          defaultStateStore({
            equals: (x, y) =>
              (x as { id?: number })?.id !== undefined &&
              (x as { id?: number })?.id === (y as { id?: number })?.id,
            equalsBy: {
              'page.raw': () => {
                rawCalls += 1
                return false
              },
              'page.bad': () => {
                throw failure
              },
              // A thenable result is refused at runtime; the cast models a misbehaving comparator.
              'page.async': (async () => true) as never
            }
          })
        ]
      })
    )
    let rawCalls = 0
    host.state.write('page.a', { id: 1, n: 1 })
    await settle(host)
    const runs = a.runs
    const totalRuns = total.runs
    host.state.write('page.a', { id: 1, n: 2 })
    await settle(host)
    expect(a.runs).toBe(runs)
    expect(total.runs).toBe(totalRuns)
    expect((host.state.read('page.a') as { n: number }).n).toBe(1)

    const raw = bind(host, 'page.raw')
    host.state.write('page.raw', 1)
    await settle(host)
    const rawRuns = raw.runs
    rawCalls = 0
    host.state.write('page.raw', 1)
    await settle(host)
    expect(raw.runs).toBe(rawRuns)
    expect(rawCalls).toBe(0)

    const nested = bind(host, 'page.a.b')
    host.state.write('page.a.b', 5)
    await settle(host)
    expect(nested.last).toBe(5)
    expect(a.runs).toBe(runs)

    const badNode = bind(host, 'page.bad')
    const asyncNode = bind(host, 'page.async')
    await settle(host)
    host.state.write('page.bad', { x: 2 })
    host.state.write('page.async', { x: 2 })
    await settle(host)
    expect(badNode.runs).toBe(2)
    expect(asyncNode.runs).toBe(2)
    badNode.dispose()
    asyncNode.dispose()
    expect((host.state.read('page.bad') as { x: number }).x).toBe(2)
    expect((host.state.read('page.async') as { x: number }).x).toBe(2)
    expect(errors.map(codeOf)).toEqual([
      PartHostErrorCode.stateEqualsFailed,
      PartHostErrorCode.stateEqualsFailed
    ])
    expect((errors[0] as { cause?: unknown }).cause).toBe(failure)

    await host.unUse('D')
    expect(host.state.read('page.a')).toEqual({ id: 1, n: 1 })
    host.state.write('page.a', { id: 1, n: 3 })
    await settle(host)
    expect(a.runs).toBe(runs + 1)
    expect((host.state.read('page.a') as { n: number }).n).toBe(3)
    a.dispose()
    total.dispose()
    raw.dispose()
    nested.dispose()
    await host.dispose()
  })
})

/** Subscribing store whose data the test edits; each instance records `create` and `dispose`. */
class SubscribedStore {
  /** Values by key. */
  readonly data: Record<string, unknown>
  /** `create` and `dispose` calls. */
  readonly calls: string[] = []
  /** Subscribed listener. */
  listener: ((keys?: readonly string[]) => void) | undefined
  /** Context of `create`. */
  context: IStateStoreContext | undefined

  /** Store with initial data. */
  constructor(data: Record<string, unknown>) {
    this.data = data
  }

  /** Store definition. */
  define(namespace = 'cart', fail?: unknown) {
    return defineStateStore<SubscribedStore>({
      namespace,
      create: (ctx) => {
        this.calls.push('create')
        if (fail !== undefined) throw fail
        this.context = ctx
        return this
      },
      get: (handle, key) => handle.data[key],
      set: (handle, key, value) => {
        handle.data[key] = value
      },
      subscribe: (handle, listener) => {
        handle.listener = listener
        return () => (handle.listener = undefined)
      },
      dispose: (handle) => {
        handle.calls.push('dispose')
      }
    })
  }
}

/** Install failure cause (`PLUGIN_INSTALL_FAILED` wraps the original). */
async function installFailure(work: Promise<unknown>): Promise<unknown> {
  /** Rejection of the install. */
  const failure = await work.then(
    () => undefined,
    (error: unknown) => error
  )
  expect(codeOf(failure)).toBe('PLUGIN_INSTALL_FAILED')
  return (failure as { cause?: unknown }).cause
}

describe('registration (A3)', () => {
  it('routes, refuses conflicts, rolls back failed installs and survives removal', async () => {
    const errors: unknown[] = []
    const unknowns = () =>
      errors.filter((error) => codeOf(error) === PartHostErrorCode.stateNamespaceUnknown).length
    /** Resource loads with their parameters. */
    const loads: unknown[] = []
    const resourcePlugin = definePartPlugin({
      name: 'data',
      resources: [
        defineResource({
          id: 'r@1',
          load: async (params) => {
            loads.push(params)
            return params
          }
        })
      ]
    })
    const host = await createPartHost({
      plugins: [resourcePlugin],
      onError: (error) => errors.push(error)
    })
    const n1 = bind(host, 'cart.x')
    const n2 = bind(host, 'cart.y')
    const watch = host.resources.watch({ $resource: 'r@1', params: { x: { $state: 'cart.x' } } })
    const resource = new Tracked(host, () => watch.read().status)
    await settle(host)
    expect([n1.last, n2.last]).toEqual([undefined, undefined])
    expect(loads.at(-1)).toEqual({ x: undefined })
    expect(unknowns()).toBe(1)

    expect(() => defineStateStore({ namespace: 'Page' } as never)).toThrow(TypeError)
    expect(() => defineStateStore({ namespace: 'page' } as never)).toThrow(
      expect.objectContaining({ code: PartHostErrorCode.stateStoreInvalid })
    )

    const p1Store = new SubscribedStore({ x: 'p1x', y: 'p1y' })
    const view = definePart({ id: 'cart-view@1' })
    const p1 = () => definePartPlugin({ name: 'p1', parts: [view], stores: [p1Store.define()] })
    await host.use(p1())
    await settle(host)
    expect([n1.last, n2.last]).toEqual(['p1x', 'p1y'])
    expect(loads.at(-1)).toEqual({ x: 'p1x' })

    const p2Store = new SubscribedStore({})
    expect(
      codeOf(
        await installFailure(host.use(definePartPlugin({ name: 'p2', stores: [p2Store.define()] })))
      )
    ).toBe(PartHostErrorCode.stateStoreConflict)
    expect(p2Store.calls).toEqual([])
    host.state.write('cart.x', 'p1x2')
    expect(host.state.read('cart.x')).toBe('p1x2')

    const p4Store = new SubscribedStore({})
    expect(
      codeOf(
        await installFailure(
          host.use(
            definePartPlugin({
              name: 'p4',
              parts: [definePart({ id: 'cart-view@1' })],
              stores: [p4Store.define('cart4')]
            })
          )
        )
      )
    ).toBe(PartHostErrorCode.catalogConflict)
    expect(p4Store.calls).toEqual(['create', 'dispose'])
    expect(() => host.state.read('cart4.x')).toThrow(
      expect.objectContaining({ code: PartHostErrorCode.stateNamespaceUnknown })
    )

    const e1 = new Error('E1')
    const e2 = new Error('E2')
    const aCalls: string[] = []
    const a = defineStateStore({
      namespace: 'a',
      create: () => ({}),
      get: () => undefined,
      set: () => undefined,
      dispose: () => {
        aCalls.push('dispose')
        throw e2
      }
    })
    const b = defineStateStore({
      namespace: 'b',
      create: () => {
        throw e1
      },
      get: () => undefined,
      set: () => undefined
    })
    const rollback = (await installFailure(
      host.use(definePartPlugin({ name: 'p3', stores: [a, b] }))
    )) as AggregateError
    expect(rollback).toBeInstanceOf(AggregateError)
    expect(codeOf(rollback)).toBe(PartHostErrorCode.stateStoreRollbackFailed)
    expect(rollback.errors).toEqual([e1, e2])
    expect(rollback.errors[0]).toBe(e1)
    expect(rollback.cause).toBe(e1)
    expect(aCalls).toEqual(['dispose'])

    await host.use(definePartPlugin({ name: 'q1', stores: [defaultStateStore()] }))
    expect(
      codeOf(
        await installFailure(
          host.use(definePartPlugin({ name: 'q2', stores: [defaultStateStore()] }))
        )
      )
    ).toBe(PartHostErrorCode.stateStoreConflict)

    // P1y: onInstall reads through the new generation, then fails; P1 keeps serving.
    const p1yStore = new SubscribedStore({ x: 'p1y-x' })
    const e10 = new Error('E10')
    let readInInstall: unknown
    expect(
      await installFailure(
        host.replace(
          'p1',
          definePartPlugin({
            name: 'p1',
            parts: [view],
            stores: [p1yStore.define()],
            onInstall: () => {
              readInInstall = host.state.read('cart.x')
              throw e10
            }
          })
        )
      )
    ).toBe(e10)
    await settle(host)
    expect(readInInstall).toBe('p1y-x')
    expect(host.state.read('cart.x')).toBe('p1x2')
    expect(n1.last).toBe('p1x2')
    expect(p1yStore.calls).toEqual(['create', 'dispose'])

    // P1x: create throws; catalog and routing stay on P1.
    const e3 = new Error('E3')
    expect(
      await installFailure(
        host.replace(
          'p1',
          definePartPlugin({
            name: 'p1',
            parts: [definePart({ id: 'cart-view@1' })],
            stores: [new SubscribedStore({}).define('cart', e3)]
          })
        )
      )
    ).toBe(e3)
    expect(host.catalog.get('cart-view@1')).toBe(view)
    p1Store.data.x = 'p1x3'
    p1Store.listener?.(['x'])
    await settle(host)
    expect(n1.last).toBe('p1x3')
    expect(p1Store.calls).toEqual(['create'])

    // P1′ replaces P1 while an outside change is queued.
    const p1bStore = new SubscribedStore({ x: 'p1b-x', y: 'p1b-y' })
    const xDerive = new Tracked(host, () => host.state.resolve({} as never, { $state: 'cart.x' }))
    p1Store.data.x = 'p1x4'
    const oldListener = p1Store.listener
    oldListener?.(['x'])
    await host.replace('p1', definePartPlugin({ name: 'p1', stores: [p1bStore.define()] }))
    await settle(host)
    expect([n1.last, n2.last, xDerive.last]).toEqual(['p1b-x', 'p1b-y', 'p1b-x'])
    const afterReplace = n1.runs
    oldListener?.(['x'])
    await settle(host)
    expect(n1.runs).toBe(afterReplace)
    expect(p1Store.calls).toEqual(['create', 'dispose'])
    expect(errors.some((error) => codeOf(error) === PartHostErrorCode.stateStoreConflict)).toBe(
      false
    )

    // Removing P1′: renders undefined, one more unknown report for the namespace.
    const context = p1bStore.context as IStateStoreContext
    await host.unUse('p1')
    await settle(host)
    expect(p1bStore.calls).toEqual(['create', 'dispose'])
    expect([n1.last, n2.last]).toEqual([undefined, undefined])
    expect(loads.at(-1)).toEqual({ x: undefined })
    expect(unknowns()).toBe(2)
    expect(() => host.state.read('cart.x')).toThrow(
      expect.objectContaining({ code: PartHostErrorCode.stateNamespaceUnknown })
    )
    const reported = errors.length
    context.invalidate()
    context.report(new Error('late'))
    await settle(host)
    expect(errors.length).toBe(reported)

    await host.use(p1())
    await settle(host)
    expect(n1.last).toBe('p1x4')
    await host.unUse('p1')
    await settle(host)
    expect(unknowns()).toBe(3)
    for (const tracked of [n1, n2, resource, xDerive]) tracked.dispose()
    await host.dispose()
  })
})

/** Middleware recording calls; `get` appends `suffix`, optional `set` and failing `dispose`. */
function recordingLayer(
  name: string,
  log: string[],
  options: { readonly set?: boolean; readonly fail?: unknown; readonly label?: string } = {}
): IStateStoreMiddleware {
  /** Name used in the log; defaults to the suffix. */
  const label = options.label ?? name
  return <THandle>(inner: IStateStore<THandle>): IStateStoreLayer<THandle> => ({
    get: (handle, key) => {
      log.push(`get:${label}`)
      return `${String(inner.get(handle, key))}+${name}`
    },
    ...(options.set === true
      ? {
          set: (handle: THandle, key: string, value: unknown) => {
            log.push(`set:${label}`)
            return inner.set(handle, key, value)
          }
        }
      : {}),
    dispose: () => {
      log.push(`dispose:${label}`)
      if (options.fail !== undefined) throw options.fail
    }
  })
}

/** Raw store whose `get` returns `'raw'` and whose calls go to `log`. */
function rawStore(namespace: string, log: string[], extra: object = {}): IStateStore<object> {
  return defineStateStore<object>({
    namespace,
    create: () => ({}),
    get: () => {
      log.push(`get:${namespace}`)
      return 'raw'
    },
    set: () => {
      log.push(`set:${namespace}`)
    },
    dispose: () => {
      log.push(`dispose:${namespace}`)
    },
    ...extra
  })
}

describe('grants, handles and middleware (A4)', () => {
  it('keeps grants, hands out handles only through stateStores and composes layers', async () => {
    const errors: unknown[] = []
    const log: string[] = []
    const eb = new Error('Eb')
    const ea3 = new Error('Ea3')
    const eb3 = new Error('Eb3')
    const schema = z.object({ total: z.number() })
    const identity = { schema, equals: () => false, equalsBy: { x: () => false } }
    const store = rawStore('cart', log, identity)
    const cart = composeStore(
      composeStore(store, recordingLayer('b', log, { set: true, fail: eb })),
      recordingLayer('a', log)
    )
    const store2 = rawStore('cart2', log, { ...identity, schema: z.object({ n: z.number() }) })
    const cart2 = composeStore(
      store2,
      recordingLayer('a', log, { label: 'a2' }),
      recordingLayer('b', log, { set: true, label: 'b2' })
    )
    const cart3 = composeStore(
      rawStore('cart3', log),
      recordingLayer('a3', log, { fail: ea3 }),
      recordingLayer('b3', log, { fail: eb3 })
    )
    for (const field of ['namespace', 'schema', 'equals', 'equalsBy'] as const) {
      expect(cart[field]).toBe(store[field])
      expect(cart2[field]).toBe(store2[field])
    }
    /** Outcomes of the restricted effect. */
    const outcomes: unknown[] = []
    /** Context keys of the restricted effect. */
    let keys: string[] = []
    const app = definePartPlugin({
      name: 'pc',
      parts: [definePart({ id: 'button@1' })],
      stores: [cart, cart2, cart3],
      effects: [
        defineEffect({
          id: 'limited@1',
          tier: 'restricted',
          meta: { 'part.grants': { state: ['cart.items'] } },
          run: (_event, ctx) => {
            keys = Object.keys(ctx)
            ctx.state.write('cart.items' as never, 1 as never)
            try {
              ctx.state.write('cart.total' as never, 1 as never)
            } catch (error) {
              outcomes.push(codeOf(error))
            }
          }
        })
      ]
    })
    /** StateStores output captured by the reader plugin. */
    let stores: { handle(namespace: string): unknown } | undefined
    const reader = definePartPlugin({
      name: 'reader',
      features: {
        stores: defineFeature((_core, deps: { readonly s: object }) => deps.s, {
          s: partCorePlugin.getFeature('stateStores')
        } as never)
      },
      onInstall: (features) => {
        stores = features.stores as typeof stores
      }
    })
    const host = await createPartHost({
      plugins: [app, reader],
      onError: (error) => errors.push(error)
    })
    await host.blueprint.load({
      id: 'bp',
      version: 1,
      root: { tag: 'button@1', id: 'b', facets: { events: { click: { handler: 'limited@1' } } } }
    })
    await host.dispatch('b', 'click', null)
    expect(outcomes).toEqual([PartHostErrorCode.effectForbidden])
    expect(keys.sort()).toEqual(['dispatch', 'features', 'models', 'part', 'resources', 'state'])

    const handle = stores?.handle('cart')
    expect(typeof handle).toBe('object')
    for (const namespace of ['nope', 'page'])
      expect(() => stores?.handle(namespace)).toThrow(
        expect.objectContaining({ code: PartHostErrorCode.stateNamespaceUnknown })
      )

    log.length = 0
    expect(host.state.read('cart.x')).toBe('raw+b+a')
    expect(log).toEqual(['get:a', 'get:b', 'get:cart'])
    expect(host.state.read('cart2.x')).toBe('raw+b+a')
    log.length = 0
    host.state.write('cart.y', 1)
    expect(log[0]).toBe('set:b')

    errors.length = 0
    log.length = 0
    await host.unUse('pc')
    await settle(host, 6)
    /** Releases of one composed store, in call order. */
    const releases = (names: readonly string[]) =>
      log.filter((entry) => names.some((name) => entry === `dispose:${name}`))
    expect(releases(['a', 'b', 'cart'])).toEqual(['dispose:a', 'dispose:b', 'dispose:cart'])
    expect(releases(['a2', 'b2', 'cart2'])).toEqual(['dispose:a2', 'dispose:b2', 'dispose:cart2'])
    expect(releases(['a3', 'b3', 'cart3'])).toEqual(['dispose:a3', 'dispose:b3', 'dispose:cart3'])
    const disposeErrors = errors.filter(
      (error) => codeOf(error) === PartHostErrorCode.stateStoreDisposeFailed
    ) as { cause?: unknown }[]
    expect(disposeErrors).toHaveLength(2)
    expect(disposeErrors.filter((error) => error.cause === eb)).toHaveLength(1)
    const aggregate = disposeErrors.find((error) => error.cause instanceof AggregateError)
      ?.cause as AggregateError
    expect(codeOf(aggregate)).toBe(PartHostErrorCode.stateStoreDisposeFailed)
    expect(aggregate.errors).toEqual([ea3, eb3])
    expect(aggregate.cause).toBe(ea3)
    await host.dispose()
  })
})

/** Asynchronous store `namespace` recording into `calls`; `extra` adds identity fields. */
function asyncStore(
  namespace: string,
  calls: AsyncCalls,
  contexts: IStateStoreContext[],
  extra: object = {}
): IStateStore<object> {
  return defineStateStore<object>({
    namespace,
    create: (ctx) => {
      contexts.push(ctx)
      /** Settled by the test. */
      const deferred = new Deferred<unknown>()
      calls.creates.push(deferred)
      return deferred.promise as Promise<object>
    },
    get: (_handle, key) => calls.push(calls.gets, key),
    set: (_handle, key, value) => calls.push(calls.sets, key, value) as Promise<void>,
    has: (_handle, key) => calls.push(calls.hases, key) as Promise<boolean>,
    dispose: () => calls.release('raw') as Promise<void>,
    ...extra
  })
}

/** Layer overriding only `get` (pass-through) and its own asynchronous release. */
function asyncLayer(name: string, calls: AsyncCalls): IStateStoreMiddleware {
  return <THandle>(inner: IStateStore<THandle>): IStateStoreLayer<THandle> => ({
    get: (handle, key) => inner.get(handle, key),
    dispose: () => calls.release(name) as Promise<void>
  })
}

/** Resolves the newest unsettled call of a list. */
function last(list: readonly IAsyncCall[]): IAsyncCall {
  return list[list.length - 1] as IAsyncCall
}

describe('asynchronous stores (A10)', () => {
  it('tracks async create, reads, writes, seeds, replacement and release', async () => {
    const errors: unknown[] = []
    const codes = () => errors.map(codeOf)
    const calls = new AsyncCalls()
    const contexts: IStateStoreContext[] = []
    const remoteInfo = defineFeature(() => ({}))
    const remote = (store: IStateStore<object>, layers: AsyncCalls) =>
      definePartPlugin({
        name: 'r',
        features: { remoteInfo },
        stores: [composeStore(store, asyncLayer('outer', layers), asyncLayer('inner', layers))],
        derives: [
          defineDerive({ id: 'st@1', compute: (state) => state.status('remote.items') }),
          defineDerive({ id: 'so@1', compute: (state) => state.read('remote.other') })
        ]
      })
    const rPlugin = remote(asyncStore('remote', calls, contexts), calls) as unknown as {
      getFeature(name: string): unknown
    }
    /** Gate of H's dependency-replaced hook. */
    const hGate = new Deferred<void>()
    let hCalled = false
    const hPlugin = definePlugin({
      name: 'h',
      features: {
        uses: defineFeature(() => ({}), { r: rPlugin.getFeature('remoteInfo') } as never)
      },
      onDependencyReplaced: () => {
        hCalled = true
        return hGate.promise
      },
      install: () => ({})
    }) as unknown as IPartPlugin
    const host = await createPartHost({ onError: (error) => errors.push(error) })
    // A synchronous store in the same host keeps its synchronous semantics (no microtask).
    const cart = new CartStore()
    cart.data.set('items', [])
    await host.use(definePartPlugin({ name: 'cart', stores: [cart.define()] }))
    const syncNode = bind(host, 'cart.count')
    host.state.write('cart.items', ['q'])
    expect(host.state.read('cart.items')).toEqual(['q'])
    expect(host.state.read('cart.count')).toBe(1)
    syncNode.dispose()
    const using = host.use(rPlugin as unknown as IPartPlugin)
    const n = bind(host, 'remote.items')
    const st = derive(host, 'st@1')
    await using
    await host.use(hPlugin)
    await settle(host)
    expect(n.last).toBeUndefined()
    expect(codes()).not.toContain(PartHostErrorCode.stateNamespaceUnknown)
    expect((st.last as IStateStatus).status).toBe('loading')

    calls.creates[0]?.resolve({})
    await settle(host)
    last(calls.gets).deferred.resolve('A')
    await settle(host)
    expect(n.last).toBe('A')
    expect((st.last as IStateStatus).status).toBe('ready')

    const ctx = contexts[0] as IStateStoreContext
    ctx.invalidate(['items'])
    await settle(host)
    expect(calls.gets).toHaveLength(2)
    ctx.invalidate(['items'])
    await settle(host)
    expect(calls.gets).toHaveLength(2)
    calls.gets[1]?.deferred.resolve('B')
    await settle(host)
    expect(calls.gets).toHaveLength(3)
    expect(n.last).toBe('B')
    calls.gets[2]?.deferred.resolve('C')
    await settle(host)
    expect(n.last).toBe('C')

    const e5 = new Error('E5')
    const e5b = new Error('E5b')
    const stRuns = st.runs
    ctx.invalidate(['items'])
    await settle(host)
    last(calls.gets).deferred.reject(e5)
    await settle(host)
    expect(st.runs).toBeGreaterThan(stRuns)
    ctx.invalidate(['items'])
    await settle(host)
    last(calls.gets).deferred.reject(e5b)
    await settle(host)
    expect((st.last as IStateStatus).status).toBe('error')
    expect(n.last).toBe('C')
    const readFailures = errors.filter(
      (error) => codeOf(error) === PartHostErrorCode.stateStoreReadFailed
    ) as { cause?: unknown }[]
    expect(readFailures.map((error) => error.cause)).toEqual([e5, e5b])

    const loaded = host.state.load('remote.items')
    await settle(host)
    last(calls.gets).deferred.resolve('D')
    expect(await loaded).toBe('D')
    await settle(host)
    expect((st.last as IStateStatus).status).toBe('ready')

    host.state.write('remote.items', 'E1v')
    host.state.write('remote.items', 'E2v')
    await settle(host)
    expect(calls.sets.map((call) => call.value)).toEqual(['E1v', 'E2v'])
    expect((st.last as IStateStatus).refreshing).toBe(true)
    calls.sets[1]?.deferred.resolve(undefined)
    await settle(host)
    calls.sets[0]?.deferred.resolve(undefined)
    await settle(host)
    for (let turn = 0; turn < 4 && calls.gets.some((call) => !settledCalls.has(call)); turn += 1) {
      for (const call of calls.gets)
        if (!settledCalls.has(call)) {
          settledCalls.add(call)
          call.deferred.resolve('E2v')
        }
      await settle(host)
    }
    expect(n.last).toBe('E2v')

    const e6 = new Error('E6')
    host.state.write('remote.items', 'bad')
    await settle(host)
    last(calls.sets).deferred.reject(e6)
    await settle(host)
    const writeFailures = errors.filter(
      (error) => codeOf(error) === PartHostErrorCode.stateStoreWriteFailed
    ) as { cause?: unknown }[]
    expect(writeFailures.map((error) => error.cause)).toEqual([e6])
    expect(n.last).toBe('E2v')

    host.state.seed('remote.flag', 1)
    host.state.write('remote.flag', 2)
    last(calls.sets).deferred.resolve(undefined)
    last(calls.hases).deferred.resolve(false)
    await settle(host)
    expect(calls.sets.filter((call) => call.key === 'flag').map((call) => call.value)).toEqual([2])
    for (const call of calls.gets)
      if (!settledCalls.has(call)) {
        settledCalls.add(call)
        call.deferred.resolve('E2v')
      }
    await settle(host)

    // Replacement: old generation serves until aborted; the new create resolves later.
    ctx.invalidate(['items'])
    await settle(host)
    const oldGet = last(calls.gets)
    settledCalls.add(oldGet)
    const newCalls = new AsyncCalls()
    const newContexts: IStateStoreContext[] = []
    /** Calls of the new implementation's equals. */
    let newEquals = 0
    const replacing = host.replace(
      'r',
      remote(
        asyncStore('remote', newCalls, newContexts, {
          equals: () => {
            newEquals += 1
            return true
          }
        }),
        newCalls
      ) as never
    )
    await until(() => hCalled)
    expect(host.state.read('remote.items')).toBe('E2v')
    const setsBefore = calls.sets.length
    host.state.write('remote.items', 'V')
    expect(calls.sets.length).toBe(setsBefore + 1)
    hGate.resolve()
    await replacing
    await until(() => calls.disposes.length === 1)
    await settle(host)
    expect(calls.disposes.map((entry) => entry.name)).toEqual(['outer'])
    calls.disposes[0]?.deferred.resolve(undefined)
    await until(() => calls.disposes.length === 2)
    expect(calls.disposes[1]?.name).toBe('inner')
    calls.disposes[1]?.deferred.resolve(undefined)
    await until(() => calls.disposes.length === 3)
    expect(calls.disposes[2]?.name).toBe('raw')
    calls.disposes[2]?.deferred.resolve(undefined)
    expect(n.last).toBe('E2v')
    expect((st.last as IStateStatus).refreshing).toBe(true)
    expect(() => host.state.write('remote.items', 'W')).toThrow(
      expect.objectContaining({ code: PartHostErrorCode.stateNamespaceUnknown })
    )
    let l1Done = false
    const l1 = host.state.load('remote.items').then((value) => {
      l1Done = true
      return value
    })
    const nRuns = n.runs
    oldGet.deferred.resolve('Z')
    await settle(host)
    expect(n.runs).toBe(nRuns)
    newCalls.creates[0]?.resolve({})
    await settle(host)
    expect(newCalls.gets).toHaveLength(1)
    expect(n.last).toBe('E2v')
    expect(l1Done).toBe(false)
    const fresh = { items: 'new' }
    newCalls.gets[0]?.deferred.resolve(fresh)
    await settle(host)
    expect(n.last).toBe(fresh)
    expect((st.last as IStateStatus).status).toBe('ready')
    expect(await l1).toBe(fresh)

    // First read of a never-read path is not compared, even with an always-true equals.
    const so = derive(host, 'so@1')
    await settle(host)
    const other = { o: 1 }
    last(newCalls.gets).deferred.resolve(other)
    await settle(host)
    expect(so.last).toBe(other)
    expect(newEquals).toBe(0)

    // Removal releases the new generation's layers in order.
    await host.unUse('h')
    await host.unUse('r')
    await until(() => newCalls.disposes.length === 1)
    expect(newCalls.disposes.map((entry) => entry.name)).toEqual(['outer'])
    newCalls.disposes[0]?.deferred.resolve(undefined)
    await until(() => newCalls.disposes.length === 2)
    newCalls.disposes[1]?.deferred.resolve(undefined)
    await until(() => newCalls.disposes.length === 3)
    newCalls.disposes[2]?.deferred.resolve(undefined)
    expect(newCalls.disposes.map((entry) => entry.name)).toEqual(['outer', 'inner', 'raw'])
    await settle(host)
    expect(n.last).toBeUndefined()
    for (const tracked of [n, st, so]) tracked.dispose()
    await host.dispose()
  })

  it('reports rejected creates, keeps waiting while a newer generation is pending, closes cleanly', async () => {
    const errors: unknown[] = []
    const host = await createPartHost({ onError: (error) => errors.push(error) })
    const e4 = new Error('E4')
    const e4s = new Error('E4s')
    const pxCalls = new AsyncCalls()
    const px = definePartPlugin({
      name: 'px',
      stores: [asyncStore('px', pxCalls, [])],
      derives: [defineDerive({ id: 'sx@1', compute: (state) => state.status('px.v').status })]
    })
    expect(
      await installFailure(
        host.use(
          definePartPlugin({
            name: 'ps',
            stores: [
              defineStateStore({
                namespace: 'ps',
                create: () => {
                  throw e4s
                },
                get: () => undefined,
                set: () => undefined
              })
            ]
          })
        )
      )
    ).toBe(e4s)
    await host.use(px)
    const nx = bind(host, 'px.v')
    const sx = derive(host, 'sx@1')
    await settle(host)
    expect(sx.last).toBe('loading')
    const l2 = host.state.load('px.v').catch((error: unknown) => error)
    expect(errors.map(codeOf)).not.toContain(PartHostErrorCode.stateNamespaceUnknown)
    pxCalls.creates[0]?.reject(e4)
    await settle(host)
    const createFailure = errors.find(
      (error) => codeOf(error) === PartHostErrorCode.stateStoreCreateFailed
    ) as { cause?: unknown }
    expect(createFailure.cause).toBe(e4)
    expect(sx.last).toBe('idle')
    expect(nx.last).toBeUndefined()
    const l2Error = (await l2) as { cause?: unknown }
    expect(codeOf(l2Error)).toBe(PartHostErrorCode.stateNamespaceUnknown)
    expect(l2Error.cause).toBe(e4)
    expect(() => host.state.read('px.v')).toThrow(
      expect.objectContaining({ code: PartHostErrorCode.stateNamespaceUnknown })
    )

    // PQ → PQ′: the older create rejects while the newer one is pending; load keeps waiting.
    const q1 = new AsyncCalls()
    const q2 = new AsyncCalls()
    const qInfo = defineFeature(() => ({}))
    const pq = (calls: AsyncCalls) =>
      definePartPlugin({ name: 'pq', features: { qInfo }, stores: [asyncStore('q', calls, [])] })
    const pqPlugin = pq(q1) as unknown as { getFeature(name: string): unknown }
    const gate = new Deferred<void>()
    let hqCalled = false
    await host.use(pqPlugin as unknown as IPartPlugin)
    await host.use(
      definePlugin({
        name: 'hq',
        features: { uses: defineFeature(() => ({}), { q: pqPlugin.getFeature('qInfo') } as never) },
        onDependencyReplaced: () => {
          hqCalled = true
          return gate.promise
        },
        install: () => ({})
      }) as unknown as IPartPlugin
    )
    let l3Done = false
    const l3 = host.state.load('q.v').then((value) => {
      l3Done = true
      return value
    })
    const replacing = host.replace('pq', pq(q2) as never)
    await until(() => hqCalled)
    const e11 = new Error('E11')
    q1.creates[0]?.reject(e11)
    await settle(host)
    expect(l3Done).toBe(false)
    expect(host.state.status('q.v').status).toBe('loading')
    expect(
      (
        errors.filter((error) => codeOf(error) === PartHostErrorCode.stateStoreCreateFailed) as {
          cause?: unknown
        }[]
      ).map((error) => error.cause)
    ).toEqual([e4, e11])
    gate.resolve()
    await replacing
    q2.creates[0]?.resolve({})
    await settle(host)
    last(q2.gets).deferred.resolve('Q')
    expect(await l3).toBe('Q')

    // A thenable equals is reported and counts as changed.
    const weird = { v: 1 }
    let weirdContext: IStateStoreContext | undefined
    await host.use(
      definePartPlugin({
        name: 'pw',
        stores: [
          defineStateStore<object>({
            namespace: 'weird',
            create: (ctx) => {
              weirdContext = ctx
              return {}
            },
            get: () => weird.v,
            set: () => undefined,
            equals: (async () => true) as never
          })
        ]
      })
    )
    const nw = bind(host, 'weird.v')
    await settle(host)
    weird.v = 2
    weirdContext?.invalidate(['v'])
    await settle(host)
    expect(nw.last).toBe(2)
    expect(errors.map(codeOf)).toContain(PartHostErrorCode.stateEqualsFailed)
    for (const tracked of [nx, sx, nw]) tracked.dispose()
    await host.dispose()

    // H2: a create resolving after close is released once, with no disposed-signal writes.
    const h2Errors: unknown[] = []
    const h2 = await createPartHost({ onError: (error) => h2Errors.push(error) })
    const pzCalls = new AsyncCalls()
    const pzContexts: IStateStoreContext[] = []
    await h2.use(definePartPlugin({ name: 'pz', stores: [asyncStore('pz', pzCalls, pzContexts)] }))
    const nz = bind(h2, 'pz.v')
    await settle(h2)
    nz.dispose()
    await h2.dispose()
    expect(pzContexts[0]?.signal.aborted).toBe(true)
    pzCalls.creates[0]?.resolve({})
    await until(() => pzCalls.disposes.length === 1)
    pzCalls.disposes[0]?.deferred.resolve(undefined)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(pzCalls.disposes).toHaveLength(1)
    expect(h2Errors.map(codeOf)).not.toContain('NODE_DISPOSED')
  })
})

/** Asynchronous `get` calls the A10 test already settled. */
const settledCalls = new Set<IAsyncCall>()
