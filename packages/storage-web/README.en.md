# `@migaia/storage-web`

Browser backends for `localStorage`, `sessionStorage`, cookies, and IndexedDB. Install the selected backend into `@migaia/storage-host`; the host owns preparation and cleanup.

## Install

```bash
pnpm add @migaia/storage-web @migaia/storage-host @migaia/storage-contract
```

Examples require an ESM browser environment with top-level `await`. Select a backend whose native browser API is available.

## Save preferences

```ts
import { createStorageHost } from '@migaia/storage-host'
import { localStorageBackendPlugin } from '@migaia/storage-web/local-storage'

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

Prints `dark`. Disposing the host releases owned listeners and connections; it does not clear persistent browser data.

## Choose a backend

| Entry             | Plugin                        | Default id   | Data                                               |
| ----------------- | ----------------------------- | ------------ | -------------------------------------------------- |
| `local-storage`   | `localStorageBackendPlugin`   | `local`      | text + sync                                        |
| `session-storage` | `sessionStorageBackendPlugin` | `session`    | text + sync                                        |
| `cookies`         | `cookieBackendPlugin`         | `cookies`    | text + sync, JS-visible cookies                    |
| `indexed-db`      | `indexedDbBackendPlugin`      | `indexed-db` | text, bytes, records, native transactions, indexes |

Each entry also exports its opaque backend kind and precise options/store types. The `plugins/*` entries export the same plugin functions. Pass native options first and an optional Feature record second. Import shared capabilities and context types directly from `@migaia/storage-contract`.

Memory, `createStorageHost`, `defineFeature`, and backend authoring belong to `@migaia/storage-host`. Entity repositories, schema adapters, and storage codecs belong to `@migaia/storage-host/entity`.

Unique entity writes require a real record transaction or the backend’s native atomic value-commit endpoint. Built-in browser backends provide it. A custom value-only backend without `core.registerValueCommit` rejects unique writes with `UNSUPPORTED_CAPABILITY` before schema work or mutation; ordinary KV remains available. See the host entity guide for the authoring contract.

## KV batches

`store.use(kv)` provides `getMany`, `setMany`, `removeMany`, and `removeByPrefix`. IndexedDB executes a batch in one native transaction and supports string, number, Date, binary, and tuple keys. String keys retain the same data as the original single-key methods. Reads preserve input order and duplicate positions, missing values are `undefined`, and deletion returns the actual count. Canonical duplicate write keys reject with `INVALID_ARGUMENT` before I/O. Empty batches enter neither the pipeline nor a native transaction.

localStorage, sessionStorage, and Cookie support batch reads. Multi-key writes require WAL and reject with `UNSUPPORTED_CAPABILITY` before mutation when it is absent. The default namespace codec retains the string `sw1` layout and uses a separate `sw2` layout for typed keys. `keys()` still lists strings; namespace cleanup covers both layouts. A custom codec must provide both `encodeStorageKey` and `decodeStorageKey` to read non-string batch keys; otherwise those keys reject before native I/O.

## IndexedDB transactions

```ts
import { createStorageHost } from '@migaia/storage-host'
import { kv, records } from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'

const host = await createStorageHost({
  plugins: [indexedDbBackendPlugin({ dbName: 'my-app' })]
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

All three channels share one native readwrite transaction. Only methods on the supplied scope participate. Completion waits for the actual native terminal; failures roll back that transaction. Do not await timers, network calls, or an independent root write inside the callback. An inactive native transaction fails with `TRANSACTION_FAILED`, retaining the native cause; callbacks are never resumed from a guard request.

## Reactive queries

The optional `features/reactive` entry adds `.live()` to supported query chains. It owns one service per installed Feature and attaches its source on first use. The caller owns the reactive Runtime.

```ts
import { createRuntime } from '@migaia/reactive'
import { records } from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendKind, indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { reactiveFeature } from '@migaia/storage-web/features/reactive'

const runtime = createRuntime()
const host = await createStorageHost({
  plugins: [
    indexedDbBackendPlugin(
      { dbName: 'my-app' },
      { reactive: reactiveFeature(indexedDbBackendKind) }
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

Browser sources retain eventual visibility: local storage is document-eventual, session storage top-level-context-eventual, cookies origin-js-visible-eventual, and IndexedDB origin-eventual. Their original 1000 ms reconciliation remains. These are invalidation hints, not replication or a guarantee that arbitrary raw writers are observed immediately.

## Boundaries

- Text methods accept string keys and string values. `get` returns `null` for missing text; records return `undefined`.
- `clearValues` affects only the text channel. `clearAll` affects the channels and namespace owned by that backend.
- Same-key cross-channel writes fail with `DUPLICATE_KEY`; explicit `conflictPolicy: 'replace'` replaces displaced channels atomically.
- Cookie scope is fixed at installation. HttpOnly cookies remain invisible; `has: false` does not prove their absence.
- Disposal seals new work and drains admitted work. Explicit cleanup reports failure through its returned Promise; errors preserve their original cause chain.
- After host installation starts, failure rejects with `@migaia/storage-host` `BACKEND_INSTALL_FAILED`; the original browser error remains in its cause chain.
- Branch on `(source, code)`. Web errors use `@migaia/storage-web`; shared concurrency, cancellation, and owner errors retain their package identity.

See [the usage guide](./USEGUIDE.en.md) for options, native activity, and lifecycle details.

IndexedDB exposes native text invalidation through `store.watch(key, ctx?)`. Its `capabilities.changeFeed` is `true` only after the instance admits this realm's IndexedDB and BroadcastChannel; an unadmitted watch throws `UNSUPPORTED_CAPABILITY`. Hints carry the original host organization UUID and tell the consumer to reread committed native data. They provide neither historical replay nor one event per write. Dispose the iterator after use through its original `dispose()` method.

IndexedDB natively provides `ttl`: `store.use(ttl)` exposes `expire`, `remaining` and `persist` for text, bytes and record targets; transactions use `scope.use(ttl)`. A `setMany` entry's `ttlMs` commits or rolls back with its value in the same native transaction. Entries have no deadline by default. Expired point reads, enumeration and index queries return absence and lazily remove data through the original transaction, revision and change paths; no cleanup timer runs. Deadlines advance through the installed scheduler from one local epoch anchor captured at installation. Default-clock deadlines remain comparable across pages and reopening. IndexedDB has no vector channel, so vector TTL targets fail before I/O with `UNSUPPORTED_CAPABILITY`.

Text organization views use the configured namespace for the host default and namespace + "/" + orgId for every other organization. The same captured native client, namespace codec and Cookie scope remain in use. A configured namespace ending in "/" plus a canonical UUID rejects before native I/O; a bare UUID remains valid. dropOrg clears only that target, preserves other organizations and plugin prefixes, and leaves existing views reusable. Borrowed entities retain the original native atomic unique writer. IndexedDB maps dbName by the same rule. dropOrg makes the target connection close-pending, drains native transactions, and waits for that target's deleteDatabase request. New opens wait for the same request; existing views reopen afterward. Other instances close through their original versionchange handler. A foreign connection that refuses to close keeps native deletion pending; the host never resumes opening early and lets a late deletion destroy new data.

localStorage declares changeFeed:true only after registering the actual localStorage and storage event source of the same Window. A Storage-like injection alone remains false. Original watch/subscribeChanges combine committed writes from this instance with native cross-document events, filtered by storageArea, namespace codec, and organization; host disposal releases the listener. The receiving controller numbers hints locally, without a native writer history sequence. Reread current data: delivery is neither per-write nor a native notification for other instances in the same page. Organization views retain watch with runtime capability admission and no backend close authority.

## Native Blob and File storage

Select `indexedDbBlobFeature` from the dedicated subpath. It adds `store.api.blobs` and `scope.api.blobs`. Blob/File values use native structured clone; File name, type and lastModified survive reopening. The default store is `__migaia_blobs__`. Declare a different name with `{ storeName }`; declaration collisions fail before opening. Blob requests share the original record transaction, cancellation, quota normalization and rollback. Organization views use their actual database and original transaction owner. The Feature grants no database disposal method.

```ts
import { createStorageHost } from '@migaia/storage-host'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'
import { indexedDbBlobFeature } from '@migaia/storage-web/features/blobs'

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

IndexedDB supports `storageLogStore(hostOrOrg, 'indexed-db', { prefix })` from `@migaia/storage-host/journal`. Its private rows use an array-key namespace in the existing META store. Business `clearAll` leaves history intact; organization deletion invalidates old log handles, while the original business view can reopen. In cached mode, dispose a log before opening the same physical organization and prefix again. Native transactions commit head/state/records together and publish the cached index from the actual complete event.

Native Web Locks retain the original lifetime exclusion and cached path; a conflicting open reports LOCK_REJECTED. Without Web Locks or an actual private-factory declaration, the original namespace declares `indexExclusive:false`. storageLogStore remains available: each operation recovers/reads current lastSeq, state and records inside the original journal-store readwrite transaction, retaining no index across operations. Injected factories use the original cached path when Web Locks are available. `journalFactoryIsPrivate:true` applies only to an actual data universe confined to this realm without forwarding shared persistent storage; that path retains the original logical lock and cached owner. Object identity alone never proves isolation. This namespace support does not enable automatic global capture or opt-in undo by itself.

## IndexedDB global journal and explicit undo

Inside the Host `journal` initializer, open native binlog and undo stores with the current org's `storageLogStore`, then pass those same objects to the logger plugins and `atomicBinlog` / `atomicUndo`. A logger with the undo plugin requires explicit `indexedDbUndo: true`; omission or false reports `UNSUPPORTED_CAPABILITY` before the business native transaction. The configured backend and org views expose `undo(txId)`, restored through the original transaction builder.

Text, bytes, records, clear and absolute TTL metadata retain their actual write order in one native transaction, including repeated writes. Only native complete publishes the log index; rollback does not advance its sequence. A first org read also prepares that org's once-only configuration, and lazy expiry deletion commits with its log. All contract writers maintain native point revisions and retain tombstones after delete or clear, so clear/recreate by another non-journal contract handle also rejects stale undo with `UNDO_CONFLICT` before restoring any target. Undo compares physical images and restores the original absolute deadline without extending expiry.

Native Features borrow IDBDatabase / IDBTransaction directly, beyond the current text, bytes and record image domain. An active commit journal rejects this combination with `UNSUPPORTED_CAPABILITY` before handing out the native handle. Blob and custom native Features remain available without a journal and with telemetry-only configuration. This limited combination awaits review of shared targets and codecs. Strict IndexedDB does not declare support for external WAL I/O after final image capture; that combination rejects before business I/O.

localStorage/sessionStorage/Cookie explicitly enable text transactions and multi-key writes with `redo: true` plus `journal.redoWal: logger.wal`. Native Web Locks are required. Every participant borrows the same actual WAL object with current pending visibility; matching targets or separate memoryLogStore caches do not establish sharing. A same-origin popup can directly borrow its opener's exact Logger/WAL. For persistence, one owner may hold an original storageLogStore on a separate IndexedDB backend; the enhanced text backend cannot carry its own WAL.

The original transaction owner manages the text-only scope and read-own-draft behavior. It finishes encoding before wal.begin, then applies ordered assignments, binlog and complete, and finally publishes one invalidation and success. Apply/completion failure seals that instance and preserves pending; reopening or an already-open participating peer recovers under native protection before reading. Callback rollback applies nothing. Ordinary scalar/sync behavior remains when redo is absent; selected asynchronous journaling retains the original ASYNC_STAGE_IN_SYNC_ENTRY guard. Redo does not claim native atomicity. Undo/atomicBinlog/atomicUndo and raw native Feature handles reject before mutation in this combination. Automatic cross-page recovery between independent WAL caches is not promised.

While one instance has an active draft, its root reads, writes and other transactions immediately reject with `WRITE_CONFLICT`, including independent callers selecting `ConcurrencyPolicy.wait()`. Use the supplied scope inside the callback. This isolation prevents callback reentry from waiting on its own Web Lock; same-instance queued wait is not provided. Other instances still wait or cancel through native Web Locks. Behavior without redo remains unchanged.

Cookie `redo: true` reuses this same transaction/WAL protocol. Ordinary and redo writes share the original cookie encoding, 4096-byte limit, fixed scope and visibility checks. Batch reads still parse one native visible header and merge the current draft. Redo resolves maxAge to an absolute expiresAt image during preparation, so replay never renews it. Values outside the native Date domain reject before mutation only in this new combination; ordinary Cookie maxAge and Max-Age precedence remain unchanged. Only JS-visible cookies participate; original HttpOnly/unknown-scope limits remain.
