# `@migaia/store-middleware` usage guide

Choose a production task first, then consult the event, policy, pipeline, clone, and disposal contracts. Every example runs independently without a browser extension or external service.

## Find a scenario

| Scenario                                                        | API                         | Details                                                                              |
| --------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| Observe a Store and detach without disposing it                 | `bindStoreMiddleware`       | [Complete example](#observe-a-store-and-detach-without-disposing-it)                 |
| Share one strict policy between a Store and its host            | `bindStoreMiddleware`       | [Complete example](#share-one-strict-policy-between-a-store-and-its-host)            |
| Keep a diagnostic sink failure separate from a business failure | `createStoreMiddlewareHost` | [Complete example](#keep-a-diagnostic-sink-failure-separate-from-a-business-failure) |
| Release bindings in reverse order and retain cleanup failures   | `createStoreMiddlewareHost` | [Complete example](#release-bindings-in-reverse-order-and-retain-cleanup-failures)   |
| Reenter the action scope after an await                         | `MutationPolicy`            | [Complete example](#reenter-the-action-scope-after-an-await)                         |
| Choose strict independence or explicit reference sharing        | `ClonePolicy`               | [Complete example](#choose-strict-independence-or-explicit-reference-sharing)        |

## Running the examples

```bash
pnpm add @migaia/store-middleware @migaia/store-light @migaia/reactive
```

Binding examples import store-light directly; standalone Host examples import reactive. Every Host requires execution.mutationTimeoutMs and execution.pipelineDrainTimeoutMs with no default. These examples explicitly use false to remove both deadlines. Store.$runtime.flush() is the public synchronous flush entry, completing state observations before output is read without extending the action scope.

## Observe a Store and detach without disposing it

A diagnostics panel needs action and state events from an existing Store. Closing the panel must stop those observations while leaving application state usable.

Wrapping an already traced Store action in another action adds duplicate action boundaries. Treating the binding as the Store owner also makes panel cleanup destroy live state.

bindStoreMiddleware forwards the Store’s own traces and state notifications. Install store-light directly, use loggerMiddleware to collect event types, flush the Store Runtime, and dispose the binding separately.

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { bindStoreMiddleware, loggerMiddleware } from '@migaia/store-middleware'
const events: string[] = []
const store = createStore({
  count: 0,
  increment() {
    this.count += 1
  }
})
const host = bindStoreMiddleware(store, {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
await host.use(
  loggerMiddleware((event) => {
    events.push(event.type)
  })
)
store.increment()
store.$runtime.flush()
console.log(
  events.filter((type) => type === 'action').length,
  events.includes('state'),
  store.count
)
await host.dispose()
events.length = 0
store.increment()
store.$runtime.flush()
console.log(events.length, store.count)
await store.$dispose()
```

Output:

```text
2 true 1
0 2
```

Prints `2 true 1` and `0 2`. The first action produces two action events and a state event; after binding disposal, another action changes the Store without reaching the old middleware.

Execution budgets are required; false explicitly removes each deadline. The binding borrows Store and Runtime. Its default diagnostic clone is best effort and may retain unsupported subtrees by reference.

### Example parameters

The createStore shape contains count and an increment method, without a custom mutationPolicy. Both binding execution fields are false. Other options are omitted: the Host has an off policy, undefined actionPrefix, and diagnostic cloning. The loggerMiddleware sink collects event.type; omitting it uses console.log. Store and Runtime are borrowed; the application finally calls Store.$dispose.

## Share one strict policy between a Store and its host

A component must not assign state directly, while both a Store method and a host-managed action need permission to update that same state.

Creating two actions-only policies gives each its own action depth. Entering the host policy cannot authorize writes guarded by a different Store policy.

Create one actions-only policy and pass the same object to createStore and bindStoreMiddleware. Install store-light directly; the Store enforces the guard and host.runAction enters that shared scope.

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { bindStoreMiddleware, createMutationPolicy } from '@migaia/store-middleware'

const policy = createMutationPolicy('actions-only')
const store = createStore(
  {
    count: 0,
    increment() {
      this.count += 1
    }
  },
  { mutationPolicy: policy }
)
const host = bindStoreMiddleware(store, {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  mutationPolicy: policy
})
try {
  try {
    store.count = 1
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error)) throw error
    console.log(error.code)
  }
  host.runAction('set', () => {
    store.count = 2
  })
  console.log(host.mutationPolicy === policy, store.count)
  store.increment()
  console.log(store.count)
} finally {
  await host.dispose()
  await store.$dispose()
}
```

Output:

```text
ACTION_SCOPE_REQUIRED
true 2
3
```

Prints `ACTION_SCOPE_REQUIRED`, `true 2`, and `3`. Direct assignment is rejected, the host exposes the identical policy and can write inside its action, and the Store’s own action remains usable.

The default policy mode is off. A policy checks permission; it is not a transaction and cannot undo user side effects. Scope covers only synchronous execution, so reenter it around writes after await.

### Example parameters

createMutationPolicy mode defaults to off; this example chooses actions-only. Store options.mutationPolicy and binding options.mutationPolicy receive the identical object. Both execution budgets are false. runAction name is diagnostic, fn writes synchronously, and metadata is undefined. Store methods enter their own action scope, while direct field writes encounter the guard.

## Keep a diagnostic sink failure separate from a business failure

A logging sink fails during action observation. The application must still run its business function, while a real business exception must reach the caller.

Calling a diagnostic sink directly on the business path lets a logging outage abort the action. Swallowing every exception instead hides genuine business failure and can imply rollback that never occurred.

createStoreMiddlewareHost isolates runAction observation and reports failures to the supplied Runtime. Install reactive directly; onError collects diagnostics, while the business callback still returns or throws.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createStoreMiddlewareHost, loggerMiddleware } from '@migaia/store-middleware'

const reports: unknown[] = []
const runtime = createRuntime({
  onError: (error) => {
    reports.push(error)
  }
})
const state = { count: 0 }
const diagnostic = new Error('diagnostic sink failed')
const business = new Error('business operation failed')
const host = createStoreMiddlewareHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  runtime,
  getState: () => state
})
try {
  await host.use(
    loggerMiddleware(() => {
      throw diagnostic
    })
  )
  const result = host.runAction('save', () => {
    state.count = 1
    return 42
  })
  console.log(result, state.count, reports.length)
  try {
    host.runAction('fail', () => {
      state.count = 2
      throw business
    })
  } catch (error) {
    console.log(error === business, state.count, reports.length)
  }
} finally {
  await host.dispose()
}
```

Output:

```text
42 1 2
true 2 4
```

Prints `42 1 2` and `true 2 4`. The successful business result survives two diagnostic reports; the failed action throws the same business Error and leaves its prior assignment applied.

runAction and recordState/recordError isolate observation failures; public emit can throw pipeline failures. runAction batches synchronously and does not roll back writes or wait for a returned Promise.

### Example parameters

createRuntime.onError receives diagnostic errors; omitting it selects Runtime adapter.reportError. Host runtime and getState are required. getState returns the state reference without implicit copying. applyState is omitted and mutationPolicy defaults to off. Both execution budgets are false. The logger sink throws synchronously, while the two runAction calls return or throw a local original error.

## Release bindings in reverse order and retain cleanup failures

A panel owns two binding cleanups and a plugin resource. One binding cleanup fails, but the remaining binding and plugin must still be released.

Stopping on the first cleanup exception leaves later resources behind. Independent dispose calls can also repeat cleanup unless they share one terminal operation.

Attach synchronous binding disposers to createStoreMiddlewareHost and register plugin cleanup through core.onDispose. Install reactive directly; host.dispose runs bindings in reverse order before delegated plugin cleanup.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createStoreMiddlewareHost, type IStoreMiddlewarePlugin } from '@migaia/store-middleware'

type IState = { count: number }
const order: string[] = []
const original = new Error('binding cleanup failed')
const host = createStoreMiddlewareHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  runtime: createRuntime(),
  getState: () => ({ count: 0 })
})
host.attachBindingDisposer(() => {
  order.push('first')
})
host.attachBindingDisposer(() => {
  order.push('second')
  throw original
})
const plugin: IStoreMiddlewarePlugin<IState> = {
  name: 'owned',
  install: (core) => {
    core.onDispose(() => {
      order.push('plugin')
    })
    return {}
  }
}
await host.use(plugin)
const first = host.dispose()
const second = host.dispose()
console.log(first === second)
const result = await first
console.log(JSON.stringify(order))
console.log(
  result.cleanupComplete,
  result.cleanupErrors.length,
  result.cleanupErrors[0] === original
)
```

Output:

```text
true
["second","first","plugin"]
true 1 true
```

Prints `true`, `["second","first","plugin"]`, and `true 1 true`. Calls share one disposal Promise, cleanup proceeds in the shown order, and the original failure remains in cleanupErrors.

cleanupComplete describes completed delegated cleanup, not an empty error list; settled binding failures are still recorded. Binding disposers here are synchronous; this does not claim every plugin hook is serial.

### Example parameters

The Host receives createRuntime() and getState with both execution budgets false. attachBindingDisposer takes a synchronous no-argument function; later registrations run first. The plugin name is unique within this Host; install(core) registers cleanup with core.onDispose and returns an empty extension. dispose takes no arguments. cleanupComplete and cleanupErrors describe completion and failure separately.

## Reenter the action scope after an await

An asynchronous flow starts inside an allowed action, awaits another step, then attempts a protected write. The later continuation must not inherit a permission scope that has already returned.

Keeping one global action flag open until a Promise settles authorizes unrelated work in the meantime. Treating a synchronous guard as an async transaction also hides where permission ends.

MutationPolicy.runInAction increments depth only while invoking its callback and restores it in finally. Check insideAction before and after returning, await the rejection, then explicitly reenter for a synchronous write.

```ts doc-test=run
import { MutationPolicy } from '@migaia/store-middleware'

const policy = new MutationPolicy('actions-only')
let insideBeforeAwait = false
const pending = policy.runInAction(async () => {
  insideBeforeAwait = policy.insideAction
  await Promise.resolve()
  policy.assertMutationAllowed('deferred write')
})
console.log(insideBeforeAwait, policy.insideAction)
try {
  await pending
} catch (error) {
  if (!(error instanceof Error) || !('code' in error)) throw error
  console.log(error.code, policy.insideAction)
}
policy.runInAction(() => {
  policy.assertMutationAllowed('synchronous write')
})
console.log('reentered')
```

Output:

```text
true false
ACTION_SCOPE_REQUIRED false
reentered
```

Prints `true false`, `ACTION_SCOPE_REQUIRED false`, and `reentered`. The async callback begins inside the scope, its continuation is denied after await, and explicit reentry succeeds.

Mode defaults to off; this example chooses actions-only. runInAction returns the callback result immediately, supports nested synchronous scopes, and does not await or automatically catch later Promise rejection.

### Example parameters

MutationPolicy mode is explicitly actions-only, defaulting to off when omitted. runInAction immediately returns fn's Promise; a later await does not preserve the synchronous scope. assertMutationAllowed operation defaults to 'mutation'; the supplied strings identify diagnostics only. insideAction is readonly state, not an externally writable permission flag.

## Choose strict independence or explicit reference sharing

Audit history needs independent nested data, while diagnostics may need to keep a callback that cannot be cloned. The caller must choose which guarantee matters.

A generic fallback clone can silently return live references when history expected isolation. Calling a result immutable can also wrongly imply that the returned object is frozen.

ClonePolicy.immutable requires an independent supported data graph, opaque returns the same reference, and diagnostic copies what it can. The strict path rejects accessors without running their getters.

```ts doc-test=run
import { ClonePolicy } from '@migaia/store-middleware/tolerant-clone'

const source = { nested: { count: 1 } }
const independent = ClonePolicy.immutable(source)
const same = ClonePolicy.opaque(source)
source.nested.count = 2
console.log(independent.nested.count, same.nested.count, independent === source, same === source)
let reads = 0
const accessor = Object.defineProperty({}, 'value', {
  enumerable: true,
  get: () => {
    reads += 1
    return 1
  }
})
try {
  ClonePolicy.immutable(accessor)
} catch (error) {
  if (!(error instanceof Error) || !('code' in error)) throw error
  console.log(error.code, reads)
}
const callback = () => 1
const candidate = { nested: { count: 1 }, callback }
const diagnostic = ClonePolicy.diagnostic(candidate)
candidate.nested.count = 9
console.log(diagnostic.nested.count, diagnostic.callback === callback)
console.log(Object.isFrozen(independent))
```

Output:

```text
1 2 false true
CLONE_UNSUPPORTED 0
1 true
false
```

Prints `1 2 false true`, `CLONE_UNSUPPORTED 0`, `1 true`, and `false`. The strict copy is independent, opaque aliases, the getter is not run, and diagnostic copies nested data while retaining the callback.

Independent does not mean frozen. immutable may throw ENV_UNSUPPORTED without structuredClone or CLONE_UNSUPPORTED for rejected data; diagnostic may share unsupported subtrees, while opaque always shares the original value.

### Example parameters

All three policies take only value, with no options. source is ordinary nested data. immutable produces an independent mutable copy, opaque preserves strict reference identity, and diagnostic copies supported data while preserving the callback. Strict admission rejects the Object.defineProperty getter with reads still zero; immutable is not a freeze operation.

## Contract details

### Ownership, entries, and migration

This package adds mutation permission, action/state/error events, and removable diagnostic plugins to a Store. store-light owns fields, subscriptions, $plain/$hydrate; reactive owns the dependency graph and reporting; plugin-host owns installation, removal, and pipelines. Persistence and a history panel belong to store-persist and store-devtools. Store.$subscribe is enough for a simple state listener.

The root exports MutationPolicy/createMutationPolicy, event and command vocabularies, the Host/binding/logger/DevTools adapter, and errors. Clone strategies are available only from `@migaia/store-middleware/tolerant-clone`. Ordinary dependencies are middleware-pipeline, plugin-host, reactive, store-light, and utils. Explicitly install store-light/reactive when importing them directly in an example.

The old middlewarePlugin/IStoreMiddleware/IMiddlewareContext adapters were removed; use `IStoreMiddlewarePlugin`, install(core), and core.usePipeline. tolerantClone no longer exists at either entry. ClonePolicy, immutableSnapshotClone, opaqueReferenceClone, diagnosticClone, and IClonePolicyMode belong to the narrow entry. Import IMutationGuard/IMutationPolicy directly from store-light; this package has no aliases. The former store-devtools StoreDevtoolsCommand/IStoreDevtoolsCommand imports move to ReduxDevToolsCommand/IReduxDevToolsCommand here without changing protocol strings.

### MutationPolicy: synchronous write permission

`new MutationPolicy(mode?)` and `createMutationPolicy(mode?)` are equivalent. mode defaults to `'off'` and is `'off' | 'actions-only'`. off allows writes; actions-only rejects assertMutationAllowed at action depth zero with ACTION_SCOPE_REQUIRED and `[store] {operation} is not allowed outside an action`.

| Member                                          | Arguments, defaults, and behavior                                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `insideAction:boolean`                          | Readonly; true while at least one runInAction call is executing synchronously                                    |
| `assertMutationAllowed(operation?:string):void` | operation defaults to `'mutation'` and identifies a diagnostic; the check does not mutate state                  |
| `runInAction<T>(fn:()=>T):T`                    | Calls fn synchronously and returns its original value; a depth counter supports nesting, and finally restores it |

Returning a Promise does not extend the scope or wait for settlement. Reenter an action for writes after await. This is not a transaction: completed writes and callback-owned external effects are not rolled back. Synchronous fn failures retain an existing package identity; uncoded failures receive CALLBACK_FAILED or retain the original value through cause/errors.

createStore and its binding must share one mutationPolicy for host.runAction to authorize Store writes. Separate instances do not disable the Store's direct-write guard: Store actions and $set/$batch enter their own policy, but the Host cannot authorize a different instance. The Store owns actual field-write interception; the policy only grants permission.

### Events and public vocabularies

`IMiddlewareEvent<S>` is the following union. Every metadata field is optional `Readonly<Record<string,unknown>>`; no implicit copy policy is applied.

| Event          | Fields                                                       | Meaning                                                                  |
| -------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| action / start | name:string, timestamp:number, metadata?                     | A synchronous action begins                                              |
| action / end   | The above plus durationMs:number                             | The synchronous call returns; its returned Promise need not have settled |
| action / error | The above plus durationMs:number and error:unknown           | The synchronous call throws                                              |
| state          | name:string, timestamp:number, previous:S, next:S, metadata? | A state observation whose copy guarantees depend on clone                |
| error          | phase:string, timestamp:number, error:unknown, metadata?     | A diagnostic failure; phase identifies its source                        |

Host-generated timestamps use Date.now. runAction measures durationMs with performance.now, falling back to Date.now. A binding forwards the Runtime trace timestamp and uses zero when durationMs is absent. This describes synchronous duration.

The enum-like objects and value unions are MiddlewareEventType/IMiddlewareEventType (action/state/error), MiddlewareEventPhase/IMiddlewareEventPhase (start/end/error), and MiddlewareCommandType/IMiddlewareCommandType (commit/jump/reset). None takes call arguments.

### Host construction and options

`createStoreMiddlewareHost<S>(options):IStoreMiddlewareHost<S>` creates one frozen managed Host handle, not a class to construct with new. Its use/unUse, configuration, plugin identity, and stable handle identity come from plugin-host. Store members are installed before that same canonical handle freezes; no second wrapper is published. Nonobject options or failed reflection/reads produce INVALID_OPTION with the original cause.

| Field                            | Default              | Behavior                                                                                                 |
| -------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------- |
| runtime:IRuntime                 | Required             | Borrowed Runtime for batching and reportError                                                            |
| getState:()=>S                   | Required             | Called whenever a plugin requests state; copying is not implicit                                         |
| applyState?:(state:S)=>void      | undefined            | Required by DevTools jump/reset; executing a state command without it is DEVTOOLS_CAPABILITY             |
| mutationPolicy?:MutationPolicy   | A new off policy     | Share the Store's instance for common authorization                                                      |
| execution.mutationTimeoutMs      | Required, no default | Finite nonnegative milliseconds or false; one mutation-hook budget, with false disabling the deadline    |
| execution.pipelineDrainTimeoutMs | Required, no default | Finite nonnegative milliseconds or false; pipeline-drain budget                                          |
| identity.name?:string            | `'DEFAULT'`          | Nonempty readable label; the Host issues a unique id                                                     |
| pipeline.mode                    | Forced to `'sync'`   | async/generator/async-generator are overwritten                                                          |
| diagnostic?                      | No-op                | plugin-host cleanup, late-failure, and queue observations                                                |
| onDiagnosticFailure?             | undefined            | Terminal sink for diagnostic failures; absence or another failure uses the host reportError              |
| scheduler?                       | systemScheduler      | Queue and cleanup clock/timers                                                                           |
| queueAdmissionTimeoutMs?         | undefined            | Reports without rejecting; false disables timer/report/rejection; a number removes timed-out queued work |
| queueAdmissionDiagnosticMs?      | 1000                 | Report threshold without an explicit admission deadline; false disables it                               |
| disposeStepTimeoutMs?            | 5000                 | One cleanup-step budget; false waits indefinitely and never interrupts running JavaScript                |

Execution numbers may be zero or finite fractions; false explicitly removes the deadline. Both fields are mandatory. These budgets do not turn synchronous runAction into a cancellable task or guarantee that uncooperative user code stops.

### Host members, plugins, and pipelines

| Member                                                             | Arguments and behavior                                                                                                                   |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| mutationPolicy                                                     | Readonly actual policy instance                                                                                                          |
| `emit(event:IMiddlewareEvent<S>):void`                             | Runs the synchronous pipeline directly; a pipeline failure can throw to the caller                                                       |
| `runAction<T>(name:string,fn:()=>T,metadata?):T`                   | Isolated start event → runtime.batch(fn) inside the policy scope → end/error; returns the original result or propagates business failure |
| `recordState(name:string,previous:S,next:S,metadata?):void`        | Isolated state event; plugin failures are reported to the Runtime                                                                        |
| `recordError(phase:string,error:unknown,metadata?):void`           | Isolated error event; reentry while handling an error reports directly instead of recursing through the pipeline                         |
| `connectDevTools(adapter:IDevToolsAdapter<S>,name?):Promise<void>` | Installs the adapter as a plugin; name defaults to `'store-devtools'`                                                                    |
| `attachBindingDisposer(disposer:IDisposer):void`                   | Registers synchronous cleanup; registration after closing calls it immediately, with synchronous failure propagation                     |
| `dispose()`                                                        | Stable Promise for the structured cleanup outcome, described below                                                                       |

runAction does not wait for a returned Promise: synchronous return emits end, and a later rejection does not automatically become action:error. It does not clone state or undo writes before an action failed. recordState/recordError and runAction observation events report diagnostic failures through an isolated path. Public emit is outside that isolation guarantee.

`IStoreMiddlewarePlugin<S,TExt,TConfig,TShared>` reuses IPlugin. The last three type parameters default to Record<string,never>, Record<string,unknown>, and Record<string,never>. install(core) receives general config/getShared/onDispose/usePipeline plus domain runtime/getState()/applyState(state)/reportError(error,phase). Domain error reporting delegates to the Runtime.

Register synchronous stages with usePipeline. useAsyncPipeline/useGeneratorPipeline is rejected by plugin-host with PIPELINE_MODE_MISMATCH. next(event) only records the continuation value; downstream starts after the current stage returns. Code after next therefore cannot synchronously observe downstream completion. Only the first next takes effect; duplicate/late calls are reported as PIPELINE_NEXT_DUPLICATE/PIPELINE_NEXT_LATE. Omitting next filters the remaining event chain and reports MIDDLEWARE_NOT_CHAINED through the Runtime's trace-listener phase; it does not undo a Store write that already happened.

`loggerMiddleware<S=any>(sink?)` creates a plugin with fixed name `'store-logger'`. sink defaults to `console.log('[store]',event,state)` and has type `(IMiddlewareEvent<unknown>,unknown)=>void`. It does not depend on state shape; S can pin the target Host type. The stage calls next to record continuation, then reads core.getState and invokes sink before the downstream stage runs. state is read at sink invocation, not automatically captured when the event was created. Returned sink Promises are not awaited.

### bindStoreMiddleware: borrow a Store and bridge observations

`bindStoreMiddleware<S extends Record<string,unknown>>(store:IReactiveStore<S>,options:IStoreMiddlewareBindingOptions):IStoreMiddlewareBinding<S>` requires both arguments. It returns the same frozen canonical Host with a readonly store property strictly equal to the supplied instance. It creates neither another Store nor another Runtime.

| options field                                                 | Default                                  | Purpose                                                                                                       |
| ------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| execution                                                     | Required; neither budget has a default   | Host mutationTimeoutMs/pipelineDrainTimeoutMs                                                                 |
| mutationPolicy?                                               | Host creates an off policy               | Share the Store's actual policy to authorize host.runAction                                                   |
| actionPrefix?:string                                          | undefined                                | Forwards only action trace names beginning with this prefix; an empty string does not filter                  |
| clone?:(state:Record<string,unknown>)=>Record<string,unknown> | `state => ClonePolicy.diagnostic(state)` | Best-effort copying at binding, state notification, and each getState; unsupported subtrees may remain shared |

Binding captures clone(store.$plain()) as previous. A synchronous initial state-read/clone failure uses callback identity handling: uncoded failures become CALLBACK_FAILED, extensible native errors retain identity, and a frozen error remains on cause. Later subscription and Host reads keep their respective owner's error path. Each Store notification clones next, calls recordState('store:update',previous,next), then updates previous. Earlier history is not replayed: the first previous reflects binding time. Every getState clones $plain again, and applyState delegates to $hydrate.

Only ordinary fields exposed by $plain enter previous/next. Computed values, methods, WASM-backed fields, and external resources do not. Runtime action traces go straight to host.emit rather than host.runAction, avoiding a second policy scope. Wrapping the same bound Store action manually in host.runAction creates two independent event paths. actionPrefix filters names from the shared Runtime; it does not establish Store ownership.

If subscription construction fails, rollback attempts trace and state unsubscription before closing the Host. A synchronous rollback failure produces CLEANUP_FAILED AggregateError with the primary error at errors[0], followed by original cleanup errors. Cleanup does not erase the initial binding failure. Normal disposal after successful binding uses a structured result instead of this exception path.

### DevTools protocol and boundaries

`IDevToolsAdapter<S>` provides synchronous init(state:S) and send(event:IMiddlewareEvent<S>,state:S), plus optional subscribe(listener:(command:IDevToolsCommand<S>)=>void):IDisposer. init/send must be functions, and a supplied subscribe must also be callable; otherwise connectDevTools rejects INVALID_OPTION.

Domain commands are `{type:'commit'} | {type:'jump',state:S} | {type:'reset',state:S}`. Connection immediately calls init(core.getState()). Its event stage calls next then send, still before downstream execution. commit reinitializes current state. jump/reset use runAction('devtools:<type>',()=>applyState(state)), creating real action events. Without applyState this is DEVTOOLS_CAPABILITY; a binding already bridges $hydrate. Only ordinary fields are restored, not external effects, methods, computed values, or WASM resources.

`createReduxDevToolsAdapter<S>(connection:IReduxDevToolsConnection<S>,runtime?)` requires connection with init(state), send(action:unknown,state), and subscribe(listener):IDisposer. runtime defaults to the shared Runtime and reports parse failures. IReduxDevToolsMessage has optional type, payload.type, and state; state is a JSON string.

| ReduxDevToolsCommand property | Wire value     | Adapter behavior                           |
| ----------------------------- | -------------- | ------------------------------------------ |
| dispatch                      | DISPATCH       | Only accepts this message.type             |
| commit                        | COMMIT         | Produces commit without requiring state    |
| jumpToState                   | JUMP_TO_STATE  | Parses a supplied state and produces jump  |
| jumpToAction                  | JUMP_TO_ACTION | Same                                       |
| rollback                      | ROLLBACK       | Same                                       |
| reset                         | RESET          | Parses a supplied state and produces reset |

Non-DISPATCH messages, unknown payload.type values, and state commands without state are ignored. Malformed JSON in a supported command is not executed: the requested Runtime reports its original SyntaxError/DEVTOOLS_MESSAGE_INVALID in trace-listener, and later valid commands still work. Successful JSON.parse does not validate S's domain shape. adapter.send labels an action as name:phase, a state event as name, or an error as error:phase, and includes the original event. IReduxDevToolsCommand is the wire-value union, distinct from domain MiddlewareCommandType.

### Explicit clone policies

The narrow entry provides three generic single-argument functions `(value:T)=>T` with no additional options. ClonePolicy groups them by the properties below; IClonePolicyMode is their name union.

| Policy / function                  | Guarantee and boundary                                                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| immutable / immutableSnapshotClone | Independent deep copy or explicit rejection, without silently sharing an unsupported subtree; this does not mean Object.freeze |
| opaque / opaqueReferenceClone      | Returns the original value/reference without copying, explicitly accepting sharing                                             |
| diagnostic / diagnosticClone       | Best-effort copying without throwing clone failures; unsupported subtrees may retain references, so it is not strict history   |

immutable admits a strict data graph, then delegates to Utils' sole structuredClone implementation. Supported values include ordinary/null-prototype records, ordinary arrays, current-realm native Map/Set/Date/RegExp/ArrayBuffer, and standard TypedArray/DataView backed by nonshared ArrayBuffer. Map keys/values, Set members, and record/array data properties are recursively admitted. The clone engine preserves cycles and shared references. Custom classes, including built-in subclasses, and unsupported native types are rejected. Record/array accessors are rejected without invoking getters. The canonical clone rejects functions, symbols, and similar unsupported values. Missing structuredClone is ENV_UNSUPPORTED; unsupported data is CLONE_UNSUPPORTED. The complete Utils error stays on cause, with native failure beneath it rather than skipping a layer.

Migrate older custom-class flattening, getter evaluation, cross-realm values, or unlisted built-ins to supported data, or explicitly choose diagnostic/opaque. This policy does not change Utils' own projection contract.

diagnostic prefers structuredClone and falls back to canonical recursive copying. Plain objects/arrays recurse; supported Date/RegExp/Map/Set/ArrayBuffer/TypedArray subtrees are cloned separately; function/class/host subtrees may remain shared. Enumerable accessors follow Utils' read-and-record behavior, and `__proto__` is written with defineProperty. That traversal handles cycles and shared structure; this package does not implement another clone engine. The default binding diagnostic policy cannot guarantee complete isolation. opaque avoids copying but makes no measured speed promise.

### Disposal and error identity

plugin-host owns Host use/unUse/dispose, installation rollback, configuration, and reverse resource cleanup. Plugin names must be unique within one Host. Disposal first closes binding-disposer admission, then calls those disposers synchronously in LIFO order, attempts each, and proceeds to plugin removal. Returned Promises are not awaited; register synchronous cleanup functions. Reentrant registration executes immediately, and late registration failures propagate synchronously through callback identity handling.

Repeated dispose returns the same Promise with `{logicalTerminal,cleanupComplete,cleanupErrors}`, preserving other plugin-host physical-cleanup information where present. Binding-disposer failures precede plugin cleanup failures in cleanupErrors; collected cleanup failures do not reject this Promise. cleanupComplete retains the plugin cleanup-completion status: physical completion does not imply an empty cleanupErrors list. Closing does not destroy the borrowed Store or Runtime. The Store remains usable without this binding observing it. Domain closures have no common open guard, so a retained runAction can still execute fn; closing plugin admission does not cancel arbitrary business callbacks.

| StoreMiddlewareErrorCode property | code                     | Situation                                                                         |
| --------------------------------- | ------------------------ | --------------------------------------------------------------------------------- |
| invalidOption                     | INVALID_OPTION           | Invalid Host options or DevTools adapter shape/reads                              |
| middlewareNotChained              | MIDDLEWARE_NOT_CHAINED   | Missing next, reported to the Runtime                                             |
| actionScopeRequired               | ACTION_SCOPE_REQUIRED    | Write outside an actions-only scope                                               |
| cloneUnsupported                  | CLONE_UNSUPPORTED        | Unsupported immutable data or clone failure                                       |
| callbackFailed                    | CALLBACK_FAILED          | An uncoded synchronous action, initial binding clone, or binding-disposer failure |
| devtoolsMessageInvalid            | DEVTOOLS_MESSAGE_INVALID | Invalid JSON in a supported Redux state command; reported and skipped             |
| devtoolsCapability                | DEVTOOLS_CAPABILITY      | A state command without applyState                                                |
| envUnsupported                    | ENV_UNSUPPORTED          | immutable without environment structuredClone                                     |
| cleanupFailed                     | CLEANUP_FAILED           | Binding setup and synchronous rollback both fail                                  |

`IStoreMiddlewareErrorCode` is the code-value union. `STORE_MIDDLEWARE_SOURCE='@migaia/store-middleware'` identifies only errors created here; reactive, pipeline, and other existing source/code identities retain their actual owner. Native errors that can accept identity keep their original object, type, message, and stack. Otherwise cause/errors retain the original value. State observation, business failure, and diagnostic failure have distinct control flow.

`createStoreMiddlewareError(code,message,options?)` returns native Error. code:IStoreMiddlewareErrorCode and message:string are required; options defaults to undefined and contains optional cause. An explicit own cause, including undefined, is forwarded to Error. `createStoreMiddlewareAggregateError(code,errors:readonly unknown[],message)` returns native AggregateError; all three arguments are required, and errors retains the original objects. Both construct without throwing automatically, attach nonwritable source/code, and leave stack intact.

### Troubleshooting and development commands

For an unguarded direct write, check the policy actually passed to Store construction. Reenter an action at each synchronous commit in async code. For duplicate events, check whether an already-bound Store action was wrapped in runAction again. For changing historical data, inspect opaque or diagnostic reference sharing; choose immutable and handle rejection when independence is required.

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test
```

Listing these commands does not claim they were run by the documentation task. Building is available separately through pnpm run build.
