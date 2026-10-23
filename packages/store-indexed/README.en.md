# `@migaia/store-indexed`

Observe object fields, array positions, and Map/Set members through explicit methods, so each observer follows the reads it needs.

## You may have run into this

- Editing age reruns the name view because the entire object shares one subscription.
- Editing one row also refreshes the row count because value and list structure are observed together.
- A replacement source fails halfway and the old list disappears because it was cleared before the new input was fully read.
- Navigation keeps an old order because replacement checks membership but ignores insertion order.
- Closing one selection collection breaks other state because its lifetime was coupled to a borrowed Runtime.

## Why choose it

- **Track the field you need and mark incidental reads explicitly.** get subscribes to the selected key while peek adds no dependency as shown in [Observe one field and read another without subscribing](./USEGUIDE.en.md#observe-one-field-and-read-another-without-subscribing).
- **Update a row separately from the list length.** at tracks a position while length tracks structure as shown in [Separate one row index from the list length](./USEGUIDE.en.md#separate-one-row-index-from-the-list-length).
- **Keep the complete old collection when replacement input fails.** replace materializes the full input before committing and preserves the iterator error on cause as shown in [Preserve the old array when replacement input fails](./USEGUIDE.en.md#preserve-the-old-array-when-replacement-input-fails).
- **Distinguish value edits from insertion-order changes.** Map separates key structure from value iteration and compares replacement order as shown in [Observe key order separately from changing values](./USEGUIDE.en.md#observe-key-order-separately-from-changing-values).
- **Observe one member and end its collection independently.** Set.has tracks membership per value and collection disposal releases its own signals without destroying the borrowed Runtime as shown in [Watch one selected member and release the collection independently](./USEGUIDE.en.md#watch-one-selected-member-and-release-the-collection-independently).

## Start here

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { ObservableObject } from '@migaia/store-indexed'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const user = new ObservableObject({ name: 'Ada', age: 30 }, runtime)
const seen: string[] = []
const watch = runtime.effect(() => {
  seen.push(user.get('name'))
  user.peek('age')
})
user.set('age', 31)
user.set('name', 'Grace')
console.log(JSON.stringify(seen))
watch.dispose()
user.dispose()
```

Output:

```text
["Ada","Grace"]
```

Next: see [index observation](./USEGUIDE.en.md#separate-one-row-index-from-the-list-length) to separate rows from length, or [failed replacement](./USEGUIDE.en.md#preserve-the-old-array-when-replacement-input-fails) before swapping a whole dataset.

## Pitfalls when writing it yourself

This native object and shared callback set illustrate the same task. The example is for display only; the comments identify broad notification and missing cleanup.

```ts doc-test=check
const user = { name: 'Ada', age: 30 }
const subscribers = new Set<() => void>()
function observe(callback: () => void) {
  subscribers.add(callback) // Pitfall: no disposer removes the observer from this set.
  callback()
}
function set<K extends keyof typeof user>(key: K, value: (typeof user)[K]) {
  user[key] = value
  for (const run of subscribers) run() // Pitfall: every field write notifies the name observer.
}
observe(() => console.log(user.name))
set('age', 31)
```

## A three-minute mental model

Choose the data shape, create its collection and observers in one Runtime, use get/at/has for dependencies and peek for incidental reads, then dispose observers and collection.

| Task / term                               | Tool                                       | Meaning                                                   |
| ----------------------------------------- | ------------------------------------------ | --------------------------------------------------------- |
| Observe one value / cell                  | Object.get, Array.at, Map.get/has, Set.has | One reactive value for a key, position, or member         |
| Observe count or order / structure        | length, size, keys                         | Which positions, keys, or members exist and in what order |
| Observe all content / revision, iteration | snapshot, valuesArray, entries             | Rebuild a whole view after its content changes            |
| Read without subscribing / peek           | Object.peek, Array.peek, Map.peek          | This read adds no observer dependency                     |
| Commit together / batch                   | runtime.batch within collection writes     | Observers do not see an intermediate state of one write   |
| End use / dispose                         | observer.dispose, then collection.dispose  | Disconnect observers and release internal signals         |

## Typical scenarios

| Scenario                                                           | How to combine                                        | Details                                                                                                 |
| ------------------------------------------------------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Observe one field and read another without subscribing             | `ObservableObject → get / peek → set`                 | [Complete example](./USEGUIDE.en.md#observe-one-field-and-read-another-without-subscribing)             |
| Keep a previous top-level snapshot without assuming a deep copy    | `snapshot → set → snapshot`                           | [Complete example](./USEGUIDE.en.md#keep-a-previous-top-level-snapshot-without-assuming-a-deep-copy)    |
| Separate one row index from the list length                        | `ObservableArray → at / length → set / push / splice` | [Complete example](./USEGUIDE.en.md#separate-one-row-index-from-the-list-length)                        |
| Preserve the old array when replacement input fails                | `replace(iterable) → catch → replace(array)`          | [Complete example](./USEGUIDE.en.md#preserve-the-old-array-when-replacement-input-fails)                |
| Observe key order separately from changing values                  | `ObservableMap → keys / valuesArray → replace`        | [Complete example](./USEGUIDE.en.md#observe-key-order-separately-from-changing-values)                  |
| Watch one selected member and release the collection independently | `ObservableSet → has → dispose`                       | [Complete example](./USEGUIDE.en.md#watch-one-selected-member-and-release-the-collection-independently) |

## Installation

```bash
pnpm add @migaia/store-indexed @migaia/reactive
```

The examples import reactive directly to create a Runtime, so install it explicitly. Omitting the collection's runtime uses defaultRuntime.

## Essential APIs

| API                                               | Purpose                                                    |
| ------------------------------------------------- | ---------------------------------------------------------- |
| `new ObservableObject(initial,runtime?,options?)` | Read and write string fields                               |
| `new ObservableArray(initial?,runtime?,options?)` | Observe positions in a list                                |
| `new ObservableMap(initial?,runtime?,options?)`   | Observe keyed values and iteration                         |
| `new ObservableSet(initial?,runtime?,options?)`   | Observe individual selected members                        |
| `get / at / has / peek / snapshot`                | Choose tracking and copying boundaries                     |
| `dispose()`                                       | End the collection without destroying its borrowed Runtime |

## Contract details

### Ownership, entry point, and intended use

The package has one root entry: four collection classes, `IObservableCollectionOptions`, `IndexedOperation`/`IIndexedOperation`, and the error codes and error factories. Internal cell pools and registries are not import paths. Ordinary dependencies are `@migaia/reactive`, `@migaia/utils`, and `@migaia/store-light`; collection code uses the last package only for the `IMutationGuard` type. There are no peerDependencies. These examples import reactive directly, so install it explicitly too.

Use these collections for tables or message lists where observers read only some positions. A single `runtime.signal(value)` is simpler when the whole value is the unit of observation. Named methods establish dependencies; the classes do not intercept property access on user objects. Mutating a nested object in place does not become a collection write. Arrays identify positions: splice/pop/replace can make one index refer to a different record. Choose a keyed collection when record identity must remain stable.

### Construction, options, and input admission

Class constructors are the only creation entry points, with `(initial, runtime?, options?)`. The former thin factories were removed. Migrate old `(initial, options, runtime)` calls by swapping the last two arguments; no factory aliases or compatibility wrappers remain.

| Class and type parameters                             | initial                                                 | Defaults and boundaries                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `ObservableObject<T extends Record<string, unknown>>` | Required T                                              | Reads own enumerable string keys and values; keys are typed as `keyof T & string`; symbol keys are excluded |
| `ObservableArray<T>`                                  | Optional `Iterable<T>`                                  | Defaults to `[]`; strings are materialized as characters                                                    |
| `ObservableMap<K,V>`                                  | Optional `ReadonlyMap<K,V> or Iterable<readonly [K,V]>` | Defaults to `[]`; native Map entry rules apply; a string is rejected as the outer input                     |
| `ObservableSet<T>`                                    | Optional `Iterable<T>`                                  | Defaults to `[]`; strings are accepted; native Set membership rules apply                                   |

Every `runtime` defaults to `defaultRuntime` and remains the collection's owner. The public `runtime` and `disposed:boolean` properties are readonly. The default `options={}` contains:

| Field                            | Default                                     | Effect                                                                    |
| -------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| `mutationGuard?: IMutationGuard` | `undefined`, no guard                       | Calls `assertMutationAllowed(operation)` at each write entry              |
| `debugName?: string`             | The class name, such as `'ObservableArray'` | Prefixes Signal debug names, disposal messages, and guard operation names |

Null/nonobject options, a defined nonstring debugName, or failed option reads produce a TypeError with `INVALID_OPTION`; failed reads retain the original cause. Constructors finish reading initial data before acquiring collection ownership in the Runtime. Object getter failures, iterable `Symbol.iterator` getter/call/next failures, and malformed Map entries also become `INVALID_OPTION` with the original cause. The iterator getter and captured function are each used once, invoking the function with the original iterable as receiver. Replacement also materializes the complete input first, so an input failure does not commit a partial replacement.

### Tracking and notification

A cell is one reactive value for a key, index, or member. Object.get, Array.at, Map.get/has, and Set.has materialize that cell only while their Runtime is tracking. Ordinary synchronous reads access backing data without creating cells. peek explicitly avoids tracking even inside an effect/computed; Set has no peek.

| Read                                       | Dependency                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Object.get(key)                            | That key's value cell                                                                             |
| Object.has(key), Object.keys()             | The full key structure; adding or removing another key also reruns has observers                  |
| Object.snapshot()                          | Revision, covering actual value or key changes                                                    |
| Array.at(index)                            | The valid position's value cell; negative and out-of-bounds reads also depend on length structure |
| Array.length / snapshot()                  | Length structure / whole-array revision                                                           |
| Map.get(key), Map.has(key)                 | The same value cell; changing the existing value also reruns has observers                        |
| Map.size / keys()                          | Key membership and insertion-order structure                                                      |
| Map.valuesArray() / entries() / snapshot() | Value and iteration-order changes                                                                 |
| Set.has(value)                             | That member's boolean cell                                                                        |
| Set.size / valuesArray() / snapshot()      | Membership and order structure                                                                    |

A tracked read cannot connect another Runtime's dependency graph. Cross-graph reads detected here carry `CROSS_RUNTIME`; failures detected by reactive retain that package's actual identity. Ordinary untracked reads and peek can read across Runtimes. For request or application isolation, construct a Runtime explicitly and create the observers in that same Runtime.

keys() still allocates an array and tracks structure; it is not a free traversal. peek avoids cells, but Array.peek() copies the whole array. Replacement individually notifies only materialized cells; equal-length arrays can still compare every value, and Map/Set still compare content and order. No constant-time or speed claim follows from this mechanism.

### ObservableObject methods

| Method                                                                | Result and behavior                                                                                                     |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `get<K extends keyof T & string>(key:K):T[K]` / `peek<K>(key:K):T[K]` | Tracked / untracked lookup; a deleted key can return undefined at runtime even when T[K] does not include it            |
| `has(key:keyof T & string):boolean`                                   | Tests existence and tracks the full key structure                                                                       |
| `set<K>(key:K,value:T[K]):void`                                       | Updates in a batch; new keys advance structure, and new keys or Object.is-unequal values advance revision               |
| `update<K>(key:K,updater:(value:T[K])=>T[K]):void`                    | Runs the guard before validating/invoking the updater, then commits; a nonfunction updater is INVALID_OPTION            |
| `delete(key):boolean`                                                 | Reports whether the key existed; missing keys do not notify; deletion publishes absence and advances structure/revision |
| `keys():readonly (keyof T & string)[]`                                | Returns the current keys                                                                                                |
| `snapshot():Readonly<T>`                                              | A revision-cached, shallow-frozen, null-prototype object                                                                |
| `replace(next:T):void`                                                | Reads all properties first, then deletes absent keys and sets new values in one batch; invokes the guard once           |
| `prune():number`                                                      | Reclaims deleted cells without observers and returns the count                                                          |
| `dispose():void`                                                      | Closes idempotently                                                                                                     |

Object keys must be strings, otherwise INVALID_OPTION. With a finite literal T, set cannot add an undeclared key through its type signature; use an explicit `Record<string,V>` for an open key domain. The null-prototype snapshot treats `__proto__` as a data key. Freezing covers only the outer object; nested values retain their original references.

### ObservableArray methods

| Method                                                                        | Result and behavior                                                                                                |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `length:number`                                                               | Tracks length                                                                                                      |
| `at(index:number):T or undefined`                                             | Requires an integer; negative indices count from the end; out-of-bounds reads return undefined and track structure |
| `snapshot():readonly T[]`                                                     | A revision-cached, shallow-frozen array                                                                            |
| `peek():readonly T[]`                                                         | A fresh shallow-frozen copy with no tracking                                                                       |
| `set(index:number,value:T):void`                                              | Requires [0,length); negative indices are not accepted; Object.is-equal values do not notify                       |
| `push(...values:readonly T[]):number`                                         | Returns the new length; no arguments do not notify                                                                 |
| `pop():T or undefined`                                                        | Removes the last item; an empty array does not notify                                                              |
| `splice(start:number,deleteCount?:number,...items:readonly T[]):readonly T[]` | Uses native splice position conversion and returns a shallow-frozen removed-items array                            |
| `replace(values:Iterable<T>):void` / `clear():void`                           | Materialize then replace / replace([])                                                                             |
| `dispose():void`                                                              | Closes idempotently; there is no manual prune                                                                      |

Noninteger at/set indices produce TypeError `INVALID_INDEX`; out-of-range set produces RangeError `INDEX_OUT_OF_RANGE`. Omitting deleteCount removes through the end; explicitly passing undefined means zero. A JavaScript call with no splice arguments is a no-op, as is an explicit zero deletion without insertions. splice/replace/clear update materialized cells in one batch. Only length changes notify structure; length or per-item Object.is changes advance revision. set also publishes its cell and revision in one batch, so a synchronous observer does not see a new item with an old snapshot.

### ObservableMap methods

| Method                                                            | Result and behavior                                                                                                      |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `size:number`                                                     | Current size, tracking structure                                                                                         |
| `get(key:K):V or undefined` / `peek(key:K):V or undefined`        | Tracked / untracked keyed lookup                                                                                         |
| `has(key:K):boolean`                                              | Tracks that key's value cell, so notification is not limited to presence changes                                         |
| `set(key:K,value:V):this`                                         | Existing Object.is-equal values do not notify; otherwise updates the cell and iteration, plus structure for a new key    |
| `delete(key:K):boolean`                                           | False when absent; otherwise publishes absence and advances structure/iteration                                          |
| `clear():void`                                                    | Empty maps do not notify; one batch clears data and materialized cells and advances structure/iteration once each        |
| `replace(next:ReadonlyMap<K,V> or Iterable<readonly [K,V]>):void` | Atomic replacement after full materialization; notification is skipped only when keys, values, and insertion order match |
| `keys():readonly K[]`                                             | Current keys, tracking structure                                                                                         |
| `valuesArray():readonly V[]`                                      | Shallow-frozen values, tracking iteration                                                                                |
| `entries():readonly (readonly [K,V])[]`                           | The outer array and every pair are frozen; keys/values are not deep-cloned                                               |
| `snapshot():ReadonlyMap<K,V>`                                     | A fresh ordinary Map, not frozen; keys/values retain their references                                                    |
| `prune():number` / `dispose():void`                               | Reclaim deleted dormant cells / close idempotently                                                                       |

Native Map key identity rules still apply. Reordering unchanged keys and values through replace invalidates keys/iteration/snapshot observers; it does not turn keyed readers into whole-collection subscriptions. clear/replace do not invoke public writes once per key, and the guard runs only at the entry.

### ObservableSet methods

| Method                              | Result and behavior                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| `size:number`                       | Tracks structure                                                                  |
| `has(value:T):boolean`              | Tracks that member's boolean cell                                                 |
| `add(value:T):this`                 | Existing members do not notify; otherwise publishes true and advances structure   |
| `delete(value:T):boolean`           | False when absent; otherwise publishes false and advances structure               |
| `clear():void`                      | Empty sets do not notify; one batch clears members and updates materialized cells |
| `replace(next:Iterable<T>):void`    | Materializes before replacing; matching members and insertion order do not notify |
| `valuesArray():readonly T[]`        | A shallow-frozen current-members array                                            |
| `snapshot():ReadonlySet<T>`         | A fresh ordinary Set, not frozen; members are not deep-cloned                     |
| `prune():number` / `dispose():void` | Reclaim deleted dormant cells / close idempotently                                |

Native Set membership rules apply. Values are the members, so there is no separate revision/iteration signal, get, or peek. Reordering is observable. clear/replace invoke the guard once and advance structure at most once.

### Cell lifetime, disposal, and mutation guards

A new cell attempts reclamation when its last subscriber leaves. A speculative cell that never gained an observer is cleaned through its Runtime's idle channel, using microtasks by default. Deleting a still-observed member retains its cell and publishes absence until observers leave. Object/Map/Set prune only deleted, unobserved keys/members; it cannot release live observers. Arrays use automatic reclamation only.

Collections do not detect component unmount or request completion; the application must dispose them. The collection owner releases its remaining Signals and pool references together. Repeated disposal is a no-op. Later data reads/writes and prune reject, while runtime/disposed remain readable. The borrowed Runtime is not destroyed. Disposal does not promise to clear backing data, erase existing snapshots, or destroy application objects.

A guard is a synchronous permission check with `assertMutationAllowed(operation?:string):void`. Each public write entry invokes it once, including writes that eventually make no change; reads do not. Operation names such as `users.set(u1)` combine debugName and the concrete method, rather than using IndexedOperation values. Object.update invokes the guard before its updater; rejection prevents the updater from running. MutationPolicy/runInAction from store-middleware can supply an action policy, whose action scope belongs to that package; install it separately if used. Only the outer collection commit is prevented: callback-owned external effects are not rolled back.

### Operation vocabulary and errors

`IndexedOperation` gives diagnostic/logging consumers `read:'read'`, `write:'write'`, and `delete:'delete'`. `IIndexedOperation` is the union of those values. Collection methods do not use the vocabulary directly.

| StoreIndexedErrorCode property | code                | Trigger                                                                              |
| ------------------------------ | ------------------- | ------------------------------------------------------------------------------------ |
| invalidOption                  | INVALID_OPTION      | Invalid options, input, iterator, Map entry, debugName, Object key, or updater shape |
| collectionDisposed             | COLLECTION_DISPOSED | Data access or mutation after closing                                                |
| callbackFailed                 | CALLBACK_FAILED     | A guard/updater fails without an existing package identity                           |
| indexOutOfRange                | INDEX_OUT_OF_RANGE  | Out-of-range Array.set                                                               |
| invalidIndex                   | INVALID_INDEX       | Noninteger Array.at/set                                                              |
| crossRuntime                   | CROSS_RUNTIME       | A cross-Runtime tracked read detected here                                           |

Errors owned here use `STORE_INDEXED_SOURCE='store.indexed'`. Existing foreign source/code pairs retain their actual owner. An uncoded guard/updater native error keeps its object, type, message, and stack when identity can be attached; otherwise cause/errors retain the original value. Branch on code rather than message. Stable diagnostics remain available for locating a failure:

| message                                                                                       | Situation                                                     |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `[store] observable collection options must be an object`                                     | Invalid options or failed option reads                        |
| `[store] observable collection debugName must be a string`                                    | Invalid debugName type                                        |
| `[store] observable collection input must be a non-null object or iterable`                   | Invalid initial/replacement input, iterator, or updater shape |
| `[store] ObservableObject key must be a string`                                               | A nonstring Object key                                        |
| `[store] cross-runtime dependency is not allowed: collection read belongs to another Runtime` | A cross-Runtime tracked read detected here                    |
| `[store] {debugName} is disposed`                                                             | Use after disposal                                            |
| `[store] ObservableArray index out of range`                                                  | Out-of-range set                                              |
| `[store] ObservableArray index must be an integer`                                            | Noninteger at/set                                             |
| `[store] collection callback failed`                                                          | Callback wrapper when identity cannot be attached directly    |

All three public error factories require `code:IStoreIndexedErrorCode` and `message:string`. `createStoreIndexedError(code,message,options?)` returns a native Error; `createStoreIndexedTypeError(...)` returns TypeError. options defaults to undefined and contains only optional cause. The Error factory forwards an own cause property, while the TypeError factory forwards cause when it is not undefined. `createStoreIndexedRangeError(code,message)` returns RangeError and has no third argument. All attach nonwritable source/code and leave stack intact; a cause's message is not guaranteed to appear in the top-level stack text.

### Troubleshooting and development commands

If an observer does not rerun, check that the read happens inside effect/computed, that it did not use peek, and that the new value is not Object.is-equal. A deleted cell can remain while observers are active; prune cannot force their release. Align Runtimes after a cross-graph error. Create a new collection after disposal.

```bash
pnpm run fmt && pnpm run lint && pnpm run typecheck && pnpm run typecheck:test && pnpm run test && pnpm run build
```

Browser integration also has `pnpm run typecheck:e2e` and `pnpm run test:e2e`; listing these commands does not claim they were run for this change.
