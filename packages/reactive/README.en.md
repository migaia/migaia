# @migaia/reactive

[中文](./README.md)

Totals, filtered lists and badge counts on a page are all derived from other data. Syncing them by hand at every place that changes the data eventually misses one; notifying on every single write makes the page flash half-updated values. `@migaia/reactive` uses Signals (writable values), Computeds (derived values) and Effects (work to do when values change) to record who depends on whom, and updates only what a change really affects. It does not depend on any UI framework or host, so it runs in browsers, Node and Workers; the store packages (collections, persistence, React bindings and so on) are built on it.

## You may have run into

- **Stale derived values**: totals or filtered lists kept in their own variables must be recalculated at every place that changes the data, and one missed place shows an old value. The cause: people, not the program, keep track of the dependencies.
- **Half-updated values flashing on the page**: changing first and last name shows "Grace Lovelace" in the header before the right name appears. The cause: every write notifies listeners immediately, so they read data that is only half updated.
- **Old subscriptions that never end**: after switching chat rooms the window still receives the old room's messages, and memory slowly grows. The cause: subscription cleanup is scattered and depends on someone remembering to call it.
- **A frozen tab**: two effects write the value the other reads, the values never agree, and they keep triggering each other. The cause: nothing limits how many rounds one update may chain.
- **Server rendering mixes data**: state lives in module-level variables, and a value written by one request is read by another. The cause: every request shares one state graph.

## Why choose it

- **A derived value is declared once, and its dependencies register themselves.** Hand-written code must remember to recalculate at every change; a `computed` records a dependency the moment it reads `price.value`, and any input change makes it recompute. [Example](./USEGUIDE.en.md#keep-derived-values-in-sync-automatically)
- **Several writes produce one update, with no half-updated values.** Notifying on every write renders mixed values; the Runtime only marks dependents as stale on write and runs effects in the next flush with the final inputs, so derived values read through several paths agree too. [Example](./USEGUIDE.en.md#several-writes-one-update)
- **A derived value nobody reads is not computed.** Recomputing for a closed panel is a common waste; a `computed` does not run until something reads it, disconnects from its inputs when its last reader leaves, and recomputes on demand at the next read. [Example](./USEGUIDE.en.md#skip-work-nobody-reads)
- **An endless effect loop is cut off instead of freezing the page.** Effects that trigger each other may run forever; each flush is capped at `maxFlushPasses` passes (default 100), after which it stops and reports `FLUSH_LOOP` with the `debugName`s involved. [Example](./USEGUIDE.en.md#effects-feeding-each-other-do-not-freeze-the-page)
- **Every Runtime is isolated, and mixing them fails at once.** Global state leaking between server requests is hard to notice; nodes of different Runtimes cannot depend on each other, and a cross-Runtime read throws `CROSS_RUNTIME` immediately. [Example](./USEGUIDE.en.md#one-runtime-per-server-request)

## Start here

The shopping cart below derives its total from the items and the discount, and updates once even when both change. Run it with Node 24.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()
const items = runtime.signal([{ name: 'keyboard', price: 300 }])
const discount = runtime.signal(0)
// The total is derived from items and discount and recomputes when either changes
const total = runtime.computed(
  () => items.value.reduce((sum, item) => sum + item.price, 0) * (1 - discount.value)
)

const badge = runtime.effect(() => console.log(`total ${total.value}`))

items.value = [...items.peek(), { name: 'mouse', price: 100 }]
discount.value = 0.1
await Promise.resolve() // both changes merge into one update in the next microtask
badge.dispose()
```

Output:

```text
total 300
total 360
```

The `effect` runs once on creation and prints 300. The two changes that follow do not print once each; they merge into one update in the next microtask, which prints 360 directly ((300 + 100) × 0.9). `total` read `items.value` and `discount.value`, so those dependencies were registered with no extra subscription code.

Next: for more uses of derived values and effects, see [Find by scenario in the usage guide](./USEGUIDE.en.md#find-by-scenario); when server rendering or tests need isolated state, see [One Runtime per server request](./USEGUIDE.en.md#one-runtime-per-server-request).

## The traps of hand-written code

Here is a common hand-written "notify when a value changes". It runs, but it has three traps (for illustration only; no need to run it):

```ts doc-test=check
let price = 30
let quantity = 2
let total = price * quantity
const listeners = new Set<() => void>()

function setQuantity(next: number) {
  quantity = next
  // Trap 1: every place that changes data must remember to recalculate; forget this line in setPrice and the page shows an old total
  total = price * quantity
  // Trap 2: every write notifies at once, so changing two values renders twice, and the first render is half updated
  listeners.forEach((listener) => listener())
}

// Trap 3: subscriptions must be removed by hand; forget the delete when a component unmounts and the listener and everything it references stay in memory
listeners.add(() => console.log(total))
```

With a Runtime, a `computed` declares its rule once and registers dependencies as it reads them; a write only marks dependents as stale and effects run together in the next flush; and the cleanup function an effect returns runs automatically before each rerun and on `dispose()`.

## A three-minute mental model

Think of a `Runtime` as an independent spreadsheet: a `Signal` is an input cell, a `Computed` is a cell with a formula, and an `Effect` is an action such as "print or send a request when a cell changes".

| Concept | In one sentence |
| --- | --- |
| `Runtime` | An independent dependency graph, version clock and scheduler; nodes can depend on each other only within one `Runtime` |
| `Signal` | A writable value; reading `.value` registers a dependency and writing `.value` notifies dependents |
| `Computed` | A lazy, cached derived value that recomputes only when read |
| `Effect` | Reads its dependencies and performs a side effect; runs once on creation and is scheduled to rerun when a dependency changes |
| `batch()` / `flush()` | Merge several writes into one effect flush / run pending effects synchronously right now |
| trace | Read-only diagnostic events: value changes, dependency connections and disconnections, effect runs; it never affects application state |

A few terms:

- **Dependency tracking**: whatever `Signal` / `Computed` a `Computed` or `Effect` reads while running becomes its dependency automatically.
- **Flush**: actually running the queued effects. By default it happens in the microtask after a write.
- **Suspension**: a `Computed` with no readers disconnects from its inputs and stops recomputing on writes; the next read checks the inputs and recomputes only if they changed.

## Typical scenarios

| Scenario | How to combine | Details |
| --- | --- | --- |
| Derived values follow their inputs | `runtime.computed` + `runtime.effect` | [Usage guide](./USEGUIDE.en.md#keep-derived-values-in-sync-automatically) |
| Clean up old subscriptions when switching rooms or pages | an `effect` that returns a cleanup function | [Usage guide](./USEGUIDE.en.md#clean-up-the-old-subscription-before-switching) |
| Change several values at once | default microtask merging, or `runtime.batch` | [Usage guide](./USEGUIDE.en.md#several-writes-one-update) |
| Stop recomputing for a closed panel | automatic `computed` suspension, which `keepAlive` turns off | [Usage guide](./USEGUIDE.en.md#skip-work-nobody-reads) |
| Guard against effect loops | `maxFlushPasses` + `onError` | [Usage guide](./USEGUIDE.en.md#effects-feeding-each-other-do-not-freeze-the-page) |
| Isolate server rendering and tests | one `createRuntime()` per request or test | [Usage guide](./USEGUIDE.en.md#one-runtime-per-server-request) |

## Installation

```bash
pnpm add @migaia/reactive
```

| Entry | Contents |
| --- | --- |
| `@migaia/reactive` | `createRuntime`, `defaultRuntime`, the node types `IReactiveSignal` / `IReactiveComputed` / `IReactiveEffect`, diagnostic constants and error codes |
| `@migaia/reactive/extension` | Extension capabilities for store, collection, resource and UI framework adapter authors: ownership registration, custom data sources, observer binding and read-only version queries |

## Common APIs

| API | What it does |
| --- | --- |
| `createRuntime(options?)` | Creates an isolated Runtime; options set the scheduling, `maxFlushPasses`, `onError` and `onTrace` |
| `runtime.signal(value)` / `runtime.computed(fn)` / `runtime.effect(fn)` | Create writable values, derived values and effects; each has `dispose()` |
| `runtime.batch(fn)` / `runtime.flush()` | Merge several writes into one flush / flush synchronously right now |
| `runtime.untracked(fn)` | Read without registering dependencies |
| `runtime.subscribeTrace(listener)` | Subscribe to read-only diagnostic events |
| `createObserverBinding` (`/extension`) | Write a UI framework adapter: capture dependencies during render, subscribe after commit |

## Contract details

See the [usage guide](./USEGUIDE.en.md) for every signature, edge behavior and error code. Below are the constraints that matter most in daily use.

### The full lifecycle of one dependency graph

```ts
import { createRuntime } from '@migaia/reactive'

const runtime = createRuntime()

const count = runtime.signal(1)
const doubled = runtime.computed(() => count.value * 2)

const seen: number[] = []
const effect = runtime.effect(() => {
  seen.push(doubled.value)
}) // runs once synchronously on creation: seen = [2]

count.value = 3
runtime.flush() // flush pending effects by hand: seen = [2, 6]

effect.dispose()
doubled.dispose()
count.dispose()
```

This code builds a dependency graph owned by the current `runtime` alone. `runtime.effect()` runs once immediately on creation; while it runs it reads `doubled.value`, which registers the three-level dependency `Effect → Computed → Signal` automatically, so `seen` first receives `2`.

`count.value = 3` only invalidates `doubled` and queues `effect`; it does not rerun the effect inside the setter. `runtime.flush()` drains that runtime's queue synchronously: `doubled` recomputes to `6` when read, and then `effect` writes it into `seen`. Production code usually lets the default microtask flush automatically; tests, server rendering or code that needs a definite commit point call `flush()` explicitly.

Release from consumers to sources: stop `effect` first so cleanup does not observe data again, then the derived node `doubled`, and finally the source node `count`. `dispose()` disconnects dependency edges and forbids further reads of the released node. A `Runtime` itself has no `dispose()`; to manage nodes in bulk, hand them to `createLifecycleScope()` / `createSyncLifecycleScope()` from `@migaia/lifecycle` and release them together.

### Lifecycle, errors and limits

1. **Do not mix nodes across `Runtime`s**: a `Signal` created by one `Runtime` and read by a `Computed` / `Effect` of another throws `CROSS_RUNTIME`.
2. **Always create nodes through the Runtime factories**: `runtime.signal(value, options?)`, `runtime.computed(fn, config?)` and `runtime.effect(fn, options?)`, each with `dispose()` / `disposed`. The three node classes are internal and not exported as values.
3. **`runtime.effect(...)` runs once synchronously on creation**; it does not wait for a dependency change before its first run.
4. **Writing the same value to a `Signal` (by `Object.is`) triggers no notification** and does not advance its version.
5. **A `Computed` with no readers is suspended automatically** (its dependencies are disconnected; the next read first checks versions and topology and reuses the cache when nothing changed). Pass `{ keepAlive: true }` when it must keep computing while nobody reads it.
6. **Reading after `dispose()` throws `NODE_DISPOSED` immediately** instead of silently returning an old value, so nothing can "look alive but never update".
7. **`defaultRuntime` is a process-wide singleton.** Request isolation in server rendering, independent unit tests and Workers should all call `createRuntime()` explicitly.
8. **Scheduling is configurable**: by default flushes merge in a microtask; when creating a Runtime, `schedulerStrategy` can switch to `requestAnimationFrame`, idle callbacks or a custom strategy.
9. **Diagnostics never enter application state**: trace events and error reports use separate channels.

**Where it does not fit**: you only need local component state (the equivalent of `useState`) and no dependency graph shared across components; or you need ready-made observable collections or a state machine for async requests. The collection and resource packages in this repository build those on top of this package; it does not include them itself.

The general "release a group of resources together" container (formerly `Scope` / `createScope()`) has moved out of this package; use `createLifecycleScope()` / `createSyncLifecycleScope()` from `@migaia/lifecycle`.

### Multiple copies and the extension entry

The extension entry's `claimOwnership`, `ownerOf` and `assertOwnedBy` apply one ownership contract to plain objects and function objects: a registered function reports its original Runtime, a cross-Runtime check throws `CROSS_RUNTIME`, and a brand from another module copy throws `COPY_CONFLICT`.

Cross-copy diagnostics use two global Symbol keys, `@migaia/reactive.runtime-copies` and `@migaia/reactive.ownership-copy`. When upgrading, keep every reactive copy in one process on the same version: the old `@morning-watch/store` namespace and the new version cannot see each other, so mixed copies neither count each other nor recognize each other's ownership marks.

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
