# `@migaia/utils`

[中文](./README.md)

Library code keeps needing one layer of work that is easy to get wrong: timeouts, cancellation, retries, concurrency limits, initialization that runs only once, errors you can recognize, updating deep fields without mutating, and protecting config handed in by callers. `@migaia/utils` handles the edge cases of that layer and gives every kind of failure a stable error code. It has no runtime dependencies and uses no browser-only or Node-only APIs, so it runs in browsers, Node, Bun, Deno and Workers; each group of tools lives under its own subpath for import on demand.

## You may have run into

- **The request keeps running after the timeout**: with `Promise.race` and `setTimeout`, the caller gets an error on time, yet the request, its connection and the timer are all still alive. The cause: the timeout only ends the waiting and never tells the operation to stop.
- **Retries make things worse**: errors such as 404 are retried too, retries fire immediately, there is no total limit, and the user sees the failure half a minute later. The cause: the retry loop does not tell error kinds apart and has no backoff or overall deadline.
- **Hundreds of requests go out at once**: `Promise.all(ids.map(download))` makes the server start throttling, and queued requests keep running after the user leaves the page. The cause: no concurrency cap and no way to cancel tasks that are still queued.
- **Initialization runs several times**: three modules call a lazy loader at the same moment and open three database connections. The cause: when `if (!db)` runs, the Promise of the first call has not been stored yet.
- **After a few layers of wrapping, nobody can tell the cause**: the only way to check "was it a lost connection" is to compare message text, which breaks as soon as the wording changes. The cause: errors have no stable code, or wrapping dropped the original error.

## Why choose it

- **A timeout really stops the operation instead of only letting the caller return early.** With `Promise.race` and `setTimeout` the request keeps running after the timeout; `withTimeout` aborts the operation's `signal` at the deadline before rejecting with `DEADLINE_EXCEEDED`, and `fetch` stops at once. [Example](./USEGUIDE.en.md#time-out-a-slow-request-and-actually-stop-it)
- **A failure that arrives after the deadline does not disappear.** A hand-written `Promise.race` silently swallows it; here it goes to the `report` callback without changing the caller's result, and a rejection with `signal.reason` counts only as acknowledging the cancellation, so it is not misreported. [Example](./USEGUIDE.en.md#where-a-failure-after-the-deadline-goes)
- **Retries depend on the kind of error and have a total limit.** A common retry loop retries even 404s and has no overall time cap; `retry` picks retryable errors with `shouldRetry`, backs off with `delay`, caps the whole run including waits with `totalTimeoutMs`, and throws errors that should not be retried unchanged and at once. [Example](./USEGUIDE.en.md#retry-only-what-is-worth-retrying)
- **A concurrent initialization runs only once.** An `if (!db)` lazy loader opens several connections when calls arrive together; `onceAsync` stores the Promise on the first call and every later call gets the same one. [Example](./USEGUIDE.en.md#run-a-concurrent-initialization-only-once)
- **Errors stay recognizable by code through any number of wrappers, and the original error keeps its type.** Telling causes apart by message text breaks as soon as the wording changes; `attachErrorIdentity` only adds `source` and `code` to the original error, `walkErrorCauses` finds it again along `cause`, and `instanceof` and the stack are preserved. [Example](./USEGUIDE.en.md#recognize-the-underlying-cause-after-wrapping)

## Start here

The code below gives a flaky endpoint a per-request time limit plus retries. Request 1 hangs and is cancelled after 300 ms, request 2 returns 503 and is retried too, and request 3 succeeds. Run it with Node 24.

```ts doc-test=run
import { createServer } from 'node:http'
import { isUtilsTimeoutError } from '@migaia/utils/error'
import { retry } from '@migaia/utils/promise'

// A flaky endpoint: request 1 hangs for 2 seconds, request 2 returns 503, request 3 works.
let requests = 0
const server = createServer((_request, response) => {
  requests += 1
  if (requests === 1) setTimeout(() => response.end('too slow'), 2_000)
  else if (requests === 2) response.writeHead(503).end()
  else response.end('orders')
}).listen(0)
const { port } = server.address() as { port: number }

const body = await retry(
  async ({ attempt, signal }) => {
    console.log(`request ${attempt}`)
    const response = await fetch(`http://localhost:${port}/orders`, { signal })
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status })
    return response.text()
  },
  {
    maxAttempts: 4,
    attemptTimeoutMs: 300, // wait at most 300 ms per request, then cancel that fetch
    shouldRetry: (error) => isUtilsTimeoutError(error) || (error as { status?: number }).status! >= 500,
    delay: 100 // wait 100 ms between requests
  }
)
console.log('result:', body)
server.closeAllConnections()
server.close()
```

Output:

```text
request 1
request 2
request 3
result: orders
```

The `signal` that `retry` hands to each request is aborted when its 300 ms are up, and `fetch` stops that request at once instead of waiting in the background. The timeout error is a `UtilsTimeoutError`, which `isUtilsTimeoutError` recognizes; `status` is a field the example adds to its own errors.

Next: to give a single operation a time limit, see `withTimeout`; to cap how many tasks run at once, see `createConcurrencyLimiter`. More runnable scenarios are in [Find by scenario in the usage guide](./USEGUIDE.en.md#find-by-scenario).

## The traps of hand-written code

Here is a common hand-written timeout. It runs, but it has three traps (for illustration only; no need to run it):

```ts doc-test=check
async function fetchWithTimeout(url: string, ms: number) {
  return Promise.race([
    // Trap 1: no signal is passed, so the request keeps running after the timeout and its connection and memory are not freed
    fetch(url),
    // Trap 2: when the request finishes first, this timer is never cleared; in Node it also keeps the process waiting until it fires
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))
  ])
  // Trap 3: when the request fails after the timeout, Promise.race silently swallows that failure and nobody finds out
}
```

`withTimeout` hands the operation a `signal`, and at the deadline it aborts that signal before rejecting; when the operation finishes first, it clears the timer; a failure that arrives after the deadline goes to the `report` callback instead of disappearing. An operation that rejects with the `signal.reason` it received (as `fetch(url, { signal })` does) is only acknowledging the cancellation and is not treated as a new failure.

## A three-minute mental model

| Problem to solve | Tool | Subpath |
| --- | --- | --- |
| Give an operation a time limit and stop it when time is up | `withTimeout` | `@migaia/utils/promise` |
| Retry on chosen failures | `retry` | `@migaia/utils/promise` |
| Follow an outside cancellation only; a cancellable wait | `raceWithAbort`, `sleep` | `@migaia/utils/promise` |
| Cap how many tasks run at once | `createConcurrencyLimiter` | `@migaia/utils/promise` |
| Run an initialization only once | `once`, `onceAsync` | `@migaia/utils/function` |
| Give errors a stable code and find it through the cause chain | `attachErrorIdentity`, `walkErrorCauses` | `@migaia/utils/error` |
| Read and write nested fields without mutating | `get`, `set` | `@migaia/utils/object` |
| Accept, protect and update config | `ownConfig`, `readonlyConfig`, `patchConfig` | `@migaia/utils/config` |
| Base64 and UTF-8 | `bytesToBase64`, `base64ToBytes`, `encodeUtf8` | `@migaia/utils/bytes` |
| Fill templates, format numbers and money | `format`, `formatCurrency` | `@migaia/utils/string`, `/number` |

A few terms used across the package:

- **Cooperative cancellation**: a cancellation is only a notice. The operation stops itself once it sees `signal.aborted` or receives the `abort` event on the `signal`; code that never checks the `signal` is not interrupted by force.
- **Late failure**: the operation fails after the result is already settled, for example after the timeout. It goes to `report` and never changes the result the caller already received.
- **Monotonic clock**: `scheduler.now()` comes from `performance.now()` and is used only for intervals and deadlines, not as a date timestamp; use `systemWallClock.timestamp()` when you need a timestamp.
- **Config ownership**: the config `ownConfig` returns belongs to the library, so later edits to the caller's own object cannot reach it.

## Typical scenarios

| Scenario | How to combine | Details |
| --- | --- | --- |
| Time out a slow request and actually stop it | `withTimeout`, passing `signal` to `fetch` | [Usage guide](./USEGUIDE.en.md#time-out-a-slow-request-and-actually-stop-it) |
| An operation that ignores `signal` fails after the deadline | `report` of `withTimeout` | [Usage guide](./USEGUIDE.en.md#where-a-failure-after-the-deadline-goes) |
| Retry only 5xx, with backoff and a total limit | `shouldRetry`, `delay` and `totalTimeoutMs` of `retry` | [Usage guide](./USEGUIDE.en.md#retry-only-what-is-worth-retrying) |
| Limit a batch download and cancel queued tasks when the user leaves | `createConcurrencyLimiter` with `run(task, { signal })` | [Usage guide](./USEGUIDE.en.md#limit-a-batch-and-cancel-queued-tasks-when-the-user-leaves) |
| Several modules initialize at once but open one connection | `onceAsync` | [Usage guide](./USEGUIDE.en.md#run-a-concurrent-initialization-only-once) |
| Update a deep field without mutating | `set`, `get` | [Usage guide](./USEGUIDE.en.md#update-a-deep-field-without-mutating) |
| Stop callers from changing config after handing it over | `ownConfig`, `readonlyConfig`, `patchConfig` | [Usage guide](./USEGUIDE.en.md#stop-callers-from-changing-config-after-handing-it-over) |
| Recognize errors by code after wrapping | `attachErrorIdentity`, `walkErrorCauses` | [Usage guide](./USEGUIDE.en.md#recognize-the-underlying-cause-after-wrapping) |

## Installation

```bash
pnpm add @migaia/utils
```

## Common APIs

| API | Subpath | What it does |
| --- | --- | --- |
| `withTimeout` | `/promise` | Gives an operation a deadline; at the deadline it aborts the operation's `signal`, then rejects with `DEADLINE_EXCEEDED`. |
| `retry` | `/promise` | Retries serially by `shouldRetry`, with backoff, a per-attempt limit and a total limit. |
| `createConcurrencyLimiter` | `/promise` | Caps how many tasks run at once; the rest queue in submission order and can be cancelled while queued. |
| `onceAsync` | `/function` | Stores the Promise on the first call; every later call, including concurrent ones, gets it. |
| `attachErrorIdentity` / `walkErrorCauses` | `/error` | Adds `source` and `code` to the original error; finds it again along `cause` and `AggregateError.errors`. |
| `ownConfig` / `patchConfig` | `/config` | Copies config on the way in; creates a new config that reuses the unchanged parts. |

## Contract details

The [usage guide](./USEGUIDE.en.md) holds every API's signature, options, defaults, edge behavior and error codes, one section per module:

- [`/promise`](./USEGUIDE.en.md#promise-module): schedulers, `sleep`, `withTimeout`, `raceWithAbort`, `retry`, `createConcurrencyLimiter` and the rules for reporting late failures
- [`/error`](./USEGUIDE.en.md#error-module): error identity, cause-chain walking and what every error code means
- [`/bytes`](./USEGUIDE.en.md#bytes-module): Base64 and UTF-8, and how `ArrayBuffer` relates to `Uint8Array`
- [`/object`](./USEGUIDE.en.md#object-module): snapshots, property probes and object-path reads and writes
- [`/config`](./USEGUIDE.en.md#config-module): config ownership, read-only views, patches and merge strategies
- [`/function`](./USEGUIDE.en.md#function-module): where `once` and `onceAsync` fit
- [Collector](./USEGUIDE.en.md#collector), [troubleshooting](./USEGUIDE.en.md#troubleshooting-and-build-gates) and the [public entry index](./USEGUIDE.en.md#public-entry-index)
