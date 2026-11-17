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
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'

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
| Store application log records  | `/plugins/journal` + optional logger    | [Log storage](./USEGUIDE.en.md#open-a-log-store)                             |

## Install

These storage packages are currently `private: true` workspace packages in this repository, not published registry packages. Run this from a consuming package inside the workspace:

```bash
pnpm add --workspace @migaia/storage-host @migaia/storage-contract
```

Memory needs no database client. Install other backends through their own plugins. The optional peers below are needed only when importing `/plugins/journal` (for `storageJournalPlugin`):

```bash
pnpm add --workspace @migaia/log-host @migaia/log-plugin-durable
```

## Common APIs

| API                                          | Purpose                                                            |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `createStorageHost({ plugins, ...options })` | Create a host; environment checks run before it returns by default |
| `host.backend(id)` / `hasBackend(id)`        | Get an installed backend or check a dynamic ID                     |
| `host.use(...plugins)`                       | Add a batch and return a host type that includes it                |
| `host.unUse(id)`                             | Remove one plugin and release it; rejects while it is borrowed     |
| `host.org(uuid)` / `dropOrg(uuid)`           | Obtain an organization view or remove its data from each backend   |
| `host.detect()`                              | Run checks that have not completed successfully                    |
| `host.dispose()`                             | Stop accepting work, wait, and release resources                   |

## Behavior to know

- Plugin IDs must be unique. A batch becomes visible only after every installation succeeds; failed installation releases resources created by that batch. Overlapping `use` and `unUse` calls queue in call order; each starts after the previous one settles, whether it succeeded or failed.
- `autoDetect` defaults to `true`; `installTimeoutMs` defaults to `30000` and limits each plugin's install separately (plugins in one batch are timed individually); `0` disables it. With `autoDetect: false`, call `await host.detect()` before data operations. Operations whose checks are unfinished reject with `UNSUPPORTED_CAPABILITY`. Check newly added backends after `use()` as well.
- The default `org` is the zero UUID. Explicit IDs must be canonical lowercase UUIDs; `createOrgId()` generates one. An organization view cannot install plugins, drop organizations or close the host. `dropOrg()` attempts every backend; successful deletions remain if another fails. `ORG_DELETE_FAILED` exposes the failures through `AggregateError.errors`.
- Capabilities depend on the actual backend instance. A non-default organization does not automatically inherit a custom capability attached only to the root backend; check `has(token)`. Native SQL/SPARQL entry points are unavailable through organization views.
- Explicit `dispose()` rejects on cleanup failure and reuses its Promise on repeated calls. `await using` cleanup reports failures and completes so it does not replace a primary business error. See each backend's guide for closing caller-supplied native clients.
- Host errors use `source: 'storage.host'`. Shared argument and capability errors come from `storage.contract`. Inspect `source`, `code` and `cause` together rather than matching message text.

## Backend authoring entries

Applications that only call `backend()` need no authoring tools. When you implement a backend, runtime tools come from `@migaia/storage-host/sdk`; types, capability tokens, definitions and pure validators come from `@migaia/storage-contract`.

| Use                                          | Entry                                                        |
| -------------------------------------------- | ------------------------------------------------------------ |
| Query creation and condition execution       | `@migaia/storage-host/sdk`                                   |
| Concurrency policy and transaction execution | `@migaia/storage-host/sdk`                                   |
| Key encoding, input snapshots and resources  | `@migaia/storage-host/sdk`                                   |
| Capability publication and value conversion  | `@migaia/storage-host/sdk`                                   |
| SQL, SPARQL and channel tools                | `@migaia/storage-host/sdk`, and the respective channel entry |
| Journal plugin                               | `@migaia/storage-host/plugins/journal`                       |
| Memory backend                               | `@migaia/storage-host/plugins/memory`                        |
| Entity Features                              | `@migaia/storage-host/entity/features/<name>`                |

See [storage-contract](../storage-contract/README.en.md#entries-and-dependency-direction) for full paths and dependencies.

Declare entity plugins with `defineEntityPlugin`; instances are usually named `xxxEntityPlugin`. Pick the Features you need from `/entity/features/*` in its `features` record, install it through the `createStorageHost` plugins or `host.use`, then obtain repositories from `host.extensions[xxxEntityPlugin.name](store)`. Feature installation runs once per entity; repositories reuse installed factory outputs and expire with entity or host disposal. Plugin IDs can differ from the persisted entity namespace. Missing and duplicate roles reject at install. See [entity setup](./USEGUIDE.en.md#use-an-entity-repository).

## Assemble optional capabilities explicitly

The base host does not import the journal runtime, notification controllers or change iterators. Applications select these capabilities, so code that only reads and writes does not bundle them.

Journal configuration goes into `storageJournalPlugin(options)` from `@migaia/storage-host/plugins/journal`, placed in the first `createStorageHost` plugin batch before the backends it records; the host has no separate `journal` option. A configured journal plugin installed later, or passed twice, rejects with `INVALID_CONFIG`. For `storageLogStore()` alone, install `storageJournalPlugin()` without options; missing assembly raises `JOURNAL_NOT_ASSEMBLED`.

Observation events are subscribed only through `storageProbe(handlers)` from `@migaia/storage-host/plugins/probe`; the host has no `hooks` option and no `host.hooks`. A probe in the `createStorageHost` plugins receives events from the first install event of that batch. After installation, `host.extensions.observe(name, handler)` adds a listener and returns its unsubscribe function; on a view of a non-default organization it receives only that organization's events. A host has at most one probe. Listener failures go to `report` and never change storage results.

Memory notifications and feeds use separate Feature roots:

```ts
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { memoryNotificationsFeature } from '@migaia/storage-host/features/memory-notifications'
import { memoryChangeFeedFeature } from '@migaia/storage-host/features/memory-change-feed'

const host = await createStorageHost({
  plugins: [
    memoryBackendPlugin({
      features: {
        notifications: memoryNotificationsFeature(),
        changeFeed: memoryChangeFeedFeature()
      }
    })
  ]
})
await host.dispose()
```

Without the feed Feature, memory reports `capabilities.changeFeed: false` and watch raises `CHANGE_ITERATOR_NOT_ASSEMBLED`. Notifications alone enable `subscribeChanges()`. The feed requires notifications; omitting them raises `CHANGE_CONTROLLER_NOT_ASSEMBLED`. A lightweight lifecycle owner still closes physical resources and drains accepted writes.

Backend authors import the controller factory from `/sdk` and pass it explicitly to `core.createChangeController(options, createBackendChangeController)`. Basic physical resources can use `createBackendLifecycleController` from that entry. Change iterators come from the same `/sdk` entry.

### Strict index queries

`.index(...).requirePushdown()` demands native index execution. Terminal reads reject with `@migaia/storage-contract / QUERY_NOT_PUSHABLE` when an explicit index source plans `fullScan`, or when native preparation contention leaves only a scan.

Install `entityIndexesFeature()` and the backend index Feature when native execution is required. Remove `requirePushdown()` when an authoritative scan is acceptable. Ordinary queries keep their scan fallback.

IndexedDB borrowed views resolve the same private capabilities as their native store. While records in an older format remain, index readiness stays running and queries keep scanning and report the fallback, until conversion completes with the matching schema fingerprint.
