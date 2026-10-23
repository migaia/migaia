# `@migaia/storage-contract`

[中文](./README.md)

Give features and storage implementations shared interfaces, key rules and validation boundaries, with an adapter to the shared serialize codecs. Backends perform the actual storage operations.

## You may have run into this

- Changing backends forces changes in feature code because features depend on concrete implementations without a shared interface.
- Permissions read from JSON lose their Map/Set types because native JSON has no collection representation.
- A key changes while an async write is waiting because the operation still shares the caller’s array, Date or buffer.
- Layers observe different timeouts or conflict policies because they reread changing option getters.
- Logs retain only a failure message because a boundary discards the original cause and stable error identity.

## Why choose it

- **Collection types survive a text round trip.** Native JSON loses Map/Set values; the shared serialize collection codec owns the format at both ends, while the adapter preserves its types. [Run the example](./USEGUIDE.en.md#restore-nested-map-and-set-values-from-text).
- **Mutable key components stop sharing the caller’s objects.** A shallow array copy still shares Dates and buffers; key snapshots recursively copy and revalidate them. [Run the example](./USEGUIDE.en.md#capture-a-composite-key-before-its-owner-changes-it).
- **Capability decisions use one admitted description.** Truthy checks can accept invalid fields, and retaining the input lets later mutation change a decision. Capability snapshots validate fields, default only two legacy flags to false and return a separate record. [Run the example](./USEGUIDE.en.md#normalize-an-older-capability-descriptor-before-choosing-a-channel).
- **An operation has one captured option record.** Rereading getters can change intent; context snapshots read fields once, freeze the record and reuse it, leaving cancellation execution to backends. [Run the example](./USEGUIDE.en.md#read-operation-options-once-without-claiming-to-execute-cancellation).
- **Failures retain the exact original object.** Message-only errors lose the diagnostic chain; contract errors preserve stable source/code fields and the exact cause. [Run the example](./USEGUIDE.en.md#keep-the-original-failure-when-reporting-a-contract-error).

## Start here

Encode nested permissions as text, then restore actual collection instances:

```ts doc-test=run
import { fromValueCodec } from '@migaia/storage-contract'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'

const codec = fromValueCodec(defineCollectionsJsonCodec({ version: 1 }))

const settings = new Map([['Ada', new Set(['read', 'write'])]])
const raw = await codec.encode(settings)
const restored = await codec.decode(raw)
if (!(restored instanceof Map)) throw new Error('Expected Map')
const permissions = restored.get('Ada')
if (!(permissions instanceof Set)) throw new Error('Expected Set')
console.log('output:', codec.output)
console.log('Map:', restored instanceof Map)
console.log('Set:', permissions instanceof Set)
console.log('permissions:', [...permissions].join(', '))
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
| Text must preserve Map/Set values                       | fromValueCodec                                         |

A “contract” is the input, output and error agreement between caller and implementation. A “capability” describes operations actually available on an object. “Narrowing” checks an object before using a more specific interface. A “snapshot” captures current values; its API determines copying and freezing. A “codec” translates values to and from a storage representation.

## Typical scenarios

| Scenario                                                             | Tools                         | Details                                                                                                   |
| -------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Capture a composite key before its owner changes it                  | `snapshotStorageKey`          | [Complete example](./USEGUIDE.en.md#capture-a-composite-key-before-its-owner-changes-it)                  |
| Reject an object before treating it as a record key                  | `snapshotStorageKey`          | [Complete example](./USEGUIDE.en.md#reject-an-object-before-treating-it-as-a-record-key)                  |
| Read operation options once without claiming to execute cancellation | `snapshotOperationContext`    | [Complete example](./USEGUIDE.en.md#read-operation-options-once-without-claiming-to-execute-cancellation) |
| Restore nested Map and Set values from text                          | `fromValueCodec`              | [Complete example](./USEGUIDE.en.md#restore-nested-map-and-set-values-from-text)                          |
| Normalize an older capability descriptor before choosing a channel   | `snapshotStorageCapabilities` | [Complete example](./USEGUIDE.en.md#normalize-an-older-capability-descriptor-before-choosing-a-channel)   |
| Keep the original failure when reporting a contract error            | `StorageContractError`        | [Complete example](./USEGUIDE.en.md#keep-the-original-failure-when-reporting-a-contract-error)            |

## Installation

```bash
pnpm add @migaia/storage-contract
```

Inside the workspace, use `@migaia/storage-contract@workspace:^`. Dependencies are `@migaia/utils` and `@migaia/serialize`; serialize is imported only as a type by this adapter. Choose an implementation package when you need an actual backend.

## Essential APIs

| API                                                | When to use it                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| IKeyValueStore / IRecordStore                      | Define the L0/L1 boundary between features and implementations       |
| asRecordStore                                      | Verify complete capabilities before calling record methods           |
| fromValueCodec                                     | Round-trip Map/Set inside JSON-compatible data through text          |
| snapshotStorageKey                                 | Validate and copy a key before async work                            |
| snapshotOperationContext                           | Capture operation options once                                       |
| snapshotStorageCapabilities / StorageContractError | Admit capability descriptions and report traceable contract failures |

## Contract details

### Entry point, ownership and boundaries

The package has one root entry, `@migaia/storage-contract`, with no public subpaths. It provides storage interfaces, capability descriptions, key domains, operation contexts, codecs, transaction scopes and contract errors, plus validators, snapshot helpers and a serialize codec adapter. Its declared dependencies are `@migaia/utils` and `@migaia/serialize`; the adapter imports serialize types only; the structural `IAbortSignal` type comes from `@migaia/utils/promise`.

There is no persistence backend here. It opens no database, writes no disk, and depends on neither DOM nor IndexedDB nor Node. Connections, reads, writes, commits, isolation and retry belong to implementations such as `@migaia/storage-web`. Features depend on these interfaces; implementations depend on the contract, never the reverse. Compression, encryption or Worker recoding can implement the same codec interface, but those extensions are not supplied here.

L0 means the string key-value channel shared by all backends. L1 adds bytes, structured records, iteration and transactions. Capabilities describe available operations instead of asking callers to guess from a backend name. Narrowing checks descriptors and callable methods without performing storage operations.

### L0, synchronous access and L1

`IBackendKind` is an open string type; runtime admission requires `[a-z][a-z0-9-]{0,63}`. Names describe providers and do not grant capability access. Read-only `backend` and `capabilities` identify an IKeyValueStore's backend and abilities. Keys in this table are strings. Async ctx arguments default to undefined; their fields are described below.

| IKeyValueStore member   | Result and meaning                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| `get(key, ctx?)`        | `Promise<string \| null>`; a missing value is null, not undefined.                                |
| `set(key, value, ctx?)` | `set` writes the string value using IWriteOptions and returns `Promise<void>` for that write.     |
| `remove(key, ctx?)`     | `remove` deletes the named string-channel entry and returns `Promise<void>` for that deletion.    |
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
| `removeBytes(key, ctx?)`                        | Deletes only this key from the byte channel, leaving text and records alone; a missing key succeeds, so repeated deletion is idempotent. Required L1 method.                   |
| `clearBytes(ctx?)`                              | Clears the byte channel.                                                                                                                                                       |
| `getRecord(key, ctx?)`                          | `Promise<TValue \| undefined>`; undefined when absent.                                                                                                                         |
| `putRecord(value, key?, ctx?)`                  | `Promise<IStorageKey>`; an omitted key is generated and returned by the backend. ctx is IWriteOptions.                                                                         |
| `deleteRecord(key, ctx?)`, `clearRecords(ctx?)` | Delete records; return `Promise<void>`.                                                                                                                                        |
| `clearAll(ctx?)`                                | Clears values, bytes and records together.                                                                                                                                     |
| `metadata?`                                     | Optional backend maintenance channel. get(key, ctx?) returns unknown or undefined; set(key, value, ctx?) and delete(key, ctx?) return `Promise<void>`. set uses IWriteOptions. |
| `iterateRecords(range?, ctx?)`                  | Async iterator of [IStorageKey, TValue] pairs.                                                                                                                                 |
| `transaction(run, ctx?)`                        | run receives the complete scope and returns TResult; transaction returns `Promise<Awaited<TResult>>`.                                                                          |

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
| `secondaryIndexes` | secondaryIndexes is a boolean indicating logical secondary-index support; the snapshot sets an omitted legacy secondaryIndexes field to false.   |
| `changeFeed`       | changeFeed is a boolean indicating post-commit invalidation notifications; the snapshot sets an omitted legacy changeFeed field to false.        |
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

`snapshotOperationContext(ctx)` accepts a context or undefined. Undefined stays undefined. For a valid object it reads signal, timeoutMs, pageSize, conflictPolicy and orgId once, then returns a frozen snapshot. Passing one of its own snapshots again returns that exact object without rereading original getters. Invalid objects, fields, signal shapes or getter failures throw INVALID_ARGUMENT, retaining the original cause. `assertOperationContext(ctx)` performs the same validation but discards the result.

Only context fields are frozen, not signal state. A structurally valid already-aborted signal still passes admission. These context helpers neither wait for operations nor start timers or a cancellation engine. Cancellation-aware backends use ABORTED to stop waiting, without promising a native AbortError. A write already inside atomic commit reports its actual commit outcome rather than claiming rollback.

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

`fromValueCodec` adapts a serialize codec without implementing another value format. Compose `defineCollectionsJsonCodec({ version: 1 })` to preserve Map/Set with the serialize-owned `$rpc` map/entries and set/values records. The adapter name is `collections-json@1`, output is text, and unsupported values are rejected by serialize.

Other values retain JSON's limits: this is not lossless serialization of arbitrary object graphs. Unrepresentable roots, cycles, BigInts and other JSON encoding failures produce INVALID_ARGUMENT, as do non-string input, invalid JSON and invalid reserved collection payloads. Original failures stay on cause. Browser structured/binary codecs belong to storage-web. Custom compression, encryption and Worker codecs implement the same interface outside this package.

### Transaction scopes and conflict policies

`ITransactionScope<TValue>` covers text `get/set/remove/has`, bytes `getBytes/setBytes/removeBytes`, and records `getRecord/putRecord/deleteRecord/iterateRecords`. Text and bytes return null when absent; records return undefined. Records use `IStorageKey`, and omitted putRecord keys request backend generation. The old record `put/delete` names are removed; `get` now reads text. Methods inherit the transaction context and only writes accept reduced conflict options. Optional `putIndexedRecord/iterateRecordIndex` signatures are reused by `ISecondaryIndexTransactionScope` rather than redeclared.

`createTransactionOwner` registers one original store and authentic view identities. Backends hold register/createScope/onFailure and lifecycle control; features use `assertTransactionOwner`, `runTransactionOperation`, `registerTransactionFinalizer` and `nextTransactionIterator`. Operation callbacks start synchronously on a fresh complete view. stopAdmission closes only the user view; already-admitted work drains on its own view. Every check and final library beforeCommit gets a new view, runs once, drains children and releases iterators before the next check. A caught or unawaited operation failure still locks the backend-normalized first failure and notifies rollback. No new database, runner or current-scope global exists here.

`register` also accepts the backend's captured `context`. It reuses `snapshotOperationContext` to capture frozen fields once and retain the original signal. `readTransactionOperationContext(scope)` returns that same snapshot only for an authentic live user, operation or check view; omitted context returns undefined, while forged or expired views throw INVALID_ARGUMENT. Terminal close releases the registration's context reference. This read-only access grants no registration, close or cancellation-controller authority and creates no second timeout budget.

The optional `ITransactionScope.isRecordIndexReady?(handle)` reads only the same native transaction snapshot. Missing, pending or stale indexes return false; true requires complete metadata matching the handle generation and fingerprint. It neither builds nor refreshes an index and never opens another transaction. Existing scopes without this method remain valid; `ISecondaryIndexTransactionScope` still requires only its original indexed read and write methods.

`deriveTransactionIterator(iterator, read, close?)` derives a resource only from an actual iterator registered by the original owner. Unregistered sources return undefined without invoking read or close. The read arguments are the original advance function, original first-failure propagation function and the actual current next operation view, `currentScope`; existing two-argument callbacks remain valid. That view expires when the complete advance settles. Optional close releases an actual additional cursor created lazily while reading. The original resource lifetime drains accepted advances, then closes the later-created additional source before the original source, attempting both even on failure. The first failure is locked immediately in the original state; existing cleanupFailure aggregates later failures and preserves causes. Without additional close, the original cleanup function is reused directly. This grants no free scope construction, registration or store-close authority and adds no registry or lifecycle.

All ordinary and indexed record iterators return `IStorageIterator`; `IKeyValueStore` inherits the single `IStorageResource` declaration. The owner registers actual iterator objects, advances each through a current valid view, waits accepted next calls, then closes remaining resources in reverse creation order. dispose returns one cached rejecting Promise; the fixed symbolic method returns a separately cached Promise that reports and resolves. return and natural completion use that same actual cleanup. The outer host supplies its canonical asyncDisposeKey when native support is absent; the contract creates no fallback. assert on forged, wrong-store or expired scope throws INVALID_ARGUMENT, while expired data methods reject a precomputed backend TRANSACTION_FAILED without invoking factory or data callbacks.

The package owns neutral transaction coordination; native commit, isolation, cancellation and retry stay with backends. IndexedDB native activity windows are strict: obtain external data before opening a transaction. A timer await can invalidate subsequent requests; memory and SQLite manage their own activity. `assertTransactionCallback` validates callability before backend allocation. Actual backend integration remains required before claiming these interfaces prove atomic persistence.

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
3. Use tx.getRecord/putRecord/deleteRecord in records.transaction, passing the context snapshot to transaction.
4. Return the callback result. The actual backend owns connections, atomic commit and retry.

For a text-only backend, the caller explicitly selects a text codec or conversion. A binary flag alone does not replace complete record-store admission. Validate custom gzip, encryption or Worker codecs with assertCodec/snapshotCodec before giving them to implementations.

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
```

## Versioned envelopes and chained migrations

`assertVersionedEnvelope` validates own `version` and non-null `state` properties on a plain object. It reads each property once and retains the state reference. A plan snapshots and freezes a continuous version range at creation. These converters own no connections, perform no storage writes, and do not dispose borrowed resources.

```ts
import {
  assertVersionedEnvelope,
  createMigrationPlan,
  migrateEnvelopeSync,
  StorageContractError
} from '@migaia/storage-contract'

try {
  createMigrationPlan({ version: 3, steps: { 1: (value) => value, 3: (value) => value } })
} catch (error) {
  if (!(error instanceof StorageContractError)) throw error
  console.log(error.code) // MIGRATION_GAP
}

const plan = createMigrationPlan({ version: 2, steps: { 2: (value) => ({ previous: value }) } })
try {
  migrateEnvelopeSync(plan, assertVersionedEnvelope({ version: 3, state: {} }))
} catch (error) {
  if (!(error instanceof StorageContractError)) throw error
  console.log(error.code) // VERSION_UNSUPPORTED
}

const originalError = new Error('upgrade failed')
const failing = createMigrationPlan({
  version: 1,
  steps: {
    1: () => {
      throw originalError
    }
  }
})
try {
  migrateEnvelopeSync(failing, { version: 0, state: {} })
} catch (error) {
  if (!(error instanceof StorageContractError)) throw error
  console.log(error.code, error.cause === originalError) // MIGRATION_FAILED true
}
```

`migrateEnvelope` accepts asynchronous steps and cancellation. Cancellation is checked even when the archive already has the current version. The synchronous entry rejects known asynchronous steps statically and rejects runtime thenables while consuming their late rejection. A `{ version, reset: () => ({}) }` plan resets an older archive once, preserves current-version state identity, and rejects newer archives. User mutations of state and external side effects are not rolled back.

`observe.beforeStep` and `observe.afterStep` only observe; their return values are not awaited. Failures go to synchronous `observe.report` without changing migration results, or to the existing utils host report when omitted. Resource cleanup, host pipelines, and archive writes remain with their existing owners.

## Capability tokens and implementations

`defineStorageCapability` creates a frozen API token and supplies no storage implementation. Backend authors provide authentic records with `implement`, then `provideCapabilities` modifies the original resource-backed base. Backend and capability names are diagnostic; two tokens with the same name remain distinct. The provider retains class methods, nonenumerable members, and exact API types without cloning the base.

```ts
import {
  defineStorageCapability,
  implement,
  provideCapabilities,
  type IStorageBase
} from '@migaia/storage-contract'

const catalog = defineStorageCapability<{ read(key: string): Promise<string | null> }>()('catalog')
function attachCatalog(base: IStorageBase, read: (key: string) => Promise<string | null>) {
  return provideCapabilities(base, [implement(catalog, { read })])
}
```

This is an internal backend assembly function; the host still installs and disposes the resulting store. `store.use(catalog)` returns the exact implementation object. A real unregistered token throws `UNSUPPORTED_CAPABILITY` naming its backend and capability; a forged token throws `INVALID_ARGUMENT`. `store.has(token)` synchronously returns a boolean. The standard `kv` token also publishes the existing flat methods, while `has(key, ctx)` remains an asynchronous key lookup.

The original `IKeyValueStore` and raw KV admission retain the seven ordinary methods and do not claim absent native batch endpoints. A published standard `kv` API and its flat projection require `getMany`, `setMany`, `removeMany` and `removeByPrefix`. Batch keys accept `IStorageKey`; single-key and synchronous methods remain string-only. The same string shares values, locks, revisions and deadlines across both forms. getMany preserves input order and duplicate positions, with undefined for missing keys. setMany rejects canonical duplicate keys before I/O; removeMany deduplicates and returns the actual deleted count. Backends execute writes in one native transaction; empty batches open no transaction and emit no observation. ttlMs requires the installed ttl capability and otherwise rejects before I/O. The provider forwards each native method once, retaining inputs, ctx, receiver and Promise identity.

The host captures this store's unique installation port through `onInstaller`. `prepare` validates the entire authentic batch and reserves tokens, `publish` makes it visible, and `release` removes that publication idempotently. Failure does not dispose the base; the backend that created it retains rollback ownership. Transaction and query execution remain with their existing owners; pure type projection creates no transaction or connection.

### fromValueCodec

```ts
import { fromValueCodec } from '@migaia/storage-contract'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'

const codec = fromValueCodec(defineJsonCodec({ version: 2 }))
const raw = await codec.encode({ count: 1 })
console.log(codec.name, codec.output, await codec.decode(raw))
// json@2 text { count: 1 }
```

The frozen adapter snapshots all five metadata/callback fields once. Text, byte and unknown carriers map to text, binary and structured storage routes. Encode and decode keep independent input types; tagged codecs therefore retain their legacy decode inputs. Both callbacks run once and are awaited. Synchronous throws and rejected Promises become contract `INVALID_ARGUMENT` with the exact source error on cause. No second parsing, value copying, hooks, resource or connection is created. `StorageStageKind` and `ICodecStageObserver` describe observation only; actual store-bound dispatch belongs to the host.

### Resource-base admission and observer ports

`snapshotStorageBaseDetailed(candidate, { asyncDisposeKey }?)` admits `IStorageBase` without requiring key-value methods. It reads backend, capability facts and cleanup functions once. A valid `IStorageBaseAdmission` retains the original `store`, captured `backend`, detached `capabilities`, `dispose`, `receiver` and optional `asyncDispose`. Invalid shape returns `{ valid: false, cause: undefined }`; failed reflection retains the exact thrown cause. Frozen or already-provided bases remain valid because admission neither installs methods nor takes resource ownership.

The outer host may pass its fixed canonical `asyncDisposeKey`. Otherwise admission uses the native `Symbol.asyncDispose`; if native support is absent it only requires explicit disposal. The contract creates no fallback symbol and never invokes a cleanup function during admission. Provider-only extensibility and installation checks remain in `provideCapabilities`.

`IBackendStageBindings` connects seven distinct observer families: backend, operation, codec, transaction, concurrency, SQL and query. Their canonical `kind` literals prevent accidental family interchange. These declarations supply no executor or second registry; the host binds observers to the original store and transaction scope. `IConcurrencyHolder` distinguishes a real holder from a remote handoff interval, and `IConcurrencyDecision` excludes incompatible wait/reject/retry fields.

### Ordered key bytes

`encodeOrderedStorageKey(key, backend)` first reuses `snapshotStorageKey` validation and copying, then returns independently owned `Uint8Array` bytes. Lexicographic byte order agrees with `compareStorageKeys`, including signed zero, Date, UTF-16 code units, binary prefixes and nested array prefixes. The writer measures once and appends once into one allocation; it does not sort or concatenate completed child encodings. This encoding serves record indexes and lock ordering, and does not replace persisted value codecs or existing flat storage keys.

### Authentic concurrency policies

```ts
import { ConcurrencyPolicy, defineConcurrencyPolicy } from '@migaia/storage-contract'

const wait = ConcurrencyPolicy.wait({ timeoutMs: 2_000 })
const fail = ConcurrencyPolicy.fail()
const optimistic = ConcurrencyPolicy.optimistic({ retries: 2, backoffMs: 10 })
const custom = defineConcurrencyPolicy({
  name: 'retry-twice',
  locking: 'pessimistic',
  decide: (conflict) =>
    conflict.attempt <= 2 ? { action: 'retry', delayMs: 10 } : { action: 'reject' }
})
console.log(wait.name, fail.name, optimistic.locking, custom.name)
// wait fail optimistic retry-twice
```

Factories validate and capture definition fields once, freeze only public name/locking metadata, and retain the original decision callback privately. A copied or structurally forged policy is rejected. Zero budgets are valid; durations and retry counts must be nonnegative safe integers. Definition or option getter failures retain the exact cause under INVALID_ARGUMENT. Policy creation executes no decision callback, transaction or lock acquisition.

The original transaction owner captures defaultPolicy and concurrencyStages once. Without an override it creates exactly one wait policy; explicit authentic overrides take precedence. Default selection uses that same private owner registration and never a public store field or another store registry. Wait defaults to 30,000 ms of logical admission, optimistic to three conflicts with 20 ms backoff. The decision loop below still needs real backend-lock integration; policy metadata alone does not prove native locking behavior.

### Canonical lock keys

```ts
import { lockKey } from '@migaia/storage-contract'

const original = new Date(0)
const saved = lockKey.record(original)
original.setTime(1_000)
console.log(saved.channel, saved.key instanceof Date && saved.key.getTime())
// record 0
```

`lockKey.text` and `lockKey.record` accept the existing typed storage-key domain; `lockKey.bytes` accepts strings. Factories validate and detach Dates, ArrayBuffers and nested arrays immediately, while freezing only the channel/key container. No store exists at this point, so failures carry undefined backend diagnostics. The existing `assertStorageKey`, `snapshotStorageKey` and `assertStringStorageKey` second parameter therefore admits `IBackendKind | undefined`; their arity and supported key domain are unchanged.

The original concurrency owner’s internal normalization uses the actual backend label, captures each lock field once, prefixes only the physical channel, and calls the sole ordered-key encoder. An explicit MSD suffix stack uses fixed byte/terminator buckets and one scratch array; adjacent canonical bytes deduplicate equal Dates, buffers, tuples and signed zero. Text, bytes and record channels remain distinct; typed text number 1 also remains distinct from string '1'. Work and storage follow total key bytes plus key count, without comparison sorting, longest-key padding or global identity caches. Actual locking remains the backend execution boundary.

### Organization keys and contexts

Optional `IOperationContext.orgId` accepts canonical lowercase, 36-character UUID syntax, including the zero UUID. `assertOperationContext({ orgId })` reuses the same admission. `snapshotOperationContext` captures identity once; omission or explicit undefined adds no orgId property. The outer host owns the default organization and UUID generation.

`prefixStorageOrgKey(orgId, key)` returns a detached `['$o', orgId, key]` snapshot, keeping tuple logical keys nested in the third slot. `unprefixStorageOrgKey(orgId, key)` admits only that exact three-part envelope for the same organization and returns a detached logical-key snapshot. A foreign organization, noncanonical UUID, or malformed envelope throws INVALID_ARGUMENT; an invalid contained logical key retains INVALID_KEY. The internal envelope does not consume the logical key's depth or node budget. These pure functions open no store, select no namespace, and perform no cross-organization I/O.

### Concurrency execution

Backend and persist authors pass original options directly to `runWithConcurrency({ store, options }, port)`. The original store must have a transaction-owner registration. The loop captures borrowed option getters once, then resolves the captured override or the original owner default. An explicitly supplied request.policy remains the sole effective policy and retains its existing validation/errors. Passing an authentic outer attempt context preserves its exact private deadline and normalized locks; copying it is unnecessary. The loop reads lock/concurrency before operation context fields and normalizes lock identities once. Backend-specific option admission stays with that backend.

`IConcurrencyPort.attempt(context)` must finish its native transaction, rollback and cleanup before returning a conflict or throwing. The loop starts with try, decides only on real conflicts, waits only for acquisition, and retries after the old attempt finishes. Rejected acquisition is LOCK_REJECTED; rejected commit conflict is WRITE_CONFLICT with the exact backend cause. Invalid or throwing decisions produce CONCURRENCY_POLICY_FAILED. Backends use LOCK_LOST when they prove their own lease was replaced.

`context.wait(pendingAdmission)` counts logical admission time against the selected policy budget; `context.waitPhysical(pendingPhysical)` counts physical scheduling without consuming that logical budget. Neither counts callback or cleanup time. Overall deadlines start at entry and report ABORTED, except a deadline during physical waiting reports LOCK_TIMEOUT. External cancellation preserves its original reason on cause. Zero logical budget still permits physical scheduling, and omitting an overall deadline adds no physical default limit. A timeout ends waiting; the port still owns cancelling/removing its waiter and completing accepted work before it settles.

An inner store call receiving the exact attempt context reuses the outer budget and combined signal; only the outermost call disposes that signal. Loop observations report failures without changing results. Backends emit acquired/released/lost stages at their real lifecycle boundaries; the loop emits acquisition entry, conflict, decision, waiting and retry observations. These contracts do not claim native backend integration merely because package tests pass.

LOCK_REJECTED and LOCK_TIMEOUT include read-only keys and holder properties. Known holder messages include logical/canonical key identity and the confirmed label; handing-off is reported explicitly without borrowing the previous owner. Physical timeout carries declared keys and an unknown holder when physical scheduling supplies no identity.

The loop also forwards captured native option fields and symbol properties to every attempt and exact-context nested call. It never drops backend extensions when applying canonical context fields, and it does not read fixed-field getters again.

### Immutable transaction builder

`createTransactionBuilder(store, options?)` accepts the original registered store with its actual transaction signature. The root has lock/concurrency/signal/timeout and no run method. Declaring at least one lock enables run; every derivation returns a new immutable branch. Only newly declared keys are snapshotted at each lock step. Run unfolds shared blocks with an explicit stack, normalizes once through the existing owner, and invokes the original transaction exactly once. It preserves the original transaction Promise and full native scope/options types. Configuration creates no deadline, queue or I/O.

`IRecordStore.transaction` and indexed transaction options include the original `ITransactionOptions` lock/concurrency fields. Native tx()/inspectLocks methods still belong to concrete implementations. For an already installed, registered record store:

```ts
import { createTransactionBuilder, lockKey, type IRecordStore } from '@migaia/storage-contract'
function readLocked(store: IRecordStore<{ count: number }>) {
  return createTransactionBuilder(store, { pageSize: 50 })
    .lock(lockKey.record('counter'))
    .timeout(2_000)
    .run((tx) => tx.getRecord('counter'))
}
```

### Declarative condition compiler

`compileStorageWhere<T>(where)` captures a typed `IWhere<T>` once and returns `(value: T) => boolean`. Nested object fields and repeated constraints combine with AND; explicit and/or/not preserve short-circuit order. `QueryOperator` owns eq, ne, in, exists, gt, gte, lt, lte, between, startsWith, contains and has. Membership lists are copied and compiled to Sets once. Paths reuse the existing utils path admission.

Equality and membership use SameValueZero, including 0/-0 and explicit object identity; ordinary nested object syntax instead checks its fields. Date operands capture their time point. Ordered comparisons require the same number, bigint, string or Date domain and never coerce mismatches. exists distinguishes a missing path from a present undefined. Operator values retain the portable scalar carrier, declared undefined/bigint/Date comparisons, opaque object identity and their lists. Explicit object identity comparisons require client execution when a backend offers only structural equality. Invalid conditions, paths and reflected failures produce INVALID_ARGUMENT with their exact cause before candidate reads. The compiler opens no source and creates no query owner.

```ts
import { compileStorageWhere } from '@migaia/storage-contract'
const accepts = compileStorageWhere<{ status: string; total: number }>({
  status: 'paid',
  total: { gte: 100 }
})
const rows = [
  { status: 'paid', total: 120 },
  { status: 'paid', total: 50 }
]
console.log(rows.filter(accepts).length) // 1
```

### Read-only capability access

`hasStorageCapability(store, token)` and `useStorageCapability(store, token)` read the original provider table without installing methods, publishing capabilities, acquiring ownership or returning a provider/base handle. Their token behavior is exactly the original store.has(token)/store.use(token) behavior: authentic published tokens return the same API identity; forged tokens return false from has and throw INVALID_ARGUMENT from use; authentic missing tokens throw UNSUPPORTED_CAPABILITY. Raw or frozen unprovided resources remain missing and unmodified. Provided stores use their captured backend diagnostic rather than re-reading backend getters. use retains exact native implementation refinements. Late Feature prepare/publish/release is visible through the same table. The original store.has(stringKey) KV forwarding remains intact.

```ts
import {
  hasStorageCapability,
  useStorageCapability,
  kv,
  type IStorageBase
} from '@migaia/storage-contract'
async function readGreeting(store: IStorageBase) {
  if (!hasStorageCapability(store, kv)) return undefined
  return useStorageCapability(store, kv).get('greeting')
}
```

### Shared record execution

`createRecordQuery<T,TContext,TAugmentMethods>(source, methods?)` creates the shared record executor. `IRecordQuery` adds ordinary `limit(count)` and `orderByComparator(compare).limit(count)` to the common where/select/all/stream/explain/requirePushdown methods. A comparator has no typed read terminal until its explicit bound; bypassed missing bounds and invalid limits reject with INVALID_ARGUMENT before source execution. Limit accepts nonnegative safe integers. Comparator selection uses a stable bounded heap, O(c log k) time and O(k) retained candidates, then orders only the retained heap. Both controls execute on the client in this slice. Selected results remove where/select. Passing `undefined` as TContext rejects new operation contexts at compile time.

`all` and the real `IStorageIterator` returned by `stream` consume the same compiled node reader over the original cursor. Ordinary limit stops advancing once its bound is reached. Registered transaction streams reuse the original iterator registration, so accepted mapped next calls drain before cleanup and buffered comparator results still require the original live scope after native exhaustion. Root and transaction streams reuse the same iterator lifetime implementation, so main and symbolic cleanup both await complete accepted mapping before releasing the original source. Mapper failures remain on the original next result; cleanup retains its own source failure policy. Optional pure Feature methods retain exact references on every derived chain; omitted methods allocate no empty method table. `IQueryShape` and `IQueryResultOf` preserve generic terminal result inference.

The source captures `IQueryPushdown` and its original execute callback once. Immutable linked nodes share history; execution or explain unfolds it once. A record query sends the longest safe native prefix as canonical condition AST nodes and optional projection fields. JavaScript predicates/mappers and opaque object identity comparisons stay on the client. A client step prevents subsequent record steps from moving across it. `QueryOperation` is the shared vocabulary, not a promise that every named fluent method is implemented. explain reads no data; fullScan is conservative unless an index and native condition are declared. requirePushdown rejects with QUERY_NOT_PUSHABLE and client reasons before opening a cursor.

`IRecordQuerySource.asyncDisposeKey?: typeof Symbol.asyncDispose` is a readonly source resource key, also read and captured once. An explicit value must be a symbol or undefined; other values reject with INVALID_ARGUMENT. Omission or undefined uses native `Symbol.asyncDispose`; a backend using its host's existing fallback must pass that same `asyncDisposeKey`. Root mapped streams use this key for symbolic cleanup and the original cursor's diagnostic forwarding, retaining the separately cached main and symbolic cleanup Promises and original cleanup owner. The contract creates no fallback symbol.

`execute({conditions,fields,ctx})` returns the original `IStorageIterator<readonly [IStorageKey,unknown]>`; projected native rows intentionally do not claim the full T domain. all processes candidates in order and always awaits that iterator's real dispose Promise. It does not create another resource owner, timer or transaction. The original source owns operation cancellation/deadlines. For an original transaction iterator, all synchronously registers its complete consumption, mapper and cleanup interval with that same owner. A callback that omits awaiting all cannot commit before it settles; mapper failure enters the original firstFailure before cleanup. Callback failures retain coded identity; mutable uncoded native errors receive INVALID_ARGUMENT, while attachment failure preserves the original through the existing error tools. Cleanup cannot replace the first failure. Opaque identity operands, including objects containing Date/bigint, are never traversed.

```ts
import { createRecordQuery, type IRecordQuerySource } from '@migaia/storage-contract'
function totals(execute: IRecordQuerySource['execute']) {
  return createRecordQuery<{ status: string; total: number }>({
    pushdown: { source: 'supplied-cursor', operations: [], operators: [] },
    execute
  })
    .where({ status: 'paid' })
    .where('total', 'gte', 100)
    .select('total')
    .all()
}
```

The supplied cursor is a real backend resource. With paid totals 120 and 50, totals returns `[{total:120}]` and waits for cleanup. Ordering, paging, writes, statistics, watch and vector/RDF methods are not part of this implemented slice.

### Standard records capability

`records` is the authentic standard token for `IRecordsApi<TValue>`. Its `query<R = TValue>()` returns the implemented shared `IRecordQuery<R>` with conditions, one select, bounded comparator ordering, limit, all, stream, explain and requirePushdown. Native backends and Features supply their query through `createRecordQuery` and keep the original iterator/transaction owner; there is no second chain executor. Standard admission requires callable query and removeByPrefix methods without invoking either. A legacy capabilities.records boolean grants no token authority and does not replace an actual Feature API.

`removeByPrefix(prefix, ctx?)` belongs to the supplied original write pipeline and returns its actual deletion count. Its context includes the existing IWriteConcurrencyOptions. The provider returns the exact API object and preserves native default row/API refinements; it does not wrap the deletion Promise or copy the prefix/context. Concrete backend deletion, transaction capability projection and the remaining query terminals require their later implementation slices.

```ts
import { records, useStorageCapability, type IStorageBase } from '@migaia/storage-contract'
async function paidTotals(store: IStorageBase) {
  return useStorageCapability(store, records)
    .query<{ status: string; total: number }>()
    .where({ status: 'paid' })
    .select('total')
    .all()
}
```

`readConcurrencyLockIdentities(ctx)` reads the live original attempt metadata and returns its immutable canonical lowercase hexadecimal identities, including channel separation, in normalized sorted/deduplicated order. The string list is created once from the existing encoded bytes and shared by repeated reads and nested attempts. It never re-encodes logical keys or exposes mutable internal bytes. Forged, settled and builder-only contexts reject with INVALID_ARGUMENT. The function grants no registration, lock acquisition or resource control.

`snapshotConcurrencyLockHoldings(rows)` detaches the current inspection rows and stably sorts them by the same channel/key byte order. It preserves each holder, expired flag and expiresAt value, including separate rows for equal keys. The result has no internal lock-table reference or lock authority.

`snapshotConcurrencyLockKeys(keys, backend)` normalizes, orders and deduplicates once, returning frozen paired `{keys, identities}`. Keys are detached snapshots; identities are the original channel encoding as hexadecimal strings, without acquisition authority. `snapshotConcurrencyLockRange({channel,prefix?}, backend)` returns a half-open `{lower,upper}` interval in the same identity domain. Omitted prefix selects the entire channel; a supplied prefix reuses the canonical typed prefix rules. Byte prefixes accept strings only, including the empty string.

The optional `runWithConcurrency` request field `lock(captured)` runs once after the original fixed context fields are captured. Its implicit locks merge with, order and deduplicate the explicit options.lock set without dropping explicit locks. Nested calls normalize only added keys, reusing existing encodings and the same budget; retries in the default mode do not call the derivation again. Getter and raw callback failures retain their cause through INVALID_ARGUMENT; existing coded callback failures preserve identity. `IWriteOptions` and root removal/clear contexts for every data channel include `IWriteConcurrencyOptions`; omitted concurrency uses the original owner default.

Backend authors may use `request.executeAttempt(captured, proceed)` instead of `execute`; supplying both is invalid. The default execute still wraps the complete logical loop once. executeAttempt surrounds each actual native commit attempt with a complete pipeline; pure acquisition conflict waits or retries remain in the current segment without transforming input again. A commit conflict must finish native rollback and cleanup before proceed rejects with its original coded cause. Missing or uncoded causes receive one WRITE_CONFLICT boundary retaining the cause. Only rethrowing that same identity after the full stage unwind allows the original loop to consult policy and open another segment; stage recovery or a different thrown identity settles directly. A stage can halt without calling proceed; duplicate calls reject INVALID_ARGUMENT. Each fresh segment derives its transformed-input locks from the initially captured explicit or inherited set, without accumulating earlier implicit locks. Original options are read once; every segment shares the same signal, overall deadline and conflict counters. No additional loop, queue or timeout owner exists.

`IConcurrencyAttemptContext.attempt` is the original shared conflict count plus one. Backends forward this readonly ordinal to observations; they do not count attempts independently. Nested attempts use the same budget source.

## SQL fragments and backend binding

`sqlFragment` is a connection-free pure tag with id, join and empty, and no all/get/run. Interpolations accept ISqlValue or authentic fragments from the same owner. Plain objects, Date, undefined and forged fragments reject INVALID_ARGUMENT during construction. Templates require the frozen cooked/raw array shape. id quotes each identifier part and escapes double quotes; join preserves repeated child occurrences. Byte inputs are copied immediately and values never become SQL text.

Immutable nodes retain references without copying accumulated SQL. First execution flattens once with an explicit stack. SQLite uses ?, while PostgreSQL numbers bindings consecutively from $1. Each prepare returns independent byte copies to the driver. There is no shared mutable parameter array or global native-statement cache.

```ts
import { sqlFragment, type ISqlExecutor } from '@migaia/storage-contract'
async function readUser(executor: ISqlExecutor, id: number) {
  const columns = sqlFragment.join([sqlFragment.id('id'), sqlFragment.id('name')])
  return executor.sql<{
    id: number
    name?: string
  }>`SELECT ${columns} FROM ${sqlFragment.id('users')} WHERE id = ${id}`.get()
}
```

`createSqlTag({ dialect, all, get, run })` lets original backend authors bind these nodes to real execution. Each callback receives `prepare: () => ICompiledStorageSql` and the original ctx. It must enter its original operation/transaction owner before calling prepare, then invoke its native driver. The tag returns that callback's exact Promise and preserves its receiver and ctx. It creates no connection, pipeline, lease, cancellation timer or disposal owner. ICompiledStorageSql contains only text and readonly values. The first complete text is checked for one statement, quoting, comments, transaction control and SQLite journal_mode mutation. Rejection happens inside original admission before native invocation and enters the same transaction first failure. One trailing semicolon and comments are allowed; CREATE TRIGGER internal statement lists are rejected.

Shared ISqlValue includes boolean, bigint and Uint8Array. ISqlRunResult promises changes only, with no insertion ID. Backends specialize ISqlTag<TValue, TResult>/ISqlExecutor<TValue, TResult> to retain native output domains and results. Explicit row types are caller declarations, not runtime verification of the SQL output schema. SQLite boolean input conversion and lastInsertRowid belong to its original adapter. PostgreSQL standard strings use supported standard_conforming_strings=on, alongside E strings, dollar quotes and nested block comments. Original backend owners retain connections, driver errors, observations and transaction cleanup.

## Original transaction capability projections

`useTransactionCapability(scope, token)` finds the original store through an authentic scope's transaction owner, then reads its sole provider table. Backend method factories use `use: (token) => useTransactionCapability(scope, token)`. The helper does not modify scopes, so complete frozen scopes with public type annotations need no private symbol or cast. Pure use invokes no forTransaction binder or I/O. Repeated use for the same view/implementation returns one frozen projection, whose cache is cleared when the view expires.

The implemented standard transaction projections cover kv and records. KV supplies all eight get/set/remove/has/getMany/setMany/removeMany/removeByPrefix methods, retaining one real native batch. It has no root keys/clear, ordinary operation ctx or independent policy. Records supplies the real shared query and removeByPrefix; query all accepts no ordinary ctx. `IWithTransactionQueryMethods<TScope,TAugmentMethods,TRdfAugmentMethods = {}>` projects record and RDF pure methods independently. The optional third group defaults empty; existing two-argument calls enhance only records. Neither family grants the other's methods, root context or new native scope members. The canonical builder projection reuses this pure helper for its callback scope. Every data method enters the original runTransactionOperation and passes a fresh complete operation view to forTransaction. Saved query all also enters that owner before strict planning, mapping and original iterator cleanup, retaining first failure and draining. Saved data methods and query terminals reject the original backend TRANSACTION_FAILED before I/O after closure.

```ts
import { kv, records, type ITransactionScope } from '@migaia/storage-contract'
async function paidValues(tx: ITransactionScope<{ state: string; value: number }, typeof records>) {
  await tx.use(kv).setMany([{ key: 'status', value: 'paid' }])
  return tx.use(records).query().where({ state: 'paid' }).select('value').all()
}
```

A base/Feature declaring transactions must provide real forTransaction bindings for supplied kv and records. The provider checks before publication or base mutation. Binders use the current native view and must not return root APIs. Query construction remains pure, and the backend source must register its actual iterator with that scope's original owner. The second ITransactionScope generic and ITransactionCapabilityView preserve capability-set contravariance. Provider type projection replaces transaction/tx use while retaining native extensions, options, builder augmentation and Awaited results. Other standard transaction projections and the root KV batch surface remain for later implementations.

## Canonical key prefixes

`createStorageBatchKeyCapture(backend)` returns one pure per-batch `capture(key)` function with the same `{ key, identity, firstIndex }` facts. Native authors call it in their existing per-entry getter order, then reject `firstIndex !== inputIndex` at their original duplicate-validation point. It reads no value/TTL field, catches no consumer callback, and creates no resource or operation owner. The array helper reuses this same temporary equality index.

`snapshotStorageBatchKeys(keys, backend, { rejectDuplicates? })` captures each input position once and returns frozen `{ key, identity, firstIndex }` rows in caller order. `key` is detached and `identity` uses the canonical ordered bytes. Reads retain duplicate positions; native removals use only positions equal to `firstIndex`; atomic writes pass `rejectDuplicates: true` and reject canonical duplicates with `INVALID_ARGUMENT` before I/O. Invalid logical keys retain `INVALID_KEY`. The helper creates no store, transaction or resource owner.

`snapshotStorageKeyPrefix(prefix, backend)` captures the original key domain once and returns `{ key, lower, upper, matches }`. Strings match UTF-16 content prefixes and ArrayBuffers match byte prefixes. Arrays match complete leading child-key sequences, without treating their final child as a partial prefix. Numbers and Dates match exact canonical identities; -0 equals 0. Empty strings/buffers remain valid, while the original key domain still rejects empty arrays.

The original encoder's writer omits only the outer variable key terminator and retains every child boundary and type tag. lower is inclusive and upper is its guaranteed strict byte successor, exclusive. Complete encodeOrderedStorageKey output is unchanged. Native ordered structures locate that range. A logical-key IndexedDB cursor may start at key via lowerBound and stop on the first matches=false, reading at most one extra boundary row. The text Web origin-enumeration exception also reuses this prepared matcher. No index or stored-data scan is created by the helper. Mutating exposed key/bounds does not change the captured private matcher; callers should keep the boundaries they use for queries unchanged.

```ts
import { snapshotStorageKeyPrefix } from '@migaia/storage-contract'
const prefix = snapshotStorageKeyPrefix(['cache', 'users'], 'memory')
const included = prefix.matches(['cache', 'users', 1])
const excluded = prefix.matches(['cache', 'users-extra'])
// included === true; excluded === false
// Native ordered stores use prefix.lower <= encodedKey < prefix.upper.
```

`ttl` and `counter` are standard capability identities. Backends publish complete native APIs; transaction-enabled providers also supply `forTransaction`. `store.use(ttl)` exposes `expire/remaining/persist` on physical text, byte, record or vector targets. Durations are finite nonnegative milliseconds, including fractions and zero. Missing/expired targets return false for writes; missing/unlimited targets return undefined for remaining. Persisting an already unlimited target returns false. Transaction projections use the original draft and budget.

`store.use(counter).increment(key, by?)` atomically updates canonical decimal safe-integer text; missing text starts at zero and omitted `by` is one. Whitespace, exponents, leading zeroes, negative zero, unsafe deltas and overflow reject with `INVALID_ARGUMENT` without writing. Backend authors call `snapshotStorageCounterIncrement(by, backend)` before I/O, then apply its pure calculation to current text inside the existing atomic operation. `snapshotStorageTtlTarget` reuses the original physical key validator; `assertStorageTtlDuration` admits finite nonnegative durations. These helpers create no store, deadline state or operation budget.

`term.iri/literal/blank/defaultGraph` owns pure RDF terms. IRIs retain exact absolute RFC 3987 spelling; no URL resolution, case folding or normalization changes identity. Plain literals carry `xsd:string`; language-tagged literals carry `rdf:langString` and lowercase BCP47 spelling admitted by its well-formed ABNF, including grandfathered and private-use tags. Registry validity and duplicate-subtag validity are not required. Raw/parser blank labels remain local and cannot occupy standard ground `IQuad` positions. `IRawQuad` retains the full RDF 1.1 blank domain for raw responses.

`snapshotStorageRdfTerm`, `snapshotStorageRdfPattern` and `snapshotStorageRdfQuad` detach structural fields once and reject malformed terms or positions with `INVALID_ARGUMENT`, retaining getter causes. Patterns omit unconstrained positions, including graph; complete quads require all four positions. `encodeStorageRdfQuad` uses normalized term fields and the existing self-delimiting ordered-key writer for independent identity bytes. These pure helpers open no native store, query or resource.

`lockKey.vector(collection, id)` and `lockKey.rdf(quad)` extend the original canonical lock owner. Channel order remains text, bytes, record, followed by vector and RDF. Vector identity uses the exact collection/point tuple; RDF uses the same normalized ground-quad snapshot and ordered bytes as RDF writes. Factories detach caller data, and normalization deduplicates equal identities once. Full-channel lock ranges include both channels; typed prefix ranges remain limited to text, bytes and records. TTL accepts vector collection/point targets and rejects RDF before native work. A backend must explicitly reject a channel it cannot implement.

`sql` is the standard nested native executor capability: `store.use(sql).sql` retains its original tag and tools. Transaction providers supply `forTransaction`; `tx.use(sql).sql` composes fragments without invoking that binder or root execution. Each all/get/run terminal enters the existing transaction owner, receives a fresh native operation view and uses the original transaction budget. Saved queries cannot execute after expiry. Backend authors may use `deriveStorageSqlQuery(fragment, terminals)` to replace only terminal callbacks over the same authentic fragment node, preserving callback receiver, context and Promise identity. It creates no compiler, connection, queue or resource owner.

`blob` selects an independent native object API, with string keys, immutable metadata and a disposable single-consumption object snapshot. Its stream is the platform’s WHATWG `ReadableStream<Uint8Array>`; the contract imports no DOM runtime or stream implementation. The six native methods include conditional put, range get, head, remove, ordered list and removeByPrefix. The provider validates the complete shape without opening a stream. Object backends implement byte/range/condition/lifetime semantics; this token alone does not implement storage.

`durableChangeFeed` selects native `readChanges` replay and disposable `tailChanges`. Cursors are opaque, replay is at least once, and callers persist only successfully processed cursors. A retention gap is a native RangeError carrying `StorageContractErrorCode.changeCursorExpired`; callers invalidate fully and resume from now. Ordinary changes can carry readonly orgId from the original host context. Blob and durable feeds have no generic transaction projection or flat KV surface. Memory does not acquire a durable token merely because it emits transient changes.

`orderStorageKeysByBytes(entries, key)` captures each selector result once, copies its bytes immediately and returns the original rows in stable byte order. It shares the original lock radix implementation, including prefix ordering, and creates no persistent index. `encodeStorageOrgStringPrefix(orgId, prefix, backend)` uses the original organization envelope and key writer, omitting only the final string and tuple terminators. Empty prefixes and exact UTF-16 code units remain valid; the encoded prefix cannot cross organizations or match a tuple-valued logical key.

SPARQL uses the same canonical RDF terms through pure sparqlFragment and the native sparql capability. Interpolation accepts only NamedNode, Literal or an authentic fragment; raw blank/default-graph terms, ordinary strings and forged fragments reject before I/O. Literal rendering escapes quotes, backslashes and control values; variable names use the full SPARQL VARNAME grammar without a leading question mark or dollar. join defaults to whitespace and empty has one identity. Deep and repeated fragments expand iteratively at their actual output positions.

Backend authors bind createSparqlTag({select,ask,construct,update}) to their original native callbacks. Each callback receives lazy prepare returning the immutable body and the original context; the backend performs its existing operation admission before preparation. The wrapper preserves receiver and Promise identity. SELECT keeps undefined unbound fields; CONSTRUCT keeps full raw quads and response-local blanks. Pure composition starts no query, parser, endpoint, retry loop or resource. SPARQL has no generic KV/record transaction projection; endpoint-specific atomic-update transactions remain with the native backend.

## Vector and RDF query author entries

`createVectorQuery<TPayload,TGroupable>(source, methods?)` returns an immutable builder. A positive safe-integer `topK(k)` enables its read terminals. Native execute receives `IVectorQueryInput`: all translatable payload conditions, final topK/minScore, withVector and the original context. Declarative conditions cross function predicates for native filtering before ranking; the backend still applies organization and TTL before ranking. Functions inspect only original engine hits and never refill the search. withVector defaults to false and adds the vector result type only when enabled. exact:true explains fullScan. Declaring groupBy:true enables one-pass grouping over the original topK hits by own scalar payload fields, retaining each group's original first perGroup hits.

`createRdfQuery(source, pattern, methods?)` captures a canonical ground pattern; omitted graph continues to match every graph. Native execute receives `IRdfQueryInput` with ordered where/follow/inverse/select steps. Native rows are unknown so actual Pick projections never pretend to be complete quads. Traversal positions accept only ground IRIs. This read unit provides native safe-prefix traversal and ordinary limit; a traversal that cannot yet execute on the client rejects before I/O with QUERY_NOT_PUSHABLE. Client RDF traversal, pages and write terminals remain subsequent units.

Both author entries reuse the record query's nodes, planner, reader and original IStorageIterator, including asyncDisposeKey, cancellation, transaction resources and primary cleanup errors. Optional pure methods retain their original function references. `VectorQueryMethod` and `RdfQueryMethod` are the canonical reserved-name tables.

vector and rdf now publish their exact standard native APIs. Vector collections return the shared IVectorQueryBuilder/IVectorHit family, retaining pre-topK type state and optional native grouping; they borrow the store lifetime and have no generic transaction projection. Payload declarations support readonly/optional portable field shapes and reject Date/function schemas. DeleteCountMode is precount or scroll; engines returning actual deleted counts keep those counts, while Qdrant follows its explicit native strategy. Token publication alone does not implement a search engine.

RDF add/delete/match use the same canonical ground IQuad owner. Transaction-enabled providers supply forTransaction: writes bind a fresh original operation view, while match retains the actual family query and original iterator registration. Every complete read terminal, including selected results and callback/numeric terminals, enters the same transaction owner before argument, strict or empty-result failures. Saved queries reject after expiry. Feature methods retain the exact generic projection. Change-feed type parameters remain reserved until the shared watch contract is implemented; these declarations do not advertise watch or durable delivery.

## Record and RDF row controls

`orderBy(selector, direction?)` uses canonical IStorageKey order; direction defaults to asc and consecutive calls add secondary keys. Each selector runs once per candidate and its encoded key detaches immediately. Original logical primary keys break ties, retaining an explicit source tail direction. Ordering reuses the canonical byte radix without comparison sorting. Only selector ordering retains actual candidate rows; count skips ordering callbacks that cannot affect cardinality. When downstream conditions or traversal observe row selection from distinct/skip/limit, the relevant selector ordering remains upstream; the reduction itself retains only its scalar accumulator. Selector and comparator type states are exclusive. Opaque selectors are never parsed or falsely declared native.

`distinct(field)` retains the first row in current order using one Set with SameValueZero field identity: equal zeroes and NaN collapse, missing and undefined share a value, and objects including Dates retain their original identity. `skip(count)` accepts a nonnegative safe integer, advances rows explicitly on the client and explains its O(n) cost. A downstream limit stops further reads. Records and RDF share these nodes and reader; vectors expose only rank-preserving distinct.

An explicit `nativeSteps:true` opts the original execute callback into ordered `IQueryNativeStep` values (where/select/limit/skip/distinct). The engine must execute its actual supported prefix in declaration order; steps is authoritative, and the retained compatibility conditions/fields must not be applied again out of order. Legacy sources retain the original three-field execute argument and client limit behavior. Native distinct declarations must preserve the same field identity, not substitute structural equality. RDF also opts into extended native controls explicitly while retaining its existing traversal steps. These transaction branches reproject through the same original wrapper and complete terminal operation admission.
