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

`createRecordQuery<T,TContext>(source)` is the backend-author seam for the implemented `where`, `select`, `all`, `explain` and `requirePushdown` slice. `IQueryChain` advertises only these implemented methods. Three where forms combine with AND; a single select accepts typed top-level fields or a mapper with an Awaited result. Selected results remove where/select. Passing `undefined` as TContext makes a transaction-bound query reject operation contexts at compile time.

The source captures `IQueryPushdown` and its original execute callback once. Immutable linked nodes share history; execution or explain unfolds it once. A record query sends the longest safe native prefix as canonical condition AST nodes and optional projection fields. JavaScript predicates/mappers and opaque object identity comparisons stay on the client. A client step prevents subsequent record steps from moving across it. `QueryOperation` is the shared vocabulary, not a promise that every named fluent method is implemented. explain reads no data; fullScan is conservative unless an index and native condition are declared. requirePushdown rejects with QUERY_NOT_PUSHABLE and client reasons before opening a cursor.

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

`records` is the authentic standard token for `IRecordsApi<TValue>`. Its `query<R = TValue>()` returns the implemented shared `IQueryChain<R>` slice: where, one select, all, explain and requirePushdown. Native backends and Features supply their query through `createRecordQuery` and keep the original iterator/transaction owner; there is no second chain executor. Standard admission requires callable query and removeByPrefix methods without invoking either. A legacy capabilities.records boolean grants no token authority and does not replace an actual Feature API.

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

The implemented standard transaction projections cover kv and records. KV supplies all eight get/set/remove/has/getMany/setMany/removeMany/removeByPrefix methods, retaining one real native batch. It has no root keys/clear, ordinary operation ctx or independent policy. Records supplies the real shared query and removeByPrefix; query all accepts no ordinary ctx. Every data method enters the original runTransactionOperation and passes a fresh complete operation view to forTransaction. Saved query all also enters that owner before strict planning, mapping and original iterator cleanup, retaining first failure and draining. Saved data methods and query terminals reject the original backend TRANSACTION_FAILED before I/O after closure.

```ts
import { kv, records, type ITransactionScope } from '@migaia/storage-contract'
async function paidValues(tx: ITransactionScope<{ state: string; value: number }, typeof records>) {
  await tx.use(kv).setMany([{ key: 'status', value: 'paid' }])
  return tx.use(records).query().where({ state: 'paid' }).select('value').all()
}
```

A base/Feature declaring transactions must provide real forTransaction bindings for supplied kv and records. The provider checks before publication or base mutation. Binders use the current native view and must not return root APIs. Query construction remains pure, and the backend source must register its actual iterator with that scope's original owner. The second ITransactionScope generic and ITransactionCapabilityView preserve capability-set contravariance. Provider type projection replaces transaction/tx use while retaining native extensions, options, builder augmentation and Awaited results. Other standard transaction projections and the root KV batch surface remain for later implementations.

## Canonical key prefixes

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
