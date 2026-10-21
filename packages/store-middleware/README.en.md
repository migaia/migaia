# `@migaia/store-middleware`

Add action and state observation, synchronous write permission, and removable diagnostic plugins to an existing Store, with a separate lifetime for those observations.

## You may have run into this

- One action is recorded twice and a closed panel keeps listening because manual wrappers and subscriptions have no common binding.
- The host enters an action but the Store still rejects writes because each uses a different permission instance.
- A logging failure stops business work while a real business exception disappears because diagnostics share its error boundary.
- The first cleanup throws and later subscriptions or plugins remain because release stops at that exception.
- Later edits rewrite historical snapshots because a fallback copy quietly returned shared references.

## Why choose it

- **Reuse the Store's own events and end observation separately.** The binding forwards existing traces and state notifications, while disposal releases the binding and plugins as shown in [Observe a Store and detach without disposing it](./USEGUIDE.en.md#observe-a-store-and-detach-without-disposing-it).
- **Share write permission between host actions and the Store.** One policy instance makes host.runAction and the field guard check the same synchronous scope as shown in [Share one strict policy between a Store and its host](./USEGUIDE.en.md#share-one-strict-policy-between-a-store-and-its-host).
- **Handle diagnostic faults separately from business failure.** runAction reports isolated observation failures while preserving the business result or original error as shown in [Keep a diagnostic sink failure separate from a business failure](./USEGUIDE.en.md#keep-a-diagnostic-sink-failure-separate-from-a-business-failure).
- **Continue cleanup after a failure and retain the failed value.** Binding disposers run in reverse order before plugin cleanup, sharing one disposal Promise as shown in [Release bindings in reverse order and retain cleanup failures](./USEGUIDE.en.md#release-bindings-in-reverse-order-and-retain-cleanup-failures).
- **Choose independent data or shared references explicitly.** The three ClonePolicy choices distinguish strict copying, the original value, and best-effort diagnostic copying as shown in [Choose strict independence or explicit reference sharing](./USEGUIDE.en.md#choose-strict-independence-or-explicit-reference-sharing).

## Start here

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { bindStoreMiddleware, loggerMiddleware } from '@migaia/store-middleware'

const events: string[] = []
const store = createStore({ count: 0 })
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const
const host = bindStoreMiddleware(store, { execution })
await host.use(loggerMiddleware((event) => events.push(event.type)))
store.count = 1
store.$runtime.flush()
console.log(events.join(','))
await host.dispose()
store.count = 2
console.log(store.count)
await store.$dispose()
```

Output:

```text
state
2
```

Next: see [a shared policy](./USEGUIDE.en.md#share-one-strict-policy-between-a-store-and-its-host) to restrict direct writes, or [clone choices](./USEGUIDE.en.md#choose-strict-independence-or-explicit-reference-sharing) for independent historical data.

## Pitfalls when writing it yourself

This native object manually observes the same counter state. It is for display only; callers must contain diagnostic failures and provide subscription cleanup themselves.

```ts doc-test=check
const state = { count: 0 }
const listeners = new Set<(phase: string) => void>()
function observe(listener: (phase: string) => void) {
  listeners.add(listener) // Pitfall: no disposer removes an observer when its panel closes.
}
function increment() {
  for (const listener of listeners) listener('start') // Pitfall: a diagnostic failure prevents business work.
  state.count += 1
  for (const listener of listeners) listener('end')
}
observe((phase) => console.log(phase, state.count))
increment()
```

## A three-minute mental model

Bind an existing Store, or create a Host when supplying your own state source. Plugins observe synchronous events, a policy grants permission only for the current synchronous write, and a clone policy selects the data handed to diagnostics.

| Task / term                      | Tool                                               | Meaning                                                         |
| -------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| Connect existing state / binding | bindStoreMiddleware                                | Forward Store notifications and action traces to plugins        |
| Grant write permission / policy  | MutationPolicy                                     | Whether the current synchronous call stack may write            |
| Observe work and data / event    | action, state, error                               | Start/end/failure and before/after state                        |
| Removable observer / plugin      | host.use → core.usePipeline                        | Host-owned event stages and cleanup resources                   |
| State representation / clone     | immutable, opaque, diagnostic                      | Strict independence, original reference, or best-effort copying |
| End observation / dispose        | host.dispose, then the application's Store cleanup | Unbinding does not destroy the Store                            |

## Typical scenarios

| Scenario                                                        | How to combine                                        | Details                                                                                              |
| --------------------------------------------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Observe a Store and detach without disposing it                 | `createStore → bind → loggerMiddleware → dispose`     | [Complete example](./USEGUIDE.en.md#observe-a-store-and-detach-without-disposing-it)                 |
| Share one strict policy between a Store and its host            | `shared MutationPolicy → Store + binding → runAction` | [Complete example](./USEGUIDE.en.md#share-one-strict-policy-between-a-store-and-its-host)            |
| Keep a diagnostic sink failure separate from a business failure | `createRuntime(onError) → Host → runAction`           | [Complete example](./USEGUIDE.en.md#keep-a-diagnostic-sink-failure-separate-from-a-business-failure) |
| Release bindings in reverse order and retain cleanup failures   | `attachBindingDisposer + core.onDispose → dispose`    | [Complete example](./USEGUIDE.en.md#release-bindings-in-reverse-order-and-retain-cleanup-failures)   |
| Reenter the action scope after an await                         | `runInAction → await → runInAction`                   | [Complete example](./USEGUIDE.en.md#reenter-the-action-scope-after-an-await)                         |
| Choose strict independence or explicit reference sharing        | `ClonePolicy.immutable / opaque / diagnostic`         | [Complete example](./USEGUIDE.en.md#choose-strict-independence-or-explicit-reference-sharing)        |

## Installation

```bash
pnpm add @migaia/store-middleware @migaia/store-light
```

The standalone Host examples also import a Runtime directly:

```bash
pnpm add @migaia/reactive
```

## Essential APIs

| API                                     | Purpose                                               |
| --------------------------------------- | ----------------------------------------------------- |
| `bindStoreMiddleware(store,options)`    | Observe an existing Store's actions and state         |
| `createStoreMiddlewareHost(options)`    | Create a plugin Host for a separate state source      |
| `createMutationPolicy / MutationPolicy` | Choose off or synchronous actions-only permission     |
| `host.runAction(name,fn,metadata?)`     | Batch synchronous business work and record its action |
| `loggerMiddleware(sink?)`               | Install a replaceable event sink                      |
| `host.dispose()`                        | Detach and collect cleanup results                    |

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
