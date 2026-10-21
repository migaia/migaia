# `@migaia/store-shared` usage guide

[简体中文](./USEGUIDE.md) · [Overview and quick start](./README.en.md)

Choose a complete scenario by the behavior you need to confirm. Its code matches the website API examples.

| Scenario                                                                                                | Entry              | What it demonstrates                                |
| ------------------------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------- |
| [Attach a reader without overwriting shared state](#attach-a-reader-without-overwriting-shared-state)   | `sharedInt32`      | Attachment preserves data; peek and sync differ     |
| [Skip unchanged writes and reject invalid integers](#skip-unchanged-writes-and-reject-invalid-integers) | `sharedInt32`      | Equal writes stay silent; invalid values fail       |
| [Notify only the index an observer reads](#notify-only-the-index-an-observer-reads)                     | `sharedInt32Array` | Notifications follow the read index                 |
| [Let every reader synchronize independently](#let-every-reader-synchronize-independently)               | `sharedInt32Array` | Readers acknowledge changes independently           |
| [Keep the cell usable after an updater fails](#keep-the-cell-usable-after-an-updater-fails)             | `SharedInt32Array` | Original failure survives; later updates still work |
| [Copy values without exposing shared storage](#copy-values-without-exposing-shared-storage)             | `SharedInt32Array` | The copy is independent of shared memory            |

Directly install both imported packages before running a scenario. These examples create Runtimes in one process and need no Worker, timer, or rendering framework.

```bash
pnpm add @migaia/store-shared @migaia/reactive
```

## Attach a reader without overwriting shared state

A worker updates an integer, but another Runtime still needs to publish that change to its own graph. A direct read of shared bytes is different from acknowledging a notification.

Copying a value creates a second counter, while cloning the JavaScript wrapper cannot recreate its subscriptions. Treating peek() as synchronization also leaves the local version cursor unchanged.

Install @migaia/store-shared and @migaia/reactive directly. sharedInt32 attaches through buffer, ignores the supplied initial value, and lets each reader explicitly sync its own cursor.

Parameters: `runtime` is required; each wrapper receives its own `createRuntime()`. `initialValue` defaults to `0`; the writer uses `7`, while the reader’s `999` is ignored because `buffer` is present. Omitting the optional buffer allocates a new signal layout; here the reader receives the writer’s shared memory.

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

Prints four lines: `7`, `9 true`, `true false`, then `9`. The attachment preserves 7; peek sees 9 while the cursor is stale; only the first sync acknowledges it.

Each wrapper owns its local graph and lifetime; disposing the writer leaves the attached reader usable. peek() does not track or publish. Without watch(), readers choose when to sync; this example uses two Runtimes in one process.

## Skip unchanged writes and reject invalid integers

A counter observer should rerun for a changed integer, while a repeated assignment should not produce another update. Invalid input must not silently become a different shared value.

Unconditional notifications repeat work for unchanged state. Coercing with bitwise operators truncates fractions and wraps large numbers, hiding the fact that the caller supplied an unsupported value.

sharedInt32 validates int32 writes and skips equal values. The createRuntime schedulerStrategy option runs effects synchronously here for deterministic output; it belongs to reactive, and store-shared does not change Runtime scheduling.

Parameters: `runtime` is required. `schedulerStrategy` in `createRuntime({ schedulerStrategy: (run) => run() })` belongs to reactive and makes effects synchronous here; it is not a signal option. `initialValue` defaults to `0` and is `5` here. No buffer is supplied, so memory is allocated. Writes to `value` must be int32.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { sharedInt32 } from '@migaia/store-shared'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const counter = sharedInt32(runtime, 5)
let runs = 0
const observer = runtime.effect(() => {
  runs++
  void counter.value
})
counter.value = 5
console.log(runs, counter.peek())
try {
  counter.value = 1.5
} catch (error) {
  console.log(error instanceof RangeError, (error as { code: string }).code)
}
console.log(counter.peek())
counter.value = 6
console.log(runs, counter.peek())
observer.dispose()
counter.dispose()
```

Output:

```text
1 5
true INVALID_OPTION
5
2 6
```

Prints `1 5`, `true INVALID_OPTION`, `5`, and `2 6` on separate lines. The same-value assignment and rejected fractional write leave both the stored value and effect count unchanged.

Valid writes are integers from -2147483648 through 2147483647. A changed commit publishes locally; equal writes do not advance the shared version. The supplied Runtime controls when notified effects execute.

## Notify only the index an observer reads

A shared array holds several independent coordinates. Updating one coordinate should refresh its observer while leaving a reader of another index alone.

Observing one whole-array revision makes every coordinate change invalidate every subscriber. Adding a separate dependency table duplicates ownership and cleanup that the Runtime already manages.

sharedInt32Array tracks get(index) per index inside effects. This example installs reactive directly and uses its Runtime schedulerStrategy option for synchronous presentation; that option is not a shared-array constructor field.

Parameters: `runtime` and `length` are required; length is `2` here. `options` defaults to `{}`. Optional `initialValues` has no default and is `[10, 20]` here. The index in get/set/update is required, as is the pure updater passed to update. `schedulerStrategy` is a reactive Runtime option.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { sharedInt32Array } from '@migaia/store-shared'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const coordinates = sharedInt32Array(runtime, 2, { initialValues: [10, 20] })
let firstRuns = 0
let secondRuns = 0
const first = runtime.effect(() => {
  firstRuns++
  void coordinates.get(0)
})
const second = runtime.effect(() => {
  secondRuns++
  void coordinates.get(1)
})
coordinates.set(1, 22)
console.log(firstRuns, secondRuns)
coordinates.set(1, 22)
console.log(firstRuns, secondRuns)
coordinates.update(0, (current) => current + 1)
console.log(firstRuns, secondRuns)
first.dispose()
second.dispose()
coordinates.dispose()
```

Output:

```text
1 2
1 2
2 2
```

Prints `1 2`, `1 2`, then `2 2`. Index 1 wakes only its reader, writing 22 again wakes neither reader, and updating index 0 wakes only the first.

Tracking materializes a source only for the read index; untracked get() reads shared memory directly. Disposing the effects releases their subscriptions, and array disposal releases the remaining local sources.

## Let every reader synchronize independently

Two consumers read the same shared array. Both need to detect a writer update, even if the first consumer has already completed its synchronization pass.

A shared dirty flag that the first reader clears consumes the notification for everyone else. Reading current bytes alone does not establish which cell versions each consumer has acknowledged.

sharedInt32Array gives every attached wrapper its own generation and cell cursors. Share only buffer, preserve the same fixed length, and call sync() separately for each reader; reactive is a direct installation requirement.

Parameters: `runtime` and fixed `length` are required; all three instances use `3`. Optional `options.buffer` attaches both readers to the writer’s memory. The index in `sync(index?)` is optional; omission performs a full pass. `snapshot()` takes no arguments.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { sharedInt32Array } from '@migaia/store-shared'

const writer = sharedInt32Array(createRuntime(), 3)
const first = sharedInt32Array(createRuntime(), 3, { buffer: writer.buffer })
const second = sharedInt32Array(createRuntime(), 3, { buffer: writer.buffer })
writer.set(0, 7)
writer.set(2, 9)
console.log(first.sync(), second.sync())
console.log(first.sync(), second.sync())
console.log(JSON.stringify(Array.from(second.snapshot())))
first.dispose()
second.dispose()
writer.dispose()
```

Output:

```text
2 2
0 0
[7,0,9]
```

Prints `2 2`, `0 0`, and `[7,0,9]` on separate lines. Each reader counts both changed cells independently; repeating a full sync without another write reports zero.

Full sync counts changed indices even without observers. It returns immediately when its generation is unchanged; otherwise it scans length cells and batches local notifications. sync(index) limits the comparison to one index and returns 0 or 1.

## Keep the cell usable after an updater fails

An updater can reject application data while computing a new integer. The caller needs the original failure and must still be able to update the same shared cell afterward.

Executing application callbacks while a seqlock is held lets a throw abandon an odd locked version. Wrapping every failure in a fresh error also loses the original native error identity.

SharedInt32Array.update computes outside the lock and then attempts an expected-value commit. The example throws a prebuilt local TypeError before committing, then performs a pure increment; install reactive directly for createRuntime.

Parameters: the constructor requires `runtime` and `length`; `options` defaults to `{}`. Here `initialValues: [7]` initializes new memory only. Both arguments to `update(index, updater)` are required. The callback receives the current value and returns int32; it can be retried under contention, and failure preserves the original error.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { SharedInt32Array } from '@migaia/store-shared'

const values = new SharedInt32Array(createRuntime(), 1, { initialValues: [7] })
const original = new TypeError('invalid increment')
try {
  values.update(0, () => {
    throw original
  })
} catch (error) {
  console.log(error === original, error instanceof TypeError, (error as { code: string }).code)
}
console.log(values.get(0))
console.log(values.update(0, (current) => current + 1))
values.dispose()
```

Output:

```text
true true UPDATE_FAILED
7
8
```

Prints `true true UPDATE_FAILED`, `7`, and `8` on separate lines. The thrown object is the original TypeError; the failed callback commits nothing, and the next update completes on the same cell.

Unclassified extensible native errors are tagged in place; frozen or non-Error failures remain on cause, and complete foreign identities keep their owner. A contending update may retry its callback, so successful callbacks must be pure and repeatable.

## Copy values without exposing shared storage

An exporter needs a local array it can edit without changing the live shared state. Later shared writes should also leave that earlier copy unchanged.

Creating another typed-array view over shared backing still aliases the same bytes. Treating a multi-cell read as a transaction can also imply consistency across cells that independent writers do not provide.

SharedInt32Array.snapshot allocates a separate nonshared Int32Array and consistently reads each cell into it. Construct the array with a reactive Runtime from the directly installed reactive package, then keep or modify the returned copy.

Parameters: the constructor requires `runtime` and `length`; length is `2` here. Optional `options.initialValues` is `[4, 5]`. `snapshot()` takes no arguments. Both arguments to `set(index, value)` are required and validated as an index and int32 value.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { SharedInt32Array } from '@migaia/store-shared'

const values = new SharedInt32Array(createRuntime(), 2, { initialValues: [4, 5] })
const copy = values.snapshot()
console.log(JSON.stringify(Array.from(copy)))
copy[0] = 99
values.set(1, 8)
console.log(JSON.stringify(Array.from(copy)), JSON.stringify(Array.from(values.snapshot())))
console.log(copy.buffer instanceof SharedArrayBuffer)
values.dispose()
```

Output:

```text
[4,5]
[99,5] [4,8]
false
```

Prints `[4,5]`, `[99,5] [4,8]`, and `false` on separate lines. Editing the copy does not change shared index 0, and writing shared index 1 does not change the earlier copy.

The result is caller-owned ordinary memory. Each cell is read consistently, but concurrent writes can occur between different cell reads; snapshot() does not promise an atomic whole-array transaction.

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
