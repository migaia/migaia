# storage-contract usage guide

[中文](./USEGUIDE.md) · [Back to README](./README.en.md)

Choose a scenario for the problem at hand, then consult interfaces, parameters and implementation responsibilities. These examples use contract tools and the built-in codec without simulating a storage backend.

## Find a scenario

| Scenario                                                             | Tools                         | Details                                                                                                   |
| -------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| Capture a composite key before its owner changes it                  | `snapshotStorageKey`          | [Complete example](./USEGUIDE.en.md#capture-a-composite-key-before-its-owner-changes-it)                  |
| Reject an object before treating it as a record key                  | `snapshotStorageKey`          | [Complete example](./USEGUIDE.en.md#reject-an-object-before-treating-it-as-a-record-key)                  |
| Read operation options once without claiming to execute cancellation | `snapshotOperationContext`    | [Complete example](./USEGUIDE.en.md#read-operation-options-once-without-claiming-to-execute-cancellation) |
| Restore nested Map and Set values from text                          | `fromValueCodec`              | [Complete example](./USEGUIDE.en.md#restore-nested-map-and-set-values-from-text)                          |
| Normalize an older capability descriptor before choosing a channel   | `snapshotStorageCapabilities` | [Complete example](./USEGUIDE.en.md#normalize-an-older-capability-descriptor-before-choosing-a-channel)   |
| Keep the original failure when reporting a contract error            | `StorageContractError`        | [Complete example](./USEGUIDE.en.md#keep-the-original-failure-when-reporting-a-contract-error)            |

## Capture a composite key before its owner changes it

An async operation still holds a caller’s array, Date and buffer, so changing the original can change the key used later. A shallow array copy leaves both nested objects shared. `snapshotStorageKey()` validates and recursively copies these key components, then validates the copy. The returned key is detached, not frozen.

`value` is the caller’s unknown key; here it is an array containing a string, Date and ArrayBuffer. The `memory` backend argument labels diagnostics without creating a memory store. Optional label defaults to `key`. Mutable components are recursively copied, but the result is not frozen.

```ts doc-test=run
import { snapshotStorageKey } from '@migaia/storage-contract'

const date = new Date(0)
const bytes = new Uint8Array([7, 8])
const original: [string, Date, ArrayBuffer] = ['orders', date, bytes.buffer]
const saved = snapshotStorageKey(original, 'memory') as readonly [string, Date, ArrayBuffer]
original[0] = 'changed'
date.setTime(1000)
bytes[0] = 99
console.log('original:', original[0], date.getTime(), bytes[0])
console.log('snapshot:', saved[0], saved[1].getTime(), new Uint8Array(saved[2])[0])
console.log('separate array:', saved !== original)
```

Output:

```text
original: changed 1000 99
snapshot: orders 0 7
separate array: true
```

Prints `original: changed 1000 99`, `snapshot: orders 0 7`, then `separate array: true`. Mutation of the original array, Date and bytes does not change the captured key. The caller still owns the mutable snapshot; keep it private for the duration of the operation.

## Reject an object before treating it as a record key

An application sends an object as a record key and fails only after backend work starts. Handwritten string conversion can collapse different objects to the same key. `snapshotStorageKey()` rejects the object with `INVALID_KEY`, retaining the backend label, original value and typed cause. Choose a supported key such as an array of its scalar fields instead.

`candidate` is a plain object outside the accepted key domain. `memory` is still only a backend label. `orderKey` replaces the default label `key` in diagnostic text. The resulting contract error supplies code, backend, key and cause.

```ts doc-test=run
import { snapshotStorageKey, StorageContractError } from '@migaia/storage-contract'

const candidate = { orderId: 1 }
try {
  snapshotStorageKey(candidate, 'memory', 'orderKey')
} catch (error) {
  if (!(error instanceof StorageContractError)) throw error
  console.log('code:', error.code)
  console.log('backend:', error.backend)
  console.log('original key:', (error.key as unknown) === candidate)
  console.log('typed cause:', error.cause instanceof TypeError)
}
```

Output:

```text
code: INVALID_KEY
backend: memory
original key: true
typed cause: true
```

Prints `code: INVALID_KEY`, `backend: memory`, `original key: true`, then `typed cause: true`. The invalid value is rejected synchronously; this helper does not call a storage backend.

## Read operation options once without claiming to execute cancellation

Options supplied through getters can change between validation and use. Re-reading them in each backend layer can select inconsistent timeouts or policies. `snapshotOperationContext()` captures the four fields once and freezes their record; passing that snapshot back reuses its identity. It accepts an already-aborted signal because it validates intent only: the backend must implement cancellation and timeout behavior.

The four getters provide the original AbortSignal, an allowed zero timeout, a pageSize of 100 within 1–4096, and `replace` to permit replacement. Omitted fields remain undefined. The other policy, `conflict`, fails when a value already exists. Actual cancellation and timers belong to a backend.

```ts doc-test=run
import { snapshotOperationContext } from '@migaia/storage-contract'

const controller = new AbortController()
controller.abort()
let reads = 0
const options = {
  get signal() {
    reads += 1
    return controller.signal
  },
  get timeoutMs() {
    reads += 1
    return 0
  },
  get pageSize() {
    reads += 1
    return 100
  },
  get conflictPolicy() {
    reads += 1
    return 'replace' as const
  }
}
const snapshot = snapshotOperationContext(options)
console.log('frozen:', Object.isFrozen(snapshot))
console.log('same snapshot:', snapshotOperationContext(snapshot) === snapshot)
console.log('field reads:', reads)
console.log('signal aborted:', snapshot?.signal?.aborted)
console.log('options:', snapshot?.timeoutMs, snapshot?.pageSize, snapshot?.conflictPolicy)
```

Output:

```text
frozen: true
same snapshot: true
field reads: 4
signal aborted: true
options: 0 100 replace
```

Prints `frozen: true`, `same snapshot: true`, `field reads: 4`, `signal aborted: true`, then `options: 0 100 replace`. Each field is read once across both calls; validation preserves the original signal and accepts zero timeout. No timer or abort subscription is created.

## Restore nested Map and Set values from text

`fromValueCodec` adapts a serialize codec without implementing another value format. Compose `defineCollectionsJsonCodec({ version: 1 })` to preserve Map/Set with the serialize-owned `$rpc` map/entries and set/values records. The adapter name is `collections-json@1`, output is text, and unsupported values are rejected by serialize.

`encode(value, ctx?)` turns this object into text; `decode(raw, ctx?)` consumes that text and reconstructs collections. Both omitted context arguments are undefined. output is always `text`. The type assertion describes the expected object shape; the codec reviver creates the Map/Set instances.

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

Prints `output: text`, `Map: true`, `Set: true`, then `permissions: read, write`. The codec restores both nested collection types from a string; it does not store the string anywhere. Other values retain JSON limitations, and cycles are not supported.

## Normalize an older capability descriptor before choosing a channel

A capability descriptor created before index and change-feed support omits the new flags. Truthy checks can hide invalid field types, while retaining the descriptor lets later mutation change an admission decision. `snapshotStorageCapabilities()` validates the full shape, defaults only the two legacy flags to false and returns a separate record.

Input requires boolean syncRead, binary, records, transactions, iteration and opaqueEntries, plus a nonnegative safe-integer maxValueBytes or undefined. The legacy object omits secondaryIndexes/changeFeed, so the snapshot supplies false for each. The full field meanings appear in the capability table below.

```ts doc-test=run
import { snapshotStorageCapabilities } from '@migaia/storage-contract'

const legacy = {
  syncRead: true,
  binary: false,
  records: false,
  transactions: false,
  iteration: false,
  opaqueEntries: false,
  maxValueBytes: undefined
}
const snapshot = snapshotStorageCapabilities(legacy)
legacy.records = true
console.log('new flags:', snapshot?.secondaryIndexes, snapshot?.changeFeed)
console.log('record capability:', legacy.records, snapshot?.records)
console.log('separate record:', snapshot !== legacy)
console.log('frozen:', Object.isFrozen(snapshot))
```

Output:

```text
new flags: false false
record capability: true false
separate record: true
frozen: false
```

Prints `new flags: false false`, `record capability: true false`, `separate record: true`, then `frozen: false`. The captured flags retain their admission-time values after the original descriptor changes. Invalid shapes or accessor failures return `undefined`; the successful snapshot itself remains mutable.

## Keep the original failure when reporting a contract error

A validation boundary catches a native failure but reports only a message, leaving callers unable to inspect its original cause. Rebuilding diagnostic fields by hand can also lose the source and code. Construct `StorageContractError` with the appropriate public code and exact cause; it owns the stable identity fields and native cause link.

The first argument is public code INVALID_ARGUMENT. The second supplies the `memory` backend label and the exact TypeError as cause. Optional key is omitted and remains undefined; details defaults to an empty object. The optional third message is omitted, selecting the code-based default. Freezing the error does not freeze its cause.

```ts doc-test=run
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'

const cause = new TypeError('invalid page size')
const error = new StorageContractError(StorageContractErrorCode.invalidArgument, {
  backend: 'memory',
  cause
})
console.log('source:', error.source)
console.log('code:', error.code)
console.log('backend:', error.backend)
console.log('same cause:', error.cause === cause)
console.log('cause message:', (error.cause as Error).message)
console.log('frozen:', Object.isFrozen(error))
```

Output:

```text
source: @migaia/storage-contract
code: INVALID_ARGUMENT
backend: memory
same cause: true
cause message: invalid page size
frozen: true
```

Prints `source: @migaia/storage-contract`, `code: INVALID_ARGUMENT`, `backend: memory`, `same cause: true`, `cause message: invalid page size`, then `frozen: true`. The native cause is the exact original object. The error instance is frozen; this does not freeze the cause object.

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
| `removeBytes(key, ctx?)`                        | Deletes only this key from the byte channel, leaving text and records alone; a missing key succeeds, so repeated deletion is idempotent. Required L1 method.                   |
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

`fromValueCodec` adapts a serialize codec without implementing another value format. Compose `defineCollectionsJsonCodec({ version: 1 })` to preserve Map/Set with the serialize-owned `$rpc` map/entries and set/values records. The adapter name is `collections-json@1`, output is text, and unsupported values are rejected by serialize.

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
