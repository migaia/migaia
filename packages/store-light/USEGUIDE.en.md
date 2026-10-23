# `@migaia/store-light` usage guide

[中文](./USEGUIDE.md)

What the package is for, its highlights and its mental model are in the [README](./README.en.md). This guide first gives runnable examples by scenario (Node 24), then lists the store definition rules, the signature of every public API, the full `StoreResource` state machine and every error message.

## Find by scenario

| Your problem | Read this section |
| --- | --- |
| A derived value was not updated, or listeners saw half-written state | [Plain object in, reactive state out](#plain-object-in-reactive-state-out) |
| Restoring settings after an upgrade writes retired fields or silently loses data | [Save only what can be restored](#save-only-what-can-be-restored) |
| After sign-out, a callback nobody cleaned up still shows old data | [Reading a released store fails loudly](#reading-a-released-store-fails-loudly) |
| A callback stored in the state is treated as a method | [Keep a callback as a replaceable field](#keep-a-callback-as-a-replaceable-field) |
| A connection or decoder stays open after the component unmounts | [Release an async value when nobody uses it](#release-an-async-value-when-nobody-uses-it) |
| After a reload the old value leaks or is released twice | [Reloading releases the old value exactly once](#reloading-releases-the-old-value-exactly-once) |

## Plain object in, reactive state out

A cart keeps a list, a total and a summary line. Hand-written, every method that changes the list must also recompute the summary and notify listeners, and a listener that runs between two writes sees a new list with the old total.

Reactive libraries fix that, but usually by asking you to wrap every field in a signal and every derived value in a computed, so the state no longer looks like the object it describes.

`createStore` takes the object as you would write it. Plain fields become writable reactive values, getters become derived values that recompute when what they read changes, and methods become actions: all writes inside one call are published together when the call returns.

```ts doc-test=run
import { createStore } from '@migaia/store-light'

const cart = createStore({
  items: [] as string[],
  total: 0,
  // A getter becomes a derived value: it follows items and total
  get summary() {
    return `items: ${this.items.length}, total: ${this.total}`
  },
  // A method becomes an Action: its writes merge into one notification
  add(name: string, price: number) {
    this.items = [...this.items, name]
    this.total += price
  }
})

const stop = cart.$subscribe(() => console.log(`notified: ${cart.summary}`))

cart.add('keyboard', 300)
cart.add('mouse', 100)
await Promise.resolve() // notifications go out in a microtask

stop()
await cart.$dispose()
```

Output:

```text
notified: items: 1, total: 300
notified: items: 2, total: 400
```

Two calls to `add` produce two notifications, and each one already sees both the new list and the new total.

An action publishes once, right when it returns, so a listener never observes half of a method's writes. Writes made directly on fields, outside any method, are merged in the next microtask instead.

## Save only what can be restored

Settings are saved to local storage. After an upgrade some saved fields no longer exist and new ones were added; restoring the old JSON either writes keys the state does not have or silently loses data nobody noticed.

Hand-written persistence usually serializes the whole object, including derived values and methods, and restores with `Object.assign`, which copies whatever it is given.

`$plain()` returns only the writable fields. `$hydrate()` writes back only the fields this store has, in one batch; with `unknown: 'report'` it calls `onUnknown` for every key it skips, and `unknown: 'strict'` rejects the whole input instead.

```ts doc-test=run
import { createStore } from '@migaia/store-light'

const settings = createStore({
  theme: 'light',
  fontSize: 14,
  get label() {
    return `${this.theme} / ${this.fontSize}px`
  },
  reset() {
    this.theme = 'light'
    this.fontSize = 14
  }
})

settings.$set({ theme: 'dark', fontSize: 16 })
// Only writable fields: derived values and methods are not saved
const saved = JSON.stringify(settings.$plain())
console.log(`saved: ${saved}`)

// The next version dropped fontSize and added language; old data also has a retired field
const next = createStore({ theme: 'light', language: 'en' })
next.$hydrate(
  { ...JSON.parse(saved), legacyMode: true },
  { unknown: 'report', onUnknown: (key) => console.log(`ignored unknown field: ${key}`) }
)
console.log(`restored: ${JSON.stringify(next.$plain())}`)

await settings.$dispose()
await next.$dispose()
```

Output:

```text
saved: {"theme":"dark","fontSize":16}
ignored unknown field: fontSize
ignored unknown field: legacyMode
restored: {"theme":"dark","language":"en"}
```

The saved JSON contains `theme` and `fontSize` but not `label` or `reset`. Restoring into the new version reports `fontSize` and `legacyMode` as ignored, and the result keeps `theme` and the new `language`.

The default `unknown: 'ignore'` skips unknown keys silently; choose `report` when you want to log migrations and `strict` when bad input must not be applied at all.

## Reading a released store fails loudly

After sign-out the session state is released, but a timer or a callback that was never cleaned up keeps reading it and quietly shows the previous user's name.

A plain object never knows it is no longer in use, so stale readers get old values instead of an error, and the bug only shows up as wrong data.

After `$dispose()`, reading or writing a field and calling a method throw `STORE_DISPOSED`. `$disposed` turns `true` before any resource is released, and repeated `$dispose()` calls return the same Promise.

```ts doc-test=run
import { createStore } from '@migaia/store-light'

const session = createStore({ user: 'Ada' })
await session.$dispose() // the user signs out and the session state is released

try {
  console.log(session.user) // a callback that was never cleaned up still reads it
} catch (error) {
  const failure = error as Error & { code?: string }
  console.log(`read failed: ${failure.code}`)
}
console.log(`disposed: ${session.$disposed}`)
```

Output:

```text
read failed: STORE_DISPOSED
disposed: true
```

The late read fails with `STORE_DISPOSED`, and `$disposed` is `true`.

A forgotten reader now shows up as an error at the exact place it reads, instead of as stale data on screen.

## Keep a callback as a replaceable field

A form stores an `onSubmit` callback that the page swaps at run time. Written as a function in the store definition, it is treated as a method instead.

`createStore` turns every function into an action, so a function-valued field cannot be told apart from a method by looking at the object.

Wrapping the value in `raw()` marks it as data: the field stays readable and writable, assigning a new function notifies subscribers, and calling it runs the current function.

```ts doc-test=run
import { createStore, raw } from '@migaia/store-light'

const form = createStore({
  // A function without raw would become a method; here it is a replaceable callback field
  onSubmit: raw((data: string) => console.log(`default submit: ${data}`)),
  submit(data: string) {
    this.onSubmit(data)
  }
})

const stop = form.$subscribe(() => console.log('submit callback replaced'))
form.submit('draft')

form.onSubmit = (data) => console.log(`sent to the server: ${data}`)
await Promise.resolve()
form.submit('final')

stop()
await form.$dispose()
```

Output:

```text
default submit: draft
submit callback replaced
sent to the server: final
```

The first submit runs the default callback; replacing it notifies the subscriber, and the second submit runs the new one.

Use `raw()` for any function or value that should be stored as is rather than interpreted, such as callbacks, class instances handed in from outside, or formatter functions.

## Release an async value when nobody uses it

A component opens a connection or a decoder when it mounts. When the last component that needs it unmounts it should be closed, but not immediately, because the next page often needs it again.

Hand-written code counts users in a module variable, and every early return or thrown error in a component is a chance to miss a decrement, leaving the resource open forever.

`createStoreResource` owns the loaded value. `retainResource()` returns a release function; when no holder is left, the value stays for `keepAliveMs` (default 1000) and then `dispose` is called once.

```ts doc-test=run
import { createStoreResource } from '@migaia/store-light'

// Fake object that holds a resource, such as an open connection or a decoder
function openConnection(name: string) {
  console.log(`open ${name}`)
  return { name }
}

const connection = createStoreResource(() => openConnection('connection #1'), {
  keepAliveMs: 20, // keep it 20 ms after the last user leaves
  dispose: (value) => console.log(`close ${value.name}`)
})

const release = connection.retainResource() // a component mounts and starts using it
connection.preload()
await new Promise((resolve) => setTimeout(resolve, 5))
console.log(`read: ${connection.read().name}`)

release() // the component unmounts
console.log('component unmounted')
await new Promise((resolve) => setTimeout(resolve, 50))
console.log('done')
```

Output:

```text
open connection #1
read: connection #1
component unmounted
close connection #1
done
```

The connection opens once, is read while the component holds it, and closes about 20 ms after the component unmounts.

When no `dispose` option is given and the value has a `$dispose` method, that method is called instead. `keepAliveMs: 0` releases synchronously when the last holder leaves.

## Reloading releases the old value exactly once

A reload creates a new decoder. The old one must be released, but only after the new one is ready, so the screen never shows nothing, and it must never be released twice.

Hand-written reload code tends to dispose the old value before the new one arrives, or forgets it once an error path is taken; values that resolve after being superseded leak entirely.

`retry()` starts a new load and keeps the old value until the new one is published, then disposes the old one once. Values that arrive after being superseded, or after the resource is disposed, are released as well.

```ts doc-test=run
import { createStoreResource } from '@migaia/store-light'

let opened = 0
const decoder = createStoreResource(
  () => {
    opened++
    console.log(`create decoder #${opened}`)
    return { id: opened }
  },
  { dispose: (value) => console.log(`release decoder #${value.id}`) }
)

const release = decoder.retainResource()
decoder.preload()
await new Promise((resolve) => setTimeout(resolve, 5))
console.log(`using #${decoder.read().id}`)

decoder.retry() // the user clicks "Reload"
await new Promise((resolve) => setTimeout(resolve, 5))
console.log(`using #${decoder.read().id}`)

release()
decoder.dispose()
await decoder.whenTerminal()
console.log('everything released')
```

Output:

```text
create decoder #1
using #1
create decoder #2
release decoder #1
using #2
release decoder #2
everything released
```

Decoder #2 is created first, then #1 is released, and the component reads #2. Disposing the resource releases #2, and `whenTerminal()` resolves after everything is released.

Each value created by the loader is released exactly once, whichever way it ends.


---

## API manual

### Contents

1. [Imports and dependencies](#1-imports-and-dependencies)
2. [Store definition rules](#2-store-definition-rules)
3. [Creation entry points](#3-creation-entry-points)
4. [ICreateStoreOptions](#4-icreatestoreoptions)
5. [The complete `$` API](#5-the-complete--api)
6. [FieldBuilder: the custom field protocol](#6-fieldbuilder-the-custom-field-protocol)
7. [Mutation guards: IMutationGuard / IMutationPolicy](#7-mutation-guards-imutationguard--imutationpolicy)
8. [StoreResource: a Suspense-safe async value container](#8-storeresource-a-suspense-safe-async-value-container)
9. [Constants and error factories](#9-constants-and-error-factories)
10. [Error reference](#10-error-reference)
11. [Lifecycle and release semantics](#11-lifecycle-and-release-semantics)
12. [A production-like combined example](#12-a-production-like-combined-example)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Imports and dependencies

```ts doc-test=check
import {
  createStore,
  createAsyncStore,
  storeReady,
  raw,
  isRaw,
  isFieldBuilder,
  FIELD_BUILDER,
  createStoreResource,
  createStoreResourceScope
} from '@migaia/store-light'
```

`store-light` depends on `@migaia/reactive` (graph and Runtime), `@migaia/resource` (requests), `@migaia/lifecycle` (ownership and cleanup), `@migaia/event-subscriber` (notifications) and `@migaia/utils` (base protocols and scheduling). Every node is created on the `defaultRuntime` of `@migaia/reactive` by default; when runtimes must be isolated (several roots, one per server request, tests that must not share state), build a separate Runtime with `createRuntime()` from `@migaia/reactive` and pass it as `options.runtime`. `store-light` imports no UI framework and assumes no particular host.

---

## 2. Store definition rules

`createStore(shape, options?)` takes an object literal and classifies each property descriptor (`Object.getOwnPropertyDescriptors`) as follows:

| Input shape | Becomes | Notes |
| --- | --- | --- |
| `get x() { ... }` accessor | **Computed** | `this` is bound to the store; evaluated lazily and recomputed only when a dependency changes; read-only, so `store.x = v` does nothing (and throws TypeError in strict mode, because the property has only a getter) |
| A value wrapped in `raw(value)` | **Field kept as is** | Not treated as an action even when `value` is a function; readable, writable and replaceable as a whole (typical use: an `onSubmit` callback) |
| A plain function `method() {}` | **Action** | Wrapped in `runtime.runTracedAction` + batch + untracked; `this` is bound to the store, so the method reads and writes other fields naturally |
| A `FieldBuilder` (`isFieldBuilder(value)` is true) | **Custom field** | The builder's `create()` produces the actual field object; see [section 6](#6-fieldbuilder-the-custom-field-protocol) |
| Any other plain value | **Signal** | Reading subscribes (inside a Computed/Effect it records a dependency); writing notifies |

`IStoreDefinition<S>` adds `ThisType<IReactiveStore<S>>` to the input object. Inside methods and getters, `this` is therefore the **resolved** store type (each `FieldBuilder` already replaced by the field type its `create()` produces), not the unresolved `FieldBuilder` type of the input literal; without it, code such as `this.wasmField.value` inside a method would fail to type-check.

`IStoreShape<S>` maps field names to their exposed types; you never write this mapping yourself, because the return type of `createStore` is inferred correctly.

---

## 3. Creation entry points

| API | Signature | Parameters | Sync/async | Behaviour |
| --- | --- | --- | --- | --- |
| `createStore(shape, options?)` | `(S) => IReactiveStore<S>` | `shape: IStoreDefinition<S>`; `options?: ICreateStoreOptions` | Sync | Creates synchronously; **a field that is a `FieldBuilder` without `mode: 'sync'` (`mode: 'async'` or a legacy builder without a mode) throws while the descriptors are read**, before any I/O runs, and suggests `createAsyncStore` |
| `createAsyncStore(shape, options?)` | `(S) => Promise<IReactiveStore<S>>` | `shape: IStoreDefinition<S>`; `options?: ICreateStoreOptions` | Async | Accepts async `FieldBuilder`s; the returned Promise settles only after every async field has finished initializing (or failed), and once it resolves every field is ready |
| `storeReady(store)` | `(store: object) => Promise<void>` | `store: object` | Async | Returns the store's readiness Promise; valid only for stores created by one of the entry points above, and throws `[store] store has no asynchronous initialization` for any other object |

There are only two creation entry points: `createStore` (purely synchronous definitions) and `createAsyncStore` (definitions with async fields).

A store made only of signals and computeds creates no async lifecycle scope; one is created only when a FieldBuilder, a source capability, a subscription effect or an `$own` external resource appears. Adjacent native nodes are grouped into one synchronous segment released in reverse order, and each segment is registered at the boundary with a different kind of resource, keeping the original mixed LIFO order. The initialization AbortController is created through the lifecycle native factory only when the first builder is admitted. The Promise identity of `$dispose()`, asynchronous external cleanup and the error policy stay as they are.

**Cleanup when initialization fails**: whichever entry point is used, if any step of construction throws (an invalid field type, a builder's `create()` refusing ownership, ...), the internal nodes created so far are released in reverse registration order, and no half-initialized resource remains. An async field that fails to initialize (a rejected Promise in `readyList`) likewise marks the whole store `disposed` and releases its resources, even if some fields had already initialized successfully.

---

## 4. ICreateStoreOptions

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const store = createStore(shape, {
  runtime,
  debugName: 'settings',
  warnAsyncActions: true,
  mutationPolicy: createMutationPolicy('actions-only')
})
```

| Option | Type | Required | Default | Purpose |
| --- | --- | --- | --- | --- |
| `runtime` | `IRuntime` | optional | `defaultRuntime` | The Runtime that owns the nodes; nodes on the same Runtime share one dependency graph, and nodes on different Runtimes are fully isolated |
| `debugName` | `string` | optional | `'Store'` | Debug-name prefix used in the internal nodes' `debugName` (`${debugName}.${key}`); has no effect on state semantics |
| `warnAsyncActions` | `boolean` | optional | `false` | When on, the first time an action returns a thenable (an async method) `Runtime.reportError` reports `ACTION_BATCH_BOUNDARY`, explaining that only writes before the first await are batched automatically |
| `mutationPolicy` | `IMutationPolicy` | optional | none | Plugs in a MobX-style strict mutation guard; see [section 7](#7-mutation-guards-imutationguard--imutationpolicy) |

---

## 5. The complete `$` API

Input fields cannot use the name of a built-in API (for example `$snapshot` or `$dispose`): a conflict is rejected with an `INVALID_OPTION` TypeError, and the fields already created go through the same construction rollback.

The `$`-prefixed methods and properties are **non-enumerable**, so they never appear in `for...in`, `Object.keys()` or the user-field walk of `$snapshot()`.

| API | Signature | Parameters | Sync/async | Side effects / boundaries |
| --- | --- | --- | --- | --- |
| `$runtime` | `IRuntime` | none (property) | Sync | The Runtime that owns every node of the store; a writable data property, so adapters such as React can create effects on the same graph |
| `$async` | `boolean` | none (property) | Sync | Whether the definition contains async `FieldBuilder`s; when `false` the whole store is ready synchronously |
| `$disposed` | `boolean` (getter) | none (property) | Sync | Whether the store has been released; evaluated live, not a snapshot taken at construction |
| `$snapshot()` | `() => IStoreShape<S>` | none | Sync | Returns a one-off snapshot of every field (signals + computeds + wasm fields); **requires the store to be ready**, and throws `[store] store is pending; use createAsyncStore()...` while async fields are pending |
| `$plain()` | `() => Record<string, unknown>` | none | Sync | Returns only signal-backed fields (including `raw()` fields) and **excludes** computeds, wasm fields and methods; **does not require readiness**, so it works while async fields initialize; the persistence layer (`@migaia/store-persist`) takes its snapshots with it |
| `$hydrate(partial, options?)` | see below | `partial: Record<string, unknown>`; `options?: IHydrateOptions` | Sync | Lenient write-back: writes only known signal keys and handles unknown/computed/wasm keys according to `options.unknown`; **does not require readiness**; the whole write goes through the mutation policy and `runtime.batch` as one notification, and completed writes are not rolled back |
| `$subscribe(fn, options?)` | `(fn, { fireImmediately? }) => IDisposer` | `fn: () => void`; `options?: ISubscribeOptions` | Sync | Registers a coarse subscription effect that reads `.value` of every signal and computed and calls `track()` on every wasm source; the first subscription evaluates computed getters, so dependencies outside the store are tracked too; with `fireImmediately: true`, `fn` runs once right after subscribing; an error thrown by `fn` is reported through `runtime.reportError` and does not break the subscription |
| `$batch(recipe)` | `(recipe: (draft) => void) => void` | `recipe: (draft: IStoreShape<S>) => void` | Sync | Runs the whole recipe in one `batch`, so several field writes produce one notification; `draft` is the store itself; **not a transaction**: a recipe that throws halfway does not roll back fields already written; writing a read-only computed throws naturally (the property has only a getter) |
| `$set(patch)` | `(patch: IWritableStorePatch<S>) => void` | `patch: IWritableStorePatch<S>` | Sync | Low-level batch assignment; **at compile time** it accepts only fields that are not computeds, FieldBuilders or methods (`raw()` fields included); **at run time** it also checks that each key has a signal and throws `[store] field is not settable: ${key}` otherwise (guarding dynamic or invalid input) |
| `$own(resource)` | `<T extends IDisposable>(resource: T) => T` | `resource: T extends IDisposable` | Sync | Puts an outside resource under this store's ownership so that `$dispose()` releases it too; the resource must be unowned or owned by this Runtime, and cross-Runtime resources are rejected (see [section 10](#10-error-reference)) |
| `$dispose()` | `() => Promise<void>` | none | Async, starts synchronously | The first call flips `$disposed` synchronously, aborts async field initialization in flight and starts releasing every internal node; every call returns the same Promise, which replays success or failure consistently and settles once owned cleanup has finished |

`ISubscribeOptions`: `{ fireImmediately?: boolean }`, default `false`.
`IHydrateOptions`: `{ unknown?: 'ignore' | 'report' | 'strict'; onUnknown?: (key: string) => void }`, default `unknown: 'ignore'` (backwards-compatible partial hydration); `'strict'` throws on an unknown key; `'report'` calls `onUnknown` once per unknown key and keeps writing.

---

## 6. FieldBuilder: the custom field protocol

The store defines the protocol and extensions implement it: `store-light` knows nothing about WASM or any concrete field, and `FieldBuilder` is only a contract. `number()`/`string()`/`boolean()`/`array()`/`record()` in `@migaia/store-wasm` are concrete implementations of it.

```ts doc-test=skip reason="Signature summary, not a runnable module"
export type IFieldContext = {
  runtime: IRuntime
  signal: AbortSignal // aborts initialization in flight when the store is disposed
  createSource(debugName?: string): IFieldSource
}

export type ISyncFieldBuilder<F extends IDisposable> = {
  readonly [FIELD_BUILDER]: true
  readonly mode: 'sync'
  create(context: IFieldContext): F
}

export type IAsyncFieldBuilder<F extends IDisposable> = {
  readonly [FIELD_BUILDER]: true
  readonly mode: 'async'
  create(context: IFieldContext): Promise<F>
}
```

| Name | Role |
| --- | --- |
| `FIELD_BUILDER` | Brand symbol, not a public construction API; used only by `isFieldBuilder` to tell real builders from structurally similar plain objects |
| `isFieldBuilder(value)` | Type guard telling whether a value is an `IFieldBuilder` |
| `IFieldSource` | The minimal reactive capability the Runtime grants to custom storage: `track()` (record a dependency), `notify()` (update downstream), `commit(write)` (reserve the version before publishing and publish once, avoiding a tear between writing and notifying), `observed` (whether anyone observes it) |
| `IFieldContext` | The only argument of a builder's `create()`: `runtime` to create ordinary nodes, `createSource` to join the same dependency graph, and `signal`, the `AbortSignal` that aborts initialization in flight when the store is disposed |

**Ownership rule**: `IFieldContext` deliberately carries no `scope`. Registering ownership is the store's job, not the builder's. A builder only produces the field; the store then calls `claimOwnership` + `scope.own` itself. So even when a third-party builder creates a resource and forgets to register it, `$dispose()` still releases it, because the builder never performs that step.

**Sync vs async fields**: every builder states `mode: 'sync'` or `mode: 'async'` explicitly. Sync builders work with either entry point; async builders only with `createAsyncStore()`. The legacy form without a mode is no longer accepted.

A minimal custom synchronous field (adapted from `number()` in `@migaia/store-wasm`):

```ts doc-test=check
import { FIELD_BUILDER, type IFieldBuilder, type IFieldContext } from '@migaia/store-light'
import type { IDisposable } from '@migaia/reactive'

type ICounterField = IDisposable & { value: number }

function counterField(initial: number): IFieldBuilder<ICounterField> {
  return {
    [FIELD_BUILDER]: true,
    mode: 'sync',
    create({ createSource }: IFieldContext): ICounterField {
      const source = createSource('CounterField')
      let value = initial
      let disposed = false
      return {
        get value() {
          source.track()
          return value
        },
        set value(v) {
          source.commit(() => {
            value = v
          })
        },
        get disposed() {
          return disposed
        },
        dispose() {
          if (disposed) return
          disposed = true
          source.dispose()
        }
      }
    }
  }
}
```

---

## 7. Mutation guards: IMutationGuard / IMutationPolicy

`store-light` defines only the protocol and ships no concrete policy:

```ts doc-test=skip reason="Signature summary, not a runnable module"
export type IMutationGuard = { assertMutationAllowed(operation?: string): void }
export type IMutationPolicy = IMutationGuard & { runInAction<T>(fn: () => T): T }
```

- Stores and collection packages only need to answer "may this change happen?" (`IMutationGuard`).
- The store facade also needs to mark one operation as "inside an action" (`IMutationPolicy`), because writes inside methods, `$batch`, `$set` and `$hydrate` must be allowed, while direct field assignments are allowed or rejected by the policy.

The concrete implementation (MobX-style actions-only mode) comes from `@migaia/store-middleware`:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
import { createStore } from '@migaia/store-light'
import { createMutationPolicy } from '@migaia/store-middleware'

const store = createStore(
  {
    count: 0,
    increment() {
      this.count += 1 // inside an action: allowed
    }
  },
  { mutationPolicy: createMutationPolicy('actions-only') }
)

store.increment() // OK
store.count = 5 // throws: [store] set(count) is not allowed outside an action
```

Without `mutationPolicy` (the default), direct assignment is allowed everywhere, so existing stores keep their behaviour; strict mode is opt-in.

---

## 8. StoreResource: a Suspense-safe async value container

`createStoreResource(factory, options?)` creates an async value container independent of the object facade, and `createStoreResourceScope()` releases a group of resources together. Neither needs `createStore`.

### 8.1 State projection

Requests, data, cancellation and the shared Promise are owned only by `@migaia/resource`; the diagram below is the view StoreLight derives from it together with version leases.

```text
idle --start()--> loading --resolve--> ready --no holder + timeout--> idle (cache expired, value released)
                     |                   |
                     +---reject--------> failed (falls back to ready with the old value when one exists)
ready/loading --dispose() (holders left)--> closing --last holder released--> disposed
any state except disposed --forceDispose()/dispose() (no holder)--> disposed
```

- **`idle`**: loading has not started.
- **`loading`**: `factory` is running; when an earlier value exists (a reload started by `retry()`), it is kept as `previous`, and reads return the old value instead of suspending.
- **`ready`**: a value can be read.
- **`failed`**: loading failed and there is no older value to fall back to; with an older value, the state falls back to `ready` (keeping it) instead of `failed`.
- **`closing`**: when `dispose()` is called while holders (resource leases or version leases) remain, the resource enters this intermediate state and terminates only when the last holder releases; no half-closed state is visible from outside.
- **`disposed`**: the logical end state. `whenTerminal()` resolves only after the actual disposers finish, and every method is either a no-op or throws `[store] resource is disposed`.

### 8.2 API reference

| API | Signature | Parameters | Sync/async | Notes |
| --- | --- | --- | --- | --- |
| `read()` | `() => T` | none | Sync | Reads the current value; while `loading` it throws the running Promise (the React Suspense protocol), and when `failed` it throws the error |
| `preload()` | `() => void` | none | Sync | Starts loading if it has not started yet; creates no holding lease |
| `retry()` | `() => void` | none | Sync | Marks the current value stale and loads again; the old value stays readable until the reload completes |
| `retainResource()` | `() => () => void` | none | Sync | Takes a resource-level holding lease (not tied to a version) and returns its release function; while such a lease exists the resource is never reclaimed by timeout |
| `retainVersion(version)` | `(number \| IVersionToken) => () => void` | `version: number \| IVersionToken` | Sync | Keeps one specific version from being reclaimed, even after `retry()` produced a newer one; typical for "refresh in the background but keep the value currently rendered" |
| `captureVersion(id)` | `(number) => IResourceCapture` | `id: number` | Sync | Temporary protection during render: returns a capture token that does not count as a holder yet |
| `commitCapture(capture)` | `(IResourceCapture) => () => void` | `capture: IResourceCapture` | Sync | Turns the capture into a real version lease at commit time; `captureVersion`/`commitCapture` serve React's two-phase "render may be discarded, only commit counts" model (`useStoreResource` in `@migaia/store-react` uses them this way) |
| `dispose()` | `() => void` | none | Sync | Graceful release: with holders left it moves to `closing` and cleans up only after the last holder releases |
| `forceDispose()` | `() => void` | none | Sync | Ignores holders and moves straight to the end state, cleaning up every internal state |
| `whenTerminal()` | `() => Promise<void>` | none | Async | Resolves only after the logical disposal and the actual disposers have finished; does not depend on GC and works whenever it is called |
| `subscribe(listener)` | `(() => void) => () => void` | `listener: () => void` | Sync | Registers a change listener (together with `getSnapshot()` it can feed `useSyncExternalStore` directly) |
| `getSnapshot()` | `() => number` | none | Sync | A monotonically increasing revision number that increments on every state change |
| `readSnapshot()` | `() => { value, version, token }` | none | Sync | Like `read()`, but also returns the version number and the `IVersionToken`, for callers that need exact version information |
| `captureSnapshot(existingLease?)` | see `useStoreResource` | `existingLease?: object` | Sync | Combines a snapshot read with `captureVersion`; pass the previously committed release function as `existingLease` to skip a duplicate capture |

### 8.3 IStoreResourceOptions

| Field | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `runtime` | `IRuntime` | optional | shared Runtime | Owns deferred idle cleanup and diagnostics |
| `scheduler` | `IScheduler` | optional | `systemScheduler` | Read once at creation for cache lifetime and provisional capture expiry; task cancellation and unref behaviour are preserved |
| `keepAliveMs` | `number` | optional | `1000` | How many milliseconds the cached value survives once there is no holder (resource leases + version leases + pending captures); must be finite and non-negative, otherwise construction throws `RangeError` |
| `dispose` | `(value: T) => void \| PromiseLike<void>` | optional | none | Custom cleanup; when given, values must be reference types (objects or functions), otherwise `TypeError`; when omitted, a value's own `$dispose` method (for example another store) is called automatically |
| `onError` | `(error, phase: StoreResourceErrorPhase) => void` | optional | none | Observes failures in the `'load' \| 'dispose' \| 'listener'` phases; when the reporter itself throws or rejects, the owning Runtime reports both the original failure and the reporter failure, and the resource state does not change |
| `onTerminal` | `() => void` | optional | none | Called once when the resource reaches its end state |

`factory` may be a function `(context) => T \| Promise<T>` or an object `{ load, runtime?, scheduler?, dispose?, keepAliveMs?, onError?, onTerminal? }` (equivalent to merging those fields with `options`). `IStoreResourceLoadContext` provides `{ signal, generation, token }`; `signal` aborts when that load is superseded or the resource closes.

Construction reads only the known fields above into a stable snapshot: `load` and each known accessor are read at most once, and unknown field getters are neither enumerated nor run; own enumerable fields of an explicit `options` override fields of the same name on the factory object. `dispose`, `onError` and `onTerminal` must be functions when present; otherwise a tagged `INVALID_OPTION` is thrown synchronously before any request or Resource state is created.

Automatic `$dispose` and custom disposers follow lifecycle's common admission rules: the disposer getter and the `then` getter are each read once, and the captured functions are called with the original resource and the original thenable as receiver. The original exception of a getter, a call or an async rejection is reachable through `onError(error, 'dispose')`; repeated `forceDispose()` never cleans the same value twice.

### 8.4 createStoreResourceScope

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const scope = createStoreResourceScope()
const userResource = scope.resource((ctx) => fetchUser(ctx.signal))
const settingsResource = scope.resource((ctx) => fetchSettings(ctx.signal))

// component unmount / request end
scope.dispose() // calls forceDispose() on every resource in the group
```

`scope.resource()` delegates to `createStoreResource()` as is, with the same known-field snapshot and callback precedence, and never spreads or enumerates the factory again; the user's effective `onTerminal` is unchanged. The scope removes resources that end on their own from its private set through `whenTerminal()`, without rewriting any public disposer. `scope.dispose()` force-releases (`forceDispose`) every resource still in the group without waiting for holders: it assumes the whole scope is closing and individual holders no longer matter.

---

## 9. Constants and error factories

Besides the creation entry points, the `$` API and the FieldBuilder protocol, the package root exports these constants and error factories:

```ts doc-test=skip reason="Signature summary, not a runnable module"
export const StoreFieldMode = { sync: 'sync', async: 'async' } as const
export type IStoreFieldMode = (typeof StoreFieldMode)[keyof typeof StoreFieldMode]
```

- `StoreFieldMode`: the valid values of `FieldBuilder.mode` (`'sync'` / `'async'`), used to label `mode` in a custom builder; see [section 6](#6-fieldbuilder-the-custom-field-protocol).

```ts doc-test=skip reason="Signature summary, not a runnable module"
export const STORE_LIGHT_SOURCE = 'store.light'

function createStoreLightError(
  code: IStoreLightErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error
function createStoreLightRangeError(code: IStoreLightErrorCode, message: string): RangeError
function createStoreLightTypeError(
  code: IStoreLightErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError
function createStoreLightAggregateError(
  code: IStoreLightErrorCode,
  errors: unknown[],
  message: string
): AggregateError
```

- `STORE_LIGHT_SOURCE`: the fixed `error.source` value `'store.light'` of every error from this package, for filtering or asserting errors by origin.
- `createStoreLightError(code, message, options?)`: builds a plain `Error` carrying the `(source, code)` identity (through `attachErrorIdentity` from `@migaia/utils/error`); `options.cause` is optional and passed to the `Error` constructor only when set.
- `createStoreLightRangeError(code, message)`: the same, building a `RangeError`; no `cause` option.
- `createStoreLightTypeError(code, message, options?)`: the same, building a `TypeError`; `options.cause` is optional.
- `createStoreLightAggregateError(code, errors, message)`: builds `AggregateError(errors, message)` with the `(source, code)` identity; `errors: unknown[]` (required) stays reachable on the result's `.errors`.

These four factories are the tools this package uses to build all of its own errors. They are exported for advanced integrations that want to throw their own diagnostics under the `@migaia/store-light` identity (for example a custom `FieldBuilder` reusing the same identity convention); everyday code does not call them, and simply catches this package's errors and branches on `error.code` (see the table below).

---

## 10. Error reference

Errors created by this package use `source: 'store.light'` and a stable `code`. Reactive ownership errors and Resource request failures and cancellations keep their original owner. FieldBuilder initialization failures and late field cleanup failures keep a complete existing identity; other native extensible Errors are marked `INITIALIZATION_FAILED` / `FIELD_DISPOSE_FAILED` on the original object, keeping type, message and stack; values that cannot carry an identity stay reachable through the `cause` of a coded fallback. When initialization and cleanup both fail, the primary Error stays the original object when its cause can be written, and an existing cause is merged with the cleanup failure; otherwise an `INIT_AND_CLEANUP_FAILED` AggregateError is used.

| `StoreLightErrorCode` | Code | When / what to do |
| --- | --- | --- |
| `storeDisposed` | `STORE_DISPOSED` | Access after the store ended; create a new store instead of reviving the old one |
| `resourceDisposed` | `RESOURCE_DISPOSED` | A read or retain after the resource is closing/disposed; stop using it and create a new resource |
| `captureInvalid` | `CAPTURE_INVALID` | The capture token is invalid or already consumed; capture again, a token commits only once |
| `unknownVersion` | `UNKNOWN_VERSION` | Retaining or capturing an invisible version; take the version again from the current snapshot |
| `identityRequired` | `IDENTITY_REQUIRED` | A factory with `dispose` returned a primitive; return an object or function with trackable identity |
| `noAsyncInit` | `NO_ASYNC_INIT` | An object not registered by this package instance was passed; both sync and async stores can be awaited |
| `storeNotReady` | `STORE_NOT_READY` | Access while async fields are pending/failed; await `storeReady()` first |
| `initAndCleanupFailed` | `INIT_AND_CLEANUP_FAILED` | The rollback failure could not be attached to the primary error; expand `cause` / `errors` |
| `initializationFailed` | `INITIALIZATION_FAILED` | An unclassified FieldBuilder initialization failure; inspect the original error and its cause |
| `fieldDisposeFailed` | `FIELD_DISPOSE_FAILED` | A late field cleanup failed; reported by the owning Runtime |
| `syncFieldRequired` | `SYNC_FIELD_REQUIRED` | `createStore()` received an async FieldBuilder; use `createAsyncStore()` |
| `actionBatchBoundary` | `ACTION_BATCH_BOUNDARY` | Diagnostic for an async action that keeps writing after its first await; put those writes into `$batch()` explicitly |
| `envUnsupported` | `ENV_UNSUPPORTED` | `WeakRef`/`FinalizationRegistry` is missing; fix the deployment environment |
| `invalidOption` | `INVALID_OPTION` | Invalid keepAlive, write target or hydrate option; correct the input as the message says |

| Error message | When |
| --- | --- |
| `[store] store is disposed` | A user field or guarded method is accessed after `$dispose()` (`$own` checks disposal first); idempotent `$dispose()`, `$disposed`, `$runtime` and `$async` keep working |
| `[store] store is ${status}; use createAsyncStore() before accessing async fields` | Reading an async field that is not ready (`pending`) or has failed (`failed`) |
| `[store] createStore() only accepts synchronous fields; "${key}" is a IFieldBuilder. Use createAsyncStore().` | The shape passed to `createStore()` (not `createAsyncStore`) contains a `FieldBuilder` without `mode: 'sync'` |
| `[store] field is not settable: ${key}` | A key passed to `$set()` has no signal (a computed, wasm field or method, or a key that does not exist) |
| `[store] unknown hydration field: ${key}` | `$hydrate(partial, { unknown: 'strict' })` met an unknown key |
| `[store] store has no asynchronous initialization` | `storeReady()` called with something that is not a store (or was not created by `createStore`/`createAsyncStore`) |
| `this node is already owned by another Runtime` / `${what} belongs to a different Runtime than this scope` / `${what} is not a Runtime-owned reactive node` / `${what} belongs to another Runtime` | `$own(resource)` received a resource owned by another Runtime, or something that is not a reactive node registered with this Runtime (ownership checks from `@migaia/reactive`) |
| `[store] resource is disposed` | `preload`/`retry`/`retain*`/`captureVersion`/`commitCapture` and similar calls on a `disposed`/`closing` `StoreResource` |
| `[store] unknown resource version` | The version passed to `retainVersion(version)`/`captureVersion(id)`/`commitCapture(capture)` is neither current nor in the retired/stale/closing lists |
| `[store] resource factory returned a disposed value` | `factory` returned a value already marked disposed (a released reference reused) |
| `[store] disposable resource values must use reference identity` (`TypeError`) | `dispose` is configured but `factory` produced a primitive (not an object or function), so its lifecycle cannot be tracked by reference |
| `[store] invalid or consumed resource capture` | `commitCapture()`/`captures.inspect()` received a capture that was already committed, expired, or issued by another resource |
| `[store] keepAliveMs must be a finite non-negative number` (`RangeError`) | `IStoreResourceOptions.keepAliveMs` is negative, `NaN` or `Infinity` |

---

## 11. Lifecycle and release semantics

**Failed store construction**: when processing any field of `shape` throws (for example a `FieldBuilder.create()` throws), the whole construction rolls back: native nodes are released synchronously in segments, outside resources are released by the lifecycle scope, the internal `signals`/`computeds`/`wasmFields`/`fieldSources` are cleared, and the original error keeps propagating (when cleanup itself fails, the cleanup error is attached to the original error's `cause` where possible, never replacing it).

**Failed async field initialization**: when any Promise in `readyList` rejects, the store is marked `disposed = true` at once, the remaining initializations in flight are aborted (`initAbort.abort()`), and the resources already created are released. This happens in the reject path of the `ready` Promise, so even when the caller never awaits `storeReady()`, the store has converged correctly and never sits in a zombie state with some fields usable.

**When `$dispose()` takes effect**: field reads and writes reference the underlying nodes (`node.value`) directly in closures, with no proxy over the store object. `$dispose()` therefore only has to flip the `disposed` flag, release the native node segments and the existing scope, and clear the internal maps. Every caller that already holds the store sees `[store] store is disposed` on later user-field reads, writes and guarded method calls.

**StoreResource holders**: a value counts as having no holder (and can be reclaimed) only when there is no active lease from `retainResource()`/`retainVersion()` and no uncommitted capture. A direct `captureVersion()` has no 4-second expiry; only the provisional capture converted after a pending generation succeeds has the 4000 ms abandonment window. The `keepAliveMs` countdown starts only when there is no holder at all, and is cancelled as soon as a new holder appears.

---

## 12. A production-like combined example

A "user settings panel": local writable fields use a strict actions-only guard, the remote profile loads asynchronously through `StoreResource`, and everything is released together when the component unmounts.

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
import { createStore } from '@migaia/store-light'
import { createMutationPolicy } from '@migaia/store-middleware'
import { createStoreResourceScope } from '@migaia/store-light'

const mutationPolicy = createMutationPolicy('actions-only')

const settingsStore = createStore(
  {
    theme: 'light' as 'light' | 'dark',
    fontSize: 14,
    get isDark() {
      return this.theme === 'dark'
    },
    setTheme(theme: 'light' | 'dark') {
      this.theme = theme
    }
  },
  { debugName: 'settings', mutationPolicy }
)

const scope = createStoreResourceScope()
const profileResource = scope.resource(
  async ({ signal }) => {
    const res = await fetch('/api/profile', { signal })
    if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`)
    return res.json() as Promise<{ name: string }>
  },
  {
    keepAliveMs: 30_000,
    onError: (error, phase) => console.error(`[profile] ${phase} failed`, error)
  }
)

// React-like render path:
// const profile = profileResource.read(); // throws a Promise while loading, handled by a Suspense boundary

// on unmount / page teardown:
function teardown() {
  scope.dispose() // force-releases profileResource
  settingsStore.$dispose()
}
```

---

## 13. Troubleshooting

**Q: Writing `this.x = 1` inside a getter throws.**
A computed has only a getter and no setter, so the property is not writable at the descriptor level; assigning to it in ESM strict mode throws `TypeError`. A derived value changes only through the signal fields it depends on.

**Q: `store.field = x` did not throw, although I passed `mutationPolicy`.**
Check whether the write went through `$batch`/`$set`/`$hydrate` or a method (action): these paths call `runInAction()` first, so `assertMutationAllowed` allows writes while the action depth is above zero. Only assignments outside those paths are blocked.

**Q: `createStore()` says "only accepts synchronous fields", but the code looks synchronous.**
Check that `FieldBuilder.mode` is explicitly `'sync'`; async fields use `'async'` and go to `createAsyncStore()`. The legacy form without a mode has been removed.

**Q: `StoreResource.read()` keeps throwing the same Promise and the page is stuck loading.**
Make sure the caller sits inside a Suspense boundary that awaits or handles the thrown Promise; throwing a Promise from `read()` is by design (the React Suspense protocol), not an error. The real problem is usually a missing `<Suspense>`, or rendering again synchronously before the Promise settles.

**Q: The old value disappeared after `retry()`.**
`retry()` only guarantees that the old value stays readable until the reload completes. If no `retainVersion` locks the old value, it is retired and cleaned up normally once loading succeeds (running the `dispose` option or the value's own `$dispose`). Use `retainVersion(version)` to keep a version.

**Q: What is the difference between `$plain()`/`$hydrate()` and `$snapshot()`?**
`$snapshot()` returns the current display state (including computeds and wasm fields) and requires the store to be ready; `$plain()`/`$hydrate()` handle only persistable signal fields and do not require readiness. Use the latter for persistence and hydration, the former for display and debugging.

## Build, test and troubleshooting

From the repository root: `pnpm --filter @migaia/store-light fmt` → `lint` → `typecheck` → `typecheck:test` → `test` → `build`. The browser integration path also runs `typecheck:e2e` and `test:e2e`.

Importing Store light alone creates no default Runtime. The shared default instance of reactive is taken only the first time a store is created without an explicit `options.runtime`; with an explicit runtime, construction uses that owner directly. The instance is the same object as the `defaultRuntime` later imported from the reactive root.

Actions keep the method's own return value or Promise outside the synchronous mutation callback. Only writes before the first `await` share that batch; use `$batch()` for writes after it. Mutation-policy callbacks stay synchronous. With `warnAsyncActions`, the first thenable an action returns is reported as `ACTION_BATCH_BOUNDARY` through the store's Runtime.

StoreResource uses the Runtime captured at creation for idle cleanup and diagnostics, and its admitted scheduler for the cache lifetime and the 4000 ms provisional capture window. `keepAliveMs: 0` still evicts synchronously. Without `onError`, the original failure goes to the Runtime; when a user reporter throws or rejects, both the original failure and the reporter failure reach the Runtime as the original objects. There is no fallback to the host console or a global reportError.

### Migration note: requests handed to Resource

StoreLight now adapts one `@migaia/resource` instance. It keeps the identity of actual values, render captures, resource and version leases and value release, and deletes its own duplicate request/data controller and request coordinator. `StoreResourceDataKind` and its type are removed; use `ResourceStatus` / `ResourceFetchStatus` for native Resource state. `StoreResourceKind` remains internal facade vocabulary; `readSnapshot()` still returns `value`/`version`/`token` and has no public kind property.

Repeated reads while loading throw the same Promise, which resolves with the original value. `retry()` or a forced cancellation rejects the superseded Promise at once with a native `AbortError`, source `@migaia/resource`, code `REQUEST_ABORTED`; previously a loader that ignored the abort could keep that Promise pending until it finished on its own. Handle the old Promise's rejection when driving retries by hand. Late returned values are released once. A failed refresh restores the old data; an old version lease delays its release until the lease is released. Loaded values still waiting for clock settlement remain owned and are released if settlement fails. When admitting the provisional-capture timer fails, the partial captures and timers are released and reported as release housekeeping; a value that loaded successfully stays readable and notifies subscribers. No async-context mechanism is introduced.

### Migration note: public API convergence

The root entry no longer exports `StoreResourceKind` or `IStoreResourceKind`; the ownership vocabulary stays internal, and public resources expose snapshots and completion methods. `ILegacyFieldBuilder` is removed: use `IAsyncFieldBuilder` with `mode: 'async'`. `IFieldBuilder` remains the union of explicit sync/async builders, including its store-wasm re-export. Replace `resource.retain()` with `retainResource()` and `resource.retain(version)` with `retainVersion(version)`. No compatibility alias remains. External usage is unknown; publish this as a breaking API change.
