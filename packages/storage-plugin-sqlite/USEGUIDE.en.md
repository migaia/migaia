# SQLite usage guide

[中文](./USEGUIDE.md)

These are complete Node 24+ programs. In Bun, use `bunSqliteDriver` from `/bun`. File examples write in the current directory, which must be writable. Create the connection before the host so scope cleanup releases the host first.

## Find a scenario

| Need                                        | Section                                                             |
| ------------------------------------------- | ------------------------------------------------------------------- |
| Save values, records and deadlines together | [Save values with expiry](#save-values-with-expiry)                 |
| Roll back application SQL and KV together   | [Commit SQL and storage together](#commit-sql-and-storage-together) |
| Produce a separate backup file              | [Back up a database](#back-up-a-database)                           |
| Coordinate connections or cancel work       | [Concurrency and cancellation](#concurrency-and-cancellation)       |

## Save values with expiry

The example uses a fixed organization in a file database. Expected output: `ready`, `1`, `true`.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { kv, records, ttl, counter } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/sdk'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
await using connection = nodeSqliteDriver('./example-settings.sqlite')
await using host = await createStorageHost({
  plugins: [sqliteBackendPlugin({ driver: connection })] as const
})
const store = host.org('10000000-0000-4000-8000-000000000001').backend('sqlite')
await store
  .tx()
  .lock(lockKey.text('example:status'))
  .run(async (tx) => {
    await tx.use(kv).setMany([
      { key: 'example:status', value: 'ready' },
      { key: ['example', 1], value: 'first', ttlMs: 60000 }
    ])
    await tx.putRecord({ name: 'Ada' }, 'example:user')
    await tx.use(ttl).expire(lockKey.text('example:status'), 60000)
    await tx.set('example:count', '0')
    await tx.use(counter).increment('example:count')
  })
console.log(await store.get('example:status'))
console.log(await store.get('example:count'))
console.log((await store.use(records).query().all()).length >= 1)
```

Organization IDs are UUID strings. Organizations share one connection and the physical tables; keys, expiry, revisions and locks remain separate. Accessing an organization opens no extra connection or table. `host.dropOrg(id)` removes only that organization's managed rows, never application tables. Explicit organization views provide neither arbitrary SQL nor maintenance.

`setMany` accepts finite nonnegative ttlMs. Zero expires immediately; omission keeps a live deadline and gives a new value no deadline. `getMany` retains input order, duplicates and undefined missing positions. Equivalent duplicate write keys reject before I/O. Batch writes/deletes commit or roll back together; deletes return actual counts, and chunked reads share one snapshot. One batch enters its pipeline and count observation once; an empty batch performs no native work.

TTL uses local Date.now and is written with the value. Replacing a live value retains expiry; removal, clear and cross-channel replacement remove the old deadline. Reads, enumeration and record queries clean expired rows lazily, without timers. A value observed alive and then expired before commit enters conflict handling instead of committing a stale observation. Counters start missing values at 0 and accept only canonical decimal text and safe integers; invalid text or overflow reject before writes.

## Commit SQL and storage together

This creates its own application table in an in-memory database. Expected output: `Ada`, `1`.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { sqlFragment } from '@migaia/storage-host/sdk'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
await using connection = nodeSqliteDriver(':memory:')
await using host = await createStorageHost({
  plugins: [sqliteBackendPlugin({ driver: connection })] as const
})
const store = host.backend('sqlite')
await store.sql`CREATE TABLE app_users(id INTEGER PRIMARY KEY, name TEXT)`.run()
await store.transaction(async (tx) => {
  await tx.sql`INSERT INTO app_users VALUES(${1}, ${'Ada'})`.run()
  await tx.set('user-count', '1')
})
const row = await store.sql<{ name: string }>`
  SELECT name FROM ${sqlFragment.id('app_users')} WHERE id=${1}
`.get()
console.log(row?.name)
console.log(store.sync!.get('user-count'))
```

SQL interpolation binds values; use sqlFragment.id for identifiers and the same SQL tools for fragment composition. One statement with an optional trailing semicolon is accepted. Transaction-control statements and journal_mode changes reject: use transaction instead. Complete trigger bodies containing internal statement lists are outside this endpoint. Row types are caller declarations, with no column validation or Date conversion.

Safe integers read as number; larger integers remain bigint. Boolean inputs become 0/1; BLOB results are independent Uint8Array values. Both changes and lastInsertRowid are number or bigint, and SQLite always supplies lastInsertRowid. The standard sql token uses the same native tag. Statement caching is bounded to 64 entries; evicting a Node entry does not immediately finalize its native statement.

While a transaction uses the connection, root reads, synchronous methods and root SQL fail with TRANSACTION_FAILED. Use tx inside the callback. A saved tx expires when the callback ends. Caught and unawaited operation failures still roll back. Cancellation waits for started work to settle before rollback and lock release; it cannot preempt a synchronous statement or a callback that ignores cancellation.

## Back up a database

Select the maintenance Feature explicitly. This writes a status and creates a new backup filename each run. Expected output: `ready`.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
import { sqliteMaintenanceFeature } from '@migaia/storage-plugin-sqlite/features/maintenance'
await using connection = nodeSqliteDriver('./example-settings.sqlite')
await using host = await createStorageHost({
  plugins: [
    sqliteBackendPlugin({ driver: connection }, { maintenance: sqliteMaintenanceFeature() })
  ] as const
})
const store = host.backend('sqlite')
await store.set('example:backup', 'ready')
await store.api.maintenance.backup(`./example-backup-${crypto.randomUUID()}.sqlite`)
console.log(await store.get('example:backup'))
```

Backup uses VACUUM INTO. The destination must not exist and must be writable; it is neither deleted nor overwritten first. Failure may leave a partial file. Cancellation cannot prove that no file was written. Vacuum compacts the current database. Maintenance appears only on root store.api.maintenance, never on tx.api or organization views. Application Features may provide transaction APIs; their SQL and KV participate in that same transaction, including failure tracking.

## Concurrency and cancellation

Files default to wal:true; installation requests and verifies the actual mode. Connections already using journal_mode=OFF reject. In-memory databases default to false and reject explicit true. wal:false still uses real BEGIN/COMMIT/ROLLBACK, but its logical locks coordinate only the current process.

Use tx().lock(lockKey.text(...)).run for explicit logical locks. Select policies from `@migaia/storage-host/sdk`. Only matching logical keys conflict; SQLite's physical writer wait is not a business-key conflict. inspectLocks returns actual holders and expiry. maxLockMs defaults to 30000ms, without heartbeat. Cancellation is cooperative.

## Data and failures

Text, bytes and records use separate channels, but another channel holding the same key causes DUPLICATE_KEY. Explicit conflictPolicy:'replace' replaces it atomically; same-channel writes overwrite normally. Missing text/bytes return null and missing records/metadata return undefined. keys lists only text string keys; clearAll retains metadata; clearing one channel leaves the others alone. Text retains NUL and lone UTF-16 surrogates. Records/metadata use collection-aware encoding including Map/Set. Nonportable values reject before table modification; byte inputs and outputs are copied.

Driver is required; table defaults to migaia. concurrency selects conflict behavior and maxLockMs bounds the lease. A store uses the driver exclusively but never closes it. Separate connections may share a file; one driver cannot serve two stores concurrently. Feature clients expose exec/prepare without disposal. Repeated dispose returns the same main Promise; symbolic cleanup has a separate report-only Promise, sharing one real cleanup. The store stays terminal after cleanup failure.

Package failures use source @migaia/storage-plugin-sqlite and SQLITE_FAILED, TRANSACTION_FAILED, DUPLICATE_KEY or DECODE_FAILED. Shared validation, cancellation, timeout and conflict codes retain their source. Original failures remain on cause; aggregate errors keep the primary failure first if rollback also fails. Decode errors never repair data automatically. Vectors and RDF are unsupported, including their lock targets before native I/O. No live change feed or server-side record-field index is provided.

## Optional journals

Enable journals explicitly with `storageJournalPlugin(options)` from `@migaia/storage-host/plugins/journal`. SQLite captures complete values, every actual mutation and absolute expiry inside the data transaction, retaining repeated writes and intermediate values. Undo locks and checks every target's final revision/image before restoring. It restores original absolute deadlines, without extending expired data. Recreated organizations and reopened non-WAL coordination groups cannot reuse old undo images. Metadata is excluded from business mutation logs.

External binlog append happens after commit; failure reports but cannot undo committed data. Supported WAL combinations use a marker committed with the data, and recovery does not replay known committed changes. Raw SQL has no complete standard-image target and rejects before execution when commit logging is selected. Global journal configuration uses an asynchronous pipeline, so synchronous entries fail with ASYNC_STAGE_IN_SYNC_ENTRY; installations without journals retain synchronous APIs.

Import storageLogStore separately from `@migaia/storage-host/plugins/journal`; an initializer can open a journal in the same database. An in-memory connection exclusively uses a journal namespace until release. File journals read current indexes inside each BEGIN IMMEDIATE transaction and allow multiple connections. Business clear operations leave private journals intact. With commit logging selected, expiry cleanup triggered by reads is logged too; telemetry-only or initializer-only configurations do not enable this mutation logging. Telemetry records each root operation or whole transaction once. The application releases the logger and its storage after releasing the host.
