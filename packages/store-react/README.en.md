# `@migaia/store-react`

Connect existing reactive state to React read hooks, with separate registrations for independent component trees or server requests.

## You may have run into this

- Two requests render the same component but see each other's data because state still comes from a module singleton.
- A missing Store silently falls back to global state because a missing Provider and an omitted registration are treated alike.
- Two panels share a Runtime and unexpectedly share a count because dependency-graph ownership was confused with state-instance ownership.
- The first server HTML renders children immediately after initialization fulfills because readiness still needs to be observed.
- Rendering one profile twice triggers two requests because every render creates another async resource.

## Why choose it

- **Resolve one registration key to each request's own Store.** Each Provider selects from its own Registry, using the current component tree as shown in [Render the same token from separate request registries](./USEGUIDE.en.md#render-the-same-token-from-separate-request-registries).
- **Distinguish a missing Provider from a missing registration.** useProvidedStore reports PROVIDER_REQUIRED and STORE_MISSING separately as shown in [Distinguish a missing Provider from an unregistered token](./USEGUIDE.en.md#distinguish-a-missing-provider-from-an-unregistered-token).
- **Share an Atom description without merging panel values.** Every Registry owns its AtomStore even when both borrow one Runtime as shown in [Keep one atom definition local to each registry](./USEGUIDE.en.md#keep-one-atom-definition-local-to-each-registry).
- **Honor readiness fallback on the first server render.** Fulfilled input still passes through normalized barrier tracking, leaving the example's children unread as shown in [Show readiness fallback on the first server render](./USEGUIDE.en.md#show-readiness-fallback-on-the-first-server-render).
- **Reuse preloaded data across explicit server renders.** Two reads share one Resource and the example's fetcher runs only once as shown in [Render a preloaded Resource without creating another request](./USEGUIDE.en.md#render-a-preloaded-resource-without-creating-another-request).

## Start here

```ts doc-test=run
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { createStore } from '@migaia/store-light'
import { useStore } from '@migaia/store-react'

const store = createStore({ price: 3, quantity: 2 })
function Total() {
  const total = useStore(store, (state) => state.price * state.quantity)
  return createElement('output', null, String(total))
}
console.log(renderToString(createElement(Total)))
store.price = 4
console.log(renderToString(createElement(Total)))
await store.$dispose()
```

Output:

```text
<output>6</output>
<output>8</output>
```

Next: use [request registries](./USEGUIDE.en.md#render-the-same-token-from-separate-request-registries) for separate request state, or [preloaded reads](./USEGUIDE.en.md#render-a-preloaded-resource-without-creating-another-request) for data already fetched.

## Pitfalls when writing it yourself

This native object and manual projection illustrate the same total read. It is for display only; both write paths must maintain a second view value.

```ts doc-test=check
const state = { price: 3, quantity: 2 }
let displayedTotal = state.price * state.quantity // Pitfall: the projection becomes separate state to synchronize.
function setPrice(price: number) {
  state.price = price // Pitfall: this path forgets the view copy, leaving a stale total.
}
function setQuantity(quantity: number) {
  state.quantity = quantity
  displayedTotal = state.price * state.quantity
}
setPrice(4)
setQuantity(3)
console.log(displayedTotal)
```

The quick-start selector reads the Store fields directly, so there is no displayedTotal copy to synchronize; after an SSR update, render explicitly again.

## A three-minute mental model

Use the matching hook for an existing Store or Signal. To select different instances for component trees, register tokens in a Registry and pass it to a Provider. The application loads and owns async resources; React hooks read and subscribe to their state.

| Task / term                                      | Tool                                                 | Meaning                                                   |
| ------------------------------------------------ | ---------------------------------------------------- | --------------------------------------------------------- |
| Read a projection / selector                     | useStore                                             | Calculate the component's result from an existing Store   |
| Connect one value / Signal                       | useSignal                                            | A reactive value and its setter                           |
| Select an instance per tree / token, Registry    | createStoreToken, createStoreRegistry, StoreProvider | Typed registration key, instance table, and tree boundary |
| Separate description and value / Atom definition | useAtomDefinition                                    | Share descriptions while each AtomStore owns values       |
| Read async work / Resource, Suspense             | useResource / useResourceValue                       | Read complete state, or hand a Promise/error to React     |
| End ownership / owned                            | registry.disposeAsync                                | Await cleanup of instances owned by the Registry          |

## Typical scenarios

| Scenario                                                     | How to combine                                               | Details                                                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Render a Store projection without a Provider                 | `createStore → useStore → renderToString`                    | [Complete example](./USEGUIDE.en.md#render-a-store-projection-without-a-provider)                 |
| Show readiness fallback on the first server render           | `ready + fallback → StoreProvider → renderToString`          | [Complete example](./USEGUIDE.en.md#show-readiness-fallback-on-the-first-server-render)           |
| Render the same token from separate request registries       | `Registry × 2 → register(token) → useProvidedStore`          | [Complete example](./USEGUIDE.en.md#render-the-same-token-from-separate-request-registries)       |
| Distinguish a missing Provider from an unregistered token    | `Provider boundary → Registry.require(token)`                | [Complete example](./USEGUIDE.en.md#distinguish-a-missing-provider-from-an-unregistered-token)    |
| Keep one atom definition local to each registry              | `Runtime → Registry × 2 → atomStore.set → useAtomDefinition` | [Complete example](./USEGUIDE.en.md#keep-one-atom-definition-local-to-each-registry)              |
| Render a preloaded Resource without creating another request | `Resource → await promise → useResourceValue → dispose`      | [Complete example](./USEGUIDE.en.md#render-a-preloaded-resource-without-creating-another-request) |

## Installation

```bash
pnpm add @migaia/store-react @migaia/store-light react react-dom
```

react/react-dom peers require `>=19`. The Atom/Resource examples also import these packages directly:

```bash
pnpm add @migaia/reactive @migaia/store-keyed @migaia/resource
```

## Essential APIs

| API                                        | Purpose                                            |
| ------------------------------------------ | -------------------------------------------------- |
| `StoreProvider`                            | Supply a Registry and configuration to one tree    |
| `useStore / useSignal`                     | Read an existing Store projection or one Signal    |
| `useProvidedStore / useStoreFromProvider`  | Resolve an instance by token in the current tree   |
| `useAtomDefinition / useSetAtomDefinition` | Read/write the current Registry's Atom values      |
| `useResource / useResourceValue`           | Read async state or a Suspense value               |
| `useStoreResource`                         | Read a Store async field and manage version leases |

## Contract details

### Ownership, installation, and environment

This package connects existing state models to React. It does not implement a Store, Atom, Resource, or global-state framework. store-light owns Stores and their async fields, store-keyed owns Atom definitions and AtomStore, resource owns standalone Resource values, and reactive owns the dependency graph. lifecycle and utils supply shared cleanup and utilities. Ordinary shared variables do not become reactive without reading reactive nodes.

The ESM package exposes only `@migaia/store-react`, with no subpaths. Both react and react-dom are peers requiring `>=19`; async Stores use React 19's use. Explicitly install store-light, store-keyed, reactive, or resource when importing them directly. SSR examples use real ReactDOM server rendering and prove server reads/rendering, not client subscriptions or effect cleanup.

### Runtime, state, and scope

A Runtime contains one reactive dependency graph. A shared ownership protocol identifies the Runtime of a node, Store, or Atom; subscriptions cannot connect different graphs. A Provider Registry/AtomStore belongs to a Runtime without owning that Runtime's lifetime.

store-light turns ordinary fields, get accessors, and methods into Signals, Computeds, and Actions. This binding uses $runtime, the async Store $async/storeReady protocol, and resource protocols. Ordinary-field export/hydration still belong to Store APIs such as $plain/$hydrate. $snapshot() provides a Store snapshot, and $batch(recipe) groups synchronous writes for notification; recipe receives `IStoreShape<S>`. useStore/useSignal can read module singletons without a Provider, but adding a Provider does not make an already-shared singleton request-local.

Atom definitions are frozen descriptions without runtime state. The same atomDef/derivedDef/writableDef/familyDef description is instantiated independently in different AtomStores. Each Registry owns an atomStore; multiple Registries can therefore share one Runtime while retaining separate Atom state. Create a request/application Registry first, create injected Stores/Resources with its runtime, register them before rendering, and release them through an explicit owner.

### StoreProvider props and ownership

IStoreProviderProps requires children:ReactNode. registry, runtime, disposeOnUnmount, and config are optional.

| registry/runtime input | Default behavior                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| Neither supplied       | Creates a Runtime and Registry; disposeOnUnmount defaults to true                                               |
| runtime only           | Creates a Registry borrowing that Runtime; disposeOnUnmount defaults to true                                    |
| registry only          | Uses the external Registry; disposeOnUnmount defaults to false                                                  |
| Both supplied          | Requires registry.runtime===runtime, otherwise INVALID_CONFIG; the external Registry is not disposed by default |

The Provider never destroys a Runtime. disposeOnUnmount controls Registry cleanup, including its atomStore and owned registrations. Explicit disposeOnUnmount:true can transfer an external Registry's unmount cleanup. Changing an internally managed runtime prop selects a new candidate Registry and switches after commit; the old committed instance follows effect cleanup rather than mixing its reads into the new graph.

On the client, RegistryBoundary retains in an effect and releases in cleanup. The last release defers to setTimeout(0), then rechecks reference count and generation, protecting immediate StrictMode remount. Explicitly owned external Registries use the same path. SSR runs none of these effects, so there is no automatic unmount cleanup: a request owner must await disposeAsync in finally. React supplies no reliable permanently-abandoned-render callback for uncommitted candidates. Timers do not guess that state; use an externally observable owner for deterministic release. useMemo stabilizes identity without owning cleanup.

### Configuration, features, and readiness

| config field                                            | Default and behavior                                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| features.wasm?:boolean                                  | false; only literal true enables it; enabling it without ready creates a rejected configuration barrier |
| features.experimental?:Readonly<Record<string,boolean>> | Empty allowlist; only own enumerable data properties whose value is exactly true enable a feature       |
| ready?:readonly IStoreReadyBarrier[]                    | No barrier, producing normalized ready:null; entries are Promises or zero-argument factories            |
| fallback?:ReactNode                                     | null; displayed while pending rather than retaining old children                                        |
| defaults.warnAsyncActions?:boolean                      | false; a configuration snapshot only, not automatically passed to createStore                           |

An IStoreReadyBarrier factory is `()=>Promise<unknown> or unknown`. Normalization invokes it synchronously and admits its result with Promise.resolve. All barriers must fulfill before children render. Rejection is thrown during render for an outer Error Boundary; the Provider supplies no error UI. An Error reason retains its identity, including frozen Errors. A non-Error reason becomes READY_REJECTED with the original cause, without string coercion. Any equivalent initialization barrier can satisfy features.wasm; store-wasm's ensureWasm is an optional composition.

Within one Provider/barrierScope, the same ready array identity reuses its list Promise. A new array creates another readiness generation and ReadyBoundary even with the same entries; old completion cannot unlock it. Factory results have a separate scope+factory cache: pending/successful results can be shared by different lists, while failure removes that factory's cache entry. Reusing the old array still reuses its cached rejected list Promise. A new array alone does not necessarily rerun a successful factory. Different Providers/request scopes remain isolated. Factory execution is not guaranteed exactly once across abandoned renders; an application owner should supply a stable Promise for non-idempotent initialization.

Even an already-settled Promise updates tracked status in a then microtask, so the first synchronous render can remain pending. A client effect rechecks; SSR renderToString does not run that effect. Keep ready arrays, Stores/Signals/Resources, and selector/equality identities stable. Configuration is readonly input: supply a new object for changes, do not write state during render, and do not create resource-owning business instances on each render.

Normalized features.wasm is boolean, features.experimental is a shallow-frozen null-prototype allowlist, defaults contains warnAsyncActions, and ready is null or an object with promise/status()/error(). Its states are pending/ready/error. Only the experimental allowlist is frozen; the outer features/defaults/ready containers are not guaranteed frozen. StoreProviderState/IStoreProviderState exports those three values; states are not error codes. Sorted experimental-key encoding makes input key order irrelevant. Accessors are ignored as enabling data without invoking their getters; `__proto__` remains an ordinary key.

| API                                         | Arguments, defaults, and result                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| useStoreConfig()                            | Current IStoreConfigValue, or null without a Provider                                                                         |
| useStoreFeature(path)                       | path is `'wasm' or experimental.${string}`; false without a Provider or an enabled entry                                      |
| useAssertStoreFeature(path,apiName?)        | apiName defaults to `'this API'`; missing Provider is PROVIDER_REQUIRED, a disabled feature is FEATURE_DISABLED               |
| readStoreFeature(config,path)               | Non-hook query with required config; unknown paths or an empty experimental key return false                                  |
| assertStoreFeature(config,path,apiName?)    | Non-hook assertion accepting null, with the same default name                                                                 |
| normalizeStoreConfig(config?,barrierScope?) | config defaults to undefined; scope defaults to a fresh `{}` per call; an explicit stable scope defines ready-cache isolation |

Failed configuration reads, invalid ready entries, or experimental-feature reflection failures produce INVALID_CONFIG with the original cause when available. defaults.warnAsyncActions is application-readable configuration; explicitly pass the Store option to affect Store behavior.

### Store, Signal, and general read hooks

| API                                                | Arguments, defaults, and behavior                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `useStore<S,R>(store,selector,isEqual?):R`         | Required Store and selector; Object.is by default; uses store.$runtime and does not require a Provider |
| `useSignal<T>(signal):readonly [T,(next:T)=>void]` | Required signal, using its runtime; setter stays stable for the same Signal                            |
| `useTracked<T>(read,isEqual?,runtime?):T`          | Required read; defaults to Object.is/defaultRuntime and tracks actual node reads                       |
| `useNodeValue<T>(node,runtime,enabled?):T`         | Required node/runtime; enabled defaults to true; fixed-node subscription                               |

useStore first calls use(storeReady(store)) when store.$async is true, suspending beneath an outer Suspense until ready. The selector receives `IStoreShape<S>`. useTracked captures reads during render and publishes the selector/snapshot and dependencies at commit. An abandoned render does not change committed subscription semantics. Changing Runtime rebuilds the binding without running an old reader against the new graph. Changing selector/equality identity recaptures without requiring a subscription teardown each time. Equal results reuse snapshots rather than returning a new wrapper on repeated getSnapshot calls.

The public `IStableNode<T>` shape is readonly value:T and peek():T, but the node must also satisfy reactive's actual ownership protocol. useNodeValue checks node/runtime during render. enabled=false disables only subscription, not ownership checks or reading. The initial subscription run records dependencies without notifying; snapshots read node.peek directly without another old-value cache. useSignal uses this fixed-node path instead of dynamic dependency capture. This is a mechanism distinction, not a speed claim.

Client notification invokes the React listener through runtime.untracked and reports listener failures in the subscription-listener phase without polluting the current graph's dependencies. useSyncExternalStore connects that behavior to React's subscription model. A server getServerSnapshot read does not establish a client subscription.

### Two async-value protocols

| Source                                 | Hook                           | Protocol                                                    |
| -------------------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `Resource<T>` from resource            | useResource / useResourceValue | Independent async state machine, using resource.runtime     |
| Async atom with resource:`Resource<T>` | useAsyncAtomValue              | Delegates to useResourceValue(atom.resource)                |
| `IStoreResource<T>` from store-light   | useStoreResource               | Store async field with version capture and committed leases |

All take one required argument and no options. Resource and IStoreResource are not interchangeable. useResource returns `IResourceState<T>`: idle, pending, success (data and optional refreshing), error (error), or cancelled (DOMException error). useResourceValue returns successful data, throws error/cancelled errors during render, and throws resource.promise for idle/pending beneath Suspense. Business Promises/errors are not thrown from the scheduler's Effect callback. The hook does not take over Resource disposal from its application owner.

useStoreResource subscribes through resource.subscribe/getSnapshot, captures a version with captureSnapshot(existingLease) in render, and commitCapture in layout releases the prior lease. Unmount cleanup uses a microtask and epoch check to protect StrictMode replay. This manages captured-version leases rather than transferring the whole resource lifetime to React. The read/preload/retry/captureSnapshot/commitCapture protocol must come from a real IStoreResource.

### Atom hooks

| API                                                                       | Behavior                                                                                                 |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| useAtomValue(atom:`IReadableAtom<T>`)                                     | Uses registry.atomStore when a Provider and atom.atomDefinition exist; otherwise reads the node directly |
| useSetAtom(atom:`IWritableAtom<T,Args,Result>`)                           | Stable writer selecting atomStore.set or atom.write(...args) under the same condition                    |
| useAtom(atom)                                                             | readonly [useAtomValue(atom),useSetAtom(atom)]                                                           |
| useAtomDefinition(definition:`IAtomDefinition<T>`)                        | Requires a Provider; subscribes through sub and reads preview snapshots                                  |
| useSetAtomDefinition(definition:`IWritableAtomDefinition<T,Args,Result>`) | Requires a Provider; stable wrapper of atomStore.set(definition,...args)                                 |

Args is a readonly unknown[] tuple and Result is the write result. Each hook has one required argument and no options. Generic protocols come from store-keyed/reactive/atom, without requiring a particular factory; definitions come from atom/definition. Provider and direct paths use enabled to select one subscription source without changing hook order. A disabled direct path still runs useNodeValue's ownership check. Definition reads use preview: derived previews do not publish committed dependency edges and retain identity within one Runtime version. sub owns the actual subscription. A definition describes state; AtomStore owns each scope's values.

### Provider lookup hooks

All four hooks require an enclosing StoreProvider; absence produces PROVIDER_REQUIRED.

| API                                               | Arguments, result, and errors                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| useStoreRegistry()                                | No arguments; returns the current StoreRegistry                                                                                                                                             |
| useStoreRuntime()                                 | No arguments; returns the current Registry.runtime                                                                                                                                          |
| `useStoreFromProvider<T>(token:IStoreToken<T>):T` | Required token; calls registry.require(token), with STORE_MISSING when absent; looks up the instance without subscribing to its fields                                                      |
| useProvidedStore(token,selector,isEqual?)         | Required `IStoreToken<IReactiveStore<S>>` and selector:(state:`IStoreShape<S>`)=>R; isEqual defaults to Object.is; looks up the Store and delegates its projection subscription to useStore |

### Tokens and StoreRegistry

`createStoreToken<T>(debugName:string):IStoreToken<T>` returns frozen {key:symbol,debugName}; the name must be a nonempty string. Tokens with identical names still contain different Symbols. new StoreRegistry(runtime?) and createStoreRegistry(runtime?) both default to a fresh Runtime, borrow that Runtime, and own their atomStore.

| Member                                     | Arguments, defaults, and behavior                                                                                                   |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| register(token,value,options?)             | options defaults to {}, owned to false; duplicate token is STORE_DUPLICATE; returns an idempotent disposer tied to this exact entry |
| replace(token,value,options?)              | owned defaults to false; publishes the new entry and disposes an owned old value only when its reference changes                    |
| get / require / has(token)                 | Missing values yield undefined / STORE_MISSING / false; all reject after closing                                                    |
| remove(token,disposeOwned?)                | disposeOwned defaults to true; reports whether removed; false detaches without disposal                                             |
| retain(disposeOnRelease:boolean)           | Required; returns an idempotent release, deferring a final true release to a task and rechecking before closure                     |
| dispose()                                  | Synchronously and idempotently starts whole-owner cleanup; synchronous failures can throw                                           |
| disposeAsync()                             | Stable single Promise awaiting whole-owner cleanup and rejecting with the retained failure chain                                    |
| whenTerminal()                             | Waits only for terminal state, without replacing disposeAsync's error outcome                                                       |
| runtime / atomStore / lifecycle / disposed | Readonly; open→closing→terminal, with disposed true once not open                                                                   |

IStoreRegistrationOptions contains only owned?:boolean. Nonobject options, failed reads, or a nonboolean flag produce INVALID_CONFIG; owned is captured once. register/replace use ownerOf to check declared ownership. A different Runtime produces CROSS_RUNTIME; plain values without a declared owner are accepted. get/require/has are queries, but still check active state. Whole-owner disposal seals admission and clears entries before invoking owned callbacks, preventing reentrant registration.

Owned cleanup prefers $dispose(), then dispose(), and otherwise does nothing. Borrowed values are merely detached. Whole cleanup starts owned callbacks in reverse current-entry order, then atomStore cleanup, without serially awaiting each. lifecycle reads a thenable's then once and invokes it with its original receiver. Synchronous dispose does not await Promises; late failure is observed and reported in the Runtime's lifecycle-hook phase. disposeAsync after synchronous dispose waits for the same pending plan. Its completion Promise is published before callbacks, so reentrant cleanup can share it.

One synchronous failure can retain its native Error with REGISTRY_DISPOSAL_FAILED attached; multiple failures use AggregateError. Frozen/non-Error reasons remain reachable through cause/errors, and foreign identity is preserved. The stable completion replays synchronous and asynchronous failures. whenTerminal means cleanup has settled, not that it succeeded.

remove, replace, and register's returned disposer perform separate per-entry cleanup. Async rejection is reported but does not enter a later whole-owner disposeAsync wait ledger. To await a removed object's actual asynchronous release, retain its owner's completion protocol rather than treating Registry completion as a barrier for every historical cleanup.

### Errors and migration

| StoreReactErrorCode property | code                     | Situation                                                  |
| ---------------------------- | ------------------------ | ---------------------------------------------------------- |
| registryDisposed             | REGISTRY_DISPOSED        | Registry admission or query after closing/terminal         |
| registryDisposalFailed       | REGISTRY_DISPOSAL_FAILED | Owned cleanup failure                                      |
| providerRequired             | PROVIDER_REQUIRED        | Provider-only hook or feature assertion without a Provider |
| featureDisabled              | FEATURE_DISABLED         | Feature not explicitly enabled                             |
| storeMissing                 | STORE_MISSING            | require of an unregistered token                           |
| storeDuplicate               | STORE_DUPLICATE          | Duplicate register for one token                           |
| crossRuntime                 | CROSS_RUNTIME            | Cross-graph injection into a Registry                      |
| invalidConfig                | INVALID_CONFIG           | Invalid token/Provider/owned/ready/feature configuration   |
| readyRejected                | READY_REJECTED           | Wrapper for a non-Error readiness rejection reason         |

STORE_REACT_SOURCE is `'store.react'`. Errors created here carry source/code; foreign identities and underlying reactive ownership failures retain their actual owner. `createStoreReactError(code:IStoreReactErrorCode,message:string,options?)` returns native Error. options defaults to undefined and forwards cause when it is not undefined. `createStoreReactAggregateError(code,errors:readonly unknown[],message)` returns native AggregateError. Arguments are required as shown, and both factories construct without automatically throwing, attach nonwritable source/code, and preserve stack and errors/cause chains.

| Stable diagnostic                                                                 | Response                                                        |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `[store] StoreProvider registry/runtime ownership mismatch`                       | Supply registry alone or the identical runtime                  |
| `[store] hook requires a StoreProvider`                                           | Put the Provider-only hook under its scope                      |
| `[store] provider registry is disposed`                                           | Create a new Registry                                           |
| `[store] duplicate provider store token: X` / `[store] missing provider store: X` | Correct registration order/token identity or explicitly replace |
| `[store] provider store "X" belongs to a different Runtime`                       | Align actual ownership                                          |
| `[store] IStoreToken requires a debug name`                                       | Supply a nonempty string                                        |
| `[store] ready barrier rejected`                                                  | Inspect cause and use an outer Error Boundary                   |
| `[store] provider registry disposal failed`                                       | Inspect AggregateError.errors or the individual original error  |

Feature assertions include apiName and path in the message. Enabling wasm without ready suggests ensureWasm or equivalent initialization. fallback is not error UI, and readiness states are not error codes. The minimum React/react-dom version moved to 19. The no-op prepareForRender method and ineffective second retain argument were removed; retain takes only disposeOnRelease.

### Troubleshooting and development commands

For a missing Provider, inspect the actual React parent tree: Context follows React ancestry, not DOM placement, and a portal retains its React parent's context. For missing updates, check actual selector reads, equality, and values cached outside tracking. For a stuck readiness fallback, inspect Promise settlement, stable arrays, and an Error Boundary. Use an external request Registry for SSR and await disposeAsync in finally.

```bash
pnpm run fmt
pnpm run lint
pnpm run typecheck
pnpm run typecheck:test
pnpm run test
pnpm run typecheck:e2e
pnpm run test:e2e
pnpm run build
```

Browser integration requires Playwright browsers. Listing commands does not claim this documentation task ran them.
