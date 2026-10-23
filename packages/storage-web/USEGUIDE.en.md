# `@migaia/storage-web` Usage guide

Use the selected browser plugin with the real host. The examples require native browser APIs; an injected port does not turn a Node process into a browser.

## Own named browser backends

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
import { cookieBackendPlugin } from '@migaia/storage-web/cookies'

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

## Native IndexedDB transactions

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

`dbName` defaults to `storage-web`; `kvStoreName`, `bytesStoreName`, and `recordsStoreName` default to `kv`, `bytes`, and `records`. Names must be nonempty, distinct, and avoid reserved internal stores. `factory` and `keyRange` default to `globalThis.indexedDB` and `globalThis.IDBKeyRange`. Optional `owner.label` is diagnostic metadata, never a lock identity.

The host opens and prepares the selected database before publication. Missing internal stores are created by a native version upgrade. `onversionchange` closes the old connection. A blocked open rejects instead of publishing an unprepared backend. `cleanupLegacyRecords` defaults to `false`; enabling it removes the legacy store only after successful migration.

A transaction scope covers text, bytes, records, and index maintenance in one original native transaction. `scope.use(kv)` adds structured-key batch methods; `scope.use(records)` exposes queries and bounded prefix removal. Root text keys remain strings. Record and scoped text keys follow `IStorageKey` from `@migaia/storage-contract`, including number, Date, ArrayBuffer, and nested arrays.

Await only native operations and activity-preserving microtasks within the callback. A timer or network wait can end the native activity window. A later method then fails `TRANSACTION_FAILED` with the native cause; catching that method failure does not turn the transaction into a commit. Scope methods lose admission when the callback closes. Finalizers use separate authentic views of the same transaction. Accepted operations, iterators, callbacks, and finalizers drain before resource release.

`setBytes` snapshots input bytes. Record writes use structured cloning and reject unsupported values with `SERIALIZE_FAILED`. Native completion precedes notification. A listener failure is reported and cannot undo a committed write.

## Entity repositories

Import the neutral repository owner from `@migaia/storage-host/entity` and connect it to the actual installed IndexedDB store.

```ts
import { createStorageHost } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import { indexedDbBackendPlugin } from '@migaia/storage-web/indexed-db'

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

`ready` observes initial work, `refresh()` joins active work or requests a new generation, and `state` is a readonly computed. `keepPreviousData` defaults to `true`; `equals` defaults to no suppression. Optional `scope` and `matches` filter invalidations; predicate failures report and refresh conservatively. `timeoutMs` applies per generation, while `signal` cancels the query lifetime. Cleanup leaves the caller-owned Runtime usable.

Sources are eventual and preserve native visibility. Local/session/cookie/IndexedDB use hybrid invalidation with 1000 ms reconciliation; memory from `@migaia/storage-host` uses instance-local push without polling. No source promises immediate capture of arbitrary external writes.

## Errors and shutdown

Inspect both `source` and `code`. After host installation starts, failure rejects with the host's `BACKEND_INSTALL_FAILED`; its cause chain retains the original browser error. Native Web failures retain cause and stack under coded `StorageError`; shared cancellation, locks, owner validation, schema, and codec failures keep their original package identity. `ABORTED` retains the original cancellation reason. Retry concurrency according to `ConcurrencyPolicy` from the contract, rather than retrying committed notifications.

`host.dispose()` seals admission, cancels queued members, drains admitted work, then releases listeners and connections. Direct explicit backend cleanup propagates `BACKEND_DISPOSE_FAILED` with original errors reachable. Repeated explicit calls share their Promise. The async-disposal symbol has its own report-only completion projection over the same cleanup. A failure never makes a closed backend reusable.

## Migration from direct factories

Replace direct factories with the four backend plugins installed through `@migaia/storage-host`. Import memory and host primitives from that package, entities, schemas, and storage codecs from its `entity` entry. Replace old reactive wrappers and host live-query calls with an explicit `reactiveFeature(targetKind)` and `query.live()`. No legacy factory aliases are exported.
