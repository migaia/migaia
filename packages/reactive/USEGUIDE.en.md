# `@migaia/reactive` usage guide

[中文](./USEGUIDE.md)

For what the package is for, its highlights and its mental model, see the [README](./README.en.md). This guide starts with runnable examples organized by scenario (Node 24), then lists the APIs, edge behavior and error codes of both public entries. Nodes are always created through the Runtime factory; the `Signal`, `Computed` and `Effect` classes are internal.

## Find by scenario

| Your problem | Read this section |
| --- | --- |
| Derived values must be updated by hand at every change | [Keep derived values in sync automatically](#keep-derived-values-in-sync-automatically) |
| Old subscriptions are still active after switching rooms or pages | [Clean up the old subscription before switching](#clean-up-the-old-subscription-before-switching) |
| Changing two values flashes a half-updated result | [Several writes, one update](#several-writes-one-update) |
| A closed panel keeps recomputing | [Skip work nobody reads](#skip-work-nobody-reads) |
| Two effects trigger each other and the tab freezes | [Effects feeding each other do not freeze the page](#effects-feeding-each-other-do-not-freeze-the-page) |
| Requests share data in server rendering | [One Runtime per server request](#one-runtime-per-server-request) |

## Keep derived values in sync automatically

A cart total is kept in its own variable, and whenever the price or quantity changes the page should show the new total.

Hand-written code has to recalculate the total in every place that changes price or quantity; miss one and the page shows a stale total, because the dependency exists only in the developer's head.

With a Runtime, `computed` declares the total once from the values it reads, and an `effect` that reads it reruns when any of them changes. Nobody has to list the dependencies: reading `price.value` inside the function is enough.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const price = runtime.signal(30)
const quantity = runtime.signal(2)
// The total is derived from price and quantity; no code that changes them has to update it
const total = runtime.computed(() => price.value * quantity.value)

const render = runtime.effect(() => {
  console.log(`cart total: ${total.value}`)
})

quantity.value = 3 // change the quantity
runtime.flush() // flushed by hand here; normally a microtask does it
price.value = 25 // change the price
runtime.flush()

render.dispose()
total.dispose()
```

Output:

```text
cart total: 60
cart total: 90
cart total: 75
```

Prints `cart total: 60`, then `90` after the quantity changes and `75` after the price changes.

The effect ran on creation and once per change; `runtime.flush()` only makes the timing explicit, and without it the default microtask flush gives the same output.

## Clean up the old subscription before switching

A chat window joins a new room whenever the room changes but never leaves the old one, and ends up receiving messages from every room it ever visited.

With hand-written subscriptions, "leave" has to be written in every branch that switches rooms and again when the window closes; missing any one of them keeps an old subscription alive.

An `effect` may return a cleanup function. The Runtime calls it before the effect runs again and when the effect is disposed, so "leave" always runs before the next "join".

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const room = runtime.signal('lobby')

const chat = runtime.effect(() => {
  const name = room.value
  console.log(`join ${name}`)
  // The returned function runs before the next rerun and on dispose()
  return () => console.log(`leave ${name}`)
})

room.value = 'engineering'
runtime.flush()
chat.dispose() // the user closes the chat window
```

Output:

```text
join lobby
leave lobby
join engineering
leave engineering
```

Prints `join lobby`, `leave lobby`, `join engineering`, and `leave engineering` after `dispose()`.

Each cleanup sees the room of its own run, because the closure captured that run's `name`.

## Several writes, one update

Changing first and last name together makes the header show a mixed value such as "Grace Lovelace" before the correct name.

When every write notifies listeners at once, a listener runs between the two writes, reads half-updated data, and the page renders one extra time.

A Runtime write only marks downstream nodes stale, and effects run at the next flush (a microtask by default), so writes in the same synchronous code are seen together. Derived values that read the same inputs through several paths (`initials` and `label` both read the name) are recomputed from the final inputs too.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const first = runtime.signal('Ada')
const last = runtime.signal('Lovelace')
const initials = runtime.computed(() => `${first.value[0]}.${last.value[0]}.`)
const label = runtime.computed(() => `${first.value} ${last.value} (${initials.value})`)

let effectRuns = 0
const header = runtime.effect(() => {
  effectRuns += 1
  console.log('header shows:', label.value)
})

// Two values change in the same synchronous code
first.value = 'Grace'
last.value = 'Hopper'
await Promise.resolve() // wait for the default microtask flush
console.log('the effect ran', effectRuns, 'times')
header.dispose()
```

Output:

```text
header shows: Ada Lovelace (A.L.)
header shows: Grace Hopper (G.H.)
the effect ran 2 times
```

Prints `header shows: Ada Lovelace (A.L.)` on creation and, after the two writes, a single `Grace Hopper (G.H.)`; `effect ran 2 times`.

No line ever shows a mixed first and last name: writes in the same turn merged into one effect run.

## Skip work nobody reads

An expensive aggregation sits in a panel that can be collapsed, and it recalculates on every change even while the panel is closed.

Hand-written derived values usually recompute right when data is written, whether or not anyone is looking, so a closed panel still costs time.

A `computed` is lazy: it does not run until something reads it. When its last reader (here the effect) is disposed, it disconnects from its inputs, so later writes trigger no recomputation; the next read checks whether its inputs changed and recomputes once if they did.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const orders = runtime.signal([120, 80, 45])
let computations = 0
const report = runtime.computed(() => {
  computations += 1 // pretend this is an expensive aggregation
  return orders.value.reduce((sum, amount) => sum + amount, 0)
})

orders.value = [...orders.peek(), 60] // nobody reads report yet
console.log('computations while unread:', computations)

const panel = runtime.effect(() => console.log('report panel:', report.value))
orders.value = [...orders.peek(), 10]
runtime.flush()
console.log('computations while the panel is open:', computations)

panel.dispose() // the panel closes; its last reader leaves
orders.value = [...orders.peek(), 99]
orders.value = [...orders.peek(), 1]
console.log('computations after closing:', computations)
console.log('read again:', report.value, 'computations:', computations)
```

Output:

```text
computations while unread: 0
report panel: 305
report panel: 315
computations while the panel is open: 2
computations after closing: 2
read again: 415 computations: 3
```

`computations while unread: 0`; while the panel is open each change computes once (2 in total); after closing, two more writes leave the count at 2; reading again returns 415 and the count becomes 3.

Computation happens only when something reads the value; writes after the panel closed trigger none.

## Effects feeding each other do not freeze the page

Two-way Celsius/Fahrenheit syncing is written with two effects that each write what the other reads; when the values never settle, the tab freezes.

Hand-written two-way syncing has no limit on rounds, so the two listeners trigger each other forever, the page stops responding, and nothing tells you which two pieces of code are fighting.

Each flush is capped at `maxFlushPasses` passes (default 100). Past the cap the Runtime stops, drops the remaining queued effects and reports `FLUSH_LOOP` with their `debugName`s: to `onError` for automatic flushes, or as a thrown error from a manual `flush()`.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime({
  maxFlushPasses: 20, // default 100
  onError: (error, context) => console.log(context.phase, (error as { code?: string }).code)
})
const celsius = runtime.signal(0, { debugName: 'celsius' })
const fahrenheit = runtime.signal(32, { debugName: 'fahrenheit' })

// Two effects write the value the other reads, and the conversion is off by 1, so they never agree and keep triggering each other
runtime.effect(() => { fahrenheit.value = celsius.value * 1.8 + 33 }, { debugName: 'c-to-f' })
runtime.effect(() => { celsius.value = (fahrenheit.value - 32) / 1.8 }, { debugName: 'f-to-c' })

await new Promise((resolve) => setTimeout(resolve, 10))
console.log('the page stays responsive, celsius =', Math.round(celsius.peek()))
```

Output:

```text
async-flush FLUSH_LOOP
the page stays responsive, celsius = 12
```

Prints `async-flush FLUSH_LOOP` from `onError`, then `the page stays responsive, celsius = 12`.

The loop was cut after 20 passes (the `maxFlushPasses` set in the example) instead of running forever, and the reported `debugName`s point at the effects feeding each other.

## One Runtime per server request

A server renders pages for many users, and one user's data appears on another user's page.

`defaultRuntime` is one shared Runtime for the whole process; request state kept in that shared graph can be written by one request and read by another, and the leak is hard to notice.

Create a Runtime per request with `createRuntime()`. Nodes of different Runtimes cannot depend on each other: a cross read throws `CROSS_RUNTIME` at once instead of quietly mixing data.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

// Server rendering: one Runtime per request, so users never see each other's state
function renderPage(user: string) {
  const runtime = createRuntime()
  const name = runtime.signal(user)
  const greeting = runtime.computed(() => `Hello, ${name.value}`)
  return { runtime, greeting }
}

const pageA = renderPage('Ada')
const pageB = renderPage('Grace')
console.log(pageA.greeting.value, '|', pageB.greeting.value)

// Using a node of A inside the Runtime of B fails at once instead of silently mixing data
const leaked = pageB.runtime.computed(() => pageA.greeting.value)
try {
  leaked.value
} catch (error) {
  console.log('cross-Runtime read:', (error as { code?: string }).code)
}
```

Output:

```text
Hello, Ada | Hello, Grace
cross-Runtime read: CROSS_RUNTIME
```

Prints `Hello, Ada | Hello, Grace`: each request has its own state.

The leaked read prints `cross-Runtime read: CROSS_RUNTIME`: mixing Runtimes shows up at the exact line that does it.

---

## Contents

- [Main entry `@migaia/reactive`](#main-entry): Runtime factory, node types, diagnostic constants and error codes
- [`/extension` entry](#extension-entry): ownership, controlled sources, observer binding, graph types and read-only version queries
- [Error codes](#error-codes)
- [Trace events and constants](#trace-events-and-constants)
- [Combined examples](#combined-examples)
- [Troubleshooting and build gates](#troubleshooting-and-build-gates)

---

<a id="main-entry"></a>

## Main entry `@migaia/reactive`

```ts
import {
  createRuntime,
  defaultRuntime,
  assertSingleRuntimeCopy,
  ReactiveErrorCode,
  REACTIVE_SOURCE,
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceType,
  ReactiveTraceReason,
  type IReactiveSignal,
  type IReactiveComputed,
  type IReactiveEffect,
  type IComputedConfig,
  type IReactiveNodeOptions,
  type IDisposable,
  type IDisposer,
  type IRuntime,
  type IRuntimeOptions,
  type ISchedulerStrategy,
  type IFlushResult,
  type IRuntimeTraceEvent,
  type IRuntimeErrorContext,
  type IReactiveErrorCode,
  type IReactiveError
} from '@migaia/reactive'
```

### `IReactiveSignal<T>`

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IReactiveSignal<T> = IDisposable & {
  readonly runtime: IRuntime
  readonly debugName?: string
  readonly version: number
  readonly disposed: boolean
  readonly observed: boolean // !disposed && has downstream subscribers
  value: T // reading registers a dependency; writing notifies dependents
  peek(): T // reads without registering a dependency
  dispose(): void
  addObservedHooks(hooks: { onObserved?: () => void; onUnobserved?: () => void }): () => void
}
```

A writable atom, the only "source of truth" in the reactive graph:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const runtime = createRuntime()
const count = runtime.signal(1)
count.value // 1; reading inside a Computed / Effect registers a dependency
count.value = 2 // compared with Object.is; writing the same value notifies nothing and keeps the version
count.peek() // 2, without registering a dependency
count.dispose()
count.value // throws NODE_DISPOSED
```

Edge behavior:

- Created with `runtime.signal(value, options?)`; it returns a narrow node view that exposes no graph edges or internal methods.
- `value = next`: when `Object.is(next, previous)` is true the write short-circuits, with no version bump and no notification. Otherwise it first takes a new version number from the `VersionClock` and then stores the value. If taking a version fails (the clock is exhausted), the write fails atomically, so "value changed but version did not" can never happen.
- `dispose()` is idempotent. Releasing first marks the node `disposed` and then removes every downstream edge, in that order, so an Effect forced to rerun reads a clear `NODE_DISPOSED` instead of subscribing to a released node again.
- `addObservedHooks({ onObserved?, onUnobserved? })` registers node-level lifecycle hooks (several callers can register without overwriting each other) and returns a removal function. When hooks fail, a single failure keeps its original instance and several failures are aggregated as an `OBSERVER_FAILED` `AggregateError`; the public observation path catches them and reports them to `onError` with phase `lifecycle-hook`, so creating an Effect never surfaces hook failures as a synchronous throw.
- Reading or subscribing to a `Signal` from another `Runtime` throws `CROSS_RUNTIME`.

### `IReactiveComputed<T>`

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IComputedOptions<T> = {
  equals?: (a: T, b: T) => boolean
  keepAlive?: boolean
  debugName?: string
}
type IComputedConfig<T> = IComputedOptions<T> | ((a: T, b: T) => boolean)

type IReactiveComputed<T> = IDisposable & {
  readonly runtime: IRuntime
  readonly debugName?: string
  readonly version: number
  readonly disposed: boolean
  readonly observed: boolean
  readonly value: T // reading registers a dependency and recomputes lazily
  peek(): T // reads and recomputes without registering a dependency
  dispose(): void
}
```

A lazy, cached derived value: writes only mark it dirty (push), and the value is recomputed only when read (pull):

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const doubled = runtime.computed(() => count.value * 2)
doubled.value // the first read actually computes
doubled.value // returns the cache while dependencies are unchanged

const clamped = runtime.computed(() => Math.max(0, count.value), { keepAlive: true }) // stays warm without subscribers
const custom = runtime.computed(
  () => ({ n: count.value }),
  (a, b) => a.n === b.n
) // the config may be a comparison function directly
```

Edge behavior:

- Created with `runtime.computed(fn, config?)`; the config can be an object or an `equals` comparison function.
- `equals`: `Object.is` by default. If the comparison function itself throws, the dirty state is not settled, so the next read recomputes instead of being stuck "stale but marked clean".
- `keepAlive`: `false` by default. An ordinary read with nobody observing suspends the node at idle time; when the last observer leaves it suspends synchronously (disconnecting dependencies but keeping its version and topology snapshot). The next read revalidates first, reusing the cache when nothing changed and recomputing otherwise. `true` disables automatic suspension.
- A circular self-dependency (the evaluation reads itself directly or indirectly) throws `CIRCULAR_DEPENDENCY` instead of overflowing the stack.
- `value` / `peek` on a released node always throw `NODE_DISPOSED`.

### `IReactiveEffect`

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IReactiveEffect = IDisposable & {
  readonly runtime: IRuntime
  readonly debugName?: string
  readonly disposed: boolean
  dispose(): void
}
```

A side effect, the only observer that is really "executed" (a `Computed` only marks itself dirty and does not rerun; only an `Effect` is actually `tick`ed by the scheduler):

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const seen: number[] = []
const effect = runtime.effect(() => {
  seen.push(doubled.value)
  return () => console.log('cleanup') // optional: the return value is the cleanup before the next rerun / dispose
}) // runs once synchronously on creation
effect.dispose() // release: remove dependency edges and run the last cleanup (untracked, so it registers no dependencies)
```

Edge behavior:

- **Runs once synchronously on creation**; it does not wait for a dependency change before its first run.
- `fn()` may return a cleanup function (`IDisposer`), called before the next rerun and on `dispose()`, wrapped in `runtime.untracked()` so it registers no new dependencies. The old cleanup is detached (set to empty) before it runs, so if the new `fn()` throws, the next rerun or dispose does not run the old cleanup twice.
- With the default microtask strategy, a dependency change does not rerun the effect immediately; `Scheduler.enqueue()` marks it dirty and queues it, and `flush()` (automatic or manual) drives `tick()`. Inside `tick()` it first confirms that a dependency really changed (`hasStaleDependencies`) before calling `run()`. With a synchronous strategy such as `flush => flush()`, the setter can rerun the Effect right after the full fan-out.
- When a dependency node is disconnected through `dispose()` / `disconnectObservable`, the next `tick()` reruns unconditionally, without checking whether it is really dirty.

### `createRuntime` / `defaultRuntime`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createRuntime(options?: IRuntimeOptions): IRuntime
const defaultRuntime: IRuntime
```

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IRuntimeOptions = {
  adapter?: Partial<IReactiveRuntimeAdapter> // scheduleMicrotask/now/timestamp/reportError
  onError?: (error: unknown, context: IRuntimeErrorContext) => void
  onTrace?: (event: IRuntimeTraceEvent) => void
  maxFlushPasses?: number // default 100, must be a positive integer
  scheduleIdle?: (task: () => void) => void // defaults to adapter.scheduleMicrotask
  schedulerStrategy?: ISchedulerStrategy // chosen at creation, merges in microtasks by default
}
```

Creates a new isolated runtime:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const runtime = createRuntime({
  maxFlushPasses: 50,
  onError: (e, ctx) => console.error(ctx.phase, e)
})
```

Edge behavior:

- A `maxFlushPasses` that is not a positive integer (not a safe integer, or `< 1`) throws a `RangeError` with code `INVALID_OPTION`.
- Each `adapter` method (`scheduleMicrotask` / `now` / `timestamp` / `reportError`) is resolved on its own: missing or explicitly `undefined` falls back to the default (`queueMicrotask` / `performance.now()` / `Date.now()` / no-op); provided but not a function throws a `TypeError` with code `INVALID_OPTION`.
- `onError` / `onTrace` / `scheduleIdle` / `schedulerStrategy`, when provided but not functions, throw a native `TypeError` carrying the top-level `INVALID_OPTION` at construction. The strategy is validated before the Scheduler is created.
- `defaultRuntime` is a process-wide singleton (`createRuntime()` runs when the module loads). Per-request isolation in server rendering, independent unit tests and Workers should call `createRuntime()` explicitly instead of relying on it.
- When several runtime copies of this library are detected (duplicate installs, CDN copies side by side, micro-frontends bundling their own), construction reports a `COPY_CONFLICT` diagnostic through `reportError` without blocking construction.

The public methods of `IRuntime` (brand fields omitted):

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IRuntime = {
  signal<T>(value: T, options?: IReactiveNodeOptions): IReactiveSignal<T>
  computed<T>(fn: () => T, config?: IComputedConfig<T>): IReactiveComputed<T>
  effect(fn: () => void | IDisposer, options?: IReactiveNodeOptions): IReactiveEffect // returns the lifecycle handle of the node
  batch<T>(fn: () => T): T
  untracked<T>(fn: () => T): T
  flush(): 'completed' | 'deferred'
  runTracedAction<T>(name: string, fn: () => T): T
  reportError(
    error: unknown,
    context: { phase: IRuntimeErrorContext['phase']; observer?: object; observable?: object }
  ): void
  subscribeTrace(listener: (event: IRuntimeTraceEvent) => void): IDisposer
}
```

Method by method:

- `batch(fn)`: merges several writes into one effect flush; it counts nesting depth on entry and only the outermost exit actually calls `flush()`. If `fn` throws and the closing `flush()` also throws, a writable plain `Error` stays the same object and gets the flush error attached on `cause`; a non-`Error` or a non-writable `Error` is preserved through an `AggregateError` with code `ACTION_FLUSH_FAILED`. If the `cause` getter of the application error throws, the aggregate's `errors` keep, in order, the application error, the flush error and the value the getter threw; `onError` also receives the getter's thrown value with phase `cause-read`.
- `untracked(fn)`: turns dependency tracking off while `fn` runs, so reading any `Signal` / `Computed` registers no edge.
- `flush()`: flushes the current queue synchronously. **Reentrancy**: calling `flush()` again inside an observer's `tick()` returns `'deferred'` (the outer flush is still running and this call does not flush); the outermost call returns `'completed'` once it has drained the queue. When one flush exceeds `maxFlushPasses` recomputation passes it throws `FLUSH_LOOP` (see the error codes), clears the rest of the queue, and the error message lists at most 8 dropped `debugName`s.
- The creation option `schedulerStrategy` only changes when `flush` happens and does not hand out the Scheduler queue. A strategy must return synchronously; returning a thenable triggers an `INVALID_OPTION` diagnostic and falls back to the validated safe strategy. There is no public way to replace it while the Runtime lives.
- `runTracedAction(name, fn)`: runs and traces one real action; `name` must be a non-empty string, otherwise it throws `INVALID_OPTION`. Without trace listeners it only runs `fn` inside the same callback error boundary and creates no trace event.
- `reportError(error, context)`: the diagnostic channel. `context.observer` / `context.observable` are raw node objects that are first reduced to an `IRuntimeNodeDescriptor` before reaching `onError`. A throw or rejection from the reporter itself goes to the shared host exception queue of utils and never breaks graph operations in return.
- `subscribeTrace(listener)`: a read-only diagnostic event stream (value changes, dependency connections and disconnections, effect runs, explicit actions); it returns an unsubscribe function.

---

### `assertSingleRuntimeCopy()`

Requires that only one module copy entered the correctness boundary in the current process, otherwise it throws `COPY_CONFLICT`. Applications call it explicitly from the root entry; the library never calls it by itself. With duplicate installs, CDN copies side by side or independently bundled micro-frontends, deduplicate the dependency.

---

<a id="extension-entry"></a>

## `/extension` entry

Implementation layers get their extension capabilities from this entry. It allows taking part in the graph protocol and registering ownership, which is more than the public `IRuntime` offers; it never hands out tracker / scheduler / clock objects or modifiable edge sets.

```ts
import {
  createObserverBinding,
  type IObserverBinding,
  type IObserverCommitResult,
  type IObserverRetrackResult,
  type ICapture
} from '@migaia/reactive/extension'
```

### `createObserverBinding`

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createObserverBinding(runtime: IRuntime): IObserverBinding

type IObserverBinding = {
  capture<R>(read: () => R): ICapture<R>
  observe(fn: () => void | IDisposer, options?: IReactiveNodeOptions): IDisposer
  commit(capture: ICapture<unknown>): IObserverCommitResult
  retrack(): IObserverRetrackResult
}

type IObserverCommitResult = 'committed' | 'stale' | 'no-observer'
type IObserverRetrackResult = 'changed' | 'unchanged' | 'no-observer'
```

Sets up a three-phase binding for one subscriber: **during render it only captures dependencies, read-only, and only at commit does it install them on the subscriber**. A render in between may be discarded by concurrent rendering, so the capture phase never creates edges. The binding owns an internal `Effect`: an adapter can capture / observe / commit / retrack, but cannot reach `deps`, versions or a forced scheduling entry:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const binding = createObserverBinding(runtime)
const dispose = binding.observe(() => {
  // the real subscriber body; it is scheduled to rerun normally when dependencies change
})

// render phase (may be discarded):
const capture = binding.capture(() => doubled.value) // records only what was read and its version; no edges

// commit phase:
const result = binding.commit(capture) // 'committed' | 'stale' | 'no-observer'
if (result === 'stale') {
  // dependencies changed after the capture: re-evaluate instead of reusing the same capture token
}

binding.retrack() // forces the current subscriber to rerun once and reports whether its dependencies or recorded versions changed
dispose()
```

The four members:

- `capture<R>(read: () => R): ICapture<R>`: a render-phase capture. It only records which dependency nodes this read touched and their versions at that moment; it **creates no dependency edges, bumps no versions and schedules no idle work**. Reading a dirty Computed reuses its speculative preview, and the evaluated graph it needs stays inside the same token; commit first validates the complete dependency tree and then adopts the graph and caches without rerunning derivations or comparers, so a discarded render leaves no subscription behind. `ICapture<R>` is a branded, opaque token whose `result: R` is the return value of `read()`; the dependency set lives in a private `WeakMap` of the tracker, so holding a token neither reveals the dependencies nor allows changing versions.
- `observe(fn, options?): IDisposer`: installs the internal `Effect` the binding owns (the concrete class stays private, so the adapter cannot change `deps` / versions or call `run` / `markDirty`). Calling it **again on the same binding** while the current subscriber is still observed throws `BINDING_DUPLICATE`. The returned disposer is idempotent.
- `commit(capture): IObserverCommitResult`: installs the dependencies at commit time, putting `capture` on **the observer the binding was created for**. `'committed'`: the dependency edges are installed. `'stale'`: dependencies changed after the capture; the token is consumed and you must capture again. Only then should the caller discard its snapshot and read again; it **should not** pull dirty nodes during commit, which would throw the user's evaluation errors inside commit and bypass the Error Boundary. `'no-observer'`: the commit target does not exist yet (not `observe()`d yet, or already disposed); the token is not consumed and can be retried once the observer is ready.
- `retrack(): IObserverRetrackResult`: forces the currently committed observer to rerun once and reports whether its dependency set or recorded versions changed (`'changed'` / `'unchanged'`); without an observer it returns `'no-observer'`.

### Ownership registration and assertions

```ts
import {
  claimOwnership,
  ownerOf,
  assertOwnedBy,
  assertReactiveOwnedBy
} from '@migaia/reactive/extension'
```

Registration and assertions of "which `Runtime` a node belongs to", for authors building store, collection or resource libraries on top of this package.

- `claimOwnership(value: object, runtime: IRuntime): void`: registers ownership. The first registration installs the existing non-enumerable, non-writable cross-copy brand, while the WeakMap stays the local authority. Registering the same object to a different `Runtime` throws `OWNERSHIP_CONFLICT`.
- `ownerOf(value: unknown): IRuntime | undefined`: looks up ownership; an ordinary unregistered value returns `undefined`. A foreign copy's brand triggers `COPY_CONFLICT` instead of passing as an ordinary unregistered value.
- `assertOwnedBy(value: unknown, runtime: IRuntime, what: string): void`: a lenient assertion. Ordinary unregistered values pass, while a foreign copy's brand is rejected first (third parties may register ordinary values in a Registry without touching the graph); it throws `CROSS_RUNTIME` only when the value **is registered and belongs elsewhere**.
- `assertReactiveOwnedBy(value: object, runtime: IRuntime, what: string): void`: the strict assertion used at core graph boundaries. An unregistered value throws `NOT_RUNTIME_OWNED` at once; a value registered to another `runtime` throws `CROSS_RUNTIME`.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const runtime = createRuntime()
const node = {}
claimOwnership(node, runtime)
assertOwnedBy(node, runtime, 'my-node') // passes
assertOwnedBy(node, otherRuntime, 'my-node') // throws CROSS_RUNTIME
```

---

### `createFieldSource`

```ts
import { createFieldSource, type IRuntimeFieldSource } from '@migaia/reactive/extension'
```

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createFieldSource(
  runtime: IRuntime,
  debugName?: string
): {
  track(): void
  notify(): void
  commit<T>(write: () => T): T
  readonly observed: boolean
  readonly disposed: boolean
  dispose(): void
}
```

Creates a controlled Source for the extension layer (for example a Wasm field or a value backed by SharedArrayBuffer). The caller gets only the four capabilities `track` / `notify` / `commit` / `dispose`, and never the underlying node, `subs`, versions or `Tracker`, so it cannot create one-sided dependencies, forge versions or notify the graph of another `Runtime`:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const field = createFieldSource(runtime, 'wasm-counter')
function read(): number {
  field.track() // registers a dependency and returns nothing; the real value lives in outside storage
  return wasmMemory.getValue()
}
function write(v: number): void {
  field.commit(() => wasmMemory.setValue(v)) // take a version, run the write, then publish, as one atomic step
}
field.dispose()
```

Edge behavior: `track()` / `notify()` / `commit()` throw `NODE_DISPOSED` after `dispose()`; `commit(write)` takes a version number first, runs `write()` and then publishes the notification (the same three steps as `Signal.value = `).

---

### Graph views and read-only queries

```ts
import {
  internalRuntimeOf,
  isRuntimeTracking,
  isAnyRuntimeTracking,
  currentRuntimeVersion,
  type IObservable,
  type IObserver,
  type IInternalRuntime
} from '@migaia/reactive/extension'
```

- `internalRuntimeOf(runtime: IRuntime): IInternalRuntime`: validates that the Runtime is registered by this library and throws `NOT_RUNTIME_OWNED` otherwise. Its `signal()` returns `IReactiveSignal<T> & IObservable` and its `computed()` returns `IReactiveComputed<T> & IObservable & IObserver`. These relationships are read-only; observer operations and ownership registration are extension capabilities, and internal service objects and modifiable edge sets are no longer public. Public nodes already have `dispose()` themselves.
- `isRuntimeTracking(runtime: IRuntime): boolean`: read-only query of whether that `Runtime` is collecting a dependency frame right now.
- `isAnyRuntimeTracking(): boolean`: read-only query of whether any `Runtime` in the process has an active dependency frame.
- `currentRuntimeVersion(runtime: IRuntime): number`: reads the existing version clock without exposing the clock object; an unregistered object throws the top-level `NOT_RUNTIME_OWNED`.

---

### Custom sources and observers

`createSourceBinding(node)` registers the canonical version and subscriber set for a new node that implements `IObservable`, and returns read-only `version` / `subs` plus `source` operations bound to the original node. Construct the node with this read-only metadata attached before publishing the instance; the original identity of SAB-backed nodes is preserved. Ordinary outside fields should still use `createFieldSource(runtime)`.

`createTrackedObserver(observer)` creates read-only `deps` / `depVersions` for a new node that implements `IObserver` and provides self-bound `runTracked` / `clear` / `suspend` / `isSuspended` / `revalidate` / `hasStaleDependencies` / `deferIdle`. `clear` only disconnects graph dependencies; resource requests and cancellation stay with the caller, and it creates no extra Effect or tracker. Framework render / commit adapters keep using `createObserverBinding(runtime)`.

Neither factory can rebind a graph node that is already registered (built-in nodes included): it throws `GRAPH_NODE_REGISTERED` and never replaces a set that still has live edges. `invalidateObservable(runtime, node)` removes only the node's downstream edges while keeping upstream edges and caches, for switching Atom routing; to really release a node, still call its `dispose`.

Migration: `@migaia/reactive/internals` has been removed. The old `internalsOf` / `registerSubs` / `registerVersion` / `registerDeps` and similar functions cannot import the whole tracker under a new name; move each use to the matching binding capability of `/extension` described above. `tracker` / `scheduler` / `clock` and writable sets always stay inside the kernel.

---

<a id="error-codes"></a>

## Error codes

```ts
import { ReactiveErrorCode, type IReactiveErrorCode } from '@migaia/reactive'
```

The stable error code table has **18 codes**, declared only in `src/error-code.ts`, and `source` is always `'@migaia/reactive'`. (Background: the five codes `SCOPE_CLOSED` / `SCOPE_REENTRANT_DISPOSE` / `SCOPE_SYNC_VIOLATION` / `GENERATION_DISPOSED` / `SCOPE_DISPOSAL_FAILED` that used to belong here moved out with the lifecycle primitives and now belong to `@migaia/lifecycle`.)

| `ReactiveErrorCode` key | Code | When it happens |
| --- | --- | --- |
| `callbackFailed` | `CALLBACK_FAILED` | An unclassified action / batch / untracked / tracked derivation callback failed. Native errors get the code in place where possible; primitives (including undefined) and immutable native errors are kept on `cause`; existing semantic identity is unchanged; a thrown non-Error object keeps its control identity so a Resource / Suspense owner can admit it once |
| `nodeDisposed` | `NODE_DISPOSED` | A read or write method was called on a disposed `Signal` / `Computed` / custom Source |
| `circularDependency` | `CIRCULAR_DEPENDENCY` | Evaluating a `Computed` read (directly or indirectly) the result it is currently evaluating |
| `crossRuntime` | `CROSS_RUNTIME` | A node of one `Runtime` was read, subscribed or checked at the tracking / ownership boundary of another `Runtime` |
| `notRuntimeOwned` | `NOT_RUNTIME_OWNED` | The object was not created by `createRuntime()` or carries no internal ownership registration |
| `ownershipConflict` | `OWNERSHIP_CONFLICT` | The same node object was registered to different `Runtime`s |
| `copyConflict` | `COPY_CONFLICT` | Several runtime copies of this library were detected, or `assertSingleRuntimeCopy()` found more than one copy |
| `brandCorrupted` | `BRAND_CORRUPTED` | A cross-copy diagnostic brand was found in an unexpected shape |
| `versionExhausted` | `VERSION_EXHAUSTED` | A new version was requested after the monotonic version clock reached its limit (default `Number.MAX_SAFE_INTEGER`) |
| `flushLoop` | `FLUSH_LOOP` | One flush exceeded `maxFlushPasses` recomputation passes (default 100) |
| `observerFailed` | `OBSERVER_FAILED` | Several observers' `tick()` failed in one flush, or several observable lifecycle hooks failed; used as the `AggregateError` wrapper |
| `actionFlushFailed` | `ACTION_FLUSH_FAILED` | An action inside `runBatched()` and its closing flush both failed; a plain writable error gets the aggregate on `cause`, and when `cause` cannot be read the three original values go straight into `AggregateError.errors` |
| `schedulerFailed` | `SCHEDULER_FAILED` | Reserved: diagnostic channel code for unhandled errors caught from an async scheduling strategy callback or `reportError()` (no built-in throw or report point by default) |
| `captureInvalid` | `CAPTURE_INVALID` | At `commitCapture()` the token from `capture()` was already invalid or consumed, belonged to another tracker, or its observer was disposed |
| `bindingDuplicate` | `BINDING_DUPLICATE` | `observe()` was called again on the same `IObserverBinding` while it was already observed |
| `graphNodeRegistered` | `GRAPH_NODE_REGISTERED` | A source / observer binding tried to replace the sets of an existing graph node; create a new node instead |
| `internalsRegistered` | `INTERNALS_REGISTERED` | The internal surface of the same `Runtime` object was registered twice (`registerInternals()`) |
| `invalidOption` | `INVALID_OPTION` | An option passed while constructing a `Runtime` / `Scheduler` / `VersionClock` did not meet its requirements |

Callers should always check `error.code === ReactiveErrorCode.xxx` instead of hard-coding the code strings. The JSDoc in `src/error-code.ts` explains the reason for each code.

---

<a id="trace-events-and-constants"></a>

## Trace events and constants

```ts
import {
  ReactiveErrorPhase,
  ReactiveTracePhase,
  ReactiveTraceType,
  type IRuntimeTraceEvent
} from '@migaia/reactive'
```

Events received by `subscribeTrace(listener)` are one of these discriminated variants:

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IRuntimeTraceEvent =
  | {
      type: 'observable-change'
      timestamp: number
      observable: IRuntimeNodeDescriptor
      reason: 'set' | 'notify'
    }
  | {
      type: 'dependency'
      timestamp: number
      phase: 'connect' | 'disconnect'
      observable: IRuntimeNodeDescriptor
      observer: IRuntimeNodeDescriptor
      reason?: 'retrack' | 'invalidate' | 'dispose'
    }
  | {
      type: 'observer-run'
      timestamp: number
      phase: 'start' | 'end' | 'error'
      observer: IRuntimeNodeDescriptor
      durationMs?: number
      error?: unknown
    }
  | {
      type: 'action'
      timestamp: number
      phase: 'start' | 'end' | 'error'
      name: string
      durationMs?: number
      error?: unknown
    }
```

Nodes appear as reduced `IRuntimeNodeDescriptor`s (`{ id, kind, debugName? }`), not as raw node objects.

| Constant | Values | Purpose |
| --- | --- | --- |
| `ReactiveTraceType` | `{ observableChange, dependency, observerRun, action }` | Top-level discriminant of trace events |
| `ReactiveTracePhase` | `{ start, end, error, connect, disconnect }` | Phase of dependency / observerRun / action events |
| `ReactiveErrorPhase` | `{ asyncFlush, causeRead, dependencyDisconnect, lifecycleHook, ssrResource, subscriptionListener, traceListener }` | Values of `context.phase` received by `reportError` / `onError`; `causeRead` means reading the `cause` of an application error failed while closing a batch |
| `ReactiveTraceReason` | `{ set, notify, retrack, invalidate, dispose }` | Reason of observableChange / dependency events |

---

<a id="combined-examples"></a>

## Combined examples

### 1. Isolated Runtime + manual flush (server rendering / unit tests)

```ts
import { createRuntime } from '@migaia/reactive'

function renderOnce() {
  const runtime = createRuntime() // one per request / test, so nothing leaks between them
  const count = runtime.signal(1)
  const doubled = runtime.computed(() => count.value * 2)
  const seen: number[] = []
  const dispose = runtime.effect(() => {
    seen.push(doubled.value)
  })
  count.value = 5
  runtime.flush() // flush synchronously by hand; server rendering does not depend on microtask timing
  dispose.dispose()
  return seen // [2, 10]
}
```

### 2. Three-phase binding: a minimal concurrency-safe subscription adapter

```ts
import { createObserverBinding } from '@migaia/reactive/extension'
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const count = runtime.signal(0)
const doubled = runtime.computed(() => count.value * 2)

function useReactiveValue<T>(read: () => T): T {
  const binding = createObserverBinding(runtime)
  const capture = binding.capture(read) // render phase: read-only capture that may be discarded
  // ...when the render really commits:
  binding.observe(() => {
    // re-render after a change; a real host calls the returned disposer on unmount
  })
  const result = binding.commit(capture) // install the observer first, then commit the token
  if (result === 'stale') {
    // dependencies changed: evaluate again (a real framework adapter triggers a re-render here)
  }
  return capture.result
}
```

### 3. Batch + error priority: the order of an action failure and a closing flush failure

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const runtime = createRuntime()
try {
  runtime.batch(() => {
    signalA.value = 1
    signalB.value = 2
    throw new Error('business failure')
  })
} catch (error) {
  // error is the 'business failure' itself; if the closing flush also fails, the flush error hangs on error.cause
}
```

### 4. Custom scheduling strategy: switch to `requestAnimationFrame`

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const runtime = createRuntime({
  schedulerStrategy: (flush) => {
    requestAnimationFrame(() => flush())
  }
})
```

---

<a id="troubleshooting-and-build-gates"></a>

## Troubleshooting and build gates

- **Reading a node throws `NODE_DISPOSED`**: the node was `dispose()`d and never silently returns an old value; stop holding that reference and use a newly created instance.
- **`CROSS_RUNTIME` / `NOT_RUNTIME_OWNED`**: nodes were mixed across `Runtime`s, or the object was not created by `createRuntime()`; make sure a node and the `Runtime` consuming it are the same one.
- **A `Computed` throws `CIRCULAR_DEPENDENCY`**: the graph has a self-reading cycle (`a` reads `a` directly or indirectly); check the graph and break the cycle.
- **`flush()` throws `FLUSH_LOOP` (automatic flushes report it to `onError` with phase `async-flush`)**: effects keep triggering each other and never stop, typically two `Effect`s that each write the value the other reads while the two values never agree. The error message lists the dropped pending `debugName`s; use them to find and break the cycle. A single `Effect` that writes a value it reads during its own run does not make itself rerun.
- **`createObserverBinding().observe()` throws `BINDING_DUPLICATE`**: the same binding was `observe()`d again while already observed; check whether it is still observing before calling again, or create a new binding for a new render round.
- **`commit()` returns `'stale'`**: not an error but the normal race signal; discard the current snapshot and `capture()` / `commit()` again, without pulling dirty nodes during commit.
- **`COPY_CONFLICT` / `BRAND_CORRUPTED`**: several module copies of this library exist in the process; deduplicate the dependency (usually a bundler issue), or call `assertSingleRuntimeCopy()` at application start to fail fast.
- **`VERSION_EXHAUSTED`**: the monotonic version clock ran out (with production defaults this takes about 285 years); release every node the current `Runtime` holds and create a new `Runtime` instead of reusing the same graph.
- **You need collection types, an async resource state machine or UI framework bindings**: `@migaia/reactive` only provides the engine layer, the three node primitives and the `Runtime`; those higher-level capabilities are built on it by the `store-*` packages, `@migaia/resource` and the framework adapters in this monorepo.

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

Cross-copy diagnostics use two global Symbol keys, `@migaia/reactive.runtime-copies` and `@migaia/reactive.ownership-copy`. When migrating, upgrade every reactive copy in one process together: the old `@morning-watch/store` namespace and the new version cannot see each other, so mixed copies neither count each other nor recognize each other's ownership marks.

`@migaia/reactive/extension` provides `getDefaultRuntime()` for adapters that must create nothing at import time. It creates the shared default Runtime on its first call and returns exactly the same object as the root entry's `defaultRuntime`; importing the root `defaultRuntime` still creates it at import time. `ReactiveErrorPhase` can also be imported from the extension entry and is the same object as the root export.

```ts
import { getDefaultRuntime } from '@migaia/reactive/extension'
const runtime = getDefaultRuntime()
const node = runtime.signal(1)
runtime.batch(() => {
  node.value = 2
})
console.log(node.value)
node.dispose()
```

`deferRuntimeCleanup(runtime, task)` from `@migaia/reactive/extension` schedules one synchronous adapter cleanup on that Runtime's `scheduleIdle` channel (microtasks by default). Errors thrown by the cleanup go to the Runtime's `reportError`. It returns no modifiable scheduler or graph capability and does not own asynchronous resources.

```ts
import { createRuntime } from '@migaia/reactive'
import { deferRuntimeCleanup } from '@migaia/reactive/extension'
const idle: Array<() => void> = []
const runtime = createRuntime({
  scheduleIdle: (task) => {
    idle.push(task)
  }
})
let released = false
deferRuntimeCleanup(runtime, () => {
  released = true
})
console.log(released) // false
idle.shift()?.()
console.log(released) // true
```
