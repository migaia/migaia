# storage-host usage guide

[中文](./USEGUIDE.md) · [Overview and installation](./README.en.md)

| Your task                                          | Start here                                                          |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| Store data, then add another backend               | [Install and add backends](#install-and-add-backends)               |
| Commit several writes together                     | [Transactions and record queries](#transactions-and-record-queries) |
| Read and query objects by their primary key        | [Use an entity repository](#use-an-entity-repository)               |
| Keep the same key separate for each organization   | [Separate organization data](#separate-organization-data)           |
| Store application log records                      | [Open a log store](#open-a-log-store)                               |
| Handle installation, callback or shutdown failures | [Handle errors and finish work](#handle-errors-and-finish-work)     |

## Install and add backends

Put initial plugins in `plugins`. A later `use()` returns a host type that includes the new backends. Both references share one lifetime; close either host reference once.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'

const original = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'session' })]
})
try {
  const host = await original.use(memoryBackendPlugin({ id: 'drafts' }))
  await host.detect()
  await host.backend('session').set('user', 'ada')
  await host.backend('drafts').set('title', 'First draft')
  console.log(await host.backend('session').get('user')) // ada
  console.log(await host.backend('drafts').get('title')) // First draft
} finally {
  await original.dispose()
}
```

Plugins in one batch cannot borrow each other's unpublished backends. Install base backends first, then install a cache, archive or other composed plugin with `use()`. IDs must be unique throughout the host.

`autoDetect` defaults to `true`. Set it to `false` when configuration must finish before checks, then explicitly call `detect()`. Concurrent checks share their Promise; successful checks are cached and failed checks can be retried. `installTimeoutMs` bounds the entire install batch in milliseconds, defaults to `30000`, and accepts finite nonnegative numbers. Failed installation rolls back that batch's resources without deleting previously installed backends.

## Transactions and record queries

The memory backend can write strings, bytes and records in one transaction. A failed callback does not commit its draft. Obtain queries through the `records` capability; this example reads committed data after the transaction finishes.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { records } from '@migaia/storage-contract'

type IOrder = { state: string; total: number }
const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
try {
  const memory = host.backend('memory')
  await memory.transaction(async (tx) => {
    await tx.set('status', 'ready')
    await tx.setBytes('receipt', new Uint8Array([1, 2]))
    await tx.putRecord({ state: 'paid', total: 20 }, 'order-1')
  })
  console.log(await memory.get('status')) // ready
  const rows = await memory
    .use(records)
    .query<IOrder>()
    .where({ state: 'paid' })
    .select('total')
    .all()
  console.log(rows) // [{ total: 20 }]
} finally {
  await host.dispose()
}
```

Memory filters records on the client. With a database backend, pushdown and transaction scope depend on that backend. Conflict handling may replay a transaction callback. Keep email, payments and other effects that cannot roll back outside it.

Strings, bytes and records have channel-conflict rules for the same logical key. Choose the appropriate write policy when replacing another channel. Do not treat these channels as unrelated key spaces. Duplicate batch-write keys reject before commit; duplicate deletion keys count once.

## Use an entity repository

`/entity` provides definition, connection and basic reads/writes. Optional operations require explicit subpath units. Missing units throw `ENTITY_FEATURE_REQUIRED` with `source: @migaia/storage-host` and name the required import.

```ts
import { defineEntity } from '@migaia/storage-host/entity'
const users = defineEntity<{ id: string; name: string }>({ name: 'users', key: 'id' }).connect(
  store
)
await users.put({ id: 'u1', name: 'Ada' })
console.log(await users.get('u1'))
```

Select only required units in `features`: `entityQueryFeature()` from `/entity/query` adds query/list/stream; `entityIndexesFeature()` from `/entity/indexes` adds index declaration/planning; `entityUniqueFeature()` from `/entity/unique` adds unique commit checks; `entityMigrationFeature()` from `/entity/migration` adds version plans and persisted migration; `entityKeysetFeature()` from `/entity/keyset` admits page/after. Index, unique and persisted migration paths reuse query operations, so also declare query for those paths. Units never enable another unit implicitly.

The unique unit captures its own constraint projections without enabling index planning. Unique write checks alone do not require the indexes unit.

`defineEntity<T>()({...})` declares an object's primary key and indexes. `connect(store)` attaches it to a backend. This example writes first, then queries through the same definition.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { entityQueryFeature } from '@migaia/storage-host/entity/query'
import { entityIndexesFeature } from '@migaia/storage-host/entity/indexes'

type IOrder = { id: string; state: string; total: number }
const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
try {
  const orders = defineEntity<IOrder>()({
    name: 'orders',
    key: 'id',
    features: [entityQueryFeature(), entityIndexesFeature()],
    indexes: { byState: { path: 'state' } }
  }).connect(host.backend('memory'))
  await orders.put({ id: 'o1', state: 'paid', total: 20 })
  console.log(await orders.get('o1'))
  console.log(await orders.query().index('byState', 'paid').select('id', 'total').all())
  // [{ id: 'o1', total: 20 }]
} finally {
  await host.dispose()
}
```

The repository does not close its backend. Use `orders.in(tx)` inside a transaction; `orders.batch(...)` uses one native record transaction. Schemas and codecs perform runtime validation and conversion; TypeScript types alone do not validate external input. `fromStandardSchema` is available from the same `/entity` entry. Conversion failures retain the original error through `cause`.

Select `index` or `range` first and only once. `where`, `select`, `skip` and `limit` create new query branches. Pair custom comparators with a finite `limit`, or use `first()`. `stream()` returns a disposable iterator; use `await using` or explicit `dispose()` if stopping early. When available, `watch()` supplies invalidation notifications, not result rows or reliable replay. Transaction queries do not expose `watch()`.

## Separate organization data

Organization IDs are canonical lowercase UUIDs. Saving an organization view, including extracting one of its methods, keeps that organization fixed.

```ts doc-test=run
import { createStorageHost, createOrgId, memoryBackendPlugin } from '@migaia/storage-host'

const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
try {
  const orgA = createOrgId()
  const orgB = createOrgId()
  const a = host.org(orgA).backend('memory')
  const b = host.org(orgB).backend('memory')
  await a.set('name', 'Ada')
  await b.set('name', 'Lin')
  console.log(await a.get('name'), await b.get('name')) // Ada Lin
  await host.dropOrg(orgA)
  console.log(await b.get('name')) // Lin
} finally {
  await host.dispose()
}
```

Without an `org` option, the root backend uses the zero UUID. Each memory plugin instance is independent even if namespaces match. Organization views provide business operations without installation or shutdown methods. `dropOrg()` attempts every backend; a failure does not reverse successful deletions elsewhere. Inspect the aggregate error rather than treating organization deletion as a cross-backend transaction.

A non-default organization receives the capabilities its backend actually provides. A custom capability on the root backend is not copied automatically; Feature `api` methods are routed through the organization view. Native SQL/SPARQL entry points do not support organization views; use the relevant organized data APIs.

## Open a log store

Install the optional `@migaia/logger` peer first. `storageLogStore()` is asynchronous and accepts a host or organization view, a backend ID and a nonempty `prefix`. A plain KV object is not accepted. Append one record, then inspect its sequence and pending state:

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { storageLogStore, storageJournalPlugin } from '@migaia/storage-host/journal'
import { LogRecordState } from '@migaia/logger/plugins/durable'

const host = await createStorageHost({ plugins: [storageJournalPlugin(), memoryBackendPlugin()] })
try {
  const log = await storageLogStore(host, 'memory', { prefix: 'history' })
  try {
    await log.append([{ kind: 'order.created', payload: { id: 'o1' } }])
    await log.setState(1, LogRecordState.done)
    console.log(await log.lastSeq()) // 1
    console.log(await log.states(LogRecordState.pending)) // []
  } finally {
    await log.dispose()
  }
} finally {
  await host.dispose()
}
```

Log records are separate from business keys. Business enumeration, clear and capacity limits do not touch them. A backend must support the required log storage; opening it first recovers confirmed state. Exclusive storage permits one open handle for an organization and prefix, while shared transactional storage may permit several. Truncation does not reuse sequence numbers. An unconfirmed write stops further operations: close and reopen the log to recover. Old log handles reject with `STORE_DISPOSED` after `dropOrg()`.

Opening a log does not enable automatic business logging. Configure `createStorageHost({ plugins: [storageJournalPlugin(), backend], journal: ... })` for that. Supply `{ logger, namespace, ... }` directly, or use an asynchronous initializer for each organization. The initializer receives `orgId` and asynchronous `storageLogStore(id, { prefix })`. The host borrows the logger and does not shut it down.

Choose binlog, WAL, undo and same-transaction log stores as needed. `atomicBinlog` / `atomicUndo` select real log stores by backend ID and require a shared transaction with the business backend. Other combinations depend on backend support and reject before business mutation when unavailable. Failed external binlog appends are reported without rolling back committed business data. Do not recover unknown results by blindly replaying writes. Undo checks stored data and revisions first; conflicts use `UNDO_CONFLICT`, and missing history uses `UNDO_NOT_FOUND`.

`telemetry: true` additionally requires the logger level plugin. Logs can include operation payloads and errors; configure the logger for the application's needs. Even telemetry-only configuration installs an asynchronous stage, so use asynchronous data methods; synchronous reads and writes reject with `ASYNC_STAGE_IN_SYNC_ENTRY`. With neither journal configuration nor a `/journal` import, the host does not load logger at runtime. See the [logger guide](../logger/USEGUIDE.en.md) for logger configuration.

## Handle errors and finish work

Business failures reject the operation's Promise. Observer and reporting-callback failures do not change completed data operations. Use `report(error)` for these diagnostics and inspect `source`, `code` and the original `cause`.

| Situation                                                | Action                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| `BACKEND_NOT_INSTALLED`, `INVALID_CONFIG`, duplicate IDs | Fix installation order, IDs or configuration                             |
| `UNSUPPORTED_CAPABILITY`                                 | Check detection status and whether the backend supports this combination |
| `SERIALIZE_FAILED` / `DESERIALIZE_FAILED`                | Inspect schemas, codecs and original input errors in cause               |
| `WRITE_CONFLICT` / lock rejection                        | Follow backend concurrency policy; do not replay external effects        |
| `ORG_DELETE_FAILED`                                      | Inspect each failure and determine which deletions completed             |

Explicit `host.dispose()` waits for work already started, preserves cleanup failures and reuses its Promise. `await using host = ...` also releases resources, but reports cleanup failures instead of replacing an outer primary error. Finish reading data and consuming iterators before shutdown; do not continue using saved handles afterwards.

For backend implementations, see the [README migration table](./README.en.md#moving-backend-authoring-imports) and [contract entry table](../storage-contract/README.en.md#entries-and-dependency-direction).

## Assemble optional capabilities explicitly

The base host does not import journal runtime, notification controllers or change iterators. Previously journal options loaded logging automatically and memory enabled notifications and watch by default. Applications now select these capabilities so basic reads and writes do not include unused code.

Before using journal options or `storageLogStore()`, import `storageJournalPlugin()` from `@migaia/storage-host/journal` and place it before the backend in the same plugin list. Missing assembly raises `JOURNAL_NOT_ASSEMBLED`. Journal configuration, stored records and transaction semantics retain their existing contract.

Memory notifications and feeds use separate Feature roots:

```ts
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { memoryNotificationsFeature } from '@migaia/storage-host/features/memory-notifications'
import { memoryChangeFeedFeature } from '@migaia/storage-host/features/memory-change-feed'

const host = await createStorageHost({
  plugins: [
    memoryBackendPlugin(undefined, {
      notifications: memoryNotificationsFeature(),
      changeFeed: memoryChangeFeedFeature()
    })
  ]
})
await host.dispose()
```

Without the feed Feature, memory reports `capabilities.changeFeed: false` and watch raises `CHANGE_ITERATOR_NOT_ASSEMBLED`. Notifications alone enable `subscribeChanges()`. The feed requires notifications; omitting them raises `CHANGE_CONTROLLER_NOT_ASSEMBLED`. A lightweight lifecycle owner still closes physical resources and drains accepted writes.

Backend authors import the controller factory from `/authoring/change-controller` and pass it explicitly to `core.createChangeController(options, createBackendChangeController)`. Basic physical resources can use `createBackendLifecycleController` from that entry. Import change iterators from `/authoring/change-iterator`; `/authoring/backend` no longer re-exports them.
