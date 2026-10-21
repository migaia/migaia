# `@migaia/resource` usage guide

[中文](./USEGUIDE.md)

What the package is for, its highlights and its mental model are in the [README](./README.en.md). This guide first gives runnable examples by scenario (Node 24), then lists the signature, boundary behaviour and error codes of every public `Resource<T>` API. The package exposes only the root entry `@migaia/resource`; there are no stable deep subpaths.

## Find by scenario

| Your problem | Read this section |
| --- | --- |
| A slow old request answers last and overwrites the new result | [Show only the result for the latest input](#show-only-the-result-for-the-latest-input) |
| Several filters change together and several requests go out | [Change several filters, send one request](#change-several-filters-send-one-request) |
| Several components request the same data at once | [Several readers, one request](#several-readers-one-request) |
| A request keeps running after the user leaves | [Stop the running request when the user leaves](#stop-the-running-request-when-the-user-leaves) |
| The page shows "failed" after the user cancels | [Show cancelled instead of an error](#show-cancelled-instead-of-an-error) |
| A refresh blanks the content before showing it again | [Keep showing old data while refreshing](#keep-showing-old-data-while-refreshing) |
| A 404 is retried too, and the original error is lost afterwards | [Retry only temporary failures](#retry-only-temporary-failures) |
| Data loaded on the server is requested again in the browser | [Do not request server-loaded data again](#do-not-request-server-loaded-data-again) |

## Show only the result for the latest input

A search box receives `re`, then the user completes it to `react`. The `re` request is slower and answers after `react`, so the page ends up showing the results for `re`.

The usual code sends a request whenever the input changes and writes the result inside `then`. Every request writes, so whichever answers last wins; when the API cannot be cancelled, an `AbortController` cannot stop that write either.

`Resource` gives every request a generation number and writes only the newest generation's result to `state`. The fetcher reads `keyword.value` before its first `await`, so a keyword change starts a new request without any extra listener.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus } from '@migaia/resource'

const runtime = createRuntime()
const keyword = runtime.signal('re')

// Fake search API: shorter keywords answer more slowly, and it cannot be cancelled
function search(text: string): Promise<string> {
  const delay = text.length < 3 ? 50 : 10
  return new Promise((resolve) =>
    setTimeout(() => {
      console.log(`API answered: "${text}"`)
      resolve(`3 results for "${text}"`)
    }, delay)
  )
}

const results = new Resource(() => search(keyword.value), runtime)

const view = runtime.effect(() => {
  const state = results.state
  if (state.status === ResourceStatus.success) console.log(`page shows: ${state.data}`)
})

keyword.value = 'react' // the user keeps typing
await new Promise((resolve) => setTimeout(resolve, 100)) // wait for both requests to answer
view.dispose()
results.dispose()
```

Output:

```text
API answered: "react"
page shows: 3 results for "react"
API answered: "re"
```

`react` answers first and is shown. `re` answers 50 ms later; the log shows the API answering, but the page does not change again.

Even when the underlying request cannot be cancelled, a replaced request cannot write into `state`. When the API accepts a `signal`, pass it on to stop the network work as well.

## Change several filters, send one request

Switching the sort order on a list page also moves the page number. If each change triggers its own request, one request is wasted and discarded, the API takes twice the load, and the loading state flashes twice.

Hand-written code usually sends a request from each filter's change handler. Merging them means adding a debounce, and the right debounce delay is hard to pick.

`Resource` records both `page` and `sort` as dependencies because the fetcher reads them. Several writes in the same turn only mark it stale, and the next microtask turns them into one request.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus } from '@migaia/resource'

const runtime = createRuntime()
const page = runtime.signal(1)
const sort = runtime.signal('newest')

const orders = new Resource(() => {
  const query = `page ${page.value}, sorted by ${sort.value}` // read before the first await
  console.log(`request: ${query}`)
  return Promise.resolve(`orders for ${query}`)
}, runtime)

const view = runtime.effect(() => {
  const state = orders.state
  if (state.status === ResourceStatus.success) console.log(`shows: ${state.data}`)
})
await orders.promise

// The user picks "popular" and moves to page 2 at the same time
sort.value = 'popular'
page.value = 2
await new Promise((resolve) => setTimeout(resolve, 10))
view.dispose()
orders.dispose()
```

Output:

```text
request: page 1, sorted by newest
shows: orders for page 1, sorted by newest
request: page 2, sorted by popular
shows: orders for page 2, sorted by popular
```

After the first request, changing the sort order and the page together adds exactly one line: `request: page 2, sorted by popular`.

The two writes became one request that reads the final value of both filters; no request for "page 1, popular" is ever sent.

## Several readers, one request

The header, the sidebar and the settings page all need the current user's profile at once. If each asks on its own, the same data is requested three times in parallel.

The common fix is to keep the Promise in a module variable, but then someone has to clear it after a failure, fetch again after it expires and cancel it when the page goes away, and that code ends up spread over every caller.

The `promise` of one `Resource` returns the same Promise while a request is running and while the cached value is fresh. Readers just `await` it; the `Resource` decides when a request is really needed.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'

const runtime = createRuntime()
let requests = 0

const profile = new Resource(async () => {
  requests++
  await new Promise((resolve) => setTimeout(resolve, 10))
  return { name: 'Ada' }
}, runtime)

// The header, the sidebar and the settings page all need the profile at once
const [header, sidebar, settings] = await Promise.all([
  profile.promise,
  profile.promise,
  profile.promise
])
console.log(`requests: ${requests}`)
console.log(`all three got the same object: ${header === sidebar && sidebar === settings}`)

await profile.promise // a later read still uses the cache
console.log(`requests after another read: ${requests}`)
profile.dispose()
```

Output:

```text
requests: 1
all three got the same object: true
requests after another read: 1
```

All three readers receive the same object and one request is sent; reading `promise` again later still finds a fresh cache, so the count stays at 1.

`ttl` defaults to `Infinity`: a success stays fresh until a dependency changes or `refetch()` runs. Sharing happens within one `Resource` instance; requests with different parameters need their own instances.

## Stop the running request when the user leaves

A report takes a second to load and the user leaves halfway. The request keeps running, and its result is written into a view that no longer exists or keeps holding a connection and memory.

By hand you create an `AbortController`, call `abort()` when leaving, and tell "cancelled" apart from "really failed" in `catch`. Every page repeats this, and one missed place leaves a request that only stops when it finishes.

`dispose()` aborts the current request's `signal`, clears the dependencies and makes a pending `promise` fail with `AbortError`. The fetcher only has to hand `signal` to the underlying request.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'

const runtime = createRuntime()

// Fake API that answers after 1 second and stops when aborted
function loadReport(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('report data'), 1000)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      console.log('underlying request stopped')
      reject(signal.reason)
    })
  })
}

const report = new Resource(({ signal }) => loadReport(signal), runtime)
const waiting = report.promise.catch((error: Error & { code?: string }) => {
  console.log(`waiter received: ${error.name} (${error.code})`)
})

report.dispose() // the user leaves the page
await waiting
console.log(`resource disposed: ${report.disposed}`)
```

Output:

```text
underlying request stopped
waiter received: AbortError (REQUEST_ABORTED)
resource disposed: true
```

Right after `dispose()` the log shows the underlying request stopping, and the waiter receives `AbortError` with code `REQUEST_ABORTED`.

`AbortError` is a native `DOMException`, so `error.name === 'AbortError'` is enough to treat it as a normal exit rather than a fault. To stop only this request and reuse the resource later, call `cancel()` instead.

## Show cancelled instead of an error

The user clicks "Cancel export" and the page shows "Export failed", because cancellation and failure end up in the same `catch`.

Hand-written state usually has only loading, success and failure. Cancellation is squeezed into failure and told apart by comparing message strings.

`cancel()` turns the pending request into the `cancelled` state, with a native `AbortError` in `state.error`. The resource is not disposed; `refetch()` starts it again.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'

const runtime = createRuntime()
let attempt = 0

const exportJob = new Resource(({ signal }) => {
  attempt++
  return new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => resolve(`export ${attempt} finished`), 20)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason)
    })
  })
}, runtime)

exportJob.cancel() // the user clicks "Cancel export"
const cancelled = exportJob.state
console.log(`status: ${cancelled.status}`)
if (cancelled.status === 'cancelled') console.log(`reason: ${cancelled.error.name}`)

console.log(await exportJob.refetch()) // the same resource can start again
exportJob.dispose()
```

Output:

```text
status: cancelled
reason: AbortError
export 2 finished
```

After cancelling, the status is `cancelled` with reason `AbortError`; the following `refetch()` completes and prints `export 2 finished`.

`cancelled` is a state of its own, so the page can branch on `ResourceStatus.cancelled` to show "cancelled". Reading `state` after a cancel does not restart the request; only an explicit `refetch()` does.

## Keep showing old data while refreshing

Every refresh of the price list first blanks it to "loading". The content disappears and comes back, and the reader loses their place.

Hand-written code usually keeps data and loading state in one variable, so refreshing means clearing the data first. Keeping the old data needs another "is refreshing" flag that every exit path must remember to reset.

With `staleWhileRevalidate`, `state` stays `success` during a refresh, `data` keeps the old value and only `refreshing: true` is added. The new data replaces it when it arrives.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus } from '@migaia/resource'

const runtime = createRuntime()
let version = 0

const prices = new Resource(
  async () => {
    await new Promise((resolve) => setTimeout(resolve, 10))
    version++
    return `price list v${version}`
  },
  runtime,
  { staleWhileRevalidate: true } // keep showing the old data while refreshing
)

const view = runtime.effect(() => {
  const state = prices.state
  if (state.status === ResourceStatus.pending) console.log('loading…')
  if (state.status === ResourceStatus.success) {
    console.log(state.refreshing ? `${state.data} (refreshing in the background)` : state.data)
  }
})

await prices.promise
runtime.flush()
await prices.refetch() // the user clicks "Refresh"
runtime.flush() // let the effect see the new result right away
view.dispose()
prices.dispose()
```

Output:

```text
loading…
price list v1
price list v1 (refreshing in the background)
price list v2
```

The output is loading, v1, v1 refreshing in the background, then v2. The page always has content during the refresh.

`state.status` describes the data on screen; whether a request is running is reported separately by `fetchStatus` (`ResourceFetchStatus`). If the refresh is cancelled, `refreshing` is cleared and the old data stays.

## Retry only temporary failures

A gateway sometimes answers 503 and a retry fixes it, but retrying a 404 never helps and only delays the error.

Hand-written retry loops easily retry every error, or throw a new wrapper error once retries run out, so the caller can no longer recognize its own `HttpError`.

`retry` can be a function that decides from the failure count and the error whether to try again, and `retryDelay` decides how long to wait. When retrying stops, the last original error is rejected; `Resource` only attaches a `code` to it.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'

class HttpError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.status = status
  }
}

const runtime = createRuntime()
const replies = [503, 404] // first a temporary gateway failure, then "not found"
let attempt = 0

const order = new Resource(
  async () => {
    const status = replies[attempt++]
    console.log(`request ${attempt}: ${status}`)
    throw new HttpError(status)
  },
  runtime,
  {
    // Retry only 503, at most 3 times; retrying a 404 would not help
    retry: (failureCount, error) =>
      failureCount <= 3 && error instanceof HttpError && error.status === 503,
    retryDelay: (failureCount) => failureCount * 20 // 20 ms, 40 ms, ... growing each time
  }
)

try {
  await order.promise
} catch (error) {
  const failure = error as HttpError & { code?: string }
  console.log(`final failure: ${failure.message}, still an HttpError: ${failure instanceof HttpError}`)
  console.log(`code: ${failure.code}`)
}
order.dispose()
```

Output:

```text
request 1: 503
request 2: 404
final failure: HTTP 404, still an HttpError: true
code: FETCH_FAILED
```

After the 503 the resource waits 20 ms and tries again; the 404 is not retried and the request fails.

The final error is still the same `HttpError` (`instanceof` is true) and now carries the code `FETCH_FAILED`. An error that already has its own `source` and `code` keeps them.

## Do not request server-loaded data again

Server rendering already loaded the user profile, and the browser loads it again as soon as the page arrives. The first screen flashes a loading state and the API takes twice the requests.

Hand-written code often embeds the data in the page and skips the request when data is present, but nobody records how long that data stays valid, so it either never refreshes or refetches at once.

`dehydrate()` exports the data plus two durations: how old it is (`ageMs`) and how long it stays fresh (`remainingTtlMs`). The browser passes it as `initialSnapshot`; the `Resource` keeps counting on its own clock and sends no request while the snapshot is fresh.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { Resource, ResourceStatus } from '@migaia/resource'

// Server: load once and put the result and its remaining lifetime into the page
const onServer = new Resource(async () => ({ name: 'Ada' }), createRuntime(), { ttl: 60_000 })
await onServer.promise
const html = JSON.stringify(onServer.dehydrate())
onServer.dispose()

// Browser: create the resource from the snapshot in the page
let browserRequests = 0
const onClient = new Resource(
  async () => {
    browserRequests++
    return { name: 'Ada' }
  },
  createRuntime(),
  { ttl: 60_000, initialSnapshot: JSON.parse(html) }
)

const state = onClient.state
if (state.status === ResourceStatus.success) console.log(`first paint shows: ${state.data.name}`)
console.log(`requests in the browser: ${browserRequests}`)
onClient.dispose()
```

Output:

```text
first paint shows: Ada
requests in the browser: 0
```

The first read of `state` in the browser is already `success`, and the fetcher was never called.

The snapshot carries durations, not the server's absolute time, so the two clocks need not agree. Time spent in transport or storage is the caller's to subtract from `remainingTtlMs`, and `data` must be JSON-serializable.

---

## API manual

### Contents

- [`Resource<T>`](#resource): constructor, state getters, operations, snapshot methods
- [Options `IResourceOptions`](#options)
- [State types](#state-types): `IResourceState`, `ResourceStatus`, `ResourceFetchStatus`
- [`IResourceFetcher` and dependency tracking](#fetcher-and-dependency-tracking)
- [Snapshot type `IResourceCacheSnapshot`](#snapshot-type)
- [Underlying building blocks from lifecycle](#underlying-building-blocks)
- [Error codes](#error-codes): every `ResourceErrorCode` (9 codes)
- [Combined examples](#combined-examples)
- [Troubleshooting and build gates](#troubleshooting-and-build-gates)

---

<a id="resource"></a>

## `Resource<T>`

```ts doc-test=skip reason="Signature summary, not a runnable module"
import { Resource, type IResourceOptions } from '@migaia/resource'
import type { IRuntime } from '@migaia/reactive'

class Resource<T> implements IObserver, IDisposable {
  constructor(fetcher: IResourceFetcher<T>, runtime: IRuntime, options?: IResourceOptions<T>)

  readonly runtime: IRuntime
  debugName?: string
  readonly deps: ReadonlySet<IObservable>
  readonly depVersions: ReadonlyMap<IObservable, number>

  readonly state: IResourceState<T>
  readonly promise: Promise<T>
  readonly disposed: boolean
  readonly refreshing: boolean
  readonly fetchStatus: ResourceFetchStatus
  readonly isStale: boolean
  readonly observed: boolean

  read(): T
  peek(): T
  peekState(): IResourceState<T>
  reset(): void
  refetch(): Promise<T>
  invalidate(): Promise<T>
  cancel(): void
  dehydrate(): IResourceCacheSnapshot<T> | undefined
  hydrate(snapshot: IResourceCacheSnapshot<T>): void
  dispose(): void

  // IObserver members: called internally by the @migaia/reactive dependency graph; you normally do not call them
  markDirty(): void
  onDependencyDisconnected(): void
}
```

A reactive, cancellable async resource. You give it a `fetcher`; the reactive values the `fetcher` reads synchronously **before its first `await`** become dependencies. When a dependency changes a new request starts automatically, and only the newest generation's result takes effect.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
import { Resource, ResourceStatus } from '@migaia/resource'
import { createRuntime } from '@migaia/reactive'
import { fetchUser } from './user-api.js'

const runtime = createRuntime()
const userId = runtime.signal('1')

const user = new Resource(
  ({ signal }) => {
    const id = userId.value
    return fetchUser(id, { signal })
  },
  runtime,
  { ttl: 30_000, staleWhileRevalidate: true, retry: 2 }
)

const stopRendering = runtime.effect(() => {
  const state = user.state
  if (state.status === ResourceStatus.pending) console.log('loading user')
  if (state.status === ResourceStatus.success) console.log('render', state.data)
})

userId.value = '2'

export function disposeUserPanel(): void {
  stopRendering.dispose()
  user.dispose()
  userId.dispose()
}
```

The live chain is `userId → Resource → rendering effect`. The fetcher reads `userId.value` synchronously before returning its Promise, so the Runtime registers the Resource as an observer of `userId`; the effect reads `user.state` and becomes an observer of the Resource's internal state signal. A write to `userId` marks the Resource dirty through Reactive's idle/microtask channel; the Resource aborts the old generation and starts a new one, and the state change reruns the effect. Even when the old request ignores the abort and answers late, the generation check refuses to write it back. Reactive reads after the first `await` are outside the synchronous tracking window and do not create this refresh chain.

### Constructor

`new Resource(fetcher, runtime, options?)`:

- `fetcher: IResourceFetcher<T>` (required): `({ signal }) => T | PromiseLike<T>`.
- `runtime: IRuntime` (required): `createRuntime()` or `defaultRuntime` from `@migaia/reactive`; decides which dependency graph the `Resource` belongs to.
- `options?: IResourceOptions<T>` (optional, see [Options](#options)).
- Every option is **snapshotted and validated once** in the constructor. A failure while reading a field itself (a hostile getter) becomes a `TypeError` with code `INVALID_OPTION`, instead of surfacing later from an arbitrary call.
- When `initialSnapshot` is given, the constructor `hydrate()`s it first. Then, if `autoStart` (default `true`) is on and there is no initial snapshot or it has expired, the first request starts immediately.

### State getters

- `state: IResourceState<T>`: the reactive state-machine snapshot. Reading it records a dependency and checks the lifetime: an expired `success` or an `idle` state starts a new request. Throws `RESOURCE_DISPOSED` after disposal.
- `promise: Promise<T>`: the shared Promise of the current request or the latest cached value. Every reader receives the same Promise, and work starts only when idle or expired. Throws `NO_ACTIVE_PROMISE` when there is no Promise to return.
- `disposed: boolean`: whether `dispose()` was called; safe to read after disposal, as are `refreshing` and `observed`.
- `refreshing: boolean`: whether a background refresh is running (`staleWhileRevalidate: true` while the old success is still shown); returns `false` after disposal instead of throwing.
- `fetchStatus: ResourceFetchStatus`: transport status, independent of the visible data/error: `'fetching'` or `'idle'`.
- `isStale: boolean`: whether the cached success has passed its TTL; always `false` outside `success`.
- `observed: boolean`: whether a reactive consumer currently observes this resource's `state`.

### `read()` / `peek()`

```ts doc-test=skip reason="Signature summary, not a runnable module"
read(): T; // Suspense-compatible: success returns the value, pending throws the Promise, error/cancelled throws the error
peek(): T; // same shape as read(), but records no dependency and neither checks the lifetime nor starts a request
```

`read()` follows the shape React Suspense expects: it returns the cached data on success, throws the current `promise` while `pending`/`idle`, and throws the error object for `error`/`cancelled`. `peek()` is its untracked version, for `getSnapshot`-style reads that must not join another consumer's tracking window, and it never starts a request. A legitimate `autoStart: false` idle state has no Promise yet, so calling `peek()` there throws `NO_ACTIVE_PROMISE`; inspect with `peekState()` or start a request explicitly.

### `refetch()` / `invalidate()`

```ts doc-test=skip reason="Signature summary, not a runnable module"
refetch(): Promise<T>;    // always starts a new request, never reuses a fresh cache
invalidate(): Promise<T>; // expires the cache at once (expiresAt = 0) and starts a new request
```

Passive reads (`state`/`promise`/`read()`) start a request only when expired or `idle`; to force a refresh, call `refetch()` or `invalidate()`.

### `cancel()`

```ts doc-test=skip reason="Signature summary, not a runnable module"
cancel(): void;
```

Stops only the **currently active generation**; the resource stays reusable. Without an active request it is a no-op. After cancelling an active request, passive restarts pause: a cancelled `pending` stays visible as `cancelled` until an explicit `refetch()`. Cancelling in `pending` moves the state to `cancelled`, carrying a `DOMException` with `name === 'AbortError'` and code `REQUEST_CANCELLED`. Cancelling a `staleWhileRevalidate` background refresh falls back to showing the existing `success` data and clears `refreshing`, so no "refreshing without a request" state is left behind. If cleanup during cancellation (timers/listeners) fails, it is thrown as an error with code `CANCELLATION_CLEANUP_FAILED`; the state has converged regardless.

### `dehydrate()` / `hydrate()`

```ts doc-test=skip reason="Signature summary, not a runnable module"
dehydrate(): IResourceCacheSnapshot<T> | undefined;
hydrate(snapshot: IResourceCacheSnapshot<T>): void;
```

`dehydrate()` returns `undefined` outside `success`. Otherwise it keeps the business `data` as is and captures two non-negative durations, `ageMs` and `remainingTtlMs`; the latter is `null` when there is no time-based expiry (`ttl: 0` or an infinite TTL). An arbitrary `T` is not guaranteed to be JSON-serializable; BigInt and cyclic objects remain the caller's concern.

`hydrate(snapshot)` validates v2 first, rebuilds the internal timestamps from the receiving side's `scheduler.now()`, voids the current request, clears the dependencies and restores `success`. The remaining lifetime continues from the moment of hydration; to account for transport or storage time, add the known time to `ageMs` and subtract it from a finite `remainingTtlMs` (down to 0). The two sides need no shared monotonic clock origin. A snapshot that is not v2, has a negative or non-finite duration (only `remainingTtlMs` may be `null`), or whose rebuilt timestamps overflow throws `INVALID_SNAPSHOT`; getter failures stay on `cause`. The old v1 absolute-time format is rejected outright: convert it where the old clock's origin is known, because the receiver cannot guess it.

### `dispose()`

```ts doc-test=skip reason="Signature summary, not a runnable module"
dispose(): void;
```

Ends the resource for good: aborts the running request (`GenerationController.dispose()`), clears the dependency registrations and releases the internal state signal. Idempotent: a second call is a no-op. If a cleanup step fails, the first failure is thrown as is and later failures are attached to its `.errors` array; one failing step never skips the remaining steps. After disposal, data reads and request operations throw `RESOURCE_DISPOSED`; `disposed`, `refreshing` and `observed` stay readable, and `markDirty()`, `onDependencyDisconnected()` and another `dispose()` do not throw.

---

<a id="options"></a>

## Options `IResourceOptions`

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IResourceOptions<T = unknown> = {
  debugName?: string
  ttl?: number // default Infinity (never expires; only dependency changes or manual refreshes reload)
  autoStart?: boolean // default true
  staleWhileRevalidate?: boolean // default false
  retry?: IResourceRetryPolicy // default 0 (no retry)
  retryDelay?: number | ((failureCount: number, error: unknown) => number) // default 0
  keepAlive?: boolean // default false
  initialSnapshot?: IResourceCacheSnapshot<T>
  scheduler?: IScheduler // default systemScheduler from @migaia/utils/scheduler
}

type IResourceRetryPolicy = number | ((failureCount: number, error: unknown) => boolean)
```

Semantics and validation, field by field:

- `ttl?: number`: how long, in milliseconds, a success stays fresh. `0` and `Infinity` (the default) never expire by time; only dependency changes, `refetch()` or `invalidate()` reload. Other values must be finite and non-negative, otherwise a `RangeError` with code `INVALID_OPTION` is thrown; an `updatedAt + ttl` that is not finite (numeric overflow) also throws `INVALID_OPTION`.
- `autoStart?: boolean`: whether the constructor starts the first request. Default `true`. With a fresh `initialSnapshot`, no request starts even when `autoStart` is `true`.
- `staleWhileRevalidate?: boolean`: default `false`. When `true`, a refresh keeps showing the old `success` data (with `refreshing: true`) instead of falling back to `pending`.
- `retry?: number | (failureCount, error) => boolean`: a fixed count or a decision function. A number must be a non-negative integer, otherwise `INVALID_OPTION`. The function is called once after each failure with the failure number (starting at 1) and the error, and decides whether to retry. **Thenables thrown for Suspense do not count as failures**: a fetcher that synchronously throws a thenable is treated as "wait, then run again", not as a real failure.
- `retryDelay?: number | (failureCount, error) => number`: a fixed delay or a function of the failure count, in milliseconds. A number must be finite and non-negative. A function returning a non-number rejects with a native `TypeError` and `INVALID_OPTION`; a negative or non-finite number gives a `RangeError` with `INVALID_OPTION`. When the policy throws or returns an invalid value, the fetch error that triggered the retry stays reachable; native policy errors receive the code in place where possible, and existing foreign identities are not rewritten.
- `keepAlive?: boolean`: default `false`. When nobody observes `state` for a while, the resource suspends at the next idle moment (disconnects upstream edges, keeps dependency versions and the cache); the next read checks the versions, reuses the cache when nothing changed and it is fresh, and reloads otherwise. `true` disables suspension.
- `initialSnapshot?: IResourceCacheSnapshot<T>`: the initial success snapshot for server rendering or persisted restore; it is `hydrate()`d in the constructor, and an invalid format throws `INVALID_SNAPSHOT` (see [Snapshot type](#snapshot-type)).
- `scheduler?: IScheduler` (`@migaia/utils/scheduler`): the time and scheduling source. TTL, `updatedAt`, `expiresAt` and retry delays all go through this one scheduler; the default is `systemScheduler` from `@migaia/utils/scheduler` (a monotonic clock). The value must satisfy `{ now(): number; schedule(cb, delayMs): IScheduledTask }` (checked internally with `snapshotScheduler`), otherwise `INVALID_OPTION`. A scheduler missing a host capability fails fast when called instead of silently falling back to microtasks.

---

<a id="state-types"></a>

## State types

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IResourceState<T> =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'success'; data: T; refreshing?: boolean }
  | { status: 'error'; error: unknown }
  | { status: 'cancelled'; error: Error } // a native DOMException at runtime; the type needs no DOM lib

const ResourceStatus: {
  idle: 'idle'
  pending: 'pending'
  success: 'success'
  error: 'error'
  cancelled: 'cancelled'
}

type ResourceFetchStatus = 'idle' | 'fetching'
```

`IResourceState<T>` is the discriminated union behind `state`/`peek()`, with five states: `idle` (no request yet), `pending` (a request is running and there is no earlier data), `success` (`data` is the latest success; `refreshing` is `true` only during a `staleWhileRevalidate` background refresh), `error` (`error` is the latest failure) and `cancelled` (`error` is always a `DOMException` with `name === 'AbortError'` and `code === ResourceErrorCode.requestCancelled`). `ResourceStatus` contains only these five data states; the separate `ResourceFetchStatus` constant and its same-named key union contain only `idle/fetching`, for the transport activity reported by `fetchStatus`.

---

<a id="fetcher-and-dependency-tracking"></a>

## `IResourceFetcher` and dependency tracking

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IResourceFetcher<T> = (ctx: IResourceFetchContext) => T | PromiseLike<T>
```

Reactive values (`Signal`/`Computed`) the `fetcher` reads synchronously **before its first `await`**, including the synchronous part of an async function before its first `await`, become dependencies; a dependency change merges into one new request (one batch of changes reloads only once). Reactive values read **after** an `await` are not tracked, because JavaScript's synchronous tracking context has already ended there; move such reads into a `Computed`, or read them into local variables before awaiting.

The `fetcher` **must** hand `ctx.signal` to I/O that can really be cancelled (such as `fetch(url, { signal })`). Otherwise a `cancel()` or a dependency change only makes the `Resource` ignore the result, and the underlying request keeps running in the background, wasting network resources and possibly causing unobserved side effects.

When a value thrown synchronously by the `fetcher` is detected as a thenable (the common Suspense pattern: throw a Promise to suspend the caller), it is treated as "wait, then run again" and does not count as a retry. If reading its `.then` throws, the value cannot be classified, and the request rejects with an `AggregateError` carrying `SUSPENSE_PROBE_FAILED` (both the thrown value and the getter error are kept in `.errors`).

---

<a id="snapshot-type"></a>

## Snapshot type `IResourceCacheSnapshot`

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IResourceCacheSnapshot<T> = {
  readonly version: 2
  readonly data: T
  readonly ageMs: number
  readonly remainingTtlMs: number | null
}
```

A snapshot carries only durations, never the sender's absolute time. `remainingTtlMs: null` means no time-based expiry. Only the time metadata is directly JSON-encodable; the caller ensures the business `data` is serializable. See `hydrate()` for who accounts for transport time and for the v1 migration note.

---

<a id="underlying-building-blocks"></a>

## Underlying building blocks from lifecycle

`Resource` combines building blocks from `@migaia/lifecycle` and `@migaia/reactive` directly; knowing them helps when diagnosing boundary behaviour:

- **`createGenerationController()`** (from `@migaia/lifecycle`): every request calls `begin()` to open a new generation; `refetch()`/`invalidate()`/dependency changes void the old one (`supersede()`), and only a generation for which `isCurrent(token)` is true writes its result into `state`. `dispose()` ends the controller with its `dispose()`.
- **`createTerminalController()`** (from `@migaia/lifecycle`): drives the `Resource`'s own lifetime axis (`open → closing → terminal`); the `disposed` getter reads its `lifecycle === 'terminal'`.
- **`probeThenable()` / `assimilateCapturedThen()`** (from `@migaia/utils/function`): safely detect whether a value thrown by the `fetcher` is a thenable (the Suspense throw-a-Promise pattern), reading `.then` only once so that a hostile getter is not read twice and no exception is swallowed.
- **`systemScheduler` (from `@migaia/utils/scheduler`) / `snapshotScheduler()` (from `@migaia/lifecycle`)**: the default and the validation for the `scheduler` option; TTL expiry checks and retry delays go through it rather than the host `setTimeout`/`Date.now`.
- **`internalRuntimeOf()` / `createTrackedObserver()`** (from `@migaia/reactive/extension`): the Resource joins the graph as an `IObserver` and receives only the tracking, suspension, revalidation and idle capabilities bound to itself. Reactive maintains the dependency set; requests, cancellation and resource release remain the Resource's job.

---

<a id="error-codes"></a>

## Error codes

```ts
import { RESOURCE_SOURCE, ResourceErrorCode, type IResourceErrorCode } from '@migaia/resource'
```

The stable error-code table has **9 codes**, declared only in `src/error-code.ts`. The package's own errors use the `source` `'@migaia/resource'`; errors that already carry a full foreign identity keep their original package identity. `RESOURCE_SOURCE` exports this stable source: when classifying errors across packages, compare against it and `ResourceErrorCode` instead of copying string literals.

| `ResourceErrorCode` key | Code | When |
| --- | --- | --- |
| `resourceDisposed` | `RESOURCE_DISPOSED` | Any read or operation on a `Resource` after `dispose()` |
| `requestAborted` | `REQUEST_ABORTED` | The native AbortError of a stopped request; for a Resource-initiated abort it is the same object as `signal.reason`, and a lifecycle replacement reason stays on `cause` |
| `requestCancelled` | `REQUEST_CANCELLED` | The `DOMException` carried by the `cancelled` state after an explicit `cancel()` of a pending request |
| `cancellationCleanupFailed` | `CANCELLATION_CLEANUP_FAILED` | Cancellation converged the state, but timer/listener cleanup during cancellation failed |
| `noActivePromise` | `NO_ACTIVE_PROMISE` | Reading `promise`, or calling `read()`/`peek()` in `pending`/`idle`, when there is no running or cached Promise to return |
| `invalidSnapshot` | `INVALID_SNAPSHOT` | A snapshot that is not v2, a negative or non-finite duration (`remainingTtlMs` may be `null`), an overflowing rebuilt timestamp, or a failing getter |
| `invalidOption` | `INVALID_OPTION` | An option passed to the constructor or a call (`ttl`, `retry`, `retryDelay`, `scheduler`, ...) does not meet its requirements |
| `suspenseProbeFailed` | `SUSPENSE_PROBE_FAILED` | The `fetcher` threw a value for Suspense, but reading its `.then` threw, so it cannot be classified as a thenable |
| `fetchFailed` | `FETCH_FAILED` | An unclassified fetch failure once retries are exhausted; native errors keep their identity where possible, frozen errors and non-Error values stay on `cause`, existing foreign identities are not rewritten |

Values thrown or stored for `requestAborted`/`requestCancelled` are always native `DOMException`s (`name === 'AbortError'`). Callers usually check `error.name === 'AbortError'` and handle them quietly rather than as real failures; `code` is only an attached field and does not change the type. Branch on `error.code === ResourceErrorCode.xxx` and never hard-code the code strings.

---

<a id="combined-examples"></a>

## Combined examples

### 1. Suspense read + error boundary

```tsx
function UserProfile({ resource }: { resource: Resource<User> }) {
  const user = resource.read() // pending throws the Promise (caught by Suspense), error throws (caught by the error boundary)
  return <div>{user.name}</div>
}
```

### 2. Restore a server snapshot without a client request

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
// Server:
const snapshot = serverUserResource.dehydrate() // undefined or { version: 2, data, ageMs, remainingTtlMs }
// Send it through a safe JSON channel; when embedding it in HTML, use an encoding suited to the HTML context.
// Adjust ageMs/remainingTtlMs by the known transport/storage time.

// Client:
const userResource = new Resource(fetchUser, runtime, {
  initialSnapshot: snapshot, // no new request while it is present and fresh
  ttl: 30_000
})
```

### 3. Background refresh that keeps old data

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const list = new Resource(fetchList, runtime, {
  ttl: 10_000,
  staleWhileRevalidate: true
})

// While list.state.status === 'success', list.state.data is still the old data during a background refresh,
// and list.refreshing === true can drive a "refreshing" badge
```

### 4. Custom retry backoff

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const resource = new Resource(fetchWithFlakyBackend, runtime, {
  retry: (failureCount, error) => failureCount < 5 && !(error instanceof TypeError),
  retryDelay: (failureCount) => Math.min(1000 * 2 ** failureCount, 30_000) // exponential backoff, capped at 30 s
})
```

### 5. Manual invalidation + cancellation

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
await resource.invalidate() // treat as expired at once and request again
resource.cancel() // stop only the current request; the resource stays reusable, passive reads stay paused, an explicit refetch() restarts
```

---

<a id="troubleshooting-and-build-gates"></a>

## Troubleshooting and build gates

- **A dependency changed but nothing reloaded**: check that the reactive read happens **before the fetcher's first `await`**; reads after an `await` are not tracked. Move them into a `Computed` or read them into local variables first.
- **The underlying request seems to keep running after `cancel()` or a dependency change**: the `fetcher` did not hand `ctx.signal` to I/O that can really be cancelled; `cancel()` only makes the `Resource` ignore the result and cannot stop a request that never received the `signal`.
- **Reading `state`/`promise` again does not bring the latest data**: passive reads start a request only when expired or `idle`, and reading again never forces a refresh; use `refetch()` or `invalidate()`.
- **A read throws `RESOURCE_DISPOSED`**: the `Resource` was `dispose()`d; drop the reference and create a new `Resource`.
- **A read throws `NO_ACTIVE_PROMISE`**: calling `peek()` on a legitimate `autoStart: false` idle resource also does this; inspect with `peekState()`, or start work with `promise`/`refetch()`.
- **`hydrate()`/`initialSnapshot` throws `INVALID_SNAPSHOT`**: snapshots usually come from server serialization or persisted storage, and format drift should fail at load time; check how the snapshot is produced and serialized, and confirm `version === 2`, a finite non-negative `ageMs`, and a finite non-negative or `null` `remainingTtlMs`.
- **After a long idle period, a read seems to have "lost" its dependencies and recomputed**: `keepAlive` defaults to `false`; an unobserved resource disconnects upstream but keeps versions and the cache, and the next read checks the dependencies first and does not reload when they are unchanged and fresh. Pass `keepAlive: true` to keep hot data even when nobody watches.
- **A Suspense throw inside the `fetcher` is not recognized**: if the thrown value's `.then` getter itself throws, the result is `SUSPENSE_PROBE_FAILED` rather than a silent retry as an ordinary fetch failure; find out why the value has a throwing getter.

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

One request reuses one pending Promise across every Suspense wait. After a thenable thrown by the fetcher settles, the work continues through a 0 ms task on the injected scheduler; Suspense waits do not count as retries and have no upper limit. Even when the fetcher keeps throwing thenables that settle at once, cancellation tasks can still run, and `cancel()`/`dispose()` stop further calls.

State type migration: `ResourceStatus.fetching` became `ResourceFetchStatus.fetching`; the former `IResourceStatus` / `IResourceFetchStatus` types are replaced by the key unions `ResourceStatus` / `ResourceFetchStatus` that share their constants' names. The runtime status strings and the data and transport semantics of background refresh are unchanged.

### Adapters: read-only inspection and reset

`peekState()` returns the current `IResourceState<T>` without tracking, loading or TTL revalidation. Unlike `peek()`, it returns the state union rather than taking the value out or throwing. `reset()` cancels any pending generation, clears dependency edges and cached data, and leaves this same instance idle and reusable. The old pending Promise rejects immediately with a native `AbortError`, source `@migaia/resource`, code `REQUEST_ABORTED`; reset never reuses a prior generation or token.

`IResourceFetchContext` is the readonly request identity (`signal`, a monotonic `generation`, an opaque `token`). Retries keep that identity; replacement requests receive a new one. Keep request identity separate from the counters used for observation and suspension. Ownership of loaded values and render-version leases belongs to adapters, not to the Resource dependency graph. StoreLight uses these capabilities with one Resource instance, preserving the original `T` and the shared request Promise.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { Resource } from '@migaia/resource'

const value = new Resource(({ generation }) => generation, createRuntime(), { autoStart: false })
console.log(value.peekState().status) // idle: the fetcher has not been called
console.log(await value.promise)
value.reset()
console.log(value.peekState().status) // idle: same instance, no cached data
console.log(await value.promise) // a later generation
value.dispose()
```
