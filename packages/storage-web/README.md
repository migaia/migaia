# @migaia/storage-web

Browser local-storage implementations behind one common contract. Provides namespaced `localStorage`, `sessionStorage`, cookies, IndexedDB, and isolated memory storage, with optional entity, schema, and codec layers.

## Purpose and fit

Use for browser preferences, session state, request cookies, IndexedDB records, or test/SSR-safe volatile storage. Select features through explicit capabilities rather than assuming every backend supports records or transactions.

Not a server database, cross-device sync service, cross-tab subscription API, or state manager. Root import includes browser backend types; SSR/Node/test consumers needing only volatile storage should use `@migaia/storage-web/memory`.

## Install

```bash
pnpm add @migaia/storage-web
```

Inside this monorepo, depend on `@migaia/storage-web@workspace:^`.

## Quick start

```ts
import { localStorage } from '@migaia/storage-web';

const store = localStorage({ namespace: 'settings' });
await store.set('theme', 'dark');
const theme = await store.get('theme');
store.sync.set('theme', 'light');
```

```ts
import { defineEntity, memoryStorage } from '@migaia/storage-web';

type IUser = { id: string; name: string };

const users = defineEntity<IUser>({ name: 'users', key: 'id' }).connect(memoryStorage());
await users.put({ id: 'ada', name: 'Ada' });
```

## Core API and export map

| Group | Exports | Use |
| --- | --- | --- |
| Backends | `localStorage`, `sessionStorage`, `cookies`, `indexedDb`, `memoryStorage` | Create stores. |
| Contract | `IKeyValueStore`, `IRecordStore`, `IStorageCapabilities`, `isRecordStore`, `asRecordStore`, `ConflictPolicy` | Check/require capability. |
| Entity | `defineEntity` and entity types | Typed records, migration, list/stream, batch. |
| Schema | `passthrough`, `fromStandardSchema`, `runMigrations` | Validate/transform domain values. |
| Codec | `jsonCodec`, `structuredCodec`, `binaryCodec`, `selectCodec` | Choose persistence representation. |
| Key namespace | `lengthPrefixedNamespaceCodec` | Encode Web Storage/cookie keys. |
| Errors | `StorageError`, `StorageErrorCode`, contract-error re-exports | Handle failures. |

```ts
import { indexedDb, defineEntity } from '@migaia/storage-web';
import { memoryStorage } from '@migaia/storage-web/memory';
```

Root exports every public API. The only subpath, `./memory`, exports just `memoryStorage` to avoid DOM and IndexedDB backend imports in neutral environments.

## Platform, lifecycle, and boundaries

| Backend | Sync | Records/bytes/transactions | Boundary |
| --- | --- | --- | --- |
| `localStorage()` | Yes | No | Usable Web Storage; namespaced strings. |
| `sessionStorage()` | Yes | No | Usable Web Storage; namespaced strings. |
| `cookies()` | Yes | No | `document.cookie`; 4 KiB value limit and visibility ambiguity. |
| `indexedDb()` | No | Yes | IndexedDB; async and quota-bound. |
| `memoryStorage()` | Yes | Yes | Process-local and non-persistent. |

Dispose each store when its owner ends; later calls fail with contract `STORE_DISPOSED`. Async APIs accept cancellation/timeout context. Cancellation is cooperative: do not assume a write that races its commit boundary rolled back.

Web-specific failures are `StorageError` (`source: '@migaia/storage-web'`). Shared bad-input, bad-key, unsupported-capability, disposal, and cancellation failures are re-exported `StorageContractError` values (`source: '@migaia/storage-contract'`). Both preserve causal failures.

Full API/configuration reference, realistic workflow, migration, troubleshooting, build and test commands: [USEGUIDE.md](./USEGUIDE.md).
