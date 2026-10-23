# `@migaia/lifecycle` usage guide

[中文](./USEGUIDE.md)

The [README](./README.en.md) explains what the package is for, what sets it apart and the mental model. This guide starts with runnable examples organised by scenario, then lists every exported API module by module, with signatures, edge cases and error codes.

## Find your scenario

| Your problem | Read |
| --- | --- |
| Deploys cut off in-flight requests | [Graceful service shutdown](#graceful-service-shutdown) |
| A search box or detail page shows stale results | [Use only the latest request's result](#use-only-the-latest-requests-result) |
| Subscriptions and timers keep running after a page closes | [Clean up together when a page closes](#clean-up-together-when-a-page-closes) |
| Initialisation fails halfway and leaves resources nobody closes | [Reclaim what was created when initialisation fails](#reclaim-what-was-created-when-initialisation-fails) |
| Two saves arrive out of order and old content overwrites new | [Save in submission order](#save-in-submission-order) |
| One cleanup fails and the rest never run | [One cleanup fails, the rest still run](#one-cleanup-fails-the-rest-still-run) |

## Graceful service shutdown

The [README](./README.en.md#start-here) shows requests finishing in time. This example shows the other case: a request needs 10 seconds, longer than the 300 ms shutdown deadline. `boundedWait` returns `false` at the deadline and shutdown carries on instead of hanging on that request; it does not cancel the request either.

```ts doc-test=run
import { boundedWait } from '@migaia/lifecycle'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()
const inFlight = createPendingTracker()
app.own('db-pool', { force: () => console.log('database pool closed') })
app.own('http', {
  force: async () => {
    const finished = await boundedWait(inFlight.drain(), performance.now() + 300)
    console.log(finished ? 'all in-flight requests finished' : `${inFlight.size} request(s) still running, closing anyway`)
  }
})

// An export request that takes 10 seconds. unref() keeps it from holding the example process open.
void inFlight.track(new Promise((resolve) => setTimeout(resolve, 10_000).unref()))
await app.dispose()
```

Output:

```text
1 request(s) still running, closing anyway
database pool closed
```

In a real service, connect `app.dispose()` to `process.once('SIGTERM', …)` and keep the deadline shorter than the platform's forced kill. Kubernetes, for example, kills a container 30 seconds after SIGTERM by default, so a 25-second deadline fits.

## Use only the latest request's result

Call `begin()` before each request to get that request's `token` and `signal`. A newer `begin()` makes the previous request stale and aborts its `signal`. When a result arrives, confirm with `isCurrent(token)` that it still belongs to the latest request before updating the page.

```ts doc-test=run
import { createGenerationController } from '@migaia/lifecycle/generation'

// A fake search API: shorter keywords match more and answer more slowly.
const search = (keyword: string, signal: AbortSignal) =>
  new Promise<string[]>((resolve, reject) => {
    const timer = setTimeout(() => resolve([`results for ${keyword}`]), keyword.length === 1 ? 300 : 100)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })

const requests = createGenerationController()
let shown: string[] = []

async function onInput(keyword: string) {
  const request = requests.begin() // a newer input makes the previous request stale and aborts it
  try {
    const results = await search(keyword, request.signal)
    if (requests.isCurrent(request.token)) shown = results
  } catch (error) {
    if (!requests.isCurrent(request.token)) return // replaced by newer input; ignore
    throw error
  }
}

// The user types "a" and immediately "ab".
await Promise.all([onInput('a'), onInput('ab')])
console.log('page shows:', shown)
```

Output:

```text
page shows: [ 'results for ab' ]
```

`begin({ timeoutMs })` adds a timeout that aborts the request's `signal` when it expires. If a stale request already obtained something that must be released (a connection, say), use `adopt(token, value, release)`: it returns `true` and leaves the value to you when the result is still current, and otherwise calls `release(value)` and returns `false`.

## Clean up together when a page closes

Create a scope when a page opens and register every subscription, timer and connection in it; call `dispose()` once when the page closes. Release runs in reverse registration order, so registering the connection before the subscription that depends on it means the subscription is removed first and the connection closed last.

```ts doc-test=run
import { createLifecycleScope } from '@migaia/lifecycle/scope'

function openChatPage(messages: EventTarget) {
  const page = createLifecycleScope()

  page.own('connection', { force: () => console.log('connection closed') })

  const onMessage = () => console.log('message received')
  messages.addEventListener('message', onMessage)
  page.own(onMessage, {
    force: () => {
      messages.removeEventListener('message', onMessage)
      console.log('message subscription removed')
    }
  })

  const timer = setInterval(() => console.log('heartbeat'), 60_000)
  page.own(timer, {
    force: () => {
      clearInterval(timer)
      console.log('heartbeat timer cleared')
    }
  })
  return page
}

const messages = new EventTarget()
const page = openChatPage(messages)
messages.dispatchEvent(new Event('message'))
await page.dispose() // the page closes
messages.dispatchEvent(new Event('message')) // prints nothing now
```

Output:

```text
message received
heartbeat timer cleared
message subscription removed
connection closed
```

Calling `own()` after `dispose()` throws `SCOPE_TERMINAL`, so nothing can attach to a page that is already gone. When every cleanup is synchronous (DOM listeners, for instance), use `createSyncLifecycleScope()`: its `dispose()` finishes immediately and it supports the `using` syntax.

## Reclaim what was created when initialisation fails

When initialisation has several steps, register what each step creates in a provisional scope first. When every step succeeds, call `commitTo(app)` to hand everything to the long-lived scope at once; when a step fails, call `rollback()` to release what was already created, in reverse order.

```ts doc-test=run
import { createProvisionalScope } from '@migaia/lifecycle'
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const app = createLifecycleScope()

// Installing a plugin takes three steps: connect the database, open the cache, register routes.
async function installPlugin(failAtStep3: boolean) {
  const setup = createProvisionalScope()
  try {
    setup.own('db', { force: () => console.log('  reclaimed: database disconnected') })
    setup.own('cache', { force: () => console.log('  reclaimed: cache closed') })
    if (failAtStep3) throw new Error('route conflict')
    await setup.commitTo(app) // all steps succeeded: hand everything to the app scope
    console.log('plugin installed')
  } catch (error) {
    await setup.rollback() // a step failed: release what was created, in reverse order
    console.log('install failed:', (error as Error).message)
  }
}

await installPlugin(true)
await installPlugin(false)
console.log('app shutting down:')
await app.dispose()
```

Output:

```text
  reclaimed: cache closed
  reclaimed: database disconnected
install failed: route conflict
plugin installed
app shutting down:
  reclaimed: cache closed
  reclaimed: database disconnected
```

`commitTo()` and `rollback()` are mutually exclusive and may be chosen only once. If the target scope starts closing during the hand-over, what was already handed over stays with the target, the rest is released by the provisional scope, and `PROVISIONAL_PARENT_CLOSED` is thrown with the original error on `cause`.

## Save in submission order

When two saves are sent almost at once, the slower, older one can reach the server last and overwrite newer content. `createMutationQueue()` runs changes one at a time: a later save starts only after the earlier one has finished.

```ts doc-test=run
import { createMutationQueue } from '@migaia/lifecycle'

// A fake server: the first save is slower than the second.
let stored = ''
const save = (text: string, delayMs: number) =>
  new Promise<void>((resolve) =>
    setTimeout(() => {
      stored = text
      resolve()
    }, delayMs)
  )

// Sent concurrently: the slow old version arrives last and overwrites the new one.
await Promise.all([save('draft v1', 100), save('draft v2', 10)])
console.log('without a queue the server keeps:', stored)

// Through a mutation queue: the later save waits for the earlier one.
const queue = createMutationQueue()
await Promise.all([
  queue.enqueue(() => save('draft v1', 100)),
  queue.enqueue(() => save('draft v2', 10))
])
console.log('with a queue the server keeps:', stored)
```

Output:

```text
without a queue the server keeps: draft v1
with a queue the server keeps: draft v2
```

The queue never runs tasks concurrently. A task that submits another task to the same queue and awaits it would wait forever; pass `{ owner }` with each task and that case fails at once with `QUEUE_SELF_DEPENDENCY` instead of hanging.

## One cleanup fails, the rest still run

The default error policy is `throw`: every resource is released first, then the failure is thrown. With one failure, the thrown value is the original error itself, with `source` and `code` added; with several failures, an `AggregateError` is thrown and every original error is in `errors`.

```ts doc-test=run
import { createLifecycleScope } from '@migaia/lifecycle/scope'

const page = createLifecycleScope()
page.own('socket', { force: () => console.log('socket closed') })
page.own('cache', {
  force: () => {
    throw new Error('cache file is locked')
  }
})
page.own('timer', { force: () => console.log('timer cleared') })

try {
  await page.dispose()
} catch (error) {
  const failure = error as Error & { code?: string }
  console.log('dispose() failed:', failure.message, `(${failure.code})`)
}
console.log('scope state:', page.lifecycle)
```

Output:

```text
timer cleared
socket closed
dispose() failed: cache file is locked (SCOPE_DISPOSAL_FAILED)
scope state: terminal
```

If shutdown should not throw, use `createLifecycleScope({ errorPolicy: 'collect' })` and `dispose()` returns the failures as an array, or `{ errorPolicy: 'report', report }` to send each failure to a logger.

---

## Contents

- [Shared base types](#shared-base-types): the common shapes for owners, states, disposers and errors
- [Scopes and release](#scopes-and-release): `createLifecycleScope`, `createSyncLifecycleScope`, `executeReleaseDescriptor`, `createDisposeTransaction`, `createSyncStartedDisposalLedger`, `IReleaseDescriptor`, `IReleaseContext`
- [Request generations](#request-generations): `createGenerationController`
- [Quiescence and leases](#quiescence-and-leases): `createQuiescenceTracker`, `createObjectLeaseRegistry`, `createStringLeaseRegistry`, `createPendingTracker`
- [Provisional ownership](#provisional-ownership): `createProvisionalScope`
- [Mutation queue](#mutation-queue): `createMutationQueue`
- [Schedulers, cancellation and bounded waits](#schedulers-cancellation-and-bounded-waits): `snapshotScheduler`, `resolveScheduler`, `resolveSchedulerOption`, `createAbortController`, `abortableDelay`, `boundedWait`, `createTerminalController`
- [Error helpers](#error-helpers): `LIFECYCLE_SOURCE`, `containAsyncRejection`, `createErrorCollector`
- [State constants](#state-constants): `LifecycleState`, `LifecycleErrorPolicy`, `DisposeTransactionKind`
- [Subpath imports and tree-shaking](#subpath-imports-and-tree-shaking)
- [Error codes](#error-codes): what each of the 22 `LifecycleErrorCode` values means
- [Diagnostic messages](#diagnostic-messages): `LifecycleErrorText`
- [Combined examples](#combined-examples)
- [Public API index](#public-api-index)
- [Troubleshooting and build gates](#troubleshooting-and-build-gates)

---

## Shared base types

These types are exported from the root entry and create no runtime state:

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IDisposer = () => void
type ILifecycleState = 'open' | 'closing' | 'terminal'

type ILifecycleOwner = {
  own<T>(resource: T, descriptor: IReleaseDescriptor): T
}

type ICollectedError = Readonly<{
  source: string
  error: unknown
}>

type IErrorPolicy = 'throw' | 'collect' | 'report' | 'firstError'
```

- `IDisposer`: a synchronous release function held by the caller; it should be idempotent.
- `ILifecycleOwner`: anything that accepts a resource together with an explicit `IReleaseDescriptor`. `ProvisionalScope.commitTo()` depends on it, so both sync and async scopes can be the target even though their `dispose()` shapes differ.
- `ILifecycleState`: whether a resource container is still open; loading states belong to whoever owns the loading.
- `ICollectedError`: a failure plus the `source` label the caller supplied. Both fields are readonly at compile time; the collector does not freeze each item. An unclassified native error gets a code attached in place, a primitive is wrapped, and an error that already carries a valid source and code keeps it. The raw ledger does not go through this projection.
- `IErrorPolicy`: the four ways release errors can surface. New callers normally choose `throw`, `collect` or `report`; `firstError` exists for callers that need first-error-wins behaviour.
- `IReleaseContext` and `IReleaseDescriptor` are described in full in the next section; other named types appear next to their factory.

---

## Scopes and release

```ts
import {
  createLifecycleScope,
  createSyncLifecycleScope,
  executeReleaseDescriptor,
  createDisposeTransaction,
  createSyncStartedDisposalLedger,
  type IReleaseDescriptor,
  type IDisposerContext,
  type IReleaseContext,
  type ILifecycleScope,
  type ILifecycleScopeOptions,
  type ISyncLifecycleScope,
  type ISyncLifecycleScopeOptions,
  type ISyncReleaseDescriptor,
  type IDisposeItem,
  type IDisposeTransaction,
  type IDisposeTransactionMode,
  type IDisposeTransactionOptions,
  type ISyncStartedDisposalLedger,
  type ISyncStartedDisposalOutcome
} from '@migaia/lifecycle'
```

Two independent concerns are at work: whether the container is still open (`open → closing → terminal`, driven by `close()` and `dispose()`), and releasing the resources themselves. `close()` is always synchronous and idempotent and never calls your code; `dispose()` is always asynchronous.

### `IReleaseDescriptor`: how a resource is released

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IReleaseDescriptor = {
  readonly syncSafe?: boolean
  readonly order?: number
  readonly graceful?: (context: IReleaseContext) => void | PromiseLike<void>
  readonly gracefulTimeoutMs?: number
  readonly force: (context: IReleaseContext) => void | PromiseLike<void>
  readonly gcFallback?: boolean
  readonly custom?: (context: IReleaseContext) => void | PromiseLike<void>
}
```

Fields:

- `syncSafe?: boolean`: declares that `SyncLifecycleScope` may accept this descriptor. It does not change the static type of `LifecycleScope`; whether a scope is sync or async depends on which factory created it, never on descriptor content.
- `order?: number`: release ordering key, `0` when omitted. It only applies in a `DisposeTransaction` running in `order` mode, where larger values are released first.
- `graceful?`: a gentle release. When it times out, the scope **stops waiting** for it (without cancelling it) and moves on to `force`. If `graceful` throws (as opposed to timing out), `force` still runs. A `graceful` that returns synchronously counts as a completed release: even if it overran its budget, `force` does not run, and one `DEADLINE_EXCEEDED` diagnostic goes to `context.report`.
- `gracefulTimeoutMs?: number`: the graceful phase's own budget, further capped by the transaction's shared absolute `deadlineAt` (the smaller wins).
- `force: (context) => void | PromiseLike<void>` (**required**): must complete unconditionally and must not depend on any precondition.
- `gcFallback?: boolean`: an async scope may register a best-effort `FinalizationRegistry` fallback, which explicit release (`dispose()` or `release()`) unregisters. A live scope holds strong references to its resources, so this never collects one resource while its scope is reachable; it only helps when the whole owner is forgotten and never replaces explicit disposal. A sync scope accepts the field but registers no finalizer.
- `custom?`: an escape hatch. When present it takes over the release completely and `graceful`/`force` are ignored.

`IReleaseContext` (the first argument of every callback): `signal: IAbortSignal` (aborts when the container starts closing), `deadlineAt: number | undefined`, `scheduler?: IScheduler` (the clock that produced `deadlineAt`; `systemScheduler` by default), `report(error: unknown): void` (a diagnostic channel; its own throws and rejections go to the shared host error queue from `@migaia/utils`), and `disposer?: IDisposerContext`. Only callbacks driven by a `LifecycleScope` receive `disposer.join()`. That explicit "wait for my own owner" operation throws `SCOPE_REENTRANT_DISPOSE` immediately, whether called synchronously or after any await, microtask, Promise chain, nested helper or timer, and never returns the outer disposal Promise. A generic `createDisposeTransaction()` without a scope owner does not fake this capability. Do not capture the scope and call `scope.dispose()` inside a disposer to get around it.

### `createLifecycleScope`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createLifecycleScope(options?: ILifecycleScopeOptions): ILifecycleScope

type ILifecycleScopeOptions = {
  readonly errorPolicy?: 'throw' | 'collect' | 'report' | 'firstError' // default 'throw'
  readonly report?: (error: unknown) => void
  readonly deadlineAt?: number
  readonly scheduler?: IScheduler // default systemScheduler
}

type ILifecycleScope = ILifecycleOwner & {
  readonly lifecycle: 'open' | 'closing' | 'terminal'
  own<T>(resource: T, descriptor: IReleaseDescriptor): T
  release(resource: unknown): boolean
  close(): void
  dispose(): Promise<readonly ICollectedError[]>
  [Symbol.asyncDispose](): Promise<void> // await using; discards the collected errors
}
```

The general-purpose async ownership container:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const scope = createLifecycleScope()
const connection = scope.own(
  { close: () => undefined },
  {
    force: (ctx) => connection.close()
  }
)
scope.close() // synchronous and idempotent; own() throws SCOPE_CLOSED afterwards
const failures = await scope.dispose() // releases in reverse order; throws under the 'throw' policy
```

Edge cases:

- `own(resource, descriptor)`: throws `SCOPE_CLOSED` / `SCOPE_TERMINAL` when the container is `closing` / `terminal`, and `SCOPE_REENTRANT_OWN` when called from inside one of its own disposers. An invalid descriptor shape (`order`, `custom`, `graceful`, `gracefulTimeoutMs`, `force`, checked by the same rules as at dispose time) throws `INVALID_OPTION` at registration; an accessor that throws is rethrown unchanged.
- `release(resource)`: unregisters a resource without releasing it (the caller already released it) and returns whether an entry was found and removed. If the entry used `gcFallback`, its `FinalizationRegistry` entry is unregistered too.
- `close()`: synchronous and idempotent; `open → closing`.
- `dispose()`: releases every registered resource in reverse (LIFO) order. Concurrent calls share one Promise. To express "wait for my own owner" inside a disposer, use `context.disposer.join()`, which throws `SCOPE_REENTRANT_DISPOSE` without disturbing the shared Promise. Once the container is `terminal`, `dispose()` still returns the first dispose Promise with its original result or rejection. With `errorPolicy: 'collect'` the result is the collected `ICollectedError[]`; the other three policies throw or report internally and return an empty array.
- `[Symbol.asyncDispose](): Promise<void>` makes the scope usable with `await using` (TypeScript needs the `ESNext.Disposable` lib).

### `createSyncLifecycleScope`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createSyncLifecycleScope(options?: ISyncLifecycleScopeOptions): ISyncLifecycleScope

type ISyncLifecycleScopeOptions = {
  readonly errorPolicy?: 'throw' | 'collect' | 'report' | 'firstError' // default 'throw'
  readonly report?: (error: unknown) => void
}

type ISyncReleaseDescriptor = IReleaseDescriptor & { readonly syncSafe: true }

type ISyncLifecycleScope = {
  readonly lifecycle: 'open' | 'closing' | 'terminal'
  own<T>(resource: T, descriptor: ISyncReleaseDescriptor): T
  release(resource: unknown): boolean
  close(): void
  dispose(): readonly ICollectedError[] // always synchronous
  [Symbol.dispose](): void // using; discards the collected errors
}
```

A purely synchronous container:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const scope = createSyncLifecycleScope()
scope.own(node, { syncSafe: true, force: () => node.detach() })
scope.close()
const failures = scope.dispose() // returns synchronously
```

Rules and edge cases:

- Every descriptor must state `syncSafe: true`; otherwise `own()` throws `SCOPE_SYNC_VIOLATION` **at registration**, not at release.
- Descriptor shape checks match the async version: an `order` that is not a finite number, a missing `force` and similar mistakes throw `INVALID_OPTION` from `own()`.
- A `LifecycleScope` or `ProvisionalScope` instance cannot be owned (detected by an internal brand); trying throws `SCOPE_SYNC_VIOLATION`.
- A callback (`custom`, `graceful` or `force`) that returns a thenable is detected synchronously at release and reported as `SCOPE_SYNC_VIOLATION`. A violating `graceful` still falls through to `force`; a violating `force` or `custom` counts as that item's failure under the current error policy.
- The fallback chain matches the async version (`custom`, otherwise `graceful` then `force`) but without timeouts, since there is nothing to wait for.
- `release()` and `close()` behave as in the async version. `dispose()` is idempotent and returns `[]` on later calls; calling it from inside a disposer throws `SCOPE_REENTRANT_DISPOSE`.
- `[Symbol.dispose](): void` makes the scope usable with `using` (TypeScript needs the `ESNext.Disposable` lib).

### `executeReleaseDescriptor`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function executeReleaseDescriptor(
  descriptor: IReleaseDescriptor,
  context: IReleaseContext
): Promise<readonly unknown[]>
```

Runs one descriptor's full fallback chain (`custom`, otherwise `graceful` with its timeout race, then `force`) without a full transaction. Useful in tests and custom orchestration:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const errors = await executeReleaseDescriptor(descriptor, {
  signal: controller.signal,
  deadlineAt: undefined,
  report: (e) => console.error(e)
})
```

Both arguments are required and `context` has no optional fields: build the complete object. Failures while admitting or running the descriptor end up in the returned array (empty on success). A context that cannot be admitted (a throwing getter, an invalid deadline) rejects the Promise. A `graceful` timeout sends a diagnostic to `context.report` (`DEADLINE_EXCEEDED`, or a note that it fell through to `force`). A failing `force` additionally reports an error labelled `RELEASE_FORCE_FAILED`, while the original error still goes into the returned array unchanged.

### `createDisposeTransaction`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createDisposeTransaction(
  mode: { readonly kind: 'order' } | { readonly kind: 'plan' },
  options?: IDisposeTransactionOptions
): IDisposeTransaction

type IDisposeItem = { readonly source: string; readonly descriptor: IReleaseDescriptor }

type IDisposeTransactionOptions = {
  readonly errorPolicy?: 'throw' | 'collect' | 'report' | 'firstError' // default 'throw'
  readonly report?: (error: unknown) => void
  readonly deadlineAt?: number
  readonly scheduler?: IScheduler // default systemScheduler
  readonly signal?: IAbortSignal
  readonly disposer?: IDisposerContext // passed by LifecycleScope; provides disposer.join()
  readonly pending?: { drain(): Promise<void> }
}

type IDisposeTransaction = {
  readonly mode: { readonly kind: 'order' } | { readonly kind: 'plan' }
  run(items: readonly IDisposeItem[]): Promise<readonly ICollectedError[]>
}
```

Coordinates the release of several resources, either by priority (`order`) or in an exact sequence (`plan`). One transaction uses one mode:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const transaction = createDisposeTransaction(
  { kind: 'plan' },
  { errorPolicy: 'collect', signal: controller.signal }
)
const failures = await transaction.run([
  { source: 'db', descriptor: dbDescriptor },
  { source: 'socket', descriptor: socketDescriptor }
])
```

Edge cases:

- `{ kind: 'order' }`: groups items by `descriptor.order` (default `0`) and releases larger values first; the sort is stable, so items with the same value keep the order you gave. `order` is read only in this mode.
- `{ kind: 'plan' }`: runs `items` exactly in the given order and never reads `order`.
- `signal?`: forwarded into every item's `context.signal`. When `run()` starts, the transaction mirrors the abort state of the signal you passed; without one, items receive a lazily created signal that never aborts.
- `deadlineAt` / `scheduler`: shared by every item in one `run()`, not recomputed per item.
- `pending?`: after every item is released, `pending.drain()` is awaited once so that work started by the releases can finish (typically a `createPendingTracker()`).
- Descriptor checks (types and accessors of `order`, `custom`, `graceful`, `gracefulTimeoutMs`, `force`) are made per item. One item's invalid descriptor (coded `INVALID_OPTION`) does not stop the others; it counts as that item's failure under the error policy.
- `errorPolicy` behaves like `createErrorCollector`. Under `throw`, a single failure keeps its native instance and an unclassified error gets `SCOPE_DISPOSAL_FAILED` attached; a primitive is wrapped with the original on `cause`; an error that already has a valid source and code keeps it. Several failures become an `AggregateError` coded `SCOPE_DISPOSAL_FAILED`.

### `mergeCleanupResults`

`mergeCleanupResults(values)` accepts an array of cleanup results (or PromiseLikes of them), waits for each result's `physicalCompletion` chain and returns a frozen `{ cleanupErrors }`. Errors are merged in input order and, within each input, in the order they were observed now or later. A rejected source Promise is kept as its original error, and no other branch is dropped. It does not rely on realm-local `instanceof Promise`, so Promises from other realms and plain thenables both work.

`ICleanupResult<TError>` is the shared boundary between lifecycle, PluginHost and Tray: the current `cleanupErrors` and the later `physicalCompletion` **never contain the same error twice**. Domain flags such as logical terminal, ok or cleanupComplete stay with each caller. Do not put the full error list into the physical continuation, or errors are counted twice.

```ts
import { mergeCleanupResults } from '@migaia/lifecycle/disposal'

const first = new Error('flush')
const late = new Error('socket close')
const result = await mergeCleanupResults([{
  cleanupErrors: [first],
  physicalCompletion: Promise.resolve({ cleanupErrors: [late] })
}])
// result.cleanupErrors === [first, late]; both error objects are unchanged.
```

### `createSyncStartedDisposalLedger`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createSyncStartedDisposalLedger(): ISyncStartedDisposalLedger

type ISyncStartedDisposalLedger = {
  readonly lifecycle: 'open' | 'closing' | 'terminal'
  readonly pending: number
  start(source: string, callback: () => unknown): void
  seal(): ISyncStartedDisposalOutcome
  whenTerminal(): Promise<void>
}

type ICleanupResult<TError = unknown> = Readonly<{
  cleanupErrors: readonly TError[]
  physicalCompletion?: Promise<ICleanupResult<TError>>
}>

type ISyncStartedDisposalOutcome = ICleanupResult<ICollectedError> & Readonly<{
  physicalCompletion: Promise<ICleanupResult<ICollectedError>>
}>
```

For containers whose `dispose()` must start every disposer synchronously but whose cleanup may finish asynchronously. The ledger is the single source of truth for what is pending, the raw errors and when everything has ended. The caller still decides the order, clears its own registry and turns raw errors into its own throw/report/aggregate contract.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
import { createSyncStartedDisposalLedger, mergeCleanupResults } from '@migaia/lifecycle/disposal'

const ledger = createSyncStartedDisposalLedger()

// The caller chooses the order; each callback runs on the current stack inside start().
ledger.start('connection', () => connection.close())
ledger.start('cache', () => cache.flush())

const outcome = ledger.seal()
if (outcome.cleanupErrors.length === 1) {
  throw outcome.cleanupErrors[0].error
}

const { cleanupErrors: finalErrors } = await mergeCleanupResults([outcome])
// Merges the current snapshot with later errors; the caller decides whether to throw, aggregate or report.
```

State and identity:

- It starts `open`; `start()` does not change the state.
- The first `seal()` moves to `closing` synchronously, freezes every error observed so far and returns the single outcome. Later `seal()` calls return the same object, and `outcome.physicalCompletion` stays the same Promise.
- Once sealed with `pending === 0` it becomes `terminal`; otherwise it becomes `terminal` after the last thenable settles. `whenTerminal()` only waits for that; it does not promise a stable Promise identity.
- A valid thenable that never settles keeps the ledger `closing`. The ledger adds no timeout, abort, retry or forced terminal state of its own.

Callbacks and thenables:

- `start()` first checks that `source` is a string and `callback` a function; invalid input throws `INVALID_OPTION` synchronously without calling the callback.
- A callback that throws synchronously, or whose result's `.then` getter throws, is recorded in the error snapshot taken at `seal()`. `start()` does not rethrow item failures, so later items can still be started.
- A thenable's `.then` is read once and called with the original thenable as receiver; the first settlement wins. Rejections enter the final ledger in the order they are observed.
- Each error is a frozen `{ source, error }`; the original `error` object is never replaced. `physicalCompletion` does not reject because of an item failure, so the ledger never takes over the caller's error policy.

Re-entry and closing:

- Calling `start()` or `seal()` while an item's callback or thenable probe is still running throws `SCOPE_REENTRANT_OWN` synchronously (with the `disposalLedgerReentrant` message); the outer `start()` records it as that item's synchronous failure.
- `start()` after `seal()` throws `SCOPE_CLOSED` synchronously (with the `disposalLedgerClosed` message) without calling the new callback.
- There is no rollback: once `closing`, the ledger can only wait for admitted thenables to settle.

Error policy: the ledger always collects raw errors. `firstError` is simply the final ledger's first observation; `throw`, `report`, the `AggregateError` message/source/code and containment of reporter failures all belong to the calling adapter and are not pushed into the ledger.

---

## Request generations

```ts
import {
  createGenerationController,
  type IGenerationController,
  type IGenerationControllerOptions,
  type IGenerationRequest,
  type IGenerationToken
} from '@migaia/lifecycle'
```

### `createGenerationController`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createGenerationController(options?: IGenerationControllerOptions): IGenerationController

type IGenerationControllerOptions = {
  readonly parentSignal?: IAbortSignal
  readonly onSuperseded?: (info: ILifecycleError) => void
  readonly scheduler?: IScheduler // default systemScheduler
  readonly report?: (error: unknown) => void
}

type IGenerationToken = object

type IGenerationRequest = {
  readonly generation: number
  readonly token: IGenerationToken
  readonly signal: IAbortSignal
}

type IGenerationController = {
  readonly generation: number
  readonly disposed: boolean
  begin(options?: { readonly timeoutMs?: number }): IGenerationRequest
  isCurrent(token: IGenerationToken): boolean
  complete(token: IGenerationToken): boolean
  supersede(reason?: unknown): void
  adopt<T>(
    token: IGenerationToken,
    value: T,
    release: (value: T) => void | PromiseLike<void>,
    onReleaseError?: (error: unknown) => void
  ): boolean
  dispose(reason?: unknown): void
}
```

A generation counter with one `AbortSignal` per generation; starting a new generation makes the previous one stale:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const shutdown = new AbortController()
const generations = createGenerationController({ parentSignal: shutdown.signal })
const request = generations.begin({ timeoutMs: 5000 }) // aborts this generation after 5 s
const result = await fetchWithSignal(request.signal)
if (generations.adopt(request.token, result, (v) => v.close())) {
  use(result) // still the current generation; safe to use
} // otherwise release() has already reclaimed result and adopt() returned false
```

Edge cases:

- `begin(options?)`: makes the active generation (if any) stale at once by aborting its `signal`, increments `generation` and returns a new `{ generation, token, signal }`. An invalid `options.timeoutMs` (not finite, or negative) throws `INVALID_OPTION`; after that many milliseconds the generation's `signal` aborts. Calling it after `dispose()` throws `GENERATION_DISPOSED`.
- `isCurrent(token)`: whether `token` is still the current generation; always `false` after `dispose()`.
- `supersede(reason?)`: makes the current generation stale (aborting its `signal`) while the controller stays usable, so a later `begin()` still works. A no-op after `dispose()`.
- `complete(token)`: finishes only the matching current generation: returns `true` and makes the token no longer current. It clears the timer, then removes the parent listener, and leaves the signal un-aborted. A stale or disposed token returns `false` without affecting the current generation. A cleanup failure still surfaces as `GENERATION_CANCELLATION_FAILED` with the original `cause`, and the token is stale afterwards; a later `begin()` still works. Real cancellation keeps using `supersede`, the parent signal, a timeout or `dispose`, which keep the signal and its reason.
- `adopt(token, value, release, onReleaseError?)`: when `token` is still current, returns `true` and leaves `value` with the caller. Otherwise calls `release(value)` and returns `false`. A throwing or rejecting `release` is only reported through `onReleaseError` and never affects which generation is current (it does not throw and is not fed into an error policy). If `onSuperseded` is set, the stale path first fires one diagnostic carrying the `GENERATION_SUPERSEDED` code; it is not a failure.
- `dispose(reason?)`: final. Afterwards `begin()` always throws `GENERATION_DISPOSED` and `isCurrent()` always returns `false`.
- When `parentSignal` aborts, the active generation aborts synchronously (its timer is cleared, the parent listener removed and its own controller aborted). Failures during that cleanup are combined into `GENERATION_CANCELLATION_FAILED`.

---

## Quiescence and leases

```ts
import {
  createQuiescenceTracker,
  createStringLeaseRegistry,
  createObjectLeaseRegistry,
  createPendingTracker,
  type IQuiescenceTracker,
  type ILeaseRegistry,
  type IPendingTracker
} from '@migaia/lifecycle'
```

### `createQuiescenceTracker` / `createStringLeaseRegistry`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createQuiescenceTracker<TKey extends object>(): IQuiescenceTracker<TKey>
function createStringLeaseRegistry(): IQuiescenceTracker<string>

type IQuiescenceTracker<TKey> = {
  retain(key: TKey): IDisposer // IDisposer = () => void
  count(key: TKey): number
  whenZero(key: TKey): Promise<void> // strict, exclusive wait
  whenZeroOnce(key: TKey): Promise<void> // non-exclusive wait
  seal(key: TKey): void
  isSealed(key: TKey): boolean
  forget(key: TKey): boolean
}
```

Counts leases per key: object keys use a `WeakMap` (collected with the key), string keys use a `Map` (an unsealed entry is removed when its count reaches zero):

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const tracker = createQuiescenceTracker<object>() // or createStringLeaseRegistry()
const release = tracker.retain(key)
tracker.count(key) // 1
tracker.seal(key) // retain(key) throws QUIESCENCE_SEALED from now on
release()
await tracker.whenZero(key) // must seal first, or it throws QUIESCENCE_UNSEALED_WAIT synchronously
```

Neither factory takes arguments. Edge cases:

- `retain(key)`: throws `QUIESCENCE_SEALED` on a sealed key. The returned release function is idempotent (it decrements only on the first call).
- `whenZero(key)`: **you must `seal(key)` first**, or it throws `QUIESCENCE_UNSEALED_WAIT` **synchronously** (not as a rejected Promise). Resolves immediately when the count is already zero.
- `whenZeroOnce(key)`: needs no seal; waits for the next time the count reaches zero and does not block new `retain()` calls.
- `seal(key)`: idempotent; the key rejects new leases from then on.
- `forget(key)`: removes the key's state and returns `true` only when its count is zero and nobody is waiting; otherwise returns `false`.
- An unsealed string key that reaches zero is removed from the underlying `Map` automatically, so it does not linger; a sealed key keeps the fact that it is sealed.

### `createObjectLeaseRegistry` / `createStringLeaseRegistry`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createObjectLeaseRegistry<TKey extends object>(): ILeaseRegistry<TKey>
function createStringLeaseRegistry(): ILeaseRegistry<string>
// type ILeaseRegistry<TKey> = IQuiescenceTracker<TKey>
```

The same engine under lease-oriented names (they call `createQuiescenceTracker()` / `createStringLeaseRegistry()` internally), for call sites where "lease" reads better. No arguments.

### `createPendingTracker`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createPendingTracker(): IPendingTracker

type IPendingTracker = {
  track<T>(promise: Promise<T>): Promise<T>
  drain(): Promise<void>
  readonly size: number
}
```

A narrow interface exposing only `track`, `drain` and `size`, for tracking and draining Promises in flight (built on one string-keyed `createStringLeaseRegistry()`):

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const pending = createPendingTracker()
pending.track(doWork()) // returns the same promise
await pending.drain() // waits until size is 0; work tracked while draining is not missed
pending.size // number of Promises in flight
```

No arguments. Once a tracked promise settles (resolved or rejected), its lease is released automatically. `drain()` never throws. It loops on `whenZeroOnce()`, so Promises tracked during the drain are waited for as well.

---

## Provisional ownership

```ts
import {
  createProvisionalScope,
  type IProvisionalScope,
  type IProvisionalScopeOptions,
  type ILifecycleOwner
} from '@migaia/lifecycle'
```

### `createProvisionalScope`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createProvisionalScope(options?: IProvisionalScopeOptions): IProvisionalScope

type IProvisionalScopeOptions = { readonly parentSignal?: IAbortSignal }

type IProvisionalScope = {
  readonly signal: IAbortSignal
  own<T>(resource: T, descriptor: IReleaseDescriptor): T
  commitTo(parent: ILifecycleOwner): Promise<void>
  rollback(): Promise<void>
}

type ILifecycleOwner = { own<T>(resource: T, descriptor: IReleaseDescriptor): T }
```

Two-phase ownership during construction: resources wait here until you either `commitTo(parent)` them to their real owner or `rollback()` and release them. You choose one, once:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const shutdown = new AbortController()
const provisional = createProvisionalScope({ parentSignal: shutdown.signal })
const db = provisional.own(await connect(), { force: (ctx) => db.close() })
try {
  await provisional.commitTo(outerScope) // own()s each resource into the parent, in registration order
} catch (error) {
  // the parent refused partway (for example it is closing): what was handed over stays with it,
  // and the rest has already been released and awaited
}
```

Edge cases:

- `own(resource, descriptor)`: throws `PROVISIONAL_SETTLED` after commit or rollback, and `INVALID_OPTION` for an invalid descriptor shape (`order` is not read here; the parent's `own()` checks it at commit).
- `commitTo(parent)`: calls `parent.own(resource, descriptor)` for each resource in registration order. If one fails, everything already handed over stays with the parent, and everything not yet handed over is **released in reverse order and awaited** before the original error is rethrown, so no resource is left owned by nobody. If the cause is that `parent` is already `closing`/`terminal` (code `SCOPE_CLOSED`/`SCOPE_TERMINAL`), the error is wrapped as `PROVISIONAL_PARENT_CLOSED` with the original on `cause` and the release failures of leftover resources on `errors`.
- `rollback()`: releases every registered resource in reverse order. A single failure keeps its coded native instance; a primitive is wrapped with the original on `cause`; several failures become an `AggregateError` coded `SCOPE_DISPOSAL_FAILED`. Concurrent and repeated calls share one Promise.
- A repeated rollback returns the first Promise, including its rejection. Rolling back after a successful commit, committing twice, or committing after rollback is rejected with `PROVISIONAL_SETTLED` (rollback returns a rejected Promise).
- When `parentSignal` aborts (already at construction, or later), `signal` aborts synchronously too, but that does not trigger rollback or commit; the caller must still choose one.

---

## Mutation queue

```ts
import {
  createMutationQueue,
  type IMutationQueue,
  type IMutationQueueOptions,
  type IEnqueueOptions
} from '@migaia/lifecycle'
```

### `createMutationQueue`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createMutationQueue(options?: IMutationQueueOptions): IMutationQueue

type IMutationQueueOptions = {
  readonly queueAdmissionTimeoutMs?: number | false // default undefined (diagnose only, never reject for waiting)
  readonly admissionDiagnosticMs?: number | false // default 1000
  readonly onAdmissionDiagnostic?: (info: { owner: string | undefined; waitedMs: number }) => void
  readonly scheduler?: IScheduler // default systemScheduler
}

type IEnqueueOptions = {
  readonly owner?: string
  readonly queueAdmissionTimeoutMs?: number | false // overrides the queue default for this task
}

type IMutationQueue = {
  enqueue<T>(task: () => T | PromiseLike<T>, options?: IEnqueueOptions): Promise<T>
  readonly size: number
}
```

A strict first-in-first-out queue that runs one task at a time, with an optional watchdog for how long a task may wait to start:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const queue = createMutationQueue({ queueAdmissionTimeoutMs: 5000 })
const result = await queue.enqueue(() => applyMutation(), { owner: 'sync-loop' })
queue.size // tasks waiting plus the one running (0 or 1)
```

Edge cases:

- `queueAdmissionTimeoutMs`: a number removes a task that has waited longer than that and rejects it with `QUEUE_ADMISSION_TIMEOUT`; `undefined` (the default) only diagnoses and never rejects for waiting; `false` does not even start the diagnostic timer.
- `admissionDiagnosticMs`: the diagnostic threshold, used only when `queueAdmissionTimeoutMs` is `undefined` and `onAdmissionDiagnostic` is provided; `false` turns the diagnostic timer off.
- `owner`: detects self-dependency. If an owner **whose task is running** submits a new task to the same queue, that submission is rejected at once with `QUEUE_SELF_DEPENDENCY`, because a FIFO queue cannot run the new task before the current one finishes. This is **partial** protection: a running task that submits a task with a different or no `owner` and awaits it also deadlocks, but nothing reliably signals that case, so it is not intercepted. The safe pattern is to submit follow-up work without awaiting it inside the current task.
- `size`: read-only; tasks waiting plus 0 or 1 running.

---

## Schedulers, cancellation and bounded waits

```ts
import {
  snapshotScheduler,
  createAbortController,
  boundedWait,
  createTerminalController,
  type IAbortController,
  type ITerminalController
} from '@migaia/lifecycle'
import type { IAbortSignal } from '@migaia/utils/promise'

// Scheduler composition helpers exported only from the leaf entry:
import {
  resolveScheduler,
  resolveSchedulerOption
} from '@migaia/lifecycle/scheduler'

// The scheduler contract and implementations come from utils:
import { systemScheduler, type IScheduler, type IScheduledTask } from '@migaia/utils/scheduler'
import { createManualScheduler, type IManualScheduler } from '@migaia/utils/testing'
```

The scheduler contract `IScheduler`/`IScheduledTask` and the default `systemScheduler` (a monotonic `performance.now()` clock) are exported by `@migaia/utils/scheduler`; `createManualScheduler`/`IManualScheduler` come from `@migaia/utils/testing`. This package neither exports nor re-exports them. It keeps only the admission layer: when no scheduler is injected into `createMutationQueue`, `createGenerationController`, `boundedWait` or a dispose transaction, they use a snapshot of `resolveScheduler(systemScheduler)`, so an invalid delay is still rejected with lifecycle `INVALID_OPTION` (`detail.field: 'delayMs'`). Calling the utils `systemScheduler.schedule()` directly with the same input yields utils `INVALID_ARGUMENT` instead.

The first three positional arguments of `abortableDelay(scheduler, ms, signal, reportCleanup?)` are required and the scheduler is used as given; resolve or snapshot it first if you need admission.

### `snapshotScheduler`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function snapshotScheduler(value: unknown): IScheduler | undefined
```

Turns any duck-typed value into a standard `IScheduler` snapshot (checked, with accessors read once so a hostile getter cannot be read twice):

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const snap = snapshotScheduler(candidate) // undefined, not a throw, when it is not a valid scheduler
```

One argument `value: unknown`, no options. Returns `undefined` when neither `now` nor `schedule` is a function, and throws `TypeError` (`INVALID_OPTION`) when reading `now` or `schedule` throws. The snapshot's `schedule()` validates the delay, calls the injected `schedule`, then reads the returned task's `cancel` and `unref` once each, in that order. A missing or non-function `cancel` throws `INVALID_OPTION`. A function `unref` gives the snapshot task an `unref()` forwarded with the original task as receiver; without one the snapshot task has no `unref`. If reading `unref` throws (native `TypeError`, original value on `cause`) or it is not a function, `INVALID_OPTION` is thrown after calling the `cancel` already read, so the timer the injected scheduler started is rolled back. If that rollback fails, the primary error is unchanged and the rollback error is attached on its `errors`.

### `resolveScheduler` / `resolveSchedulerOption`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function resolveScheduler(value: unknown): IScheduler
function resolveSchedulerOption(
  options: { readonly scheduler?: unknown } | null | undefined,
  fallback: IScheduler
): IScheduler
function resolveSchedulerOption(
  options: { readonly scheduler?: unknown } | null | undefined
): IScheduler | undefined
```

Boundary helpers for code that accepts a custom scheduler. `resolveScheduler(value)` throws an `INVALID_OPTION` error with the `schedulerInvalid` message for an invalid value (rather than returning `undefined` like `snapshotScheduler`). `resolveSchedulerOption(options, fallback?)` reads `options.scheduler` and returns `fallback` when it is absent (or `undefined` in the overload without a fallback); reading the property itself throwing raises `TypeError` (`INVALID_OPTION`).

### `createAbortController`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createAbortController(): IAbortController
// type IAbortSignal = { readonly aborted: boolean; readonly reason?: unknown; addEventListener(...); removeEventListener(...) };
// type IAbortController = { readonly signal: IAbortSignal; abort(reason?: unknown): void };
```

Delegates to the host's native `AbortController` and returns a real host instance (structurally compatible with DOM and Node `AbortSignal`, so they can be passed to each other):

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const controller = createAbortController()
controller.signal.addEventListener('abort', () => console.log('aborted'))
controller.abort('reason')
```

No arguments and no custom factory. The object is built by the current realm's own `globalThis.AbortController`; lifecycle returns no facade, Proxy or home-made EventTarget. When the host constructor is missing, its getter throws, it cannot be constructed, construction fails or the result lacks the minimal controller/signal shape, `ENV_UNSUPPORTED` is thrown with the original cause.

Behaviour to be aware of:

- `abort()` and `abort(undefined)` use the host's default reason, usually a native `DOMException` named `AbortError`, not `undefined`.
- An explicit reason other than `undefined` keeps its `===` identity. When an `undefined` reason from a structural parent signal is forwarded to a native child, it is normalised to the host `AbortError` as well.
- Repeated `abort()` calls are idempotent and do not overwrite the first reason.
- An external listener that throws goes through the host EventTarget's error channel; `try/catch` around `controller.abort()` cannot catch it, and lifecycle does not provide an `ABORT_LISTENER_FAILED` error.
- Parent and cancellation callbacks that lifecycle registers itself go through a package-private observed subscription. It handles a signal that is already aborted, an abort during registration, a re-check after registration and idempotent removal, and sends its own callback/read/cleanup failures to the matching operation's collect or report boundary. It does not proxy, enumerate or catch other listeners on the same signal.

If you need listener errors to be thrown back to whoever called `abort`, use a callback coordinator that your own code owns; do not wrap or monkey-patch the native `AbortSignal`.

### `boundedWait`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function boundedWait(
  task: PromiseLike<unknown>,
  deadlineAt: number,
  options?: {
    readonly scheduler?: IScheduler // default systemScheduler
    readonly reportCleanup?: (error: unknown) => void
  }
): Promise<boolean>
```

Waits until an absolute deadline and **never cancels** the task it waits for:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const won = await boundedWait(task, deadlineAt) // true: task finished first; false: deadline first (task still running)
```

`task` and `deadlineAt` are required; `deadlineAt` is an absolute time on the scheduler's clock and is validated. A `.catch()` is always attached to `task`, timeout or not, so a later rejection does not become an unhandled rejection. If `deadlineAt` has already passed it returns `false` immediately (after attaching that handler).

### `createTerminalController`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createTerminalController(): ITerminalController

type ITerminalController = {
  readonly lifecycle: 'open' | 'closing' | 'terminal'
  close(): void
  forceTerminal(): void
  whenTerminal(): Promise<void>
}
```

The reusable open/closing/terminal state machine that `createLifecycleScope` and `createSyncLifecycleScope` are built on:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const terminal = createTerminalController()
terminal.close() // open → closing, idempotent
terminal.forceTerminal() // straight to terminal; resolves whenTerminal()
await terminal.whenTerminal()
```

No arguments. `close()` is synchronous and idempotent and only acts when `open` (a no-op when `closing` or `terminal`). `forceTerminal()` is synchronous and idempotent and goes straight to `terminal`, skipping `closing`. `whenTerminal()` returns the same Promise every time, resolving once when `terminal` is reached; called earlier, it does not resolve immediately.

---

## Subpath imports and tree-shaking

The root entry `@migaia/lifecycle` provides the maintained public building blocks. Consumers that care about what a bundle keeps can use these stable subpaths:

| Subpath | Main exports |
| --- | --- |
| `@migaia/lifecycle/abort` | `createAbortController`, `observeAbortSubscription`, `IAbortController`, `IObservedAbortSubscription`, `IObservedAbortFailureSink` (the structural `IAbortSignal` type comes from `@migaia/utils`) |
| `@migaia/lifecycle/scheduler` | `snapshotScheduler`, `resolveScheduler`, `resolveSchedulerOption` |
| `@migaia/lifecycle/quiescence` | quiescence, lease and pending trackers |
| `@migaia/lifecycle/scope` | `createLifecycleScope` |
| `@migaia/lifecycle/generation` | `createGenerationController` |
| `@migaia/lifecycle/disposal` | release transactions and the sync-started disposal ledger |
| `@migaia/lifecycle/errors` | thenable/error helpers and error identity |

```ts
import { createAbortController } from '@migaia/lifecycle/abort'
import { createPendingTracker } from '@migaia/lifecycle/quiescence'
import { createSyncStartedDisposalLedger, mergeCleanupResults } from '@migaia/lifecycle/disposal'
```

The root and the subpaths re-export the same implementation, so runtime functions and objects with the same name are `===` and there is no second copy of module state. The package does not expose a `dist/*` wildcard; internal files are not public API.

`package.json` declares `sideEffects: false`: importing a module starts no timer, registers no listener and changes no global. Tree-shaking is done by bundlers; Node and Bun resolve the import graph when importing ESM directly but do not remove unused code for you. To check the effect, inspect the modules a Rollup/Vite build keeps or the chunk contents; comparing total gzip bytes alone is easily misled by compression noise.

A subpath still keeps its own dependencies. `/disposal`, for example, keeps the thenable/error helpers; importing by subpath only guarantees that unrelated Scope, Generation or scheduler code is not pulled in, not that one file has no dependencies.

---

## Error helpers

```ts
import {
  LIFECYCLE_SOURCE,
  containAsyncRejection,
  createErrorCollector,
  type ILifecycleError,
  type IErrorCollector
} from '@migaia/lifecycle'
import { probeThenable, assimilateCapturedThen, type IThenableProbe } from '@migaia/utils/function'
```

### `LIFECYCLE_SOURCE`

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const LIFECYCLE_SOURCE: 'lifecycle'
```

The fixed `source` value of every error from this package. A string constant.

Errors are constructed and tagged inside the package; other packages should construct errors with their own source and codes.

### `containAsyncRejection`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function containAsyncRejection(value: unknown, onRejected: (error: unknown) => void): void
```

Safely checks whether a value is a thenable and, if so, observes its rejection so it never becomes an unhandled rejection:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
containAsyncRejection(maybeAsyncCallbackResult, (error) => report(error))
```

Both arguments are required. For a non-thenable it returns without calling `onRejected`. Throws and rejections from `onRejected` itself go to the shared host error queue from `@migaia/utils` (the last error boundary).

### `probeThenable` (utils)

Imported from `@migaia/utils/function`; the tools below belong to utils and are not lifecycle exports.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function probeThenable(value: unknown): IThenableProbe

type IThenableProbe =
  | { readonly kind: 'not-thenable' }
  | { readonly kind: 'thenable'; readonly thenFn: (resolve: unknown, reject: unknown) => void }
  | { readonly kind: 'failed'; readonly error: unknown }
```

Reads `value.then` exactly once and returns a tagged result rather than a boolean, distinguishing "not a thenable" from "the getter threw":

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const probe = probeThenable(result)
if (probe.kind === 'thenable') {
  /* probe.thenFn is captured and can be applied once safely */
}
```

One argument `value: unknown`, no options. Three results: `'not-thenable'` (`null`, a non-object non-function, or `.then` is not a function), `'thenable'` (with the captured `thenFn`), and `'failed'` (reading `.then` threw; `error` is the original thrown value).

### `assimilateCapturedThen`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function assimilateCapturedThen<T>(
  thenFn: (resolve: unknown, reject: unknown) => void,
  thenable: unknown
): Promise<T>
```

Safely turns the `thenFn` captured by `probeThenable` into a real `Promise`, calling it exactly once (with `Reflect.apply`, so `this === thenable`):

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const promise = assimilateCapturedThen<T>(probe.thenFn, thenableValue)
```

`thenFn` (required; must come from `probeThenable`) and `thenable` (required; passed to `thenFn` as `this`). No options.

### `createErrorCollector`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createErrorCollector(
  policy: 'throw' | 'collect' | 'report' | 'firstError',
  report: ((error: unknown) => void) | undefined
): IErrorCollector

type IErrorCollector = {
  readonly policy: IErrorPolicy
  add(source: string, error: unknown): void
  finalize(message: string): readonly ICollectedError[]
}
```

Collects or reports errors under one of the four policies; `createDisposeTransaction` and `createSyncLifecycleScope` use it internally:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const collector = createErrorCollector('collect', undefined)
collector.add('item-1', error)
const collected = collector.finalize('teardown failed') // ICollectedError[] under 'collect'
```

`policy` and `report` are both required; `throw` and `collect` may pass `undefined` explicitly, while `report` and `firstError` need a function or creation throws `INVALID_OPTION`. `add(source, error)` acts immediately according to the policy (`'report'` calls `report` right away; `'firstError'` remembers only the first error and sends the rest to `report`). `finalize(message)`: `'collect'` returns the collected array; `'report'` returns an empty array (already reported in `add`); `'throw'` keeps a single failure's native instance and attaches `SCOPE_DISPOSAL_FAILED` to an unclassified error, wraps a primitive with the original on `cause`, leaves an error with a valid existing source and code unchanged, and combines several failures into an `AggregateError` coded `SCOPE_DISPOSAL_FAILED`; `'firstError'` throws the first error if there was one and otherwise returns an empty array.

---

## State constants

```ts
import {
  LifecycleState,
  LifecycleErrorPolicy,
  DisposeTransactionKind
} from '@migaia/lifecycle'
import { ThenableProbeKind } from '@migaia/utils/function'
```

Plain constant objects (`as const`) to compare against or `switch` on instead of bare string literals.

| Constant | Values | Meaning |
| --- | --- | --- |
| `LifecycleState` | `{ open: 'open', closing: 'closing', terminal: 'terminal' }` | Whether a container is still open |
| `LifecycleErrorPolicy` | `{ throw: 'throw', collect: 'collect', report: 'report', firstError: 'firstError' }` | How release errors surface; `firstError` exists for callers that need first-error-wins behaviour and is not a general default |
| `DisposeTransactionKind` | `{ order: 'order', plan: 'plan' }` | The mode of `createDisposeTransaction` |

---

## Error codes

```ts
import { LifecycleErrorCode, type ILifecycleErrorCode } from '@migaia/lifecycle'
```

The stable error code table: **22 codes**, all declared in `src/error-code.ts`; `source` is always `'lifecycle'`:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
if (error.code === LifecycleErrorCode.scopeClosed) {
  /* ... */
}
```

| `LifecycleErrorCode` key | Code | When it happens |
| --- | --- | --- |
| `delayFailed` | `DELAY_FAILED` | A relative delay could not be registered, scheduled or cleaned up; the original error stays traceable. Cancellation itself returns `false` rather than an error |
| `scopeClosed` | `SCOPE_CLOSED` | `own()` after `close()` (async or sync scope), or `retain()` on a closed registry |
| `scopeTerminal` | `SCOPE_TERMINAL` | Any registration or activation after the container reached `terminal` |
| `scopeReentrantDispose` | `SCOPE_REENTRANT_DISPOSE` | A disposer calls `dispose()` of its own scope |
| `scopeReentrantOwn` | `SCOPE_REENTRANT_OWN` | A disposer calls `own()` of its own scope |
| `scopeSyncViolation` | `SCOPE_SYNC_VIOLATION` | A `SyncLifecycleScope` receives a descriptor without `syncSafe: true`, an async scope instance as a resource, or a callback that returns a thenable |
| `scopeDisposalFailed` | `SCOPE_DISPOSAL_FAILED` | Release failed under the `throw` policy: attached to a single unclassified failure, or carried by the `AggregateError` that combines several |
| `unitStartFailed` | `UNIT_START_FAILED` | Used by the internal unit loader, which is no longer exported |
| `generationSuperseded` | `GENERATION_SUPERSEDED` | A result reached `adopt()` after a newer generation replaced it (a diagnostic, not a failure) |
| `generationCancellationFailed` | `GENERATION_CANCELLATION_FAILED` | Timer, parent listener or signal cleanup failed while cancelling a generation |
| `generationDisposed` | `GENERATION_DISPOSED` | `begin()` on a `GenerationController` that was disposed |
| `generationTimedOut` | `GENERATION_TIMED_OUT` | The current generation's `timeoutMs` expired; `signal.reason` is a coded Error |
| `quiescenceSealed` | `QUIESCENCE_SEALED` | `retain()` after `seal()` |
| `quiescenceUnsealedWait` | `QUIESCENCE_UNSEALED_WAIT` | The strict `whenZero(key)` without `seal(key)` first (thrown synchronously, not a rejected Promise) |
| `provisionalSettled` | `PROVISIONAL_SETTLED` | Committing twice, committing after rollback, or rolling back after a successful commit; a repeated rollback reuses the first Promise |
| `provisionalParentClosed` | `PROVISIONAL_PARENT_CLOSED` | The parent passed to `commitTo()` is `closing`/`terminal` and refuses resources |
| `queueAdmissionTimeout` | `QUEUE_ADMISSION_TIMEOUT` | A mutation waited in the queue longer than `queueAdmissionTimeoutMs` |
| `queueSelfDependency` | `QUEUE_SELF_DEPENDENCY` | An owner whose task is still running submits another task to the same queue, which would deadlock if awaited |
| `releaseForceFailed` | `RELEASE_FORCE_FAILED` | A descriptor's `force` threw or rejected (the contract requires `force` to succeed unconditionally) |
| `deadlineExceeded` | `DEADLINE_EXCEEDED` | The shared absolute deadline already passed when a resource was about to start a graceful phase, or a synchronous `graceful` returned after its budget (still counted as success; `force` does not run). Both are only reported; the normal fallback path does not use this code |
| `envUnsupported` | `ENV_UNSUPPORTED` | The host lacks the `AbortController` support lifecycle needs; missing scheduler support is reported by utils `ENV_UNSUPPORTED` |
| `invalidOption` | `INVALID_OPTION` | A scheduler received an invalid time or delay, or a descriptor field has the wrong type |

The JSDoc in `src/error-code.ts` explains the reasoning behind each code. Always compare with `error.code === LifecycleErrorCode.xxx` instead of hard-coding the string.

---

## Diagnostic messages

```ts
import { LifecycleErrorText, type ILifecycleErrorText } from '@migaia/lifecycle'
```

The stable diagnostic message table (the single place where this package declares its error messages; public so callers can assert on or compare messages):

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
error.message === LifecycleErrorText.disposeTransactionFailed
```

All 49 keys: `delayFailed`, `waitCleanupReporterInvalid`, `provisionalCleanupFailed`, `disposeTransactionFailed`, `scopeReentrantDispose`, `disposeDescriptorInvalid`, `cleanupResultInvalid`, `syncGracefulOverBudget`, `mutationAdmissionTimedOut`, `generationCancellationFailed`, `disposalLedgerClosed`, `disposalLedgerReentrant`, `envUnsupported`, `abortSignalInvalid`, `schedulerTaskCancelGetterFailed`, `schedulerTaskInvalid`, `schedulerAccessorFailed`, `schedulerDeferInvalid`, `schedulerInvalid`, `schedulerNumberType`, `schedulerNumberRange`, `schedulerDelayRange`, `schedulerTimeOverflow`, `errorPolicyReporterMissing`, `generationSupersededReason`, `generationTimedOutReason`, `unitDisposedReason`, `scopeClosedReason`, `provisionalRolledBackReason`, `provisionalCommittedReason`, `quiescenceSealed`, `quiescenceUnsealedWait`, `provisionalSettled`, `provisionalParentClosed`, `unitStartFailed`, `unitTerminal`, `unitClosing`, `generationDisposed`, `generationSupersededBeforeAdopt`, `sharedDeadlinePassed`, `releaseForceFailed`, `syncCallbackReturnedThenable`, `scopeTerminal`, `scopeClosing`, `scopeReentrantOwn`, `syncScopeRequiresSyncSafe`, `syncScopeOwnsAsyncOwner`, `syncScopeDisposalFailed`, `generationTimeoutAccessorFailed`. The stable text and meaning of each key are in `src/error-text.ts`.

---

## Combined examples

### 1. Scope + generations: replace stale results in a request flow

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
import { createLifecycleScope, createGenerationController } from '@migaia/lifecycle'

const scope = createLifecycleScope({ errorPolicy: 'collect' })
const generations = createGenerationController()

async function loadUser(id: string) {
  const request = generations.begin({ timeoutMs: 5000 })
  const user = await fetchUser(id, { signal: request.signal })
  if (!generations.adopt(request.token, user, (u) => u.dispose?.())) return // stale; dropped quietly
  scope.own(user, { force: () => user.dispose?.() })
}
```

### 2. Provisional ownership: roll back on a failed setup, hand over to a long-lived scope on success

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
import { createLifecycleScope, createProvisionalScope } from '@migaia/lifecycle'
import { attachSecondaryErrors } from '@migaia/utils/error'

const rootScope = createLifecycleScope()

async function setupModule() {
  const provisional = createProvisionalScope()
  try {
    const db = provisional.own(await connectDb(), { force: (ctx) => closeDb(db) })
    const cache = provisional.own(await connectCache(), { force: (ctx) => closeCache(cache) })
    await provisional.commitTo(rootScope) // everything moves to rootScope and is released with it
  } catch (error) {
    try {
      await provisional.rollback() // compensate, but keep the setup error as the primary
    } catch (cleanupError) {
      throw attachSecondaryErrors(error, [cleanupError])
    }
    throw error
  }
}
```

### 3. Pending tracker + mutation queue: let a batch land completely before the next one

```ts
import { createPendingTracker, createMutationQueue } from '@migaia/lifecycle'

const pending = createPendingTracker()
const queue = createMutationQueue({ queueAdmissionTimeoutMs: 3000 })

async function applyBatch(mutations: Array<() => Promise<void>>) {
  for (const mutation of mutations) {
    pending.track(queue.enqueue(mutation, { owner: 'batch' }))
  }
  await pending.drain() // waits for the whole batch, including anything added while draining
}
```

### 4. Dispose transaction + bounded waits: close a set of resources gracefully by hand

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
import { createDisposeTransaction, type IDisposeItem } from '@migaia/lifecycle'
import { createManualScheduler } from '@migaia/utils/testing'

const scheduler = createManualScheduler()
const items: IDisposeItem[] = [
  {
    source: 'socket',
    descriptor: {
      order: 10,
      graceful: (ctx) => flushSocket(),
      gracefulTimeoutMs: 100,
      force: () => forceCloseSocket()
    }
  },
  { source: 'db', descriptor: { order: 5, force: () => closeDb() } }
]
const transaction = createDisposeTransaction(
  { kind: 'order' },
  { errorPolicy: 'collect', scheduler }
)
const runPromise = transaction.run(items)
scheduler.advance(100) // the socket's graceful phase times out and falls through to force
const failures = await runPromise
```

### 5. Sync scope: release synchronous resources deterministically with `using`

```ts
import { createSyncLifecycleScope } from '@migaia/lifecycle'

function withListeners() {
  using scope = createSyncLifecycleScope() // [Symbol.dispose]() runs on leaving the block, synchronously
  const handler = () => console.log('tick')
  window.addEventListener('tick', handler)
  scope.own(handler, { syncSafe: true, force: () => window.removeEventListener('tick', handler) })
}
```

### 6. Synchronous entry, asynchronous cleanup: a registry's remaining disposers

When `dispose()` must return synchronously but some disposers return Promises, start them through a ledger and observe them in one place, instead of every registry inventing its own pending/error state machine:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
import { createSyncStartedDisposalLedger, mergeCleanupResults } from '@migaia/lifecycle'

const ledger = createSyncStartedDisposalLedger()

function disposeRegistry(): void {
  ledger.start('cache', () => cache.dispose())
  ledger.start('worker', () => worker.dispose())
  ledger.seal()
}

disposeRegistry()
const outcome = ledger.seal()
const { cleanupErrors: allErrors } = await mergeCleanupResults([outcome])
```

`cleanupErrors` is the error snapshot at seal time; `physicalCompletion` only carries errors observed afterwards. `mergeCleanupResults([outcome])` waits for both and merges them; how they are surfaced remains the registry's public contract.

### 7. Service exit: stop taking work, wait for work in flight, then release resources

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
import { createLifecycleScope, createPendingTracker } from '@migaia/lifecycle'

const scope = createLifecycleScope({ errorPolicy: 'collect' })
const pending = createPendingTracker()

function handle(request: Request): Promise<Response> {
  return pending.track(route(request))
}

async function shutdown() {
  await pending.drain()
  return scope.dispose()
}
```

The tracker from `createPendingTracker()` only answers "how much work is left", and `LifecycleScope` only answers "who releases the resources"; neither replaces the other.

---

## Public API index

Everything below can be imported from the root entry `@migaia/lifecycle`:

- Factories and functions: `createAbortController`, `createSyncStartedDisposalLedger`, `mergeCleanupResults`, `snapshotScheduler`, `containAsyncRejection`, `createErrorCollector`, `abortableDelay`, `boundedWait`, `createTerminalController`, `createLifecycleScope`, `createSyncLifecycleScope`, `createGenerationController`, `createQuiescenceTracker`, `createObjectLeaseRegistry`, `createStringLeaseRegistry`, `createPendingTracker`, `createProvisionalScope`, `createMutationQueue`, `executeReleaseDescriptor`, `createDisposeTransaction`.
- Constants: `LifecycleState`, `LifecycleErrorPolicy`, `DisposeTransactionKind`, `LifecycleErrorCode`, `LifecycleErrorText`, `LIFECYCLE_SOURCE`.
- Types: `IDisposer`, `ILifecycleOwner`, `ILifecycleState`, `IDisposerContext`, `IReleaseContext`, `IReleaseDescriptor`, `ICollectedError`, `IErrorPolicy`, `IDisposeTransactionKind`, `IAbortController`, `ISyncStartedDisposalLedger`, `ISyncStartedDisposalOutcome`, `ICleanupResult`, `ILifecycleErrorCode`, `ILifecycleErrorText`, `ILifecycleError`, `IErrorCollector`, `ITerminalController`, `ILifecycleScope`, `ILifecycleScopeOptions`, `ISyncLifecycleScope`, `ISyncLifecycleScopeOptions`, `ISyncReleaseDescriptor`, `IGenerationController`, `IGenerationControllerOptions`, `IGenerationRequest`, `IGenerationToken`, `IQuiescenceTracker`, `ILeaseRegistry`, `IPendingTracker`, `IProvisionalScope`, `IProvisionalScopeOptions`, `IMutationQueue`, `IMutationQueueOptions`, `IEnqueueOptions`, `IDisposeItem`, `IDisposeTransaction`, `IDisposeTransactionMode`, `IDisposeTransactionOptions`.

Leaf entries offer smaller import boundaries. Only five names are missing from the root entry: `resolveScheduler` and `resolveSchedulerOption` from `@migaia/lifecycle/scheduler`, and `observeAbortSubscription`, `IObservedAbortSubscription` and `IObservedAbortFailureSink` from `@migaia/lifecycle/abort`. `IAbortSignal` belongs to `@migaia/utils/promise` and is not exported by lifecycle; every other leaf symbol is also available from the root. The full mapping is in [Subpath imports and tree-shaking](#subpath-imports-and-tree-shaking).

---

## Troubleshooting and build gates

- **`own()` throws `SCOPE_CLOSED`/`SCOPE_TERMINAL`**: the container is already `closing`/`terminal` and accepts nothing new. Create a new scope instead of reusing the closed one.
- **`own()`/`dispose()` throws `SCOPE_REENTRANT_OWN`/`SCOPE_REENTRANT_DISPOSE`**: a disposer called `own()`/`dispose()` on the very scope that is releasing it. Move that logic out of the disposer or let an outer owner coordinate it.
- **`SyncLifecycleScope.own()` throws `SCOPE_SYNC_VIOLATION`**: the descriptor lacks `syncSafe: true`, a callback returned a thenable, or you tried to own an async `LifecycleScope`/`ProvisionalScope`. A sync scope never awaits; move async resources to `createLifecycleScope()`.
- **`whenZero(key)` throws `QUIESCENCE_UNSEALED_WAIT` synchronously**: `seal(key)` was not called first. The strict wait requires cutting off new leases first; `whenZeroOnce()` drops that requirement but is not exclusive.
- **`GenerationController.begin()` throws `GENERATION_DISPOSED`**: the controller was disposed and cannot be reused; create a new one.
- **`commitTo()` throws `PROVISIONAL_PARENT_CLOSED`**: the target parent is `closing`/`terminal`. What was handed over stays with the parent and the rest was already released; no manual `rollback()` is needed.
- **`enqueue()` throws `QUEUE_SELF_DEPENDENCY`**: an owner submitted and awaited a new task while its own task was running, which would deadlock a FIFO queue; split it into two independent top-level calls.
- **`systemScheduler` throws `ENV_UNSUPPORTED`** (`source: 'foundation.utils'`): the host lacks `performance.now`, `setTimeout` or `clearTimeout`. Inject your own `IScheduler`, or run in a runtime that has them.
- **You need an event bus, current-value subscriptions or a dependency graph**: `@migaia/lifecycle` deliberately does not provide them; see `@migaia/event-subscriber`, `@migaia/reactive` and `@migaia/capability/graph`.

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

Acceptance tests live in `test/`.

## Abortable relative delay

`abortableDelay(scheduler, ms, signal, reportCleanup?)` is imported from the root `@migaia/lifecycle` entry.
`scheduler` does the timing; `ms` must be finite and non-negative; `signal` may be `undefined`.
It returns `Promise<boolean>`: `true` when the delay elapses, `false` when the abort event comes first. The caller decides whether cancellation should become a domain `AbortError`.
The result of a synchronous callback is not committed until listener registration and scheduler admission have finished; an admission failure stays the primary error and the original error instance or cause chain stays traceable.
The task handle is cancelled at most once, and the abort listener is managed by the package's single observed-subscription helper.

```ts
import { abortableDelay, createAbortController } from '@migaia/lifecycle'
import { createManualScheduler } from '@migaia/utils/testing'

const scheduler = createManualScheduler()
const controller = createAbortController()
const waiting = abortableDelay(scheduler, 250, controller.signal)
controller.abort()
console.log(await waiting) // false; no timer is left behind
```

By default a cleanup failure rejects the wait; with `reportCleanup(error)`, cleanup failures go to that observer instead and do not replace a completed or cancelled result.
Registration or scheduling failures still reject; `DELAY_FAILED` keeps the native Error's identity and stack, or keeps the original value on `cause` when identity cannot be attached.
An invalid duration or cleanup reporter is rejected with `INVALID_OPTION` before admission.

`boundedWait(task, deadlineAt, { scheduler, reportCleanup? })` still races an absolute deadline against a task and does not cancel the task.
Its default cleanup-failure behaviour is unchanged; the optional `reportCleanup` lets, for example, a logger flush report a timer cleanup failure as a diagnostic while keeping the task-or-deadline winner.
Batch debounces, periodic health checks and budget grant timers are not one-shot relative delays and are not forced into this helper.

### Scope entry boundaries

`@migaia/lifecycle/scope` is the narrow entry for the async `createLifecycleScope`; import the sync and provisional scopes (`createSyncLifecycleScope`, `createProvisionalScope`) from the root. The package has only one scope implementation. The generation and quiescence subpaths map directly to their single owning modules.

### Helpers that are no longer public

`createLifecycleUnit` and its option/result types are no longer exported; applications use `createGenerationController` for stale work and keep loading state in their own code. `createStringQuiescenceTracker` was replaced by `createStringLeaseRegistry`, which has real consumers. `validateSchedulerTime`, `validateSchedulerDelay`, `tagLifecycleError` and `createLifecycleRangeError` are internal and exposed neither at the root nor from a leaf. `/scheduler` exposes the snapshot/resolve admission helpers. Error constructors and scheduler arithmetic helpers are internal with no compatibility aliases; application errors use their own package's identity.

The generation controller's `report?: (error: unknown) => void` receives failures nobody else can receive: a stale resource's release error when `adopt()` is called without `onReleaseError`, and timer or parent-listener cleanup errors from an asynchronous timeout. Throws and rejections from the reporter itself go to the shared host error queue from utils; without a reporter these diagnostics are not emitted.

### Deferred method capture

`resolveScheduler`/`snapshotScheduler` preserve an admitted `IScheduler.defer` alongside `now`/`schedule`. Replacing the method later cannot redirect owners that already registered; raw getters are read during admission. Missing required methods still make `snapshotScheduler` return `undefined`, while getter failures preserve their cause and a supplied malformed `defer` throws a coded `TypeError`. This adds no second clock and does not change deadline cancellation. An older object may omit `defer` and rely on the utils deferred helper's zero-delay fallback.
