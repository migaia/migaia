# `@migaia/store-devtools` Usage guide

Record local diagnostics for an existing Store and inspect its real reactive graph. Start with the [README](./README.en.md).

## Find a scenario

| Task                                                               | How to combine                                         | Complete example                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Replay retained state without creating replay history              | createStoreDevTools → retain id → jumpTo → edit        | [Code and output](#replay-retained-state-without-creating-replay-history)              |
| Bound history and manual action queues independently               | maxHistory / maxTrace → recordAction → clear           | [Code and output](#bound-history-and-manual-action-queues-independently)               |
| Report snapshot failure without interrupting the business write    | Runtime.onError → clone → record                       | [Code and output](#report-snapshot-failure-without-interrupting-the-business-write)    |
| Release diagnostics while leaving the Store usable                 | dispose → read history → use Store                     | [Code and output](#release-diagnostics-while-leaving-the-store-usable)                 |
| Expand both paths of a shared dependency                           | Runtime.signal / computed / effect → getDependencyTree | [Code and output](#expand-both-paths-of-a-shared-dependency)                           |
| Find current subscribers after an effect releases its subscription | getObserverTree → effect.dispose → getObserverTree     | [Code and output](#find-current-subscribers-after-an-effect-releases-its-subscription) |

## Before running

Save each scenario as an independent .ts file and run it in an ESM project with Node 24. They use real Stores, Runtimes, and public handles without a browser extension.

```bash
pnpm add @migaia/store-devtools @migaia/store-light @migaia/reactive
```

## Replay retained state without creating replay history

An investigation needs to revisit an earlier Store state and then continue editing from it.

A plain change listener can record the hydration caused by replay as another user edit, making the history grow every time the investigator jumps.

Attach tools to a real Store, retain its initial id, and call jumpTo(); the session suppresses replay-generated history while later edits still record.

### Example parameters

This example explicitly creates a Runtime and passes it to the Store. schedulerStrategy: (run) => run() makes scheduling synchronous for stepwise observation; omission uses Runtime's injected microtask scheduling. The Store begins with count 0 and options.runtime selects that instance. captureRuntimeTrace false disables automatic trace / actions without disabling state history. Other defaults are maxHistory 100, maxTrace 1000, diagnostic clone, and Date.now.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { createStoreDevTools } from '@migaia/store-devtools'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const store = createStore({ count: 0 }, { runtime })
const tools = createStoreDevTools(store, { captureRuntimeTrace: false })
try {
  const initial = tools.history[0]!
  store.count = 1
  store.count = 2
  console.log(store.count, tools.history.length)
  tools.jumpTo(initial.id)
  console.log(store.count, tools.history.length)
  store.count = 1
  console.log(store.count, tools.history.length)
  console.log(initial.state.count, Object.isFrozen(initial.state))
} finally {
  tools.dispose()
  await store.$dispose()
}
```

Output:

```text
2 3
0 3
1 4
0 true
```

Output is `2 3`, `0 3`, `1 4`, then `0 true`: replay restores count without extending history, the next edit records again, and the initial state stays shallow-frozen.

jumpTo hydrates retained Store fields; it does not undo external side effects, restore evicted entries, or guarantee deep isolation for every diagnostic value.

## Bound history and manual action queues independently

A long debugging session needs a small recent history while still retaining selected manual action notes.

One shared queue can make action notes evict states, and treating clear as a fresh session can reuse old ids or leave ambiguous anchors.

Set independent maxHistory and maxTrace limits, disable automatic trace, add manual actions, then clear and inspect the new initial entry.

### Example parameters

maxHistory and maxTrace are both overridden to 2 but bound separate queues. Manual recordAction remains available with captureRuntimeTrace false. now: () => 100 supplies a deterministic timestamp, replacing Date.now. recordAction.name is its note and tools supplies timestamp. jumpTo takes a history id; clear takes no arguments and does not reset ids.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { createStoreDevTools } from '@migaia/store-devtools'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const store = createStore({ count: 0 }, { runtime })
const tools = createStoreDevTools(store, {
  maxHistory: 2,
  maxTrace: 2,
  captureRuntimeTrace: false,
  now: () => 100
})
try {
  const initialId = tools.history[0]!.id
  store.count = 1
  store.count = 2
  store.count = 3
  for (const name of ['first', 'second', 'third']) tools.recordAction({ name })
  console.log(tools.history.map((entry) => entry.state.count).join(','))
  console.log(tools.actions.map((entry) => entry.name).join(','), tools.trace.length)
  try {
    tools.jumpTo(initialId)
  } catch (error) {
    const failure = error as Error & { code?: string }
    if (failure.code !== 'UNKNOWN_HISTORY_ENTRY') throw error
    console.log(failure instanceof RangeError, failure.code)
  }
  tools.clear()
  console.log(
    tools.history[0]!.id,
    tools.history[0]!.label,
    tools.actions.length,
    tools.trace.length
  )
} finally {
  tools.dispose()
  await store.$dispose()
}
```

Output:

```text
2,3
second,third 0
true UNKNOWN_HISTORY_ENTRY
5 initial 0 0
```

Output is `2,3`, `second,third 0`, `true UNKNOWN_HISTORY_ENTRY`, then `5 initial 0 0`: queues keep their own newest entries and clear preserves the id sequence.

maxHistory defaults to 100; maxTrace defaults to 1000 for each of actions and trace, and captureRuntimeTrace false also disables automatic action capture.

## Report snapshot failure without interrupting the business write

A diagnostic snapshot callback fails during an ordinary Store update, but the update must remain usable.

Letting that callback escape the Store listener turns a debugging failure into a business failure; reserving an id before preparation also leaves a hole after failure.

Use the real Runtime reporter and a failing clone callback; automatic capture reports the original error, while manual record throws it before publishing.

### Example parameters

Runtime onError receives the actual error, collected in reports here; omission uses Runtime's default reporter. The custom clone only spreads the top level, throwing the same TypeError after fail is enabled; the default clone is diagnostic. captureRuntimeTrace false keeps this example focused on state snapshots. Omitted record label defaults to state change.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { createStoreDevTools } from '@migaia/store-devtools'

const reports: unknown[] = []
const runtime = createRuntime({
  schedulerStrategy: (run) => run(),
  onError: (error) => {
    reports.push(error)
  }
})
const store = createStore({ count: 0 }, { runtime })
const original = new TypeError('diagnostic snapshot failed')
let fail = false
const tools = createStoreDevTools(store, {
  captureRuntimeTrace: false,
  clone: (state) => {
    if (fail) throw original
    return { ...state }
  }
})
try {
  fail = true
  store.count = 1
  console.log(store.count, tools.history.length)
  console.log(reports[0] === original, (original as Error & { code?: string }).code)
  try {
    tools.record()
  } catch (error) {
    if (error !== original) throw error
    console.log(error === original)
  }
  fail = false
  console.log(tools.record().id)
} finally {
  tools.dispose()
  await store.$dispose()
}
```

Output:

```text
1 1
true CALLBACK_FAILED
true
2
```

Output is `1 1`, `true CALLBACK_FAILED`, `true`, then `2`: the write succeeds, automatic reporting keeps the original TypeError, manual recording throws it, and recovery uses the next id.

Only diagnostic preparation is isolated here; unclassified replay clone failures throw with `CALLBACK_FAILED`, while Store hydration keeps its own failure path; this custom clone is a shallow spread.

## Release diagnostics while leaving the Store usable

A debugging panel closes, while the application still needs the Store it was inspecting.

Disposing the Store with the panel releases a resource owned by the application, but keeping the diagnostic listeners attached makes hidden history keep growing.

Dispose only the diagnostic session, retain its read-only queues, and continue writing the real Store; new diagnostic mutations reject.

### Example parameters

dispose takes no arguments, is synchronous and idempotent, and retires record while leaving history readable. The Store and Runtime are borrowed, so tools.dispose does not destroy them. finally separately calls store.$dispose. Runtime scheduling and Store initial state follow the preceding examples.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createStore } from '@migaia/store-light'
import { createStoreDevTools } from '@migaia/store-devtools'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const store = createStore({ count: 0 }, { runtime })
const tools = createStoreDevTools(store, { captureRuntimeTrace: false })
try {
  tools.dispose()
  tools.dispose()
  store.count = 1
  console.log(store.count, tools.history.length)
  try {
    tools.record()
  } catch (error) {
    const failure = error as Error & { code?: string }
    if (failure.code !== 'SESSION_DISPOSED') throw error
    console.log(failure.code)
  }
  store.count = 2
  console.log(store.count)
} finally {
  tools.dispose()
  await store.$dispose()
}
```

Output:

```text
1 1
SESSION_DISPOSED
2
```

Output is `1 1`, `SESSION_DISPOSED`, then `2`: repeated disposal is harmless, the old history remains readable and unchanged, and the caller-owned Store still accepts writes.

Session dispose detaches its Store and Runtime subscriptions; it does not clear queues or dispose the borrowed Store, which the caller releases separately.

## Expand both paths of a shared dependency

Two computed values share one signal, and an effect reads both; an investigation needs to see both paths back to that signal.

A global visited set can label the second shared path as a cycle or omit it, even though that path does not recurse into itself.

Build the diamond with real Runtime handles and inspect the effect; traversal tracks only the current path and respects an explicit depth bound.

### Example parameters

The source signal starts at 1. left / right read it and the effect reads both computed values, creating real dependencies. debugName labels diagnostics; tree labels otherwise fall back to constructor.name and AnonymousReactiveNode. getDependencyTree defaults maxDepth to 20, while explicit 0 leaves direct edges unexpanded. The function does not own these handles, so their creator releases them.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { getDependencyTree } from '@migaia/store-devtools'

const runtime = createRuntime()
const source = runtime.signal(1, { debugName: 'source' })
const left = runtime.computed(() => source.value + 1, { debugName: 'left' })
const right = runtime.computed(() => source.value + 2, { debugName: 'right' })
const view = runtime.effect(
  () => {
    void (left.value + right.value)
  },
  { debugName: 'view' }
)
try {
  const tree = getDependencyTree(view)
  console.log(tree.label, tree.children.map((node) => node.label).join(','))
  console.log(tree.children.map((node) => node.children[0]!.label).join(','))
  console.log(tree.children.every((node) => node.children[0]!.circular !== true))
  console.log(getDependencyTree(view, 0).children.length)
} finally {
  view.dispose()
  left.dispose()
  right.dispose()
  source.dispose()
}
```

Output:

```text
view left,right
source,source
true
0
```

Output is `view left,right`, `source,source`, `true`, then `0`: both shared paths expand without a cycle flag, and maxDepth zero returns no direct edges.

The default depth is 20 and must be a nonnegative safe integer; this is an instantaneous upstream view, not a new subscription or an effect execution.

## Find current subscribers after an effect releases its subscription

A signal feeds a computed value and two effects, but one panel has already stopped observing it.

A separately maintained subscriber list can retain the closed panel and mislead an investigation into what can still rerun.

Read the real signal's downstream tree, dispose one effect through its public handle, and inspect again without creating a diagnostic session.

### Example parameters

count starts at 2, total computes count × 2, and both effects read total. debugName labels the nodes. getObserverTree accepts real signal / computed handles, defaults maxDepth to 20, and returns only the root at 0. Its returned tree is not a live subscription; call it again after first.dispose to read current relationships.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { getObserverTree } from '@migaia/store-devtools'

const runtime = createRuntime()
const count = runtime.signal(2, { debugName: 'count' })
const total = runtime.computed(() => count.value * 2, { debugName: 'total' })
const first = runtime.effect(
  () => {
    void total.value
  },
  { debugName: 'first' }
)
const second = runtime.effect(
  () => {
    void total.value
  },
  { debugName: 'second' }
)
try {
  const before = getObserverTree(count)
  console.log(before.label, before.children[0]!.label)
  console.log(before.children[0]!.children.map((node) => node.label).join(','))
  first.dispose()
  console.log(
    getObserverTree(count)
      .children[0]!.children.map((node) => node.label)
      .join(',')
  )
  console.log(getObserverTree(count, 0).children.length)
} finally {
  first.dispose()
  second.dispose()
  total.dispose()
  count.dispose()
}
```

Output:

```text
count total
first,second
second
0
```

Output is `count total`, `first,second`, `second`, then `0`: the fresh tree reflects public effect disposal, while a zero depth omits all subscriber edges.

The default depth is 20; returned trees are point-in-time data and do not update themselves after another subscription change.

## Contract details

### Responsibility and public surface

This package adds a local diagnostic session to an existing Store. It neither creates the Store nor rewrites or proxies its mutation path. It uses the Store's $subscribe, $runtime.subscribeTrace / reportError, $plain, and $hydrate, records in-memory history and actions, and exposes two independent reactive graph traversals. Use it to investigate state changes, failed actions, and dependencies; it is not durable auditing, network replay, or transactional reversal of external effects.

The only entry is `@migaia/store-devtools`. It exports createStoreDevTools, getDependencyTree, getObserverTree, five public data types, error codes, and three error factories. reactive, store-light, store-middleware, and utils are runtime dependencies. Still install reactive / store-light directly when your examples import them.

This package does not implement the browser extension protocol. Use [Store Middleware](../store-middleware/README.en.md) and its createReduxDevToolsAdapter / connectDevTools for Redux DevTools. StoreDevtoolsCommand / IStoreDevtoolsCommand were removed from this entry; custom bridges import ReduxDevToolsCommand / IReduxDevToolsCommand from store-middleware. DISPATCH, COMMIT, JUMP_TO_STATE, JUMP_TO_ACTION, ROLLBACK, and RESET retain their values. This is an import migration, not another protocol layer.

### Construction and subscription scope

`createStoreDevTools<S>(store, options?)` synchronously returns IStoreDevTools. store must be a real `IReactiveStore<S>` returned by createStore. The session borrows its Store and Runtime rather than disposing them. Omitted options is an empty object.

| Option              | Default and behavior                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| maxHistory          | 100; bounds history only and must be a positive safe integer.                                                                   |
| maxTrace            | 1000; independently bounds actions and trace, with no maxActions option.                                                        |
| captureRuntimeTrace | Enabled unless strictly false; false skips the Runtime trace subscription and automatic action capture.                         |
| now                 | Date.now; timestamps history and action records, and must be a function when supplied.                                          |
| clone               | ClonePolicy.diagnostic; receives $plain() or retained history state and returns a record, and must be a function when supplied. |

Null / non-object options produce INVALID_OPTION. Failed reflection or option-property reads use the same code and preserve the caught failure on cause. Construction obtains descriptors and then reads the five options; getters can run during those property reads. This admission does not promise to avoid all getters. Queue limits use nullish defaults before validation, rejecting zero, negatives, fractions, infinity, and NaN rather than clamping them. Non-function now / clone options also reject before subscription.

After configuration admission, construction synchronously records the initial entry, then subscribes to coarse changes of the selected Store. Trace capture subscribes to that Store's entire Runtime. Actions from another Store or runTracedAction on a shared Runtime can therefore appear; they are not automatically filtered to this Store. Invalid configuration acquires no subscriptions. A later subscription failure rolls back those already acquired; error retention is described below.

### History, replay, and clearing

| Member         | Input, output, and effect                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| history        | Each read returns a new frozen chronological array of IStoreHistoryEntry values.                                                                     |
| record(label?) | Defaults label to state change; prepares timestamp and state before allocating an id, appending, and returning the entry.                            |
| jumpTo(id)     | Requires a retained history id; missing or evicted ids produce UNKNOWN_HISTORY_ENTRY RangeError, otherwise clone(state) is passed to Store $hydrate. |
| clear()        | Takes no arguments; prepares a replacement initial before clearing all three queues and publishing it, without resetting the id sequence.            |

IStoreHistoryEntry contains id, timestamp, label, and state. Its public fields have no additional readonly modifiers, but the published entry and top level of state are frozen. An array snapshot does not grow with later publication. Nested independence depends on clone rather than deep freezing every possible graph. maxHistory evicts the oldest entries, including initial; retaining an evicted id does not make it a valid jump target.

record obtains clone(store.$plain()). $plain includes signal-backed Store fields, excluding computed values, methods, and WASM fields. Default diagnostic cloning uses the shared structured-clone-first implementation for a best-effort copy. Unsupported or unsafe subtrees can remain aliases, and custom class prototypes need not survive. It does not redact secrets. Provide an explicit clone to remove tokens or other sensitive fields, or keep them outside recorded state.

Failed record / clear preparation publishes no partial history and consumes no id. Failed clear preparation preserves all existing queues. Preparation also rechecks whether a callback disposed the session; if so it throws SESSION_DISPOSED rather than publishing.

jumpTo is not a business transaction rollback. $hydrate writes known signal fields and follows the Store's own rules for ignoring unknown, derived, or WASM keys. Computed values recalculate from dependencies; external resources and already sent requests are not restored. A replay-depth counter suppresses history publication during synchronous replay, including nested jumpTo, rather than suppressing Runtime trace / actions or guaranteeing suppression of later scheduled notifications. Replay clone failures also use the existing CALLBACK_FAILED classification with the original error or cause retained. $hydrate failures continue through the upstream Store path; arbitrary replay exceptions are not all relabeled with a local code.

### Actions and Runtime trace

| Data                 | Fields and publication                                                                                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| IActionTrace         | timestamp and name, with optional payload, durationMs, and error.                                                                                   |
| actions              | Automatically records Runtime action events other than start, independently bounded by maxTrace.                                                    |
| recordAction(action) | Requires an action without timestamp, normally at least name; spreads its own enumerable properties, adds now(), rechecks disposal, then publishes. |
| trace                | Retains original IRuntimeTraceEvent values, independently bounded by maxTrace, without converting event objects.                                    |

Store-defined methods are wrapped as named actions, typically debugName.methodName. Both successful end and failed error events are recorded, with error supplied only on failure. $batch / $set / $hydrate do not pass through a Store method's runTracedAction wrapper, so those calls alone do not imply an action record; record one manually if needed. With captureRuntimeTrace false, trace stays empty while actions still accepts recordAction. This disables one diagnostic subscription rather than state history or the Store's mutation policy.

| trace.type        | Principal fields and values                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| observable-change | timestamp, observable, and reason set / notify.                                                                  |
| dependency        | timestamp, observable, observer, phase connect / disconnect, and optional reason retrack / invalidate / dispose. |
| observer-run      | timestamp, observer, phase start / end / error, and optional durationMs / error.                                 |
| action            | timestamp, name, phase start / end / error, and optional durationMs / error.                                     |

Node descriptors contain id, kind (observable / observer / computed), and optional debugName; action has no general node descriptor. reactive owns this union. Runtime timestamps and durations follow Runtime semantics rather than necessarily using this session's now function.

actions / trace getters also return fresh frozen arrays, but action entries and trace events themselves are not frozen. Nested payloads and errors retain references. The three queues have independent entry limits, not a total byte or application-memory cap. Reading them allocates array snapshots; no measured speed conclusion follows.

### Callback failure and lifetime

Failures in record preparation's now / clone, replay clone, or recordAction property reads are classified as CALLBACK_FAILED. An extensible native error without an identity stays the same object with its type and stack. A complete foreign source/code remains unchanged. Frozen errors, non-Errors, or conflicting partial identities remain on cause, and failed identity reflection is retained in an aggregate. Manual record / recordAction / clear calls and jumpTo clone preparation throw. Automatic Store / Runtime listeners report through Runtime.reportError with phase trace-listener, preventing diagnostic failure from turning the triggering normal mutation into a thrown business error. Runtime owns reporter containment and host fallback.

dispose() takes no arguments, is synchronous and idempotent, and marks the session terminal before attempting Store and trace unsubscription. One cleanup failure is rethrown unchanged; multiple failures become CLEANUP_FAILED AggregateError with all originals in errors. Even if the first call throws, later dispose calls neither repeat cleanup nor throw again.

After disposal, record / recordAction / jumpTo / clear first throw SESSION_DISPOSED. history / actions / trace remain readable without clearing retained data or further growth from session listeners. The borrowed Store and Runtime remain caller-owned. Create diagnostics when needed during development and dispose them when a component or debugging session ends to stop retained subscriptions and snapshot work.

Construction rollback attempts trace unsubscribe before Store unsubscribe. If cleanup succeeds, the primary failure propagates unchanged. Otherwise CLEANUP_FAILED AggregateError.errors begins with that primary failure followed by cleanup errors. Subscription and single-cleanup exceptions retain their provider's public identity instead of being forcibly relabeled.

### Independent reactive graph tools

getDependencyTree(root, maxDepth?) reads observer deps and accepts real Runtime effect / computed handles or an extension IObserver. getObserverTree(root, maxDepth?) follows observable subs in reverse and accepts signal / computed handles or an extension IObservable. Neither requires a devtools session, creates business dependencies, or owns the nodes.

maxDepth defaults to 20 and must be a nonnegative safe integer. At 0, even the root's immediate edges remain unexpanded. Negative, fractional, NaN, and infinite values synchronously produce INVALID_OPTION RangeError. Traversal uses the actual graph; examples need no fabricated cycles or nodes.

| IDependencyTreeNode field | Meaning                                                                                         |
| ------------------------- | ----------------------------------------------------------------------------------------------- |
| kind                      | observable / observer, reflecting the node's role in this traversal direction.                  |
| label                     | debugName, then constructor.name, then AnonymousReactiveNode.                                   |
| version                   | The current observable version; a dependency root represented as observer has no version field. |
| children                  | The successors expanded in this tree.                                                           |
| circular                  | True only when this node is already on the current recursion path, stopping expansion there.    |

A shared node reached through two distinct diamond branches is not circular and expands on both paths. Only an actual path revisit sets circular. Reaching maxDepth stops expansion without marking a cycle. A Computed has both roles: it is an observable child in dependency traversal and an observer child in subscriber traversal. These data dependencies are distinct from plugin capability graphs.

### Errors, factories, and maintenance commands

STORE_DEVTOOLS_SOURCE is @migaia/store-devtools. Branch on source / code rather than matching message text.

| StoreDevtoolsErrorCode property / value     | Trigger and response                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| sessionDisposed / SESSION_DISPOSED          | A diagnostic mutation after disposal; create another session instead of retrying the retired one.                                    |
| unknownHistoryEntry / UNKNOWN_HISTORY_ENTRY | jumpTo id is absent from current history; RangeError, so choose a retained id.                                                       |
| invalidOption / INVALID_OPTION              | Invalid options, getters, capacity, callback configuration, or tree depth; normally Error for options and RangeError for depth.      |
| callbackFailed / CALLBACK_FAILED            | Unclassified recording-preparation callback, replay clone, or action-property failure; correct it and inspect the original or cause. |
| cleanupFailed / CLEANUP_FAILED              | Multiple dispose failures, or construction failure plus rollback cleanup failure; inspect AggregateError.errors.                     |

Three factories are public but rarely needed by ordinary callers. createStoreDevtoolsError(code, message, options?) returns a tagged native Error, with optional options.cause. createStoreDevtoolsRangeError(code, message) returns RangeError. createStoreDevtoolsAggregateError(code, errors, message) returns AggregateError; errors is a required readonly list retaining all values without deduplication. code and message are required, code has type IStoreDevtoolsErrorCode, and factories do not overwrite stack.

Package maintenance uses the existing fmt, lint, typecheck, typecheck:test, test, and build scripts. Actual gate reports establish execution results; a command list in this section does not imply they were run.
