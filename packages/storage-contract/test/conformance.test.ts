import { describe, expect, it, vi } from 'vitest'
import { runConformance, type IConformanceHarness } from '@migaia/storage-contract/conformance'
import { conformanceRows } from '../src/conformance/harness.js'
import {
  kv,
  ttl,
  durableChangeFeed,
  vector,
  rdf,
  sql,
  createVectorQuery,
  createRdfQuery,
  createTransactionOwner,
  runTransactionOperation,
  compileStorageWhere,
  implement,
  provideCapabilities,
  StorageContractError,
  StorageContractErrorCode,
  type IKeyValueApi,
  type IStorageCapabilities,
  type IStorageStore,
  type IAnyStorageCapability,
  type IVectorApi,
  type IVectorHit,
  type IVectorCollection,
  type IQuad,
  type IRdfApi,
  type ITransactionRdfApi,
  type ITtlTarget,
  type ISqlExecutor,
  type IOperationContext,
  type IStorageChange
} from '@migaia/storage-contract'
import {
  createStorageIteratorLifetime,
  type IStorageIterator,
  type IStorageKey,
  type IRecordIndexQuery
} from '@migaia/storage-contract'

/** Negative fixtures borrow the real iterator lifetime rather than fabricating cleanup behavior. */
function rows<T>(values: readonly T[]): IStorageIterator<T> {
  let index = 0
  const lifetime = createStorageIteratorLifetime<T>({
    close: async () => undefined,
    report: () => undefined
  })
  const iterator: IStorageIterator<T> = {
    next: () =>
      lifetime.advance(async () =>
        index < values.length
          ? { done: false, value: values[index++] }
          : { done: true, value: undefined }
      ),
    return: (value) => lifetime.returned(value),
    dispose: () => lifetime.dispose(),
    [Symbol.asyncDispose]: () => lifetime.symbolic(),
    [Symbol.asyncIterator]: () => iterator
  }
  return iterator
}

/** The original capability snapshot is explicit even for a pure non-KV subject. */
const noFeatures: IStorageCapabilities = {
  syncRead: false,
  binary: false,
  records: false,
  secondaryIndexes: false,
  iteration: false,
  transactions: false,
  changeFeed: false,
  opaqueEntries: false,
  maxValueBytes: undefined
}
/** Capture only the public registration callbacks; the real Vitest runner executes the assertions. */
function cases(
  create: () => IStorageStore<never>,
  capabilities: readonly IAnyStorageCapability[] = [kv],
  features = noFeatures
) {
  const selected: { name: string; run: () => void | PromiseLike<void> }[] = []
  runConformance(
    {
      describe: (_name, run) => {
        void run()
      },
      it: (name, run) => {
        selected.push({ name, run })
      },
      expect
    },
    { name: 'fixture', create, capabilities, features }
  )
  return selected
}
/** A small test-only KV object supplies observable state, never a production backend or host. */
function fixture(features = noFeatures) {
  const values = new Map<string, string>()
  const key = (value: unknown) => JSON.stringify(value)
  let disposed = false
  const assertOpen = (ctx?: IOperationContext) => {
    if (disposed) throw new StorageContractError(StorageContractErrorCode.disposed)
    if (ctx?.signal?.aborted) throw new StorageContractError(StorageContractErrorCode.aborted)
  }
  const api: IKeyValueApi = {
    get: async (name, ctx) => {
      assertOpen(ctx)
      return values.get(key(name)) ?? null
    },
    set: async (name, value, ctx) => {
      assertOpen(ctx)
      values.set(key(name), value)
    },
    remove: async (name, ctx) => {
      assertOpen(ctx)
      values.delete(key(name))
    },
    has: async (name, ctx) => {
      assertOpen(ctx)
      return values.has(key(name))
    },
    keys: async (ctx) => {
      assertOpen(ctx)
      return [...values.keys()]
        .map((name) => JSON.parse(name))
        .filter((name) => typeof name === 'string')
    },
    clearValues: async (ctx) => {
      assertOpen(ctx)
      values.clear()
    },
    clearAll: async (ctx) => {
      assertOpen(ctx)
      values.clear()
    },
    getMany: async (names) => names.map((name) => values.get(key(name))),
    setMany: async (entries) => {
      if (new Set(entries.map((entry) => key(entry.key))).size !== entries.length)
        throw new StorageContractError(StorageContractErrorCode.invalidArgument)
      for (const entry of entries) values.set(key(entry.key), entry.value)
    },
    removeMany: async (names) => {
      let count = 0
      for (const name of new Set(names.map(key))) if (values.delete(name)) count += 1
      return count
    },
    removeByPrefix: async (prefix) => {
      let count = 0
      for (const name of values.keys())
        if (name.startsWith(key(prefix).slice(0, -1))) {
          values.delete(name)
          count += 1
        }
      return count
    }
  }
  const dispose = vi.fn(() => {
    disposed = true
    return Promise.resolve()
  })
  const base = {
    backend: 'conformance-fixture',
    capabilities: features,
    dispose,
    [Symbol.asyncDispose]: () => dispose()
  }
  return { base, api, dispose, values }
}

/** Every selected false implementation has callable methods, so behavior must distinguish it. */
function wrongFixture(
  features: IStorageCapabilities,
  indexMode?: 'empty' | 'ignore-range' | 'stale'
) {
  const item = fixture(features)
  const records = new Map<IStorageKey, unknown>()
  const projections = new Map<IStorageKey, number>()
  const handle = { scope: 'conformance', generation: 'fixture', fingerprint: 'fixture' }
  const native = {
    sync: {
      get: () => null,
      has: () => false,
      keys: () => [],
      set: () => undefined,
      remove: () => undefined,
      clearValues: () => undefined
    },
    getBytes: async () => null,
    setBytes: async () => undefined,
    removeBytes: async () => undefined,
    clearBytes: async () => undefined,
    getRecord: async (key: IStorageKey) => records.get(key),
    putRecord: async (_value: unknown, key: IStorageKey = 'generated') => key,
    deleteRecord: async (key: IStorageKey) => {
      records.delete(key)
      projections.delete(key)
    },
    clearRecords: async () => records.clear(),
    iterateRecords: () => rows([]),
    transaction: async () => undefined,
    ensureRecordIndexes: async () => handle,
    getRecordIndexReadiness: async () => ({ status: 'complete' as const, scanned: 0, indexed: 0 }),
    putIndexedRecord: async (
      value: unknown,
      key: IStorageKey,
      _handle: unknown,
      projection: { value?: { key: number } }
    ) => {
      records.set(key, value)
      if (indexMode !== 'stale' || !projections.has(key))
        projections.set(key, projection.value?.key ?? 0)
      return key
    },
    iterateRecordIndex: (query: IRecordIndexQuery) =>
      rows(
        indexMode === 'empty'
          ? []
          : [...projections]
              .filter(
                ([, value]) =>
                  indexMode === 'ignore-range' ||
                  !query.range ||
                  (value >= Number(query.range.lower) && value <= Number(query.range.upper))
              )
              .sort((a, b) => (query.direction === 'prev' ? b[1] - a[1] : a[1] - b[1]))
              .slice(0, query.limit ?? Infinity)
              .map(([key]) => [key, records.get(key)] as [IStorageKey, unknown])
      ),
    transactionIndexed: async (
      _handle: unknown,
      run: (scope: { deleteRecord(key: IStorageKey): Promise<void> }) => unknown
    ) => await run(native),
    subscribeChanges: (_listener: unknown) => () => undefined,
    watch: () => rows([])
  }
  item.api = { ...item.api, sync: native.sync }
  return {
    ...item,
    native,
    store: provideCapabilities(Object.assign(item.base, native), [
      implement(kv, item.api, { forTransaction: (scope) => scope })
    ])
  }
}

/** This pure vector subject rejects every non-vector TTL target, like a native vector backend. */
function vectorTtlFixture(mode?: 'ignore-expire' | 'ignore-persist') {
  const item = fixture()
  const points = new Map<string, { vector: readonly number[]; payload?: unknown }>()
  const channels: string[] = []
  const exactRequests: (boolean | undefined)[] = []
  let deadline: number | undefined
  const vectorApi: IVectorApi = {
    collection<TPayload>(): IVectorCollection<TPayload> {
      const hits = (query: readonly number[]): IVectorHit<TPayload>[] =>
        [...points]
          .map(([id, point]) => ({
            id,
            vector: point.vector,
            payload: point.payload as TPayload,
            score: point.vector.reduce((sum, value, index) => sum + value * query[index]!, 0)
          }))
          .sort((a, b) => b.score - a.score)
      const near = (query: readonly number[], options?: { readonly exact?: boolean }) => {
        exactRequests.push(options?.exact)
        return createVectorQuery<TPayload>({
          pushdown: {
            source: 'vector-ttl-fixture',
            operators: [],
            operations: ['topK']
          },
          execute: (input) =>
            rows(
              hits(query)
                .slice(0, input.topK ?? Infinity)
                .map((hit) => [hit.id, hit] as const)
            )
        })
      }
      return {
        near,
        similarTo: (id) => near(points.get(id)?.vector ?? [0]),
        recommend: (examples) => near(points.get(examples.positive[0])?.vector ?? [0]),
        upsert: async (values) => {
          for (const point of values) points.set(point.id, point)
        },
        delete: async (ids) => {
          for (const id of ids) points.delete(id)
        },
        deleteWhere: async (where) => {
          const matches = compileStorageWhere(where)
          let count = 0
          for (const [id, point] of points)
            if (matches(point.payload as TPayload)) {
              points.delete(id)
              count += 1
            }
          return count
        },
        search: async (query, options) => {
          exactRequests.push(options.exact)
          return hits(query).slice(0, options.k)
        }
      }
    }
  }
  const target = (value: ITtlTarget) => {
    channels.push(value.channel)
    if (value.channel !== 'vector')
      throw new StorageContractError(StorageContractErrorCode.unsupported)
    expect(value).toEqual({ channel: 'vector', collection: 'conformance-ttl', id: 'ttl-key' })
    return points.has(value.id)
  }
  const store = provideCapabilities(item.base, [
    implement(vector, vectorApi),
    implement(ttl, {
      expire: async (value, ms) => {
        if (!target(value)) return false
        if (mode !== 'ignore-expire') {
          deadline = Date.now() + ms
          if (ms === 0) {
            points.delete('ttl-key')
            deadline = undefined
          }
        }
        return true
      },
      persist: async (value) => {
        if (!target(value)) return false
        if (mode !== 'ignore-persist') deadline = undefined
        return true
      },
      remaining: async (value) => {
        target(value)
        return deadline === undefined ? undefined : Math.max(0, deadline - Date.now())
      }
    })
  ])
  return { store, channels, exactRequests }
}

/** Native RDF drafts borrow the canonical transaction owner; this fixture has no KV methods. */
function rdfTransactionFixture(mode?: 'drop-writes' | 'commit-rollback') {
  const features = { ...noFeatures, transactions: true }
  const item = fixture(features)
  let committed = new Map<string, IQuad>()
  const api = (data: Map<string, IQuad>): IRdfApi => ({
    add: async (quads) => {
      for (const quad of quads) data.set(JSON.stringify(quad), quad)
    },
    delete: async (quads) => {
      for (const quad of quads) data.delete(JSON.stringify(quad))
    },
    match: (pattern) =>
      createRdfQuery(
        {
          pushdown: { source: 'rdf-transaction-fixture', operators: [], operations: [] },
          execute: (input) => {
            const matches = compileStorageWhere(input.pattern)
            return rows(
              [...data]
                .filter(([, quad]) => matches(quad))
                .map(([key, quad]) => [key, quad] as const)
            )
          }
        },
        pattern
      )
  })
  type IScope = { use(capability: typeof rdf): ITransactionRdfApi }
  const owner = createTransactionOwner<unknown, IScope>(
    item.base,
    (error) => new StorageContractError(StorageContractErrorCode.invalidArgument, { cause: error })
  )
  const base = Object.assign(item.base, {
    transaction: async (run: (scope: IScope) => unknown, ctx?: IOperationContext) => {
      const draft = new Map(committed)
      const createScope = (): IScope => {
        const scope: IScope = {
          use: () => ({
            add: (quads) =>
              runTransactionOperation(scope, async () => {
                await Promise.resolve()
                if (mode !== 'drop-writes') await api(draft).add(quads)
              }),
            delete: (quads) => runTransactionOperation(scope, () => api(draft).delete(quads)),
            match: (pattern) =>
              createRdfQuery<undefined>(
                {
                  pushdown: { source: 'rdf-transaction-draft', operators: [], operations: [] },
                  execute: () => rows([...draft].map(([key, quad]) => [key, quad] as const))
                },
                pattern
              )
          })
        }
        return scope
      }
      const scope = createScope()
      const controller = owner.register(scope, {
        createScope,
        onFailure: () => undefined,
        context: ctx
      })
      try {
        const result = await run(scope)
        await controller.runFinalizers()
        if (ctx?.signal?.aborted) throw new StorageContractError(StorageContractErrorCode.aborted)
        committed = draft
        return result
      } catch (error) {
        if (mode === 'commit-rollback') committed = draft
        throw error
      } finally {
        controller.close()
      }
    }
  })
  const store = provideCapabilities(base, [
    implement(
      rdf,
      {
        add: (quads) => api(committed).add(quads),
        delete: (quads) => api(committed).delete(quads),
        match: (pattern) => api(committed).match(pattern)
      },
      { forTransaction: (scope) => scope.use(rdf) }
    )
  ])
  return { store, features }
}

describe('public consumer-owned conformance', () => {
  it('retains iterator read failure before original iterator cleanup failure', async () => {
    const primary = new Error('iterator read failed')
    const cleanup = new Error('iterator cleanup failed')
    const lifetime = createStorageIteratorLifetime<never>({
      close: async () => {
        throw cleanup
      },
      report: () => undefined
    })
    const iterator: IStorageIterator<never> = {
      next: () =>
        lifetime.advance(async () => {
          throw primary
        }),
      dispose: () => lifetime.dispose(),
      [Symbol.asyncDispose]: () => lifetime.symbolic(),
      [Symbol.asyncIterator]: () => iterator
    }
    await expect(conformanceRows(iterator)).rejects.toBe(primary)
    expect((primary as Error & { errors: unknown[] }).errors).toEqual([cleanup])
  })
  it('executes every selected KV assertion with a fresh fixture and cleanup', async () => {
    const created: ReturnType<typeof fixture>[] = []
    const selected = cases(() => {
      const item = fixture()
      created.push(item)
      return provideCapabilities(item.base, [implement(kv, item.api)])
    })
    expect(selected.length).toBe(17)
    for (const item of selected) await item.run()
    expect(created).toHaveLength(selected.length)
    for (const item of created) expect(item.dispose).toHaveBeenCalled()
  })

  it('preserves the original body and cleanup failures', async () => {
    const primary = new Error('assertion failed')
    const cleanup = new Error('cleanup failed')
    const item = fixture()
    item.dispose.mockImplementation(() => Promise.reject(cleanup))
    const selected: (() => void | PromiseLike<void>)[] = []
    runConformance(
      {
        describe: (_name, run) => {
          void run()
        },
        it: (_name, run) => {
          selected.push(run)
        },
        expect: () => {
          throw primary
        }
      },
      {
        name: 'failures',
        create: () => provideCapabilities(item.base, [implement(kv, item.api)]),
        capabilities: [kv],
        features: noFeatures
      }
    )
    const error = await Promise.resolve(selected[0]()).then(
      () => undefined,
      (error) => error
    )
    expect(error).toBe(primary)
    expect(error.errors).toEqual([cleanup])
    expect(error.stack).toBe(primary.stack)
  })

  it('rejects an omitted actual standard token and a TTL API missing persist', async () => {
    const item = fixture()
    const ttlApi = {
      expire: async () => false,
      remaining: async () => undefined,
      persist: async () => false
    }
    const declaredWrong = cases(() =>
      provideCapabilities(item.base, [implement(kv, item.api), implement(ttl, ttlApi)])
    )
    await expect(declaredWrong[0].run()).rejects.toThrow()
    const missing = cases(
      () =>
        provideCapabilities(fixture().base, [
          implement(ttl, { ...ttlApi, persist: undefined } as never)
        ]),
      [ttl]
    )
    await expect(missing[0].run()).rejects.toThrow()
  })

  it('runs the complete TTL group for an actual expiring text fixture', async () => {
    const selected = cases(() => {
      const item = fixture()
      let deadline: number | undefined
      const ttlApi = {
        expire: async (_target: unknown, ms: number) => {
          if (!item.values.has(JSON.stringify('ttl-key'))) return false
          deadline = Date.now() + ms
          if (ms === 0) item.values.delete(JSON.stringify('ttl-key'))
          return true
        },
        remaining: async () =>
          deadline === undefined ? undefined : Math.max(0, deadline - Date.now()),
        persist: async () => {
          if (!item.values.has(JSON.stringify('ttl-key'))) return false
          deadline = undefined
          return true
        }
      }
      return provideCapabilities(item.base, [implement(kv, item.api), implement(ttl, ttlApi)])
    }, [kv, ttl])
    const item = selected.find((item) => item.name.startsWith('ttl ·'))!
    await item.run()
  })

  it('uses only the actual vector TTL channel and rejects ignored expiry or persist', async () => {
    const item = vectorTtlFixture()
    await cases(() => item.store, [vector, ttl])
      .find((item) => item.name.startsWith('ttl ·'))!
      .run()
    expect(new Set(item.channels)).toEqual(new Set(['vector']))
    for (const mode of ['ignore-expire', 'ignore-persist'] as const) {
      const wrong = vectorTtlFixture(mode)
      await expect(
        cases(() => wrong.store, [vector, ttl])
          .find((item) => item.name.startsWith('ttl ·'))!
          .run()
      ).rejects.toThrow()
    }
  })

  it('uses exact native vector requests for deterministic standard assertions', async () => {
    const item = vectorTtlFixture()
    await cases(() => item.store, [vector, ttl])
      .find((item) => item.name.startsWith('vector ·'))!
      .run()
    expect(item.exactRequests).toEqual([true, true, true, true])
  })

  it('keeps every serial native record fallback on its own initialized key', async () => {
    const features = { ...noFeatures, records: true, transactions: true }
    const names = [
      'clear 后重建 record 遵守原生串行或乐观 ABA 检查',
      'transaction 对实际并发写采用后端隔离语义',
      'transaction 保持 repeatable snapshot，按后端原生或乐观规则提交'
    ]
    const selected = cases(
      () => {
        const item = wrongFixture(features)
        const values = new Map<IStorageKey, unknown>()
        Object.assign(item.store, {
          getRecord: async (key: IStorageKey) => values.get(key),
          putRecord: async (value: unknown, key: IStorageKey) => {
            values.set(key, value)
            return key
          },
          clearRecords: async () => {
            values.clear()
          },
          transaction: async (run: (scope: typeof item.store) => unknown) => run(item.store)
        })
        return item.store
      },
      [kv],
      features
    ).filter((item) => names.includes(item.name))
    expect(selected).toHaveLength(names.length)
    for (const item of selected) await item.run()
  })

  it('runs native RDF commit, rollback and accepted/abort cases without any KV surface', async () => {
    const selected = cases(() => rdfTransactionFixture().store, [rdf], {
      ...noFeatures,
      transactions: true
    }).filter((item) => item.name.startsWith('transactions ·'))
    expect(selected).toHaveLength(3)
    for (const item of selected) await item.run()
    for (const [mode, name] of [
      ['drop-writes', 'accepted'],
      ['commit-rollback', 'failure']
    ] as const) {
      const wrong = rdfTransactionFixture(mode)
      await expect(
        cases(() => wrong.store, [rdf], wrong.features)
          .find((item) => item.name.startsWith('transactions ·') && item.name.includes(name))!
          .run()
      ).rejects.toThrow()
    }
  })

  it('checks callback-only native transactions without inventing a writable token', async () => {
    const features = { ...noFeatures, transactions: true }
    const create = (ignoreCallback = false) => {
      const item = fixture(features)
      return provideCapabilities(
        Object.assign(item.base, {
          transaction: async (run: () => unknown, ctx?: IOperationContext) => {
            if (ignoreCallback) return undefined
            const result = await run()
            if (ctx?.signal?.aborted)
              throw new StorageContractError(StorageContractErrorCode.aborted)
            return result
          }
        }),
        []
      )
    }
    await cases(() => create(), [], features)
      .find((item) => item.name.startsWith('transactions ·'))!
      .run()
    await expect(
      cases(() => create(true), [], features)
        .find((item) => item.name.startsWith('transactions ·'))!
        .run()
    ).rejects.toThrow()
  })

  it('observes committed feed values and unsubscribes once on the original fixture', async () => {
    const features = { ...noFeatures, changeFeed: true }
    const item = fixture(features)
    const listeners = new Set<(change: IStorageChange) => void>()
    const stopped = vi.fn()
    const set = item.api.set
    item.api = {
      ...item.api,
      set: async (key, value, ctx) => {
        await set(key, value, ctx)
        for (const listener of listeners)
          listener({ sequence: 1, origin: 'fixture', channel: 'all', kind: 'put' })
      }
    }
    const store = provideCapabilities(
      Object.assign(item.base, {
        subscribeChanges: (listener: (change: IStorageChange) => void) => {
          listeners.add(listener)
          return () => {
            stopped()
            listeners.delete(listener)
          }
        },
        watch: () => rows<IStorageChange>([])
      }),
      [implement(kv, item.api)]
    )
    await cases(() => store, [kv], features)
      .find((item) => item.name.startsWith('changeFeed ·'))!
      .run()
    expect(stopped).toHaveBeenCalledTimes(1)
  })

  it('rejects a callable durable feed that omits a committed native write', async () => {
    const item = fixture()
    const replay = vi.fn(async () => ({ changes: [], cursor: 'head' }))
    const store = provideCapabilities(item.base, [
      implement(kv, item.api),
      implement(durableChangeFeed, {
        readChanges: replay,
        tailChanges: async () => fixture().base
      })
    ])
    const selected = cases(() => store, [kv, durableChangeFeed])
    await expect(
      selected.find((item) => item.name.startsWith('durableChangeFeed ·'))!.run()
    ).rejects.toThrow()
    expect(replay).toHaveBeenCalledTimes(2)
  })

  for (const feature of [
    'syncRead',
    'binary',
    'records',
    'iteration',
    'transactions',
    'secondaryIndexes'
  ] as const) {
    it(`rejects a declared ${feature} no-op group`, async () => {
      const features = { ...noFeatures, [feature]: true }
      const selected = cases(
        () =>
          wrongFixture(
            feature === 'secondaryIndexes'
              ? { ...features, records: true, binary: true, iteration: true, transactions: true }
              : features,
            feature === 'secondaryIndexes' ? 'empty' : undefined
          ).store,
        [kv],
        feature === 'secondaryIndexes'
          ? { ...features, records: true, binary: true, iteration: true, transactions: true }
          : features
      )
      const prefix = {
        syncRead: 'syncRead ·',
        binary: 'getBytes/setBytes',
        records: 'putRecord 不传',
        iteration: 'iterateRecords',
        transactions: 'transactions · native accepted',
        secondaryIndexes: 'secondaryIndexes · ranges'
      }[feature]
      await expect(selected.find((item) => item.name.startsWith(prefix))!.run()).rejects.toThrow()
    })
  }

  for (const mode of ['empty', 'ignore-range', 'stale'] as const) {
    it(`rejects ${mode} secondary index semantics`, async () => {
      const features = {
        ...noFeatures,
        records: true,
        binary: true,
        iteration: true,
        transactions: true,
        secondaryIndexes: true
      }
      const selected = cases(() => wrongFixture(features, mode).store, [kv], features)
      await expect(
        selected.find((item) => item.name.startsWith('secondaryIndexes · ranges'))!.run()
      ).rejects.toThrow()
    })
  }

  it.fails('rejects a silent feed with a valid unsubscribe through the consumer runner timeout', async () => {
    const features = { ...noFeatures, changeFeed: true }
    const selected = cases(() => wrongFixture(features).store, [kv], features)
    await selected.find((item) => item.name.startsWith('changeFeed ·'))!.run()
  }, 50)

  it('accepts pure vector and SQL subjects at the public generic boundary', () => {
    function compile(
      harness: IConformanceHarness,
      values: IStorageStore<typeof kv>,
      vectors: IStorageStore<typeof vector>,
      database: IStorageStore<typeof sql>,
      vectorApi: IVectorApi,
      sqlApi: ISqlExecutor
    ): void {
      runConformance(harness, {
        name: 'kv',
        create: () => values,
        capabilities: [kv],
        features: noFeatures
      })
      runConformance(harness, {
        name: 'vector',
        create: () => vectors,
        capabilities: [vector],
        features: noFeatures
      })
      runConformance(harness, {
        name: 'sql',
        create: () => database,
        capabilities: [sql],
        features: noFeatures
      })
      void vectorApi
      void sqlApi
    }
    void compile
  })
})
