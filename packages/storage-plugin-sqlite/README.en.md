# @migaia/storage-plugin-sqlite

A native SQLite backend installed in `@migaia/storage-host`. Node and Deno use
`node:sqlite`; Bun uses `bun:sqlite`. The package root loads neither driver.
No npm native addon is required.

`storage.use(kv)` provides native `getMany`, `setMany`, `removeMany`, and `removeByPrefix`.
Use `tx.use(kv)` or the corresponding short methods inside a transaction. Canonical structured
keys preserve input order and duplicate read positions; missing values are `undefined`. Duplicate
write keys reject before I/O. Writes and removals commit or roll back in one native transaction;
removals return the actual count. Bounded IN chunks share one native read snapshot. Each batch
enters one pipeline and count hook; empty admitted batches do neither. `setMany` accepts finite,
nonnegative `ttlMs`, stored atomically with its value. Vector and RDF locks reject with
`UNSUPPORTED_CAPABILITY` before native I/O because SQLite owns neither domain.

## Install a backend

```ts
import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'

await using connection = nodeSqliteDriver('./settings.sqlite')
await using host = await createStorageHost({
  plugins: [sqliteBackendPlugin({ driver: connection })] as const
})
const storage = host.backend('sqlite')
await storage.set('theme', 'dark')
console.log(await storage.get('theme'))
```

Create the connection before the host so disposal releases the host first.
The store borrows its driver exclusively. Store disposal never closes the
connection. Use one active store per driver; different connections can use
one file. A `table` prefix isolates their physical tables (default `migaia`).

For Bun, import `bunSqliteDriver` from `/bun`. Deno uses `/node` and needs read
and write permission for the database and its journal files. Node requires its
built-in SQLite module (Node 24 or later). Driver subpaths are explicit hard
runtime requirements; there is no driver detection or fallback.

## Native storage and SQL

The store provides text, bytes, records, ordered record iteration, synchronous
text methods, metadata, complete native transactions and a bound SQL tag.
`kv` and `records` use the shared capability identities from
`@migaia/storage-contract`. Record queries use that package's actual
`where`/`select`/`all` executor and report client evaluation honestly.

Text and byte misses return `null`; record and metadata misses return
`undefined`. `keys()` lists only string text keys. Channel-specific deletes
leave the other channels unchanged. `clearAll()` preserves metadata.
Cross-channel ownership conflicts throw `DUPLICATE_KEY`; explicitly choose
`{ conflictPolicy: 'replace' }` to replace atomically. Updates within the same
channel overwrite normally.

Text preserves NUL and lone UTF-16 surrogate code units through the existing
JSON codec. Records and metadata use the collections codec, preserving Maps
and Sets. Unsupported portable values fail before table changes. Binary
inputs and outputs are detached. Keys use the canonical ordered key codec.

```ts
import { sqlFragment } from '@migaia/storage-contract'

await storage.sql`CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT)`.run()
await storage.transaction(async (tx) => {
  await tx.sql`INSERT INTO users VALUES(${1}, ${'Ada'})`.run()
  await tx.set('user-count', '1')
})
const rows = await storage.sql<{ id: number; name: string }>`
  SELECT id, name FROM ${sqlFragment.id('users')} WHERE id = ${1}
`.all()
```

SQL interpolation always binds values. `sqlFragment.id` quotes identifiers;
shared fragments support composition and `join`. SQL accepts one statement,
with an optional final semicolon. Transaction control and `journal_mode`
changes reject before driver execution. Use `transaction` for commit and
rollback; complete trigger bodies containing internal statement lists are
outside this SQL entry's scope. SQL row types describe caller knowledge and
do not validate column names or convert dates.

Native integers outside the safe number range remain `bigint`; safe integers
become numbers. Boolean inputs bind as 0/1. BLOB columns return detached
`Uint8Array` values. `run` returns `changes` and `lastInsertRowid`, each a
`number | bigint`. Statements use an instance-local 64-entry LRU. Eviction
removes references; it does not promise immediate native finalization on Node.

## Concurrency and ownership

File databases default to `wal: true`. Initialization requests and verifies
actual WAL. `wal: false` uses the shared host process-local logical locks and
revision facts while retaining native BEGIN/COMMIT/ROLLBACK. It creates no
persistent lock or revision table and makes no cross-process logical-lock
promise. An in-memory database defaults to false; explicit true rejects.
A connection already configured with journal mode OFF rejects.

Use `storage.tx().lock(lockKey.text('key')).run(...)` and policies from
`@migaia/storage-contract`. Only equal logical keys conflict. SQLite writer
serialization is physical waiting, including under `ConcurrencyPolicy.fail()`.
`inspectLocks()` returns actual holder and expiry diagnostics. WAL logical
leases default to 30,000 ms (`maxLockMs`); they have no heartbeat. Cancellation
is cooperative: accepted native work must finish or roll back before resources
are released. A callback that ignores cancellation cannot be forcibly stopped.

Root reads, synchronous methods and root SQL reject with `TRANSACTION_FAILED`
while this connection belongs to a native transaction. Use the callback's
`tx`. Callback views expire when the callback settles; accepted operations and
final checks receive their own original-owner views. Caught or unawaited data
failures still force rollback. `tx.sql` and KV always use the same native
transaction. User SQL does not infer logical keys from SQL text.

`readTransactionOperationContext(tx)` reads the frozen attempt context retained
by the original transaction owner. Composed operations and final checks share
its captured fields and original live signal without rereading caller getters,
resetting deadlines or creating another cancellation controller. Cooperatively
cancelled work settles before native rollback and logical lock release complete.

Selected Features use the same transaction and query creators. `tx.api` is bound before
its original short view is frozen. Its SQL and KV operations commit or roll back together;
caught and unawaited failures still belong to the original transaction owner. Feature
`query` and `tx` methods remain on actual derived chains. The borrowed native client is
one frozen `exec`/`prepare` view of the same connection, without `dispose` or symbolic
cleanup methods. The creating caller retains connection ownership.

Use `host.org(orgId).backend('sqlite')` for a fixed organization. The default and
other organizations share the same tables; creating an organization runs no DDL
and opens no connection. One native admission queue serves them all. Data,
deadlines, locks and revisions remain isolated by `org_id`; `host.dropOrg(orgId)`
removes only that organization's managed rows. Native Features borrow the same
frozen client and their factories install once. Explicit organization views reject
arbitrary SQL and database maintenance, including inside transactions; transaction
failures retain the original error chain.

Every managed table starts with `org_id` in its primary key. Native root SQL is
caller-owned schema access; callers must supply their own organization filters
for custom SQL tables and must not modify internal tables.

## Maintenance

Import `sqliteMaintenanceFeature` only from
`@migaia/storage-plugin-sqlite/features/maintenance` and select it in the
plugin's second argument. It adds `storage.api.maintenance.backup(path)` and
`vacuum()` through the original SQL endpoint; transactions have neither method.
Backup uses `VACUUM INTO` and never pre-deletes or overwrites a target. Native
failure may leave an incomplete output file. Once synchronous native maintenance
starts, cancellation cannot claim that the file was never written.

## Errors and disposal

Package errors carry source `@migaia/storage-plugin-sqlite` and one of
`SQLITE_FAILED`, `TRANSACTION_FAILED`, `DUPLICATE_KEY`, or `DECODE_FAILED`.
Native and codec errors remain reachable through `cause`; rollback cleanup
failure retains the original primary first in `AggregateError.errors`.
Contract validation, cancellation and concurrency use their original contract
codes. Decoding failure never rewrites damaged data.

Repeated explicit `dispose()` calls return one cached Promise. Symbolic
cleanup uses a separate cached Promise, reports failure and completes; both
perform native cleanup once. Dispose the store/host before its caller-owned
connection. A disposed store stays terminal even when cleanup fails.

The standard `sql` token exposes the same native tag as `storage.use(sql).sql`.
Inside transactions, `tx.use(sql).sql` binds the current short view through the original owner.
Native results, exact root row types and SQLite's required `lastInsertRowid` remain intact;
there is no second budget or compiler.

The standard `ttl` capability provides expire, remaining and persist for text, bytes and records
using local Date.now. Deadlines and values share the native transaction; live overwrites retain
deadlines, while deletion, clear and replacement remove them. Reads, enumeration and queries
lazily reclaim expired rows through the original native mutation path without a timer.
The standard `counter.increment` validates canonical decimal text and safe integers before an
atomic native text update. Missing values start at 0; malformed text, invalid deltas and overflow
reject before writing. Both capabilities support tx.use on the original native scope.

Transactions retain the first live value and deadline in their native snapshot. If an observed
deadline expires, the original commit check returns the conflict to the existing concurrency
policy. Iteration skips rows that expire before their first return; close counts include only
rows actually returned.
