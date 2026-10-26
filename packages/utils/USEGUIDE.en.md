# `@migaia/utils` usage guide

[中文](./USEGUIDE.md)

For what the package is for, its highlights and its mental model, see the [README](./README.en.md). This guide starts with runnable examples organized by scenario (Node 24), then lists the signatures, options, edge behavior and error codes of every public runtime API module by module. The [public entry index](#public-entry-index) at the end lists every public name with its purpose and entry; the published `.d.ts` files are the source of truth for exact types.

## Find by scenario

| Your problem                                                                  | Read this section                                                                                                         |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| The request keeps running after the timeout                                   | [Time out a slow request and actually stop it](#time-out-a-slow-request-and-actually-stop-it)                             |
| An operation that ignores `signal` fails after the deadline                   | [Where a failure after the deadline goes](#where-a-failure-after-the-deadline-goes)                                       |
| 404s are retried too, and retries have no total limit                         | [Retry only what is worth retrying](#retry-only-what-is-worth-retrying)                                                   |
| Too many requests at once; queued requests keep running after the user leaves | [Limit a batch and cancel queued tasks when the user leaves](#limit-a-batch-and-cancel-queued-tasks-when-the-user-leaves) |
| Concurrent initialization opened several connections                          | [Run a concurrent initialization only once](#run-a-concurrent-initialization-only-once)                                   |
| A hand-written spread update mutated the original                             | [Update a deep field without mutating](#update-a-deep-field-without-mutating)                                             |
| A caller changed the config after handing it over                             | [Stop callers from changing config after handing it over](#stop-callers-from-changing-config-after-handing-it-over)       |
| After wrapping, the only way to tell the cause is message text                | [Recognize the underlying cause after wrapping](#recognize-the-underlying-cause-after-wrapping)                           |

## Time out a slow request and actually stop it

A slow request gets a timeout and the caller receives the error on time, but the request keeps running in the background and the server keeps working on a result nobody wants.

A timeout built from `Promise.race` and `setTimeout` only lets the caller return early; connections, timers and memory stay alive, because nothing tells the operation to stop.

`withTimeout` hands your operation a `signal`. At the deadline it aborts that signal first and then rejects with `DEADLINE_EXCEEDED`. Pass the signal to `fetch`, or check it in your own code, and the work really stops.

```ts doc-test=run
import { withTimeout } from '@migaia/utils/promise'
import { isUtilsTimeoutError } from '@migaia/utils/error'

// A query that takes 2 seconds; real code is usually fetch(url, { signal }).
function slowQuery(signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve('rows'), 2_000)
    signal.addEventListener('abort', () => {
      clearTimeout(timer) // stop as soon as it is cancelled
      console.log('query stopped, reason:', signal.reason.code)
      reject(signal.reason)
    })
  })
}

try {
  await withTimeout(({ signal }) => slowQuery(signal), { timeoutMs: 100 })
} catch (error) {
  if (isUtilsTimeoutError(error)) console.log('timed out:', error.code, error.timeoutMs)
}
```

Output:

```text
query stopped, reason: DEADLINE_EXCEEDED
timed out: DEADLINE_EXCEEDED 100
```

Prints `query stopped, reason: DEADLINE_EXCEEDED` and then `timed out: DEADLINE_EXCEEDED 100`.

The operation is cancelled first and clears its own timer, then the caller receives the timeout error; `signal.reason` is that same error. Rejecting with `signal.reason` only acknowledges the cancellation, so it is not reported again as a failure after the deadline.

## Where a failure after the deadline goes

Some operations ignore the `signal`, keep running after the deadline and fail later. Where does that failure go?

A hand-written `Promise.race` either loses that late rejection or turns it into an unhandled rejection; either way nobody learns that the write actually failed.

`withTimeout` has already settled with the timeout and never changes the caller's result; the late failure goes to the `report` callback. Without `report` it is rethrown to the host as an uncaught exception, and Node exits the process by default, so always pass `report` for operations that ignore the signal.

```ts doc-test=run
import { withTimeout } from '@migaia/utils/promise'

const saving = withTimeout(
  // this write ignores the signal and fails after the deadline
  () => new Promise((_, reject) => setTimeout(() => reject(new Error('write failed')), 50)),
  {
    timeoutMs: 10,
    report: (error, context) =>
      console.log('failure after the deadline:', (error as Error).message, context.phase)
  }
)
await saving.catch((error) => console.log('caller got:', error.code))
await new Promise((resolve) => setTimeout(resolve, 100))
```

Output:

```text
caller got: DEADLINE_EXCEEDED
failure after the deadline: write failed late-rejection
```

Prints `caller got: DEADLINE_EXCEEDED`, then about 40 ms later `failure after the deadline: write failed late-rejection`.

The caller only sees the timeout; the write failure is not lost and reaches `report` with `phase: 'late-rejection'`.

## Retry only what is worth retrying

A server sometimes answers 503 and one retry fixes it, but the retry code hammers an already overloaded service and the user waits half a minute before seeing the failure.

Hand-written retry loops have three traps: they retry errors such as 404 that will never succeed, they retry immediately, and they have no total limit.

`retry` asks `shouldRetry` which errors to retry, waits `delay` between attempts (a function can grow it with each attempt), and `totalTimeoutMs` caps the whole run, waits included.

```ts doc-test=run
import { retry } from '@migaia/utils/promise'

// A flaky stock API: the first two calls return 503, the third succeeds.
let calls = 0
async function readStock(signal: AbortSignal): Promise<number> {
  calls += 1
  if (signal.aborted) throw signal.reason
  if (calls < 3) throw Object.assign(new Error('service unavailable'), { status: 503 })
  return 42
}

const stock = await retry(
  ({ attempt, signal }) => {
    console.log(`attempt ${attempt}`)
    return readStock(signal)
  },
  {
    maxAttempts: 5,
    // Retry only 5xx; a bad request (4xx) will not succeed on retry, so it is thrown.
    shouldRetry: (error) => (error as { status?: number }).status! >= 500,
    delay: (_error, { attempt }) => 100 * 2 ** (attempt - 1), // 100ms, 200ms, ...
    totalTimeoutMs: 2_000 // at most 2 seconds in total, waits included
  }
)
console.log('stock:', stock)
```

Output:

```text
attempt 1
attempt 2
attempt 3
stock: 42
```

Prints `attempt 1`, `attempt 2`, `attempt 3` and `stock: 42`.

After the two 503 responses it waits 100 ms and then 200 ms, and the third attempt succeeds. Each attempt's `signal` is aborted when the total deadline passes.

An order number does not exist and the API answers 404; retrying five times will never succeed and only makes the user wait.

Common retry loops treat every error alike and throw a new wrapper error once attempts run out, so the caller can no longer read the original `status`.

When `shouldRetry` returns `false`, `retry` stops without waiting and throws that original error to the caller. It is not wrapped and its message is unchanged, so the caller can still read its own `status` field.

```ts doc-test=run
import { retry } from '@migaia/utils/promise'

let calls = 0
try {
  await retry(
    () => {
      calls += 1
      throw Object.assign(new Error('order not found'), { status: 404 })
    },
    {
      maxAttempts: 5,
      shouldRetry: (error) => (error as { status?: number }).status! >= 500
    }
  )
} catch (error) {
  console.log('calls:', calls, 'error:', (error as Error).message)
}
```

Output:

```text
calls: 1 error: order not found
```

Prints `calls: 1 error: order not found`.

The 404 is not retried, `maxAttempts: 5` is only an upper bound, and the caller receives the very error it threw.

## Limit a batch and cancel queued tasks when the user leaves

Downloading hundreds of files at once makes the server throttle or fail, and connections queue up.

`Promise.all(ids.map(download))` starts every request at once; nothing limits how many run at the same moment.

`createConcurrencyLimiter` keeps at most `concurrency` tasks running; the rest wait in submission order and start as earlier ones finish.

```ts doc-test=run
import { createConcurrencyLimiter } from '@migaia/utils/promise'

const limiter = createConcurrencyLimiter({ concurrency: 2 })
const download = (id: number) =>
  limiter.run(async () => {
    console.log(`start ${id}: ${limiter.activeCount} running, ${limiter.pendingCount} queued`)
    await new Promise((resolve) => setTimeout(resolve, 50))
    return `file ${id}`
  })

// Submit 5 tasks at once; at most 2 run at the same time
const files = await Promise.all([1, 2, 3, 4, 5].map(download))
console.log(files.join(', '))
```

Output:

```text
start 1: 2 running, 3 queued
start 2: 2 running, 3 queued
start 3: 2 running, 2 queued
start 4: 2 running, 1 queued
start 5: 2 running, 0 queued
file 1, file 2, file 3, file 4, file 5
```

`activeCount` stays at 2 while `pendingCount` drops from 3 to 0, and the last line lists `file 1` to `file 5` in submission order.

The `Promise.all` result keeps submission order, whatever order the tasks finish in.

After the user closes the page, queued downloads still run, fetching data for a page nobody will see.

Hand-written queues usually handle queuing but not withdrawal: once a task is queued, all you can do is wait for it to run.

Pass a `signal` to `run`: a task still waiting in the queue rejects with the abort reason and never starts; a task that already started receives the cancellation on `context.signal` and decides itself whether to stop.

```ts doc-test=run
import { createConcurrencyLimiter } from '@migaia/utils/promise'

const limiter = createConcurrencyLimiter({ concurrency: 1 })
const page = new AbortController() // cancelled when the user leaves the page

const thumbnails = [1, 2, 3].map((id) =>
  limiter
    .run(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 50))
        return `thumbnail ${id} done`
      },
      { signal: page.signal }
    )
    .catch((reason) => `thumbnail ${id} cancelled: ${reason}`)
)

page.abort('user left the page') // task 1 is already running; 2 and 3 are still queued
for (const line of await Promise.all(thumbnails)) console.log(line)
```

Output:

```text
thumbnail 1 done
thumbnail 2 cancelled: user left the page
thumbnail 3 cancelled: user left the page
```

Prints `thumbnail 1 done`, then `cancelled: user left the page` for 2 and 3.

Task 1 had already started before the abort, so it finishes; 2 and 3 were still queued, are cancelled and never start.

## Run a concurrent initialization only once

Three modules initialize at the same time and three database connections open.

Lazy loading with `let db` and `if (!db)` breaks in async code: when three calls happen at the same moment, `db` is still empty for all of them.

`onceAsync` stores the Promise on the first call, so every later call, including concurrent ones, gets that same Promise.

```ts doc-test=run
import { onceAsync } from '@migaia/utils/function'

let connects = 0
// Three modules call getDb() at startup, but the connection must open only once.
const getDb = onceAsync(async () => {
  connects += 1
  console.log('connecting to the database...')
  await new Promise((resolve) => setTimeout(resolve, 50))
  return { query: (sql: string) => `ran ${sql}` }
})

const [users, orders, reports] = await Promise.all([getDb(), getDb(), getDb()])
console.log('connections:', connects, 'same connection:', users === orders && orders === reports)
console.log(users.query('select 1'))
```

Output:

```text
connecting to the database...
connections: 1 same connection: true
ran select 1
```

Prints `connecting to the database...` once, then `connections: 1 same connection: true`.

All three callers hold the same object: the initialization ran once.

The config service fails on the first initialization. What happens on later calls?

Expecting `onceAsync` to retry by itself after a failure leads to confusion when the service is back and calls still receive the old failure.

`onceAsync` remembers the Promise of the first call, whether it succeeds or fails; every later call receives that same failure and the function does not run again. When the initialization should retry, put `retry` inside the function you pass to `onceAsync`, or create a fresh `onceAsync` after a failure.

```ts doc-test=run
import { onceAsync } from '@migaia/utils/function'

let attempts = 0
const loadConfig = onceAsync(async () => {
  attempts += 1
  throw new Error('config service unreachable')
})

for (let index = 0; index < 3; index += 1)
  await loadConfig().catch((error) => console.log(`call ${index + 1}:`, error.message))
console.log('actual runs:', attempts)
```

Output:

```text
call 1: config service unreachable
call 2: config service unreachable
call 3: config service unreachable
actual runs: 1
```

All three calls print `config service unreachable`, and the last line is `actual runs: 1`.

The failure also happens once and is remembered; whether to retry is up to the function you pass in.

## Update a deep field without mutating

Changing the city in a user's address does not refresh UI that relies on reference checks, and the original state object was modified too.

Hand-written immutable updates spread every level: `{ ...state, user: { ...state.user, address: { ...state.user.address, city } } }`. With enough levels one gets missed and the original object is mutated.

`set` copies each level along the path and reuses every other branch, leaving the original untouched. `get` reads a path and returns `undefined` when a level is missing instead of throwing.

```ts doc-test=run
import { get, set } from '@migaia/utils/object'

type IState = {
  user: { name: string; address: { city: string }; phone?: { mobile: string } }
  cart: { items: string[] }
}

const state: IState = {
  user: { name: 'Ada', address: { city: 'Shanghai' } },
  cart: { items: ['keyboard'] }
}

const next = set(state, 'user.address.city', 'Hangzhou')

console.log(get(next, 'user.address.city')) // new value
console.log(state.user.address.city) // the original is unchanged
console.log('cart is the same object:', next.cart === state.cart) // untouched branches are reused
console.log('user is a new object:', next.user !== state.user)
console.log(get(next, 'user.phone.mobile')) // the optional phone is missing: undefined, no throw
```

Output:

```text
Hangzhou
Shanghai
cart is the same object: true
user is a new object: true
undefined
```

Prints `Hangzhou` and `Shanghai`: the new object changed and the original did not.

`cart is the same object: true` and `user is a new object: true` show that only objects on the path are copied; the last `undefined` comes from a missing path.

## Stop callers from changing config after handing it over

A library's retry count changes mysteriously, and the cause turns out to be a caller editing its own object after handing it over as config.

A library that keeps the caller's config object changes behavior when the caller later edits it, and a plugin that tweaks a field affects everyone else as well.

`ownConfig` copies the config once into an object the library owns; `readonlyConfig` gives plugins a read-only view; `patchConfig` creates a new config instead of changing the old one, and `CONFIG_DELETE` removes a field.

```ts doc-test=run
import { CONFIG_DELETE, ownConfig, patchConfig, readonlyConfig } from '@migaia/utils/config'

const userOptions = { endpoint: 'https://api.example.com', retry: { attempts: 3 }, debug: true }
const config = ownConfig(userOptions) // copy once; later edits by the caller no longer reach it
userOptions.retry.attempts = 100 // the caller edits its own object afterwards
console.log('attempts seen by the library:', config.retry.attempts)

const view = readonlyConfig(config) // read-only view handed to plugins
try {
  view.retry.attempts = 0
} catch (error) {
  console.log(
    'read-only view refused the write:',
    (error as Error).name,
    (error as { code?: string }).code
  )
}

// New config: change endpoint, delete debug; the untouched retry is reused
const next = patchConfig(config, { endpoint: 'https://staging.example.com', debug: CONFIG_DELETE })
console.log(
  next.endpoint,
  '| debug present:',
  'debug' in next,
  '| retry reused:',
  next.retry === config.retry
)
```

Output:

```text
attempts seen by the library: 3
read-only view refused the write: TypeError CONFIG_READONLY
https://staging.example.com | debug present: false | retry reused: true
```

`attempts seen by the library: 3`: the caller's edit did not reach the library.

Writing to the read-only view throws a `TypeError` with code `CONFIG_READONLY`. The new config has the new `endpoint`, no `debug`, and shares the unchanged `retry` object with the old config.

## Recognize the underlying cause after wrapping

A lost-connection error is wrapped layer by layer into "failed to load the order", and the upper layer can only compare message text to tell whether the connection was lost.

Comparing messages is fragile: the check breaks as soon as the wording changes, and replacing the error object loses its type and stack.

`attachErrorIdentity` writes a stable `source` and `code` onto the original error without replacing it, so `instanceof` and the stack stay intact; `walkErrorCauses` finds it again along `cause` and `AggregateError.errors`.

```ts doc-test=run
import { attachErrorIdentity, walkErrorCauses } from '@migaia/utils/error'

// A native error from the driver, tagged with a stable source and code
function readRow(): never {
  throw attachErrorIdentity(new Error('connection reset'), {
    source: 'order-db',
    code: 'CONNECTION_LOST'
  })
}

try {
  try {
    readRow()
  } catch (cause) {
    // The caller wraps it in a domain error and keeps the original on cause
    throw new Error('failed to load the order', { cause })
  }
} catch (error) {
  const lost = walkErrorCauses(error).some(
    (item) => (item as { code?: string } | undefined)?.code === 'CONNECTION_LOST'
  )
  console.log((error as Error).message, '| lost connection underneath:', lost)
  console.log('original is still an Error:', walkErrorCauses(error)[1] instanceof Error)
}
```

Output:

```text
failed to load the order | lost connection underneath: true
original is still an Error: true
```

Prints `failed to load the order | lost connection underneath: true`: the outer message is domain text, and the check relies on the code.

`original is still an Error: true`: attaching identity did not change the original error's type.

---

## Contents

- [Root runtime detection](#runtime-detection)
- [`/promise` module](#promise-module)
- [`/error` module](#error-module)
- [`/bytes` module](#bytes-module)
- [`/object` module (including object paths)](#object-module)
- [`/typing` module](#typing-module)
- [`/config` module](#config-module)
- [`/function` module](#function-module)
- [Collector](#collector)
- [Combined workflow examples](#combined-workflow-examples)
- [Troubleshooting and build gates](#troubleshooting-and-build-gates)

---

<a id="runtime-detection"></a>

## Root entry: runtime and global-scope detection

Import these functions and their constant/type domains from `@migaia/utils`. They take no arguments and return the current classification or `undefined`:

```ts
declare function detectServerRuntime(): ServerRuntime | undefined
declare function detectElectronProcessType(): ElectronProcessType | undefined
declare function detectGlobalScope(): GlobalScopeKind | undefined
```

| Domain                | Values                                                          |
| --------------------- | --------------------------------------------------------------- |
| `ServerRuntime`       | `deno`, `bun`, `node`                                           |
| `ElectronProcessType` | `main`, `renderer`, `utility`                                   |
| `GlobalScopeKind`     | `window`, `dedicated-worker`, `shared-worker`, `service-worker` |

`detectServerRuntime()` checks Deno before Bun before Node. Deno requires a nonempty `Deno.version.deno`, even when a Node compatibility process global exists. Bun accepts its global object or a nonempty `process.versions.bun`; Node is the final nonempty `process.versions.node` fallback.

`detectElectronProcessType()` first requires `process.versions.electron`. Electron's historical `process.type === 'browser'` maps to main; renderer and utility keep those names. A plain Node process or an unknown Electron type returns `undefined`.

`detectGlobalScope()` first excludes any recognized server runtime. It then checks the actual global instance against Window, DedicatedWorkerGlobalScope, SharedWorkerGlobalScope, and ServiceWorkerGlobalScope in that order. A constructor's existence alone does not identify the scope. Unrecognized scopes return `undefined`.

Every call reads current globals afresh. Importing the module does not cache a host classification, launch a unit, create a connection, or schedule a timer. The functions load no native host modules and require no Node/DOM declarations in the public types. Classification does not grant a carrier or permission; the adapter that uses a native API still owns its capability admission.

```ts
import {
  detectServerRuntime,
  detectElectronProcessType,
  detectGlobalScope,
  ServerRuntime,
  ElectronProcessType,
  GlobalScopeKind
} from '@migaia/utils'

console.log(detectServerRuntime(), detectElectronProcessType(), detectGlobalScope())
console.log(ServerRuntime.node, ElectronProcessType.main, GlobalScopeKind.window)
```

The first line depends on the actual host; no browser scope is reported merely because Node exposes compatibility constructors. The second line prints the stable domain values `node main window`.

<a id="promise-module"></a>

## `/promise` module

Deadlines, cooperative cancellation, retries and concurrency limits. Every cancellation here is **cooperative**: an aborted operation stops only when it reads the `signal` it was given and returns or throws early on its own; I/O that ignores the `signal` is not interrupted.

### Schedulers (`@migaia/utils/scheduler`)

The scheduler contract and its implementations are exported only from `@migaia/utils/scheduler` (and the root entry `@migaia/utils`). `sleep`, `withTimeout`, `retry` and `createAbortTimeoutSignal` in this module use it as the type and default of their `scheduler` option.

```ts
import { systemScheduler, systemWallClock } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'
// /scheduler exports IScheduledTask, IScheduler and IWallClock; /testing exports IManualScheduler.

type IScheduledTask = { cancel(): void; unref?(): void }
type IScheduler = {
  now(): number
  schedule(callback: () => void, delayMs: number): IScheduledTask
  defer?(callback: () => void): void
}
type IManualScheduler = IScheduler & {
  advance(ms: number): void
  readonly pendingCount: number
}
type IWallClock = { timestamp(): number }
```

- `IScheduler`: the only scheduler contract. `now()` is a monotonic, non-decreasing number of milliseconds (two calls in a row may be equal). Use it only for differences and local deadlines, never as an epoch time. The `delayMs` of `schedule()` must be finite and non-negative; the callback runs at most once and never synchronously inside the `schedule()` call.
- `IManualScheduler`: adds `advance(ms)`, which moves virtual time forward and runs due callbacks, and `pendingCount`, the number of tasks that have neither fired nor been cancelled. It is for deterministic unit tests.
- `IWallClock`: produces diagnostic timestamps only (epoch milliseconds as a safe integer). Never use it for deadlines, expiry or replay windows.

```ts doc-test=skip reason="Signature summary, not a runnable module"
export const systemScheduler: IScheduler
export const systemWallClock: IWallClock
```

`systemScheduler` uses `performance.now()` as its monotonic clock and the host `setTimeout` / `clearTimeout` for timers, reading those capabilities through `globalThis` on every call. When the host has no `performance.now`, it returns a non-finite value, or the timer functions are missing, it throws a native error with `ENV_UNSUPPORTED`; an error thrown by `performance.now` itself propagates unchanged. A `delayMs` that is not a number throws `TypeError`, and a non-finite or negative one throws `RangeError`; both carry `INVALID_ARGUMENT` and create no timer. Delays above `2_147_483_647` are waited out in segments; `unref()` uses the native timer as its receiver and keeps applying to later segments; `cancel()` is idempotent.

`systemWallClock.timestamp()` returns `Date.now()`. Use it when you need an epoch timestamp. Code that accepts an `IScheduler` for timeouts, retries or scheduling must pair `scheduler.now()` with `scheduler.schedule()`; never subtract or compare wall-clock values with `now()`.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createManualScheduler(): IManualScheduler
```

> For this repository's tests only: it serves unit tests and adapter checks in this repository and is not meant for application code. Other projects should prefer the fake timers of their test framework; production code uses `systemScheduler` or the default scheduler.

Creates a first-in-first-out virtual-clock scheduler: `schedule()` orders tasks by due time, then by registration order. `advance(ms)` runs every due callback in one go; tasks that callbacks schedule along the way also run in the same `advance` as long as they are due at or before the target time. One `advance` that loops more than 10000 times throws `RangeError` / `SCHEDULER_RUNAWAY`, which stops callbacks that keep scheduling each other forever. `delayMs` / `ms` must be finite and non-negative (a non-number throws `TypeError`, anything else invalid throws `RangeError`); a due time or target time that overflows to a non-finite value also throws `RangeError`. All of these carry `INVALID_ARGUMENT` and leave the clock and queue unchanged. Calling `advance()` again inside a callback throws `TypeError` / `REENTRANT_CALL`, and the outer `advance` still completes.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const scheduler = createManualScheduler()
const task = scheduler.schedule(() => console.log('fired'), 100)
scheduler.advance(50) // not fired yet
scheduler.advance(50) // fires and prints 'fired'
```

### `deferred`

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IDeferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T | PromiseLike<T>) => void
  readonly reject: (reason?: unknown) => void
}
function deferred<T>(): IDeferred<T>
```

Creates a native Promise that you settle from outside. It helps turn a callback API into a Promise, or lets a test decide exactly when an async operation finishes or fails.

New code should prefer the platform's `Promise.withResolvers()`. `deferred()` mainly serves older runtimes that lack it, or project boundaries that must depend on the `IDeferred<T>` type:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const { promise, resolve, reject } = Promise.withResolvers<number>()
resolve(42)
```

For older runtimes:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const { promise, resolve } = deferred<number>()
setTimeout(() => resolve(42), 0)
await promise // 42
```

### `toPromise`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function toPromise<T>(run: () => T): Promise<Awaited<T>>
```

Calls `run` synchronously, exactly once, and adopts its return value with native Promise rules. If `run` throws synchronously, the call site does not throw; it returns a Promise rejected with that exact reason. It only turns a synchronous computation into a Promise and creates no timer, scheduler, retry or cancellation state.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const found = await toPromise(() => cache.get('key'))
const pending = toPromise(() => {
  throw new Error('read failed')
})
await pending // the rejection is observed asynchronously
```

Compared with `Promise.resolve().then(() => run())`:

- `toPromise(run)` calls `run` immediately, so reads, writes and other synchronous side effects have happened before it returns. When `run` returns a native Promise, the result is that same Promise.
- `Promise.resolve().then(run)` delays the call to the next microtask and returns a new chained Promise. It is useful for yielding the current call stack or avoiding synchronous reentrancy, not for logic that relies on "takes effect as soon as it is called".
- Both turn an exception into a rejection, at different times: the first catches the synchronous exception during the current call, the second only when the microtask actually runs `run`.

Use `toPromise` when work must start synchronously but always return a Promise; use `Promise.resolve().then(run)` when work should start later.

### `sleep`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function sleep(delayMs: number, options?: IAsyncControls): Promise<void>
```

Resolves after the scheduler delay. If the given `signal` / `signals` abort while waiting, it rejects with `UtilsAbortError`. `delayMs` must be finite and non-negative. It always cleans up its timer and abort listeners; if that cleanup itself throws, the failure goes to `hostRethrowReporter` (`sleep` takes no custom reporter) instead of being swallowed.

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IAsyncControls = {
  readonly signal?: IAbortSignal
  readonly signals?: readonly IAbortSignal[]
  readonly scheduler?: IScheduler
  readonly unref?: boolean
}
```

`signal` and `signals` are **mutually exclusive**; passing both rejects with a `TypeError`. `unref: true` tries to call `unref()` on the underlying timer handle, so in Node the timer does not keep the process alive.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const controller = new AbortController()
const p = sleep(1000, { signal: controller.signal as any })
controller.abort('cancelled')
await p // throws UtilsAbortError whose cause is 'cancelled'
```

### `createAbortTimeoutSignal`

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IAbortTimeoutSignalOptions = {
  readonly signal?: IAbortSignal
  readonly timeoutMs?: number
  readonly scheduler?: IScheduler
  readonly timeoutReason?: () => unknown
  readonly report?: IUtilsReporter
}
type IAbortTimeoutSignal = {
  readonly signal: IAbortSignal | undefined
  readonly dispose: () => void
}
function createAbortTimeoutSignal(options?: IAbortTimeoutSignalOptions): IAbortTimeoutSignal
```

Creates one operation signal that several underlying requests can share, without creating, racing or settling any application Promise. When the outside signal aborts first, its original reason is kept; when the deadline comes first, the signal uses the return value of `timeoutReason()`. An error thrown by that reason factory becomes the signal reason and never escapes from the timer callback. Without `timeoutMs`, the outside signal is passed through as the same object. `dispose()` is idempotent and cancels the timer and removes the listener; cleanup failures go to `report` with `operation: 'abort-timeout-signal'`.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const merged = createAbortTimeoutSignal({
  signal: controller.signal as any,
  timeoutMs: 500,
  timeoutReason: () => new Error('deadline')
})
try {
  await Promise.all([requestA(merged.signal), requestB(merged.signal)])
} finally {
  merged.dispose()
}
```

The callbacks of `withTimeout` / `raceWithAbort` can also hand one cooperative signal to several requests, but those functions also own the final Promise: its timeout or abort rejection, late rejections and cleanup errors. When a transaction commit is the only fact that settles the work, use this signal-only primitive and let the adapter decide when its Promise completes.

### `withTimeout`

```ts doc-test=skip reason="Signature summary, not a runnable module"
type ITimeoutOperation<T> = (context: { readonly signal: INativeAbortSignal }) => T | PromiseLike<T>
type IDeadlineOnlyOperation<T> = (context: { readonly signal: IAbortSignal }) => T | PromiseLike<T>

type IWithTimeoutOptions = IAsyncControls & {
  readonly timeoutMs: number
  readonly report?: IUtilsReporter
  readonly zeroTimeoutBehavior?: 'skip' | 'start'
  readonly cooperativeCancellation?: boolean
}

function withTimeout<T>(
  operation: ITimeoutOperation<T>,
  options: IWithTimeoutOptions & { readonly cooperativeCancellation?: true }
): Promise<T>
function withTimeout<T>(
  operation: IDeadlineOnlyOperation<T>,
  options: IWithTimeoutOptions
): Promise<T>
```

`INativeAbortSignal` is the type of the signal this package creates with a native `AbortController` and hands to the operation. It resolves against the consumer's own global types: with `lib.dom`, `@types/node`, Deno or Bun types it is the host `AbortSignal`, so `fetch(url, { signal })` works directly; without host types it falls back to the structural `IAbortSignal`, so the published declarations need no host library. Every input still accepts the structural `IAbortSignal`.

Wraps a lazy operation in a deadline. The `signal` the `operation` receives is an **internal merged signal**: it becomes `aborted` when an outside `signal(s)` aborts or when the deadline passes. The operation must check it itself to stop early.

- `timeoutMs`: must be finite and non-negative. With `timeoutMs === 0` the call rejects at once with `UtilsTimeoutError('operation', 0)` by default; with `zeroTimeoutBehavior: 'start'` it starts the operation immediately and keeps a zero-delay deadline, so an operation that has not settled before the deadline callback still times out.
- `cooperativeCancellation` (default `true`): with `false`, no internal `AbortController` is allocated and the operation only receives an inert, never-aborting structural signal (typed `IAbortSignal`, so it cannot go to `fetch`). Use it for "wait at most this long for the result, but the operation does not need to be told to stop".
- `report`: once the call has settled, a late success value is discarded and only a late rejection goes to `report` (default `hostRethrowReporter`). When the operation rejects with the exact `signal.reason` it received (as `fetch(url, { signal })` does after it is cancelled), it is only acknowledging the cancellation and nothing goes to `report`. Cleanup failures surface through the returned Promise's rejection or aggregate, not through this reporter.
- When cleanup (cancelling the timer, removing listeners) fails, the cleanup errors and the original error are rejected together as an `AggregateError`.

```ts
import { sleep, withTimeout } from '@migaia/utils/promise'

await withTimeout(
  async ({ signal }) => {
    while (!signal.aborted) {
      // After each small batch of synchronous work, yield the event loop so the deadline can run.
      await sleep(10)
    }
    throw signal.reason
  },
  { timeoutMs: 500 }
) // rejects with UtilsTimeoutError('operation', 500) after 500 ms
```

### `raceWithAbort`

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IAbortOperation<T> = ITimeoutOperation<T>

function raceWithAbort<T>(
  operation: IAbortOperation<T>,
  options?: Pick<IAsyncControls, 'signal' | 'signals'> & {
    readonly report?: IUtilsReporter
    readonly cleanupPolicy?: 'reject' | 'report'
  }
): Promise<T>
```

Same semantics as `withTimeout`, but **without a deadline timer**: the operation fails early only when an outside `signal(s)` aborts. `cleanupPolicy: 'report'` (default `'reject'`) reports a listener cleanup failure as a diagnostic instead of rejecting the final Promise.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const controller = new AbortController()
const result = raceWithAbort(({ signal }) => fetchSomething({ signal }), {
  signal: controller.signal as any
})
```

### `retry`

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IRetryContext = {
  readonly attempt: number
  readonly signal: INativeAbortSignal
  readonly remainingMs?: number
}
type IRetryFailureContext = IRetryContext & { readonly maxAttempts: number }

function retry<T>(
  operation: (context: IRetryContext) => T | PromiseLike<T>,
  options: {
    readonly maxAttempts: number
    readonly shouldRetry: (
      error: unknown,
      context: IRetryFailureContext
    ) => boolean | PromiseLike<boolean>
    readonly delay?: number | ((error: unknown, context: IRetryFailureContext) => number)
    readonly totalTimeoutMs?: number
    readonly attemptTimeoutMs?: number
    readonly signal?: IAbortSignal
    readonly signals?: readonly IAbortSignal[]
    readonly zeroTimeoutBehavior?: 'skip' | 'start'
    readonly report?: IUtilsReporter
    readonly unref?: boolean
    readonly scheduler?: IScheduler
  }
): Promise<T>
```

Serial retries with three layers of limits:

- `maxAttempts`: a positive safe integer. If attempt number `maxAttempts` still fails, its error is thrown.
- `attemptTimeoutMs`: a separate timeout for each attempt (wrapped in `withTimeout` internally).
- `totalTimeoutMs`: a deadline for the whole run, all attempts and backoff waits included; exceeding it throws `UtilsTimeoutError('total', totalTimeoutMs)`.
- `shouldRetry(error, context)`: decides whether a failure is worth retrying. Returning `false`, or running out of `maxAttempts`, ends the run and throws that error.
- `delay`: a fixed number of milliseconds or a `(error, context) => milliseconds` backoff function for the wait between attempts (done with an internal `sleep`, which also honours `signal` / `signals`).
- When an outside signal aborts at any point, the whole run ends with `UtilsAbortError` and no further attempt starts.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
await retry(
  async ({ attempt }) => {
    if (attempt < 3) throw new Error('boom')
    return 'ok'
  },
  { maxAttempts: 5, shouldRetry: () => true, delay: (_, { attempt }) => attempt * 100 }
) // 'ok' after 3 attempts, with backoff waits of about 100 ms and 200 ms
```

### `hostRethrowReporter` and `IUtilsReporter`

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IUtilsReporter = (
  error: unknown,
  context: {
    readonly operation:
      'abort-timeout-signal' | 'withTimeout' | 'raceWithAbort' | 'retry' | 'sleep' | 'limiter'
    readonly phase: 'late-rejection' | 'cleanup' | 'reporter'
    readonly attempt?: number
  }
) => void
const hostRethrowReporter: IUtilsReporter
```

`hostRethrowReporter` is the default diagnostic reporter: it rethrows the error with `queueMicrotask` (or synchronously where `queueMicrotask` is missing), so it becomes an uncaught exception that the host's global error handling records instead of being silently swallowed. Replace it through the `report` option with logging, telemetry or similar. In Node an uncaught exception exits the process by default, so pass your own `report` when an operation ignores the `signal` and may fail after the deadline. A rejection with the `signal.reason` the operation received is an acknowledgement of the cancellation, and `withTimeout`, `raceWithAbort` and `retry` never report it.

### `createConcurrencyLimiter`

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IConcurrencyLimiter = {
  run<T>(
    task: (context: { readonly signal?: IAbortSignal }) => T | PromiseLike<T>,
    options?: { readonly signal?: IAbortSignal }
  ): Promise<T>
  readonly activeCount: number
  readonly pendingCount: number
  whenIdle(): Promise<void>
  close(reason?: unknown): void
  dispose(reason?: unknown): Promise<void>
}
function createConcurrencyLimiter(options: {
  readonly concurrency: number
  readonly report?: IUtilsReporter
}): IConcurrencyLimiter
```

The **only primitive in this package with a lifetime across calls**: a first-in-first-out task queue with a concurrency cap.

- `run(task, { signal })`: adds the task to the queue. Tasks start immediately until `concurrency` is reached; after that they wait for a free slot. Aborting the given `signal` rejects a **queued** task at once with the abort reason; a task that has already started is not affected and must read `context.signal` itself.
- `activeCount` / `pendingCount`: how many tasks are running / waiting in the queue (not cancelled).
- `whenIdle()`: a Promise that resolves when no task is running and the queue is empty. Repeated calls share the same wait instead of registering again.
- `close(reason?)`: stops accepting new and queued tasks. Queued tasks that have not started reject at once with `reason` (by default a `LIMITER_CLOSED` error); running tasks are not affected.
- `dispose(reason?)`: calls `close()` and returns a Promise that resolves only after every running task has finished, for graceful shutdown.

`concurrency` must be a positive safe integer; otherwise the constructor throws `RangeError`.

```ts doc-test=skip reason="Signature summary, not a runnable module"
const limiter = createConcurrencyLimiter({ concurrency: 2 })
const results = await Promise.all([1, 2, 3, 4].map((n) => limiter.run(() => fetchPage(n))))
await limiter.dispose() // close after the remaining tasks finish
```

---

<a id="error-module"></a>

## `/error` module

One set of tools for error identity, wrapping and walking cause chains.

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IPropertyRead<T> =
  { readonly threw: false; readonly value: T } | { readonly threw: true; readonly error: unknown }
function tryReadProperty<T extends object, K extends keyof T>(
  target: T,
  key: K
): IPropertyRead<T[K]>
```

Reads one property exactly once and keeps the getter's receiver. When the read throws, the original thrown value goes into `error`; it is not wrapped and not reported. The caller checks the target object and decides what a failure means. New code that needs a guarded read of a single property should reuse this primitive.

The reason of an outside abort signal is read through the same entry:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const read = tryReadProperty(signal, 'reason')
if (read.threw) report(read.error)
else handleAbort(read.value)
```

Whether a failure is rethrown, wrapped, reported or used as the abort reason depends on the caller's own contract; this primitive only returns the read result.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
abstract class UtilsError extends Error {
  readonly source = 'foundation.utils'
  readonly code: IUtilsErrorCode
}
class UtilsAbortError extends UtilsError {
  readonly name = 'AbortError'
  constructor(reason?: unknown)
}
class UtilsTimeoutError extends UtilsError {
  readonly name = 'TimeoutError'
  readonly scope: 'operation' | 'attempt' | 'total'
  readonly timeoutMs: number
  constructor(scope: 'operation' | 'attempt' | 'total', timeoutMs: number)
}
```

`UtilsError` is the abstract base class: every semantic error this package throws carries `source: 'foundation.utils'` and a stable `code`. `UtilsAbortError` keeps the original abort reason on `cause`; `UtilsTimeoutError` also carries `scope` (whether the single operation, one attempt or the total deadline ran out) and `timeoutMs`.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function attachErrorIdentity<T extends object>(
  error: T,
  identity: {
    readonly source: string
    readonly code: string
    readonly phase?: string
    readonly detail?: Readonly<Record<string, unknown>>
  },
  hooks?: {
    // On a field conflict the caller picks a replacement target; without it a conflict throws TypeError
    readonly onConflict?: (context: {
      target: T
      key: string
      existing: unknown
      incoming: unknown
    }) => T
    // When a field cannot be defined (for example a frozen object) the caller picks a replacement target; without it the error is rethrown as is
    readonly onFailure?: (context: {
      target: T
      key: string
      incoming: unknown
      cause: unknown
    }) => T
  }
): T
```

Adds non-writable identity fields (`source` / `code` / `phase` / `detail`) to an existing error object in place. It **does not** replace or wrap the error. If a field already exists with a different value, it throws `TypeError` so it never silently overwrites identity written by other code; the same value counts as idempotent and the error is returned unchanged.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const error = new Error('boom')
attachErrorIdentity(error, { source: 'my-package', code: 'FETCH_FAILED' })
;(error as Error & { readonly code?: string }).code // 'FETCH_FAILED' (the return type is still T and does not add code)
```

```ts doc-test=skip reason="Signature summary, not a runnable module"
function toError(value: unknown, options?: { readonly message?: string }): Error
```

Turns any thrown value into an error you can diagnose. A native `Error`, or a cross-realm / structured error shape with string `name`, `message` and `stack`, is returned as is; the latter is not guaranteed to be `instanceof` the local `Error`. Any other value is wrapped in an internal error type with `cause: value`. Its message is `options.message` when given, otherwise the thrown value itself when it is a string, otherwise a fixed fallback text.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function walkErrorCauses(
  error: unknown,
  options?: { readonly maxDepth?: number }
): readonly unknown[]
```

Walks the `cause` chain and `AggregateError.errors` and returns every node visited, starting with `error` itself. A `Set` deduplicates identical values so cycles end. `maxDepth` (default 32) limits the depth; past it, that branch is not followed further. An error created with `cause: undefined` contributes an `undefined` entry, so read fields with optional chaining (`item?.code`).

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
try {
  throw new Error('outer', { cause: new Error('inner') })
} catch (error) {
  walkErrorCauses(error) // [outerError, innerError]
}
```

```ts doc-test=skip reason="Signature summary, not a runnable module"
function combineErrors(errors: Iterable<unknown>, message: string): Error | undefined
```

Combines zero, one or many errors: zero gives `undefined`; one is returned as is (normalized with `toError`); several are wrapped in `AggregateError(errors, message)`. If iterating `errors` itself throws, the errors collected so far and that iteration failure are packed into an `AggregateError` and thrown.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function isUtilsError(value: unknown): value is UtilsError
function isUtilsAbortError(value: unknown): value is UtilsAbortError
function isUtilsTimeoutError(value: unknown): value is UtilsTimeoutError
```

Diagnostic shape guards: they check an error-like `name` / `message` / `stack`, `source` equal to `foundation.utils`, and a `code` that belongs to `UtilsErrorCode`; the abort and timeout guards also check the matching code. They need no `instanceof` against local constructors and are not meant to authenticate where an error came from.

### `UtilsErrorCode`

```ts
const UtilsErrorCode = {
  invalidArgument: 'INVALID_ARGUMENT',
  nonErrorValue: 'NON_ERROR_VALUE',
  envUnsupported: 'ENV_UNSUPPORTED',
  aborted: 'ABORTED',
  deadlineExceeded: 'DEADLINE_EXCEEDED',
  schedulerRunaway: 'SCHEDULER_RUNAWAY',
  errorIdentityConflict: 'ERROR_IDENTITY_CONFLICT',
  errorChainInvalid: 'ERROR_CHAIN_INVALID',
  cloneUnsupported: 'CLONE_UNSUPPORTED',
  invalidEncoding: 'INVALID_ENCODING',
  limiterClosed: 'LIMITER_CLOSED',
  reentrantCall: 'REENTRANT_CALL',
  configUnsupported: 'CONFIG_UNSUPPORTED',
  configReadonly: 'CONFIG_READONLY',
  configConflict: 'CONFIG_CONFLICT',
  configLimitExceeded: 'CONFIG_LIMIT_EXCEEDED',
  configPathInvalid: 'CONFIG_PATH_INVALID',
  objectPathInvalid: 'OBJECT_PATH_INVALID',
  formatInvalid: 'FORMAT_INVALID',
  formatValueMissing: 'FORMAT_VALUE_MISSING',
  numberFormatInvalid: 'NUMBER_FORMAT_INVALID'
} as const
```

The stable semantic codes used across the whole package; `IUtilsErrorCode` is the union of their values. Besides the `UtilsError` subclasses, native `TypeError` / `RangeError` thrown by modules such as `base64ToBytes`, object paths and config also get the matching `code` (and `source: 'foundation.utils'`) through `Object.defineProperty`, so the same checks recognize them.

What each code means:

- `INVALID_ARGUMENT`: an argument has the wrong type or range, or a forbidden combination; fix the call.
- `NON_ERROR_VALUE`: `toError()` converted a thrown value that was not an `Error`; read the original value from `cause`.
- `ENV_UNSUPPORTED`: the host lacks a required capability such as `structuredClone`; switch environment or implementation.
- `ABORTED`: an outside signal asked for cancellation; stop the cooperative work and pass the cancellation reason on.
- `DEADLINE_EXCEEDED`: an operation, an attempt or the whole run timed out; use `scope` and `timeoutMs` to choose between retrying and degrading.
- `SCHEDULER_RUNAWAY`: one advance of the virtual clock ran more than 10000 tasks; look for callbacks that keep scheduling each other at the same instant.
- `ERROR_IDENTITY_CONFLICT`: the error already has a different `source` / `code` from the one being attached; keep the original identity.
- `ERROR_CHAIN_INVALID`: a received serialized error tree or its plain data breaks the field, scalar, depth, count or text-byte limits; fix the input or use the boundary's own handling policy.
- `CLONE_UNSUPPORTED`: `structuredClone` cannot copy the value; convert it to cloneable data first.
- `INVALID_ENCODING`: encoded input is not in canonical form; fix the input at the reported offset.
- `LIMITER_CLOSED`: the concurrency limiter is closed; stop submitting or create a new one.
- `REENTRANT_CALL`: a forbidden reentrant call into the same instance; wait for the current callback to finish.
- `CONFIG_UNSUPPORTED`: the config contains an unsupported data shape or property; use plain data.
- `CONFIG_READONLY`: an attempt to change a read-only config; create a new config from the owner side.
- `CONFIG_CONFLICT`: config sources disagree on ownership, profile or descriptors; align their contracts before merging.
- `CONFIG_LIMIT_EXCEEDED`: config key count, depth or a similar safety limit was exceeded; shrink the input or set an explicit limit.
- `CONFIG_PATH_INVALID`: a config path is empty, dangerous or has an invalid segment; use a safe path.
- `OBJECT_PATH_INVALID`: an object path cannot be parsed safely; fix the string or the segment tuple.
- `FORMAT_INVALID`: a template, placeholder or value cannot be formatted safely; fix the template or input.
- `FORMAT_VALUE_MISSING`: strict formatting found no value for a placeholder; add the field or change the policy.
- `NUMBER_FORMAT_INVALID`: `Intl.NumberFormat` rejected the locale, options, currency or value; fix the format settings.

---

<a id="bytes-module"></a>

## `/bytes` module

Byte and text encoding without Node `Buffer` or the DOM, in plain ECMAScript.

### How `ArrayBuffer` and `Uint8Array` relate

- `ArrayBuffer` is a fixed-length block of raw contiguous memory that only stores bytes; you cannot index into it directly. It is common at `fetch(...).arrayBuffer()`, files, Web Crypto, WebAssembly and Worker transfer boundaries.
- `Uint8Array` is an 8-bit unsigned integer view over that memory; each element is one byte from 0 to 255. Base64, UTF-8, network protocols and binary serialization work byte by byte, so this module uses it as its main input and output.
- `new Uint8Array(buffer, byteOffset, length)` creates a window that shares the underlying memory and copies nothing; writes through the view show up in the original buffer. `subarray()` keeps sharing memory; only `slice()` makes an independent copy.
- A plain `ArrayBuffer` may become detached after it is transferred to a Worker. `SharedArrayBuffer` is memory shared between threads, with different ownership and synchronization rules, so `isArrayBuffer()` rejects it explicitly.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function isUint8Array(value: unknown): value is Uint8Array
function isArrayBuffer(value: unknown): value is ArrayBuffer
```

Both guards determine the real brand through the engine's `%TypedArray%.prototype[Symbol.toStringTag]` and the internal-slot getter `ArrayBuffer.prototype.byteLength`. They recognize valid instances and subclasses from other iframe / Worker realms, and reject forged `constructor.name`, prototypes or `Symbol.toStringTag`, other TypedArrays, `DataView`, `SharedArrayBuffer` and Proxy objects. The check reads no user properties of the candidate.

A detached `Uint8Array` / `ArrayBuffer` still returns `true`: detaching does not change the object's brand, but it does affect whether bytes can be read, so callers that consume bytes must handle the detached state separately.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function bytesToBase64(value: Uint8Array): string
```

Encodes to standard (not URL-safe) Base64 with `=` padding, using the canonical RFC 4648 alphabet.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
function base64ToBytes(value: string, target?: Uint8Array): Uint8Array // target must be exactly the decoded length; it is reused instead of allocating
```

**Only canonical input is accepted**: the standard alphabet, a length that is a multiple of 4 and correct `=` padding. Anything else (URL-safe variants, missing padding, stray whitespace and so on) is rejected with a `TypeError` carrying `code: 'INVALID_ENCODING'`. Decoding checks directly that the unused padding bits are zero, without re-encoding, and rejects input whose bits do not line up.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
bytesToBase64(new Uint8Array([1, 2, 3])) // 'AQID'
base64ToBytes('AQID') // Uint8Array [1, 2, 3]
base64ToBytes('AQID-_') // throws TypeError (URL-safe characters are not accepted)
```

```ts doc-test=skip reason="Signature summary, not a runnable module"
function* streamBase64Chunks(value: Uint8Array, maxChunkBytes?: number): Iterable<string>;
```

Splits a large byte array into Base64 chunks that are **each valid on their own**: every chunk is cut on a 3-byte boundary, so each one decodes correctly without being joined first. `maxChunkBytes` defaults to `32763` and must be a safe integer `>= 3`; the actual chunk width is rounded down to a multiple of 3.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function utf8ByteLength(value: string): number
```

Counts the bytes of a string encoded as UTF-8 without allocating a buffer. Surrogate pairs are handled correctly, and a lone surrogate counts as 3 bytes, the width of U+FFFD.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function encodeUtf8(value: string): Uint8Array
function decodeUtf8(value: Uint8Array, options?: { readonly fatal?: boolean }): string
```

`encodeUtf8` encodes into a newly allocated UTF-8 byte array. `decodeUtf8` decodes: with `fatal: false` (the default) an invalid byte sequence becomes U+FFFD and decoding skips one byte and continues; with `fatal: true` it throws an encoding error that includes the byte offset (code `INVALID_ENCODING`; the message names UTF-8 and the offset).

```ts doc-test=skip reason="Signature summary, not a runnable module"
function splitUtf8(value: string, maxBytes: number): readonly string[]
```

Splits a string on code point boundaries so that each piece encodes to at most `maxBytes` bytes; it never cuts a code point in half. `maxBytes` must be a safe integer `>= 4` (4 is the largest UTF-8 width of one code point). An empty string returns `['']`.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
splitUtf8('你好世界', 6) // each Chinese character is 3 bytes → ['你好', '世界']
```

---

<a id="object-module"></a>

## `/object` module (including object paths)

`createSafeRecord<T>()` creates a new null-prototype dictionary on every call and returns `Partial<Record<string, T>>`. Untrusted key names, including `__proto__` and `constructor`, are stored as ordinary data keys and never invoke a setter on `Object.prototype`; after assignment each field is a writable, enumerable, configurable data property. It does not read or copy any input and does not decide key formats for other packages.

### Snapshots and probes

```ts doc-test=skip reason="Signature summary, not a runnable module"
function isPlainObject(value: unknown): value is Record<PropertyKey, unknown>
```

Returns true for a non-array object whose prototype is `null`, or whose prototype's own prototype is `null`. So it also accepts `Object.create(Object.create(null))` rather than only comparing with this realm's `Object.prototype`; ordinary class instances and built-ins such as `Date` / `Map` return false. If reading the prototype chain fails (a proxy trap throws), it also returns `false` instead of throwing.

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IProbePropertyResult<T> =
  | { readonly kind: 'missing' }
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'failed'; readonly error: unknown }
function probeProperty<T>(value: object, key: PropertyKey): IProbePropertyResult<T>
```

Reads one property exactly once, so a getter with side effects is not called twice: a missing property gives `missing`; a read (including a getter) that throws gives `failed` with the original error; otherwise it gives `value`.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const profileUnavailable = new Error('profile unavailable')
let profileReads = 0
const user = {
  name: 'Ada',
  get profile(): never {
    profileReads += 1
    throw profileUnavailable
  }
}

function readLabel(value: object, key: PropertyKey): string {
  const result = probeProperty<string>(value, key)
  switch (result.kind) {
    case 'value':
      return result.value
    case 'missing':
      return 'Anonymous'
    case 'failed':
      console.error('property read failed', result.error)
      return 'Unavailable'
  }
}

readLabel(user, 'name') // 'Ada'
readLabel(user, 'email') // 'Anonymous'
readLabel(user, 'profile') // 'Unavailable'
profileReads // 1: the getter was read only once
```

The first argument can be a plain object, a class instance or any other object with readable properties; the second accepts a string, number or Symbol key. Missing fields and failed reads are separate branches, so a `try/catch` cannot accidentally fall back to a default value; with `failed`, the error is not rebuilt, and `error` is exactly the instance the getter threw.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function immutableSnapshot<T>(value: T): T
```

Calls the host's native `globalThis.structuredClone(value)` directly, not JSON serialization or a hand-written recursion. It copies the whole object graph at once and keeps cycles, shared references and the data types structured clone supports, such as `Date`, `Map`, `Set`, `ArrayBuffer` and TypedArrays. This API takes no transfer list, so an `ArrayBuffer` is copied, never transferred.

Structured clone does not keep custom class prototype methods, getters / setters or property descriptors; functions, `WeakMap` and other unsupported members make the whole clone fail. "Immutable" means the snapshot no longer shares references with the source, not that the result went through `Object.freeze()`; freeze it or make it read-only yourself when you need that at runtime. A host without `structuredClone` throws a `TypeError` with `code: 'ENV_UNSUPPORTED'`; a value that cannot be cloned throws a `TypeError` with `code: 'CLONE_UNSUPPORTED'`.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const shared = { count: 1 }
const source = {
  primary: shared,
  alias: shared,
  createdAt: new Date('2026-01-01T00:00:00Z')
}
const copy = immutableSnapshot(source)

source.primary.count = 2
copy.primary.count // 1
copy.primary === copy.alias // true
copy.createdAt instanceof Date // true
Object.isFrozen(copy) // false
```

```ts doc-test=skip reason="Signature summary, not a runnable module"
type ISnapshotDiagnostic = {
  readonly path: readonly PropertyKey[]
  readonly reason: 'accessor' | 'read-failed' | 'unsupported'
  readonly cause: unknown
}
type IDiagnosticSnapshot<T> = {
  readonly value: T
  readonly diagnostics: readonly ISnapshotDiagnostic[]
}
function diagnosticSnapshot<T>(value: T): IDiagnosticSnapshot<T>
function structuredDiagnosticSnapshot<T>(value: T): IDiagnosticSnapshot<T>
```

The key difference from native `structuredClone` / `immutableSnapshot` is how failure is handled: those two are all-or-nothing for the whole graph, and any unsupported member makes the call throw; `diagnosticSnapshot` always tries to return `{ value, diagnostics }`. It copies plain objects and arrays recursively and calls `structuredClone` separately on each cloneable built-in subtree; functions, class instances and other unsupported types **keep their original reference** and are recorded as `unsupported`. An accessor is read once, turned into a plain value and recorded as `accessor`; a failed read or reflection is recorded as `read-failed`. A `WeakMap` keeps cycles safe.

So the result of `diagnosticSnapshot` may be only partly isolated: when `diagnostics` is not empty, the caller must check the listed `path`s and must not treat the result as a full deep copy. It suits logs, telemetry and debugging panels, where the data must not be lost wholesale but any degradation must be visible; security boundaries and config isolation should still use `immutableSnapshot` and let failures stop explicitly.

`structuredDiagnosticSnapshot` combines the two strategies: it first tries native `structuredClone`, and on success `diagnostics` is empty; if the host lacks it or the clone fails, it falls back to the best-effort snapshot above and adds an `unsupported` diagnostic, or a `read-failed` one carrying the original cause, at the root path. Prefer it at telemetry boundaries that want "a full clone when possible, otherwise an observable degraded result".

```ts doc-test=skip reason="Signature summary, not a runnable module"
function identitySnapshot<T>(value: T): T
```

Returns its argument unchanged. Called alone it has no runtime benefit; it is the zero-copy branch for configurable strategy slots such as `snapshot` / `clone`, and states explicitly that the caller accepts a shared reference whose later changes both sides will see. This repository's clone policy uses it for its `opaque` branch, which serves trusted in-process data that is identity-sensitive or not cloneable and may be shared. Do not use it where outside input must be isolated, for history snapshots or when crossing a boundary; choose `immutableSnapshot` there.

### Object paths (`parseObjectPath` / `probeObjectPath` / `get` / `set` / `createPathAccessor`)

Object paths come in two forms:

- **String paths**: `a.b.c`, with bracketed indexes for arrays: `list.[0].name`.
- **Tuple paths**: `readonly ['a', 'b', 'c']` or `readonly ['list', 0, 'name']`, which may include `symbol` keys (a string path cannot express a symbol).

Both forms share the same safety limits: at most 512 characters per segment, at most 256 segments, and at most 4096 characters for a whole string path; `__proto__` / `prototype` / `constructor` are always rejected, which prevents prototype pollution.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function parseObjectPath(path: string | IObjectPathTuple): IObjectPathTuple
```

Parses a string path into a normalized `readonly` tuple of segments (numeric indexes become `number`), or validates and freezes a given tuple path. Any out-of-range or dangerous segment throws a `TypeError` with `code: 'OBJECT_PATH_INVALID'`.

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IPathValueProbe<T, P extends IObjectPathInput<T>> = {
  readonly kind: 'value'
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly value: IObjectPathValue<T, P>
}
type IPathMissingProbe<P extends string | IObjectPathTuple = string | IObjectPathTuple> = {
  readonly kind: 'missing'
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly failedAt: number
  readonly failedKey: IObjectPathSegment
  readonly resolvedPath: IObjectPathTuple
  readonly parent: unknown
}
type IPathBlockedProbe<P extends string | IObjectPathTuple = string | IObjectPathTuple> = {
  readonly kind: 'blocked'
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly failedAt: number
  readonly failedKey: IObjectPathSegment
  readonly resolvedPath: IObjectPathTuple
  readonly parent: unknown
}
type IPathFailedProbe<P extends string | IObjectPathTuple = string | IObjectPathTuple> = {
  readonly kind: 'failed'
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly failedAt: number
  readonly failedKey: IObjectPathSegment
  readonly resolvedPath: IObjectPathTuple
  readonly parent: unknown
  readonly error: unknown
}
type IPathProbe<T, P extends IObjectPathInput<T>> =
  IPathValueProbe<T, P> | IPathMissingProbe<P> | IPathBlockedProbe<P> | IPathFailedProbe<P>

function probeObjectPath<T, P extends IObjectPathInput<T>>(object: T, path: P): IPathProbe<T, P>
function probeObjectPathSegments<T, P extends IObjectPathInput<T>>(
  object: T,
  segments: P
): IPathProbe<T, P>
```

Probes the path segment by segment, reading each segment once. The four results mean: **a value was found** (`value`, carrying `value`); **a property on the path does not exist** (`missing`); **a parent value on the path is not an object or function, so the probe cannot go deeper** (`blocked`, for example the path is `a.b.c` but `a.b` is `null` or a string); and **reading a segment threw** (`failed`, for example a throwing getter, carrying `error`).

All four results share `originKey` (the `path` exactly as passed) and `segments` (the full tuple parsed by `parseObjectPath`). `missing` / `blocked` / `failed` also share `failedAt` (the 0-based index of the failing segment), `failedKey` (that segment's key), `resolvedPath` (the prefix that resolved, i.e. the segments before `failedAt`) and `parent` (the parent value at the point of failure: for `missing` / `failed` the object that should own the property, for `blocked` the non-object value itself). Only `failed` adds `error`, the original thrown value.

`probeObjectPathSegments` accepts a tuple the caller has already validated or cached and skips parsing; its results mean exactly the same as `probeObjectPath`. Use it only on hot internal paths that guarantee the segments already passed the same safety rules; send outside string input to `probeObjectPath`.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function get<T, P extends IObjectPathInput<T>>(
  object: T,
  path: P
): IObjectPathValue<T, P> | undefined
```

A simplified read on top of `probeObjectPath`: `missing` / `blocked` both return `undefined`; `failed` (the read itself threw) **rethrows** that error instead of swallowing it. This differs from "the path does not exist", so callers handle the two separately.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const data = { user: { name: 'Ada' } }
get(data, 'user.name') // 'Ada'
get(data, 'user.missing') // undefined (missing)
get(data, 'user.name.x') // undefined (blocked: 'Ada' is a string, so .x cannot be reached)
```

```ts doc-test=skip reason="Signature summary, not a runnable module"
function set<T, P extends IObjectPathInput<T>>(
  object: T,
  path: P,
  nextValue: IObjectPathWriteValue<T, P>
): T
```

An immutable path write: every `set()` that really changes a value returns a new root object and leaves the input unchanged. Only nodes on the path are shallow-copied (structural sharing: untouched sibling nodes keep the same reference). "Immutable" describes how the update happens; it does not mean the result was deep-copied or frozen, and the returned object can still be modified. Missing containers on the way are created from the type of the next key (a number key creates `[]`, anything else `{}`). If the path runs into a non-empty primitive (a string, number and so on) that cannot be entered, it throws a `TypeError` with `code: 'OBJECT_PATH_INVALID'`. If the new value is `Object.is`-equal to the old one, no update happens and the original object is reused without copying.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const before = { user: { name: 'Ada', tags: ['a'] } }
const after = set(before, 'user.name', 'Grace')
after.user.name // 'Grace'
after !== before // true (an update returns a new root)
after.user !== before.user // true (nodes on the updated path are copied)
after.user.tags === before.user.tags // true (untouched branches keep their reference)
before.user.name // 'Ada' (the original was not modified)
Object.isFrozen(after) // false (an immutable update is not a freeze)
```

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IPathGetEvent<T, P extends IObjectPathInput<T> = IObjectPathInput<T>> = {
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly probe: IPathValueProbe<T, P>
  readonly value: IObjectPathValue<T, P>
  replace(value: IObjectPathValue<T, P>): void
}
type IPathSetEvent<T, P extends IObjectPathInput<T> = IObjectPathInput<T>> = {
  readonly originKey: P
  readonly segments: IObjectPathTuple
  readonly probe: IPathValueProbe<T, P>
  readonly value: IObjectPathWriteValue<T, P>
  replace(value: IObjectPathWriteValue<T, P>): void
}
type IPathAccessorOptions<T> = {
  readonly ifMissing?: (probe: IPathMissingProbe) => void
  readonly ifBlocked?: (probe: IPathBlockedProbe) => void
  readonly ifFailed?: (probe: IPathFailedProbe) => void
  readonly onGet?: (event: IPathGetEvent<T>) => void
  readonly onSet?: (event: IPathSetEvent<T>) => void
}
type IPathAccessor<T> = {
  readonly value: T
  get<P extends IObjectPathInput<T>>(path: P): IObjectPathValue<T, P> | undefined
  set<P extends IObjectPathInput<T>>(path: P, value: IObjectPathWriteValue<T, P>): T
  probeValue<P extends IObjectPathInput<T>>(path: P): IPathProbe<T, P>
  parsePath(path: string | IObjectPathTuple): IObjectPathTuple
}
function createPathAccessor<T>(object: T, options?: IPathAccessorOptions<T>): IPathAccessor<T>
```

Wraps a stateful accessor that **holds the current root internally**: after each successful `set()`, `accessor.value` moves to the new root, and later `get` / `set` calls work on the latest root. `ifMissing` / `ifBlocked` / `ifFailed` are called when the matching probe result occurs, as central diagnostic hooks.

`onGet` / `onSet` are called on every successful read / write. Event fields: `originKey` (the path as passed), `segments` (the parsed tuple), `probe` (the `IPathValueProbe` this read / write hit, i.e. the successful probe), `value` (the value actually read / about to be written) and `replace(value)`, which changes the returned value or the written value of this read / write in place, for example to fill defaults or validate and convert before writing. `IPathGetEvent` and `IPathSetEvent` differ only in the type of `value` / `replace`: reads use `IObjectPathValue` (the type read), writes use `IObjectPathWriteValue` (the widened writable type).

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const accessor = createPathAccessor(
  { count: 0 },
  { onSet: (event) => console.log('write', event.originKey, event.value) }
)
accessor.set('count', 5) // prints write count 5
accessor.value // { count: 5 }
```

The matching type tools, which give callers path completion and value types at compile time: `IObjectPathSegment`, `IObjectPathTuple`, `IObjectPath<T>` (string paths, at most 8 levels deep), `IObjectPathTupleFor<T>` (tuple paths), `IObjectPathInput<T>` (the union of both), `IObjectPathValue<T, P>` (the type the path points to) and `IObjectPathWriteValue<T, P>` (the type accepted when writing; literal types are widened to their base type, for example a union of literals becomes `string` / `number` / `boolean` / `bigint`).

---

<a id="typing-module"></a>

## `/typing` module

`@migaia/utils/typing` (`src/typing.ts`) is a **type-only** entry: the file contains only `export type` and no runtime values, and the build output `dist/typing.js` has no executable code. It is **not re-exported from the root entry `@migaia/utils`**; you can only write `import type { ... } from '@migaia/utils/typing'`. This is deliberate: keeping the type entry apart from runtime entries means referring to these types never pulls runtime code in through module resolution.

It does two things:

1. **Re-exports** types defined elsewhere, giving cross-package type reuse one stable entry, so consumers do not have to remember whether a type lives in `/object` or `/promise`:
   - From `/object` (that is, `object-path.ts`): `IObjectPath`, `IObjectPathInput`, `IObjectPathSegment`, `IObjectPathTuple`, `IObjectPathTupleFor`, `IObjectPathValue`, `IObjectPathWriteValue`
   - From `/object` (that is, `object.ts`): `IProbePropertyResult`
   - From `/promise`: `IAbortSignal`, `IDeferred`

   These types mean exactly what their source modules define (two entries for the same type, not two separate definitions); see the [`/object` module](#object-module) and [`/promise` module](#promise-module) sections for full details.

2. **Adds** two type tools that `/object` does not provide, which turn a discriminated union into a map from discriminant value to the matching union branch:

```ts
/** Groups a union by one top-level discriminant field whose value is a PropertyKey. */
type IDiscriminatedByField<F extends PropertyKey, T extends Record<F, PropertyKey>> = {
  [K in T[F]]: Extract<T, Record<F, K>>
}
```

- Type parameter `F extends PropertyKey`: the discriminant field name (`string` / `number` / `symbol`).
- Type parameter `T extends Record<F, PropertyKey>`: the union itself. The constraint requires the `F` field of every member to be a `PropertyKey`; if a branch's field is an object or another non-`PropertyKey` type, `T` does not satisfy `Record<F, PropertyKey>` and compilation fails (a compile error, not a runtime one: the tool simply cannot be used).
- Result: a mapped type keyed by each literal value of `T[F]`, whose value is `Extract<T, Record<F, K>>`, the branch for that discriminant (several branches sharing a value stay a union).

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
/** Groups a union by a string or tuple object path, parsed exactly like IObjectPath in /object. */
type IDiscriminatedByPath<T, P extends IObjectPathInput<T>> = {
  [K in Extract<IObjectPathValue<T, P>, PropertyKey>]: IExtractDiscriminatedByPath<T, P, K>
}
```

- Type parameter `T`: the union itself.
- Type parameter `P extends IObjectPathInput<T>`: a string path (such as `'meta.category'`) or a tuple path (such as `readonly ['meta', 'category']`), written exactly as `get` / `set` in `/object` accept them.
- The path must resolve on **every branch** of the union, and the value must narrow to a `PropertyKey`. A branch where the path is missing or has the wrong type is excluded by a conditional type rather than raising a runtime error. This is purely type-level: when some branches lack the path or have a non-`PropertyKey` value, the result may be a map missing those branches, or even an empty object type, and the alias declaration is not guaranteed to fail compilation.
- Result: a map keyed by each literal discriminant the path resolves to, whose value is the matching branch (branches sharing a value become a union).

**Example** (from the package's own test `test/typing.test.ts`, checked with `expectTypeOf`):

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IEvent =
  | {
      readonly type: 'created'
      readonly meta: { readonly category: 'write' }
      readonly payload: { readonly userId: string }
    }
  | {
      readonly type: 'deleted'
      readonly meta: { readonly category: 'write' }
      readonly payload: { readonly reason: string }
    }
  | {
      readonly type: 'read'
      readonly meta: { readonly category: 'read' }
      readonly payload: { readonly cache: boolean }
    }

type IByType = IDiscriminatedByField<'type', IEvent>
// { created: Extract<IEvent, { type: 'created' }>; deleted: ...; read: ... }

type IByCategory = IDiscriminatedByPath<IEvent, 'meta.category'>
// { write: the union of the 'created' and 'deleted' branches; read: the 'read' branch }

type IByTupleCategory = IDiscriminatedByPath<IEvent, readonly ['meta', 'category']>
// identical to IByCategory: string paths and tuple paths are two spellings of the same parsing
```

**Type limits**: a path that exists on no branch violates the path constraint; a path missing on some branches, or resolving to a non-`PropertyKey`, may just produce an empty map.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
// @ts-expect-error no branch has this path, which violates the IObjectPathInput constraint
type IInvalid1 = IDiscriminatedByPath<IEvent, 'meta.unknown'>

type INotPropertyKey = { readonly discriminator: { readonly nested: true } }
// @ts-expect-error the discriminant is an object, not a PropertyKey, so it cannot key a mapped type
type IInvalid2 = IDiscriminatedByField<'discriminator', INotPropertyKey>
```

---

<a id="config-module"></a>

## `/config` module

Config objects with **ownership**: only objects accepted by `ownConfig` can go through `readonlyConfig` / `patchConfig` / `readConfigPath` / `combineConfig`. A runtime `WeakMap` of metadata, not a field that could be forged, marks "this is a config root managed by this package".

```ts
const ConfigProfile = { data: 'data', richRuntime: 'richRuntime' } as const
type IConfigProfile = 'data' | 'richRuntime'
```

`data` (the default) accepts only portable plain data: plain objects, arrays and built-ins such as `Date` / `RegExp` / `Map` / `Set`; **functions are rejected**. `richRuntime` also accepts functions and constructable classes (deep-copied together with their own properties and `prototype`), for configs that really need to carry callbacks or factories.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const CONFIG_DELETE: unique symbol
```

In a `patchConfig` / `combineConfig` patch, setting a key to this symbol means "delete this key" rather than "set it to `undefined`".

```ts doc-test=skip reason="Signature summary, not a runnable module"
function ownConfig<T extends IConfigRecord>(
  value: T,
  options?: { readonly profile?: IConfigProfile; readonly limits?: Partial<IConfigLimits> }
): IOwnedConfig<T>
```

Deep-copies `value` into an independent graph that this package's metadata marks as "owned". The root must be a plain object (not an array) without `symbol` keys. While copying:

- `Date` / `RegExp` / `Map` / `Set` are recognized and rebuilt as new instances (instead of being walked as plain objects);
- cycles keep the same graph shape through an internal `WeakMap` (no infinite recursion, and shared nodes stay shared);
- `__proto__` / `prototype` / `constructor` keys are always rejected;
- exceeding the depth / node / key limits in `limits` (below) throws a `RangeError` with `code: 'CONFIG_LIMIT_EXCEEDED'`.

If `value` is **already** the result of an earlier `ownConfig` with matching metadata (the same `profile` / `limits`), it is returned unchanged (idempotent); if the metadata differs (for example the same object passed with another `profile`), it throws a `TypeError` with `code: 'CONFIG_CONFLICT'`.

With the result in hand, the caller has three clear paths: keep using it internally as a stable config root; expose a readable but not writable recursive Proxy through `readonlyConfig()`; or derive the next owned config through `patchConfig()` or `combineConfig()`. Do not pass the original outside object to these APIs, and do not mistake "owned" for "frozen": the ownership guarantee comes from the independent graph and the internal registration, while runtime write protection comes separately from `readonlyConfig()`.

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IConfigLimits = {
  readonly maxDepth: number // default 256
  readonly maxNodes: number // default 100_000
  readonly maxKeys: number // default 1_000_000
  readonly maxPathLength: number // default 4096
  readonly maxSegmentLength: number // default 512
}
```

`limits` may not exceed the package defaults. `patchConfig` may only tighten the limits of its base; widening them throws `CONFIG_CONFLICT`. `combineConfig` takes the field-by-field minimum of all inputs and the requested limits, so a widening request is tightened automatically and does not throw `CONFIG_CONFLICT`.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function readonlyConfig<T extends IConfigRecord>(value: IOwnedConfig<T>): T
```

Returns a **cached read-only object** that intercepts changes with a `Proxy`; calling it again with the same input returns the same read-only object. Reads still go to the original config, and no second copy of the data is made. Every write (`set` / `defineProperty` / `deleteProperty` / `setPrototypeOf` / `preventExtensions`, and mutating methods on `Map` / `Set` / `Date` such as `.set()` / `.add()` / `.setFullYear()`) throws a `TypeError` with `code: 'CONFIG_READONLY'`. Nested objects, `Map`, `Set` and function fields get the same write protection. `value` must come from `ownConfig`, otherwise it throws `code: 'CONFIG_UNSUPPORTED'`.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function patchConfig<T extends IConfigRecord>(
  base: IOwnedConfig<T>,
  patch: IConfigPatch<T>,
  options?: {
    readonly profile?: IConfigProfile
    readonly limits?: Partial<IConfigLimits>
    readonly reuseUnchangedRoot?: boolean
  }
): IOwnedConfig<T>
```

A copy-on-write overlay at the **root**: each key in `patch` either gets a new value (deep-copied recursively and brought under ownership) or `CONFIG_DELETE`, which deletes it. Only nodes on changed paths are copied; untouched subtrees are shared by reference. With an empty `patch` and `reuseUnchangedRoot` (default `true`), `base` itself is returned without copying. `patch` must be a plain object without `symbol` keys or accessor properties, otherwise it throws `code: 'CONFIG_UNSUPPORTED'`; a key named `__proto__` / `prototype` / `constructor` throws `code: 'CONFIG_PATH_INVALID'`. **Note**: `patchConfig` applies the patch at the root only. To change a nested field, compute the new nested subtree in your code with `get` / `set` (`/object`) and put it into `patch` as a whole value.

```ts doc-test=skip reason="Signature summary, not a runnable module"
const base = ownConfig({ endpoint: '/v1', retries: 2, debug: true })
const next = patchConfig(base, { retries: 3, debug: CONFIG_DELETE })
next.retries // 3
'debug' in next // false
```

```ts doc-test=skip reason="Signature summary, not a runnable module"
function parseConfigPath(
  path: string,
  limits?: Pick<IConfigLimits, 'maxPathLength' | 'maxSegmentLength'>
): readonly string[]
```

Builds on `parseObjectPath` from `/object` and adds config-specific limits (customizable lengths, defaulting to the package defaults). Every segment becomes a string: numeric index shorthand is not treated specially in config paths.

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IConfigReadResult =
  { readonly kind: 'missing' } | { readonly kind: 'value'; readonly value: unknown }
function readConfigPath(
  config: IOwnedConfig<IConfigRecord>,
  path: string | readonly string[]
): IConfigReadResult
```

Reads one path inside a config and tells "the key does not exist" (`missing`) from "the value is `undefined`" (`value: undefined`). Object or function values are wrapped in the same read-only Proxy as `readonlyConfig`, so nested values read this way cannot be changed from outside either. `config` must come from `ownConfig`.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function combineConfig(
  sources: readonly IOwnedConfig<IConfigRecord>[],
  options?: {
    readonly profile?: IConfigProfile
    readonly limits?: Partial<IConfigLimits>
    readonly strategies?: Partial<IConfigMergeStrategies>
    readonly pathRules?: readonly IConfigPathRule[]
    readonly onConflict?: (context: IConfigConflictContext) => IConfigConflictDecision
  }
): IOwnedConfig<IConfigRecord>
```

Merges several owned config roots in the order of `sources` (later ones override earlier ones). With a single source and no merge options, that source is returned and its root identity is kept; every other case produces a new owned config. All sources must share one `profile`, otherwise it throws `code: 'CONFIG_CONFLICT'`.

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IConfigMergeStrategies = {
  readonly record: 'merge' | 'replace' // default 'merge': plain objects merge recursively; 'replace': overwrite as a whole
  readonly array: 'replace' | 'concat' | 'mergeByIndex' // default 'replace'
  readonly map: 'replace' | 'merge' // default 'replace'
  readonly set: 'replace' | 'union' // default 'replace'
  readonly undefined: 'ignore' | 'assign' // default 'ignore': an explicit undefined on the right does not override the left
}

type IConfigPathRule = {
  readonly prefix: readonly PropertyKey[]
  readonly strategies: Partial<IConfigMergeStrategies>
}

type IConfigConflictContext = {
  readonly path: readonly PropertyKey[]
  readonly left: unknown
  readonly right: unknown
}
type IConfigConflictDecision =
  | { readonly kind: 'left' }
  | { readonly kind: 'right' }
  | { readonly kind: 'delete' }
  | { readonly kind: 'value'; readonly value: unknown }
```

`strategies` are the global defaults; `pathRules` is a list of `{ prefix, strategies }` matched by `prefix` (a key path from the root) against the key path currently being merged. The rule with the longer (more specific) `prefix` wins, and a matching rule is merged with the global `strategies` (fields the rule declares override the global ones; fields it does not declare keep the global values).

Each `combineConfig` call reads every rule's `prefix` and `strategies` once and builds an index before merging sources. For equal prefixes, the first declaration in the input wins. Rule descriptions must remain stable: getters returning changing descriptions and rule mutations during a merge cannot influence later properties and are unsupported.

When a key exists on both sides and falls outside every automatic merge case (for example two primitive values that cannot be merged), and `onConflict` is given, it is called with an `IConfigConflictContext` (`path`: the full path of the key; `left`: the existing value; `right`: the new value). Its `IConfigConflictDecision` decides the result: `{ kind: 'left' }` keeps the left value, `{ kind: 'right' }` takes the right value, `{ kind: 'delete' }` deletes the key, and `{ kind: 'value', value }` uses a custom value. `onConflict` must return **synchronously**: returning a Promise throws `code: 'CONFIG_CONFLICT'`, and so does a return value that is not one of the four kinds. Without `onConflict`, the right side simply overrides the left (standard merge semantics). `right === CONFIG_DELETE` deletes the target key, which lets a merge strip a default written by an earlier source.

With concat or mergeByIndex, one combine operation uses private array accumulators. `onConflict` reads the current cumulative contents; a retained reference receives later merges. Callbacks only read the accumulated value and return a decision. Direct mutation of an accumulating array, including writes, deletion, length changes or freezing, is unsupported. Return `{ kind: 'value', value }` to replace a value. The implementation adds no runtime checks or rejection for direct mutation.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const defaults = ownConfig({
  retries: 1,
  tags: ['default'],
  transport: { timeoutMs: 1_000, keepAlive: true }
})
const override = ownConfig({
  retries: 3,
  tags: ['custom'],
  transport: { timeoutMs: 2_500 }
})

const merged = combineConfig([defaults, override], {
  strategies: { record: 'merge', array: 'concat' }
})

// merged is a new config; neither defaults nor override is modified.
merged
// {
//   retries: 3,
//   tags: ['default', 'custom'],
//   transport: { timeoutMs: 2500, keepAlive: true },
// }

// This diff only spells out what changed; it is not an extra return value of combineConfig.
const diff = {
  retries: { before: defaults.retries, after: merged.retries },
  tags: { before: defaults.tags, after: merged.tags },
  timeoutMs: { before: defaults.transport.timeoutMs, after: merged.transport.timeoutMs }
}
```

---

### `ConfigOwner`

`ConfigOwner` holds an immutable configuration snapshot and exposes typed reads, copy-on-write updates, validation, watchers, `diff(other)` and `equals(other)` through `@migaia/utils/config`.

Comparison visits own string keys depth first: left-side keys first, followed by keys found only on the right. Each object pair is compared once. Shared branches report a difference only at the first path that reaches it, rather than once for every alias. Cycles with no data differences compare equal. Path watchers use the same data comparison; listener order, unsubscribe behavior and error reporting stay unchanged.

```ts doc-test=check
import { ConfigOwner } from '@migaia/utils/config'

/** Each snapshot retains two aliases of its shared branch. */
const before = { value: 1 }
/** The new snapshot changes the same shared branch. */
const after = { value: 2 }
/** The first alias supplies the one reported difference path. */
const config = new ConfigOwner({ first: before, second: before })
config.diff({ first: after, second: after })
// [{ path: ['first', 'value'], kind: 'changed' }]
```

<a id="function-module"></a>

## `/function` module

```ts doc-test=skip reason="Signature summary, not a runnable module"
const noop: () => undefined
```

An empty function that always returns `undefined`, used as a default callback.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function once<T extends (...args: never[]) => unknown>(functionValue: T): T
```

Memoizes a **synchronous** function: it really runs only on the first call, and later calls return the first result directly (or rethrow the first exception; exceptions are cached too, so the body does not run again on the second call). If the wrapped function is called again **while the first call is still running** (the body calls the wrapped function itself), it throws a `TypeError` with `code: 'REENTRANT_CALL'`, which stops accidental recursion from bypassing the cache.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
// runtime.ts: the module creates and exports exactly one wrapped function.
export const getRuntime = once(() => {
  const registry = buildCommandRegistry()
  return { registry, startedAt: Date.now() }
})

const first = getRuntime() // creates the registry
const second = getRuntime() // returns first directly
first === second // true
```

It suits expensive, deterministic synchronous initialization inside a module, such as building a read-only registry, compiling a schema or detecting a runtime capability once. The first exception is cached forever, so do not use it when you need retry, reset, hot reload or per-request isolation.

Be precise about its scope: every call to `once(fn)` creates a new wrapper with its own cache. Creating and exporting a single wrapper at module top level gives "one per module instance"; but duplicate bundles, iframes, Workers and Node `vm` have separate module instances, so it is not a cross-realm global singleton. When something really must be shared across a realm or process, let the application entry or a dependency-injection container hold the instance; if you must use a global table, you can use `globalThis[Symbol.for('your-app/runtime')]` and handle version conflicts, lifecycle and test cleanup yourself.

A `Proxy` can turn the first property access into lazy initialization or restrict access, but it provides no uniqueness by itself. Whether something is a singleton still depends on where the instance behind the Proxy is stored and how many owners it has, so there is no need to wrap the result of `once` in a Proxy to get a "real singleton".

```ts doc-test=skip reason="Signature summary, not a runnable module"
function onceAsync<T>(functionValue: () => PromiseLike<T>): () => Promise<T>
```

Memoizes one **asynchronous** call: the first call starts `functionValue()`, and the wrapper keeps and returns that same Promise; every later call, whether the Promise is pending, fulfilled or rejected, gets this Promise. `functionValue()` may return a native `Promise` or a valid PromiseLike; any other value makes the shared Promise reject with a `TypeError` carrying `code: 'INVALID_ARGUMENT'`.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
// app-config.ts: routing and telemetry both read the startup config, but the request may run only once.
export const loadAppConfig = onceAsync(async () => {
  const response = await fetch('/config')
  if (!response.ok) throw new Error(`config request failed: ${response.status}`)
  return response.json() as Promise<{ apiBaseUrl: string }>
})

const [routerConfig, telemetryConfig] = await Promise.all([loadAppConfig(), loadAppConfig()]) // both share one request
```

It suits async initialization that should run only once in the life of a page or process, such as loading a startup config that never refreshes, initializing a shared SDK client, or importing and compiling the same WASM module. It solves both "do not start twice under concurrency" and "keep reusing the result afterwards".

It does not suit per-key deduplication, periodic refresh, retry after failure, rebuilding after logout, or isolation per tenant or request. The first rejection is cached forever and there is no reset. If the underlying task uses one caller's `AbortSignal`, that caller cancelling the task also affects every waiter on the shared Promise. Use a cache or lifecycle container with an invalidation policy for those needs.

Every call to `onceAsync(fn)` creates its own cache; modules instantiated more than once, or code spread across iframes, Workers or Node `vm`, do not share it, so it is not a cross-realm global task coordinator either.

---

<a id="collector"></a>

## Collector

The Collector is a lazy, array-only query pipeline from the package root entry:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
// Internal composition type, not exported; import ICollector or IFieldCollector instead.
type ICollectorActions<T, Self> = {
  readonly result: readonly T[]
  fieldBy<const P extends readonly [IObjectPathInput<T>, ...IObjectPathInput<T>[]]>(
    ...paths: P
  ): IFieldCollector<T, P[number]>
  where(predicate: (source: T) => boolean): Self
  distinctBy<P extends IObjectPathInput<T>>(path: P): Self
  skip(count: number): Self
  take(count: number): Self
}

interface ICollector<T> extends ICollectorActions<T, ICollector<T>> {}

interface IFieldCollector<T, P extends IObjectPathInput<T>> extends ICollectorActions<
  T,
  IFieldCollector<T, P>
> {
  like(query: string): IFieldCollector<T, P>
  equals(value: IObjectPathValue<T, P>): IFieldCollector<T, P>
  oneOf(value: IObjectPathValue<T, P>, ...values: IObjectPathValue<T, P>[]): IFieldCollector<T, P>
}

function collect<T>(dataSource: readonly T[]): ICollector<T>
```

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const collector = collect(users)
  .fieldBy('profile.name-zh', 'profile.name-en')
  .like(' World ')
  .distinctBy('id')
  .skip(10)
  .take(20)

const result = collector.result
```

Evaluation and caching:

- `collect` borrows the original `readonly` array without copying it; with no actions, or when every source passes, `result` reuses the original array.
- Each action is written into an ordered pipeline right away but does not scan the source; the first read of `result` walks the source once and caches it. Repeated reads at the same revision return the same reference; adding an effective action invalidates the cache.
- Action order is observable: `take(2).where(predicate)` is not the same as `where(predicate).take(2)`. Chained calls create no intermediate arrays per step.
- Failed evaluations are not cached; errors thrown by getters, Proxy objects and `where` keep their original identity. Reading or changing the same collector again from inside an evaluation callback throws `REENTRANT_CALL`.

Field actions:

- `fieldBy` parses its paths immediately and adds a filter "at least one field value is not `undefined`"; missing, blocked and explicit `undefined` all count as no value. Calling it again keeps the earlier filter and replaces the active field set for the field predicates that follow.
- `like` runs `trim().toLowerCase()` on the query; an empty query after trimming does nothing. It matches only string fields, as a case-insensitive contiguous substring, and several fields combine with OR.
- `equals` and `oneOf` use `Object.is`; several fields combine with OR, and several actions combine in order with AND. `oneOf` always scans its candidates linearly and never upgrades to an index, whatever the data size.
- `distinctBy` deduplicates only defined keys and keeps the first occurrence; missing, blocked and explicit `undefined` values take no part in deduplication.
- `where` receives only the source item, no index. `skip` / `take` accept only non-negative safe integers and otherwise throw a native `RangeError` with `INVALID_ARGUMENT`.

The caller keeps the input array and nested sources read-only. The Collector does not watch outside changes; after data is changed behind the type system, a cached revision does not invalidate itself.

---

<a id="combined-workflow-examples"></a>

## Combined workflow examples: deadline + config

> This combination is for verification in this repository's tests, not an example of production code. Outside tests should prefer their test framework's fake timers.

```ts
import { retry, withTimeout } from '@migaia/utils/promise'
import { createManualScheduler } from '@migaia/utils/testing'
import { CONFIG_DELETE, ownConfig, patchConfig, readonlyConfig } from '@migaia/utils/config'

const scheduler = createManualScheduler()
const initial = ownConfig({ endpoint: '/v1', retries: 2, debug: true })
const next = patchConfig(initial, { debug: CONFIG_DELETE })
const publicConfig = readonlyConfig(next)

const request = withTimeout(
  ({ signal }) =>
    retry(
      async () => {
        if (signal.aborted) throw signal.reason
        return publicConfig.endpoint
      },
      { maxAttempts: publicConfig.retries, shouldRetry: () => true, scheduler }
    ),
  { timeoutMs: 100, scheduler }
)

scheduler.advance(100)
await request.catch(() => undefined)
```

`createManualScheduler()` makes time deterministic, so unit tests can assert timeout and retry behavior precisely. Timeout cancellation is cooperative: `retry` and application code must read the `signal` they are given to stop early. `ownConfig` copies and registers its input; `readonlyConfig` returns a cached object that can be read but not changed; `patchConfig` returns a new managed config, and `CONFIG_DELETE` only works in root-level patches.

### Concurrency limit + retry + combined errors: fetch a batch and tolerate partial failure

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
import { createConcurrencyLimiter, retry } from '@migaia/utils/promise'
import { combineErrors } from '@migaia/utils/error'

const limiter = createConcurrencyLimiter({ concurrency: 4 })
const outcomes = await Promise.allSettled(
  urls.map((url) =>
    limiter.run(() =>
      retry(({ signal }) => fetch(url, { signal }).then((r) => r.json()), {
        maxAttempts: 3,
        shouldRetry: () => true
      })
    )
  )
)
await limiter.dispose()

const failed = combineErrors(
  outcomes.filter((o) => o.status === 'rejected').map((o) => (o as PromiseRejectedResult).reason),
  'some URLs failed'
)
if (failed) throw failed
```

`combineErrors` returns `undefined` when nothing failed, the failure itself when exactly one failed, and an `AggregateError` when several failed.

### Object paths + config: write a changed nested structure back to the config root

```ts
import { get, set } from '@migaia/utils/object'
import { ownConfig, patchConfig } from '@migaia/utils/config'

const config = ownConfig({ server: { host: 'localhost', port: 8080 } })
// patchConfig works only at the root: compute the new subtree with set() first, then patch it in as a whole
const nextServer = set(get(config, 'server')!, 'port', 9090)
const next = patchConfig(config, { server: nextServer })
```

### One-time initialization + error identity: give an initialization failure a recognizable code

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
import { once } from '@migaia/utils/function'
import { attachErrorIdentity } from '@migaia/utils/error'

const initOnce = once(() => {
  try {
    return dangerousInit()
  } catch (error) {
    throw attachErrorIdentity(error as Error, { source: 'my-package', code: 'INIT_FAILED' })
  }
})
```

`once` remembers the first thrown error; every later call throws that same error object and does not initialize again.

---

## Identify the server runtime

```ts doc-test=run
import { detectServerRuntime } from '@migaia/utils'

console.log(detectServerRuntime()) // 'node' in Node
```

`detectServerRuntime(): 'deno' | 'bun' | 'node' | undefined` checks `globalThis.Deno`, then `process.versions.bun`, then `process.versions.node`. Node compatibility globals in Deno and Bun do not take precedence. Browsers return `undefined`. The function imports no filesystem or other host APIs; native adapters use its result to load only their runtime module.

## `/value`, `/string` and `/number` everyday tools

`jitter(value, ratio, random = Math.random)` is exported from `@migaia/utils/number` and the root entry. It returns a value in `[value * (1 - ratio), value]`, only shortening the deadline. `value` must be finite and non-negative; `ratio` and the random result must be in the inclusive interval `[0, 1]`. Invalid inputs throw a `RangeError` carrying `@migaia/utils` / `INVALID_ARGUMENT`. A throwing random callback produces the same coded error with the original failure on `cause`. Each call with valid arguments draws exactly one sample, including when `value` or `ratio` is zero.

```ts doc-test=run
import { jitter } from '@migaia/utils/number'

console.log(jitter(60_000, 0.2, () => 0.5)) // 54000, never above the original 60000
```

`isSafeIntegerValue(value)` from `/value` accepts only finite safe-integer numbers and converts no strings, bigints or boxed numbers.

`tryString(value)` from `/string` passes strings through unchanged and runs native `String(value)` exactly once on anything else. It returns `{ threw: false, value: string }` or `{ threw: true, error: unknown }`; a failure keeps the exact thrown value, with no fallback, no reporter call and no new error. The caller decides at its own boundary whether to report, fall back or rethrow:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
import { tryString } from '@migaia/utils/string'

const converted = tryString(value)
if (converted.threw) throw converted.error
const text = converted.value
```

`isNullish` recognizes only `null | undefined`; `isBlankString` only strings that are empty after `trim`. `isEmptyValue` combines the two and also treats `NaN` as empty; `0`, `0n`, `false`, arrays and objects stay real values. `isPrimitive` covers all seven JavaScript primitive types without creating an extra type tag.

`format(source, values, options?)` replaces `{path}` in one linear scan; nested paths read only own properties, and missing values keep their placeholder by default. `options.placeholder` sets `{ open, close }`, `missing` can be `preserve | empty | throw`, and `nullish` can be `empty | stringify`. Doubling a delimiter character prints it literally.

`formatNumber`, `formatCurrency`, `formatPercent`, `formatInteger` and `formatCompactNumber` share one bounded cache of 64 `Intl.NumberFormat` instances. Hot loops such as tables, market data or inventory should use `createNumberFormatter(options)` so options are not parsed for every item. The caller explicitly owns every locale, currency, precision and rounding rule.

```ts
import { format, formatCurrency, isEmptyValue, isPrimitive } from '@migaia/utils'

isEmptyValue('  ') // true; 0, false and 0n are all false
isPrimitive(Symbol('id')) // true
format('Stock {stock}, amount {money}', { stock: 0, money: '$12.00' })
formatCurrency(1234.5, 'USD', {
  locales: 'en-US',
  format: { minimumFractionDigits: 2, maximumFractionDigits: 2 }
})
```

---

<a id="troubleshooting-and-build-gates"></a>

## Troubleshooting and build gates

- **A timeout did not interrupt the I/O**: expected. Cooperative cancellation requires the operation to read and act on the `signal` it was given; pass the `signal` down to the I/O (for example `fetch(url, { signal })`) so it honours the abort.
- **`base64ToBytes` rejected the input**: have the producer emit standard, padded RFC 4648 text; URL-safe (`-` / `_`) or unpadded variants are not accepted and must be converted to the standard form first.
- **Writing a read-only config throws**: deliberate; `readonlyConfig` exists to prevent accidental changes. To change it, call `patchConfig` on the original owned config instead of modifying the read-only object.
- **`once` reports a reentrancy error**: the body called the same wrapped function again before the first call returned. Move the recursive logic outside the wrapper, or let a plain function recurse on itself.
- **You need "current value subscription / replay" or a resource release lifecycle**: `@migaia/utils` provides no reactive state or resource ownership model; use a dedicated reactive or lifecycle package instead of looking for a substitute here.
- **`ownConfig` / `patchConfig` throw `CONFIG_LIMIT_EXCEEDED`**: the config graph exceeded the depth / node / key limits. Check for unexpected deep nesting or cyclic growth, and tighten `limits` or shrink the data if needed; the package defaults cannot be widened.

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

### Recognizing Error across realms

Import `isNativeErrorValue(value)` from `@migaia/utils/error` (or the root). It recognizes Error-family prototype chains, helping boundaries keep the original Error identity; it calls no methods on the input, and a proxy it cannot inspect returns false. It is only a diagnostic shape check and must not be used to authenticate untrusted input.

```ts
import { isNativeErrorValue } from '@migaia/utils/error'

const failure: unknown = new TypeError('invalid input')
if (isNativeErrorValue(failure)) console.log(failure.stack)
```

### `deferTask` and the scheduler's optional `defer`

An `IScheduler` may also provide `defer(callback): void` for jobs that should run "after the current call", which is different from cancellable timers. `deferTask(clock, callback)` uses the scheduler's `defer` when present and falls back to `schedule(callback, 0)` otherwise. The root entry and the `/scheduler` subpath export the same function. `systemScheduler`'s `defer` uses a native microtask and keeps microtask ordering; a custom scheduler decides its own timing. The caller owns any Promise the callback returns; an error thrown while registering keeps its identity. This API creates no new queue and returns no cancellation handle.

A callback or method that is not a function throws a native `TypeError` with `@migaia/utils` / `INVALID_ARGUMENT`; when reading the `defer` method itself fails, the original error is kept on `cause`. With the default `systemScheduler` and no `queueMicrotask` on the host it throws `ENV_UNSUPPORTED`; an explicitly passed manual or host clock does not need that global. Copying `systemScheduler` with spread syntax also copies its `defer`, so override `defer` too when you change how deferred jobs are delivered.

```ts
import { deferTask } from '@migaia/utils/scheduler'
import { createManualScheduler } from '@migaia/utils/testing'

const clock = createManualScheduler()
let delivered = false
deferTask(clock, () => {
  delivered = true
})
console.log(delivered) // false
clock.advance(0)
console.log(delivered) // true
```

A fatal UTF-8 decoding failure uses `INVALID_ENCODING` and names UTF-8 and the byte offset in its message; Base64 failures still name Base64.

<a id="public-entry-index"></a>

## Public entry index

The table lists every public name. See the module sections above for parameters, errors and lifecycle constraints; type tools are listed with their purpose too. The URL helpers only read structure and do not check whether a URL is valid or safe.

| Name | Entry | Purpose and constraints |
| --- | --- | --- |
| `CONFIG_DELETE` | `@migaia/utils/config` | Deletion marker for a root-level patch or a merge conflict decision; it does not apply recursively inside nested patches. |
| `ConfigProfile` | `@migaia/utils/config` | Constants for the two config input domains, `data` and `richRuntime`. |
| `IAbortOperation` | `@migaia/utils/promise` | Lazy operation that receives a signal created by this package and returns a value or PromiseLike. |
| `IAbortSignal` | `@migaia/utils/promise` | Structural signal with no DOM or Node dependency: `aborted`, `reason` and the abort listener methods. |
| `IAbortSignalAdmission` | `@migaia/utils/promise` | Result of one `admitAbortSignal` read of a signal shape; the caller keeps every error and abort policy. |
| `IAbortSignalRejection` | `@migaia/utils/promise` | Stable reasons for rejecting an untrusted abort-signal-shaped value without throwing. |
| `IAbortTimeoutSignal` | `@migaia/utils/promise` | Merged signal plus an idempotent `dispose`; `signal` may be `undefined` when there is neither an outside signal nor a time limit. |
| `IAbortTimeoutSignalOptions` | `@migaia/utils/promise` | Input options: outside `signal`, `timeoutMs`, `scheduler`, `timeoutReason` and `report`. |
| `IAsyncControls` | `@migaia/utils/promise` | Shared `signal` / `signals`, `scheduler` and `unref` options for async waits; `signal` and `signals` are mutually exclusive. |
| `ICollector` | `@migaia/utils` | A Collector before `fieldBy`; the field-based predicates become available only after `fieldBy`. |
| `IConcurrencyLimiter` | `@migaia/utils/promise` | First-in-first-out concurrency limiter: `run`, `close`, `whenIdle`, `dispose` and the running and queued counts. |
| `IConfigCombineOptions` | `@migaia/utils/config` | Combines owned configs by profile, limits, merge strategies, path rules and a conflict callback. |
| `IConfigConflictContext` | `@migaia/utils/config` | Path of the conflict plus the left and right values. |
| `IConfigConflictDecision` | `@migaia/utils/config` | Choose `left`, `right`, `delete` or a replacement value; the callback must return synchronously, never a thenable. |
| `IConfigLimits` | `@migaia/utils/config` | Limits on config depth, node count, key count, path length and segment length; they can only be tighter than the package limits. |
| `IConfigMergeStrategies` | `@migaia/utils/config` | Merge strategies for `record`, `array`, `map`, `set` and `undefined`. |
| `IConfigPatch` | `@migaia/utils/config` | Partial patch of root fields; `CONFIG_DELETE` removes that root field. |
| `IConfigPatchOptions` | `@migaia/utils/config` | The `ownConfig` profile / limits plus `reuseUnchangedRoot`, which decides whether an empty patch reuses the original root. |
| `IConfigPathRule` | `@migaia/utils/config` | Chooses local merge strategies by path prefix. |
| `IConfigProfile` | `@migaia/utils/config` | The `data` or `richRuntime` input domain; the latter allows functions inside config. |
| `IConfigReadResult` | `@migaia/utils/config` | Path read result that tells `missing` (no such key) from `value` (which may be `undefined`). |
| `IConfigRecord` | `@migaia/utils/config` | Config root object type with string keys. |
| `IDeadlineOnlyOperation` | `@migaia/utils/promise` | Operation `withTimeout` accepts when `cooperativeCancellation` may be `false`; it receives a never-aborting structural signal, not a host `AbortSignal`. |
| `IDeferred` | `@migaia/utils/promise` | A native Promise with its `resolve` / `reject`; the caller decides when it settles. |
| `IDiagnosticSnapshot` | `@migaia/utils/object` | Isolated `value` plus per-path `diagnostics`; do not assume every unsupported leaf was copied. |
| `IDiscriminatedByField` | `@migaia/utils/typing` | Groups a discriminated union by one top-level field whose values are property keys. |
| `IDiscriminatedByPath` | `@migaia/utils/typing` | Groups a discriminated union by a typed string or tuple object path. |
| `IErrorChainData` | `@migaia/utils/error` | Plain, finite JSON data that the error-chain boundary and structured clone both accept. |
| `IErrorChainStrategy` | `@migaia/utils/error` | Error-chain serialization policy: fields, privacy, budgets, portable data and native restoration. |
| `IErrorIdentity` | `@migaia/utils/error` | The `source` / `code` pair, optionally with `phase` and `detail`; each package defines what they mean. |
| `IErrorIdentityHooks` | `@migaia/utils/error` | Optional recovery when identity fields conflict or cannot be written; the original error must stay reachable. |
| `IFieldCollector` | `@migaia/utils` | A Collector after `fieldBy`; value types are inferred from the latest `fieldBy`. |
| `IFormatOptions` | `@migaia/utils/string` | Template formatting policy; by default missing placeholders are kept and `null` / `undefined` print as empty. |
| `IFormatPlaceholder` | `@migaia/utils/string` | Placeholder delimiters used by the linear template scanner. |
| `IManualScheduler` | `@migaia/utils/testing` | Virtual clock for tests with `advance` and `pendingCount`; import it only from `/testing`. |
| `INativeAbortSignal` | `@migaia/utils/promise` | Type of the signal this package creates with a real `AbortController` and hands to operations; with host types it is `AbortSignal`, so it can go straight to `fetch`. |
| `INumberFormatOptions` | `@migaia/utils/number` | Locale and `Intl` options shared by every number formatter. |
| `INumberFormatter` | `@migaia/utils/number` | Reusable formatter for hot loops such as inventory tables and market data. |
| `INumericValue` | `@migaia/utils/number` | Numeric values the formatters accept: `number` or `bigint`, never strings. |
| `IObjectPath` | `@migaia/utils/object` | Typed dot / bracket string paths, at most eight levels deep to bound compiler work. |
| `IObjectPathInput` | `@migaia/utils/object` | Every statically valid string path and tuple path for one root type. |
| `IObjectPathSegment` | `@migaia/utils/object` | String, number or symbol key in a path tuple. |
| `IObjectPathTuple` | `@migaia/utils/object` | Read-only array of string, number or symbol path segments. |
| `IObjectPathTupleFor` | `@migaia/utils/object` | Typed read-only tuple paths, including number indexes and symbol keys. |
| `IObjectPathValue` | `@migaia/utils/object` | Value type that a string or tuple path points to. |
| `IObjectPathWriteValue` | `@migaia/utils/object` | Type accepted when writing to the path; literal types widen to their base type. |
| `IOwnConfigOptions` | `@migaia/utils/config` | Chooses the `data` / `richRuntime` profile and tightens the config limits. |
| `IOwnDescriptorsSnapshot` | `@migaia/utils/object` | Result of one non-throwing capture of own property descriptors at an object boundary. |
| `IOwnedConfig` | `@migaia/utils/config` | Config type accepted and registered by `ownConfig`; a forged object that only carries the type brand is not accepted at runtime. |
| `IPathAccessor` | `@migaia/utils/object` | Holds the current immutable root and offers `get` / `set`, `probeValue` and `parsePath`. |
| `IPathAccessorOptions` | `@migaia/utils/object` | Callbacks for missing, blocked and failed paths, plus read and write transforms. |
| `IPathBlockedProbe` | `@migaia/utils/object` | The path is blocked by a non-object value; records the failing segment and `parent`. |
| `IPathFailedProbe` | `@migaia/utils/object` | Reading a member threw; keeps the original `error` and where it failed. |
| `IPathGetEvent` | `@migaia/utils/object` | Read transform event: original path, parsed segments, probe result and `replace`. |
| `IPathMissingProbe` | `@migaia/utils/object` | A member on the path is missing; records the failing segment and the resolved prefix. |
| `IPathProbe` | `@migaia/utils/object` | Path probe result: `value` / `missing` / `blocked` / `failed`. |
| `IPathSetEvent` | `@migaia/utils/object` | Write transform event: the value about to be written, a probe result and `replace`. |
| `IPathValueProbe` | `@migaia/utils/object` | Successful read: path, segments and the value typed by the path. |
| `IPrimitive` | `@migaia/utils/value` | `string`, `number`, `boolean`, `bigint`, `symbol`, `null` or `undefined`. |
| `IProbePropertyResult` | `@migaia/utils/object` | Property `missing` / `value` / `failed` result; `has` / `get` trap failures come back as data. |
| `IPropertyRead` | `@migaia/utils/error` | Result of one property read; a throwing getter keeps its exact thrown value. |
| `IRetryContext` | `@migaia/utils/promise` | Current `attempt`, the native `signal` of that attempt and the optional `remainingMs`. |
| `IRetryFailureContext` | `@migaia/utils/promise` | Context passed to `shouldRetry` / `delay`, adding `maxAttempts`; `remainingMs` is not guaranteed. |
| `IScheduledTask` | `@migaia/utils/scheduler` | Handle of one scheduled callback: `cancel()` and an optional `unref()`. |
| `IScheduler` | `@migaia/utils/scheduler` | The only scheduler contract: a monotonic `now()`, `schedule()` and an optional `defer()`. |
| `ISerializedErrorChain` | `@migaia/utils/error` | Frozen error tree; extension fields are kept only when the caller policy allows them. |
| `ISnapshotDiagnostic` | `@migaia/utils/object` | Path, reason and original `cause` of an accessor, failed read or unsupported member in a snapshot. |
| `IStringConversion` | `@migaia/utils/string` | Result of one string conversion; failures keep the exact value thrown by user coercion. |
| `IThenableInspection` | `@migaia/utils/function` | Captured result of one `then` read; plain values give an empty object, failed reads keep `error`. |
| `IThenableProbe` | `@migaia/utils/function` | Result of one thenable check; a failed read does not throw. |
| `ITimeoutOperation` | `@migaia/utils/promise` | Time-limited operation that receives a native signal from this package and returns a value or PromiseLike. |
| `IUrlLike` | `@migaia/utils/typing` | A URL given as text or as any object with an `href`, such as a WHATWG `URL`. |
| `IUtilsErrorCode` | `@migaia/utils/error` | Union of the `UtilsErrorCode` values, not an arbitrary string. |
| `IUtilsReporter` | `@migaia/utils/promise` | Diagnostic callback for late rejections, cleanup failures and reporter failures; `operation` names the source. |
| `IWallClock` | `@migaia/utils/scheduler` | Wall clock for diagnostic timestamps only. |
| `MAX_NATIVE_RECURSION_DEPTH` | `@migaia/utils/function` | Maximum synchronous reentrancy before callers move work off the native stack. |
| `ThenableProbeKind` | `@migaia/utils/function` | Stable outcomes of one `.then` read. |
| `UtilsAbortError` | `@migaia/utils/promise` | Error for cooperative cancellation, code `ABORTED`, with the original reason on `cause`. |
| `UtilsError` | `@migaia/utils/error` | Base class of this package's semantic errors, with `source: 'foundation.utils'` and a stable `code`. |
| `UtilsErrorCode` | `@migaia/utils/error` | Stable error codes this package emits. |
| `UtilsTimeoutError` | `@migaia/utils/error` | Error for an operation, attempt or total deadline, code `DEADLINE_EXCEEDED`. |
| `admitAbortSignal` | `@migaia/utils/promise` | Admits an abort-signal shape with one `aborted` read, without reading `reason` or subscribing. |
| `assimilateCapturedThen` | `@migaia/utils/function` | Calls an already-captured `then` method once with its original thenable as receiver. |
| `attachErrorIdentity` | `@migaia/utils/error` | Attaches stable identity fields to the original error without replacing it. |
| `attachSecondaryErrors` | `@migaia/utils/error` | Appends secondary failures to a primary error without changing its identity. |
| `base64ToBytes` | `@migaia/utils/bytes` | Decodes canonical RFC 4648 Base64; non-canonical input throws `INVALID_ENCODING`. |
| `bytesToBase64` | `@migaia/utils/bytes` | Encodes bytes as padded Base64 with the standard RFC 4648 alphabet. |
| `collect` | `@migaia/utils` | Creates a lazy Collector over a borrowed read-only array. |
| `combineConfig` | `@migaia/utils/config` | Combines owned configs in source order, resolving conflicts by explicit policy. |
| `combineErrors` | `@migaia/utils/error` | Combines zero, one or many errors, keeping a failure of the iteration itself as well. |
| `createAbortTimeoutSignal` | `@migaia/utils/promise` | Merges an outside cancellation and a time limit into one signal without settling any Promise. |
| `createConcurrencyLimiter` | `@migaia/utils/promise` | Caps running tasks with first-in-first-out queuing; queued tasks can be cancelled. |
| `createManualScheduler` | `@migaia/utils/testing` | Creates a virtual-clock scheduler starting at `0` for deterministic tests. |
| `createNumberFormatter` | `@migaia/utils/number` | Creates a reusable formatter so hot loops parse options only once. |
| `createPathAccessor` | `@migaia/utils/object` | Creates a path accessor whose current root advances after each successful `set`. |
| `createSafeRecord` | `@migaia/utils/object` | Creates a new null-prototype dictionary whose untrusted keys cannot trigger prototype setters. |
| `decodeUtf8` | `@migaia/utils/bytes` | Decodes UTF-8; invalid bytes become U+FFFD by default, or throw with `fatal: true`. |
| `deferTask` | `@migaia/utils/scheduler` | Schedules one job to run after the current call through a scheduler. |
| `deferred` | `@migaia/utils/promise` | Creates a native Promise you settle from outside; prefer `Promise.withResolvers()` in new code. |
| `deserializeErrorChain` | `@migaia/utils/error` | Validates an untrusted error tree in full, then rebuilds the native error graph. |
| `detectServerRuntime` | `@migaia/utils` | Identifies Deno before Bun before Node; browsers without server globals return `undefined`. |
| `diagnosticSnapshot` | `@migaia/utils/object` | Copies a value as far as possible and returns explicit diagnostics. |
| `encodeUtf8` | `@migaia/utils/bytes` | Encodes a string into a new UTF-8 byte array. |
| `format` | `@migaia/utils/string` | Replaces placeholder paths in a template in one linear scan. |
| `formatCompactNumber` | `@migaia/utils/number` | Formats large values in compact notation with caller-chosen precision. |
| `formatCurrency` | `@migaia/utils/number` | Formats money; the caller chooses currency and rounding. |
| `formatInteger` | `@migaia/utils/number` | Formats whole numbers such as stock counts; the fraction policy can be overridden. |
| `formatNumber` | `@migaia/utils/number` | Formats a `number` or `bigint` with explicit `Intl` options, reusing a cached formatter. |
| `formatPercent` | `@migaia/utils/number` | Formats a ratio as a percentage with configurable precision. |
| `get` | `@migaia/utils/object` | Reads a path; a missing or blocked path gives `undefined`, while a throwing getter still throws. |
| `hostRethrowReporter` | `@migaia/utils/promise` | Default reporter: rethrows the error to the host in a microtask instead of creating an unhandled rejection. |
| `identitySnapshot` | `@migaia/utils/object` | Returns the input unchanged, making the choice to share the reference explicit. |
| `immutableSnapshot` | `@migaia/utils/object` | Uses `structuredClone` to make a data snapshot that shares no references with the source. |
| `inspectThenable` | `@migaia/utils/function` | Reads a callback result's `then` once to enforce a synchronous contract. |
| `isArrayBuffer` | `@migaia/utils/bytes` | Recognizes a real `ArrayBuffer` across realms, detached ones included, and rejects `SharedArrayBuffer`, proxies and imitations. |
| `isBlankString` | `@migaia/utils/value` | Detects empty or whitespace-only strings without coercing other types. |
| `isEmptyValue` | `@migaia/utils/value` | Detects form-style emptiness: `null`, `undefined`, blank strings and `NaN`; `0`, `0n` and `false` are real values. |
| `isNativeErrorValue` | `@migaia/utils/error` | Recognizes native Error-family prototype chains across realms to preserve the original error; diagnostic only, not authentication. |
| `isNullish` | `@migaia/utils/value` | Narrows only `null` and `undefined`; other falsy values are not treated as missing. |
| `isPlainObject` | `@migaia/utils/object` | Accepts only ordinary objects or null-prototype objects, never arrays. |
| `isPrimitive` | `@migaia/utils/value` | Narrows every JavaScript primitive type. |
| `isSafeIntegerValue` | `@migaia/utils/value` | Accepts only finite safe-integer `number` values without converting strings or boxed numbers. |
| `isUint8Array` | `@migaia/utils/bytes` | Recognizes a real `Uint8Array` and its subclasses across realms without trusting mutable prototypes, constructor names or `Symbol.toStringTag`. |
| `isUrlObject` | `@migaia/utils` | True for the object form of `IUrlLike`: a non-null object whose `href` is a string. |
| `isUtilsAbortError` | `@migaia/utils/error` | Checks this package's error shape and identity, then that the code is `ABORTED`. |
| `isUtilsError` | `@migaia/utils/error` | Recognizes this package's error shape only when both identity fields are valid. |
| `isUtilsTimeoutError` | `@migaia/utils/error` | Checks this package's error shape and identity, then that the code is `DEADLINE_EXCEEDED`. |
| `jitter` | `@migaia/utils/number` | Shortens a finite non-negative value into `[value * (1 - ratio), value]`; invalid inputs use `INVALID_ARGUMENT`. |
| `noop` | `@migaia/utils/function` | Empty function that always returns `undefined`, used as a default callback. |
| `normalizeSerializedErrorChain` | `@migaia/utils/error` | Validates and freezes a fresh wire error tree before the receiver uses any field. |
| `observeThenableRejection` | `@migaia/utils/function` | Observes a captured thenable's rejection while isolating reporter failures at the boundary. |
| `once` | `@migaia/utils/function` | Remembers a synchronous function's first result, including a first thrown error. |
| `onceAsync` | `@migaia/utils/function` | Remembers the Promise of the first async call; later calls get that same Promise. |
| `ownConfig` | `@migaia/utils/config` | Validates and copies config into an independent copy with registered ownership. |
| `parseConfigPath` | `@migaia/utils/config` | Adds config length limits on top of object-path parsing and requires string segments. |
| `parseObjectPath` | `@migaia/utils/object` | Parses strict `a.b.[0].c` syntax or copies and freezes a tuple path. |
| `patchConfig` | `@migaia/utils/config` | Applies a copy-on-write overlay at the root and returns a new config. |
| `probeObjectPath` | `@migaia/utils/object` | Parses and probes one path in a single step. |
| `probeObjectPathSegments` | `@migaia/utils/object` | Probes an already parsed tuple path without parsing it again. |
| `probeProperty` | `@migaia/utils/object` | Reads one property exactly once and reports getter failures as an explicit result. |
| `probeThenable` | `@migaia/utils/function` | Reads `value.then` once and returns an explicit result kind. |
| `raceWithAbort` | `@migaia/utils/promise` | Races a lazy operation against one or more outside abort signals without a timer. |
| `reachErrorChain` | `@migaia/utils/error` | Walks `cause` and `AggregateError` children with identity deduplication, within the policy object budget. |
| `readConfigPath` | `@migaia/utils/config` | Reads a config path and tells a missing key from an `undefined` value. |
| `readUrlHref` | `@migaia/utils` | Returns the text form of a URL value: the string itself, or the object's `href`. |
| `readonlyConfig` | `@migaia/utils/config` | Returns a cached read-only view; every write throws `CONFIG_READONLY`. |
| `retry` | `@migaia/utils/promise` | Retries serially by `shouldRetry`, with backoff, a per-attempt limit and a total limit. |
| `safeErrorReason` | `@migaia/utils/error` | Reads any failure's diagnostic reason once, returning the caller's safe fallback if the read fails. |
| `sanitizeErrorText` | `@migaia/utils/error` | Replaces lone surrogates and keeps the longest UTF-8 prefix within the byte budget. |
| `serializeErrorChain` | `@migaia/utils/error` | Turns any thrown value into a bounded, frozen, language-neutral error tree. |
| `set` | `@migaia/utils/object` | Immutable path write: copies only objects on the path, reuses other branches and creates missing containers. |
| `sleep` | `@migaia/utils/promise` | Resolves after a delay; rejects with `UtilsAbortError` when the signal aborts. |
| `snapshotOwnDescriptors` | `@migaia/utils/object` | Reads own property descriptors at most once, containing revoked-proxy or descriptor-trap failures. |
| `splitUtf8` | `@migaia/utils/bytes` | Splits UTF-8 text by a byte limit without cutting any code point. |
| `streamBase64Chunks` | `@migaia/utils/bytes` | Yields independently valid Base64 chunks by `maxChunkBytes`; each width is a multiple of 3 within the limit. |
| `structuredDiagnosticSnapshot` | `@migaia/utils/object` | Tries `structuredClone` first and falls back to a best-effort snapshot with diagnostics. |
| `systemScheduler` | `@migaia/utils/scheduler` | Default scheduler: `performance.now()` as the monotonic clock and host `setTimeout` / `clearTimeout` as timers. |
| `systemWallClock` | `@migaia/utils/scheduler` | Default wall clock: `Date.now()` milliseconds, for diagnostic timestamps only. |
| `toError` | `@migaia/utils/error` | Turns any thrown value into an `Error`, keeping the original on `cause`. |
| `toPromise` | `@migaia/utils/promise` | Runs a synchronous computation immediately and turns its value or thrown error into a Promise. |
| `tryReadProperty` | `@migaia/utils/error` | Reads one property with the original receiver; a throwing getter's value comes back as data. |
| `tryString` | `@migaia/utils/string` | Converts a value once with native `String` rules; strings pass through unchanged. |
| `utf8ByteLength` | `@migaia/utils/bytes` | Counts UTF-8 bytes without allocating a buffer or iterator. |
| `walkErrorCauses` | `@migaia/utils/error` | Walks `cause` and `AggregateError.errors` with identity deduplication and a depth limit. |
| `withTimeout` | `@migaia/utils/promise` | Gives a lazy operation a deadline; at the deadline it aborts the operation's signal, then rejects with a timeout error. |

## Optional values

`IMaybe<T>` distinguishes `{ some: true, value: T }` from `{ some: false }`, including a present undefined. Root exports `isSome`/`isNone` for narrowing, `unwrapOr(m, fallback)` for a same-domain fallback, `mapMaybe(m, mapper)` for one synchronous mapping of a present value, and `toUndefined(m)` when collapsing absence is intentional. None is reused without calling the mapper; mapper results retain identity and are not awaited. Typed optional values receive no extra runtime validation.

Mapper failures retain existing coded errors. An uncoded mutable native Error receives utils INVALID_ARGUMENT on the same instance, preserving native type and stack. An identity conflict wraps the original on cause; failed identity attachment aggregates the original first and the attachment failure second. Non-Error values follow existing toError/NON_ERROR_VALUE semantics.

```ts
import { isSome, isNone, unwrapOr, mapMaybe, toUndefined, type IMaybe } from '@migaia/utils'
const present: IMaybe<number | undefined> = { some: true, value: undefined }
const missing: IMaybe<number> = { some: false }
const mapped = mapMaybe({ some: true, value: 3 }, (value) => value * 2)
console.log(isSome(present), isNone(missing))
console.log(unwrapOr(mapped, 0), toUndefined(missing))
// true true
// 6 undefined
```
| `detectServerRuntime` / `ServerRuntime`             | `@migaia/utils`           | Current Deno/Bun/Node classification and its constant/type domain.                                                                                                    |
| `detectElectronProcessType` / `ElectronProcessType` | `@migaia/utils`           | Current Electron main/renderer/utility role and its domain.                                                                                                           |
| `detectGlobalScope` / `GlobalScopeKind`             | `@migaia/utils`           | Actual browser global scope outside server runtimes and its domain.                                                                                                   |
