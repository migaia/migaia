# @migaia/storage-web guide

Complete public reference. Start with [README.md](./README.md) for selection and quick setup.

## Contents

1. [Public API and capability model](#public-api-and-capability-model)
2. [Backend configuration](#backend-configuration)
3. [Entities and workflow](#entities-and-workflow)
4. [Schema and codec extensions](#schema-and-codec-extensions)
5. [Lifecycle, operations, and transactions](#lifecycle-operations-and-transactions)
6. [Errors](#errors)
7. [Migration, FAQ, and troubleshooting](#migration-faq-and-troubleshooting)
8. [Build and test](#build-and-test)

## Export reference

All names below come from the root export unless stated otherwise.

| Area | Exports |
| --- | --- |
| Backends | `localStorage`, `sessionStorage`, `memoryStorage`, `cookies`, `indexedDb`; `ILocalStorageOptions`, `ISessionStorageOptions`, `IWebStorageOptions`, `ICookiesOptions`, `ICookieDocument`, `IIndexedDbOptions` |
| Contract/types | `IKeyValueStore`, `ISyncKeyValueStore`, `IRecordStore`, `ISyncCapableStore`, `ITransactionScope`, `ITransactionWriteOptions`, `IOperationContext`, `IWriteOptions`, `ISyncWriteOptions`, `IConflictPolicy`, `IStorageKey`, `IKeyRange`, `IBackendKind`, `IStorageCapabilities`, `IWebStorageLike` |
| Cookie types | `ICookieStore`, `ISyncCookieStore`, `ICookieWriteContext`, `ICookieRemoveContext`, `ICookieScope`, `ISameSite` |
| Contract helpers | `ConflictPolicy`, `asRecordStore`, `isRecordStore`, `lengthPrefixedNamespaceCodec`, `INamespaceCodec` |
| Web errors | `StorageError`, `StorageErrorCode`, `IStorageErrorCode`, `IStorageErrorDetails`, `IStorageChannel`, `IExtensionStage` |
| Contract errors | `StorageContractError`, `StorageContractErrorCode`, `STORAGE_CONTRACT_SOURCE`, `isStorageContractError`, `IStorageContractErrorCode`, `IStorageContractErrorDetails` |
| Codec | `jsonCodec`, `structuredCodec`, `binaryCodec`, `selectCodec`, `ICodec`, `ICodecOutput`, `ISelectedCodec` |
| Schema | `passthrough`, `fromStandardSchema`, `runMigrations`, `ISchemaAdapter`, `IStandardSchemaV1`, `IMigration`, `IMigrationContext` |
| Entity | `defineEntity`, `IEntityDefinition`, `IEntityOptions`, `IEntityTransactionScope`, `IListOptions`, `IMigrateOptions`, `IMigrateResult`, `IInvalidRecordAction`, `IInvalidRecordIssue`, `IInvalidRecordHandler`, `IRecordComparator`, `IRepository` |

`@migaia/storage-web/memory` exports only `memoryStorage`.

## Public API and capability model

Every backend is an async `IKeyValueStore`: `get`, `set`, `remove`, `has`, `keys`, `clearValues`, `clearAll`, `dispose`, `backend`, and `capabilities`. L0 keys/values are strings. Sync backends additionally supply `store.sync` with synchronous `get`, `set`, `remove`, `has`, `keys`, and `clearValues`.

`IRecordStore<T>` (memory and IndexedDB) adds `getBytes`, `setBytes`, `clearBytes`, `getRecord`, `putRecord`, `deleteRecord`, `clearRecords`, `iterateRecords`, and `transaction`; `putRecord(value, key?)` returns its key. It can expose backend-owned metadata `get`/`set`/`delete` for resumable maintenance.

`IStorageCapabilities` is source of truth: `syncRead`, `binary`, `records`, `transactions`, `iteration`, `maxValueBytes`, and `opaqueEntries`. Branch with `isRecordStore(store)`; use `asRecordStore(store)` only when L1 is required.

Async APIs accept:

```ts
type IOperationContext = { signal?: IAbortSignal; timeoutMs?: number; pageSize?: number };
type IWriteOptions = IOperationContext & { conflictPolicy?: 'conflict' | 'replace' };
```

`timeoutMs` is a non-negative safe integer; `pageSize` is 1–4096. Sync writes accept only `conflictPolicy`. Cookie stores specialize async `set(key, value, { expires?, maxAge?, signal?, timeoutMs? })` and `remove(key, { signal?, timeoutMs? })`; sync cookie `set` accepts `expires`, `maxAge`, and conflict policy.

## Backend configuration

### Web Storage

```ts
type IWebStorageOptions = { namespace?: string; namespaceCodec?: INamespaceCodec };
type ILocalStorageOptions = IWebStorageOptions & { storage?: IWebStorageLike };
type ISessionStorageOptions = IWebStorageOptions & { storage?: IWebStorageLike };
```

`localStorage(options)` and `sessionStorage(options)` default `namespace` to `'default'`; clearing and enumeration stay inside it. `namespaceCodec` defaults to `lengthPrefixedNamespaceCodec`. `storage` injects a Storage-shaped host for tests/non-browser hosts. Construction probes usability, so disabled storage fails early with `BACKEND_UNAVAILABLE`.

### Cookies

```ts
type ICookiesOptions = {
  namespace?: string;
  namespaceCodec?: INamespaceCodec;
  scope?: { path?: string; domain?: string; sameSite?: 'strict' | 'lax' | 'none'; secure?: boolean; partitioned?: boolean };
  document?: ICookieDocument;
};
```

Default scope is `{ path: '/' }`. `sameSite: 'none'` and `partitioned: true` require `secure: true`. Scope is constructor-fixed. Values over 4096 UTF-8 bytes fail with `VALUE_TOO_LARGE`. HttpOnly cookies are invisible and same-name visible cookies can be scope-ambiguous, so `opaqueEntries` is true and ambiguous names fail with `COOKIE_SCOPE_AMBIGUOUS`.

### IndexedDB and memory

```ts
type IIndexedDbOptions = {
  dbName?: string; kvStoreName?: string; bytesStoreName?: string; recordsStoreName?: string;
  cleanupLegacyRecords?: boolean; factory?: IDBFactory; keyRange?: typeof IDBKeyRange;
};
```

`indexedDb()` defaults to database `storage-web` and stores `kv`, `bytes`, `records`; names must be non-empty, unique, and non-reserved. `factory`/`keyRange` support test and non-browser injection. There is no `sync` API. A successful open connection is reused; open failure resets it; a version change closes it for later reopening; blocked upgrades report `BACKEND_UNAVAILABLE`. Writes wait for transaction completion.

An existing legacy `documents` store is copied in resumable batches. `cleanupLegacyRecords: true` can delete it only after completion/matching target state: enable only after active clients no longer need rollback.

`memoryStorage<T>()` has no options and creates an isolated process-local L0+L1 store with sync, bytes, records, iteration, and transactions. It is volatile: suitable for tests, SSR placeholders, or explicit fallback, never durable persistence.

## Entities and workflow

`defineEntity<TDomain, TStored = TDomain>(options)` accepts `name`, `key`, optional `schema`, `codec`, `version`, `migrations`, `validateOnRead`, `onDiagnostic`, and `defaultOrderBy`. Name cannot start `__`; version defaults to 1; `validateOnRead` defaults true. Version >1 requires every migration step from 2 through version. `connect(store)` returns a repository with `get`, `put`, `remove`, `list`, `stream`, `migrate`, and `batch`.

```ts
import { defineEntity, indexedDb } from '@migaia/storage-web';

type IPreference = { id: string; theme: 'light' | 'dark' };

const definition = defineEntity<IPreference>({
  name: 'preferences',
  key: 'id',
  version: 2,
  migrations: { 2: async (previous) => ({ ...(previous as { id: string }), theme: 'light' }) }
});

const preferences = definition.connect(indexedDb({ dbName: 'app-data' }));
await preferences.put({ id: 'appearance', theme: 'dark' });
```

`list`/`stream` options are `{ range?, limit?, orderBy?, onInvalid? }`; `onInvalid` is `'skip'`, `'throw'`, or a handler receiving key/raw/record/stage/cause. Stages: `decode`, `migrate`, `validate`. Ordering materializes matching records before sorting. KV-only entity scans enumerate all keys and emit diagnostics; choose IndexedDB/ranges for larger data.

`migrate({ batchSize?, onInvalid? })` returns `scanned`, `eligible`, `migrated`, `skipped`, `alreadyCurrent`, and `conflicted`. IndexedDB may resume from metadata; memory/KV-only backends cannot resume across process lifetime. `batch(run, ctx?)` requires L1 and exposes `tx.get`, `tx.put`, `tx.remove`.

## Schema and codec extensions

`ISchemaAdapter` has `name`, async `validate`, optional `encode`/`decode`/`normalize`. Write flow: validate → normalize → encode → codec encode. Read: codec decode → schema decode → validate when enabled.

- `passthrough<T>()`: default no-op schema.
- `fromStandardSchema(schema)`: Standard Schema v1 adapter.
- `runMigrations(value, fromVersion, toVersion, migrations, signal?)`: ascending helper; missing direct steps are no-ops, unlike entity definition validation.

| Codec | Output | Boundary |
| --- | --- | --- |
| `jsonCodec` | text | JSON-compatible values. |
| `structuredCodec` | structured | Record backend required. |
| `binaryCodec` | binary | `Uint8Array` input/output. |

`selectCodec(codec, capabilities, onDiagnostic?)` passes compatible codecs through. Structured output on an L0-only backend throws contract `UNSUPPORTED_CAPABILITY`; binary output on a non-binary backend uses base64 and reports overhead through `onDiagnostic`.

## Lifecycle, operations, and transactions

`dispose()` ends ownership. Later operations fail with `StorageContractError` / `STORE_DISPOSED`. Signal/timeout cancellation is cooperative; a host or extension operation that reaches commit has its own atomic boundary. Never infer rollback from cancellation alone.

Memory and IndexedDB transactions use isolated scopes and validate state at commit. Concurrent changes can cause `TRANSACTION_CONFLICT`; reread and retry the complete callback. Callback/host transaction failure is `TRANSACTION_FAILED`. Do not use the transaction scope after callback completion.

Record backends prevent one logical key occupying value, bytes, and record channels by default. Cross-channel writes fail with `DUPLICATE_KEY`; use `{ conflictPolicy: 'replace' }` only when intentional replacement is correct.

## Errors

Contract failures (`StorageContractError`, source `@migaia/storage-contract`): `INVALID_ARGUMENT`, `INVALID_KEY`, `UNSUPPORTED_CAPABILITY`, `STORE_DISPOSED`, `ABORTED`.

| Web `StorageError` code | Meaning |
| --- | --- |
| `BACKEND_UNAVAILABLE` | Browser backend absent, disabled, blocked, or unusable. |
| `QUOTA_EXCEEDED` / `VALUE_TOO_LARGE` | Storage quota or cookie single-value limit. |
| `SERIALIZE_FAILED` / `DESERIALIZE_FAILED` | Conversion or stored-data failure. |
| `VALIDATION_FAILED` / `MIGRATION_FAILED` | Schema or migration failure. |
| `TRANSACTION_FAILED` / `TRANSACTION_CONFLICT` | Transaction failure or retryable concurrent change. |
| `DUPLICATE_KEY` / `VERSION_UNSUPPORTED` | Channel collision or newer data/schema. |
| `EXTENSION_FAILED` / `INVALID_CONFIG` | Extension failure or invalid backend/entity/extension configuration. |
| `WRITE_FAILED` / `COOKIE_SCOPE_AMBIGUOUS` | Cookie write/visibility boundary. |

`StorageError` preserves `cause` and can include `backend`, `key`, channel fields, `extensionStage`, and `operation`.

## Migration, FAQ, and troubleshooting

**SSR?** Import `@migaia/storage-web/memory`; do not initialize browser backends without their globals.

**`asRecordStore` fails?** local/session/cookie are L0-only; use memory or IndexedDB for records/bytes/transactions.

**Entity list slow?** KV-only stores enumerate keys and `orderBy` materializes results. Use IndexedDB, narrow ranges, and avoid sorting large sets.

**Cookie write failed?** Check scope, secure/SameSite rules, policy, and 4 KiB size. Invisible HttpOnly cookies are not evidence of absence.

**Entity migration?** Increase version, supply every step, deploy a compatible reader, run `repository.migrate()`, then delay legacy IndexedDB cleanup until rollback is impossible.

**Transaction conflict?** Another operation changed read state; retry full callback after rereading.

## Build and test

```bash
pnpm --filter @migaia/storage-web run fmt
pnpm --filter @migaia/storage-web run lint
pnpm --filter @migaia/storage-web run typecheck
pnpm --filter @migaia/storage-web run typecheck:test
pnpm --filter @migaia/storage-web run test
pnpm --filter @migaia/storage-web run test:e2e
```

`build` runs Vite and declaration emission. `test:e2e` runs package Playwright configuration and needs browser dependencies.
