# @migaia/storage-host

Bring memory, database and file backends into one storage host, select each through typed `backend(id)` calls, and finish storage work with one cleanup entry point. Use it when an application needs several data sources, organization isolation or transactions: install the relevant plugins, then select the capabilities each backend provides. Writes across separate backends do not automatically form one atomic transaction.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Problems you may have seen

- A database connection closes while subscriptions or queued work are still running: there is no shared shutdown point.
- Two instances both use the name `cache`, and a string lookup finds the wrong one: installation types were lost.
- A missed tenant prefix exposes another organization's key: isolation depends on every caller remembering the convention.
- Updating a string and a record leaves only one write committed: separate calls were used instead of a transaction.

## Why choose it

- `backend(id)` retains the installed plugin's concrete type. Duplicate IDs are rejected during installation. [Install backends](./USEGUIDE.en.md#install-and-add-backends)
- The included memory backend stores strings, bytes and records, with transactions across those channels. [Transactions](./USEGUIDE.en.md#transactions-and-record-queries)
- `org(id)` keeps one organization fixed when passed to entities or composed plugins. [Organization data](./USEGUIDE.en.md#separate-organization-data)
- `dispose()` waits for work already started and releases installed resources. Organization views cannot close the whole host. [Shutdown](./USEGUIDE.en.md#handle-errors-and-finish-work)

## Start here

Write an order status to memory, then read it from the same backend. This example uses a TypeScript environment with top-level `await`.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'

const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
try {
  const memory = host.backend('memory')
  await memory.set('order:1:status', 'paid')
  console.log(await memory.get('order:1:status')) // paid
} finally {
  await host.dispose()
}
```

Expected output:

```text
paid
```

Memory data belongs to this instance. Creating another host does not restore it.

## Pitfalls when writing it yourself

A Map handles local storage, but organization isolation and asynchronous shutdown need additional agreements:

```ts doc-test=check
const values = new Map<string, string>()
values.set('order:1:status', 'paid') // Organizations share this unqualified key.
console.log(values.get('order:1:status'))
values.clear() // This cannot wait for other asynchronous storage work.
```

Use a Map for local data. Add the host when the application needs multiple backends, transactions or coordinated cleanup.

## The three-minute model

`createStorageHost → install plugins → backend(id) → read/write → dispose()`.

| Name         | What it does                                                                               |
| ------------ | ------------------------------------------------------------------------------------------ |
| Host         | Keeps backend registrations and runs installation, checks and shutdown                     |
| Backend      | Stores the data: memory, SQLite or object storage, for example                             |
| Capability   | A supported family of operations; check `has(token)`, then obtain `use(token)`             |
| Feature      | An extra API explicitly selected during installation, available through `store.api`        |
| Organization | A business view with one fixed UUID, isolated from other organizations using the same keys |

## Common scenarios

| Need                           | Composition                             | Example                                                                      |
| ------------------------------ | --------------------------------------- | ---------------------------------------------------------------------------- |
| Temporary application state    | host + memory                           | [Install and add](./USEGUIDE.en.md#install-and-add-backends)                 |
| Commit several writes together | memory transaction                      | [Transactions and queries](./USEGUIDE.en.md#transactions-and-record-queries) |
| Store and query keyed objects  | `/entity` + memory or a records backend | [Entities](./USEGUIDE.en.md#use-an-entity-repository)                        |
| Serve several organizations    | `host.org(id)`                          | [Organization data](./USEGUIDE.en.md#separate-organization-data)             |
| Store application log records  | `/journal` + optional logger            | [Log storage](./USEGUIDE.en.md#open-a-log-store)                             |

## Install

These storage packages are currently `private: true` workspace packages in this repository, not published registry packages. Run this from a consuming package inside the workspace:

```bash
pnpm add --workspace @migaia/storage-host @migaia/storage-contract
```

Memory needs no database client. Install other backends through their own plugins. The optional peer below is needed only when configuring `journal` or importing `/journal`:

```bash
pnpm add --workspace @migaia/logger
```

## Common APIs

| API                                          | Purpose                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `createStorageHost({ plugins, ...options })` | Create a host; environment checks run before it returns by default |
| `host.backend(id)` / `hasBackend(id)`        | Get an installed backend or check a dynamic ID                     |
| `host.use(...plugins)`                       | Add a batch and return a host type that includes it                |
| `host.org(uuid)` / `dropOrg(uuid)`           | Obtain an organization view or remove its data from each backend   |
| `host.detect()`                              | Run checks that have not completed successfully                    |
| `host.dispose()`                             | Stop accepting work, wait, and release resources                   |

## Behavior to know

- Plugin IDs must be unique. A batch becomes visible only after every installation succeeds; failed installation releases resources created by that batch. Overlapping batches reject with `STORAGE_HOST_BUSY`.
- `autoDetect` defaults to `true`; `installTimeoutMs` defaults to `30000`. With `autoDetect: false`, call `await host.detect()` before data operations. Operations whose checks are unfinished reject with `UNSUPPORTED_CAPABILITY`. Check newly added backends after `use()` as well.
- The default `org` is the zero UUID. Explicit IDs must be canonical lowercase UUIDs; `createOrgId()` generates one. An organization view cannot install plugins, drop organizations or close the host. `dropOrg()` attempts every backend; successful deletions remain if another fails. `ORG_DELETE_FAILED` exposes the failures through `AggregateError.errors`.
- Capabilities depend on the actual backend instance. A non-default organization does not automatically inherit a custom capability attached only to the root backend; check `has(token)`. Native SQL/SPARQL entry points are unavailable through organization views.
- Explicit `dispose()` rejects on cleanup failure and reuses its Promise on repeated calls. `await using` cleanup reports failures and completes so it does not replace a primary business error. See each backend's guide for closing caller-supplied native clients.
- Host errors use `source: '@migaia/storage-host'`. Shared argument and capability errors come from `@migaia/storage-contract`. Inspect `source`, `code` and `cause` together rather than matching message text.

## Moving backend authoring imports

Applications that only call `backend()` do not need authoring tools. Backend implementations now import runtime tools from these entries; types, capability tokens, definitions and pure validators remain in contract.

Paths beginning `/authoring/...` below are prefixed with `@migaia/storage-host`.

| Former contract runtime use                  | Current entry                                                           |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Query creation and condition execution       | `@migaia/storage-host/authoring/query`                                  |
| Concurrency policy and transaction execution | `/authoring/concurrency`, `/authoring/transaction`                      |
| Key encoding, input snapshots and resources  | `/authoring/key`, `/authoring/context`, `/authoring/resource`           |
| Capability publication and value conversion  | `/authoring/capability`, `/authoring/codec`                             |
| SQL, SPARQL and channel tools                | `/authoring/sql`, `/authoring/sparql`, and the respective channel entry |

See [storage-contract](../storage-contract/README.en.md#entries-and-dependency-direction) for full paths and dependencies. The old contract root no longer exports these runtime tools.

Entity assembly changes: `/entity` provides basic reads/writes. Previously automatic query, indexes, unique checks, migration and keyset now require their own `/entity/*` units in `features`. Import only the units used by the application; missing units throw `ENTITY_FEATURE_REQUIRED`. See [entity setup](./USEGUIDE.en.md#use-an-entity-repository).

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

### Strict index query migration

Previously, `.index(...).requirePushdown()` allowed a full scan when no client steps remained. Terminal reads now reject `@migaia/storage-contract / QUERY_NOT_PUSHABLE` when an explicit index source plans `fullScan`, or native preparation contention leaves only a scan.

Install `entityIndexesFeature()` and the backend index Feature when native execution is required. Remove `requirePushdown()` when an authoritative scan is acceptable. Ordinary queries retain their scan fallback.

IndexedDB borrowed views resolve the same private capabilities as their native store. Legacy records keep readiness running until migration completes with the matching schema fingerprint. Queries continue to scan and report fallback while readiness is not complete.
