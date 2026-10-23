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
| Identify the server runtime running the program | `detectServerRuntime` | `@migaia/utils` |

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

### `/promise`: when work starts and when a Promise is shared

Prefer the native `Promise.withResolvers()` API when you need to settle a Promise from outside. `deferred()` serves older runtimes that lack it, or project boundaries already expressed through `IDeferred`.

```ts doc-test=check
const { promise, resolve } = Promise.withResolvers<number>()
resolve(42)
console.log(await promise) // 42
```

`toPromise(run)` calls `run` immediately in the current call stack and turns its return value or thrown error into a Promise result. If `run` returns a native Promise, the same Promise is returned.

`Promise.resolve().then(run)` waits until the next microtask and returns a new chained Promise. Use `toPromise` when synchronous side effects must happen before the call returns, and `.then(run)` to defer work deliberately; both express failures through rejection.

```ts doc-test=check
import { toPromise } from '@migaia/utils/promise'

/** An existing Promise makes identity preservation visible in both calling styles. */
const pending = Promise.resolve(42)
/** Its synchronous side effect must happen before this call returns. */
const immediate = toPromise(() => {
  console.log('now')
  return pending
})
/** Deliberately defers work, giving the caller a separate Promise chain. */
const later = Promise.resolve().then(() => {
  console.log('later')
  return pending
})
console.log(immediate === pending, later === pending) // true false
await later
// Prints now, true false, then later.
```

### `/scheduler`: elapsed time and calendar time use different clocks

`systemScheduler` uses `performance.now()`. Its millisecond `now()` readings never decrease: a later reading can equal an earlier one, but cannot be smaller. They are not Unix timestamps.

With an injected scheduler, calculate deadlines with `scheduler.now()` and schedule their tasks with the same `scheduler.schedule()` so that both use one time base.

`systemWallClock.timestamp()` returns `Date.now()` for dates in logs. Do not subtract it from `now()` or use it in deadline comparisons.

`createManualScheduler()` from `@migaia/utils/testing` is a virtual clock for this repository's tests, rather than an API for external application code. Other projects should prefer their test framework's fake timers; production code uses `systemScheduler` or an injected scheduler that satisfies the same contract.

### `/error`: use codes to decide how to handle a failure

An error's `source` identifies its owner, and `code` identifies the failure within that owner. These are the keys and values of `UtilsErrorCode`. Attaching a code preserves native types such as `TypeError` and `RangeError`; do not depend on message wording.

- `invalidArgument` / `INVALID_ARGUMENT`: an argument has the wrong type or range; correct it before calling again.
- `nonErrorValue` / `NON_ERROR_VALUE`: `toError()` wrapped a thrown value that was not an error; its original value is on `cause`.
- `envUnsupported` / `ENV_UNSUPPORTED`: a required host capability is missing; use a suitable host or inject an implementation.
- `aborted` / `ABORTED`: an operation observed cooperative cancellation; the original reason remains on the error chain.
- `deadlineExceeded` / `DEADLINE_EXCEEDED`: an operation, attempt or total deadline expired; inspect `scope` and `timeoutMs` before choosing whether to retry.
- `schedulerRunaway` / `SCHEDULER_RUNAWAY`: one virtual-clock advance ran more than 10000 callbacks; check for tasks that keep scheduling work at the same time.
- `errorIdentityConflict` / `ERROR_IDENTITY_CONFLICT`: incoming fields conflict with an existing identity; retain the original identity and choose a conflict policy explicitly.
- `errorChainInvalid` / `ERROR_CHAIN_INVALID`: a serialized error tree violates its field, depth, count or byte limits; correct the boundary input.
- `cloneUnsupported` / `CLONE_UNSUPPORTED`: structured cloning rejected the value; convert it to cloneable data first.
- `invalidEncoding` / `INVALID_ENCODING`: encoded bytes or text are malformed; use the reported position to correct the input.
- `limiterClosed` / `LIMITER_CLOSED`: a closed concurrency limiter cannot accept new tasks; create a new limiter.
- `reentrantCall` / `REENTRANT_CALL`: a non-reentrant operation was called again while it was running; move the nested call outside that execution.
- `configUnsupported` / `CONFIG_UNSUPPORTED`: a config root, field or value is outside the supported domain; supply data accepted by the selected profile.
- `configReadonly` / `CONFIG_READONLY`: a caller tried to modify read-only config; derive a new config through a patch or merge.
- `configConflict` / `CONFIG_CONFLICT`: config sources, profiles or ownership disagree; reconcile their constraints first.
- `configLimitExceeded` / `CONFIG_LIMIT_EXCEEDED`: the config graph exceeded a bound, or a limit option is invalid; reduce the input and check the limits.
- `configPathInvalid` / `CONFIG_PATH_INVALID`: a config path or key is malformed or unsafe; correct the path.
- `configParseFailed` / `CONFIG_PARSE_FAILED`: `ConfigOwner.from()` received a non-string or invalid JSON; the original parser error stays on `cause`.
- `configSourceFailed` / `CONFIG_SOURCE_FAILED`: a source supplied to `ConfigOwner.fromAsync()` failed; its rejection stays on `cause`, and the caller chooses whether to retry or use defaults.
- `configValueMissing` / `CONFIG_VALUE_MISSING`: `ConfigOwner.require()` found no value at the path; supply it or use `getOr()` with an explicit fallback.
- `configValidationFailed` / `CONFIG_VALIDATION_FAILED`: a validator rejected the next config; the previous one stays committed and the validator error stays on `cause`.
- `objectPathInvalid` / `OBJECT_PATH_INVALID`: an object path or one of its segments is invalid; correct the path input.
- `formatInvalid` / `FORMAT_INVALID`: template syntax or interpolation is invalid; check the template and its values.
- `formatValueMissing` / `FORMAT_VALUE_MISSING`: strict template formatting could not find a placeholder's value; supply that data.
- `numberFormatInvalid` / `NUMBER_FORMAT_INVALID`: `Intl.NumberFormat` rejected a locale, currency, option or number; correct the formatting arguments.

### `/bytes`: where bytes live and which part a view sees

An `ArrayBuffer` holds raw contiguous memory; it cannot be read or written by numeric index itself. A `Uint8Array` is a view of that memory as unsigned 8-bit integers, each from 0 to 255.

In `new Uint8Array(buffer, byteOffset, length)`, `byteOffset` selects the starting byte. This constructor does not copy the data, so several views can read and write the same underlying `ArrayBuffer`.

Use `slice()` for an independent copy and `subarray()` for a shared window. Writing through the window changes the original array; writing through the copy does not. `SharedArrayBuffer` shares memory across execution environments and has different concurrency semantics, so it is not an isolated copy of an ordinary buffer.

```ts doc-test=check
const buffer = new ArrayBuffer(4)
const bytes = new Uint8Array(buffer)
bytes[1] = 42
/** Borrows the second and third bytes so window writes reach the original storage. */
const shared = bytes.subarray(1, 3)
/** Retains the value before the window changes, to contrast copying with sharing. */
const copied = shared.slice()
shared[0] = 7
console.log(bytes[1], copied[0], shared.byteOffset) // 7 42 1
```

### `/object`: distinguish missing fields, failed reads and copying policies

The first argument to `probeProperty(value, key)` is the object to read. It can be a plain object, a class instance or another object with readable properties.

A missing field and a failed field read have separate outcomes: `missing` can use a business default, while `failed` requires handling the original error. The successful `value` branch consumes the value that was read. Checking the result does not require reading the field again, so a getter runs only once.

```ts doc-test=check
import { probeProperty } from '@migaia/utils/object'

/** The failed branch must report this original error rather than construct another. */
const profileUnavailable = new Error('profile unavailable')
/** Makes the getter's read side effect visible. */
let profileReads = 0
/** Supplies a readable field, a missing field and a throwing getter. */
const user = {
  name: 'Ada',
  get profile(): never {
    profileReads += 1
    throw profileUnavailable
  }
}

/** Reports the original failure; only a missing field uses the default label. */
function readLabel(value: object, key: PropertyKey): string {
  /** Branches on this retained outcome without reading the input field again. */
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

console.log(readLabel(user, 'name')) // Ada: consumes the successful value
console.log(readLabel(user, 'email')) // Anonymous: uses the missing-field default
console.log(readLabel(user, 'profile')) // Unavailable: reports the getter's original failure
console.log(profileReads) // 1: checking the result did not invoke the getter again
```

`immutableSnapshot(value)` calls the host's `globalThis.structuredClone()` without passing through a JSON string. It preserves cycles and shared references within the graph and supports native cloneable types such as `Date`, `Map`, `Set`, `ArrayBuffer` and TypedArray.

It does not preserve a custom class's prototype methods, getters/setters or property descriptors. No transfer list is supplied, so `ArrayBuffer` contents are copied and the source is not detached, the unusable state that follows an ownership transfer.

The function does not call `Object.freeze()`; the returned object remains mutable. Native `structuredClone(value)` works on the whole graph or fails: one unsupported member rejects the clone. `immutableSnapshot(value)` throws `ENV_UNSUPPORTED` when the host lacks the capability, or `CLONE_UNSUPPORTED` when the value cannot be cloned.

```ts doc-test=check
import { immutableSnapshot } from '@migaia/utils/object'

/** Both fields refer to one node so the example exposes alias preservation. */
const shared = { count: 1 }
const source = { primary: shared, alias: shared, createdAt: new Date('2026-01-01T00:00:00Z') }
/** Only the source changes later, exposing isolation and sharing within the copy. */
const copy = immutableSnapshot(source)
source.primary.count = 2
console.log(copy.primary.count) // 1: changing the source did not change the copy
console.log(copy.primary === copy.alias) // true: the shared reference within the graph survives
console.log(copy.createdAt instanceof Date, Object.isFrozen(copy)) // true false
```

`diagnosticSnapshot(value)` projects plain objects, arrays and cloneable built-in subtrees without first cloning the complete graph. Unsupported functions or instances keep their original references, and `diagnostics` records their locations and reasons.

`structuredDiagnosticSnapshot(value)` tries native `structuredClone` first; when cloning fails or the host lacks it, it falls back to that best-effort copy and retains diagnostics about the degradation. These policies suit logs and similar consumers that accept partial copies.

When `diagnostics` is nonempty, check which parts degraded; do not describe the result as a completely isolated snapshot.

```ts doc-test=check
import { diagnosticSnapshot } from '@migaia/utils/object'

/** An uncloneable leaf demonstrates the diagnostic policy's reference fallback. */
const callback = () => 'ready'
const { value, diagnostics } = diagnosticSnapshot({ label: 'job', callback })
console.log(value.callback === callback) // true: the unsupported function keeps its reference
console.log(diagnostics.length > 0) // true: the caller can detect this lack of isolation
```

`identitySnapshot` returns the original object; calling it alone has no runtime benefit. It is the zero-copy choice in a configurable snapshot policy, the function that decides how a retained value is copied. Choosing it accepts shared references.

Use it only inside a trusted process for objects whose identity matters, or which cannot be cloned, when shared ownership is acceptable. For isolating outside input, retaining historical state or crossing a boundary, choose `immutableSnapshot` and handle cloning failures.

```ts doc-test=check
import { identitySnapshot } from '@migaia/utils/object'

/** Settings that the application still modifies make shared ownership observable. */
const liveConfig = { retry: 2 }
/** This retention policy explicitly accepts the original reference and later changes. */
const snapshotPolicy = identitySnapshot
/** Retained for a later read that reveals the effects of shared references. */
const retained = snapshotPolicy(liveConfig)
liveConfig.retry = 3
console.log(retained.retry, retained === liveConfig) // 3 true: still the same object
```

For path updates, immutable describes how the update is made: `set()` neither deep-copies the whole tree nor calls `Object.freeze()`. An actual value change returns a new root. If `Object.is()` considers the old and new values equal, the original root is returned directly.

```ts doc-test=check
import { set } from '@migaia/utils/object'

/** Keeps the changed path and an untouched sibling in one input tree. */
const data = { user: { name: 'Ada' }, settings: { theme: 'dark' } }
/** Changes only user.name so branch identities reveal the extent of copying. */
const next = set(data, 'user.name', 'Grace')
console.log(next.user !== data.user) // true: objects along the path were shallow-copied
console.log(next.settings === data.settings) // true: the unchanged branch is still shared
console.log(data.user.name, next.user.name) // Ada Grace
console.log(set(data, 'user.name', 'Ada') === data) // true: an equal value reuses the root
```

### `/config`: accept config, expose reads and derive its successor

`ownConfig` is the boundary for outside config: it copies the input and records independently verifiable ownership. A `WeakMap`, a metadata table that adds no fields to the config, retains its `profile` and `limits`. An ordinary object cannot claim admission by forging a field. The default `data` profile accepts data; `richRuntime` also admits callbacks or factories.

```ts doc-test=check
import { ownConfig, patchConfig, readConfigPath, readonlyConfig } from '@migaia/utils/config'

/** Original config that its caller continues to change after admission. */
const callerOptions = { retry: { attempts: 2 }, labels: new Set(['stable']) }
/** Isolates both records and collections, then serves as the base for config operations. */
const config = ownConfig(callerOptions)
callerOptions.retry.attempts = 99
callerOptions.labels.add('changed')
console.log(config.retry.attempts, config.labels.has('changed')) // 2 false: the Set was copied too
/** Gives readers protected access to the previous config. */
const view = readonlyConfig(config)
/** Produces new retry settings while existing readers retain the old values. */
const next = patchConfig(config, { retry: { attempts: 3 } })
/** Distinguishes a missing path from a present path whose value is undefined. */
const result = readConfigPath(next, 'retry.attempts')
if (result.kind === 'value') console.log(result.value) // 3
console.log(view.retry.attempts) // 2: the previous config is unchanged
```

The object returned by `ownConfig` is not frozen; ownership and public read-only access are separate concerns. `readonlyConfig` protects the existing config while reads still access its data, without making another copy.

Callers cannot change any level: mutating methods such as `Map.set()`, `Set.add()` and `Date.setFullYear()` throw as well. Expose this view for reads and use `patchConfig()` to produce the next managed config instead of writing to `view`.

Use `readConfigPath` when a missing path must be distinguished from a value of `undefined`. Patches affect root fields only; calculate a new nested subtree first, then supply it as a whole patch value. A `richRuntime` config carrying functions is runtime config and should not be treated as serializable data.

`combineConfig` merges sources in order, with later sources overriding earlier ones. Records merge recursively by default, and arrays are replaced. The example explicitly chooses array concatenation and shows both inputs, the result and a change record prepared by the caller.

```ts doc-test=check
import { combineConfig, ownConfig } from '@migaia/utils/config'

/** Supplies the base retry count, tags and transport settings. */
const defaults = ownConfig({
  retries: 1,
  tags: ['default'],
  transport: { timeoutMs: 1_000, keepAlive: true }
})
/** Overrides selected fields while omitted transport settings retain their defaults. */
const override = ownConfig({
  retries: 3,
  tags: ['custom'],
  transport: { timeoutMs: 2_500 }
})
/** Builds a new config root with explicit record merging and array concatenation. */
const merged = combineConfig([defaults, override], {
  strategies: { record: 'merge', array: 'concat' }
})
console.log(merged)
// { retries: 3, tags: ['default', 'custom'], transport: { timeoutMs: 2500, keepAlive: true } }
/** The caller prepares its own change record rather than treating the result as a diff. */
const diff = { retries: { before: defaults.retries, after: merged.retries } }
console.log(diff) // { retries: { before: 1, after: 3 } }
```

Neither `defaults` nor `override` changes. This `diff` only makes the changes explicit; it is not an extra return value from `combineConfig`.

### `/function`: which instance owns an initialization

`once(fn)` remembers the first result of a synchronous initialization, including its first thrown error. Each call to `once(fn)` creates a separate cache. Create and export one wrapper at module scope to share it among consumers of that module instance.

```ts doc-test=check
import { once } from '@migaia/utils/function'

/** One exported wrapper lets all importers of this module use the same cache. */
export const getRuntime = once(() => ({ registry: new Map([['help', 'Show help']]) }))
/** The first read creates this module's runtime instance. */
const first = getRuntime()
/** Later consumers reuse the instance without constructing another registry. */
const second = getRuntime()
console.log(first === second) // true: one registry was created
```

Repeated module instances and separate realms, execution environments with their own globals such as iframes, Workers and Node `vm`, do not share this cache. `once` does not ensure global uniqueness.

Let an application entry point or dependency-injection container own an instance that must be shared within one environment. If the application chooses a global location such as `globalThis[Symbol.for('your-app/runtime')]`, it must also manage versions, disposal and test cleanup.

A `Proxy` can turn the first property access into lazy initialization, but uniqueness still depends on where the instance is stored and how many owners create it. Avoid `once` for initialization that needs retries, resets, hot updates or isolation per request.

`onceAsync` suits startup config that never refreshes, a shared SDK client, or dynamically importing and compiling one WASM module. The first call retains a Promise, and other callers reuse it both while it runs and after it settles.

```ts doc-test=check
import { onceAsync } from '@migaia/utils/function'

/** Shares fixed startup config; returning data directly keeps this example self-contained. */
export const loadAppConfig = onceAsync(async () => ({ apiBaseUrl: '/api' }))
const [routerConfig, telemetryConfig] = await Promise.all([loadAppConfig(), loadAppConfig()])
console.log(routerConfig === telemetryConfig) // true: both received one initialization result
```

The first failure stays cached, and there is no reset. Put required retries inside the wrapped initializer. For refreshing, rebuilding after logout or isolating work per tenant or request, use a container with that lifecycle.

If the shared task uses one caller's cancellation signal, that caller's cancellation affects every other waiter too. Each wrapper has its own cache; duplicated module instances, iframes, Workers and Node `vm` do not share it.
