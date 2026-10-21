# @migaia/store-keyed

[中文](./README.md)

Every server request, every test and every chat window needs its own copy of the same state, yet state kept in a module variable is shared by everyone. `@migaia/store-keyed` separates what the state is (the definition) from where its value lives (the store): definitions sit at module level and hold no value, and each `createAtomStore` keeps its own value for them. It can also split a large object down to fields and a list down to items for separate subscriptions, and produce definitions by id. It is built on `@migaia/reactive` and depends on neither React nor the DOM.

## You may have run into

- **State leaks between requests or tests**: one server request's cart shows up in another, and data left by one test breaks the next. The cause is state in a module-level variable, shared by everything that imports it.
- **Changing one field re-renders every reader of the object**: the online flag in a profile changes, and a component that only shows the name re-renders. The cause is that subscriptions cover the whole object.
- **Changing one row re-renders the whole list**: ticking one todo re-renders every row. The cause is that every row reads the same array, and the array is replaced on every change.
- **State kept by id keeps growing**: a hand-written `Map<chatId, state>` only grows, and the same id can create two different states. The cause is that a cache by key must guarantee identity, a size limit and cleanup, which hand-written code rarely covers.
- **Replacing a dependency in a test means changing the code under test**: a price depends on the current hour, and testing the night discount means waiting until night or adding an injected parameter. The cause is that the code under test references a concrete implementation directly.

## Why choose it

- **Definitions are separate from values.** The usual approach wraps state in a factory and passes the instance everywhere; here definitions stay at module level, each store keeps its own value for them, and object or array initial values are copied per store. [Example](./USEGUIDE.en.md#one-definition-a-separate-value-per-request-or-test)
- **Field-level subscriptions.** `focusDef` notifies readers only when its field changes, and writing it produces a new object with that field replaced, with no hand-written immutable update. [Example](./USEGUIDE.en.md#subscribe-to-one-field-of-a-large-object)
- **Item-level subscriptions.** `splitDef` splits a list into per-key definitions, so changing one item notifies only that item; reading or writing a removed key throws instead of returning stale data. [Example](./USEGUIDE.en.md#update-one-row-without-re-rendering-the-whole-list)
- **Definitions by id are stable and bounded.** `familyDef` always returns the same definition for the same key, the cache has a `maxSize`, and `forget` drops a key explicitly. [Example](./USEGUIDE.en.md#one-state-per-chat-id-without-a-hand-written-map)
- **Test doubles without touching the code under test.** `store.override()` replaces one definition inside one store, undoing it leaves the state as it was, and it checks that the write contract is unchanged. [Example](./USEGUIDE.en.md#swap-one-dependency-in-a-test-without-touching-the-code-under-test)

## Start here

The example below plays a server: two requests use the same cart definition and each creates its own store. Run it directly with Node 24.

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

Both requests use the same definitions, but each store keeps its own values, and mutating the initial object in one store does not touch the other.

Next: more uses are listed in [Find by scenario in the USEGUIDE](./USEGUIDE.en.md#find-by-scenario); for long lists where only the changed row should update, see [Update one row without re-rendering the whole list](./USEGUIDE.en.md#update-one-row-without-re-rendering-the-whole-list).

## The traps of hand-written code

Below is common hand-written shared state. It runs, but it has three traps (for illustration only; no need to run it):

```ts doc-test=check
type ITodo = { id: string; done: boolean }

// Trap 1: module-level state is shared by every request and test; data written by one request is visible to another
let todos: ITodo[] = []
const listeners = new Set<() => void>()

function toggle(id: string) {
  todos = todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo))
  // Trap 2: changing one item notifies every listener, so every row re-renders
  listeners.forEach((listener) => listener())
}

// Trap 3: the Map of state by chat id only grows; nobody remembers to delete entries
const drafts = new Map<string, string>()
drafts.set('product', 'ship tomorrow')
toggle('t1')
```

With store-keyed, definitions hold no value and every request or test uses its own store; `splitDef` lets each row subscribe only to its own item; `familyDef` produces definitions by key with a size limit and explicit removal.

## A three-minute mental model

Think of a definition as a variable declaration and a store as a block of memory: the same declaration has its own value in every block.

| Concept | In one sentence |
| --- | --- |
| Definition (`atomDef` / `derivedDef` / `writableDef`) | A frozen description of the initial value or the computation; holds no value and can stay at module level |
| Store (`createAtomStore`) | The scope that keeps values for definitions; it creates a reactive node for a definition the first time it is read |
| Reading | `get` records a dependency, `peek` does not, `preview` serves speculative reads during React concurrent rendering |
| Optics (`focusDef` / `splitDef` / `selectDef` / `opticDef`) | New definitions derived from one definition, pointing at a field, a list item or a projection |
| Family (`familyDef` / `derivedFamilyDef`) | Produces definitions by key; the same key gives the same definition |
| `override` | Inside one store, routes reads of one definition to another |

A few terms:

- **The unit of release is the whole store.** A store holds every node it created and releases all of them in reverse order on `dispose()`; to release one early, use `release(definition)`.
- **Definitions are shared across stores, nodes are not.** The same definition is two independent nodes in two stores.
- **Synchronous initial values.** Initial values and factories cannot return Promises; hand async data to `@migaia/resource`.

## Typical scenarios

| Scenario | How to combine | Details |
| --- | --- | --- |
| Server rendering, test isolation | Module-level definitions + one `createAtomStore` per request or test | [USEGUIDE](./USEGUIDE.en.md#one-definition-a-separate-value-per-request-or-test) |
| Field-level subscriptions on a large object | `focusDef`, or `selectDef` for read-only projections | [USEGUIDE](./USEGUIDE.en.md#subscribe-to-one-field-of-a-large-object) |
| Update only the changed row of a long list | `splitDef` + `of(key)` | [USEGUIDE](./USEGUIDE.en.md#update-one-row-without-re-rendering-the-whole-list) |
| One state per chat or channel | `familyDef` / `derivedFamilyDef` | [USEGUIDE](./USEGUIDE.en.md#one-state-per-chat-id-without-a-hand-written-map) |
| Replace a dependency in tests | `store.override()` | [USEGUIDE](./USEGUIDE.en.md#swap-one-dependency-in-a-test-without-touching-the-code-under-test) |

## Installation

```bash
pnpm add @migaia/store-keyed @migaia/reactive
```

| Entry | Contents |
| --- | --- |
| `@migaia/store-keyed` | Definition constructors, `createAtomStore` / `defaultAtomStore`, `selectDef` / `opticDef` / `focusDef` / `splitDef`, families, error tools |
| `@migaia/store-keyed/atom/store` | Narrow store entry, identical to the corresponding root exports |
| `@migaia/store-keyed/atom/definition` | Narrow definition entry, which also exports `assertNotThenable` |
| `@migaia/store-keyed/optics` | Pure functions for hand-written optics: path reads and writes, lookup by key, immutable insert and delete, `KeyedSplitCache` |
| `@migaia/store-keyed/reactive/atom` | Protocol types for instance-style atoms and cross-Runtime checks (`atomGetter` / `atomSetter`) |

## Common APIs

| API | What it does |
| --- | --- |
| `atomDef(init)` / `derivedDef(read)` / `writableDef(read, write)` | Define source state, read-only derived values and writable derived values |
| `createAtomStore(runtime)` | Creates a store that keeps its own values |
| `store.get` / `store.set` / `store.sub` | Read (recording a dependency), write, subscribe |
| `store.setMany(entries)` | Writes several source definitions in one batch; nothing is written unless every entry succeeds, and subscribers are notified once |
| `focusDef(def, ...path)` / `splitDef(def, keyOf)` | A field-level definition / a list split by key |
| `familyDef(initial, options?)` | Produces definitions by key |
| `store.override(def, replacement)` / `store.dispose()` | Replace a definition / release the whole store |

## Contract details

Every signature, boundary behaviour and error code is in [USEGUIDE.en.md](./USEGUIDE.en.md). These are the constraints that matter most in use.

1. **`get` records a dependency; `peek` / `preview` do not.** Snapshot reads in React adapters must use `peek` or `preview`.
2. **`set` accepts only writable definitions** (`atomDef`, `atomDefFactory`, `writableDef` and their optics). Writing a read-only derived definition throws `TypeError`, also when an `override` routes to one indirectly. `set` runs in one batch and is never recorded as a dependency by an outer tracking context.
3. **An `override` must keep the write contract.** A read-only definition can be replaced by any definition of the same value type; a source definition only by a source definition; a writable derived definition only by one with the same arguments and result. A cycle in the override chain throws `CYCLIC_OVERRIDE`.
4. **Object initial values are copied per store.** Copying uses `structuredClone`; a value that cannot be cloned (for example one containing functions) throws `INVALID_OPTION`, and a host without `structuredClone` throws `ENV_UNSUPPORTED`.
5. **`preview` never runs factories not declared safe.** An `atomDefFactory` factory throws `PREVIEW_UNSAFE` inside `preview`; use `previewSafeAtomDefFactory` once you have made sure the factory is pure and side-effect free. Speculative values are dropped after the Runtime's idle cleanup (a microtask by default) if they never became real nodes.
6. **The order of `dispose()`.** It marks the store disposed, cancels every subscription, then releases nodes in reverse creation order; one failure never stops the remaining steps, and several failures are combined into an `AggregateError` (`DISPOSAL_FAILED`). Any access after disposal throws `ATOM_STORE_DISPOSED`.
7. **Clearing caches is not releasing nodes.** `splitDef(...).prune(store)` and `familyDef(...).forget()` / `clear()` only clear definition caches and leave nodes already created in a store alone; release those with `store.release()` or `store.dispose()`. After `forget`, the same key gives a new definition whose state is unrelated to the old one.
8. **Families need `WeakRef` and `FinalizationRegistry`.** Without them, calling `familyDef` / `derivedFamilyDef` throws `ENV_UNSUPPORTED` instead of degrading silently.
9. **Keys are compared with SameValueZero**, as in `Map` / `Set`: `-0` and `+0` are the same key, and `NaN` equals itself.
10. **Error identity.** Errors produced by this package carry `source === STORE_KEYED_SOURCE` (`@migaia/store-keyed`) and a `code` from `StoreKeyedErrorCode`; errors from other packages that already have an identity keep it. Branch on `source` / `code`, never on the message.

**Breaking migration**: the ten advanced optics primitives are exported only from `@migaia/store-keyed/optics`, and `assertNotThenable` only from `@migaia/store-keyed/atom/definition`; the root entry keeps no compatibility alias.

**When not to use it**: when the whole application has one global state and never needs several scopes, `runtime.signal()` / `runtime.computed()` are simpler; for Providers and Hooks, use `@migaia/store-react`.
