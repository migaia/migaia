import { it, expect, expectTypeOf, onTestFinished } from 'vitest'
import { createStorageHost, definePlugin, type IStorageBorrowedBackend } from '@migaia/storage-host'
import { createStore } from '@migaia/store-light'
import { persist } from '@migaia/store-persist/light'
import { persistTransaction } from '@migaia/store-persist'
import { kv, type ISqlExecutor } from '@migaia/storage-contract'
import { sqliteBackendPlugin, type ISqliteValue, type ISqliteRunResult } from '../src/index.js'
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
  const connection = nodeSqliteDriver(':memory:')
  const host = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver: connection })] as const
  })
  const storage = host.backend('sqlite')
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
  const failure = new Error('consumer rollback')
  await expect(
    persistTransaction(storage, [handle], async (tx) => {
      await tx.sql`INSERT INTO consumer_rows VALUES(${2})`.run()
      throw failure
    })
  ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED', cause: failure })
  await handle.flush()
  expect(await countRows(storage)).toMatchObject({ count: 1 })
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
    'has',
    'keys',
    'remove',
    'set',
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
