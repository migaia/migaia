import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  createTransactionOwner,
  runTransactionOperation,
  assertTransactionOwner,
  useTransactionCapability,
  provideCapabilities,
  implement,
  kv,
  records,
  ttl,
  counter,
  rdf,
  createRdfQuery,
  term,
  type IQuad,
  type ITransactionRdfApi,
  sql,
  createSqlTag,
  sqlFragment,
  type ISqlExecutor,
  defineStorageCapability,
  createRecordQuery,
  type IStorageBase,
  type ITransactionScope,
  type ITransactionKeyValueApi,
  type ITransactionRecordsApi,
  type ITransactionCapabilityView,
  type IKeyValueApi,
  type IRecordsApi,
  type IStorageKey,
  type IQueryResult,
  type IStorageCapabilitySet,
  type ICapabilityInstallPort,
  type ITransactionTtlApi,
  type ITransactionCounterApi
} from '../src/index.js'

/** Concrete rows and full externally constructible scopes require no private symbol or cast. */
type IRow = { readonly state: string; readonly value: number }
/** Extra native members remain precise while the published scope admits only actual KV/records. */
type IScope = ITransactionScope<IRow, typeof records> & { readonly native: number }
/** Original native error identity is preserved after projection failures. */
function normalize(error: unknown): Error & { readonly source: string; readonly code: string } {
  if (error instanceof Error && 'source' in error && 'code' in error)
    return error as Error & { readonly source: string; readonly code: string }
  return Object.assign(new Error('native transaction failed', { cause: error }), {
    source: 'tx-native',
    code: 'TRANSACTION_FAILED'
  })
}
/** One finite native draft and real iterator owner prove projection without another capability map. */
function setup() {
  /** Root storage is intentionally separate from the active native transaction draft. */
  const rootText = new Map<IStorageKey, string>()
  /** All transaction data calls share these same original draft maps. */
  const text = new Map<IStorageKey, string>()
  const rows = new Map<IStorageKey, IRow>([
    ['a', { state: 'paid', value: 2 }],
    ['b', { state: 'open', value: 3 }]
  ])
  const bytes = new Map<string, Uint8Array>()
  const native = vi.fn()
  /** The base is the sole store identity subsequently modified by its actual capability provider. */
  const base: IStorageBase = {
    backend: 'tx-native',
    capabilities: {
      syncRead: false,
      binary: true,
      records: true,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: false,
      opaqueEntries: false,
      maxValueBytes: undefined
    },
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined
  }
  const owner = createTransactionOwner<IRow, IScope>(base, normalize)
  let viewId = 0
  /**
   * One original factory supplies fresh complete native views, including all transaction KV
   * methods.
   */
  const createScope = (): IScope => {
    const scope: IScope = {
      native: ++viewId,
      use: (capability) => useTransactionCapability(scope, capability),
      get: (key) =>
        runTransactionOperation(scope, () => {
          native()
          return text.get(key) ?? null
        }),
      set: (key, value) =>
        runTransactionOperation(scope, () => {
          native()
          text.set(key, value)
        }),
      remove: (key) =>
        runTransactionOperation(scope, () => {
          native()
          text.delete(key)
        }),
      has: (key) =>
        runTransactionOperation(scope, () => {
          native()
          return text.has(key)
        }),
      getMany: (keys) =>
        runTransactionOperation(scope, () => {
          native()
          return keys.map((key) => text.get(key))
        }),
      setMany: (entries) =>
        runTransactionOperation(scope, () => {
          native()
          for (const entry of entries) text.set(entry.key, entry.value)
        }),
      removeMany: (keys) =>
        runTransactionOperation(scope, () => {
          native()
          let count = 0
          for (const key of keys) if (text.delete(key)) count++
          return count
        }),
      removeByPrefix: (prefix) =>
        runTransactionOperation(scope, () => {
          native()
          let count = 0
          for (const key of text.keys())
            if (
              typeof key === 'string' &&
              typeof prefix === 'string' &&
              key.startsWith(prefix) &&
              text.delete(key)
            )
              count++
          return count
        }),
      getBytes: (key) => runTransactionOperation(scope, () => bytes.get(key) ?? null),
      setBytes: (key, value) =>
        runTransactionOperation(scope, () => {
          bytes.set(key, value.slice())
        }),
      removeBytes: (key) =>
        runTransactionOperation(scope, () => {
          bytes.delete(key)
        }),
      getRecord: (key) => runTransactionOperation(scope, () => rows.get(key)),
      putRecord: (value, key = 'generated') =>
        runTransactionOperation(scope, () => {
          rows.set(key, value)
          return key
        }),
      deleteRecord: (key) =>
        runTransactionOperation(scope, () => {
          rows.delete(key)
        }),
      iterateRecords: () => {
        const iterator = rows.entries()
        return owner.registerIterator(scope, {
          next: async (current) => {
            assertTransactionOwner(base, current)
            return iterator.next()
          },
          close: () => undefined
        })
      }
    }
    return Object.freeze(scope)
  }
  const bindKv = vi.fn((scope: ITransactionScope): ITransactionKeyValueApi => ({
    get: scope.get,
    set: scope.set,
    remove: scope.remove,
    has: scope.has,
    getMany: scope.getMany,
    setMany: scope.setMany,
    removeMany: scope.removeMany,
    removeByPrefix: scope.removeByPrefix
  }))
  /** Each source registers its actual iterator under the same supplied native scope. */
  const bindRecords = vi.fn((scope: ITransactionScope): ITransactionRecordsApi => ({
    query: () =>
      createRecordQuery({
        pushdown: { operations: [], operators: [], source: 'records' },
        execute: () => scope.iterateRecords()
      }),
    removeByPrefix: (prefix) =>
      runTransactionOperation(scope, () => {
        native()
        let count = 0
        for (const key of rows.keys())
          if (
            typeof key === 'string' &&
            typeof prefix === 'string' &&
            key.startsWith(prefix) &&
            rows.delete(key)
          )
            count++
        return count
      })
  }))
  /** Transaction batch tests must never fall back to a root endpoint. */
  const rootBatch = async (): Promise<never> => {
    throw new Error('root batch must not be used')
  }
  const rootKv: IKeyValueApi = {
    getMany: rootBatch,
    setMany: rootBatch,
    removeMany: rootBatch,
    removeByPrefix: rootBatch,
    get: async (key) => rootText.get(key) ?? null,
    set: async (key, value) => {
      rootText.set(key, value)
    },
    remove: async (key) => {
      rootText.delete(key)
    },
    has: async (key) => rootText.has(key),
    keys: async () => [...rootText.keys()].filter((key): key is string => typeof key === 'string'),
    clearValues: async () => {
      rootText.clear()
    },
    clearAll: async () => {
      rootText.clear()
    }
  }
  const rootRecords: IRecordsApi = {
    query: () =>
      createRecordQuery({
        pushdown: { operations: [], operators: [], source: 'records' },
        execute: () => {
          throw new Error('root query must not be used')
        }
      }),
    removeByPrefix: async () => {
      throw new Error('root deletion must not be used')
    }
  }
  /** Feature publication uses the original provider window, without fabricating a second store. */
  let installer!: ICapabilityInstallPort
  const store = provideCapabilities(
    base,
    [
      implement(kv, rootKv, { forTransaction: bindKv }),
      implement(records, rootRecords, { forTransaction: bindRecords })
    ],
    {
      onInstaller: (port) => {
        installer = port
      }
    }
  )
  const scope = createScope()
  const onFailure = vi.fn()
  const controller = owner.register(scope, { createScope, onFailure })
  return {
    store,
    scope,
    owner,
    controller,
    bindKv,
    bindRecords,
    text,
    rows,
    rootText,
    native,
    onFailure,
    installer
  }
}

describe('original transaction capability projections', () => {
  it('binds RDF writes to fresh native views and admits every complete read before expiry or argument failure', async () => {
    const fixture = setup()
    const quad: IQuad = {
      subject: term.iri('urn:s'),
      predicate: term.iri('urn:p'),
      object: term.literal('text'),
      graph: term.defaultGraph
    }
    const writes = vi.fn()
    const advances = vi.fn()
    const closed = vi.fn()
    const bindRdf = vi.fn((scope: ITransactionScope): ITransactionRdfApi => ({
      add: async (input) => {
        assertTransactionOwner(fixture.store, scope)
        writes(scope, input)
      },
      delete: async (input) => {
        assertTransactionOwner(fixture.store, scope)
        writes(scope, input)
      },
      match: (pattern) =>
        createRdfQuery(
          {
            pushdown: { operations: [], operators: [], source: 'rdf' },
            execute: () => {
              const source = [quad].entries()
              /**
               * The real fixture factory supplies IScope; the public binder erases only its native
               * refinement.
               */
              return fixture.owner.registerIterator(scope as IScope, {
                next: async (current) => {
                  assertTransactionOwner(fixture.store, current)
                  advances()
                  return source.next()
                },
                close: () => {
                  closed()
                }
              })
            }
          },
          pattern
        )
    }))
    const root = vi.fn(async (): Promise<never> => {
      throw new Error('root RDF must not execute')
    })
    fixture.installer
      .prepare([
        implement(
          rdf,
          {
            add: root,
            delete: root,
            match: () => {
              throw new Error('root RDF match must not execute')
            }
          },
          { forTransaction: bindRdf }
        )
      ])
      .publish()
    const scope = fixture.scope as ITransactionScope<IRow, typeof records | typeof rdf>
    const api = scope.use(rdf)
    expectTypeOf(api).toEqualTypeOf<ITransactionRdfApi>()
    expect(bindRdf).not.toHaveBeenCalled()
    await api.add([quad])
    await api.delete([quad])
    expect(writes).toHaveBeenCalledTimes(2)
    expect(writes.mock.calls[0]![0]).not.toBe(writes.mock.calls[1]![0])
    const query = api
      .match({})
      .orderBy((row) => row.subject.value)
      .distinct('subject')
      .skip(0)
      .limit(1)
    expect(await query.all()).toEqual([quad])
    expect(await query.select('subject').all()).toEqual([{ subject: quad.subject }])
    expect(await query.first()).toBe(quad)
    expect(closed).toHaveBeenCalledTimes(3)
    expect(root).not.toHaveBeenCalled()
    const before = advances.mock.calls.length
    fixture.controller.stopAdmission()
    await fixture.controller.runFinalizers()
    fixture.controller.close()
    const terminals = [
      () => query.all(),
      () => query.first(),
      () => query.maybe(),
      () => query.firstOrThrow(),
      () => query.exists(),
      () => query.count(),
      () => query.pluck('subject'),
      () => query.each(undefined as never),
      () => query.chunk(0, undefined as never),
      () => query.page(0),
      () => query.min('subject' as never),
      () => query.max('subject' as never),
      () => query.sum('subject' as never),
      () => query.avg('subject' as never)
    ]
    for (const terminal of terminals)
      await expect(terminal()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    expect(advances).toHaveBeenCalledTimes(before)
  })

  it('keeps SQL construction pure and binds each saved terminal to a fresh original operation', async () => {
    const fixture = setup()
    const root = vi.fn(async (): Promise<never> => {
      throw new Error('root SQL must not execute')
    })
    const observed: object[] = []
    const prepared: unknown[] = []
    const bindSql = vi.fn((scope: ITransactionScope): ISqlExecutor => {
      assertTransactionOwner(fixture.store, scope)
      observed.push(scope)
      const capture = (prepare: () => unknown, ctx?: unknown) => {
        assertTransactionOwner(fixture.store, scope)
        expect(ctx).toBeUndefined()
        prepared.push(prepare())
      }
      return {
        sql: createSqlTag({
          dialect: 'sqlite',
          all: async (prepare, ctx) => {
            capture(prepare, ctx)
            return [{ value: 2 }]
          },
          get: async (prepare, ctx) => {
            capture(prepare, ctx)
            return { value: 2 }
          },
          run: async (prepare, ctx) => {
            capture(prepare, ctx)
            return { changes: 1 }
          }
        })
      }
    })
    fixture.installer
      .prepare([
        implement(
          sql,
          { sql: createSqlTag({ dialect: 'sqlite', all: root, get: root, run: root }) },
          { forTransaction: bindSql }
        )
      ])
      .publish()
    const scope = fixture.scope as ITransactionScope<IRow, typeof records | typeof sql>
    const executor = scope.use(sql)
    expectTypeOf(executor).toEqualTypeOf<ISqlExecutor>()
    expect(scope.use(sql)).toBe(executor)
    const bytes = new Uint8Array([1])
    const query = executor.sql`SELECT ${executor.sql.id('column')} FROM ${sqlFragment.id('table')} WHERE data = ${bytes}`
    bytes.fill(99)
    expect(bindSql).not.toHaveBeenCalled()
    expect(root).not.toHaveBeenCalled()
    expect(executor.sql.empty).toBe(sqlFragment.empty)
    expect(await query.all({ pageSize: 99 })).toEqual([{ value: 2 }])
    expect(await query.get()).toEqual({ value: 2 })
    expect(await query.run()).toEqual({ changes: 1 })
    expect(prepared).toEqual(
      Array.from({ length: 3 }, () => ({
        text: 'SELECT "column" FROM "table" WHERE data = ?',
        values: [new Uint8Array([1])]
      }))
    )
    expect(new Set(observed).size).toBe(3)
    for (const current of observed)
      expect(() => assertTransactionOwner(fixture.store, current)).toThrow()
    expect(root).not.toHaveBeenCalled()
    fixture.controller.stopAdmission()
    await fixture.controller.runFinalizers()
    fixture.controller.close()
    await expect(query.run()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    expect(bindSql).toHaveBeenCalledTimes(3)
  })

  it('binds scalar capabilities to fresh original views without invoking their root API', async () => {
    const fixture = setup()
    /** Native scalar adapters validate the same supplied original operation scope. */
    const bindTtl = vi.fn((scope: ITransactionScope): ITransactionTtlApi => {
      assertTransactionOwner(fixture.store, scope)
      return {
        expire: async () => true,
        remaining: async () => 3,
        persist: async () => false
      }
    })
    const bindCounter = vi.fn((scope: ITransactionScope): ITransactionCounterApi => {
      assertTransactionOwner(fixture.store, scope)
      return { increment: async () => 7 }
    })
    /** Root endpoints must never become transaction fallbacks. */
    const root = vi.fn(async (): Promise<never> => {
      throw new Error('root scalar must not run')
    })
    fixture.installer
      .prepare([
        implement(
          ttl,
          { expire: root, remaining: root, persist: root },
          { forTransaction: bindTtl }
        ),
        implement(counter, { increment: root }, { forTransaction: bindCounter })
      ])
      .publish()
    /** The same authentic object now carries the capabilities actually published by its provider. */
    const scope = fixture.scope as ITransactionScope<
      IRow,
      typeof records | typeof ttl | typeof counter
    >
    const expiration = scope.use(ttl)
    const increments = scope.use(counter)
    expectTypeOf(expiration).toEqualTypeOf<ITransactionTtlApi>()
    expectTypeOf(increments).toEqualTypeOf<ITransactionCounterApi>()
    expect(scope.use(ttl)).toBe(expiration)
    expect(bindTtl).not.toHaveBeenCalled()
    expect(bindCounter).not.toHaveBeenCalled()
    await expect(expiration.expire({ channel: 'text', key: 'x' }, 0.5)).resolves.toBe(true)
    await expect(expiration.remaining({ channel: 'record', key: ['x'] })).resolves.toBe(3)
    await expect(expiration.persist({ channel: 'bytes', key: 'x' })).resolves.toBe(false)
    await expect(increments.increment('count', 2)).resolves.toBe(7)
    expect(
      new Set([...bindTtl.mock.calls, ...bindCounter.mock.calls].map(([scope]) => scope)).size
    ).toBe(4)
    expect(root).not.toHaveBeenCalled()
    fixture.controller.stopAdmission()
    await fixture.controller.runFinalizers()
    fixture.controller.close()
    await expect(increments.increment('count')).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED'
    })
    await expect(expiration.expire({ channel: 'text', key: 'x' }, -1)).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED'
    })
  })
  it('keeps pure cached lookup separate from native binding and executes every KV method on fresh views', async () => {
    const fixture = setup()
    const descriptors = Object.getOwnPropertyDescriptors(fixture.scope)
    const api = fixture.scope.use(kv)
    expect(api).toBe(useTransactionCapability(fixture.scope, kv))
    expect(fixture.bindKv).not.toHaveBeenCalled()
    expect(fixture.native).not.toHaveBeenCalled()
    await api.set('x', 'one')
    expect(await api.get('x')).toBe('one')
    expect(await api.has('x')).toBe(true)
    await api.setMany([
      { key: 'x', value: 'two' },
      { key: 'prefix-y', value: 'three' }
    ])
    expect(await api.getMany(['prefix-y', 'missing', 'x', 'x'])).toEqual([
      'three',
      undefined,
      'two',
      'two'
    ])
    expect(await api.removeMany(['x', 'missing', 'x'])).toBe(1)
    expect(await api.removeByPrefix('prefix-')).toBe(1)
    await api.remove('other')
    expect(fixture.native).toHaveBeenCalledTimes(8)
    expect(new Set(fixture.bindKv.mock.calls.map(([scope]) => scope))).toHaveProperty('size', 8)
    expect(fixture.bindKv.mock.calls.every(([scope]) => scope !== fixture.scope)).toBe(true)
    expect(
      fixture.bindKv.mock.contexts.every(
        (receiver) =>
          Reflect.ownKeys(receiver as object).join(',') === 'implementation,forTransaction'
      )
    ).toBe(true)
    expect(fixture.rootText.size).toBe(0)
    expect(Object.getOwnPropertyDescriptors(fixture.scope)).toEqual(descriptors)
    const saved = api.get
    fixture.controller.stopAdmission()
    await expect(saved('x')).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    expect(() => fixture.scope.use(kv)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    await fixture.controller.runFinalizers()
    fixture.controller.close()
  })

  it('uses the actual shared transaction query and no ordinary context or root execution', async () => {
    const fixture = setup()
    const api = fixture.scope.use(records)
    expectTypeOf(api).toEqualTypeOf<ITransactionRecordsApi<IRow>>()
    const query = api.query().where({ state: 'paid' }).select('value')
    expectTypeOf(query).toEqualTypeOf<IQueryResult<Pick<IRow, 'value'>, undefined>>()
    expect(fixture.native).not.toHaveBeenCalled()
    expect(await query.all()).toEqual([{ value: 2 }])
    expect(await api.removeByPrefix('a')).toBe(1)
    expect(fixture.rows.has('a')).toBe(false)
    fixture.controller.stopAdmission()
    await fixture.controller.runFinalizers()
    fixture.controller.close()
    await expect(query.all()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    expect(() => api.query()).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    /** Compile-only context violations retain the transaction-local API boundary. */
    function invalidContext() {
      // @ts-expect-error Transaction query terminals do not accept ordinary operation contexts.
      void query.all({ timeoutMs: 1 })
      // @ts-expect-error Transaction KV does not expose root enumeration.
      void fixture.scope.use(kv).keys()
    }
    void invalidContext
  })

  it('retains mapper failure as the original owner first failure across the complete terminal', async () => {
    const fixture = setup()
    const original = Object.assign(new RangeError('mapper failed'), {
      source: 'tx-native',
      code: 'MAPPER_FAILED'
    })
    const failed = fixture.scope
      .use(records)
      .query()
      .select(() => {
        throw original
      })
      .all()
    await expect(failed).rejects.toBe(original)
    fixture.controller.stopAdmission()
    await expect(fixture.controller.runFinalizers()).rejects.toBe(original)
    expect(fixture.onFailure).toHaveBeenCalledWith(original)
    fixture.controller.close()
  })

  it('records terminal admission and post-cleanup failures before a caught query can escape', async () => {
    for (const selected of [false, true]) {
      for (const terminal of [
        (query: IQueryResult<IRow, undefined>) => query.chunk(0, () => undefined),
        (query: IQueryResult<IRow, undefined>) => query.requirePushdown().count(),
        (query: IQueryResult<IRow, undefined>) => query.firstOrThrow()
      ]) {
        const fixture = setup()
        fixture.rows.clear()
        const query = fixture.scope.use(records).query()
        const result = terminal(selected ? query.select((row) => row) : query)
        const failure = await result.catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(Error)
        expect(fixture.onFailure).toHaveBeenCalledWith(failure)
        fixture.controller.stopAdmission()
        await expect(fixture.controller.runFinalizers()).rejects.toBe(failure)
        fixture.controller.close()
      }
    }
  })

  it('admits every escaped read terminal before its own argument or empty-result validation', async () => {
    const fixture = setup()
    const query = fixture.scope
      .use(records)
      .query()
      .orderBy((row) => row.value)
      .distinct('value')
      .skip(0)
      .limit(4)
    const selected = query.select((row) => row)
    fixture.controller.stopAdmission()
    await fixture.controller.runFinalizers()
    fixture.controller.close()
    for (const escaped of [query, selected]) {
      for (const terminal of [
        () => escaped.all(),
        () => escaped.first(),
        () => escaped.maybe(),
        () => escaped.firstOrThrow(),
        () => escaped.pluck('value'),
        () => escaped.exists(),
        () => escaped.count(),
        () => escaped.each(() => undefined),
        () => escaped.chunk(0, () => undefined),
        () => escaped.page(0),
        () => escaped.min('value'),
        () => escaped.max('value'),
        () => escaped.sum('value'),
        () => escaped.avg('value')
      ])
        await expect(terminal()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    }
  })

  it('refuses forged, missing, custom and expired scope authority without binding native data', () => {
    const fixture = setup()
    const missing = defineStorageCapability<{ read(): void }>()('missing')
    expect(() => useTransactionCapability({} as IScope, kv)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => useTransactionCapability(fixture.scope, { name: 'kv' } as typeof kv)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => useTransactionCapability(fixture.scope, missing as never)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
    expect(fixture.bindKv).not.toHaveBeenCalled()
    fixture.controller.close()
  })

  it('rejects missing native transaction bindings before publication and retains binder failure as first error', async () => {
    const fixture = setup()
    const api = fixture.scope.use(kv)
    const original = Object.assign(new TypeError('binding failed'), {
      source: 'tx-native',
      code: 'BIND_FAILED'
    })
    fixture.bindKv.mockImplementationOnce(() => {
      throw original
    })
    await expect(api.get('key')).rejects.toBe(original)
    expect(fixture.native).not.toHaveBeenCalled()
    fixture.controller.stopAdmission()
    await expect(fixture.controller.runFinalizers()).rejects.toBe(original)
    fixture.controller.close()
    const base = { ...fixture.store }
    const before = Object.getOwnPropertyDescriptors(base)
    expect(() => provideCapabilities(base, [implement(kv, fixture.store.use(kv))])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(Object.getOwnPropertyDescriptors(base)).toEqual(before)
  })

  it('retains published capability-set variance and concrete transaction extensions', () => {
    const fixture = setup()
    expectTypeOf<IStorageCapabilitySet<typeof fixture.store>>().toEqualTypeOf<
      typeof kv | typeof records
    >()
    expectTypeOf(fixture.scope.native).toEqualTypeOf<number>()
    expectTypeOf<IScope>().toExtend<ITransactionCapabilityView<typeof kv>>()
    /** Annotated scopes cannot claim capabilities that their original published set lacks. */
    function invalidWidening(kvOnly: ITransactionScope<IRow>) {
      // @ts-expect-error A KV-only view cannot expand its optional contravariant capability proof.
      const recordsView: ITransactionCapabilityView<typeof kv | typeof records> = kvOnly
      void recordsView
      // @ts-expect-error A KV-only view cannot use records.
      kvOnly.use(records)
    }
    void invalidWidening
    fixture.controller.close()
  })
})
