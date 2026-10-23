# @migaia/store-light

[中文](./README.md)

For object state such as forms, settings or a session, hand-written code has to recompute derived values and notify the page at every change, and remember to clean up on the way out. `@migaia/store-light` takes the object as you would write it: plain fields become reactive values, getters become derived values that update themselves, methods become actions that publish once, and the store adds subscription, persistence and disposal. It also has an async value container, `createStoreResource`, that releases loaded objects such as connections or decoders when nobody uses them. It is built on `@migaia/reactive` and depends on no UI framework.

## You may have run into

- **A derived value is not updated**: the item list changed, but the total and the summary were not updated with it. The cause is that derived values are recomputed by hand at every place that changes the data.
- **Listeners see half-written state**: a method changes the list and then the total, and a listener runs between the two writes and sees the new list with the old total. The cause is that every write notifies on its own.
- **Restoring settings silently loses data**: after an upgrade, restoring saved settings writes retired fields into the state, or drops fields the new version lacks without anyone noticing. The cause is persistence through something like `Object.assign`, which copies whatever it is given.
- **The previous user's data is still on screen after sign-out**: the session state is no longer used, but a callback nobody cleaned up still reads it. The cause is that a plain object never knows it has been released.
- **Async-loaded objects are never closed**: a connection or decoder stays open after the component unmounts, and after a reload the old one stays in memory. The cause is that nobody records who still uses it and when it should close.

## Why choose it

- **Just write a plain object.** The usual reactive style wraps every field in a signal and every derived value in a computed; here fields, getters and methods become reactive values, derived values and actions, and the state still looks like the object it describes. [Example](./USEGUIDE.en.md#plain-object-in-reactive-state-out)
- **An action publishes once when it returns.** All writes inside one method call are announced together when it returns, so listeners never see half-written state. [Example](./USEGUIDE.en.md#plain-object-in-reactive-state-out)
- **Persistence takes only what can be restored.** `$plain()` returns only the writable fields; `$hydrate()` writes back only fields the store has and can report or reject unknown ones. [Example](./USEGUIDE.en.md#save-only-what-can-be-restored)
- **Access after disposal fails at once.** After `$dispose()`, reading or writing a field and calling a method throw `STORE_DISPOSED`, so a stale reader fails where it reads instead of showing old data. [Example](./USEGUIDE.en.md#reading-a-released-store-fails-loudly)
- **Async values have a clear owner.** `createStoreResource` tracks holders and releases the value `keepAliveMs` after the last holder leaves; a reload releases the old value only after the new one is published, and every value is released exactly once. [Example](./USEGUIDE.en.md#reloading-releases-the-old-value-exactly-once)

## Start here

The example below is a cart: the list, the total and a summary live in one plain object, and `add` changes two fields. Run it directly with Node 24.

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

`summary` is an ordinary getter that recomputes when the `items` and `total` it reads change. Each `add` call produces one notification, and by then both fields are updated.

Next: more uses are listed in [Find by scenario in the USEGUIDE](./USEGUIDE.en.md#find-by-scenario); for async values that must be released after loading, see [Release an async value when nobody uses it](./USEGUIDE.en.md#release-an-async-value-when-nobody-uses-it).

## The traps of hand-written code

Below is a common hand-written state object. It runs, but it has three traps (for illustration only; no need to run it):

```ts doc-test=check
const listeners = new Set<() => void>()
const cart = {
  items: [] as string[],
  total: 0,
  summary: '',
  add(name: string, price: number) {
    this.items = [...this.items, name]
    // Trap 1: every write notifies on its own; a listener here sees the new list with the old total
    listeners.forEach((listener) => listener())
    this.total += price
    // Trap 2: the derived value is recomputed by hand; another method that forgets this line leaves a stale summary
    this.summary = `items: ${this.items.length}, total: ${this.total}`
    listeners.forEach((listener) => listener())
  }
}

// Trap 3: there is no notion of release; after sign-out a listener nobody removed still reads the previous user's data
listeners.add(() => console.log(cart.summary))
cart.add('keyboard', 300)
```

With `createStore`, the summary is a getter that recomputes when the fields it reads change, a method's writes are published together when it returns, and any access after `$dispose()` throws.

## A three-minute mental model

`createStore` sorts every property of the object by how it is written:

| You write | It becomes | In one sentence |
| --- | --- | --- |
| A plain value `count: 0` | Reactive value | Reading records a dependency, writing notifies |
| A getter `get doubled()` | Derived value | Computed only when read, recomputed only when what it reads changes; read-only |
| A method `increment()` | Action | Writes in one call are published together when it returns; reads inside it do not subscribe the caller |
| `raw(value)` | Field kept as is | Even a function is stored as data, readable and writable |
| A custom field (FieldBuilder) | Extension field | Created by an extension, such as a WASM-backed field |

A few terms:

- **`$` API**: `$subscribe`, `$batch`, `$set`, `$plain`, `$hydrate`, `$own`, `$dispose` and the rest live on the store as non-enumerable properties, so they never mix with your fields; definitions cannot use these names.
- **Runtime**: every node belongs to one `@migaia/reactive` Runtime. The shared one is used by default; pass `options.runtime` to isolate server rendering or tests.
- **StoreResource**: an async value container separate from the object store. It owns the value and releases it only after every holder (`retainResource()`, versions locked during rendering) has left.

## Typical scenarios

| Scenario | How to combine | Details |
| --- | --- | --- |
| Forms, carts, settings panels | `createStore` + getters + methods | [USEGUIDE](./USEGUIDE.en.md#plain-object-in-reactive-state-out) |
| Save to local storage and restore after an upgrade | `$plain()` + `$hydrate(partial, { unknown })` | [USEGUIDE](./USEGUIDE.en.md#save-only-what-can-be-restored) |
| Sign-out, page teardown | `$dispose()`, with outside resources released through `$own()` | [USEGUIDE](./USEGUIDE.en.md#reading-a-released-store-fails-loudly) |
| Store callbacks or outside instances | `raw()` | [USEGUIDE](./USEGUIDE.en.md#keep-a-callback-as-a-replaceable-field) |
| Connections, decoders and other values released after loading | `createStoreResource` + `retainResource()` | [USEGUIDE](./USEGUIDE.en.md#release-an-async-value-when-nobody-uses-it) |
| Allow field changes only inside methods | `mutationPolicy` | [USEGUIDE](./USEGUIDE.en.md#7-mutation-guards-imutationguard--imutationpolicy) |

## Installation

```bash
pnpm add @migaia/store-light
```

The package has only the root entry `@migaia/store-light`. Use `@migaia/store-indexed` for lists and collections with frequent inserts and removals, and `@migaia/store-keyed` for addressing by a stable business key; persistence and React bindings come from `@migaia/store-persist` and `@migaia/store-react`.

## Common APIs

| API | What it does |
| --- | --- |
| `createStore(shape, options?)` | Creates a store from a plain object; the definition cannot contain async fields |
| `createAsyncStore(shape, options?)` | For definitions with asynchronously initialized fields; the returned Promise completes once every field is ready |
| `store.$subscribe(fn)` / `store.$batch(recipe)` | Subscribe to any field change / merge several writes into one notification |
| `store.$plain()` / `store.$hydrate(partial, options?)` | Take the persistable fields / write saved fields back |
| `store.$dispose()` | Releases the store; later access throws `STORE_DISPOSED` |
| `createStoreResource(factory, options?)` | Creates an async value released by holder count |

## Contract details

`createStore` takes a `shape` typed as `IStoreDefinition<S>` with inferred `this`, accepting synchronous fields only. Its optional `options?: ICreateStoreOptions` selects the Runtime and async Action warnings; the result is `IReactiveStore<S>`. Use `createAsyncStore` for asynchronous fields and await its Promise before reading the ready fields.

Every signature, boundary behaviour and error message is in [USEGUIDE.en.md](./USEGUIDE.en.md). These are the constraints that matter most in use.

1. **Getters are read-only.** A derived value has no setter, and assigning to it throws `TypeError`; change it only through the fields it reads.
2. **In an async method, only writes before the first `await` share the batch.** Put writes after an `await` into `$batch()`. With `warnAsyncActions`, the first thenable an action returns is reported through the Runtime as `ACTION_BATCH_BOUNDARY`. Actions keep the method's own return value or Promise.
3. **`$batch()` is not a transaction.** A recipe that throws halfway does not roll back writes already made; the same holds for `$hydrate()`.
4. **`$dispose()` flips the state before releasing.** `$disposed` becomes `true` before any resource is released; afterwards reading or writing a field and calling a method throw `STORE_DISPOSED`, while `$disposed`, `$runtime`, `$async` and another `$dispose()` keep working. Every call returns the same Promise, which completes after every internal node and every resource registered through `$own()` has been released.
5. **A failed construction rolls back.** If any step of construction fails, the nodes already created are released in reverse registration order and the original error keeps propagating; a failing cleanup is attached to the original error instead of replacing it.
6. **Importing creates no default Runtime.** The shared default Runtime of reactive is taken the first time a store is created without `options.runtime`, and it is the same object as the `defaultRuntime` exported from the root of `@migaia/reactive`.
7. **StoreResource owns its values.** With a `dispose` option, values must be objects or functions; without one, a value's own `$dispose` method is called. The countdown after the last holder leaves is `keepAliveMs` (default 1000; `0` releases synchronously); during React rendering, capture/commit leases protect the version on screen.
8. **Error identity.** Errors produced by this package carry `source === STORE_LIGHT_SOURCE` (`store.light`) and a `code` from `StoreLightErrorCode`; ownership errors from reactive and request failures and cancellations from resource keep their original identity.

Requests, data, cancellation and the shared Promise are handled by one instance of `@migaia/resource`; StoreResource only adds value ownership, render captures, version leases and exactly-once release on top. Migration notes (removal of `StoreResourceDataKind`, `StoreResourceKind` and `retain()`) are at the end of the USEGUIDE.

**When not to use it**: for lists and collections with frequent inserts and removals, entities addressed by id, or data that needs index queries, use store-indexed, store-keyed and the related packages.
