# `@migaia/storage-contract`

[中文](./README.md)

Give features and storage implementations shared interfaces, key rules and validation boundaries, with a text codec that preserves Map/Set. Backends perform the actual storage operations.

## You may have run into this

- Changing backends forces changes in feature code because features depend on concrete implementations without a shared interface.
- Permissions read from JSON lose their Map/Set types because native JSON has no collection representation.
- A key changes while an async write is waiting because the operation still shares the caller’s array, Date or buffer.
- Layers observe different timeouts or conflict policies because they reread changing option getters.
- Logs retain only a failure message because a boundary discards the original cause and stable error identity.

## Why choose it

- **Collection types survive a text round trip.** Native JSON loses Map/Set values; the built-in codec uses one versioned tuple format at both ends and restores nested types. [Run the example](./USEGUIDE.en.md#restore-nested-map-and-set-values-from-text).
- **Mutable key components stop sharing the caller’s objects.** A shallow array copy still shares Dates and buffers; key snapshots recursively copy and revalidate them. [Run the example](./USEGUIDE.en.md#capture-a-composite-key-before-its-owner-changes-it).
- **Capability decisions use one admitted description.** Truthy checks can accept invalid fields, and retaining the input lets later mutation change a decision. Capability snapshots validate fields, default only two legacy flags to false and return a separate record. [Run the example](./USEGUIDE.en.md#normalize-an-older-capability-descriptor-before-choosing-a-channel).
- **An operation has one captured option record.** Rereading getters can change intent; context snapshots read fields once, freeze the record and reuse it, leaving cancellation execution to backends. [Run the example](./USEGUIDE.en.md#read-operation-options-once-without-claiming-to-execute-cancellation).
- **Failures retain the exact original object.** Message-only errors lose the diagnostic chain; contract errors preserve stable source/code fields and the exact cause. [Run the example](./USEGUIDE.en.md#keep-the-original-failure-when-reporting-a-contract-error).

## Start here

Encode nested permissions as text, then restore actual collection instances:

```ts doc-test=run
import { collectionsJsonCodec } from '@migaia/storage-contract'

const settings = { roles: new Map([['Ada', new Set(['read', 'write'])]]) }
const raw = await collectionsJsonCodec.encode(settings)
const restored = (await collectionsJsonCodec.decode(raw)) as typeof settings
console.log('output:', collectionsJsonCodec.output)
console.log('Map:', restored.roles instanceof Map)
console.log('Set:', restored.roles.get('Ada') instanceof Set)
console.log('permissions:', [...(restored.roles.get('Ada') ?? [])].join(', '))
```

Output:

```text
output: text
Map: true
Set: true
permissions: read, write
```

For keys that change during async work, see [key snapshots](./USEGUIDE.en.md#capture-a-composite-key-before-its-owner-changes-it); for repeated option reads, see [context snapshots](./USEGUIDE.en.md#read-operation-options-once-without-claiming-to-execute-cancellation).

## Pitfalls when writing it yourself

Using native JSON on the same permission data exposes these pitfalls. This example is displayed and type-checked only; it is not executed:

```ts doc-test=check
const settings = { roles: new Map([['Ada', new Set(['read', 'write'])]]) }
const raw = JSON.stringify(settings) // Pitfall: Map entries disappear into an empty object, including the nested Set.
const restored = JSON.parse(raw) as typeof settings // Pitfall: a type assertion cannot reconstruct runtime collections.
console.log(restored.roles.get('Ada')) // Pitfall: roles is a plain object, so get throws.
```

The codec above owns the version tags and collection revival, so callers do not maintain separate replacers and revivers. It still follows JSON’s data-model limits, does not support cycles and does not persist the text.

## A three-minute mental model

| Problem                                                 | Tool                                                   |
| ------------------------------------------------------- | ------------------------------------------------------ |
| A feature only needs string reads and writes            | IKeyValueStore (L0)                                    |
| Bytes, records, iteration and transactions are required | IRecordStore (L1), after asRecordStore admission       |
| Descriptors or operation options may change             | snapshotStorageCapabilities / snapshotOperationContext |
| Async work cannot retain the caller’s mutable key       | snapshotStorageKey                                     |
| Text must preserve Map/Set values                       | collectionsJsonCodec                                   |

A “contract” is the input, output and error agreement between caller and implementation. A “capability” describes operations actually available on an object. “Narrowing” checks an object before using a more specific interface. A “snapshot” captures current values; its API determines copying and freezing. A “codec” translates values to and from a storage representation.

## Typical scenarios

| Scenario                                                             | Tools                         | Details                                                                                                   |
| -------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Capture a composite key before its owner changes it                  | `snapshotStorageKey`          | [Complete example](./USEGUIDE.en.md#capture-a-composite-key-before-its-owner-changes-it)                  |
| Reject an object before treating it as a record key                  | `snapshotStorageKey`          | [Complete example](./USEGUIDE.en.md#reject-an-object-before-treating-it-as-a-record-key)                  |
| Read operation options once without claiming to execute cancellation | `snapshotOperationContext`    | [Complete example](./USEGUIDE.en.md#read-operation-options-once-without-claiming-to-execute-cancellation) |
| Restore nested Map and Set values from text                          | `collectionsJsonCodec`        | [Complete example](./USEGUIDE.en.md#restore-nested-map-and-set-values-from-text)                          |
| Normalize an older capability descriptor before choosing a channel   | `snapshotStorageCapabilities` | [Complete example](./USEGUIDE.en.md#normalize-an-older-capability-descriptor-before-choosing-a-channel)   |
| Keep the original failure when reporting a contract error            | `StorageContractError`        | [Complete example](./USEGUIDE.en.md#keep-the-original-failure-when-reporting-a-contract-error)            |

## Installation

```bash
pnpm add @migaia/storage-contract
```

Inside the workspace, use `@migaia/storage-contract@workspace:^`. The runtime dependency is `@migaia/utils`. Choose an implementation package when you need an actual backend.

## Essential APIs

| API                                                | When to use it                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| IKeyValueStore / IRecordStore                      | Define the L0/L1 boundary between features and implementations       |
| asRecordStore                                      | Verify complete capabilities before calling record methods           |
| collectionsJsonCodec                               | Round-trip Map/Set inside JSON-compatible data through text          |
| snapshotStorageKey                                 | Validate and copy a key before async work                            |
| snapshotOperationContext                           | Capture operation options once                                       |
| snapshotStorageCapabilities / StorageContractError | Admit capability descriptions and report traceable contract failures |

## Contract details

### Entry point, ownership and boundaries

The package has one root entry, `@migaia/storage-contract`, with no public subpaths. It provides storage interfaces, capability descriptions, key domains, operation contexts, codecs, transaction scopes and contract errors, plus validators, snapshot helpers and a collection JSON codec. Its runtime dependency is `@migaia/utils`; the structural `IAbortSignal` type comes from `@migaia/utils/promise`.

There is no persistence backend here. It opens no database, writes no disk, and depends on neither DOM nor IndexedDB nor Node. Connections, reads, writes, commits, isolation and retry belong to implementations such as `@migaia/storage-web`. Features depend on these interfaces; implementations depend on the contract, never the reverse. Compression, encryption or Worker recoding can implement the same codec interface, but those extensions are not supplied here.

L0 means the string key-value channel shared by all backends. L1 adds bytes, structured records, iteration and transactions. Capabilities describe available operations instead of asking callers to guess from a backend name. Narrowing checks descriptors and callable methods without performing storage operations.

### L0, synchronous access and L1

`IBackendKind` accepts only `'local'`, `'session'`, `'cookie'`, `'indexeddb'` and `'memory'`. Read-only `backend` and `capabilities` identify an IKeyValueStore's backend and abilities. Keys in this table are strings. Async ctx arguments default to undefined; their fields are described below.

| IKeyValueStore member   | Result and meaning                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `get(key, ctx?)`        | `Promise<string \| null>`; a missing value is null, not undefined.                                |
| `set(key, value, ctx?)` | Writes a string value; ctx is IWriteOptions. Returns `Promise<void>`.                             |
| `remove(key, ctx?)`     | Returns `Promise<void>`.                                                                          |
| `has(key, ctx?)`        | Returns `Promise<boolean>`.                                                                       |
| `keys(ctx?)`            | Returns `Promise<string[]>`.                                                                      |
| `clearValues(ctx?)`     | Clears only the string-value channel; returns `Promise<void>`.                                    |
| `clearAll(ctx?)`        | Clears the store's application-data channels; returns `Promise<void>`.                            |
| `dispose()`             | Ends the backend instance's usable lifetime; returns `Promise<void>`.                             |
| `sync?`                 | Optional ISyncKeyValueStore, available only on synchronous backends; undefined on async backends. |

`ISyncKeyValueStore` provides `get(key): string | null`, `set(key, value, options?): void`, `remove(key): void`, `has(key): boolean`, `keys(): string[]` and `clearValues(): void`. Sync set accepts only conflictPolicy, without a meaningful signal or timeoutMs. Synchronous local, session, memory and cookie backends may expose sync; asynchronous IndexedDB does not. `ISyncCapableStore<TStore>` makes a store variant's optional sync field required for a backend factory's return type; it creates no sync implementation.

`IRecordStore<TValue>` retains all L0 members and adds the following. TValue defaults to unknown. Record keys use IStorageKey; byte and metadata keys remain strings.

| Additional IRecordStore member                  | Result and meaning                                                                                                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getBytes(key, ctx?)`                           | `Promise<Uint8Array \| null>`; null when absent.                                                                                                                               |
| `setBytes(key, value, ctx?)`                    | value is Uint8Array, ctx is IWriteOptions; returns `Promise<void>`.                                                                                                            |
| `clearBytes(ctx?)`                              | Clears the byte channel.                                                                                                                                                       |
| `getRecord(key, ctx?)`                          | `Promise<TValue \| undefined>`; undefined when absent.                                                                                                                         |
| `putRecord(value, key?, ctx?)`                  | `Promise<IStorageKey>`; an omitted key is generated and returned by the backend. ctx is IWriteOptions.                                                                         |
| `deleteRecord(key, ctx?)`, `clearRecords(ctx?)` | Delete records; return `Promise<void>`.                                                                                                                                        |
| `clearAll(ctx?)`                                | Clears values, bytes and records together.                                                                                                                                     |
| `metadata?`                                     | Optional backend maintenance channel. get(key, ctx?) returns unknown or undefined; set(key, value, ctx?) and delete(key, ctx?) return `Promise<void>`. set uses IWriteOptions. |
| `iterateRecords(range?, ctx?)`                  | Async iterator of [IStorageKey, TValue] pairs.                                                                                                                                 |
| `transaction(run, ctx?)`                        | run receives `ITransactionScope<TValue>` and returns `Promise<T>`; transaction returns `Promise<T>`.                                                                           |

Metadata supports resumable maintenance migrations and remains separate from values, bytes and records. It is outside clearAll/clearRecords. An omitted range supplies no explicit bound; the implementation interprets queries.

#### Runtime admission and narrowing

| API                                                             | Input and result                                                                                                                                                                                                        |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isKeyValueStore(store)`                                        | Takes unknown. Requires a known backend, valid capability descriptor and every callable L0 method. Returns a boolean without invoking methods; accessor failures return false.                                          |
| `isRecordStore(store)`                                          | Takes IKeyValueStore. Also requires all L1 methods plus records, binary, transactions and iteration set to true.                                                                                                        |
| `asRecordStore<T>(store)`                                       | Returns the same object as `IRecordStore<T>`, without wrapping or fallback. Throws UNSUPPORTED_CAPABILITY when incomplete. T defaults to unknown.                                                                       |
| `snapshotKeyValueStore(store)`, `snapshotRecordStore<T>(store)` | Take unknown and return a new description { store, backend, capabilities }, or undefined on failure. store remains the original reference.                                                                              |
| `snapshotKeyValueStoreDetailed(store)`                          | Success is { valid: true, store, backend, capabilities, dispose, receiver }; failure is { valid: false, cause }. dispose is the admitted function and receiver is the original store for receiver-preserving ownership. |

Admission reads relevant properties once. Detailed results retain exact reflection or getter failures. Predicates and lightweight snapshots return a failure value; as assertions throw StorageContractError with the original accessor error on cause. asRecordStore reports the detected valid backend, or undefined if unavailable. A description snapshot freezes neither the original store nor its implementation behavior. Composing callers should reuse an admitted description instead of reading the same getters again.

### Capability descriptors

`IStorageCapabilities` has nine read-only fields. snapshotStorageCapabilities(value) takes unknown, reads once and returns a new description, not the original object. It is not guaranteed to be frozen. Invalid types or failing accessors return undefined rather than throwing. `isStorageCapabilities(value)` tests whether snapshot admission succeeds; it does not write normalized fields back to the input.

| Field              | Meaning, default and range                                                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `syncRead`         | Required boolean: synchronous reads are available.                                                                                               |
| `binary`           | Required boolean: a byte channel is available.                                                                                                   |
| `records`          | Required boolean: structured records are available.                                                                                              |
| `transactions`     | Required boolean: transactions are available.                                                                                                    |
| `iteration`        | Required boolean: iteration is available.                                                                                                        |
| `secondaryIndexes` | Boolean in current descriptors; legacy omission normalizes to false in the snapshot.                                                             |
| `changeFeed`       | Boolean in current descriptors; legacy omission normalizes to false in the snapshot.                                                             |
| `maxValueBytes`    | Nonnegative safe integer or undefined: approximate per-value byte limit. Undefined makes no such limit declaration; total quota may still apply. |
| `opaqueEntries`    | Required boolean: entries hidden from JavaScript may exist, such as HttpOnly cookies.                                                            |

Existing backend descriptions use approximately 4096 bytes for cookies and 5 MB for localStorage; IndexedDB commonly uses undefined because total quota is the main limit. These describe capabilities, not quotas measured or implemented by this package.

### Operation contexts, writes and snapshots

`IOperationContext` is the optional final argument to async operations. `IWriteOptions` additionally permits conflictPolicy.

| Field            | Omission and constraints                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `signal`         | Undefined. Structural IAbortSignal with boolean aborted and callable addEventListener/removeEventListener. The original signal reference is retained. |
| `timeoutMs`      | Undefined, or a nonnegative safe integer including 0. Implementations own timers and composition with external signals; the contract only validates.  |
| `pageSize`       | Undefined, or an integer from 1 through 4096 for implementation-level paging.                                                                         |
| `conflictPolicy` | Remains undefined when omitted from a snapshot. The write contract defaults to conflict. Accepted values are 'conflict', 'replace' or undefined.      |

`ConflictPolicy.conflict` is `'conflict'`: fail when a value already exists. `ConflictPolicy.replace` is `'replace'`: replace it. Use this constant and IConflictPolicy instead of duplicate constants or aliases.

`snapshotOperationContext(ctx)` accepts a context or undefined. Undefined stays undefined. For a valid object it reads signal, timeoutMs, pageSize and conflictPolicy once, then returns a frozen snapshot. Passing one of its own snapshots again returns that exact object without rereading original getters. Invalid objects, fields, signal shapes or getter failures throw INVALID_ARGUMENT, retaining the original cause. `assertOperationContext(ctx)` performs the same validation but discards the result.

Only context fields are frozen, not signal state. A structurally valid already-aborted signal still passes admission. This package neither waits for operations nor starts timers or a cancellation engine. Cancellation-aware backends use ABORTED to stop waiting, without promising a native AbortError. A write already inside atomic commit reports its actual commit outcome rather than claiming rollback.

`ISyncWriteOptions` permits only optional conflictPolicy. `snapshotSyncWriteOptions(options)` takes an object or undefined, reads signal, timeoutMs and conflictPolicy, and rejects non-undefined signal/timeoutMs. Explicit undefined values are accepted. Extra pageSize is not read and grants no synchronous paging. The new { conflictPolicy } object is not frozen, and omission stays undefined. `assertSyncWriteOptions(options)` validates without returning a snapshot. Invalid shapes, fields and getters produce INVALID_ARGUMENT.

### Keys and ranges

`IStorageKey` accepts strings, finite numbers, valid Dates, ArrayBuffers, or nonempty nested read-only arrays of those values. Arrays cannot be sparse or cyclic.

| API or constant                                  | Rule                                                                                                                                                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assertStorageKey(value, backend, label?)`       | value is unknown. backend is the caller's selected IBackendKind, used for error details. label defaults to 'key' for error text. Invalid input throws INVALID_KEY with the original key.        |
| `snapshotStorageKey(value, backend, label?)`     | Same inputs. Validates, copies Dates, ArrayBuffers and nested arrays, then validates again. Strings/numbers remain unchanged. Mutable inputs are detached from the result, which is not frozen. |
| `assertStringStorageKey(value, backend, label?)` | L0, byte and metadata channels require string keys. label defaults to 'key'. Non-strings produce INVALID_ARGUMENT rather than INVALID_KEY.                                                      |
| `compareStorageKeys(a, b)`                       | Takes two valid IStorageKey values and returns a negative number, zero or positive number for sort. It does not promise only -1/0/1.                                                            |
| `KEY_DOMAIN_LIMITS.maxDepth`                     | 32, with the root at depth 0.                                                                                                                                                                   |
| `KEY_DOMAIN_LIMITS.maxNodes`                     | 4096, counting arrays and leaves visited.                                                                                                                                                       |
| `KEY_DOMAIN_LIMITS.maxBinaryBytes`               | 1,048,576 bytes for each binary key component.                                                                                                                                                  |

Dates must have a valid timestamp; numbers must be finite. Date and binary classification use structuredClone when available for cross-realm input. Without it, Date classification uses local Date identity. Binary branding comes from utils/bytes; a forged constructor.name is insufficient. Copy or revalidation failures become INVALID_KEY; existing StorageContractErrors pass through.

Type ordering is number < Date < string < ArrayBuffer < array. Numbers compare by difference, Dates by timestamp and strings lexically. Binary values compare byte by byte; equal prefixes favor the shorter value. Arrays compare recursively by element, with shorter equal prefixes first.

`IKeyRange` has optional lower/upper IStorageKey bounds and boolean lowerOpen/upperOpen flags to exclude their respective endpoints. It follows IDBKeyRange semantics without depending on that host type. This package fills no omitted defaults; the implementation interprets them.

### Codecs and collection JSON

`ICodec<T, TRaw>` defaults T to unknown and TRaw to string | Uint8Array | unknown (effectively unknown). It requires name, output, encode and decode. encode(value, ctx?) returns `Promise<TRaw>`; decode(raw, ctx?) returns `Promise<T>`. Context defaults to undefined and follows the operation-context shape. `ICodecOutput` is text, binary or structured. Callers route by output and backend capabilities; this package performs no implicit conversion to make an unsupported representation fit.

`snapshotCodec(codec)` takes unknown. It requires a non-null, non-array object, including a class instance satisfying the shape. name must be nonblank after trimming, output must be one of the three values, and encode/decode must be callable. Each of the four fields is read once. The new shallow { name, output, encode, decode } description retains function references without binding their old receiver and is not frozen. `assertCodec(codec)` checks the same shape and narrows the input type without returning a description. Bad shapes and reads produce INVALID_ARGUMENT.

`collectionsJsonCodec` is the built-in frozen codec. Its name is `COLLECTIONS_JSON_CODEC_NAME`, or `'migaia-collections-json-v1'`, and output is text. Maps and Sets become three-item tuples containing that version name, a map/set kind and an array payload. Decoding interprets only the exact reserved forms. Ordinary or merely similar arrays are left alone; arrays exactly matching the reserved form are interpreted as collections, so that tuple form is unavailable as ordinary application data.

Other values retain JSON's limits: this is not lossless serialization of arbitrary object graphs. Unrepresentable roots, cycles, BigInts and other JSON encoding failures produce INVALID_ARGUMENT, as do non-string input, invalid JSON and invalid reserved collection payloads. Original failures stay on cause. Browser structured/binary codecs belong to storage-web. Custom compression, encryption and Worker codecs implement the same interface outside this package.

### Transaction scopes and conflict policies

`ITransactionScope<TValue>` has only get(key): `Promise<TValue | undefined>`, put(value, key?, options?): `Promise<IStorageKey>`, and delete(key): `Promise<void>`. Keys are IStorageKey; omitted put keys are generated by the implementation. `ITransactionWriteOptions` has only optional conflictPolicy.

Isolation, commit timing and retry are implementation-defined. This package executes no transaction. Do not retain and use a scope after its callback resolves; its connection or snapshot may have been released. `assertTransactionCallback(run, backend)` checks that run is callable before the implementation allocates resources, otherwise throwing INVALID_ARGUMENT with backend details.

`readTransactionConflictPolicy(options, backend)` takes undefined or an object. Omitted options or conflictPolicy return conflict; replace returns replace. A bare policy string, malformed object or field produces INVALID_ARGUMENT; getter failures preserve the exact cause. It only reads policy and performs no write.

### Change feeds and secondary-index extensions

`IChangeFeedStore` extends L0 with subscribeChanges(listener): unsubscribe. The listener receives post-commit IStorageChange notifications; callers retain and invoke the cancellation function. sequence is an increasing sequence number and origin identifies the source. channel is value, bytes, record or all; kind is put, remove, clear, batch or migrate. Optional scope and keys may be omitted; keys contain IStorageKey values. This declares notifications without creating a channel or cross-window carrier.

`isChangeFeedStore(candidate)` requires full L0, changeFeed true and callable subscribeChanges. `asChangeFeedStore(store)` returns the same object's capability view. Incomplete capability throws UNSUPPORTED_CAPABILITY; original method/capability getter failures stay on cause.

`ISecondaryIndexRecordStore<TValue>` retains all L1 members and adds five methods:

| Method                                                   | Input and result                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `ensureRecordIndexes(scope, definitions, ctx?)`          | Caller-named scope and definitions array; returns IRecordIndexHandle.                                        |
| `getRecordIndexReadiness(handle, ctx?)`                  | Uses the ensureRecordIndexes handle; returns status plus scanned/indexed counts.                             |
| `putIndexedRecord(value, key, handle, projection, ctx?)` | Uses an explicit primary key, admitted handle and projection; ctx is IWriteOptions. Returns the primary key. |
| `iterateRecordIndex(query, ctx?)`                        | Async iterator of [primary key, TValue] according to query.                                                  |
| `transactionIndexed(handle, run, ctx?)`                  | The callback receives ISecondaryIndexTransactionScope; returns the callback's Promise result.                |

Definitions require name, unique, multiEntry and revision. Handles require scope, generation and fingerprint. Readiness status is pending, running, complete or failed, with scanned/indexed counts. A handle is generation-bound; do not substitute only an index name.

Queries require handle and index, with optional range, direction (next/prev) and limit. Omitted fields stay unset here; query defaults belong to implementations. A projection maps index names to undefined, { kind: 'single', key }, or { kind: 'multiple', keys }. Indexed transaction scopes have get(key), put(value, key, projection) and delete(key), unlike the optional-key/conflict-options form of ordinary transaction put.

`isSecondaryIndexRecordStore(candidate)` and `asSecondaryIndexRecordStore(store)` require full L1, secondaryIndexes true and all five callable extension methods, without invoking them. Assertion failures are UNSUPPORTED_CAPABILITY, with reflection/getter failures retained on cause. Extension assertions do not add backend details; their failed backend field is undefined.

### Errors and diagnostic ownership

`new StorageContractError(code, details?, message?)` freezes the error immediately. code is required; details defaults to {}, with optional backend, key and cause defaulting to undefined. backend is IBackendKind, key is a string or IStorageKey, and cause is the original failure. The default message is `[storage-contract] ${code}`. The name is StorageContractError; source is always `STORAGE_CONTRACT_SOURCE`, or `'@migaia/storage-contract'`. Stack is not overwritten, and standard cause still reaches the original object.

`isStorageContractError(value)` checks instanceof this package's error class. Codes are public API. Implementation packages own separate error sources; use (source, code) to identify the owner. Web codec, migration and extension diagnostics belong to storage-web, not this neutral details type.

| StorageContractErrorCode member | Code                     | Caller response                                                                                                   |
| ------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `invalidArgument`               | `INVALID_ARGUMENT`       | Correct invalid descriptors, contexts, sync writes or transaction options rather than retrying the same input.    |
| `invalidKey`                    | `INVALID_KEY`            | Correct key type, depth, node/byte limits, cycles, empty arrays or sparse entries.                                |
| `unsupported`                   | `UNSUPPORTED_CAPABILITY` | Branch by capability or choose another implementation; no silent fallback.                                        |
| `disposed`                      | `STORE_DISPOSED`         | Create a new store instead of using an ended instance.                                                            |
| `aborted`                       | `ABORTED`                | Treat implementation-level signal/timeout cancellation as cancellation; atomic commit reports the actual outcome. |

Import byte guards from `@migaia/utils/bytes`; this package no longer re-exports them. Internal-slot branding does not prove bytes remain readable: detached objects may retain their brand. `intrinsicConstructorName(value)` is best-effort diagnostics only, observing mutable prototype, constructor and name properties. Nonobjects, null and failed reads return undefined. Never use it for security, type or protocol classification.

### Integration steps and build commands

A feature may accept only IKeyValueStore, narrowing when it actually needs records:

1. Validate and retain the call's context through snapshotOperationContext(ctx).
2. Narrow through `asRecordStore<IProfile>`(store); use its existing UNSUPPORTED_CAPABILITY failure instead of inventing a bare Error.
3. Use tx.get/put/delete in records.transaction, passing the context snapshot to transaction.
4. Return the callback result. The actual backend owns connections, atomic commit and retry.

For a text-only backend, the caller explicitly selects a text codec or conversion. A binary flag alone does not replace complete record-store admission. Validate custom gzip, encryption or Worker codecs with assertCodec/snapshotCodec before giving them to implementations.

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
```
