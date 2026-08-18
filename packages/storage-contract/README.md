# @migaia/storage-contract

Runtime-neutral TypeScript contract for key-value and record storage. It owns common store shapes, capability descriptors, storage keys, codecs, operation context, transactions, and contract errors.

## Purpose and fit

Use it when a package accepts or exposes storage without depending on a browser, DOM, IndexedDB, Node, or a persistence implementation. It is not a storage engine: it opens no database, persists no value, and ships no browser backend. Use `@migaia/storage-web` for browser implementations.

## Install

This workspace-private package is consumed inside this monorepo:

```bash
pnpm --filter <consumer-package> add @migaia/storage-contract@workspace:^
```

## Quick start

```ts
import type { IKeyValueStore } from '@migaia/storage-contract';

export const loadTheme = async (store: IKeyValueStore): Promise<string> =>
  (await store.get('theme')) ?? 'system';
```

Require L1 records only at the feature boundary:

```ts
import { asRecordStore, type IKeyValueStore } from '@migaia/storage-contract';

export const saveProfile = async (store: IKeyValueStore): Promise<void> => {
  await asRecordStore<{ name: string }>(store).putRecord({ name: 'Ada' }, 'profile');
};
```

## Core API

- `IKeyValueStore`: async `get`/`set`/`remove`/`has`/`keys`/`clearValues`/`clearAll`/`dispose` over string keys and values.
- `IRecordStore<T>`: L0 plus bytes, structured records, iteration, metadata, and transactions.
- `ISyncKeyValueStore` and `ISyncCapableStore<T>`: optional sync surface implemented by sync backends.
- `IStorageCapabilities`, `isStorageCapabilities`, `isKeyValueStore`, `isRecordStore`, `asRecordStore`: capability descriptor and runtime boundary guards.
- `IOperationContext`, `IWriteOptions`, `IStorageKey`, `IKeyRange`, `ICodec`, and validation/snapshot helpers.
- `StorageContractError` and `StorageContractErrorCode`: stable common failures.

## Export map

Only root import is public; there are no subpath exports:

```ts
import { asRecordStore, StorageContractError, type IKeyValueStore } from '@migaia/storage-contract';
```

## Platform, lifecycle, and errors

No DOM, IndexedDB, Node, Worker, or storage-engine dependency exists here. `dispose()` is implemented by each provider; later operations must fail with `STORE_DISPOSED`. Async operations accept a compatible `signal`, non-negative `timeoutMs`, and optionally a bounded `pageSize`; sync writes accept only `conflictPolicy`.

`StorageContractError` is frozen, has `source === '@migaia/storage-contract'`, a stable `code`, and preserves an optional `cause`. Codes: `INVALID_ARGUMENT`, `INVALID_KEY`, `UNSUPPORTED_CAPABILITY`, `STORE_DISPOSED`, and `ABORTED`. Backend-specific failures belong to the implementation package.

Full API, workflow, lifecycle, migration, troubleshooting, and build reference: [USEGUIDE.md](./USEGUIDE.md).
