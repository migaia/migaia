# @migaia/storage-contract guide

Portable storage contract only; implementations such as `@migaia/storage-web` provide actual persistence.

## Contents

1. [Store contracts](#store-contracts)
2. [Capabilities and keys](#capabilities-and-keys)
3. [Codecs and operation context](#codecs-and-operation-context)
4. [Transactions, lifecycle, and errors](#transactions-lifecycle-and-errors)
5. [Workflow](#workflow)
6. [Migration, troubleshooting, and build](#migration-troubleshooting-and-build)

## Export reference

| Area | Root exports |
| --- | --- |
| Errors | `StorageContractError`, `StorageContractErrorCode`, `STORAGE_CONTRACT_SOURCE`, `isStorageContractError`, `IStorageContractErrorCode`, `IStorageContractErrorDetails` |
| Store types/guards | `IKeyValueStore`, `ISyncKeyValueStore`, `IRecordStore`, `ISyncCapableStore`, `isKeyValueStore`, `asRecordStore`, `isRecordStore` |
| Capabilities | `IBackendKind`, `IStorageCapabilities`, `snapshotStorageCapabilities`, `isStorageCapabilities` |
| Context | `IOperationContext`, `IWriteOptions`, `ISyncWriteOptions`, `IConflictPolicy`, `IStorageKey`, `IKeyRange`, `ConflictPolicy` |
| Transactions | `ITransactionScope`, `ITransactionWriteOptions`, `assertTransactionCallback`, `readTransactionConflictPolicy` |
| Keys | `KEY_DOMAIN_LIMITS`, `assertStorageKey`, `snapshotStorageKey`, `assertStringStorageKey`, `compareStorageKeys` |
| Codecs | `ICodec`, `ICodecOutput`, `snapshotCodec`, `assertCodec` |
| Context guards | `IOperationContextSnapshot`, `snapshotOperationContext`, `assertOperationContext`, `snapshotSyncWriteOptions`, `assertSyncWriteOptions` |
| Bytes/constants | `isUint8Array`, `intrinsicConstructorName`, `StorageContractConflictPolicy`, `IStorageContractConflictPolicy` |

## Store contracts

`IKeyValueStore` is L0: `backend`, `capabilities`, async `get`, `set`, `remove`, `has`, `keys`, `clearValues`, `clearAll`, `dispose`, and optional `sync`. L0 keys and values are strings; missing `get` values are `null`.

`ISyncKeyValueStore` has synchronous `get`, `set`, `remove`, `has`, `keys`, and `clearValues`. `ISyncCapableStore<T>` makes its `sync` property required. Sync `set` accepts only `ISyncWriteOptions` (`conflictPolicy`), never signal or timeout.

`IRecordStore<T>` extends L0 with `getBytes`/`setBytes`/`clearBytes`, `getRecord`/`putRecord`/`deleteRecord`/`clearRecords`, `iterateRecords(range?, ctx?)`, and `transaction(run, ctx?)`. `putRecord(value, key?)` returns its `IStorageKey`; optional `metadata` provides backend-owned get/set/delete for resumable maintenance.

## Capabilities and keys

`IStorageCapabilities` has `syncRead`, `binary`, `records`, `transactions`, `iteration`, `maxValueBytes`, and `opaqueEntries`. Use `isKeyValueStore` for untrusted L0 boundaries, `isRecordStore` to branch, and `asRecordStore` to require L1; the latter throws `UNSUPPORTED_CAPABILITY` if shape or flags are insufficient.

`IStorageKey` permits string, finite number, `Date`, `ArrayBuffer`, or non-empty nested arrays of those values. `assertStorageKey` validates it, `snapshotStorageKey` detaches it, and `compareStorageKeys` orders it. Limits: depth 32, 4,096 nodes, 1 MiB binary key. Use `assertStringStorageKey` for L0/bytes/metadata keys. `IKeyRange` has portable `lower`, `lowerOpen`, `upper`, and `upperOpen` bounds.

## Codecs and operation context

`ICodec<T, TRaw>` declares `name`, `output: 'text' | 'binary' | 'structured'`, and async `encode`/`decode`. `snapshotCodec` and `assertCodec` enforce that boundary; backend-aware codec routing belongs to `storage-web`.

```ts
type IOperationContext = {
  signal?: IAbortSignal;
  timeoutMs?: number;
  pageSize?: number;
};
```

`timeoutMs` is a non-negative safe integer; `pageSize` is an integer from 1 through 4096. `IWriteOptions` adds `conflictPolicy: 'conflict' | 'replace'`; `ConflictPolicy` and `StorageContractConflictPolicy` expose those values. `snapshotOperationContext`, `assertOperationContext`, `snapshotSyncWriteOptions`, and `assertSyncWriteOptions` validate them.

## Transactions, lifecycle, and errors

`ITransactionScope<T>` offers `get`, `put`, and `delete`. `assertTransactionCallback` rejects invalid callbacks before allocation; `readTransactionConflictPolicy` defaults to `conflict`. Isolation, commit timing, and retry are implementation-defined. Do not retain a scope after its callback resolves.

| Code | Meaning | Caller action |
| --- | --- | --- |
| `INVALID_ARGUMENT` | Invalid contract input/context/descriptor | Correct input. |
| `INVALID_KEY` | Key outside domain | Correct key. |
| `UNSUPPORTED_CAPABILITY` | Required L1 capability absent | Branch or select another backend. |
| `STORE_DISPOSED` | Operation after `dispose()` | Create another store. |
| `ABORTED` | Signal or timeout cancelled operation | Treat as cancellation; check backend commit boundary if write raced it. |

All are frozen `StorageContractError` values with `source: '@migaia/storage-contract'` and an optional reachable `cause`. Use `isStorageContractError` at runtime.

## Workflow

```ts
import { asRecordStore, type IKeyValueStore } from '@migaia/storage-contract';

type IProfile = { readonly name: string };

export const readProfile = async (store: IKeyValueStore): Promise<IProfile | undefined> =>
  asRecordStore<IProfile>(store).getRecord('profile', { timeoutMs: 500 });
```

The caller may supply memory or IndexedDB storage; this helper remains platform independent.

## Migration, troubleshooting, and build

When replacing package-specific store types, accept `IKeyValueStore`; narrow to `IRecordStore` only where L1 is actually required. Do not duplicate this contract.

- `UNSUPPORTED_CAPABILITY`: inspect `store.capabilities`; provider is L0-only.
- `INVALID_ARGUMENT`: verify signal shape, timeout, page size, and sync-write options.
- `INVALID_KEY`: use documented key forms, not objects.
- `STORE_DISPOSED`: ownership code ended the instance lifecycle.

```bash
pnpm --filter @migaia/storage-contract run build
pnpm --filter @migaia/storage-contract run typecheck
pnpm --filter @migaia/storage-contract run test
```
