# `@migaia/store-indexed` usage guide

Choose a task first, then use the complete method, tracking, and disposal contracts below. Each example runs independently; observer counts include the initial run.

## Find a scenario

| Scenario                                                           | API                | Details                                                                                 |
| ------------------------------------------------------------------ | ------------------ | --------------------------------------------------------------------------------------- |
| Observe one field and read another without subscribing             | `ObservableObject` | [Complete example](#observe-one-field-and-read-another-without-subscribing)             |
| Keep a previous top-level snapshot without assuming a deep copy    | `ObservableObject` | [Complete example](#keep-a-previous-top-level-snapshot-without-assuming-a-deep-copy)    |
| Separate one row index from the list length                        | `ObservableArray`  | [Complete example](#separate-one-row-index-from-the-list-length)                        |
| Preserve the old array when replacement input fails                | `ObservableArray`  | [Complete example](#preserve-the-old-array-when-replacement-input-fails)                |
| Observe key order separately from changing values                  | `ObservableMap`    | [Complete example](#observe-key-order-separately-from-changing-values)                  |
| Watch one selected member and release the collection independently | `ObservableSet`    | [Complete example](#watch-one-selected-member-and-release-the-collection-independently) |

## Running the examples

```bash
pnpm add @migaia/store-indexed @migaia/reactive
```

Examples using createRuntime import reactive directly. `schedulerStrategy: (run) => run()` invokes the current flush callback synchronously and returns void, making counts deterministic. When omitted, this field requests flushing through the Runtime adapter's scheduleMicrotask. Collection options and Runtime scheduling options have separate owners. An observer's first run counts immediately; its returned handle is disposed at the end.

## Observe one field and read another without subscribing

A profile view renders a name while checking age for a local decision. Changing age should not rerun the name view; changing the name should.

Subscribing to one whole-object signal couples every field to the same update. An incidental tracked read of age also adds a dependency the view never intended to own.

Use ObservableObject.get for the field to track and peek for the untracked read. Install reactive directly; schedulerStrategy is its Runtime option, set here to run effects synchronously.

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

Prints `["Ada","Grace"]`. The age write adds no observation; the name write appends exactly one new value.

Only tracked get reads subscribe to that key; peek never tracks. Object.has and keys track the whole key structure instead. The supplied Runtime is borrowed, and observers and collection are explicitly disposed.

### Example parameters

initial is the required name/age object. runtime is the instance created here, or defaultRuntime when omitted. Omitted options use `{}`, undefined mutationGuard, and debugName `'ObservableObject'`. get/set/peek keys come from the inferred string-key domain, and set requires the field's value type.

## Keep a previous top-level snapshot without assuming a deep copy

A history panel needs an earlier record of top-level field assignments. It also needs to know whether editing a nested object changes that earlier record.

Keeping the backing object loses history when fields are reassigned. Freezing only its outer shape does not make referenced nested objects immutable.

ObservableObject.snapshot caches a shallow-frozen null-prototype object until a collection revision changes. Keep that result for earlier top-level values; copy nested application data separately when needed.

```ts doc-test=run
import { ObservableObject } from '@migaia/store-indexed'

const nested = { visits: 1 }
const user = new ObservableObject({ count: 1, nested })
const first = user.snapshot()
console.log(
  Object.isFrozen(first),
  Object.getPrototypeOf(first) === null,
  first === user.snapshot()
)
user.set('count', 2)
const second = user.snapshot()
console.log(first.count, second.count, first === second)
nested.visits = 9
console.log(first.nested.visits, second.nested.visits)
user.dispose()
console.log(first.count)
```

Output:

```text
true true true
1 2 false
9 9
1
```

Prints `true true true`, `1 2 false`, `9 9`, and `1`. An unchanged revision reuses one frozen result; a later assignment creates another, while both retain the same nested object.

The snapshot remains readable after collection disposal. Its freeze is shallow and does not provide deep history. Omitting Runtime uses defaultRuntime; omitting collection options uses no mutationGuard and the class debugName.

### Example parameters

The application owns nested; construction, snapshot, and set do not deep-clone it. Omitting runtime/options uses defaultRuntime, no guard, and the class debug name. Reassigning count advances revision, while an in-place nested.visits change does not.

## Separate one row index from the list length

A table watches its first row and shows a row count. Updating another row should affect neither observation; appending should update only the count.

Watching an entire array treats every edit as a list change. Assuming an index is a stable record ID also breaks when removing the first item moves every later value.

ObservableArray.at tracks an index, while length tracks structure. Use a directly installed reactive Runtime; its synchronous schedulerStrategy makes the observer counts explicit here.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { ObservableArray } from '@migaia/store-indexed'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const rows = new ObservableArray([10, 20], runtime)
let indexRuns = 0
let lengthRuns = 0
const indexWatch = runtime.effect(() => {
  rows.at(0)
  indexRuns += 1
})
const lengthWatch = runtime.effect(() => {
  void rows.length
  lengthRuns += 1
})
rows.set(1, 21)
console.log(indexRuns, lengthRuns)
rows.set(0, 11)
console.log(indexRuns, lengthRuns)
rows.push(30)
console.log(indexRuns, lengthRuns)
rows.splice(0, 1)
console.log(indexRuns, lengthRuns, rows.at(0))
indexWatch.dispose()
lengthWatch.dispose()
rows.dispose()
```

Output:

```text
1 1
2 1
2 2
3 3 21
```

Prints `1 1`, `2 1`, `2 2`, then `3 3 21`. A sibling edit is ignored, index 0 changes independently, append changes length, and splice moves 21 into the watched position.

Indices identify positions, not entities. set accepts only existing nonnegative integer positions; at also accepts negative integers. Every displayed count includes the initial effect run, and the Runtime is borrowed.

### Example parameters

initial is an iterable of numbers, defaulting to `[]`. runtime is supplied explicitly; omitted options mean `{}`, no guard, and debugName `'ObservableArray'`. at supports negative integer positions, set only existing nonnegative integers. push uses rest arguments; splice here uses start 0 and deleteCount 1.

## Preserve the old array when replacement input fails

A streamed replacement yields one row and then fails. The visible collection should keep its complete previous contents rather than show half the new input.

Clearing the old list before consuming an iterator commits too early. Pushing each incoming item also exposes partial results if the next iterator step throws.

ObservableArray.replace materializes its whole iterable before committing. This example uses a real generator that throws after one value, then supplies a valid replacement.

```ts doc-test=run
import { ObservableArray } from '@migaia/store-indexed'

const rows = new ObservableArray([1, 2])
const original = new Error('input interrupted')
function* incoming(): Generator<number> {
  yield 3
  throw original
}
try {
  rows.replace(incoming())
} catch (error) {
  if (!(error instanceof Error) || !('code' in error)) throw error
  console.log(error.code, error.cause === original)
}
console.log(JSON.stringify(rows.snapshot()))
rows.replace([4, 5])
console.log(JSON.stringify(rows.snapshot()))
rows.dispose()
```

Output:

```text
INVALID_OPTION true
[1,2]
[4,5]
```

Prints `INVALID_OPTION true`, `[1,2]`, and `[4,5]`. The iterator error stays on cause, no partial replacement is committed, and a later valid input succeeds.

Input preparation is atomic for this collection; it does not undo effects performed by the iterator itself. Replacement is shallow, strings are accepted as character iterables, and equal-length input still requires value comparisons.

### Example parameters

replace requires a complete iterable. The omitted construction runtime is defaultRuntime; options use no guard and debugName `'ObservableArray'`. incoming throws an application error after one item, and the catch checks code and cause identity. A valid array replacement remains usable afterward.

## Observe key order separately from changing values

A navigation list needs map keys, while a summary displays values. Updating an existing value should refresh the summary without rebuilding the key list.

One whole-map subscription cannot distinguish value edits from structural changes. Comparing membership alone also misses a replacement that reorders the same entries.

ObservableMap.keys tracks structure and valuesArray tracks value iteration. replace also checks insertion order. Install reactive directly; the example selects synchronous Runtime scheduling for exact counts.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { ObservableMap } from '@migaia/store-indexed'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const values = new ObservableMap<string, number>(
  [
    ['a', 1],
    ['b', 2]
  ],
  runtime
)
let keyRuns = 0
let valueRuns = 0
const keysWatch = runtime.effect(() => {
  values.keys()
  keyRuns += 1
})
const valuesWatch = runtime.effect(() => {
  values.valuesArray()
  valueRuns += 1
})
values.set('a', 10)
console.log(keyRuns, valueRuns)
values.replace([
  ['b', 2],
  ['a', 10]
])
console.log(keyRuns, valueRuns, JSON.stringify(values.keys()), JSON.stringify(values.valuesArray()))
values.replace([
  ['b', 2],
  ['a', 10]
])
console.log(keyRuns, valueRuns)
keysWatch.dispose()
valuesWatch.dispose()
values.dispose()
```

Output:

```text
1 2
2 3 ["b","a"] [2,10]
2 3
```

Prints `1 2`, `2 3 ["b","a"] [2,10]`, and `2 3`. Updating a changes only the values observer; reordering updates both once; repeating identical ordered content updates neither.

size also tracks structure and can rerun on reorder even when its numeric value stays equal. Map.has shares the selected value cell, so changing that key’s value can also rerun has; it is not a separate membership-only signal.

### Example parameters

initial is an iterable of `[key,value]` entries, defaulting to an empty map. runtime is explicit; omitted options use no guard and debugName `'ObservableMap'`. set takes a key and a value. replace adopts entry insertion order, and repeating identical ordered content does not notify.

## Watch one selected member and release the collection independently

A selection badge watches item a while other items are selected. Closing that badge’s collection must not shut down the Runtime used by other application state.

Watching the entire Set reruns the badge for every unrelated selection. Giving a borrowed Runtime the same disposal lifetime as one collection also breaks its other users.

ObservableSet.has tracks one member. Dispose its observer and collection explicitly; the supplied Runtime remains usable. Install reactive directly, with synchronous Runtime scheduling chosen only for this example.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { ObservableSet } from '@migaia/store-indexed'

const runtime = createRuntime({ schedulerStrategy: (run) => run() })
const selected = new ObservableSet(['a'], runtime)
let runs = 0
let present = false
const watch = runtime.effect(() => {
  present = selected.has('a')
  runs += 1
})
selected.add('b')
console.log(runs, present)
selected.delete('a')
console.log(runs, present)
selected.add('a')
console.log(runs, present)
watch.dispose()
selected.dispose()
selected.dispose()
const count = runtime.signal(1)
count.value = 2
console.log(selected.disposed, count.value)
count.dispose()
```

Output:

```text
1 true
2 false
3 true
true 2
```

Prints `1 true`, `2 false`, `3 true`, and `true 2`. Adding b does not rerun a’s observer; deleting and restoring a do; after idempotent collection disposal, a new Runtime signal still works.

The collection owns its internal signals, not the Runtime or nested application objects. Dispose observers first. Later data access through the disposed collection throws COLLECTION_DISPOSED; disposed itself remains readable.

### Example parameters

initial defaults to `[]`; this example supplies member `'a'`. runtime is explicitly borrowed; omitted options mean no guard and debugName `'ObservableSet'`. has/add/delete take a member value. dispose takes no arguments and repeats as a no-op. runtime.signal(1) creates a separate reactive value to show the Runtime remains usable.

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
