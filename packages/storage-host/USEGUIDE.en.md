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
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'

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
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
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

`defineEntityPlugin` declares an entity plugin. Install it into the storage host, then obtain repositories from its extension. The plugin ID addresses installation and can differ from the persisted entity namespace `name`; two versions of the same namespace need distinct plugin IDs. There is no `defineEntity` alias or declaration `connect` method.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { defineEntityPlugin } from '@migaia/storage-host/entity'

const usersEntityPlugin = defineEntityPlugin<{ id: string; name: string }>()('users', {
  name: 'users',
  key: 'id'
})
const host = await createStorageHost({ plugins: [memoryBackendPlugin(), usersEntityPlugin] })
try {
  const users = host.extensions[usersEntityPlugin.id](host.backend('memory'))
  await users.put({ id: 'u1', name: 'Ada' })
  console.log(await users.get('u1'))
} finally {
  await host.dispose()
}
```

Select query, indexes, unique checks, migration and keyset from their `/entity/features/*` entries. `features` is a record such as `{ lookup: entityQueryFeature() }`; keys are caller-chosen addresses, independent of role and execution order. Feature definitions are opaque native identities with no public name/create/configure fields. Native installation runs once per entity installation and returns repository capability factories; obtaining another repository reuses those factories. Arrays, forged plain units and duplicate roles are rejected. Missing indexes/unique/migration requirements are checked during installation; their original `storage.host / ENTITY_FEATURE_REQUIRED` or `INVALID_CONFIG` errors remain reachable through the install error's cause chain. The host has no `features` option.

Query-only, unique-only configuration, migration-only and query+keyset retain their independent assembly boundaries. Index query planning selects query and indexes; fallback unique checks also need query. No unit implicitly enables another.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { defineEntityPlugin } from '@migaia/storage-host/entity'
import { entityQueryFeature } from '@migaia/storage-host/entity/features/query'
import { entityIndexesFeature } from '@migaia/storage-host/entity/features/indexes'

type IOrder = { id: string; state: string; total: number }
const ordersEntityPlugin = defineEntityPlugin<IOrder>()('orders', {
  name: 'orders',
  key: 'id',
  features: { lookup: entityQueryFeature(), selectors: entityIndexesFeature() },
  indexes: { byState: { path: 'state' } }
})
const host = await createStorageHost({ plugins: [memoryBackendPlugin(), ordersEntityPlugin] })
try {
  const orders = host.extensions[ordersEntityPlugin.id](host.backend('memory'))
  await orders.put({ id: 'o1', state: 'paid', total: 20 })
  console.log(await orders.get('o1'))
  console.log(await orders.query().index('byState', 'paid').select('id', 'total').all())
} finally {
  await host.dispose()
}
```

You can also add an entity with `const installed = await host.use(ordersEntityPlugin)` and use `installed.extensions[ordersEntityPlugin.id](store)`. Each repository borrows the backend; it never closes it. Repository, retained query and iterator access expires when the entity is removed or its host is disposed. Use `orders.in(tx)` inside an original transaction and `orders.batch(...)` for one native record transaction. Schemas/codecs retain their runtime conversion and original causes. Choose index/range once; pair a custom comparator with a finite limit. Dispose a stream when stopping early.

### Persist versioned records

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { defineEntityPlugin } from '@migaia/storage-host/entity'
import { entityMigrationFeature } from '@migaia/storage-host/entity/features/migration'

type IUser = { id: string; name: string }
const originalUsersEntityPlugin = defineEntityPlugin<IUser>()('users-v1', {
  name: 'migration-users',
  key: 'id'
})
const migratedUsersEntityPlugin = defineEntityPlugin<IUser>()('users-v2', {
  name: 'migration-users',
  key: 'id',
  version: 2,
  features: { upgrade: entityMigrationFeature() },
  migrations: {
    2: (previous) => {
      const user = previous as IUser
      return { ...user, name: user.name.trim() }
    }
  }
})
const host = await createStorageHost({
  plugins: [memoryBackendPlugin(), originalUsersEntityPlugin, migratedUsersEntityPlugin]
})
try {
  const store = host.backend('memory')
  const original = host.extensions[originalUsersEntityPlugin.id](store)
  await original.put({ id: 'ada', name: ' Ada ' })
  await original.put({ id: 'lin', name: ' Lin ' })
  const users = host.extensions[migratedUsersEntityPlugin.id](store)
  const result = await users.migrate({ batchSize: 1 })
  console.log(result.migrated, (await users.get('ada'))?.name)
} finally {
  await host.dispose()
}
```

Reading an old record materializes the selected version without writing it back; `migrate()` persists new envelopes. Migration without indexes or unique constraints uses its own original native scan and batches; unique constraints still require the unique unit and fallback query unit.

## Separate organization data

Organization IDs are canonical lowercase UUIDs. Saving an organization view, including extracting one of its methods, keeps that organization fixed.

```ts doc-test=run
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'

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

Install the optional `@migaia/log-host` and `@migaia/log-plugin-durable` peers first. `storageLogStore()` is asynchronous and accepts a host or organization view, a backend ID and a nonempty `prefix`. A plain KV object is not accepted. Append one record, then inspect its sequence and pending state:

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { storageLogStore, storageJournalPlugin } from '@migaia/storage-host/plugins/journal'
import { LogRecordState } from '@migaia/log-plugin-durable'

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

Opening a log does not enable automatic business logging. Configure `createStorageHost({ plugins: [storageJournalPlugin(options), backend] })` for that. `options` supplies `{ logger, namespace, ... }` directly, or is an asynchronous initializer for each organization. The initializer receives `orgId` and asynchronous `storageLogStore(id, { prefix })`. The host borrows the logger and does not shut it down.

Choose binlog, WAL, undo and same-transaction log stores as needed. `atomicBinlog` / `atomicUndo` select real log stores by backend ID and require a shared transaction with the business backend. Other combinations depend on backend support and reject before business mutation when unavailable. Failed external binlog appends are reported without rolling back committed business data. Do not recover unknown results by blindly replaying writes. Undo checks stored data and revisions first; conflicts use `UNDO_CONFLICT`, and missing history uses `UNDO_NOT_FOUND`.

`telemetry: true` additionally requires the logger level plugin. Logs can include operation payloads and errors; configure the logger for the application's needs. Even telemetry-only configuration installs an asynchronous stage, so use asynchronous data methods; synchronous reads and writes reject with `ASYNC_STAGE_IN_SYNC_ENTRY`. Without a `/plugins/journal` import, the host does not load logger at runtime. See the [logger guide](../logger/USEGUIDE.en.md) for logger configuration.

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

The base host does not import journal runtime, notification controllers or change iterators. Previously the host's journal option loaded logging automatically and memory enabled notifications and watch by default. Applications now select these capabilities so basic reads and writes do not include unused code.

Journal configuration goes into `storageJournalPlugin(options)` from `@migaia/storage-host/plugins/journal`, placed in the first `createStorageHost` plugin batch before the backends it records; the host has no separate `journal` option. A configured journal plugin installed later, or passed twice, rejects with `INVALID_CONFIG`. For `storageLogStore()` alone, install `storageJournalPlugin()` without options; missing assembly raises `JOURNAL_NOT_ASSEMBLED`. Journal configuration, stored records and transaction semantics retain their existing contract.

`host.unUse(id)` removes one installed plugin: its backend, extension methods and probe listeners are withdrawn first, then its resources are released in reverse order. While another plugin borrows the backend (for example a cache tier) it rejects with `BACKEND_IN_USE`; remove the borrower first. An unknown id rejects with `BACKEND_NOT_INSTALLED`, a removal issued during an install runs after it, and a configured journal plugin with `INVALID_CONFIG`. The same id can be installed again afterwards; call `detect()` as usual.

Observation events are subscribed only through `storageProbe(handlers)` from `@migaia/storage-host/plugins/probe`; the host has no `hooks` option and no `host.hooks`. A probe in the `createStorageHost` plugins receives events from the first install event of that batch. After installation, `host.extensions.observe(name, handler)` adds a listener and returns its unsubscribe function; on a view of a non-default organization it receives only that organization's events. A host has at most one probe. Listener failures go to `report` and never change storage results.

Memory notifications and feeds use separate Feature roots:

```ts
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
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

Backend authors import the controller factory from `/sdk` and pass it explicitly to `core.createChangeController(options, createBackendChangeController)`. Basic physical resources can use `createBackendLifecycleController` from that entry. Change iterators come from the same `/sdk` entry.

### Strict index query migration

Previously, `.index(...).requirePushdown()` allowed a full scan when no client steps remained. Terminal reads now reject `@migaia/storage-contract / QUERY_NOT_PUSHABLE` when an explicit index source plans `fullScan`, or native preparation contention leaves only a scan.

Install `entityIndexesFeature()` and the backend index Feature when native execution is required. Remove `requirePushdown()` when an authoritative scan is acceptable. Ordinary queries retain their scan fallback.

IndexedDB borrowed views resolve the same private capabilities as their native store. Legacy records keep readiness running until migration completes with the matching schema fingerprint. Queries continue to scan and report fallback while readiness is not complete.

When no migration metadata exists, a backfill that starts from the canonical beginning and finishes both scan phases may become complete only if it observes no legacy records and skips no invalid entity records. Current-format records can then use the native cursor without `entityMigrationFeature()`.

Legacy records, including canonical shadows, and skipped invalid records keep readiness running; ordinary queries scan and report fallback, while explicit indexed strict queries reject `QUERY_NOT_PUSHABLE`. Resuming from a persisted checkpoint does not prove the earlier scan was clean. Existing migration metadata still requires status complete and the matching schema fingerprint.
