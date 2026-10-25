# `@migaia/store-persist` Usage guide

Choose a persistence adapter for your state shape and manage hydration, write outcomes, and ownership separately. Start with the [README](./README.en.md).

## Find a scenario

| Task                                               | How to combine                                          | Complete example                                                       |
| -------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------- |
| Keep edits made while an archive is loading        | persist → local edit → ready → flush                    | [Code and output](#keep-edits-made-while-an-archive-is-loading)        |
| Repair a failed archive before reopening writes    | ready rejection → repair storage → retryHydrate → flush | [Code and output](#repair-a-failed-archive-before-reopening-writes)    |
| Migrate old settings and save only selected fields | version / migrations → partialize → flush               | [Code and output](#migrate-old-settings-and-save-only-selected-fields) |
| Restore a Map without losing its entries           | persistCollection → flush → new Map → ready             | [Code and output](#restore-a-map-without-losing-its-entries)           |
| Stop saving one key while another keeps working    | persistKeyed × 2 → ready → dispose one → flush          | [Code and output](#stop-saving-one-key-while-another-keeps-working)    |
| Clear saved records without resetting live values  | clearFamily → inspect memory → change → flush           | [Code and output](#clear-saved-records-without-resetting-live-values)  |

## Before running

Save each example as its own .ts file and run it in an ESM project with Node 24. They use real memoryStorageHost rather than browser localStorage or IndexedDB; data survives only while that backend instance lives. Install the models you need; this command covers all six examples:

```bash
pnpm add @migaia/store-persist @migaia/storage-web @migaia/store-light @migaia/store-indexed @migaia/store-keyed @migaia/reactive
```

## Keep edits made while an archive is loading

A settings archive contains an older counter, but the user changes it before startup restoration finishes.

Applying the saved object wholesale overwrites the new counter; skipping restoration also loses saved fields the user has not touched.

Attach persist before editing, then await ready. Its default plain-object merge compares each current field with the startup snapshot; flush writes the reconciled state.

### Example parameters

memoryBackendPlugin() is the real in-memory backend, with settings as the archive key. defaultJsonCodec encodes a complete version 0 / state envelope. createStore starts at light / 0 and uses its default Runtime when omitted. persist requires key and storage; omitted version and debounceMs are 0 and partialize is identity. Plain objects use shallow startup reconciliation, and awaiting flush confirms this write has settled.

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defaultJsonCodec } from '@migaia/store-persist'
import { persist } from '@migaia/store-persist/light'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
await storage.set(
  'settings',
  (await defaultJsonCodec.encode({
    version: 0,
    state: { theme: 'dark', count: 10 }
  })) as string
)
const settings = createStore({ theme: 'light', count: 0 })
const handle = persist(settings, { key: 'settings', storage })
settings.count = 1
await handle.ready
console.log('restored:', settings.theme, settings.count)
await handle.flush()
const saved = (await defaultJsonCodec.decode(await storage.get('settings'))) as {
  state: { theme: string; count: number }
}
console.log('saved:', saved.state.theme, saved.state.count)
handle.dispose()
await settings.$dispose()
```

Output:

```text
restored: dark 1
saved: dark 1
```

The output is `restored: dark 1`, then `saved: dark 1`: the saved theme returns while the local counter wins.

The default version is 0 and debounceMs is 0. This is a shallow Object.is comparison for plain objects; arrays, Map and Set use whole-state replacement instead.

## Repair a failed archive before reopening writes

A malformed archive makes startup fail, and the user keeps editing the live settings.

Writing defaults immediately would destroy the failed archive before it can be inspected or repaired; treating a settled Promise as successful restoration has the same risk.

Catch ready, inspect the failure, and repair the real storage record. Await retryHydrate before flushing; it reopens writes only after a successful read and restore.

### Example parameters

storage.set first writes malformed JSON, and the example retains the first ready Promise and its error. Failed hydration does not save the local edit. retryHydrate takes no arguments and rereads the repaired archive; await that retry and flush. settled is not a success indicator, and retry does not replace ready. Key, codec, and debounce defaults match the first example.

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defaultJsonCodec } from '@migaia/store-persist'
import { persist } from '@migaia/store-persist/light'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
await storage.set('settings', '{')
const settings = createStore({ count: 0 })
const handle = persist(settings, { key: 'settings', storage })
const initialReady = handle.ready
const failure = await initialReady.catch((error: unknown) => error)
settings.count = 2
const writeFailure = await handle.flush().catch((error: unknown) => error)
console.log('blocked:', handle.status.value, writeFailure === failure)
console.log('untouched:', (await storage.get('settings')) === '{')
await storage.set(
  'settings',
  (await defaultJsonCodec.encode({
    version: 0,
    state: { count: 10 }
  })) as string
)
await handle.retryHydrate()
await handle.flush()
console.log('recovered:', handle.status.value, settings.count, handle.ready === initialReady)
console.log('first attempt:', (await handle.ready.catch((error: unknown) => error)) === failure)
handle.dispose()
await settings.$dispose()
```

Output:

```text
blocked: error true
untouched: true
recovered: ready 2 true
first attempt: true
```

The output is `blocked: error true`, `untouched: true`, `recovered: ready 2 true`, then `first attempt: true`.

Failed hydration blocks automatic writes and makes flush reject with the same failure. Retry keeps the original startup baseline and does not replace ready; settled alone only waits for the first attempt.

## Migrate old settings and save only selected fields

A new release renames a saved field, while temporary session data must stay in memory.

Reading old state as if it already used the new schema loses the renamed value; serializing every field also writes temporary data into the archive.

Set version to 2, map the old state synchronously with migrations, and select saved fields with partialize. This example reads version 1 and explicitly retains only theme on writes.

### Example parameters

Target version overrides 0 with 2 while the archive is version 1. migrations[2] receives unknown old state and a { fromVersion, toVersion } context and returns state synchronously. partialize selects theme instead of default identity. Unsaved temporary remains in the Store. Default reconciliation still uses startup state, and light restores through $hydrate. String conversion is this example's schema rule, not a universal migration policy.

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defaultJsonCodec } from '@migaia/store-persist'
import { persist } from '@migaia/store-persist/light'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
await storage.set(
  'settings',
  (await defaultJsonCodec.encode({
    version: 1,
    state: { legacyTheme: 'dark' }
  })) as string
)
const settings = createStore({ theme: 'light', temporary: 'session-only' })
let migratedFrom = 0
const handle = persist(settings, {
  key: 'settings',
  storage,
  version: 2,
  migrations: {
    2: (previous, { fromVersion }) => {
      const state = previous as Record<string, unknown>
      migratedFrom = fromVersion
      return { theme: String(state.legacyTheme) }
    }
  },
  partialize: (state) => ({ theme: state.theme })
})
await handle.ready
console.log('migrated:', migratedFrom, settings.theme, settings.temporary)
settings.theme = 'contrast'
await handle.flush()
const saved = (await defaultJsonCodec.decode(await storage.get('settings'))) as {
  version: number
  state: { theme: string; temporary?: string }
}
console.log('archive:', saved.version, saved.state.theme, Object.hasOwn(saved.state, 'temporary'))
handle.dispose()
await settings.$dispose()
```

Output:

```text
migrated: 1 dark session-only
archive: 2 contrast false
```

The output is `migrated: 1 dark session-only`, then `archive: 2 contrast false`: the renamed field is restored and the temporary field is absent from storage.

Version defaults to 0. Missing steps or future archives fail hydration. Steps and partialize return synchronously. Upgrading alone does not write back; flush saves the new archive.

## Restore a Map without losing its entries

A cart stored as an observable Map must survive a new collection instance.

Plain JSON serialization turns a Map into an empty object; patching entries into an existing collection can also leave obsolete keys behind.

Pass the real ObservableMap to persistCollection and flush before releasing it. The default codec preserves Map entries, and restoration calls replace on the new collection.

### Example parameters

The first ObservableMap is empty; its restore target starts with only stale: 99. Both omit explicit Runtime configuration. persistCollection takes the collection and key / storage without another application subscription. The default codec supports Map, with version and debounceMs 0. Default Map restoration replaces the whole state, removing stale; partial persistence needs a matching explicit merge.

```ts doc-test=run
import { ObservableMap } from '@migaia/store-indexed'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defaultJsonCodec } from '@migaia/store-persist'
import { persistCollection } from '@migaia/store-persist/indexed'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
const cart = new ObservableMap<string, number>()
const first = persistCollection(cart, { key: 'cart', storage })
await first.ready
cart.set('book', 2)
await first.flush()
first.dispose()
cart.dispose()
const restored = new ObservableMap<string, number>([['stale', 99]])
const second = persistCollection(restored, { key: 'cart', storage })
await second.ready
console.log('restored:', restored.get('book'), restored.has('stale'))
const saved = (await defaultJsonCodec.decode(await storage.get('cart'))) as { state: unknown }
console.log('map:', saved.state instanceof Map)
second.dispose()
restored.dispose()
```

Output:

```text
restored: 2 false
map: true
```

The output is `restored: 2 false`, then `map: true`: book returns, stale disappears, and the decoded archive still contains a Map.

The default codec is defaultJsonCodec, version is 0, and debounceMs is 0. Map restoration replaces the whole state; use an explicit merge when a selected subset needs shape-specific reconciliation.

## Stop saving one key while another keeps working

Two user profiles share a definition family, but leaving one screen should stop saving only that profile.

A family-wide listener couples unrelated keys, and reading handle.value as a live value keeps displaying the snapshot captured before restoration.

Create one persistKeyed handle per definition and explicit id. Await ready, read current values through AtomStore, and dispose only the handle whose persistence is no longer needed.

### Example parameters

createAtomStore uses the explicitly created Runtime. familyDef initializes each key with an empty name. persistKeyed explicitly receives def, string id, namespace, and storage, forming users:u1 / users:u2 rather than inferring ids from definitions. first.value is the initial snapshot; atoms.peek reads current values. Handles are independent and do not dispose AtomStore.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createAtomStore, familyDef } from '@migaia/store-keyed'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defaultJsonCodec } from '@migaia/store-persist'
import { persistKeyed } from '@migaia/store-persist/keyed'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
await storage.set(
  'users:u1',
  (await defaultJsonCodec.encode({
    version: 0,
    state: { name: 'Ada' }
  })) as string
)
const atoms = createAtomStore(createRuntime())
const profile = familyDef(() => ({ name: '' }))
const first = persistKeyed(atoms, profile('u1'), 'u1', { namespace: 'users', storage })
const second = persistKeyed(atoms, profile('u2'), 'u2', { namespace: 'users', storage })
await Promise.all([first.ready, second.ready])
console.log('initial:', first.value.name === '', atoms.peek(profile('u1')).name)
atoms.set(profile('u1'), { name: 'Grace' })
atoms.set(profile('u2'), { name: 'Linus' })
await Promise.all([first.flush(), second.flush()])
first.dispose()
atoms.set(profile('u1'), { name: 'Changed' })
atoms.set(profile('u2'), { name: 'Barbara' })
await second.flush()
const one = (await defaultJsonCodec.decode(await storage.get('users:u1'))) as {
  state: { name: string }
}
const two = (await defaultJsonCodec.decode(await storage.get('users:u2'))) as {
  state: { name: string }
}
console.log('archives:', one.state.name, two.state.name)
console.log('memory:', atoms.peek(profile('u1')).name)
second.dispose()
atoms.dispose()
```

Output:

```text
initial: true Ada
archives: Grace Barbara
memory: Changed
```

The output is `initial: true Ada`, `archives: Grace Barbara`, then `memory: Changed`: stopping u1 leaves its last archive intact while u2 still saves.

Each key uses namespace:id; id is not inferred from the definition. value is the attachment-time snapshot. Disposing persistence does not dispose AtomStore or reset business values; version and debounceMs default to 0.

## Clear saved records without resetting live values

A sign-out flow removes one namespace from storage, yet a mounted screen still holds its current value.

Deleting records does not reset live state or remove its subscriptions. Assuming it does can make the next edit silently recreate a supposedly cleared archive.

Use clearFamily to remove matching records, then separately decide whether to reset business values or dispose their persistence handles. This example keeps a handle active to show the next write explicitly.

### Example parameters

clearFamily requires storage and namespace. users matches users: but not other:u1. The result counts matching keys without deleting live definitions or subscriptions. The active handle remains attached, so atoms.set followed by flush recreates the archive. Separately dispose that handle when persistence must stop.

```ts doc-test=run
import { createRuntime } from '@migaia/reactive'
import { createAtomStore, familyDef } from '@migaia/store-keyed'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { persistKeyed, clearFamily } from '@migaia/store-persist/keyed'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
await storage.set('other:u1', 'keep')
const atoms = createAtomStore(createRuntime())
const counter = familyDef(() => 0)
const def = counter('u1')
const handle = persistKeyed(atoms, def, 'u1', { namespace: 'users', storage })
await handle.ready
atoms.set(def, 7)
await handle.flush()
console.log('matched:', await clearFamily(storage, 'users'))
console.log(
  'after clear:',
  await storage.get('users:u1'),
  atoms.peek(def),
  await storage.get('other:u1')
)
atoms.set(def, 8)
await handle.flush()
console.log('recreated:', (await storage.get('users:u1')) !== null)
handle.dispose()
atoms.dispose()
```

Output:

```text
matched: 1
after clear: null 7 keep
recreated: true
```

The output is `matched: 1`, `after clear: null 7 keep`, then `recreated: true`: only users:u1 is removed, memory remains 7, and a later edit saves again.

The result counts keys matching namespace plus a colon at enumeration time, not successful remove booleans. Removal is sequential, not transactional; earlier removals remain if a later backend call fails.

## Contract details

### Responsibility, entries, and installation

This package connects state changes to storage: it reads archives, reconciles local edits during hydration, serializes writes, and manages debounce and disposal. It supplies neither a concrete backend nor encryption or a guarantee that page unload will finish saving. For one-off storage without state synchronization, use storage-contract and the desired backend directly. Choose storage and encryption appropriate to sensitive data; default JSON encoding is not encryption.

| Entry                           | Public contents                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `@migaia/store-persist`         | persistUnit, handle / options / envelope types, codec helpers, states, and errors. The root does not export the three Store adapters. |
| `@migaia/store-persist/light`   | persist, IPersistableStore, IPersistOptions.                                                                                          |
| `@migaia/store-persist/indexed` | persistCollection, IPersistableCollection, IPersistCollectionOptions.                                                                 |
| `@migaia/store-persist/keyed`   | persistKeyed, clearFamily, IPersistKeyedOptions, IPersistKeyedHandle.                                                                 |

reactive, storage-contract, utils, and lifecycle are runtime dependencies. store-light, store-indexed, and store-keyed are optional peers: install the model you use. Install storage-web only when using its backend or codec. Directly install packages your code imports rather than relying on transitive visibility. Obtain memoryStorageHost, localStorageHost, or indexedDbHost from storage-web's precise backend subentries; this package does not depend on concrete storage-web runtime values.

### Shared options and synchronous callbacks

persistUnit(unit, options) is the shared engine. A unit supplies synchronous snapshot(), synchronous restore(state), and subscribe(onChange), which returns a disposer. Core options require key, runtime, and storage. The three facades supply their Store / collection / AtomStore Runtime automatically. The state unit, Runtime, and storage remain borrowed.

| Option     | Default and meaning                                                                                                                                                                                 |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| key        | Required string identifying the archive, without implicit coercion.                                                                                                                                 |
| runtime    | Explicitly required by the core; owns status signals and is supplied by each facade.                                                                                                                |
| storage    | Required minimal KeyValueStore projection, described under routing below.                                                                                                                           |
| codec      | defaultJsonCodec; encodes the complete version / state envelope, not state alone.                                                                                                                   |
| version    | 0, a nonnegative safe integer.                                                                                                                                                                      |
| migrations | Contiguous target-version steps or `{ reset: () => state }`; synchronous only. Future or unreachable archives fail with VERSION_UNSUPPORTED. Keyed does not expose migrations.                      |
| partialize | Identity; selects what to save from the current snapshot.                                                                                                                                           |
| merge      | Custom merge(persisted, current) is available in core / indexed / keyed. The default shallowly reconciles plain objects against startup state and replaces other shapes. light has no merge option. |
| debounceMs | 0, disabling debounce; finite from 0 through 2147483647, including fractions.                                                                                                                       |
| maxWaitMs  | Unset; the same range, bounding the debounce window rather than I/O.                                                                                                                                |
| scheduler  | Canonical systemScheduler, providing monotonic now and cancellable schedule tasks.                                                                                                                  |

Facades snapshot own option properties, invoking getters once with the original options receiver. Core also captures configuration fields during construction and uses the admitted merge rather than rereading a caller getter during restore. Non-object options, failed reflection, or getter failure produce INVALID_OPTION TypeError; caught failures remain on cause. key, namespace, and id are checked as strings before concatenation, without silently converting objects or numbers or imposing an extra nonempty-string requirement. Version, durations, and callback shapes are validated before persistence state construction.

Migration steps are synchronous. Known Promise/thenable results fail at compile time; runtime MIGRATION_FAILED retains the original failure on cause. partialize and merge keep their synchronous INVALID_OPTION policy.

### Three state adapters

| Adapter                                   | Accepted state surface                                                                  | Reads, restoration, and subscription                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| persist(store, options)                   | Structural $runtime / $plain / $subscribe / $hydrate contract satisfied by createStore. | snapshot calls $plain, restore calls $hydrate, subscription explicitly sets fireImmediately false.                  |
| persistCollection(collection, options)    | runtime, snapshot(), replace(state), supported by ObservableObject / Array / Map / Set. | A Runtime effect reads tracked snapshot and skips its initial synchronous execution before reporting later changes. |
| persistKeyed(atomStore, def, id, options) | An AtomStore and writable definition.                                                   | peek snapshots, set restores, sub subscribes; every call creates an independent unit.                               |

light $plain includes signal-backed fields, excluding computed values, WASM fields, and methods. $hydrate writes known signal fields and ignores unknown fields by default. Saving only selected fields with partialize therefore does not require restoring absent fields, and this facade has no separate merge option. Core's plain-object reconciliation still protects same-field edits made during hydration.

indexed snapshot keeps the collection's native shape, and replace follows that collection's atomic replacement admission. Invalid archives or failed version checks do not call restore. This is not a promise to roll back arbitrary external effects. Partial persistence of arrays / Maps / Sets needs a matching application merge, because default replacement can discard unsaved portions. Plain-object field reconciliation also does not replace deep business merging.

keyed requires namespace and storage and offers its declared shared options. Its storage key is namespace + ':' + id. It cannot inventory an entire family; each handle owns persistence for one definition and key. handle.value is captured before hydration and is not the live AtomStore value, which must be read from AtomStore. Extending the real engine handle preserves its live disposed getter.

clearFamily(storage, namespace) requires both arguments and returns `Promise<number>`. It enumerates storage.keys(), filters namespace + ':', and awaits removals in order. Its result counts matched enumerated keys rather than exclusive successful remove results. It neither clears AtomStore memory nor stops active handles, so later changes may recreate records. Logout that must also clear business values separately updates AtomStore and stops persistence as needed.

### Loading, migration, and local edits

Attachment creates one migration plan before subscribing. Hydration uses storage-contract assertVersionedEnvelope and storage-host/authoring/migration migrateEnvelopeSync. Matching versions preserve state. Reachable older archives run contiguous steps or one reset; future archives fail with VERSION_UNSUPPORTED. Contract hydration errors pass through unchanged and close writes. Upgrading/restoring alone never writes back; application changes and flush retain existing scheduling.

Default merging handles plain objects with Object.prototype or null prototypes. It shallowly compares each current field against construction-time startup state using Object.is: locally changed fields win, untouched fields accept the archive, and unarchived current fields remain. It is not deep conflict resolution; mutation inside a retained nested reference is not recursively compared. Retry uses that same startup baseline. Arrays, Maps, Sets, and other non-plain shapes accept the persisted shape wholesale; a custom merge owns its application rules.

Changes during hydration mark dirty rather than writing over an unknown archive. Synchronous restore notifications are ignored; application changes during the asynchronous read remain dirty. Successful hydration schedules retained dirty work. Failure retains its error and dirty state; flush / clear throw the hydration error without writing until retryHydrate succeeds. A further retry call during recovery does not start a parallel read, but is not guaranteed to await that recovery or return the same Promise. Await the call that initiated retry to observe its result.

### Handle state and waiting

| Member               | Values or behavior                                                                                                                                                         |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| status               | loading / ready / error / disposed; disposed takes precedence, then hydration loading, then hydration or write error. In-progress writing has its own writeStatus.         |
| error                | hydrationError or writeError; both produce HYDRATE_AND_WRITE_FAILED AggregateError with hydration then write in errors.                                                    |
| hydrated             | Whether hydrationStatus is success, not whether the handle is still active.                                                                                                |
| hydrationStatus      | loading / success / error, changing again on retry.                                                                                                                        |
| hydrationError       | Current hydration failure, cleared on success.                                                                                                                             |
| writeStatus          | idle / writing / error / disposed.                                                                                                                                         |
| writeError           | Latest write failure, cleared by an ordinary successful write; a final disposal write may also retain failure here.                                                        |
| ready                | Promise for the first hydration attempt, resolving on success and rejecting on failure or disposal before completion; retry never replaces it.                             |
| settled              | An always-resolving barrier for the first attempt, not later retry completion.                                                                                             |
| retryHydrate()       | No arguments; rereads after failure and reopens writing only on success. Await the initiating call itself.                                                                 |
| flush(tx?) / clear() | `Promise<void>`; flush accepts an enlisted transaction view, while clear has no arguments.                                                                                 |
| disposed / dispose() | Live boolean getter / synchronous idempotent release.                                                                                                                      |
| disposeAsync()       | Stops synchronously, then awaits admitted writes/removals and the final debounce write; final-write failures stay on writeError; existing flush/clear keep their outcomes. |

status, error, and hydrated are Runtime computed values. Hydration and write detail fields expose IReadonlyPersistValue.value. PersistState contains only idle, loading, writing, ready, success, error, and disposed, with no active member. IPersistCodecOutput was removed in favor of storage-contract ICodecOutput; runtime PersistCodecOutput retains text / structured / binary. Old type or member imports require migration without compatibility aliases.

### Writes, debounce, flush, and clear

A write reads the latest unit.snapshot, applies synchronous partialize, and passes { version, state } to the codec. Writes and deletions share one serial chain so a slow old write cannot finish after and overwrite a newer one. Changes coalesce into requests, and actual encoding reads state when that request executes; not every intermediate value becomes a separate archive.

Positive debounceMs waits for a quiet interval. maxWaitMs fixes an upper enqueue deadline from the first pending change after successful hydration; later changes extend only quiet time. maxWaitMs 0 requests enqueueing through the next zero-delay task. debounceMs 0 requests writing directly and uses no debounce window. maxWait bounds enqueueing, not queue wait or backend completion.

flush cancels the window and awaits the initial hydration barrier. A failed hydration rejects with its original error. Otherwise flush observes the actual write it had already seen, requests the current snapshot, and waits. Strict concurrent flushes and background callers share the actual drain result and can all observe the same original failure. The separate catch chain used for later scheduling recovery does not turn that result into success. Public async wrappers are not promised to return identical Promise objects.

clear also cancels the window, waits for hydration, then deletes the archive after earlier writes. It does not reset memory, and a later state change can save again. clearFamily does not combine every active keyed handle into a transaction. A browser beforeunload handler cannot guarantee that flush finishes. Await flush at an explicit application save boundary and interpret completion using the backend's contract.

### Disposal, cancellation, and a final snapshot

dispose is synchronous and idempotent: it marks terminal state, requests abort on active adapter operations, cancels the debounce window, and unsubscribes. It does not dispose the borrowed Store, collection, AtomStore, Runtime, or storage. Subsequent flush / clear / retryHydrate reject with native AbortError carrying ABORTED_BY_DISPOSE; create another handle rather than reviving it.

If disposal cuts short a pending debounce timer, it captures the latest snapshot then schedules one final write behind the existing chain. This write is not awaited and receives no already-aborted signal. Capture, encoding, or I/O failure remains in writeError even while status is disposed. Without a pending timer, disposal does not unconditionally save another snapshot.

Cancellation reuses lifecycle's native AbortController and default AbortError reason. A backend ignoring signal may still complete already issued work; waiters observe termination after that actual operation settles, and a late original failure remains on the AbortError cause. dispose is not a hard I/O deadline or forced backend termination. For a confirmed save outcome, await flush while resources remain usable, then release persistence and business resources in application order.

### Archive, default codec, and compatibility

The canonical envelope is a plain object with own version (nonnegative safe integer) and own non-null/undefined state. Import assertVersionedEnvelope and IVersionedEnvelope from @migaia/storage-contract. Fields are read once; ENVELOPE_INVALID retains property failures on cause. Store-persist owns no duplicate validator or envelope error class.

defaultJsonCodec is the frozen text codec collections-json@1, wrapping fromValueCodec(defineCollectionsJsonCodec({ version: 1 })). It already preserves nested Map/Set with $rpc map/entries and set/values records. Non-finite numbers, undefined roots, sparse arrays, cycles and Date fail; ordinary class instances project enumerable fields. Encode errors retain store-persist ENCODE_FAILED, contract INVALID_ARGUMENT and serialize ENCODE_FAILED on cause. Non-string/malformed JSON retains the local ENVELOPE_INVALID TypeError; valid JSON envelope failures belong to storage-contract.

Historical collection markers and tuple-shaped arrays remain ordinary application data. No legacy collection revival runs; decoding delegates to the canonical codec once.

defaultJsonCodec.encode wraps failure in ENCODE_FAILED TypeError with cause. decode rejects non-string or malformed JSON / markers with ENVELOPE_INVALID TypeError, retaining caught parse failures as cause. The default codec neither encrypts nor redacts. A custom codec owns the shapes it declares.

### Storage projection and codec routing

IPersistStorage is an internal minimal projection rather than a named package-entry export: capabilities, get, set, remove, and keys come from IKeyValueStore. It requires no backend, has, clearValues, clearAll, or dispose. Optional getBytes / setBytes / removeBytes come from IRecordStore, not IKeyValueStore itself. With a binary codec, clear() uses removeBytes to delete only that byte key, leaving other byte keys and the text/record channels alone; a binary-capable backend without removeBytes makes clear reject with a BACKEND_CAPABILITY TypeError instead of falling back to text removal. Backend and codec exceptions retain their own public identities and causes rather than all becoming local-source errors.

| Helper or route                                | Behavior and failure                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| writeEnvelope(storage, key, codec, value, ctx) | ctx is required but may be empty; signal is optional. structured output explicitly rejects with CODEC_OUTPUT_MISMATCH instead of using a record channel.                                                                                             |
| Binary write                                   | With capabilities.binary true, both byte methods are required or BACKEND_CAPABILITY rejects. The encoded value must be Uint8Array, otherwise CODEC_OUTPUT_MISMATCH.                                                                                  |
| Other write branch                             | Requires a string and calls storage.set, without automatic base64 fallback.                                                                                                                                                                          |
| readEnvelope(storage, key, codec, ctx)         | Binary with true capability uses getBytes then codec.decode; missing byte methods produce BACKEND_CAPABILITY, while false binary capability produces CODEC_OUTPUT_MISMATCH. Non-binary reads use get + decode. Missing values return undefined.      |
| removeEnvelope(storage, key, ctx, codec?)      | Removes one archive through the codec-selected channel: text uses storage.remove by default; a binary codec on a binary-capable backend uses removeBytes and throws a BACKEND_CAPABILITY TypeError when it is missing. Business memory is unchanged. |

Binary output is checked by genuine Uint8Array brand, accepting foreign intrinsic values / subclasses while rejecting a Proxy impersonating byte storage. A text-only backend with a binary codec needs a compatible backend or text codec. A method name or output label alone does not establish all capabilities.

### Errors and troubleshooting

STORE_PERSIST_SOURCE is @migaia/store-persist. StorePersistErrorCode owns the stable vocabulary:

| Property / code                                  | Meaning                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| codecNotResolved / CODEC_NOT_RESOLVED            | No codec resolved; supply one or correct resolution.                              |
| codecOutputMismatch / CODEC_OUTPUT_MISMATCH      | Codec output, payload, and backend routing disagree.                              |
| backendCapability / BACKEND_CAPABILITY           | Binary routing lacks required byte methods.                                       |
| envelopeInvalid / ENVELOPE_INVALID               | Default JSON non-string input or decoding failure only.                           |
| encodeFailed / ENCODE_FAILED                     | Default encoding failed; inspect cause and input.                                 |
| hydrateAndWriteFailed / HYDRATE_AND_WRITE_FAILED | Both hydration and writing failed; inspect AggregateError.errors.                 |
| abortedByDispose / ABORTED_BY_DISPOSE            | Disposal cancellation retaining DOMException / AbortError and original cause.     |
| invalidOption / INVALID_OPTION                   | Invalid key, namespace, version, duration, callback, scheduler, or configuration. |

Invalid configuration throws a local INVALID_OPTION TypeError with the contract plan error on cause. Hydration preserves contract ENVELOPE_INVALID, VERSION_UNSUPPORTED and MIGRATION_FAILED. Failed hydration blocks flush/clear until retry succeeds; writeError retains write failures. The handle owns subscriptions and admitted writes, while stores and runtimes remain borrowed.

Public createStorePersistError / createStorePersistTypeError require code and message and accept optional options.cause. createStorePersistAbortError takes code, message, and optional cause, returning a native DOMException named AbortError. createStorePersistAggregateError takes code, errors, and message and retains original failures. code has type IStorePersistErrorCode; factories attach identity without overwriting stack. Ordinary Store integration need not reimplement these helpers.

Existing package scripts include fmt, lint, typecheck, typecheck:test, test, build, and test:packed. Actual reports identify which ran; listing commands does not establish verification. Investigate missing fields through partialize / debounce, then hydrationError / writeError. If Map / Set shape is lost, check whether a custom codec replaced the default collection codec.

## Canonical codec composition and observation

```ts
import { fromValueCodec } from '@migaia/storage-host/authoring/codec'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { createStore } from '@migaia/store-light'
import { persist } from '@migaia/store-persist/light'

const codec = fromValueCodec(defineCollectionsJsonCodec({ version: 1 }))
const text = await codec.encode({ roles: new Map([['Ada', new Set(['read'])]]) })
console.log(await codec.decode(text))

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
const state = createStore({ count: 1 })
await using handle = persist(state, {
  key: 'counter',
  storage,
  codecStages: host.codecStages(storage)
})
await handle.ready
await handle.flush()
await handle.disposeAsync()
await state.$dispose()
```

The default codec already preserves collections. Use `{ ...row }` to project a named class. codecStages observes each real encode/decode once; before/after/error failures only report, before never waits, and no business values enter observation. disposeAsync caches the rejecting main Promise; Symbol.asyncDispose caches a separate reporting Promise over one cleanup. Neither closes a borrowed store/runtime. Without native Symbol.asyncDispose, plugin-host asyncDisposeKey is the fixed fallback; language-level await using is not promised.

## Commit a snapshot with other writes

`persistTransaction(storage, [handle], run, options?)` pauses and drains these handles before borrowing one transaction from the original complete store. Handles must be active and attached to that exact storage. Empty arrays, copied handles and mismatched transaction views reject with `INVALID_OPTION`; text adapters reject with `BACKEND_CAPABILITY`. Concrete scope extensions, backend options and callback result types remain intact.

```ts doc-test=check
import { createStore } from '@migaia/store-light'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { persistTransaction } from '@migaia/store-persist'
import { persist } from '@migaia/store-persist/light'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const storage = host.backend('memory')
const settings = createStore({ count: 0 })
const handle = persist(settings, { key: 'settings', storage })
await handle.ready
try {
  await persistTransaction(storage, [handle], async (tx) => {
    settings.count = 1
    await handle.flush(tx)
    await tx.set('settings-source', 'user', { conflictPolicy: 'replace' })
  })
} finally {
  await handle.disposeAsync()
  await settings.$dispose()
}
```

`flush(tx)` reads snapshot, applies partialize and starts the same codec at invocation. Repeated calls on one handle write their individual snapshots in order. It waits for this conversion and request; only successful completion of the outer `persistTransaction` means commit. An entity write through `repository.in(tx).put(value)` can share that transaction with the snapshot, text and bytes.

During participation, notifications only record changes; no-argument `flush()`, `clear()` and `retryHydrate()` reject. Afterwards normal debounce mirrors newer memory. Rollback does not undo memory; ordinary mirroring resumes after failure too. Restore application state in catch if rollback of memory is needed. Disposal requests native abort without starting a final side write; disposeAsync waits for actual transaction completion. Handles borrow their store and Runtime.

IndexedDB requests must start directly within a native active window. Read external data before beginning the transaction; do not await fetch, timers or a codec spanning tasks inside the callback. With the objects from the preceding example, keep the external read outside coordination:

```ts
async function saveExternal(loadSettings: () => Promise<{ count: number }>): Promise<void> {
  const incoming = await loadSettings()
  await persistTransaction(storage, [handle], async (tx) => {
    settings.count = incoming.count
    await handle.flush(tx)
    await tx.set('settings-source', 'remote', { conflictPolicy: 'replace' })
  })
}
```

Optional `transactionStages: host.transactionStages(storage)` passes through all three adapters. Persistence emits only beforePersistFlush / afterPersistFlush; after means request completion. codecStages binds the actual operation view and observes each conversion once. Observer failures only report, never wait or alter business results. Exported `ITransactionScopeOf<typeof storage>` preserves the concrete backend scope type.

`ctx.concurrency` overrides the original store default. Busy handles are tried once: fail rejects immediately, and only a wait decision enters the cancellable FIFO. Custom policy runs only after a real conflict. Handle admission and backend retries share this call's deadline and wait budget; entering the backend does not restart timeoutMs. Cancellation still waits for accepted work to actually finish before releasing resources. Backend option values, including symbol fields, retain identity; cancellation uses the same coordination signal.
