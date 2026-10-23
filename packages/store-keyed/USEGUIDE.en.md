# `@migaia/store-keyed` usage guide

[中文](./USEGUIDE.md)

What the package is for, its highlights and its mental model are in the [README](./README.en.md). This guide first gives runnable examples by scenario (Node 24), then lists the signature, boundary behaviour and failure conditions of every API.

## Find by scenario

| Your problem | Read this section |
| --- | --- |
| State leaks between server requests or between tests | [One definition, a separate value per request or test](#one-definition-a-separate-value-per-request-or-test) |
| One field of a large object changes and components reading other fields re-render | [Subscribe to one field of a large object](#subscribe-to-one-field-of-a-large-object) |
| Changing one list item re-renders the whole list | [Update one row without re-rendering the whole list](#update-one-row-without-re-rendering-the-whole-list) |
| A Map of state by chat id keeps growing | [One state per chat id, without a hand-written Map](#one-state-per-chat-id-without-a-hand-written-map) |
| A test must replace a dependency such as the time without changing the code under test | [Swap one dependency in a test without touching the code under test](#swap-one-dependency-in-a-test-without-touching-the-code-under-test) |

## One definition, a separate value per request or test

State kept in a module-level variable is shared by everything that imports it. On a server, one request's cart shows up in another request; in tests, one case's leftovers break the next.

The usual fix is to wrap the state in a factory and thread the instance through every function that needs it, which changes every call site and still leaves object initial values shared by reference if someone forgets to copy them.

Here the definition (`atomDef`, `derivedDef`) only describes the state and holds no value, so it can stay at module level. Each `createAtomStore` gives that definition its own value, and object or array initial values are cloned for every store.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, derivedDef } from '@migaia/store-keyed'

// Definitions are written once at module level; they hold no value
const cartDef = atomDef({ items: [] as string[] }, 'cart')
const countDef = derivedDef((get) => get(cartDef).items.length, 'count')

// Each server request (or each test) creates its own store, which holds its own values
function handleRequest(user: string, items: string[]) {
  const store = createAtomStore(createRuntime())
  for (const item of items) store.set(cartDef, (cart) => ({ items: [...cart.items, item] }))
  console.log(`items in ${user}'s cart: ${store.get(countDef)}`)
  store.dispose()
}

handleRequest('Ada', ['keyboard', 'mouse'])
handleRequest('Grace', ['monitor'])

// An object initial value is copied per store, so mutating it in place cannot leak into another store
const a = createAtomStore(createRuntime())
const b = createAtomStore(createRuntime())
a.get(cartDef).items.push('accidental edit')
console.log(`initial value in another store: ${JSON.stringify(b.get(cartDef))}`)
a.dispose()
b.dispose()
```

Output:

```text
items in Ada's cart: 2
items in Grace's cart: 1
initial value in another store: {"items":[]}
```

Ada's cart has 2 items and Grace's has 1, although both requests used the same definitions. Mutating the initial object in one store leaves the other store's initial value empty.

The definition is the shared vocabulary and the store is the place where values live. Dispose a store when its request or test ends to release every value it created.

## Subscribe to one field of a large object

A profile object holds the name, the avatar and the online flag. A component that only shows the name re-renders every time the online flag flips.

Subscribing to the whole object is simplest, so every field change notifies every reader; splitting the object into separate stores instead forces every writer to update several places.

`focusDef(profileDef, 'name')` is a definition for one field. Reading it subscribes only to that field's value, and writing it produces a new profile object with that field replaced.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, focusDef } from '@migaia/store-keyed'

const profileDef = atomDef({ name: 'Ada', avatar: 'a.png', online: true }, 'profile')
// A component that only shows the name subscribes to this field, not to the whole profile
const nameDef = focusDef(profileDef, 'name')

const store = createAtomStore(createRuntime())
store.get(nameDef)
store.sub(nameDef, () => console.log(`name updated: ${store.peek(nameDef)}`))

store.set(profileDef, (profile) => ({ ...profile, online: false })) // only the online flag changes
store.set(nameDef, 'Ada Lovelace') // writing through the field definition updates the whole object
await Promise.resolve()

console.log(`profile: ${JSON.stringify(store.peek(profileDef))}`)
store.dispose()
```

Output:

```text
name updated: Ada Lovelace
profile: {"name":"Ada Lovelace","avatar":"a.png","online":false}
```

Changing the online flag does not notify the name subscriber; writing the new name does, and the profile object ends up with both changes.

Paths can be up to three keys deep (`focusDef(def, 'user', 'address', 'city')`); for deeper paths combine several `focusDef`s or write an `opticDef`.

## Update one row without re-rendering the whole list

Ticking one todo re-renders every row, because every row reads the same array and the array is replaced on every change.

Hand-written per-row subscriptions need a lookup by id, care when items are reordered or removed, and code that writes the change back into the array immutably.

`splitDef(todosDef, (todo) => todo.id)` turns the array into one definition per key. Each row reads `todos.of(id)` and is notified only when its own item changes; writing the item writes a new array back to the source.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, splitDef } from '@migaia/store-keyed'

type ITodo = { id: string; title: string; done: boolean }
const todosDef = atomDef<ITodo[]>(
  [
    { id: 't1', title: 'write the weekly report', done: false },
    { id: 't2', title: 'fix the login bug', done: false }
  ],
  'todos'
)
// Split by id into one definition per item: each row subscribes only to its own item
const todos = splitDef(todosDef, (todo) => todo.id)

const store = createAtomStore(createRuntime())
for (const id of ['t1', 't2']) {
  const row = todos.of(id)
  store.get(row)
  store.sub(row, () => console.log(`row ${id} re-renders: ${JSON.stringify(store.peek(row))}`))
}

store.set(todos.of('t2'), (todo) => ({ ...todo, done: true })) // tick the second item
await Promise.resolve()
console.log(`list: ${store.peek(todosDef).map((todo) => `${todo.id}=${todo.done}`).join(', ')}`)
store.dispose()
```

Output:

```text
row t2 re-renders: {"id":"t2","title":"fix the login bug","done":true}
list: t1=false, t2=true
```

Only row `t2` re-renders, and the source list now has `t2` marked done.

Keys must be unique: a duplicate key throws when the list is read. Reading or writing a key that has been removed from the array throws instead of returning stale data.

## One state per chat id, without a hand-written Map

Every chat needs its own draft. A hand-written `Map<chatId, state>` grows forever unless someone remembers to delete entries, and two lookups for the same id can create two different states.

Caching by key looks trivial, but it has to return the same object for the same key, bound its size, and still work when the same chat is open in several independent scopes.

`familyDef(initial)` returns a function from key to definition: the same key always gives the same definition token, so every store gives that chat its own value. `maxSize` (default 4096) bounds the cache, and `forget(key)` drops one key.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createAtomStore, derivedFamilyDef, familyDef } from '@migaia/store-keyed'

// One draft per chat: the same id always gives the same definition
const draftByChat = familyDef((chatId: string) => `(empty draft for ${chatId})`, { maxSize: 100 })
const lengthByChat = derivedFamilyDef((chatId: string) => (get) => get(draftByChat(chatId)).length)

const store = createAtomStore(createRuntime())
store.set(draftByChat('product'), 'ship tomorrow')
console.log(`same id, same definition: ${draftByChat('product') === draftByChat('product')}`)
console.log(`product draft: ${store.get(draftByChat('product'))}, ${store.get(lengthByChat('product'))} characters`)
console.log(`engineering draft: ${store.get(draftByChat('engineering'))}`)

draftByChat.forget('engineering') // the chat was deleted; stop caching its definition
console.log(`cached chats: ${draftByChat.size}`)
store.dispose()
```

Output:

```text
same id, same definition: true
product draft: ship tomorrow, 13 characters
engineering draft: (empty draft for engineering)
cached chats: 1
```

The same id returns the same definition, the product chat keeps its draft, the engineering chat starts from its initial draft, and after `forget` only one chat remains cached.

Beyond `maxSize`, the least recently used entries are held weakly: a definition still referenced (for example instantiated in a store) is still found for the same key. This needs `WeakRef` and `FinalizationRegistry` in the host.

## Swap one dependency in a test without touching the code under test

A price depends on the current hour, and testing the night discount means waiting until 22:00 or rewriting the code so the hour can be injected.

Injecting every such dependency by hand spreads test-only parameters through production code, and global mocks of `Date` leak into unrelated tests.

`store.override(definition, replacement)` routes reads of one definition to another inside this store only. The code under test keeps using the same definition tokens, and calling the returned function undoes the override.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { atomDef, createAtomStore, derivedDef } from '@migaia/store-keyed'

// Code under test: the price is discounted depending on the current hour
const priceDef = atomDef(100, 'price')
const nowDef = derivedDef(() => new Date().getHours(), 'now')
const finalPriceDef = derivedDef((get) => (get(nowDef) >= 22 ? get(priceDef) * 0.5 : get(priceDef)), 'finalPrice')

// The test replaces "the current hour" with a fixed value; the definitions the code uses stay the same
const store = createAtomStore(createRuntime())
const undo = store.override(nowDef, derivedDef(() => 23))
console.log(`price at 23:00: ${store.get(finalPriceDef)}`)

undo()
store.override(nowDef, derivedDef(() => 9))
console.log(`price at 09:00: ${store.get(finalPriceDef)}`)
store.dispose()
```

Output:

```text
price at 23:00: 50
price at 09:00: 100
```

With the hour fixed at 23 the price is 50; after undoing and fixing it at 9 the price is 100.

An override must keep the write contract: read-only definitions can be replaced by any definition of the same value type, writable ones only by definitions that are written the same way, otherwise a `TypeError` is thrown.


---

## API manual

### Contents

1. [Modules and source layers](#1-modules-and-source-layers)
2. [Definition layer reference](#2-definition-layer-reference)
3. [AtomStore API reference](#3-atomstore-api-reference)
4. [Definition optics reference](#4-definition-optics-reference)
5. [Low-level optics functions reference](#5-low-level-optics-functions-reference)
6. [Definition family reference](#6-definition-family-reference)
7. [Error tools reference](#7-error-tools-reference)
8. [Subpath: reactive/atom](#8-subpath-reactiveatom)
9. [Lifecycle and release details](#9-lifecycle-and-release-details)
10. [Notes in detail](#10-notes-in-detail)
11. [Complete example](#11-complete-example)
12. [Troubleshooting](#12-troubleshooting)
13. [Build gates](#13-build-gates)

---

## 1. Modules and source layers

The source is layered by dependency direction; lower layers know nothing about higher ones:

```text
atom/definition.ts     — pure definitions: discriminated union + frozen-object constructors, imports no runtime
atom/kind-constants.ts — the AtomKind constant table
atom/store.ts          — AtomStore: puts definitions on an IRuntime, manages instances/overrides/previews
atom/def-optics.ts     — definition-level optics: selectDef/opticDef/focusDef/splitDef
atom/optics-path.ts    — pure functions shared by optics and split (path reads/writes, split-by-key primitives)
family/definition.ts   — definition-level families: familyDef/derivedFamilyDef (token cache by key)
errors.ts / error-code.ts / error-text.ts — error constructors, stable error codes and diagnostic text at the package boundary
reactive/atom.ts       — protocol types for "instance-style" atoms; only types and cross-Runtime checks, no implementation
```

The main entry publishes definitions/store, definition optics, families and error tools; `assertNotThenable` is published only from `@migaia/store-keyed/atom/definition`. The ten advanced pure optics primitives are published from `@migaia/store-keyed/optics`, which maps straight to their owner `atom/optics-path`, with no wrapper or root compatibility alias. The narrow atom/store, atom/definition and reactive/atom entries remain.

---

## 2. Definition layer reference

Source: `src/atom/definition.ts`, `src/atom/kind-constants.ts`. Every constructor returns an `Object.freeze`d plain object branded internally with `Symbol.for('morning-watch.store.atom-definition')` (`Symbol.for` uses the global registry, so two copies of the package in the same realm, for example the app bundle and a devtools bundle, still recognize each other's definitions; transfer across workers or realms is outside this brand protocol).

| Constructor | Signature | Parameters | Sync/async | `kind` | Notes |
| --- | --- | --- | --- | --- | --- |
| `atomDef` | `<T>(init: T, debugLabel?: string) => IPrimitiveDefinition<T>` | `init: T`; `debugLabel?: string` | Sync | `'primitive'` | Source definition holding only an initial value. Every `AtomStore` runs `cloneInitial` on `init` when it first instantiates it (see [section 9](#9-lifecycle-and-release-details)), so the same `atomDef({ list: [] })` never shares one object reference across stores. |
| `atomDefFactory` | `<T>(create: () => T, debugLabel?: string) => IPrimitiveFactoryDefinition<T>` | `create: () => T`; `debugLabel?: string` | Sync | `'primitive-factory'` | Source definition with a factory instead of a static initial value; `create()` runs once per store at first instantiation. `previewSafe` is always `false`, so `store.preview()` throws on it unless you use `previewSafeAtomDefFactory` below. |
| `previewSafeAtomDefFactory` | same as above | same as above | Sync | `'primitive-factory'` | The only difference from `atomDefFactory` is `previewSafe: true`. Wrap only pure, side-effect-free `create` functions: React's speculative preview may be discarded after `create()` has really run. |
| `derivedDef` | `<T>(read: IAtomRead<T>, debugLabel?: string, equals?: (a: T, b: T) => boolean) => IDerivedDefinition<T>` | `read: IAtomRead<T>`; `debugLabel?: string`; `equals?: (a: T, b: T) => boolean` | Sync | `'derived'` | Read-only derivation; the `get` in `read(get)` can only read other definitions in the same store. `equals` defaults to the underlying Computed comparison (`Object.is`); a custom `equals` avoids extra downstream notifications when values are equal but references differ. |
| `writableDef` | `<T, Args, Result>(read, write: IAtomWriter<Args, Result>, debugLabel?, equals?) => IWritableDerivedDefinition<T, Args, Result>` | `read: IAtomRead<T>`; `write: IAtomWriter<Args, Result>`; `debugLabel?: string`; `equals?: (a: T, b: T) => boolean` | Sync | `'writable-derived'` | Writable derivation; the `get`/`set` given to `write(get, set, ...args)` are the `IAtomGet`/`IAtomSet` of the same store, so write logic can read and write other definitions (typically: one `set` updating two related fields). |
| `isAtomDefinition` | `(value: unknown) => value is IAtomDefinition<unknown>` | `value: unknown` | Sync | — | Type guard checking the internal brand symbol; every `AtomStore` entry method validates its argument with it, and invalid values throw `TypeError('[store] not an atom definition')`. |
| `assertNotThenable` | `(value: unknown, context: string) => void` | `value: unknown`; `context: string` | Sync | — | Guard rejecting thenables; `atomDef`/`atomDefFactory` use it on initial values and factory results. `context` appears in the error message to mark the call site. A thenable (or a `.then` read that throws) throws `TypeError` with `code: 'INVALID_OPTION'`, keeping the original exception, if any, on `cause`. |

```ts doc-test=skip reason="Signature summary, not a runnable module"
const AtomKind = {
  primitive: 'primitive',
  primitiveFactory: 'primitive-factory',
  derived: 'derived',
  writableDerived: 'writable-derived'
} as const
type IAtomKind = (typeof AtomKind)[keyof typeof AtomKind]
```

`AtomKind` is a frozen constant object with no call parameters; `definition.kind` is always one of these four string literals and can drive `switch`/branching.

The four `kind`s form a discriminated union:

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IAtomDefinition<T> =
  | IPrimitiveDefinition<T>
  | IPrimitiveFactoryDefinition<T>
  | IDerivedDefinition<T>
  | IErasedWritableDerived<T> // writable-derived with its Args erased on the read side
```

Only `primitive`, `primitive-factory` and `writable-derived` can be passed to `store.set()` (`IWritableAtomDefinition`); `derived` is read-only, and `store.set()` always throws `TypeError` on it (see [section 7](#7-error-tools-reference)).

`debugLabel` is only for debugging (the underlying Signal/Computed uses it as `debugName`). It takes no part in equality and is not a key: two `atomDef`s with the same `debugLabel` are still two independent definition tokens.

Synchronous atoms reject Promise/thenable initial values. The guard covers object and function thenables and reads `then` only once through the utils probe (`probeThenable` from `@migaia/utils/function`); a failing hostile getter is turned synchronously into a Store Keyed tagged `INVALID_OPTION`, with the original exception on `cause`. Factory definitions apply the same guard to the returned value on their first `get`/`peek`/`preview`.

---

## 3. AtomStore API reference

```ts doc-test=check
import { createRuntime } from '@migaia/reactive'
import { createAtomStore, defaultAtomStore } from '@migaia/store-keyed'

const store = createAtomStore(createRuntime())
```

| Constructor | Signature | Parameters | Sync/async | Notes |
| --- | --- | --- | --- | --- |
| `createAtomStore` | `(runtime: IRuntime) => IAtomStore` | `runtime: IRuntime` | Sync | Every call produces a brand-new scope that never interferes with others. |
| `defaultAtomStore` | `(runtime: IRuntime) => IAtomStore` | `runtime: IRuntime` | Sync | The **default** (not the only) store for each `IRuntime`, cached in a `WeakMap<IRuntime, IAtomStore>`; a disposed old store is dropped and recreated. Meant for older instance-style APIs used without a Provider, so they share state on the same Runtime; Provider scenarios should each use their own `createAtomStore`. |

### 3.1 Reading

| Method | Signature | Parameters | Sync/async | Semantics |
| --- | --- | --- | --- | --- |
| `store.get(def)` | `<T>(definition: IAtomDefinition<T>) => T` | `definition: IAtomDefinition<T>` | Sync | Records a dependency edge inside the current Computed/Effect tracking window; outside a tracking context it is an ordinary read and does not throw. When the definition has no instance yet, one is created first according to its kind (a Signal or a Computed). |
| `store.peek(def)` | same as above | same as above | Sync | Untracked read that never records an edge. For "read once without becoming a dependency" (the `getSnapshot` of a React adapter is the typical case). |
| `store.preview(def)` | same as above | same as above | Sync | **Speculative** read for React concurrent rendering. When the definition already has a real instance in this store, it returns that instance's current value (`peek()` semantics); otherwise it computes a temporary value valid only for the current runtime version, creates no persistent instance, and drops the cached value after the Runtime's idle cleanup (a microtask by default) if it was never committed as a real instance. A `primitive-factory` must be marked `previewSafe` to run here, otherwise it throws; a cycle of self-dependency throws `[store] circular atom preview detected`. |

### 3.2 Writing

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
store.set(countDef, 1)
store.set(countDef, (previous) => previous + 1) // functional update
store.set(writableDerivedDef, ...customArgs) // goes through write(get, set, ...args)
```

`store.set(definition, ...args)` is wrapped in `runtime.batch(() => runtime.untracked(...))`: the batch makes all downstream recomputations caused by one `set` notify subscribers once, and `untracked` keeps the `set` itself from being recorded as a dependency by an outer Computed/Effect that is tracking.

- When the target resolves to `primitive`/`primitive-factory`: it writes the underlying Signal's `.value`, accepting a value or a `(previous) => next` updater.
- When the target resolves to `derived` (read-only): it throws `TypeError('[store] atom override resolved to a read-only definition')`. TypeScript normally prevents passing a read-only definition directly; this path is mostly hit when an override routes a writable definition to a read-only target.
- When the target resolves to `writable-derived`: it calls `write(store.get, store.set, ...args)` and returns what `write` returns.

To write several source definitions at once, use `store.setMany`:

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
store.setMany([
  [countDef, (previous) => previous + 1],
  [nameDef, 'Ada']
])
```

- It accepts only source definitions (`atomDef`, `atomDefFactory`). If an override routes any entry to a non-source definition, it throws `OVERRIDE_CONTRACT`.
- It first resolves every entry and runs every updater in order, and writes only after that. If any entry is rejected or any updater throws, every definition keeps its old value and no subscriber is notified.
- When a definition appears more than once, a later entry's updater receives the value computed by the earlier one, the same result as calling `set` one by one. An updater that reads another definition sees the value from before the call.
- The writes happen in one batch, so subscribers are notified once.

### 3.3 Subscribing

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
const unsubscribe = store.sub(doubledDef, () => {
  console.log('changed ->', store.peek(doubledDef))
})
```

`store.sub(def, onChange)` subscribes to that one node through a reactive static observer instead of handing the underlying node to the caller, so the instantiation strategy (when to create a Signal/Computed, whether lazily) can evolve without breaking subscribers. The first run only records dependencies and does not call `onChange`; after that, every dependency change calls `onChange` inside `runtime.untracked()`. An exception thrown by `onChange` is caught and passed to `runtime.reportError(error, { phase: 'subscription-listener' })`, without stopping other subscribers or ending this subscription. The returned `unsubscribe` is idempotent and safe to call several times.

<a id="34-override"></a>

### 3.4 Override

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
// read-only definition: can be routed to any definition of the same value type
store.override(derivedDef, replacement)
// primitive: only replaceable by primitive/primitive-factory
store.override(primitiveDef, replacementPrimitiveDef)
// writable-derived: only replaceable by a writable-derived with the same Args/Result
store.override(writableDerivedDef, replacementWritableDerivedDef)
```

The three overloads correspond to three "the write contract must stay the same" rules (the reason is item 3 of [section 10](#10-notes-in-detail)); breaking them throws `TypeError('[store] atom override must preserve the original write contract')`.

Behaviour details:

- An override is a **routing change**, not node destruction: the underlying state of both the old and the new definition is kept in full. After switching, existing downstream of the old definition is forcibly invalidated (`invalidateResolved`: it only cuts downstream edges and does not dispose the node), and the next read resolves to the new target.
- One definition can carry several stacked overrides (the latest call is on top, and resolution always takes the last layer); the undo function returned by `override()` removes **only its own layer**, whether or not it is currently on top.
- Both override and undo clear the internal `preview` cache (`previews.clear()`), so `store.preview()` never reads a stale speculative value from before the override.
- Resolution follows a possibly multi-layer override chain; a cycle throws `Error('[store] cyclic atom override')`.
- After the store is disposed, calling `override()` throws `[store] cannot use a disposed atom store` at the entry; an undo function obtained earlier and called after disposal is a no-op (it does not throw).

### 3.5 Observing and releasing

| Method | Signature | Parameters | Sync/async | Semantics |
| --- | --- | --- | --- | --- |
| `store.isObserved(def)` | `<T>(definition: IAtomDefinition<T>) => boolean` | `definition: IAtomDefinition<T>` | Sync | Whether the definition has an instance in this store with active subscribers; returns `false` when the definition was never `get`/`sub`bed, and the query itself creates no instance. |
| `store.release(def)` | `<T>(definition: IAtomDefinition<T>) => boolean` | `definition: IAtomDefinition<T>` | Sync | Removes only the instance of this one definition (cutting its edges and disposing the underlying node) without affecting other definitions in the store; returns whether anything was released. It tries both "the target after override resolution" and "the original definition passed in", covering instances created before an override took effect. |
| `store.size` | `number` (getter) | — (read-only getter, no parameters) | Sync | Number of definitions currently instantiated, usable as an observable assertion point for release behaviour. |
| `store.dispose()` | `() => void` | none | Sync | Releases the whole scope; see [section 9](#9-lifecycle-and-release-details). Idempotent; repeated calls are no-ops. |
| `store.runtime` | `IRuntime` (read-only) | — (read-only property, no parameters) | Sync | The runtime passed at creation, for adapters to cross-check. |
| `store.disposed` | `boolean` (getter) | — (read-only getter, no parameters) | Sync | Whether the store has been disposed. |

---

## 4. Definition optics reference

Source: `src/atom/def-optics.ts`. This is the definition-level counterpart of the instance-level `selectAtom`/`focusAtom`/`splitAtom` (which take "live" atom objects): everything produced here is a pure definition token that becomes state only through an `AtomStore`.

### 4.1 selectDef — read-only projection

```ts doc-test=skip reason="Signature summary, not a runnable module"
function selectDef<Source, Selected>(
  source: IAtomDefinition<Source>,
  select: (value: Source) => Selected,
  equals: (left: Selected, right: Selected) => boolean = Object.is
): IDerivedDefinition<Selected>
```

Equivalent to `derivedDef((get) => select(get(source)), undefined, equals)`. `equals` defaults to `Object.is`: when other fields of the source object change but the projected value does not (for example a new object with the same sub-field reference), downstream is not notified.

### 4.2 opticDef — writable projection with a custom lens

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IDefOptic<Source, Focus> = {
  get(source: Source): Focus
  set(source: Source, focus: Focus): Source
}

function opticDef<Source, Focus>(
  source: IStandardWritableDef<Source>, // a writable definition with standard set(update) semantics
  optic: IDefOptic<Source, Focus>
): IWritableDerivedDefinition<Focus, readonly [IAtomUpdate<Focus>], void>
```

On write it first reads the current focus with `optic.get` and compares it with `Object.is` against the new value from the update function (or direct value); when equal it skips `set(source, ...)` and produces no empty write. `source` must be a "standard writable definition" (`set(update)` semantics), because `opticDef` calls `set(source, optic.set(currentSource, nextFocus))` under that contract.

### 4.3 focusDef — built-in lens by field path

```ts doc-test=skip reason="Signature summary, not a runnable module"
focusDef(source, key1): IWritableDerivedDefinition<Source[key1], ...>;
focusDef(source, key1, key2): IWritableDerivedDefinition<Source[key1][key2], ...>;
focusDef(source, key1, key2, key3): IWritableDerivedDefinition<Source[key1][key2][key3], ...>;
```

A built-in specialization of `opticDef`: reads walk the path with `Reflect.get`, writes shallow-copy each level along the path (`[...value]` for arrays, `{...value}` for objects) and write back, never mutating the original and needing no hand-written immutable update. The types support up to three levels; deeper nesting needs several `focusDef`s combined or an `opticDef`.

Boundary behaviour:

- Calling it without any path segment throws `Error('[store] focusDef requires at least one path segment')`.
- Reading through `null` or a non-object value midway throws `TypeError('[store] focusDef cannot read path segment <key>')`.
- Writing through `null` or a non-object value midway (with more path left) throws `TypeError('[store] focusDef cannot write path segment <key>')`.
- The write path handles the `__proto__` key specially, using `Object.defineProperty` instead of `Reflect.set` to avoid prototype pollution.

### 4.4 splitDef — split an array by key

```ts doc-test=skip reason="Signature summary, not a runnable module"
type ISplitDefinition<T, Key> = {
  readonly source: IStandardWritableDef<readonly T[]>
  readonly items: IDerivedDefinition<readonly ISplitItemDef<T>[]>
  of(key: Key): ISplitItemDef<T>
  insert(store: IAtomStore, item: T, index?: number): void
  remove(store: IAtomStore, key: Key): boolean
  prune(store: IAtomStore): number
}

function splitDef<T, Key = number>(
  source: IStandardWritableDef<readonly T[]>,
  keyOf: (item: T, index: number) => Key = (_item, index) => index as unknown as Key
): ISplitDefinition<T, Key>
```

| Member | Parameters | Sync/async | Notes |
| --- | --- | --- | --- |
| `of(key)` | `key: Key` | Sync | Returns the writable item definition for the key; tokens are cached in an internal `Map`, so the same key always gives the same object reference, across stores too (this is the definition layer, not instances). Reads locate the index in the current source array with `keyOf`; if it is missing they throw `Error('[store] split def item was removed')`. Writes likewise throw `Error('[store] cannot write a removed split def item')`. |
| `items` | — (a `derivedDef` property, not a call) | — | A `derivedDef` whose value is the frozen array of `of(key)` definitions for the current source items; compared with a custom `equals` (`shallowArrayEquals`: same length and `Object.is` item by item), so updates other than reorder/insert/delete do not rerun its downstream, and item identities stay stable while the order is unchanged. |
| `insert(store, item, index?)` | `store: IAtomStore`; `item: T`; `index?: number` | Sync | Equivalent to `store.set(source, (previous) => spliceInsert(previous, item, index))`; `index` defaults to `+Infinity` (append) and is clamped to `[0, length]`. |
| `remove(store, key)` | `store: IAtomStore`; `key: Key` | Sync | Filters out every source element whose `keyOf` matches by SameValueZero and returns whether anything was removed. |
| `prune(store)` | `store: IAtomStore` | Sync | **Only clears `splitDef`'s own key → definition token cache**, without releasing nodes already instantiated in the `AtomStore`; release those with `store.release(itemDef)` or `store.dispose()`. Returns the number of keys cleared. |

A duplicate key in the source array (`keyOf` producing the same value twice) throws `Error('[store] splitDef keys must be unique')` when `items` is evaluated.

---

## 5. Low-level optics functions reference

Source: `src/atom/optics-path.ts`. `focusDef`/`splitDef` are built on these pure primitives. The public narrow entry `@migaia/store-keyed/optics` publishes this file directly for callers who write custom optics or split logic beyond the ready-made `opticDef`/`splitDef`; it is not a private implementation detail.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function readOpticPath(value: unknown, path: readonly PropertyKey[], label: string): unknown
function writeOpticPath(
  value: unknown,
  path: readonly PropertyKey[],
  next: unknown,
  label: string
): unknown
```

`readOpticPath` walks `path` with `Reflect.get`; reaching `null` or a non-object value midway throws `TypeError('[store] ${label} cannot read path segment ${key}')`. `writeOpticPath` shallow-copies each level along the path (`[...value]` for arrays, `{...value}` for objects) and writes back without mutating the original; reaching `null` or a non-object midway (with more path left) throws `TypeError('[store] ${label} cannot write path segment ${key}')`; a write path hitting `__proto__` uses `Object.defineProperty` to avoid prototype pollution. `label` only goes into error messages to mark the call site (`focusDef` always passes `'focusDef'`).

```ts doc-test=skip reason="Signature summary, not a runnable module"
function findKeyIndex<T, Key>(
  items: readonly T[],
  keyOf: (item: T, index: number) => Key,
  key: Key
): number
```

Linear search for the first index whose `keyOf(item, index)` matches `key` by SameValueZero (as in Map/Set, `-0` equals `+0` and `NaN` equals itself); returns `-1` when nothing matches and never throws.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function requireKeyIndex<T, Key>(
  items: readonly T[],
  keyOf: (item: T, index: number) => Key,
  key: Key,
  label: string
): number
```

The strict version of `findKeyIndex`: when nothing matches it throws `Error('[store] ${label}')` (the implementation adds the `[store] ` prefix, so `label` must not repeat it). `splitDef(...).of(key)` uses it with `'split def item was removed'` (read) and `'cannot write a removed split def item'` (write).

```ts doc-test=skip reason="Signature summary, not a runnable module"
function shallowArrayEquals<T>(left: readonly T[], right: readonly T[]): boolean
```

True only for the same length and `Object.is` equality item by item; it is the default `equals` of `splitDef(...).items`.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function computeUniqueKeys<T, Key>(
  items: readonly T[],
  keyOf: (item: T, index: number) => Key,
  label: string
): readonly Key[]
```

Computes every item's key and checks uniqueness with a `Set`; a duplicate key throws `Error('[store] ${label} keys must be unique')`. Returns an `Object.freeze`d read-only array.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function spliceInsert<T>(list: readonly T[], item: T, index: number): readonly T[]
```

Immutable insert: copies `list`, clamps `index` to `[0, list.length]`, `splice`s `item` in and returns a new frozen array. `splitDef(...).insert` uses it.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function filterOutKey<T, Key>(
  list: readonly T[],
  keyOf: (item: T, index: number) => Key,
  key: Key
): { readonly removed: boolean; readonly next: readonly T[] }
```

Immutable delete: filters out every element matching `key` by SameValueZero. With `removed: false`, `next` is the original `list` reference (no pointless copy); with `removed: true`, `next` is a new frozen array.

```ts doc-test=skip reason="Signature summary, not a runnable module"
function replaceAtIndex<T>(list: readonly T[], index: number, value: T): readonly T[]
```

Immutable replace by index: copies `list`, replaces `list[index]` with `value` and returns a new frozen array, without bounds checks (the caller must ensure `index` is valid).

```ts doc-test=skip reason="Signature summary, not a runnable module"
class KeyedSplitCache<Key, Item> {
  get(key: Key): Item | undefined
  of(key: Key, create: () => Item): Item
  prune(
    isLive: (key: Key) => boolean,
    shouldEvict?: (item: Item) => boolean, // defaults to () => true
    onEvict?: (item: Item) => void
  ): number
  readonly size: number
  keys(): IterableIterator<Key>
  values(): IterableIterator<Item>
  clear(): void
}
```

The reusable keyed cache `splitDef` uses for `key → item definition` tokens. The constructor takes no parameters (internally an empty `Map`). `of(key, create)`: returns the cached value when it is truthy; when missing or falsy it calls `create()` and stores the result. `prune(isLive, shouldEvict?, onEvict?)`: for each cached `key`, an entry is evicted only when `isLive(key)` is `false` and `shouldEvict(item)` (default always `true`) is `true`, that is `!isLive(key) && shouldEvict(item)`; before eviction it calls `onEvict?.(item)` so the caller can release resources the item holds (for example dispose an instance); it returns the number of entries evicted. `splitDef(...).prune(store)` calls it with `isLive = (key) => activeKeysInSourceArray.has(key)` and no `shouldEvict`/`onEvict` (definition tokens hold nothing to dispose).

---

## 6. Definition family reference

Source: `src/family/definition.ts`. An older "instance-style" family cached instances already bound to a Runtime, so a key was always the same state in every scope. The definition family splits that apart: **a family caches only tokens**, and the `AtomStore` a token lands in decides which scope holds its independent value.

```ts doc-test=skip reason="Signature summary, not a runnable module"
type IFamilyDefOptions = {
  readonly maxSize?: number // default 4096, the strong cache limit
  readonly debugLabel?: string // default 'family' / 'derived-family'
}

type IFamilyDef<K, T, D = IAtomDefinition<T>> = {
  (key: K): D
  readonly size: number
  forget(key: K): boolean
  clear(): void
}

function familyDef<K extends IFamilyKey, T>(
  initial: (key: K) => T,
  options?: IFamilyDefOptions
): IFamilyDef<K, T, IWritableAtomDefinition<T>>

function derivedFamilyDef<K extends IFamilyKey, T>(
  read: (key: K) => (get: IAtomGet) => T,
  options?: IFamilyDefOptions
): IFamilyDef<K, T>
```

`IFamilyKey = string | number | symbol`.

- `familyDef(initial)` produces `atomDefFactory(() => initial(key), ...)` for each key, so a family definition's `kind` is always `'primitive-factory'` with `previewSafe: false`; to read family members in `store.preview()`, use `derivedFamilyDef` or accept that the preview path throws.
- `derivedFamilyDef(read)` produces `derivedDef(read(key), ...)` for each key and is read-only.
- Both return the cached token on each call; `family.size` is the number of strong cache entries; `family.forget(key)` explicitly breaks the canonical identity of that key (instances already created in an `AtomStore` are unaffected, but the next lookup of the same key returns a new token, so callers must stop using the old token, or one logical key splits into two unrelated states); `family.clear()` clears every entry.

Option validation: a non-object (`null` or not an `object`), or a failing read of `maxSize`/`debugLabel`, becomes a `RangeError` with `code: 'INVALID_OPTION'` and the message `[store] family maxSize must be a positive integer`; a non-string `debugLabel` throws `RangeError` with the message `[store] family debugLabel must be a string`; a `maxSize` that is not a positive safe integer also throws `RangeError`.

### 6.1 LRU with a weak-reference fallback

The strong cache is a `Map` reordered by access (`maxSize` entries). Beyond the limit it evicts the least recently accessed entry, but **eviction only removes it from the strong cache** and records it in a `Map<Key, WeakRef<Definition>>` (strong keys, weak values) as the canonical record. As long as the token is still strongly referenced elsewhere (for example instantiated in some `AtomStore`, or kept in a caller's variable), a later lookup of the same key finds the same token through `WeakRef.deref()` and promotes it back into the strong cache; only after the token is really garbage-collected does the same key create a new token. This relies on host support for `WeakRef` and `FinalizationRegistry`; without them, calling `familyDef(...)`/`derivedFamilyDef(...)` throws `Error('[store] family definitions require WeakRef and FinalizationRegistry; enable these capabilities in the host sandbox')` instead of silently degrading to "a new token every time".

`maxSize` must be a positive integer, otherwise `RangeError('[store] family maxSize must be a positive integer')` is thrown.

---

## 7. Error tools reference

Source: `src/errors.ts`, `src/error-code.ts`, `src/error-text.ts`. Errors created by this package carry `source: 'store.keyed'` and a stable `code`; errors from Reactive or other packages that already have a code keep their real owner. Failures of pure optic property access use `OPTIC_ACCESS_FAILED`: extensible native errors receive the code on the original object, keeping type, message and stack; frozen or non-Error primary values stay reachable through the cause of a coded fallback. Brand guards on arbitrary values return false when reading fails. Branch on source/code, not on the message.

### 7.1 Constructors

```ts doc-test=skip reason="Signature summary, not a runnable module"
function createStoreKeyedError(
  code: IStoreKeyedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): Error

function createStoreKeyedRangeError(
  code: IStoreKeyedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): RangeError

function createStoreKeyedTypeError(
  code: IStoreKeyedErrorCode,
  message: string,
  options?: { readonly cause?: unknown }
): TypeError

function createStoreKeyedAggregateError(
  code: IStoreKeyedErrorCode,
  errors: unknown[],
  message: string
): AggregateError
```

The first three differ only in the runtime type they return (`Error`/`RangeError`/`TypeError`) and take the same arguments: `code` (required), `message` (required), `options?.cause` (optional, passed to the native `Error` constructor's `{ cause }`). Each result gets `source: 'store.keyed'` and `code` through `attachErrorIdentity` (from `@migaia/utils/error`), without touching `stack`/`name`. `createStoreKeyedAggregateError` also requires `errors: unknown[]` (which become `AggregateError.errors`) and takes no `cause` option.

```ts doc-test=skip reason="Signature summary, not a runnable module"
const STORE_KEYED_SOURCE = 'store.keyed'
```

A string constant with no parameters, used for the identity of errors created by this package; errors passed through from other packages keep their own source.

### 7.2 `StoreKeyedErrorCode` and when each code is thrown

```ts doc-test=skip reason="Signature summary, not a runnable module"
const StoreKeyedErrorCode = {
  atomStoreDisposed: 'ATOM_STORE_DISPOSED',
  disposalFailed: 'DISPOSAL_FAILED',
  circularPreview: 'CIRCULAR_PREVIEW',
  cyclicOverride: 'CYCLIC_OVERRIDE',
  overrideContract: 'OVERRIDE_CONTRACT',
  previewUnsafe: 'PREVIEW_UNSAFE',
  crossRuntime: 'CROSS_RUNTIME',
  envUnsupported: 'ENV_UNSUPPORTED',
  opticAccessFailed: 'OPTIC_ACCESS_FAILED',
  invalidOption: 'INVALID_OPTION'
} as const
type IStoreKeyedErrorCode = (typeof StoreKeyedErrorCode)[keyof typeof StoreKeyedErrorCode]
```

| Thrown by | Error type | code | message | When |
| --- | --- | --- | --- | --- |
| Every `AtomStore` method entry | `Error` | `ATOM_STORE_DISPOSED` | `cannot use a disposed atom store` | `get`/`peek`/`preview`/`set`/`sub`/`override`/`isObserved`/`release` called after `dispose()`. |
| Every `AtomStore` method entry | `TypeError` | `INVALID_OPTION` | `not an atom definition` | The argument is not a valid definition object produced by `atomDef`/`derivedDef`/... |
| `store.set()` | `TypeError` | `OVERRIDE_CONTRACT` | `atom override resolved to a read-only definition` | The target (possibly after override resolution) is `derived` and has no write semantics. |
| `store.override()` | `TypeError` | `OVERRIDE_CONTRACT` | `atom override must preserve the original write contract` | Breaks one of the three replacement rules in [section 3.4](#34-override). |
| `store.override()` / resolution paths such as `store.get()` | `Error` | `CYCLIC_OVERRIDE` | `cyclic atom override` | The override chain forms a cycle. |
| `store.preview()` | `Error` | `PREVIEW_UNSAFE` | `atom factory is not marked preview-safe` | `preview()` meets a `primitive-factory` with `previewSafe: false`. |
| `store.preview()` | `Error` | `CIRCULAR_PREVIEW` | `circular atom preview detected` | Speculative reads depend on each other in a cycle. |
| `focusDef` (construction) | `Error` | `INVALID_OPTION` | `focusDef requires at least one path segment` | No key given. |
| `focusDef`/`readOpticPath`/`writeOpticPath` (read/write) | `TypeError` | `INVALID_OPTION` | `<label> cannot read path segment <key>` / `<label> cannot write path segment <key>` | `null` or a non-object value midway along the path. |
| `splitDef(...).of(key)` read | `Error` | `INVALID_OPTION` | `split def item was removed` | The key is no longer in the source array when reading. |
| `splitDef(...).of(key)` write | `Error` | `INVALID_OPTION` | `cannot write a removed split def item` | The key is no longer in the source array when writing. |
| `splitDef(...).items` evaluation / `computeUniqueKeys` | `Error` | `INVALID_OPTION` | `splitDef keys must be unique` | `keyOf` produced the same key for different elements. |
| `familyDef` / `derivedFamilyDef` | `RangeError` | `INVALID_OPTION` | `family maxSize must be a positive integer` | `maxSize` is not a positive integer. |
| `familyDef` / `derivedFamilyDef` | `RangeError` | `INVALID_OPTION` | `family debugLabel must be a string` | `debugLabel` is not a string. |
| `familyDef` / `derivedFamilyDef` | `Error` | `ENV_UNSUPPORTED` | `family definitions require WeakRef and FinalizationRegistry; enable these capabilities in the host sandbox` | The host lacks these two globals. |
| `atomDef`/`atomDefFactory`/`assertNotThenable` | `TypeError` | `INVALID_OPTION` | `<context> returned a thenable — async initial values are not supported here; compose with @migaia/resource instead (...)` | The initial value or factory result is a thenable. |
| `atomDef({...})` initial-value clone (host without `structuredClone`) | `Error` | `ENV_UNSUPPORTED` | `primitive initial values require structuredClone support` | The host lacks `structuredClone`. |
| `atomDef({...})` initial-value clone failure (`structuredClone` throws) | `Error` | `INVALID_OPTION` | `primitive initial value cannot be cloned independently` | The value cannot be structured-cloned; the original exception is on `cause`. |
| `atomGetter(runtime)` / `atomSetter(runtime)` | `Error` | `CROSS_RUNTIME` | `cross-runtime atom access is not allowed` | The instance-style atom's `runtime` differs from the runtime the caller is bound to. |
| `AtomStore.dispose()` (several failures) | `AggregateError` | `DISPOSAL_FAILED` | `atom store disposal failed` | More than one instance or entry threw during release; each cause stays in `errors[]`. |
| Internal ownership registration of `AtomStore` (from `@migaia/reactive`) | `Error` | — | `this node is already owned by another Runtime` | The same store object was claimed by two Runtimes; normal use never triggers it, and it means a store was wrongly reused across Runtimes. |

---

<a id="8-subpath-reactiveatom"></a>

## 8. Subpath: reactive/atom

```ts doc-test=check
import type { IReadableAtom, IWritableAtom } from '@migaia/store-keyed/reactive/atom'
import { atomGetter, atomSetter } from '@migaia/store-keyed/reactive/atom'
```

This file defines only the **protocol shape** of "instance-style" atoms and the cross-Runtime checks; this package ships no concrete implementation. It lives here because higher-level packages (async, family, react) only need to know these types, not the instantiation strategy in `atom/store.ts`.

| Export | Notes |
| --- | --- |
| `IReadableAtom<T>` | `IDisposable & { runtime, atomDefinition?, value, observed, read(), peek() }`. `atomDefinition` is an optional bridge field for Provider-level React adapters to find the pure definition behind an instance-style atom. |
| `IWritableAtom<T, Args, Result>` | `IReadableAtom<T> & { write(...args): Result }`. |
| `IAtomGetter` / `IAtomSetter` | `<T>(atom) => T` / `<T, Args, Result>(atom, ...args) => Result`, for instance-style `read`/`write` callbacks. |
| `IAtomRead<T>` / `IAtomWrite<Args, Result>` | `(get: IAtomGetter) => T` / `(get, set, ...args) => Result`, the function types of instance-style read/write callbacks. |
| `IAtomUpdate<T>` | `T \| ((previous: T) => T)`, the common update argument of instance-style `write`. |
| `atomGetter(runtime)` | Returns a getter bound to that runtime; before reading it checks `atom.runtime === runtime` and throws `Error('[store] cross-runtime atom access is not allowed')` otherwise. |
| `atomSetter(runtime)` | Same, with the same cross-Runtime check before writing. |

---

## 9. Lifecycle and release details

### 9.1 Instantiation and initial-value cloning

`AtomStore` keeps instances in an iterable `Map<definition, instance>` rather than a `WeakMap`: releasing has to walk them to cut edges and `dispose()` each underlying node, which a `WeakMap` cannot do. **The smallest lifecycle unit is the whole store, not a single definition**: the store strongly references every instance it created and releases them together on `store.dispose()`; to release one early, use `store.release(definition)`.

When the `init` of `atomDef(init)` is an object or array, the first instantiation in a store runs `cloneInitial` with `structuredClone`. A host without it throws `Error('[store] primitive initial values require structuredClone support')` (`code: 'ENV_UNSUPPORTED'`), and a value that cannot be structured-cloned (for example one containing functions) throws `Error('[store] primitive initial value cannot be cloned independently')` (`code: 'INVALID_OPTION'`, original exception on `cause`). There is deliberately no partial fallback, so prototypes are never silently changed and function fields never aliased. This guarantees the same definition never shares one mutable initial container across stores.

### 9.2 The exact order of dispose()

```ts doc-test=skip reason="Fragment that relies on illustrative outside functions or values"
store.dispose()
```

1. Immediately sets `disposed = true` (from then on every method entry throws `[store] cannot use a disposed atom store`) and clears the override table.
2. Calls every active subscription's unsubscribe (as returned by `sub()`) in turn; one failing unsubscribe does not stop the others, and errors are collected.
3. Releases every instance node through the internal `LifecycleScope` **in reverse creation order** (later derived nodes usually depend on earlier sources, and reverse order avoids a derived node reading released state while it disposes); one failing node is collected without stopping the rest.
4. With 0 collected errors it returns normally; with 1 it rethrows it as is; with several it throws them wrapped in `AggregateError('[store] atom store disposal failed')`.

`dispose()` is idempotent: repeated calls are no-ops and never throw again.

### 9.3 release() vs dispose()

- `store.release(def)`: removes one instance. It first tries the current override target and falls back to the original definition only when that released nothing, so even a definition overridden later can still have its pre-override instance removed correctly.
- `store.dispose()`: removes the whole scope.

Cleaning the family/split key → token caches, such as `splitDef(...).prune(store)` and `familyDef(...).forget/clear`, **never** calls `store.release()`: the token caches and the store's instance table are two separate tables, each responsible for its own lifecycle.

### 9.4 How override and preview interact

`override()` and its undo function both call `previews.clear()`, so `store.preview()` never reads a speculative value matching the old routing at the moment an override switches. `preview()` short-circuits to `peek()` for definitions that already have a real instance; only definitions without one take the speculative path, and the value it produces is reused only within the current version clock value (read with `currentRuntimeVersion(runtime)` from `@migaia/reactive/extension`). After the Runtime's idle cleanup (a microtask by default) it is dropped if it never became a real instance, so a long-mounted Provider never keeps a speculative object forever because of one abandoned speculative render.

---

## 10. Notes in detail

1. **`store.get()` records dependency edges; `peek()`/`preview()` do not.** `get()` records an edge only inside a tracking context (a Computed's `read`, an Effect callback); in plain synchronous code it behaves like `peek()`, but it is easier to misuse as "this will be tracked elsewhere too". Snapshot reads in React adapters (`getSnapshot`, `useSyncExternalStore`) must use `peek`/`preview`; using `get` would accidentally record the read in the dependency set of some other Computed outside the current render, causing hard-to-reproduce cross edges.

2. **`store.set()` accepts only primitive / primitive-factory / writable-derived.** Calling `set()` on a `derivedDef` throws `TypeError`. This is not only a TypeScript constraint: even if an `override()` routes a writable definition to a read-only one indirectly, the runtime throws when the write actually executes, so there is no "passes type checks, then the runtime lets it through" hole.

3. **`override()` must keep the original write contract**, which is the price of a uniform read side: `AtomStore.get()` reads all four `kind`s the same way, but `set()` needs to know which write semantics to apply to its arguments. If a primitive could be overridden by a custom `writable-derived`, the `update` argument passed to `set(def, update)` would mean completely different things under the two semantics (a new value or updater in the first, an arbitrary argument list for a custom `write` in the second), and the runtime could not tell which rules to apply. Read-only definitions have no such concern: they have no public write contract, so they can be routed to any definition of the same value type.

4. **The `create()` of `atomDefFactory` may not run in `store.preview()` by default.** React concurrent rendering may start a speculative render and then discard it entirely; if `create()` has side effects (opening a connection, writing a record into an external registry), a discarded render still makes the side effect happen, irreversibly. Factories that must run on the preview path must be declared with `previewSafeAtomDefFactory`, and are responsible for being pure, idempotent and free of externally observable side effects; this is the caller's promise, and the package does not verify it at run time.

5. **`splitDef(...).prune(store)` only clears splitDef's own key → token cache** and does not release the corresponding nodes already instantiated in the `AtomStore`. This is a deliberate split of responsibilities: `splitDef` knows which keys' definition tokens still matter, not whether an `AtomStore` has instantiated them. Release real instances with `store.release(itemDef)`, or rely on `store.dispose()` for the whole scope. When many keys roll through (for example a chat message list with constant inserts and deletes) and only `prune()` is called, `splitDef`'s internal cache does not leak, but old instances in the `AtomStore` keep accumulating.

6. **The release unit is the whole store, not a single definition.** This corrects an earlier design: an old comment claimed "instances can be reclaimed once a definition is no longer referenced" while an array strongly referenced every instance, so in practice nothing was ever reclaimed. The honest design now is that a store strongly references everything it created, `release(def)` is the only way to release one early, and batch reclamation happens only in `store.dispose()`.

7. **`familyDef`/`derivedFamilyDef` need host support for `WeakRef` and `FinalizationRegistry`.** Without them, calling the constructor throws an explanatory error at once instead of silently degrading to "a new token every time / never reclaim", which would produce a package that quietly slows down or leaks memory and is much harder to diagnose. A few embedded JavaScript engines or trimmed sandboxes may lack these globals; check the target runtime or add an equivalent polyfill.

8. **Low-level optics functions such as `readOpticPath`/`writeOpticPath`/`KeyedSplitCache` are public exports, not private implementation.** They are published through `@migaia/store-keyed/optics`, underpin `focusDef`/`splitDef`, and can be reused directly for custom optics or split logic (see [section 11, complete example](#11-complete-example)). They are pure primitives that do nothing related to `AtomStore` or dependency tracking: `readOpticPath`/`writeOpticPath` only read and write object paths, and `KeyedSplitCache` is only a keyed cache; none of them knows `IAtomDefinition`.

---

## 11. Complete example

A combined example of "one state per session, independently subscribable fields, a list split by key, and test doubles":

```ts doc-test=run
import { createRuntime, type IRuntime } from '@migaia/reactive'
import {
  atomDef,
  derivedDef,
  createAtomStore,
  focusDef,
  splitDef,
  familyDef,
  type IAtomStore
} from '@migaia/store-keyed'

type ITodo = { id: string; text: string; done: boolean }
type ISessionState = { user: { name: string }; todos: readonly ITodo[] }

// —— module level: built once, pure description, holds no state ——
const sessionDef = atomDef<ISessionState>({
  user: { name: 'guest' },
  todos: []
})
const userNameDef = focusDef(sessionDef, 'user', 'name')
const todosDef = focusDef(sessionDef, 'todos')
const todosSplit = splitDef(todosDef, (todo) => todo.id)
const doneCountDef = derivedDef(
  (get) => get(todosDef).filter((todo) => todo.done).length
)

// Each session's runtime state is cached as a token by familyDef per sessionId,
// but it still becomes a value only through some AtomStore
const sessionBySessionId = familyDef((sessionId: string) => ({
  user: { name: 'guest' },
  todos: [] as ITodo[]
}))

function openSession(runtime: IRuntime, sessionId: string): IAtomStore {
  const store = createAtomStore(runtime)
  const state = sessionBySessionId(sessionId)
  store.set(state, (previous) => ({ ...previous, user: { name: 'ada' } }))
  return store
}

// —— usage ——
const runtime = createRuntime()
const store = createAtomStore(runtime)

store.set(userNameDef, 'ada')
todosSplit.insert(store, { id: 't1', text: 'write the docs', done: false })
todosSplit.insert(store, { id: 't2', text: 'ship the release', done: false })

const item = todosSplit.of('t1')
store.set(item, (previous) => ({ ...previous, done: true }))
console.log(store.get(doneCountDef)) // 1

const unsubscribe = store.sub(doneCountDef, () => {
  console.log('doneCount ->', store.peek(doneCountDef))
})

// —— replace one definition's implementation in a test ——
const undo = store.override(
  doneCountDef,
  derivedDef(() => 999) // a read-only definition can be routed to any definition of the same value type
)
console.log(store.get(doneCountDef)) // 999
undo() // state stays as it was after undoing

unsubscribe()
todosSplit.remove(store, 't2')
todosSplit.prune(store) // clears only splitDef's own key cache
store.dispose() // releases every instance this scope created
```

---

## 12. Troubleshooting

**Q: `store.set(def, value)` throws `TypeError: [store] atom override resolved to a read-only definition`.**
`def` (or the target it resolves to after an override) is a `derivedDef`. A read-only derivation has no write semantics; if the route goes through `override()`, check whether a step in the override chain points a writable definition at a read-only one.

**Q: `store.override(a, b)` throws `TypeError: [store] atom override must preserve the original write contract`.**
The write semantics of `a` and `b` do not match: primitive/primitive-factory can only replace each other, and writable-derived can only be replaced by a writable-derived with the same Args/Result. Only read-only definitions are free of this restriction and can be routed to any definition of the same value type; see item 3 of [section 10](#10-notes-in-detail) for why.

**Q: `familyDef(...)` throws `requires WeakRef and FinalizationRegistry` as soon as it is called.**
The target runtime lacks these two ES2021 globals (some trimmed mini-program or embedded JavaScript engines do). Check the host's support or add an equivalent polyfill; the error is never swallowed, because the package deliberately prefers failing loudly over silently degrading into never freeing memory.

**Q: `store.preview(def)` throws `Error: [store] atom factory is not marked preview-safe`.**
`def` was created with `atomDefFactory` (`previewSafe: false`) and read on React's speculative render path (`preview()`). Either confirm the factory is pure and side-effect free and switch to `previewSafeAtomDefFactory`, or avoid reading it on the preview path.

**Q: `splitDef(...).of(key)` throws `split def item was removed` / `cannot write a removed split def item`.**
The key is no longer in the source array (it may have been `remove()`d elsewhere, or the source array was replaced with `store.set()` without that item). Check with `todosSplit.items` or `store.get(todosSplit.source)` whether the key still exists before reading or writing; the token from `of(key)` is still the same object after the key disappears, but reads and writes keep failing until the key reappears in the source array.

**Q: Why does `store.get(def)` after `store.dispose()` throw instead of returning the last value?**
A disposed store is in its end state, and every read or write entry first throws `[store] cannot use a disposed atom store`. This is intentional: a released scope must not keep being used silently, which would hide a caller bug of "forgot to open a new store". For new state, create a new one with `createAtomStore(runtime)`.

**Q: After `familyDef(...).forget(key)`, can the old token still be used?**
Yes: the old token is still a valid definition, and `AtomStore` state already instantiated with it is unaffected. But after `forget`, looking up the same key creates a **new** token, and the old and new tokens are unrelated; if some code still holds the old token and keeps reading and writing with it, the logical key splits permanently into two states. After `forget`, make sure every caller switches to the new lookup result instead of mixing them.

**Q: How do I create state grouped by key?**
Combine the public `familyDef`/`derivedFamilyDef` with `createAtomStore`. The unpublished instance-style family source and its tests have been deleted, and the `FAMILY_DISPOSED`/`EVICTION_FAILED` error codes that belonged only to that implementation were removed.

---

## 13. Build gates

From the repository root:

```bash
pnpm --filter @migaia/store-keyed fmt
pnpm --filter @migaia/store-keyed lint
pnpm --filter @migaia/store-keyed typecheck
pnpm --filter @migaia/store-keyed typecheck:test
pnpm --filter @migaia/store-keyed test
pnpm --filter @migaia/store-keyed build
```

The browser integration path also runs:

```bash
pnpm --filter @migaia/store-keyed typecheck:e2e
pnpm --filter @migaia/store-keyed test:e2e
```

Cleanup of speculative values goes through the owning Runtime's idle channel (`scheduleIdle`, microtasks by default); no adapter-owned microtask queue is created.

Every split key lookup, uniqueness check, cache and deletion uses SameValueZero, as Map/Set do, so `-0` and `+0` are the same key and `NaN` equals itself. `shallowArrayEquals` still compares ordinary values item by item with `Object.is`. Store disposal clears the uncommitted preview cache, so even when a caller keeps a disposed store, that cache no longer holds speculative values. The family's canonical Map uses strong keys and weak values and is not a WeakMap; `forget` does not release existing store instances.

Breaking migration: the ten advanced optics imports move from the root to `/optics`, and the `assertNotThenable` import moves from the root to `/atom/definition`. `IAtomUpdate` is declared once in definition and re-exported as a type by reactive/atom; both supported type import paths remain, as do the two distinct reader contracts. External usage is unknown; the root entry keeps no compatibility alias.
