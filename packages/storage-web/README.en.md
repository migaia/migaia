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
