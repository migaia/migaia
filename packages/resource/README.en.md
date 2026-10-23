# @migaia/resource

[中文](./README.md)

When data depends on a user id or a set of filters, sending the request is the easy part. The hard part is everything around it: a slow old request answers late and overwrites the new result, a request keeps running after the user leaves, a refresh blanks the content before showing it again. `@migaia/resource` gives all of that to one `Resource`. You write how to load the data; it keeps only the newest result, cancels outdated requests, caches, retries and produces server-rendering snapshots. It is built on `@migaia/reactive` and sends no requests itself: `fetch`, RPC or a database client is your choice.

## You may have run into

- **An old result overwrites the new one**: the user types `re`, then completes it to `react`; the `re` request is slower, and the page ends up showing the results for `re`. The cause is that every request writes its result when it answers, so whichever answers last wins.
- **A request keeps running after the user leaves**: the report has not finished loading when the user moves on, the request runs to the end anyway and writes into a view that no longer exists. The cause is that nobody cancels the request on leaving, or the cancelling code is repeated on every page.
- **The content flashes on refresh**: every refresh of the price list blanks it to "loading" before it comes back. The cause is that data and loading state share one variable, so refreshing has to clear the data first.
- **Retries without judgement**: a 404 is retried too, and afterwards a new wrapper error is thrown, so the caller can no longer recognize its own `HttpError`. The cause is a retry loop that neither tells errors apart nor keeps the original one.
- **The browser loads again what the server already loaded**: server rendering fetched the user profile, and the browser fetches it again as soon as the page arrives, so the first screen flashes a loading state. The cause is that the data reached the browser but how long it stays valid did not.

## Why choose it

- **An old request cannot write its result, even when the API cannot be cancelled.** By hand, whichever answers last wins; `Resource` gives every request a generation number and writes only the newest generation's result to `state`. [Example](./USEGUIDE.en.md#show-only-the-result-for-the-latest-input)
- **Dependencies are recorded for you, and several changes in one turn send one request.** By hand, each filter's change handler sends its own request; every reactive value the fetcher reads before its first `await` becomes a dependency, and several changes in the same turn merge into one request on the next microtask by default. [Example](./USEGUIDE.en.md#change-several-filters-send-one-request)
- **Every reader shares one Promise.** Hand-written de-duplication has to clear the Promise after a failure and fetch again after expiry; the `promise` of one `Resource` returns the same Promise while a request runs and while the cache is fresh. [Example](./USEGUIDE.en.md#several-readers-one-request)
- **Cancellation has its own state and is never mistaken for a failure.** After `cancel()` the state is `cancelled` and the resource can still `refetch()`; `dispose()` passes the abort on to the underlying request, and waiters receive a native `AbortError`. [Example](./USEGUIDE.en.md#show-cancelled-instead-of-an-error)
- **Server snapshots carry the remaining lifetime, not a point in time.** The browser keeps counting on its own clock, so the two clocks need not agree, and no request is sent while the snapshot is fresh. [Example](./USEGUIDE.en.md#do-not-request-server-loaded-data-again)

Use `Resource` when an async result depends on a `Signal` or `Computed` and callers need to observe its state, share a request, or refresh cached data. It keeps that reusable state together. For a one-off request without those needs, directly `await` the Promise.

## Start here

The example below fakes a search box: the user searches `re`, then changes it to `react`, and the `re` request is slower. Run it directly with Node 24.

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
keyword.dispose()
```

Output:

```text
API answered: "react"
page shows: 3 results for "react"
API answered: "re"
```

`re` answers after `react`. The log shows it arriving, but the page stays on the results for `react`. The fetcher reads `keyword.value` synchronously before returning its Promise, so a keyword change makes the `Resource` start a new request and void the old one; even when the old request finishes, it cannot write into `state`.

`view` is an Effect, a reactive side effect. It reads `results.state` while running, so request state changes run it again and update the page. Saving `state` in an ordinary variable gives only a snapshot of that moment; keep the read inside an Effect or a UI framework's state subscription to keep the view up to date. On leaving, dispose `view` first, then `results`, then the input `keyword`, so cleanup cannot trigger another render or request.

Next: more uses are listed in [Find by scenario in the USEGUIDE](./USEGUIDE.en.md#find-by-scenario); to stop network work when the user leaves, see [Stop the running request when the user leaves](./USEGUIDE.en.md#stop-the-running-request-when-the-user-leaves).

## The traps of hand-written code

Below is a common hand-written loader. It runs, but it has three traps (for illustration only; no need to run it):

```ts doc-test=check
let profile: unknown
let loading = false

async function loadProfile(id: string) {
  loading = true
  // Trap 1: old and new requests look the same; after switching users, a slow old request answers late and overwrites the new user's data
  const response = await fetch(`/api/users/${id}`)
  profile = await response.json()
  // Trap 2: when the request fails this line never runs and loading stays true; every loader must remember try/finally
  loading = false
}

// Trap 3: nothing cancels on leaving; the request still writes profile after the page is gone
void loadProfile('1')
```

With `Resource` the fetcher only loads data: generations tell old requests from new ones, a failure lands in the `error` state instead of leaving the page stuck on loading, and `dispose()` aborts the running request.

## A three-minute mental model

Think of a `Resource` as "an async variable that re-requests by itself": the fetcher is its formula, the reactive values the fetcher reads are the formula's inputs, and `state` is its current value.

| Concept | In one sentence |
| --- | --- |
| Fetcher | `({ signal }) => value or Promise`; reactive values read before the first `await` become dependencies |
| `state` | One of five states: `idle`, `pending`, `success` (with `data`), `error`, `cancelled` |
| Generation | A number per request; only the newest generation's result can be written to `state` |
| Lifetime (`ttl`) | How long a success stays fresh; defaults to `Infinity`, so only dependency changes or manual refreshes request again |
| `cancel()` / `dispose()` | Stop this request and keep the resource usable / stop the request and release the whole resource |
| Snapshot | The caller can transfer or store the data and remaining lifetime exported by `dehydrate()`, then restore them through `initialSnapshot` |

A few terms:

- **Passive read**: reading `state`, `promise` or `read()`. It starts a request only when nothing has been requested yet or the data has expired; reading again does not force a refresh.
- **Explicit refresh**: `refetch()` always starts a new request; `invalidate()` expires the cache first and then requests.
- **Suspension**: when nobody reads `state`, the `Resource` disconnects from its inputs but keeps the cache. The next read checks the inputs first and reuses the cache when they did not change and it has not expired.

## Typical scenarios

| Scenario | How to combine | Details |
| --- | --- | --- |
| Load from inputs and show only the newest result | fetcher reads reactive values + `effect` reads `state` | [USEGUIDE](./USEGUIDE.en.md#show-only-the-result-for-the-latest-input) |
| Several filters change together | the fetcher reads several signals | [USEGUIDE](./USEGUIDE.en.md#change-several-filters-send-one-request) |
| Several components read the same data | share the `promise` or `state` of one `Resource` | [USEGUIDE](./USEGUIDE.en.md#several-readers-one-request) |
| Leaving a page, cancelling an action | `dispose()` / `cancel()` + hand `signal` to the underlying request | [USEGUIDE](./USEGUIDE.en.md#stop-the-running-request-when-the-user-leaves) |
| Refresh without blanking the content | `staleWhileRevalidate: true` | [USEGUIDE](./USEGUIDE.en.md#keep-showing-old-data-while-refreshing) |
| Retry only temporary failures | a `retry` function + `retryDelay` | [USEGUIDE](./USEGUIDE.en.md#retry-only-temporary-failures) |
| Server rendering | `dehydrate()` + `initialSnapshot` | [USEGUIDE](./USEGUIDE.en.md#do-not-request-server-loaded-data-again) |

## Installation

```bash
pnpm add @migaia/resource @migaia/reactive
```

The package has only the root entry `@migaia/resource`: `Resource`, `ResourceStatus`, `ResourceFetchStatus`, `ResourceErrorCode`, `RESOURCE_SOURCE` and every public type are imported from it; there are no stable deep subpaths. The `runtime` argument comes from `createRuntime()` in `@migaia/reactive`, and the two packages must be used at matching versions.

## Common APIs

| API | What it does |
| --- | --- |
| `new Resource(fetcher, runtime, options?)` | Creates an async data source; by default the first request starts in the constructor |
| `resource.state` / `resource.read()` | Read the current state / read the Suspense way (success returns the value, loading throws the Promise, failure throws the error) |
| `resource.promise` | The Promise of the current request or of the fresh cache; every reader shares the same one |
| `refetch()` / `invalidate()` | Force a new request / expire the cache, then request |
| `cancel()` / `dispose()` | Stop the current request and keep the resource usable / stop the request and release the resource |
| `dehydrate()` / `hydrate()` | Export and restore a success with its remaining lifetime |

## Contract details

Every signature, boundary behaviour and error code is in [USEGUIDE.en.md](./USEGUIDE.en.md). These are the constraints that matter most in use.

### Lifecycle, errors and boundaries

The constructor option `autoStart` defaults to `true`: the first request starts immediately unless `initialSnapshot` is still fresh. With `autoStart: false`, construction does not request, but the first passive read can still start one; a fresh initial snapshot is reused directly.

1. **Dependency tracking sees only synchronous reads before the first `await`.** Reactive values read after an `await` are not tracked; read them into a local variable first, or move the read into a `Computed`. The supplied `runtime` decides when dependency changes trigger a refresh; by default, it schedules this work in a microtask.
2. **The fetcher should hand `signal` to I/O that can really be cancelled** (for example `fetch(url, { signal })`). Otherwise a cancel only makes the `Resource` ignore the result, and the underlying request still runs to the end.
3. **`refetch()` always starts a new request; passive reads (`state`, `promise`, `read()`) start one only when idle or expired.** Each refresh creates a new generation and aborts the `signal` of the previous generation if it is still running; only the current generation can write its result to state. Call `refetch()` or `invalidate()` to force a refresh.
4. **Call `dispose()` when the resource is no longer used**, or its dependency registrations and running request stay alive. After disposal, data reads and request operations throw `RESOURCE_DISPOSED`; `disposed`, `refreshing` and `observed` stay readable, and `markDirty()`, `onDependencyDisconnected()` and a second `dispose()` are safe no-ops. `dispose()` does not dispose the `runtime` passed in.
5. **`keepAlive` defaults to `false`.** When nobody reads `state`, the `Resource` disconnects from its upstream but keeps the dependency versions and the cache; the next read reuses the old value and Promise when the dependencies did not change and the cache is fresh, and requests again when they changed. Pass `keepAlive: true` to stay connected while nobody watches.
6. **Passive reads do not restart after `cancel()`.** Call `cancel()` to stop the current request temporarily while keeping the same resource available for later use. A cancelled initial load is in the `cancelled` state; a cancelled background refresh keeps the old data and clears `refreshing`. Only an explicit `refetch()` starts again.

### Error identity

Errors produced by `Resource` itself carry `source === RESOURCE_SOURCE` (`resource`) and a `code` from `ResourceErrorCode`. Foreign errors that already have a full `source`/`code` stay as they are; an unclassified load failure receives `FETCH_FAILED` once retrying ends, native errors keep their type, and immutable errors remain on the `cause` chain. A failing retry policy receives `INVALID_OPTION`, and the load error that triggered it stays reachable on the error chain. Errors produced by cancellation and disposal are native `DOMException`s (`name === 'AbortError'`), so checking `error.name` is enough.

### Suspense

One request reuses one pending Promise across every Suspense wait. After a thenable thrown by the fetcher settles, the work continues through a 0 ms task on the injected scheduler; Suspense waits do not count as retries and have no upper limit. Even when the fetcher keeps throwing thenables that settle at once, cancellation tasks can still run, and `cancel()`/`dispose()` stop further calls.

### Capabilities used by adapters

`peekState()` reads the state union without recording a dependency, starting a request or checking the lifetime; unlike `peek()`, it returns the state object instead of returning the value or throwing. `reset()` cancels the current request and clears the dependencies and the cache, bringing the same instance back to a reusable `idle`; the previously shared Promise rejects at once with a native `AbortError` (`REQUEST_ABORTED`). The `IResourceFetchContext` given to the fetcher carries a readonly `signal`, a monotonically increasing `generation` and an opaque `token`: retries of one request share them, and a replacement or reset request receives a new set. Ownership of loaded values and render-version leases belong to adapters, not to the `Resource` dependency graph. See the USEGUIDE for a complete example.

### State type migration

`ResourceStatus.fetching` became `ResourceFetchStatus.fetching`; the former `IResourceStatus` / `IResourceFetchStatus` types are replaced by the key unions `ResourceStatus` / `ResourceFetchStatus` that share their constants' names. The runtime status strings and the data and transport semantics of background refresh are unchanged.

### When not to use it

For data loaded once at startup, with no inputs and no need for cancellation, retries or expiry (static configuration, for example), a plain `await` on a Promise is simpler.
