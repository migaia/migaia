# `@migaia/store-shared`

[简体中文](./README.md)

Share fixed-size int32 state through SharedArrayBuffer and Atomics, then track and publish changes at the locations each Runtime reads.

## You may have run into this

- A different Runtime writes successfully but the view does not rerun because shared bytes were never published to the receiving graph.
- One coordinate change reruns every observer because dependencies follow the whole array rather than the indices read.
- Later consumers miss updates because a shared dirty flag is used in place of a cursor for each reader.
- Concurrent increments lose values, or a callback failure blocks later writes, because read-modify-write is split or user code runs under a lock.
- A supposed export copy changes later because another typed-array view still points at the same shared memory.

## Why choose it

- **Separate shared values from notification cursors.** Copying a counter forks its state; treating peek as synchronization misses publication. A signal attaches to an existing buffer, while peek leaves the cursor untouched and sync acknowledges changes. [Runnable proof](./USEGUIDE.en.md#attach-a-reader-without-overwriting-shared-state).
- **Track the indices actually read.** One whole-array dependency invalidates unrelated coordinates. A tracked get(index) materializes that cell, and equal writes remain silent. [Runnable proof](./USEGUIDE.en.md#notify-only-the-index-an-observer-reads).
- **One reader cannot consume another reader’s changes.** A cleared shared dirty flag can hide updates from later readers. Each wrapper keeps its own generation and cell cursors for sync. [Runnable proof](./USEGUIDE.en.md#let-every-reader-synchronize-independently).
- **A failed callback does not leave a user-held lock behind.** Computing under a lock lets a throw block future writes. update computes outside the lock, attempts CAS, and preserves the original error identity or cause. [Runnable proof](./USEGUIDE.en.md#keep-the-cell-usable-after-an-updater-fails).
- **Export a copy that does not alias live storage.** Another view over the same buffer still shares bytes. snapshot allocates an ordinary Int32Array and reads each cell consistently, separating edits on either side. [Runnable proof](./USEGUIDE.en.md#copy-values-without-exposing-shared-storage).

## Start here

Attach to the same integer from two independent Runtimes, then distinguish reading bytes from synchronizing a cursor:

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { sharedInt32 } from '@migaia/store-shared'

const writer = sharedInt32(createRuntime(), 7)
const reader = sharedInt32(createRuntime(), 999, writer.buffer)
console.log(reader.peek())
writer.value = 9
console.log(reader.peek(), reader.isStale())
console.log(reader.sync(), reader.sync())
writer.dispose()
console.log(reader.peek())
reader.dispose()
```

Output:

```text
7
9 true
true false
9
```

Next, see [tracking per index](./USEGUIDE.en.md#notify-only-the-index-an-observer-reads) and [independent readers](./USEGUIDE.en.md#let-every-reader-synchronize-independently). For automatic notification, check host support for waitAsync and read the watch contract below.

## Pitfalls when writing it yourself

Native shared memory can express these operations, but atomic updates, copies, and publication still need explicit boundaries. This illustration is type-checked only and is not run:

```ts doc-test=check
const buffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
const value = new Int32Array(buffer)
const before = Atomics.load(value, 0)
Atomics.store(value, 0, before + 1) // Pitfall: separate reads and writes lose increments between competing writers.
const copy = new Int32Array(buffer) // Pitfall: another view aliases the same bytes; it is not an independent snapshot.
const latest = Atomics.load(value, 0) // Pitfall: reading new bytes does not publish them to the receiving reactive graph.
void copy
void latest
```

array.update computes outside the lock before CAS, snapshot allocates independent memory, and sync publishes remote changes to the local graph. Occasional cross-thread messages can remain ordinary messages.

## A three-minute mental model

| Problem                                            | Tool                                  |
| -------------------------------------------------- | ------------------------------------- |
| Share one int32                                    | sharedInt32 / SharedInt32Signal       |
| Share fixed-size integer coordinates or flags      | sharedInt32Array / SharedInt32Array   |
| Publish remote writes to the local graph           | sync; optionally watch when supported |
| Inspect bytes without acknowledging a notification | signal.peek; untracked array.get      |
| Retry a contended read-modify-write                | array.update with a pure callback     |
| Obtain an independently editable array             | array.snapshot                        |

A “buffer” is the shared raw memory. A “wrapper” is a JS object owned by one Runtime. A “seq” is a cell’s version and lock. A “generation” indicates possible array changes. A “cursor” records what this reader acknowledged. A “cell” is a local graph source for a tracked index. Shared memory does not mean a shared Runtime or shared subscriptions.

## Typical scenarios

| Scenario                                          | Compose with       | Details                                                                                |
| ------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------- |
| Attach a reader without overwriting shared state  | `sharedInt32`      | [Complete example](./USEGUIDE.en.md#attach-a-reader-without-overwriting-shared-state)  |
| Skip unchanged writes and reject invalid integers | `sharedInt32`      | [Complete example](./USEGUIDE.en.md#skip-unchanged-writes-and-reject-invalid-integers) |
| Notify only the index an observer reads           | `sharedInt32Array` | [Complete example](./USEGUIDE.en.md#notify-only-the-index-an-observer-reads)           |
| Let every reader synchronize independently        | `sharedInt32Array` | [Complete example](./USEGUIDE.en.md#let-every-reader-synchronize-independently)        |
| Keep the cell usable after an updater fails       | `SharedInt32Array` | [Complete example](./USEGUIDE.en.md#keep-the-cell-usable-after-an-updater-fails)       |
| Copy values without exposing shared storage       | `SharedInt32Array` | [Complete example](./USEGUIDE.en.md#copy-values-without-exposing-shared-storage)       |

## Installation

```bash
pnpm add @migaia/store-shared @migaia/reactive
```

These examples import createRuntime directly, so the consuming project must directly install @migaia/reactive. The package also depends on @migaia/lifecycle and @migaia/utils. Examples use independent Runtimes in one process without a Worker or DOM; the contract describes thread integration.

## Essential APIs

| API                                  | When to use it                                         |
| ------------------------------------ | ------------------------------------------------------ |
| sharedInt32 / SharedInt32Signal      | Create or attach one shared integer                    |
| sharedInt32Array / SharedInt32Array  | Create or attach a fixed-size shared integer array     |
| signal.value / array.get / array.set | Track reads and publish writes in this Runtime         |
| array.update / array.snapshot        | Retry read-modify-write, or obtain an independent copy |
| sync / watch                         | Publish remote changes manually or automatically       |
| dispose                              | Stop waiting and disconnect local graph sources        |

## Contract details

### Ownership, entry point, and host requirements

The package has one root entry. It exports two classes, two factories, and error identity helpers; it does not provide a Store, Worker, message protocol, or object serializer. Its dependencies are `@migaia/reactive`, `@migaia/lifecycle`, and `@migaia/utils`. It has no DOM, Node, or Worker binding. Create an `IRuntime` before creating a shared wrapper.

`sharedInt32` delegates to `new SharedInt32Signal`; `sharedInt32Array` delegates to `new SharedInt32Array`. Both classes remain public for type annotations and `instanceof` checks. `SharedWaitMode` and `ISharedWaitMode` were removed without compatibility aliases. Migrate old imports; `watch()` has no wait-mode argument.

Share the `SharedArrayBuffer`, and create a separate wrapper in each Runtime. The reactive ownership system gives each JS object one Runtime owner; an existing object cannot be registered with another Runtime. Send `.buffer` across a thread boundary and attach with the same array length. Attachment preserves existing data. Disposing one wrapper does not dispose another wrapper.

In browsers, shared memory generally requires cross-origin isolation and suitable COOP/COEP response headers. The host must provide `SharedArrayBuffer`, `Atomics`, and the required integer typed arrays. `watch()` additionally requires native `Atomics.waitAsync`. Ordinary reactive signals suffice for state within one thread; `postMessage` can be simpler for occasional small messages. Strings, objects, nested structures, floating-point values, and integers outside int32 are outside this package's storage contract.

### Construction and layout

| Parameter                                 | Required / default            | Contract                                                             |
| ----------------------------------------- | ----------------------------- | -------------------------------------------------------------------- |
| Both factories: `runtime: IRuntime`       | Required; no default          | Runtime that owns tracking and error reporting                       |
| Signal: `initialValue: number`            | Optional; `0`                 | Validated and written only for a new buffer; ignored when attaching  |
| Signal: `buffer: SharedArrayBuffer`       | Optional; allocate 32 bytes   | Attach to an existing signal layout without overwriting it           |
| Array: `length: number`                   | Required; no default          | A non-negative integer, fixed after construction                     |
| Array: `options`                          | Optional; `{}`                | A non-null object; field-access failures retain the original `cause` |
| `options.buffer: SharedArrayBuffer`       | Optional; allocate for length | Attach to an array layout; ignore the contents of `initialValues`    |
| `options.initialValues: Iterable<number>` | Optional; none                | Fill the required prefix of a new buffer; remaining cells stay zero  |

Initialization consumes at most `length` values. Reaching that limit closes the original iterator through native IteratorClose. A zero-length array never pulls a value. Iteration or value-validation failure becomes a `RangeError` with `INVALID_OPTION` and the original `cause`. When attaching, initialization contents are ignored, but the constructor still reads both options fields.

The current header revision is **1**. It includes magic, revision, kind, and ready fields. Attachment validates them and, for arrays, the declared length. Older, mismatched, or incomplete layouts are rejected without automatic compatibility. A signal occupies 32 bytes, including an int32 value and aligned int64 seq. An array uses a 32-byte header and 64-bit generation, then `length` int32 values, padding to an 8-byte boundary, and `length` int64 seq values. Its layout size is `align8(32 + length * 4) + length * 8`.

A nonshared buffer, invalid length, capacity overflow, or invalid header produces `RangeError` with `INVALID_OPTION`. An undersized buffer produces `RangeError` with `BUFFER_TOO_SMALL`. Array capacity checks include safe-integer arithmetic and the Int32Array slot limit. Construction does not scan all array seqlocks; a cell establishes its reactive baseline when first read in a tracking context.

### All shared signal members

`SharedInt32Signal` implements `IObservable` and `IDisposable`.

| Member                                     | Signature / meaning                                                                            |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `runtime`, `buffer`                        | Readonly Runtime owner and shared memory                                                       |
| `subs`                                     | `ReadonlySet<IObserver>`, maintained by reactive                                               |
| `version`                                  | A `number` version in the reactive graph, separate from shared seq                             |
| `disposed`                                 | Whether the wrapper has been disposed                                                          |
| `value`                                    | Getter/setter; reads consistently, publishes remote changes, and tracks; writes validate int32 |
| `peek(): number`                           | Consistent read without tracking, advancing the observed cursor, or notifying                  |
| `sync(): boolean`                          | Advance the cursor and notify this Runtime only when the version changed                       |
| `watch(scheduler?: IScheduler): IDisposer` | Start automatic synchronization and return a stop function                                     |
| `isStale(): boolean`                       | Compare the shared version with the local cursor without advancing it                          |
| `onObserved()`, `onUnobserved()`           | Empty hooks required by the graph protocol                                                     |
| `dispose(): void`                          | Idempotently stop watching and disconnect the graph source                                     |

Publishing from the `value` getter can synchronously trigger another writer, so the getter rereads when necessary before returning. After a committed write, the setter wakes remote waiters before notifying the local graph source. Writing the same value advances no version and sends no notification. `peek()` can return a remote value while `isStale()` remains `true`: reading shared bytes and publishing them to the graph are separate operations.

After disposal, `value`, `peek()`, `sync()`, and `watch()` throw `SIGNAL_DISPOSED`. `isStale()` does not check active state, and metadata remains accessible. Its consistent read can still reach the contention limit; the absence of an active-state check is not a promise that it cannot throw.

### All shared array members

`SharedInt32Array` implements `IDisposable`, not a whole-array `IObservable`, and has no whole-array `isStale()`. Each observed index has its own private graph source.

| Member                                     | Signature / meaning                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| `runtime`, `buffer`, `length`, `disposed`  | Readonly owner, memory, length, and disposal state                                |
| `get(index: number): number`               | Synchronize and track that cell in a tracking context; otherwise read it directly |
| `set(index: number, value: number): void`  | Validate and commit; skip unchanged values                                        |
| `update(index, updater): number`           | `updater: (current: number) => number`; return the committed value                |
| `sync(index?: number): number`             | One index returns `0` / `1`; no argument returns the number of changed indices    |
| `watch(scheduler?: IScheduler): IDisposer` | Wait on the header generation and perform full synchronization after waking       |
| `snapshot(): Int32Array`                   | Read cells consistently into a new ordinary, nonshared array                      |
| `dispose(): void`                          | Idempotently stop watching and disconnect all materialized cells                  |
| `assertActive(): void`                     | Throw `ARRAY_DISPOSED` after disposal                                             |

`get`, `set`, `update`, and `sync(index)` check active state, then require an integer in `[0, length)`. Invalid indices throw `RangeError` with `INDEX_OUT_OF_RANGE`. Outside an Effect/Computed tracking context, `get()` creates no cell and does not advance the array's observed cursor. Tracking reads create and reuse cells on demand. A cell is reclaimed immediately when its final observer unsubscribes. Speculative reads that never commit a subscription are reclaimed through the owning Runtime's idle cleanup, which uses microtasks by default.

`update()` invokes the updater outside the lock, validates its int32 result, then attempts CAS against the current value it read. A conflict causes another read and another updater call, with a limit of 65536 attempts. The updater should be a pure function that is safe to retry, without irreversible side effects. An updater failure cannot leave a lock in the odd state; error identity rules appear below.

The `snapshot()` result can be modified independently. The operation guarantees consistency **per cell**, not a transaction spanning all cells. After disposal, the high-level `get/set/update/sync/watch/snapshot/assertActive` methods throw `ARRAY_DISPOSED`.

### Synchronization, watching, and independent readers

High-level local writes publish materialized graph sources through canonical `createSourceBinding` and `source.notify()`, update shared versions, and wake remote waiters. Another Runtime's Effect does not rerun merely because shared bytes changed. The receiving wrapper must publish through `sync()` or `watch()`. Signal `value` and tracked array reads also pull their own locations; `peek()` and untracked `get()` only read bytes.

Each array instance owns its own generation and per-cell version cursors. With unchanged generation, `sync()` returns `0`. Otherwise it scans all `length` seqlocks and publishes local changes inside one `runtime.batch()`. The count includes changed indices without observers. This is an O(length) scan; `sync(index)` checks one cell. There is no shared dirty bitmap for one reader to clear on behalf of others. Local publication does not prematurely mark the whole generation as scanned, which would hide remote writes at other indices.

`watch(scheduler?)` always uses native `Atomics.waitAsync`; it has no polling mode. Without that API it synchronously throws `ENV_UNSUPPORTED`. The caller can pump `sync()` from its own message loop or timer. Synchronous `Atomics.wait` blocks and cannot replace asynchronous watching on a browser main thread.

The first active watch captures the scheduler, defaulting to `systemScheduler`. Repeated calls during that watch return the same stop function and retain the first scheduler. Stopping is idempotent, and a later call can start a new watch. The scheduler owns zero-delay yielding and cancellation between wakeups; native waiting remains separate. Import `IScheduler` or `systemScheduler` from `@migaia/utils/scheduler` when providing that owner, and directly install `@migaia/utils` when importing it.

Starting a watch can synchronously publish existing changes. Each iteration captures the wait version before synchronizing writes from the rearm window. A further write makes waiting return `not-equal`, rather than becoming an unseen baseline. Stopping or disposing cancels a scheduled task and notifies the parked wait so it can settle promptly. Callbacks after stopping do not restart the loop. Watch failures are reported only through the owning Runtime's `reportError`; its adapter owns host diagnostics.

### Low-level composition

These existing methods support low-level composition and are rarely needed by application code.

| Method                                                                  | Contract                                                                                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `readCell(index): { readonly value: number; readonly version: bigint }` | Consistent raw seqlock read without tracking                                                                                                                         |
| `writeCell(index, value, expected?): bigint \| undefined`               | `expected?: number` is the expected current value; omission means unconditional write; commit returns a version, unchanged value or CAS mismatch returns `undefined` |
| `notifyWaiters(): void`                                                 | Advance header generation and wake array watchers                                                                                                                    |
| `recordObservedVersion(index, version: bigint): void`                   | Copy only the array's observed cursor without publishing an existing cell                                                                                            |

These low-level methods do not validate active state, indices, or int32 values. The caller owns those preconditions. After a successful `writeCell()`, call `notifyWaiters()` and then `sync(index)` to reuse normal publication. Do not copy the version with `recordObservedVersion()` first: hiding the cursor difference can suppress notification to an existing local cell.

### Seqlocks and bounded contention

Each aligned int64 seq is both a version and a lock. An even seq means a stable value; an odd seq means a writer holds the lock. Reading follows “read even before → read value → read after,” accepting the value/version pair only when before equals after. Writing first uses CAS to change even to odd, checks an optional expected value, skips an unchanged value or commits the new value, and releases to the corresponding even seq. A successful value change advances the version by two. No user callback runs while the lock is held.

Each spin round allows 65536 attempts. Threads allowed to block then use `Atomics.wait` for at most 1 ms; threads that cannot block continue another round. About one second without a consistent read or successful lock acquisition produces `CONTENTION_LIMIT`. `update()` also has a 65536-attempt CAS limit. Sustained active contention, a delayed writer, or an abandoned odd lock can all reach a limit. **The error alone does not prove a writer crashed.** Check writers and contention first. If a terminated writer is confirmed to have abandoned the lock, the package does not repair it: coordinate replacement of the old buffer across its owners.

High-level initialization and writes accept only integers in `[-2147483648, 2147483647]`. They do not silently truncate with `value | 0`. A fractional value or `2 ** 31` is rejected without replacing the committed shared value.

### Error identity and handling

`STORE_SHARED_SOURCE` is the string constant `'@migaia/store-shared'`. `StoreSharedErrorCode` contains the following entries; `IStoreSharedErrorCode` is the union of their values.

| Property / code                          | Trigger and response                                                                                                              |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `signalDisposed` / `SIGNAL_DISPOSED`     | High-level access to a disposed signal; attach a new wrapper                                                                      |
| `arrayDisposed` / `ARRAY_DISPOSED`       | High-level access to a disposed array; create a new wrapper                                                                       |
| `bufferTooSmall` / `BUFFER_TOO_SMALL`    | Buffer too small during construction; provide the required capacity                                                               |
| `indexOutOfRange` / `INDEX_OUT_OF_RANGE` | Non-integer or out-of-range index; correct it                                                                                     |
| `contentionLimit` / `CONTENTION_LIMIT`   | Consistent read, lock acquisition, or CAS reaches its limit; investigate contention and rebuild only after confirming abandonment |
| `envUnsupported` / `ENV_UNSUPPORTED`     | Native waitAsync is missing; pump sync from the caller                                                                            |
| `updateFailed` / `UPDATE_FAILED`         | An unclassified updater failure; fix the callback, whose failure outside the lock does not prevent later writes                   |
| `invalidOption` / `INVALID_OPTION`       | Invalid options/buffer/length/layout, failed initialization, non-int32 value, or nonfunction updater; correct the input           |

Validation generally uses `RangeError`; disposal, contention, and missing waitAsync use `Error`. A mutable native updater Error without identity receives `UPDATE_FAILED` in place, preserving the object and stack. Frozen errors and non-Error thrown values remain reachable through the wrapper's `cause`. A complete foreign `source/code` retains its original owner and identity, so updater failures do not all have this package's source.

`createStoreSharedError(code, message, options?)` and `createStoreSharedRangeError(code, message, options?)` construct identified Error and RangeError instances for upper-level composition. Both require `code: IStoreSharedErrorCode` and `message: string`, with no defaults. `options?: { readonly cause?: unknown }` is optional with no default. A non-undefined cause is passed through, then `attachErrorIdentity` adds source/code without rewriting the stack.

### Worker integration, teardown, and troubleshooting

The main thread creates its Runtime and wrapper, then sends the buffer and array length through its message protocol. The Worker creates its own Runtime and attaches. A side that renders reactively establishes an Effect for the needed locations, then chooses watch or sync from an existing loop. The SAB shares the same memory rather than cloning data. Do not transmit wrappers, rendering functions, or Runtime objects as shared instances.

On shutdown, the host stops its Effects, watch, and timers, disposes local wrappers, and terminates the actual Worker. Resources created inside the Worker remain that host's responsibility. Timer-driven sync is a caller scheduling choice, not an implicit library fallback.

If shared reads show new bytes but the view did not rerun, check for peek or untracked get and verify that the receiver publishes through sync. Handle `ENV_UNSUPPORTED` when waitAsync is missing. For invalid values, check integer range. If full sync is too much work and the changed index is known, use sync(index). Disposed wrappers require a new instance.

### Package maintenance commands

The existing scripts are `fmt`, `lint`, `typecheck`, `typecheck:test`, and `test`. Existing tests cover seqlocks, synchronization across Runtimes, watch lifetimes, independent cursors, and error identity. Report results only after actually executing the commands.

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
```
