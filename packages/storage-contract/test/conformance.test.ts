import { describe, expect, it, vi } from 'vitest'
import { runConformance, type IConformanceHarness } from '@migaia/storage-contract/conformance'
import { conformanceRows } from '../src/conformance/harness.js'
import {
  kv,
  ttl,
  durableChangeFeed,
  vector,
  sql,
  implement,
  provideCapabilities,
  StorageContractError,
  StorageContractErrorCode,
  type IKeyValueApi,
  type IStorageCapabilities,
  type IStorageStore,
  type IAnyStorageCapability,
  type IVectorApi,
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
    store: provideCapabilities(Object.assign(item.base, native), [implement(kv, item.api)])
  }
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
              : features
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
        transactions: 'transaction 内的写入',
        secondaryIndexes: 'secondaryIndexes ·'
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
