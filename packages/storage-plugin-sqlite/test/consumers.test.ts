import { it, expect, expectTypeOf, onTestFinished } from 'vitest'
import {
  createStorageHost,
  definePlugin,
  defineFeature,
  type IStorageBorrowedBackend
} from '@migaia/storage-host'
import { deferred } from '@migaia/utils/promise'
import { createStore } from '@migaia/store-light'
import { persist } from '@migaia/store-persist/light'
import { persistTransaction } from '@migaia/store-persist'
import { kv, records, sql, lockKey, type ISqlExecutor } from '@migaia/storage-contract'
import {
  sqliteBackendPlugin,
  sqliteBackendKind,
  type ISqliteValue,
  type ISqliteRunResult,
  type ISqliteDriver
} from '../src/index.js'
import { nodeSqliteDriver } from '../src/node.js'
/** Existing SQL consumers depend only on the shared executor and retain external row interfaces. */
interface ICountRow {
  readonly count: number
}
/** Generic SQL clients need neither driver access nor backend-specific composition. */
function countRows(executor: ISqlExecutor<ISqliteValue, ISqliteRunResult>) {
  return executor.sql<ICountRow>`SELECT count(*) AS count FROM consumer_rows`.get()
}
/** Persist and SQL share the actual native transaction, including concrete scope extensions. */
it('commits persistence and native SQL through one original transaction', async () => {
  /** Standard capability projection must not duplicate the native SQL execution or observations. */
  const operations: string[] = []
  const connection = nodeSqliteDriver(':memory:')
  const host = await createStorageHost({
    hooks: { beforeStorageOperation: ({ operation }) => operations.push(operation) },
    plugins: [sqliteBackendPlugin({ driver: connection })] as const
  })
  const storage = host.backend('sqlite')
  expect(storage.use(sql).sql).toBe(storage.sql)
  const state = createStore({ count: 0 })
  const handle = persist(state, { key: 'counter', storage, version: 1 })
  onTestFinished(async () => {
    await handle.disposeAsync()
    await state.$dispose()
    await host.dispose()
    await connection.dispose()
  })
  await handle.ready
  await storage.sql`CREATE TABLE consumer_rows(id INTEGER PRIMARY KEY)`.run()
  const count = await persistTransaction(storage, [handle], async (tx) => {
    state.count = 1
    await handle.flush(tx)
    await tx.sql`INSERT INTO consumer_rows VALUES(${1})`.run()
    return countRows(tx)
  })
  expectTypeOf(count).toEqualTypeOf<ICountRow | undefined>()
  expect(count).toMatchObject({ count: 1 })
  // Resuming persistence may start its ordinary mirror write; drain it before a root connection read.
  await handle.flush()
  expect(JSON.parse((await storage.get('counter'))!)).toMatchObject({
    version: 1,
    state: { count: 1 }
  })
  expect(await countRows(storage)).toMatchObject({ count: 1 })
  const capabilityCount = await storage.use(sql)
    .sql<ICountRow>`SELECT count(*) AS count FROM consumer_rows`.get()
  expectTypeOf(capabilityCount).toEqualTypeOf<ICountRow | undefined>()
  expect(capabilityCount).toMatchObject({ count: 1 })
  /** The standard projection borrows a fresh native view while retaining the original SQL budget. */
  let saved!: () => Promise<unknown>
  const beforeCapability = operations.length
  await storage.transaction(async (tx) => {
    const query = tx.use(sql).sql`SELECT count(*) AS count FROM consumer_rows`
    saved = () => query.get()
    expect(await saved()).toMatchObject({ count: 1 })
    await tx.use(sql).sql`INSERT INTO consumer_rows VALUES(${3})`.run()
  })
  expect(operations.slice(beforeCapability)).toEqual(['sql', 'sql'])
  await expect(saved()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  expect(await countRows(storage)).toMatchObject({ count: 2 })
  const failure = new Error('consumer rollback')
  await expect(
    persistTransaction(storage, [handle], async (tx) => {
      await tx.sql`INSERT INTO consumer_rows VALUES(${2})`.run()
      throw failure
    })
  ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED', cause: failure })
  await handle.flush()
  expect(await countRows(storage)).toMatchObject({ count: 2 })
})

/** A real dependent plugin borrows the original provider without acquiring close authority. */
it('limits borrowed KV capabilities to original channel methods and precise sync access', async () => {
  const connection = nodeSqliteDriver(':memory:')
  let borrowed!: IStorageBorrowedBackend
  const consumer = definePlugin('consumer', (core) => {
    borrowed = core.getPublishedBackend('sqlite')
    return { install: () => ({}) }
  })
  const host = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver: connection })] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
  })
  await host.use(consumer)
  const storage = host.backend('sqlite')
  const api = borrowed.use(kv)
  expect(api).toBe(storage.use(kv))
  expect(Reflect.ownKeys(api).sort()).toEqual([
    'clearAll',
    'clearValues',
    'get',
    'getMany',
    'has',
    'keys',
    'remove',
    'removeByPrefix',
    'removeMany',
    'set',
    'setMany',
    'sync'
  ])
  expect(api.sync).toBe(storage.sync)
  expect(Reflect.ownKeys(api.sync!).sort()).toEqual([
    'clearValues',
    'get',
    'has',
    'keys',
    'remove',
    'set'
  ])
  for (const name of ['dispose', 'metadata', 'sql'] as const) expect(name in api).toBe(false)
  expect(Symbol.asyncDispose in api).toBe(false)
  await api.set('shared', 'kept')
  expect(await storage.get('shared')).toBe('kept')
})

/**
 * Selected Features consume authentic SQLite views and original fluent creators without close
 * rights.
 */
it('binds selected Feature scopes and branches to the original native connection', async () => {
  /** Caller ownership must survive every host operation and final release. */
  const connection = nodeSqliteDriver(':memory:')
  /** Selected output carries pure branch methods and authentic transaction I/O together. */
  const selected = defineFeature(sqliteBackendKind, () => ({
    capabilities: [],
    chain: {
      tx: {
        /** Return the actual derived receiver without opening an operation. */
        mark<T>(this: T): T {
          return this
        }
      },
      query: {
        /** Return the actual derived receiver without opening an operation. */
        mark<T>(this: T): T {
          return this
        }
      }
    },
    api: {
      store: {
        async native() {
          return this.client
        }
      },
      transaction: {
        async native() {
          expectTypeOf(this.client).toEqualTypeOf<ISqliteDriver>()
          expect(this.store).toBe(this.scope)
          return this.client
        },
        /** Both native and storage writes must use this operation's original transaction. */
        async write(key: string) {
          await this.scope.sql`INSERT INTO feature_rows VALUES(${key})`.run()
          await this.scope.set(key, 'feature')
        },
        /** A deliberately unawaited accepted method must delay commit until it settles. */
        async later(waiting: Promise<void>) {
          await waiting
          await this.scope.set('later', 'drained')
        },
        async fail(error: Error): Promise<never> {
          throw error
        }
      }
    }
  }))
  /** The real installation publishes methods without replacing backend ownership. */
  const host = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver: connection }, { selected })] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
  })
  /** The selected plugin tuple retains its exact Feature surface. */
  const store = host.backend('sqlite')
  /** Store and transaction clients must expose the same finite borrowed view. */
  const native = await store.api.native()
  expect(Reflect.ownKeys(native).sort()).toEqual(['exec', 'prepare'])
  expect('dispose' in native).toBe(false)
  expect(Symbol.asyncDispose in native).toBe(false)
  expect(Symbol.dispose in native).toBe(false)
  expect(native.prepare('SELECT 3 AS n').get()).toMatchObject({ n: 3 })
  await store.sql`CREATE TABLE feature_rows(key TEXT)`.run()
  /** Original builder branches carry one captured method identity. */
  const builder = store.tx()
  expect(builder.mark()).toBe(builder)
  /** A configured branch retains the method while supplying its own receiver. */
  const locked = builder.lock(lockKey.text('scoped'))
  expect(locked.mark).toBe(builder.mark)
  expect(locked.mark()).toBe(locked)
  /** Extracting an API method cannot prolong its authentic scope's lifetime. */
  let saved!: () => Promise<ISqliteDriver>
  await locked.run(async (scope) => {
    expect(await scope.api.native()).toBe(native)
    await scope.api.write('scoped')
    await scope.putRecord({ id: 1, active: true }, 'row')
    /** The transaction capability retains the original native query source and pure methods. */
    const query = scope.use(records).query<{ id: number; active: boolean }>()
    expect(query.mark()).toBe(query)
    /** Selection preserves method identity while changing the original query's row type. */
    const selected = query.where({ active: true }).select('id')
    expect(selected.mark).toBe(query.mark)
    expect(await selected.all()).toEqual([{ id: 1 }])
    saved = scope.api.native
  })
  expect(await store.get('scoped')).toBe('feature')
  expect(await store.sql`SELECT key FROM feature_rows`.all()).toEqual([{ key: 'scoped' }])
  await expect(saved()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  /** Admit the method before observing whether its enclosing transaction can commit. */
  const started = deferred<void>()
  /** Release only the accepted method; its transaction must own the remaining drain. */
  const finish = deferred<void>()
  /** Retain the deliberately unawaited operation for final settlement. */
  let accepted: Promise<void> | undefined
  /** Track actual enclosing transaction settlement rather than callback completion. */
  let committed = false
  /** Returning from the callback must still wait for its accepted Feature operation. */
  const pending = store
    .transaction((scope) => {
      accepted = scope.api.later(finish.promise)
      started.resolve()
    })
    .then(() => {
      committed = true
    })
  await started.promise
  expect(committed).toBe(false)
  finish.resolve()
  await Promise.all([pending, accepted])
  expect(await store.get('later')).toBe('drained')
  /** The original error must stay reachable after caught Feature failure and rollback. */
  const primary = new Error('Feature rollback')
  /** Capture the owner's first failure before the enclosing transaction returns it. */
  let first: unknown
  /** Catching the data error cannot commit preceding SQL or KV changes. */
  const failure = await store
    .transaction(async (scope) => {
      await scope.api.write('rolled-back')
      await scope.api.fail(primary).catch((error) => {
        first = error
      })
    })
    .catch((error) => error)
  expect(failure).toBe(first)
  expect(failure).toMatchObject({ code: 'TRANSACTION_FAILED', cause: primary })
  expect(await store.get('rolled-back')).toBeNull()
  expect(await store.sql`SELECT key FROM feature_rows`.all()).toEqual([{ key: 'scoped' }])
  /** Root queries consume the same selected method table as transaction queries. */
  const query = store.use(records).query<{ id: number; active: boolean }>()
  /** Derived methods must seal with their original installation. */
  const branch = query.where({ active: true }).select('id')
  expect(branch.mark).toBe(query.mark)
  expect(branch.mark()).toBe(branch)
  expect(await branch.all()).toEqual([{ id: 1 }])
  await host.dispose()
  expect(() => branch.mark()).toThrowError()
  expect(() => locked.mark()).toThrowError()
  expect(connection.prepare('SELECT 1 AS n').get()).toMatchObject({ n: 1 })
})
