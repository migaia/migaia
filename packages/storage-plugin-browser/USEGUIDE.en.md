# `@migaia/storage-plugin-browser` Usage guide

Use the selected browser plugin with the real host. The examples require native browser APIs; an injected port does not turn a Node process into a browser.

## Own named browser backends

```ts
import { createStorageHost } from '@migaia/storage-host'
import { localStorageBackendPlugin } from '@migaia/storage-plugin-browser/local-storage'

const host = await createStorageHost({
  plugins: [localStorageBackendPlugin({ id: 'preferences', namespace: 'my-app' })]
})
try {
  const preferences = host.backend('preferences')
  await preferences.set('theme', 'dark')
  console.log(await preferences.get('theme'))
} finally {
  await host.dispose()
}
```

Installation completes preparation before publishing stores. Reuse a plugin definition to create separate owned installations; do not share a store already owned by another host. Use explicit IDs when installing the same kind more than once. Repeated disposal shares its completion Promise, and closed stores cannot be reopened.

## Web Storage options

| Option           | Default and behavior                                              |
| ---------------- | ----------------------------------------------------------------- |
| `namespace`      | `default`; nonempty logical data namespace                        |
| `namespaceCodec` | `lengthPrefixedNamespaceCodec`; encodes namespace and logical key |
| `storage`        | native `globalThis.localStorage` or `globalThis.sessionStorage`   |
| `id`             | `local` or `session`; selects the host registration               |

A supplied Storage port must implement `length`, `getItem`, `setItem`, `removeItem`, `key`, and `clear`. Installation probes availability while preserving existing data. Refused host access yields `BACKEND_UNAVAILABLE`; invalid configuration yields `INVALID_CONFIG`. Native quota failure yields `QUOTA_EXCEEDED`. The advertised 5 MiB limit is an estimate, not a browser quota guarantee.

The default namespace codec uses a UTF-8 length prefix, for example `sw1:3:app:theme`. Its decoder skips malformed or foreign entries. A custom codec owns collision avoidance and format migration. `clearValues` snapshots matching physical keys before deleting them; a native failure can leave a partial clear and retains the failing key.

## Cookie scope and expiry

```ts
import { createStorageHost } from '@migaia/storage-host'
import { cookieBackendPlugin } from '@migaia/storage-plugin-browser/cookies'

const host = await createStorageHost({
  plugins: [
    cookieBackendPlugin({
      namespace: 'my-app',
      scope: { path: '/', sameSite: 'lax', secure: true }
    })
  ]
})
try {
  const cookies = host.backend('cookies')
  await cookies.set('theme', 'dark', { maxAge: 3600 })
  console.log(await cookies.get('theme'))
  await cookies.remove('theme')
} finally {
  await host.dispose()
}
```

`namespace` defaults to `default`; `document` defaults to `globalThis.document`. Scope defaults to `{ path: '/' }` and remains fixed for all writes and deletes. A supplied domain must be nonempty and contain no whitespace or semicolons. `sameSite: 'none'` and `partitioned: true` require `secure: true`.

Write options accept a valid `expires: Date` or integer `maxAge`. Expired writes delete the cookie. The 4096-byte bound covers the complete assignment, including attributes. A same-name cookie visible in several scopes yields `COOKIE_SCOPE_AMBIGUOUS`; a normal write that is not visible afterwards yields `WRITE_FAILED`. JS cannot observe HttpOnly entries or guarantee server-side deletion.

## Explicit IndexedDB assembly and migration

`indexedDbBackendPlugin` installs basic text, bytes, records and native transactions. Native indexes/backfill, TTL, KV batches, journal images and undo, post-commit notifications, and change feeds each require their own Feature. Previously these capabilities were automatic. This intentional behavior change lets applications control browser output: an undeclared Feature is not imported by the basic backend entry. Migrate existing applications by selecting each capability they actually use. Basic reads and writes need no additional declaration.

```ts
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '@migaia/storage-plugin-browser/indexed-db'
import { indexedDbIndexesFeature } from '@migaia/storage-plugin-browser/features/indexed-db-indexes'
import { indexedDbKeysetFeature } from '@migaia/storage-plugin-browser/features/indexed-db-keyset'
import { indexedDbTtlFeature } from '@migaia/storage-plugin-browser/features/indexed-db-ttl'
import { indexedDbBatchFeature } from '@migaia/storage-plugin-browser/features/indexed-db-batch'
import { indexedDbJournalFeature } from '@migaia/storage-plugin-browser/features/indexed-db-journal'
import { indexedDbNotificationsFeature } from '@migaia/storage-plugin-browser/features/indexed-db-notifications'
import { indexedDbChangeFeedFeature } from '@migaia/storage-plugin-browser/features/indexed-db-change-feed'

const host = await createStorageHost({
  plugins: [
    indexedDbBackendPlugin(
      { dbName: 'my-app' },
      {
        indexes: indexedDbIndexesFeature(),
        keyset: indexedDbKeysetFeature(),
        ttl: indexedDbTtlFeature(),
        batch: indexedDbBatchFeature(),
        journal: indexedDbJournalFeature(),
        notifications: indexedDbNotificationsFeature(),
        changeFeed: indexedDbChangeFeedFeature()
      }
    )
  ]
})
try {
  await host.backend('indexed-db').set('theme', 'dark')
} finally {
  await host.dispose()
}
```

Select only required entries. Change feeds require an explicitly selected notifications Feature; they never install that prerequisite implicitly. IndexedDB `.live()` through `reactiveFeature` also requires notifications and reports a coded missing-assembly error instead of switching to polling.

Memory `.live()` likewise requires explicit `memoryNotificationsFeature()` and rejects with `@migaia/storage-host / CHANGE_CONTROLLER_NOT_ASSEMBLED` before allocating an adapter or query when absent. Calling an undeclared batch, journal, notification or change-feed entry reports `@migaia/storage-plugin-browser / INDEXED_DB_FEATURE_NOT_INSTALLED` and identifies the required Feature.

Without TTL, the canonical capability owner rejects `store.use(ttl)` with `@migaia/storage-contract / UNSUPPORTED_CAPABILITY`, identifying `ttl`. Basic `capabilities.secondaryIndexes`, `capabilities.batch` and `capabilities.changeFeed` are false. Selected change feeds still require the original native realm/BroadcastChannel admission.

Keep the TTL Feature when reopening a database that uses deadlines; basic reads do not interpret expiry metadata. A client without TTL clears inherited deadlines in the same native transaction when overwriting, deleting or clearing targets. Replacement values remain unlimited and another TTL client cannot remove them using the old deadlines.

`indexedDbJournalFeature()` supplies native images, private log namespaces and undo. Global capture additionally requires `storageJournalPlugin()` from `@migaia/storage-host/plugins/journal`, explicitly installed before the backend in the same plugin list, plus the original `journal` configuration.

Journal images read and restore existing physical deadlines without enabling TTL expiry policy. Basic writes retain physical mutation versions and tombstones so another journal-enabled instance can detect update/delete/recreate conflicts; they capture no images and create no log.

## KV batches and typed keys

Use `store.use(kv)` for `getMany(keys)`, `setMany(entries)`, `removeMany(keys)`, and `removeByPrefix(prefix)`. Each nonempty IndexedDB batch enters one pipeline and one native transaction; a later channel conflict rolls back the complete batch. Reads retain duplicate positions and `undefined` missing values. Removal counts a canonical key once. Duplicate canonical write keys reject before any I/O, and `ttlMs` requires the TTL capability. Empty batches return without pipeline, hooks, or native requests.

Text Web backends use synchronous native reads for `getMany`; Cookie reads one visible header snapshot. Without WAL, multi-key writes and prefix deletion reject with `UNSUPPORTED_CAPABILITY` before mutation. A loop over public `set` calls is not an atomic batch.

The default namespace codec retains the original string `sw1` layout and gives non-string batch keys a separate top-level `sw2` layout using the shared canonical key codec. Every old string key remains distinct from a typed key. `keys()` retains `string[]`; namespace clear removes both layouts. A custom `INamespaceCodec` can add `encodeStorageKey(namespace,key)` and `decodeStorageKey(namespace,physicalKey)`. Provide both and keep all key types collision-free. Without this pair, new non-string batch reads reject before native I/O while original string data and calls remain unchanged.

## Native IndexedDB transactions

```ts
import { createStorageHost } from '@migaia/storage-host'
import { kv, records } from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '@migaia/storage-plugin-browser/indexed-db'
import { indexedDbBatchFeature } from '@migaia/storage-plugin-browser/features/indexed-db-batch'

const host = await createStorageHost({
  plugins: [indexedDbBackendPlugin({ dbName: 'my-app' }, { batch: indexedDbBatchFeature() })]
})
try {
  const store = host.backend('indexed-db')
  await store.transaction(async (scope) => {
    await scope.use(kv).setMany([
      { key: ['settings', 'theme'], value: 'dark' },
      { key: ['settings', 'language'], value: 'en' }
    ])
    await scope.setBytes('avatar', new Uint8Array([1, 2]))
    await scope.putRecord({ id: 'a', name: 'Ada' }, ['users', 'a'])
    console.log(await scope.use(records).query().all())
  })
} finally {
  await host.dispose()
}
```

`dbName` defaults to `storage-plugin-browser`; `kvStoreName`, `bytesStoreName`, and `recordsStoreName` default to `kv`, `bytes`, and `records`. Names must be nonempty, distinct, and avoid reserved internal stores. `factory` and `keyRange` default to `globalThis.indexedDB` and `globalThis.IDBKeyRange`. Optional `owner.label` is diagnostic metadata, never a lock identity.

The host opens and prepares the selected database before publication. Missing internal stores are created by a native version upgrade. `onversionchange` closes the old connection. A blocked open rejects instead of publishing an unprepared backend. `cleanupLegacyRecords` defaults to `false`; enabling it removes the legacy store only after successful migration.

A transaction scope covers text, bytes, records, and index maintenance in one original native transaction. `scope.use(kv)` adds structured-key batch methods; `scope.use(records)` exposes queries and bounded prefix removal. Root text keys remain strings. Record and scoped text keys follow `IStorageKey` from `@migaia/storage-contract`, including number, Date, ArrayBuffer, and nested arrays.

Await only native operations and activity-preserving microtasks within the callback. A timer or network wait can end the native activity window. A later method then fails `TRANSACTION_FAILED` with the native cause; catching that method failure does not turn the transaction into a commit. Scope methods lose admission when the callback closes. Finalizers use separate authentic views of the same transaction. Accepted operations, iterators, callbacks, and finalizers drain before resource release.

`setBytes` snapshots input bytes. Record writes use structured cloning and reject unsupported values with `SERIALIZE_FAILED`. Native completion precedes notification. A listener failure is reported and cannot undo a committed write.

## Entity repositories

Basic `defineEntity` supplies definition, connection and reads/writes. Select `entityQueryFeature()` from `@migaia/storage-host/entity/features/query` in the definition's `features` array for queries; `entityUniqueFeature()` from `/entity/features/unique` for uniqueness; `entityMigrationFeature()` from `/entity/features/migration` for migration; `entityIndexesFeature()` from `/entity/features/indexes` for index planning; and `entityKeysetFeature()` from `/entity/features/keyset` for keyset pages. Index queries combine query and indexes; pages combine query and keyset. Native IndexedDB indexes also require the backend's `indexedDbIndexesFeature()`. Each selection is explicit.

Import the neutral repository owner from `@migaia/storage-host/entity` and connect it to the actual installed IndexedDB store.

```ts
import { createStorageHost } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { indexedDbBackendPlugin } from '@migaia/storage-plugin-browser/indexed-db'

type IUser = { id: string; name: string }
const host = await createStorageHost({
  plugins: [indexedDbBackendPlugin({ dbName: 'my-app' })]
})
try {
  const users = defineEntity<IUser>({ name: 'users', key: 'id' }).connect(
    host.backend('indexed-db')
  )
  await users.put({ id: 'a', name: 'Ada' })
  console.log(await users.get('a'))
} finally {
  await host.dispose()
}
```

The host entity module owns schemas, versioned envelopes, migration, and projection. Ordinary reads materialize the declared version without writing it back; explicit `migrate()` performs persistence. Native secondary-index readiness is checked on the actual current transaction snapshot. Unique writes require a real record transaction or the native atomic value-commit endpoint registered by the backend during installation with `core.registerValueCommit`. Built-in browser backends provide the required path. Custom value-only backends without that endpoint reject unique `put` and `migrate` with `UNSUPPORTED_CAPABILITY` before schema work or mutation; ordinary KV access remains available. A `sync` projection alone does not provide cross-page atomicity.

## Optional live queries

Install `@migaia/reactive` explicitly when using the following example. Pass Features as the backend plugin’s second argument.

```ts
import { createRuntime } from '@migaia/reactive'
import { records } from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-host'
import {
  indexedDbBackendKind,
  indexedDbBackendPlugin
} from '@migaia/storage-plugin-browser/indexed-db'
import { reactiveFeature } from '@migaia/storage-plugin-browser/features/reactive'
import { indexedDbNotificationsFeature } from '@migaia/storage-plugin-browser/features/indexed-db-notifications'

const runtime = createRuntime()
const host = await createStorageHost({
  plugins: [
    indexedDbBackendPlugin(
      { dbName: 'my-app' },
      {
        notifications: indexedDbNotificationsFeature(),
        reactive: reactiveFeature(indexedDbBackendKind)
      }
    )
  ]
})
try {
  const store = host.backend('indexed-db')
  const live = store.use(records).query<{ name: string }>().live({ runtime })
  try {
    await live.ready
    console.log(live.state.value)
    await live.refresh()
  } finally {
    await live.dispose()
  }
} finally {
  await host.dispose()
}
```

`ready` observes initial work, `refresh()` joins active work or requests a new generation, and `state` is a readonly computed. `keepPreviousData` defaults to `true`; `equals` defaults to no suppression. Optional `scope` and `matches` filter invalidations; predicate failures report and refresh conservatively. `timeoutMs` applies per generation, while `signal` cancels the query lifetime. Cleanup leaves the caller-owned Runtime usable.

Sources are eventual and preserve native visibility. Local/session/cookie/IndexedDB use hybrid invalidation with 1000 ms reconciliation; memory from `storage.host` uses instance-local push without polling. No source promises immediate capture of arbitrary external writes.

## Errors and shutdown

Inspect both `source` and `code`. After host installation starts, failure rejects with the host's `BACKEND_INSTALL_FAILED`; its cause chain retains the original browser error. Native Web failures retain cause and stack under coded `StorageError`; shared cancellation, locks, owner validation, schema, and codec failures keep their original package identity. `ABORTED` retains the original cancellation reason. Retry concurrency according to `ConcurrencyPolicy` from the contract, rather than retrying committed notifications.

`host.dispose()` seals admission, cancels queued members, drains admitted work, then releases listeners and connections. Direct explicit backend cleanup propagates `BACKEND_DISPOSE_FAILED` with original errors reachable. Repeated explicit calls share their Promise. The async-disposal symbol has its own report-only completion projection over the same cleanup. A failure never makes a closed backend reusable.

## Migration from direct factories

Replace direct factories with the four backend plugins installed through `@migaia/storage-host`. Import memory and host primitives from that package, entities, schemas, and storage codecs from its `entity` entry. Replace old reactive wrappers and host live-query calls with an explicit `reactiveFeature(targetKind)` and `query.live()`. No legacy factory aliases are exported.

With `indexedDbNotificationsFeature()` and `indexedDbChangeFeedFeature()` selected, IndexedDB exposes native text invalidation through `store.watch(key, ctx?)`. Its `capabilities.changeFeed` is `true` only after the instance admits this realm's IndexedDB and BroadcastChannel; an unadmitted watch throws `UNSUPPORTED_CAPABILITY`. Hints carry the original host organization UUID and tell the consumer to reread committed native data. They provide neither historical replay nor one event per write. Dispose the iterator after use through its original `dispose()` method.

With `indexedDbTtlFeature()` selected, IndexedDB provides `ttl`: `store.use(ttl)` exposes `expire`, `remaining` and `persist` for text, bytes and record targets; transactions use `scope.use(ttl)`. A `setMany` entry's `ttlMs` commits or rolls back with its value in the same native transaction. Entries have no deadline by default. Expired point reads, enumeration and index queries return absence and lazily remove data through the original transaction, revision and change paths; no cleanup timer runs. Deadlines advance through the installed scheduler from one local epoch anchor captured at installation. Default-clock deadlines remain comparable across pages and reopening. IndexedDB has no vector channel, so vector TTL targets fail before I/O with `UNSUPPORTED_CAPABILITY`.

Text organization views use the configured namespace for the host default and namespace + "/" + orgId for every other organization. The same captured native client, namespace codec and Cookie scope remain in use. A configured namespace ending in "/" plus a canonical UUID rejects before native I/O; a bare UUID remains valid. dropOrg clears only that target, preserves other organizations and plugin prefixes, and leaves existing views reusable. Borrowed entities retain the original native atomic unique writer. IndexedDB maps dbName by the same rule. dropOrg makes the target connection close-pending, drains native transactions, and waits for that target's deleteDatabase request. New opens wait for the same request; existing views reopen afterward. Other instances close through their original versionchange handler. A foreign connection that refuses to close keeps native deletion pending; the host never resumes opening early and lets a late deletion destroy new data.

localStorage declares changeFeed:true only after registering the actual localStorage and storage event source of the same Window. A Storage-like injection alone remains false. Original watch/subscribeChanges combine committed writes from this instance with native cross-document events, filtered by storageArea, namespace codec, and organization; host disposal releases the listener. The receiving controller numbers hints locally, without a native writer history sequence. Reread current data: delivery is neither per-write nor a native notification for other instances in the same page. Organization views retain watch with runtime capability admission and no backend close authority.

## Native Blob and File storage

Select `indexedDbBlobFeature` from the dedicated subpath. It adds `store.api.blobs` and `scope.api.blobs`. Blob/File values use native structured clone; File name, type and lastModified survive reopening. The default store is `__migaia_blobs__`. Declare a different name with `{ storeName }`; declaration collisions fail before opening. Blob requests share the original record transaction, cancellation, quota normalization and rollback. Organization views use their actual database and original transaction owner. The Feature grants no database disposal method.

```ts
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '@migaia/storage-plugin-browser/indexed-db'
import { indexedDbBlobFeature } from '@migaia/storage-plugin-browser/features/blobs'

const host = await createStorageHost({
  plugins: [indexedDbBackendPlugin({ dbName: 'attachments' }, { blobs: indexedDbBlobFeature() })]
})
try {
  const store = host.backend('indexed-db')
  await store.transaction(async (scope) => {
    await scope.api.blobs.put('avatar', new Blob(['avatar bytes'], { type: 'text/plain' }))
    await scope.putRecord({ attachment: 'avatar' }, 'profile')
  })
  console.log(await (await store.api.blobs.get('avatar'))?.text())
} finally {
  await host.dispose()
}
```

With `indexedDbJournalFeature()` selected, IndexedDB supports `storageLogStore(hostOrOrg, 'indexed-db', { prefix })` from `@migaia/storage-host/plugins/journal`. Its private rows use an array-key namespace in the existing META store. Business `clearAll` leaves history intact; organization deletion invalidates old log handles, while the original business view can reopen. In cached mode, dispose a log before opening the same physical organization and prefix again. Native transactions commit head/state/records together and publish the cached index from the actual complete event.

Native Web Locks retain the original lifetime exclusion and cached path; a conflicting open reports LOCK_REJECTED. Without Web Locks or an actual private-factory declaration, the original namespace declares `indexExclusive:false`. storageLogStore remains available: each operation recovers/reads current lastSeq, state and records inside the original journal-store readwrite transaction, retaining no index across operations. Injected factories use the original cached path when Web Locks are available. `journalFactoryIsPrivate:true` applies only to an actual data universe confined to this realm without forwarding shared persistent storage; that path retains the original logical lock and cached owner. Object identity alone never proves isolation. This namespace support does not enable automatic global capture or opt-in undo by itself.

## IndexedDB global journal and explicit undo

Inside the `storageJournalPlugin` initializer, open native binlog and undo stores with the current org's `storageLogStore`, then pass those same objects to the logger plugins and `atomicBinlog` / `atomicUndo`. A logger with the undo plugin requires explicit `indexedDbUndo: true`; omission or false reports `UNSUPPORTED_CAPABILITY` before the business native transaction. The configured backend and org views expose `undo(txId)`, restored through the original transaction builder.

Text, bytes, records, clear and absolute TTL metadata retain their actual write order in one native transaction, including repeated writes. Only native complete publishes the log index; rollback does not advance its sequence. A first org read also prepares that org's once-only configuration, and lazy expiry deletion commits with its log. All contract writers maintain native point revisions and retain tombstones after delete or clear, so clear/recreate by another non-journal contract handle also rejects stale undo with `UNDO_CONFLICT` before restoring any target. Undo compares physical images and restores the original absolute deadline without extending expiry.

Native Features borrow IDBDatabase / IDBTransaction directly, beyond the current text, bytes and record image domain. An active commit journal rejects this combination with `UNSUPPORTED_CAPABILITY` before handing out the native handle. Blob and custom native Features remain available without a journal and with telemetry-only configuration. This limited combination awaits review of shared targets and codecs. Strict IndexedDB does not declare support for external WAL I/O after final image capture; that combination rejects before business I/O.

localStorage/sessionStorage/Cookie explicitly enable text transactions and multi-key writes with `redo: true` plus `journal.redoWal: logger.wal`. Native Web Locks are required. Every participant borrows the same actual WAL object with current pending visibility; matching targets or separate memoryLogStore caches do not establish sharing. A same-origin popup can directly borrow its opener's exact Logger/WAL. For persistence, one owner may hold an original storageLogStore on a separate IndexedDB backend; the enhanced text backend cannot carry its own WAL.

The original transaction owner manages the text-only scope and read-own-draft behavior. It finishes encoding before wal.begin, then applies ordered assignments, binlog and complete, and finally publishes one invalidation and success. Apply/completion failure seals that instance and preserves pending; reopening or an already-open participating peer recovers under native protection before reading. Callback rollback applies nothing. Ordinary scalar/sync behavior remains when redo is absent; selected asynchronous journaling retains the original ASYNC_STAGE_IN_SYNC_ENTRY guard. Redo does not claim native atomicity. Undo/atomicBinlog/atomicUndo and raw native Feature handles reject before mutation in this combination. Automatic cross-page recovery between independent WAL caches is not promised.

While one instance has an active draft, its root reads, writes and other transactions immediately reject with `WRITE_CONFLICT`, including independent callers selecting `ConcurrencyPolicy.wait()`. Use the supplied scope inside the callback. This isolation prevents callback reentry from waiting on its own Web Lock; same-instance queued wait is not provided. Other instances still wait or cancel through native Web Locks. Behavior without redo remains unchanged.

Cookie `redo: true` reuses this same transaction/WAL protocol. Ordinary and redo writes share the original cookie encoding, 4096-byte limit, fixed scope and visibility checks. Batch reads still parse one native visible header and merge the current draft. Redo resolves maxAge to an absolute expiresAt image during preparation, so replay never renews it. Values outside the native Date domain reject before mutation only in this new combination; ordinary Cookie maxAge and Max-Age precedence remain unchanged. Only JS-visible cookies participate; original HttpOnly/unknown-scope limits remain.

Raw `store.use(records).query().page()` and `.after()` additionally require `indexedDbKeysetFeature()` from `@migaia/storage-plugin-browser/features/indexed-db-keyset` in the backend Feature record. Basic `.all()` remains available. This unit borrows the canonical host cursor implementation without enabling native indexes.

Omitted raw pagination rejects with `@migaia/storage-plugin-browser / INDEXED_DB_FEATURE_NOT_INSTALLED` and names the missing factory before opening a reader. Entity pagination has its own `entityKeysetFeature()` declaration and does not require this raw-query Feature.

### Strict index query migration

Previously, `.index(...).requirePushdown()` allowed a full scan when no client steps remained. Terminal reads now reject `@migaia/storage-contract / QUERY_NOT_PUSHABLE` when an explicit index source plans `fullScan`, or native preparation contention leaves only a scan.

Install `entityIndexesFeature()` and the backend index Feature when native execution is required. Remove `requirePushdown()` when an authoritative scan is acceptable. Ordinary queries retain their scan fallback.

IndexedDB borrowed views resolve the same private capabilities as their native store. Legacy records keep readiness running until migration completes with the matching schema fingerprint. Queries continue to scan and report fallback while readiness is not complete.

When no migration metadata exists, a backfill that starts from the canonical beginning and finishes both scan phases may become complete only if it observes no legacy records and skips no invalid entity records. Current-format records can then use the native cursor without `entityMigrationFeature()`.

Legacy records, including canonical shadows, and skipped invalid records keep readiness running; ordinary queries scan and report fallback, while explicit indexed strict queries reject `QUERY_NOT_PUSHABLE`. Resuming from a persisted checkpoint does not prove the earlier scan was clean. Existing migration metadata still requires status complete and the matching schema fingerprint.
