# `@migaia/store-devtools`

Attach bounded local history, state replay, and action tracing to an existing Store, and inspect its real reactive dependencies.

## You may have run into this

- Jumping to an old state adds another history entry because a change listener treats replay writes as user edits.
- Action notes evict needed states because history and tracing share one retention limit.
- A failed debugging snapshot turns a business write into an exception because its callback is not isolated.
- Closing a debug panel destroys the Store because session ownership is confused with application ownership.
- The second path to a shared dependency disappears because a global visited set mistakes a diamond for a cycle.

## Why choose it

- **Replay state without recording synchronous replay as another edit.** Instead of adding a separate replay switch around a change listener, the example keeps history length stable during a jump and records the next edit, as shown in [the scenario](./USEGUIDE.en.md#replay-retained-state-without-creating-replay-history).
- **Retain recent history and actions independently.** Rather than mixing notes and states in one capacity, the example demonstrates separate eviction and increasing ids after clear, as shown in [the scenario](./USEGUIDE.en.md#bound-history-and-manual-action-queues-independently).
- **Report automatic snapshot failure while completing the business write.** The example keeps the diagnostic callback from breaking that write and checks original-error identity, manual failure, and the next recovered id in [the scenario](./USEGUIDE.en.md#report-snapshot-failure-without-interrupting-the-business-write).
- **Release diagnostics without destroying the application Store.** The example stops hidden history growth while leaving the Store writable, separating panel closure from state ownership in [the scenario](./USEGUIDE.en.md#release-diagnostics-while-leaving-the-store-usable).
- **Keep both paths to a shared dependency.** Rather than truncating a diamond with a global visited set, the example expands real Runtime nodes along both paths and checks zero depth in [the scenario](./USEGUIDE.en.md#expand-both-paths-of-a-shared-dependency).

## Start here

Save overview.ts in an ESM project and run it with Node 24; first install the diagnostics package and directly imported Store package:

```bash
pnpm add @migaia/store-devtools @migaia/store-light
```

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { createStoreDevTools } from '@migaia/store-devtools'

const store = createStore({ count: 0 })
const tools = createStoreDevTools(store, { captureRuntimeTrace: false })
try {
  const initial = tools.history[0]!.id
  store.count = 1
  store.$runtime.flush()
  tools.jumpTo(initial)
  console.log(store.count, tools.history.length)
} finally {
  tools.dispose()
  await store.$dispose()
}
```

Output:

```text
0 2
```

For queue retention, see [Bound history and manual action queues independently](./USEGUIDE.en.md#bound-history-and-manual-action-queues-independently); for recomputation sources, see [Expand both paths of a shared dependency](./USEGUIDE.en.md#expand-both-paths-of-a-shared-dependency).

createStore starts at count 0 and borrows the default Runtime when runtime is omitted. Explicit flush completes this change notification before replay. captureRuntimeTrace false overrides enabled capture. Other defaults are maxHistory 100, maxTrace 1000, diagnostic clone, and Date.now. Cleanup releases the session and Store separately.

## Pitfalls when writing it yourself

The same state-replay task, displayed without execution:

```ts doc-test=check
import { createStore } from '@migaia/store-light'

const store = createStore({ count: 0 })
const history = [store.$plain()]
const off = store.$subscribe(() => history.push(store.$plain())) // History has no retention bound
store.count = 1
store.$runtime.flush()
store.$hydrate(history[0]!)
store.$runtime.flush() // Replay adds history again, indistinguishable from an edit
void off // The panel still has not released its subscription
```

The preceding example uses jumpTo to suppress synchronous replay history and releases the diagnostic subscription in finally. The Store creator still disposes the Store separately. This handwritten version only displays the pitfalls of that same task and is not executed.

## A three-minute mental model

| Question                      | Tool              | Boundary                                                             |
| ----------------------------- | ----------------- | -------------------------------------------------------------------- |
| When did a field change?      | history / record  | Only $plain-supported state is retained, bounded by maxHistory.      |
| Can I revisit retained state? | jumpTo            | Hydrates known fields without undoing external effects.              |
| Which action failed?          | actions / trace   | Runtime-wide capture may include another Store on that Runtime.      |
| What drives recomputation?    | getDependencyTree | Reads upstream relationships without subscribing.                    |
| Who still observes a signal?  | getObserverTree   | Reads current downstream relationships; inspect again after changes. |
| Is debugging finished?        | tools.dispose     | Releases the session without disposing its borrowed Store / Runtime. |

A **session** owns diagnostic subscriptions and three queues. A **history id** is an increasing state anchor within that session; eviction makes it unavailable for replay. An **action** is a named Runtime execution record. A **dependency tree** is data expanded from current graph relationships rather than a continuously updating observer.

## Typical scenarios

| Scenario                                                           | How to combine                                     | Details                                                                                              |
| ------------------------------------------------------------------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Replay retained state without creating replay history              | createStoreDevTools → retain id → jumpTo → edit    | [Complete code](./USEGUIDE.en.md#replay-retained-state-without-creating-replay-history)              |
| Bound history and manual action queues independently               | maxHistory / maxTrace → recordAction → clear       | [Complete code](./USEGUIDE.en.md#bound-history-and-manual-action-queues-independently)               |
| Report snapshot failure without interrupting the business write    | Runtime.onError → clone → record                   | [Complete code](./USEGUIDE.en.md#report-snapshot-failure-without-interrupting-the-business-write)    |
| Release diagnostics while leaving the Store usable                 | dispose → read history → use Store                 | [Complete code](./USEGUIDE.en.md#release-diagnostics-while-leaving-the-store-usable)                 |
| Expand both paths of a shared dependency                           | Runtime handles → getDependencyTree                | [Complete code](./USEGUIDE.en.md#expand-both-paths-of-a-shared-dependency)                           |
| Find current subscribers after an effect releases its subscription | getObserverTree → effect.dispose → getObserverTree | [Complete code](./USEGUIDE.en.md#find-current-subscribers-after-an-effect-releases-its-subscription) |

## Installation

```bash
pnpm add @migaia/store-devtools @migaia/store-light
```

Graph and explicit Runtime examples import reactive directly, so install it directly too. Runtime dependencies resolve with the package, but a transitive dependency is not an application-level import contract.

```bash
pnpm add @migaia/reactive
```

## Essential APIs

| API                                  | When to use it                                        |
| ------------------------------------ | ----------------------------------------------------- |
| createStoreDevTools                  | Open diagnostics for an existing Store.               |
| tools.record / jumpTo                | Mark a replay anchor and restore a retained state.    |
| tools.actions / trace / recordAction | Inspect actions or events and add manual notes.       |
| tools.clear / dispose                | Start another history segment or end the session.     |
| getDependencyTree                    | Read upstream dependencies from an effect / computed. |
| getObserverTree                      | Read downstream subscribers from a signal / computed. |

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

STORE_DEVTOOLS_SOURCE is store.devtools. Branch on source / code rather than matching message text.

| StoreDevtoolsErrorCode property / value     | Trigger and response                                                                                                                 |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| sessionDisposed / SESSION_DISPOSED          | A diagnostic mutation after disposal; create another session instead of retrying the retired one.                                    |
| unknownHistoryEntry / UNKNOWN_HISTORY_ENTRY | jumpTo id is absent from current history; RangeError, so choose a retained id.                                                       |
| invalidOption / INVALID_OPTION              | Invalid options, getters, capacity, callback configuration, or tree depth; normally Error for options and RangeError for depth.      |
| callbackFailed / CALLBACK_FAILED            | Unclassified recording-preparation callback, replay clone, or action-property failure; correct it and inspect the original or cause. |
| cleanupFailed / CLEANUP_FAILED              | Multiple dispose failures, or construction failure plus rollback cleanup failure; inspect AggregateError.errors.                     |

Three factories are public but rarely needed by ordinary callers. createStoreDevtoolsError(code, message, options?) returns a tagged native Error, with optional options.cause. createStoreDevtoolsRangeError(code, message) returns RangeError. createStoreDevtoolsAggregateError(code, errors, message) returns AggregateError; errors is a required readonly list retaining all values without deduplication. code and message are required, code has type IStoreDevtoolsErrorCode, and factories do not overwrite stack.

Package maintenance uses the existing fmt, lint, typecheck, typecheck:test, test, and build scripts. Actual gate reports establish execution results; a command list in this section does not imply they were run.
