# `@migaia/store-persist`

Connect Store, collection, or keyed snapshots to storage while coordinating startup restoration, local edits, and ordered writes.

## You may have run into this

- A freshly edited field reverts when startup restoration finishes because a late archive replaces current memory wholesale.
- Defaults overwrite a damaged archive before investigation because a settled read is mistaken for successful restoration.
- A renamed field is not migrated while temporary fields get saved because schema conversion and write selection are mixed together.
- A cart Map becomes an empty object after saving because ordinary JSON does not preserve collection entries.
- Leaving one user screen stops another user from saving because an entire definition family shares one persistence lifetime.

## Why choose it

- **Restore saved fields while retaining local startup edits.** Instead of replacing memory with a late archive, the example keeps a local counter, restores an untouched theme, and saves both in [the scenario](./USEGUIDE.en.md#keep-edits-made-while-an-archive-is-loading).
- **Keep writes blocked until failed restoration is repaired.** The example preserves the damaged archive, shares its original error, and saves only after a successful retry rather than overwriting it with defaults in [the scenario](./USEGUIDE.en.md#repair-a-failed-archive-before-reopening-writes).
- **Declare version conversion separately from saved-field selection.** The example migrates an old theme and excludes temporary state instead of treating old schema as current or saving every session field in [the scenario](./USEGUIDE.en.md#migrate-old-settings-and-save-only-selected-fields).
- **Round-trip collection entries with the default codec.** Rather than silently turning a Map into an empty JSON object, the example restores book quantity in a new collection and removes a stale key in [the scenario](./USEGUIDE.en.md#restore-a-map-without-losing-its-entries).
- **Release persistence independently for each key.** Instead of coupling every user through a family-wide switch, the example stops one key while the other keeps saving and business memory remains usable in [the scenario](./USEGUIDE.en.md#stop-saving-one-key-while-another-keeps-working).

## Start here

Save overview.ts in an ESM project and run it with Node 24; this real in-memory backend retains data only for its own lifetime:

```bash
pnpm add @migaia/store-persist @migaia/store-light @migaia/storage-web
```

```ts doc-test=run
import { createStore } from '@migaia/store-light'
import { memoryStorageHost } from '@migaia/storage-web/memory'
import { persist } from '@migaia/store-persist/light'

const storage = memoryStorageHost()
const settings = createStore({ theme: 'light' })
const handle = persist(settings, { key: 'settings', storage })
await handle.ready
settings.theme = 'dark'
await handle.flush()
console.log('saved:', (await storage.get('settings')) !== null)
handle.dispose()
await settings.$dispose()
storage.dispose()
```

Output:

```text
saved: true
```

For startup edits, see [Keep edits made while an archive is loading](./USEGUIDE.en.md#keep-edits-made-while-an-archive-is-loading); for failed reads, see [Repair a failed archive before reopening writes](./USEGUIDE.en.md#repair-a-failed-archive-before-reopening-writes).

key names this archive and storage is the caller-created memory backend. Import persist from /light. Defaults are version 0, defaultJsonCodec, debounceMs 0, identity partialize, and systemScheduler. flush waits for initial hydration, rejects failed restoration, and awaits writing. Store, persistence handle, and storage have separate release owners.

## Pitfalls when writing it yourself

The same settings-save task, displayed without execution:

```ts doc-test=check
import { createStore } from '@migaia/store-light'
import { memoryStorageHost } from '@migaia/storage-web/memory'

const store = createStore({ count: 0 })
const storage = memoryStorageHost()
const off = store.$subscribe(() => {
  void storage.set('settings', JSON.stringify(store.$plain())) // Neither serialized nor awaited
})
void storage.get('settings').then((raw) => {
  if (raw !== null) store.$hydrate(JSON.parse(raw)) // A late archive can overwrite local edits
})
store.count = 1
void off // No unsubscription or resource release is arranged
```

The preceding example awaits the actual persistence write through flush, then releases the handle and business resources separately. The shared engine also reconciles fields during restoration. This handwritten version only displays the pitfalls of the same saving task and is not executed.

## A three-minute mental model

| State shape or task                  | Tool                            | Remember                                                                     |
| ------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------- |
| createStore state                    | persist from /light             | $plain saves and $hydrate restores.                                          |
| ObservableObject / Array / Map / Set | persistCollection from /indexed | snapshot tracks and replace restores.                                        |
| One writable AtomStore definition    | persistKeyed from /keyed        | Explicit id and one handle per key.                                          |
| Delete a namespace of archives       | clearFamily from /keyed         | Does not reset memory or stop active handles.                                |
| Initial restoration or recovery      | ready / retryHydrate            | Retry does not replace ready.                                                |
| Explicit saving and release          | flush / dispose                 | flush awaits an outcome; synchronous dispose does not await its final write. |

**Hydration** restores an archive into current state. An **envelope** stores version alongside state. **Three-way merging** compares startup, current, and saved fields. A **debounce window** controls when writing is requested rather than when storage finishes. A **handle** owns one persistence subscription and its statuses while borrowing business resources.

## Typical scenarios

| Scenario                                           | How to combine                                          | Details                                                                              |
| -------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Keep edits made while an archive is loading        | persist → local edit → ready → flush                    | [Complete code](./USEGUIDE.en.md#keep-edits-made-while-an-archive-is-loading)        |
| Repair a failed archive before reopening writes    | ready rejection → repair storage → retryHydrate → flush | [Complete code](./USEGUIDE.en.md#repair-a-failed-archive-before-reopening-writes)    |
| Migrate old settings and save only selected fields | version / migrate → partialize → flush                  | [Complete code](./USEGUIDE.en.md#migrate-old-settings-and-save-only-selected-fields) |
| Restore a Map without losing its entries           | persistCollection → flush → new Map → ready             | [Complete code](./USEGUIDE.en.md#restore-a-map-without-losing-its-entries)           |
| Stop saving one key while another keeps working    | persistKeyed × 2 → ready → dispose one → flush          | [Complete code](./USEGUIDE.en.md#stop-saving-one-key-while-another-keeps-working)    |
| Clear saved records without resetting live values  | clearFamily → inspect memory → change → flush           | [Complete code](./USEGUIDE.en.md#clear-saved-records-without-resetting-live-values)  |

## Installation

```bash
pnpm add @migaia/store-persist @migaia/store-light @migaia/storage-web
```

Install only the optional Store peer you use. The light example above needs store-light; collection and keyed examples can additionally use:

```bash
pnpm add @migaia/store-indexed @migaia/store-keyed @migaia/reactive
```

## Essential APIs

| API                             | When to use it                                                  |
| ------------------------------- | --------------------------------------------------------------- |
| persist from /light             | Save the state fields supported by createStore.                 |
| persistCollection from /indexed | Save an observable collection.                                  |
| persistKeyed from /keyed        | Attach one writable definition using an explicit id.            |
| clearFamily from /keyed         | Delete namespace archives without changing memory.              |
| handle.ready / retryHydrate     | Observe the initial attempt or an initiated recovery.           |
| handle.flush / clear / dispose  | Await a save, delete an archive, or stop that persistence unit. |

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
| migrate    | Unset; called as migrate(persisted, fromVersion) on a version mismatch, which otherwise fails hydration. The keyed facade does not expose it.                                                       |
| partialize | Identity; selects what to save from the current snapshot.                                                                                                                                           |
| merge      | Custom merge(persisted, current) is available in core / indexed / keyed. The default shallowly reconciles plain objects against startup state and replaces other shapes. light has no merge option. |
| debounceMs | 0, disabling debounce; finite from 0 through 2147483647, including fractions.                                                                                                                       |
| maxWaitMs  | Unset; the same range, bounding the debounce window rather than I/O.                                                                                                                                |
| scheduler  | Canonical systemScheduler, providing monotonic now and cancellable schedule tasks.                                                                                                                  |

Facades snapshot own option properties, invoking getters once with the original options receiver. Core also captures configuration fields during construction and uses the admitted merge rather than rereading a caller getter during restore. Non-object options, failed reflection, or getter failure produce INVALID_OPTION TypeError; caught failures remain on cause. key, namespace, and id are checked as strings before concatenation, without silently converting objects or numbers or imposing an extra nonempty-string requirement. Version, durations, and callback shapes are validated before persistence state construction.

migrate, partialize, and merge must return synchronously. Promise / thenable results, or failed reads of then, produce INVALID_OPTION instead of storing a Promise as business state. Ordinary synchronous callback and backend exceptions retain their existing public error paths; not every failure is relabeled with one local code.

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

Construction captures startup state and subscribes before the asynchronous read. An absent archive hydrates successfully without replacing initial memory. A present archive is decoded and validated, migrated when its version differs and migrate exists, then merged and restored synchronously. Matching versions do not run migrate. A mismatch without migration produces ENVELOPE_INVALID rather than treating old schema as current.

Default merging handles plain objects with Object.prototype or null prototypes. It shallowly compares each current field against construction-time startup state using Object.is: locally changed fields win, untouched fields accept the archive, and unarchived current fields remain. It is not deep conflict resolution; mutation inside a retained nested reference is not recursively compared. Retry uses that same startup baseline. Arrays, Maps, Sets, and other non-plain shapes accept the persisted shape wholesale; a custom merge owns its application rules.

Changes during hydration mark dirty rather than writing over an unknown archive. Synchronous restore notifications join that window. Successful hydration schedules retained dirty work. Failure retains its error and dirty state; flush / clear throw the hydration error without writing until retryHydrate succeeds. A further retry call during recovery does not start a parallel read, but is not guaranteed to await that recovery or return the same Promise. Await the call that initiated retry to observe its result.

### Handle state and waiting

| Member               | Values or behavior                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| status               | loading / ready / error / disposed; disposed takes precedence, then hydration loading, then hydration or write error. In-progress writing has its own writeStatus. |
| error                | hydrationError or writeError; both produce HYDRATE_AND_WRITE_FAILED AggregateError with hydration then write in errors.                                            |
| hydrated             | Whether hydrationStatus is success, not whether the handle is still active.                                                                                        |
| hydrationStatus      | loading / success / error, changing again on retry.                                                                                                                |
| hydrationError       | Current hydration failure, cleared on success.                                                                                                                     |
| writeStatus          | idle / writing / error / disposed.                                                                                                                                 |
| writeError           | Latest write failure, cleared by an ordinary successful write; a final disposal write may also retain failure here.                                                |
| ready                | Promise for the first hydration attempt, resolving on success and rejecting on failure or disposal before completion; retry never replaces it.                     |
| settled              | An always-resolving barrier for the first attempt, not later retry completion.                                                                                     |
| retryHydrate()       | No arguments; rereads after failure and reopens writing only on success. Await the initiating call itself.                                                         |
| flush() / clear()    | No arguments; `Promise<void>`, with ordered write / deletion behavior below.                                                                                       |
| disposed / dispose() | Live boolean getter / synchronous idempotent release.                                                                                                              |

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

An envelope contains a nonnegative safe-integer version and non-null / non-undefined state. assertEnvelope(value, key) rejects non-objects, arrays, invalid versions, and absent state, returning the captured version / state. Each property is read once; inaccessible properties or reflection failures become PersistEnvelopeError with the cause retained. This TypeError subclass carries ENVELOPE_INVALID, with key identifying the archive.

defaultJsonCodec is named migaia-collections-json-v1 with text output. It delegates to storage-contract collectionsJsonCodec and round-trips real Maps / Sets, including cross-realm collections, rather than ordinary JSON's silent empty-object encoding. JSON limits such as cycles and BigInt remain; it is not lossless encoding for arbitrary object graphs. Exact reserved versioned tuple shapes are not unrestricted application-array space.

Legacy reading recognizes only objects whose sole own key is `__migaia_persist_map__` or `__migaia_persist_set__` with an array value. Similar records containing extra fields retain all their data. An exact legacy marker selects the legacy reviver, preserving ordinary application arrays inside that archive rather than reinterpreting them as current tuples. Archives without exact legacy markers use current decoding. New write format and codec name remain unchanged.

defaultJsonCodec.encode wraps failure in ENCODE_FAILED TypeError with cause. decode rejects non-string or malformed JSON / markers with ENVELOPE_INVALID TypeError, retaining caught parse failures as cause. The default codec neither encrypts nor redacts. A custom codec owns the shapes it declares.

### Storage projection and codec routing

IPersistStorage is an internal minimal projection rather than a named package-entry export: capabilities, get, set, remove, and keys come from IKeyValueStore. It requires no backend, has, clearValues, clearAll, or dispose. Optional getBytes / setBytes come from IRecordStore, not IKeyValueStore itself. Backend and codec exceptions retain their own public identities and causes rather than all becoming local-source errors.

| Helper or route                                | Behavior and failure                                                                                                                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| writeEnvelope(storage, key, codec, value, ctx) | ctx is required but may be empty; signal is optional. structured output explicitly rejects with CODEC_OUTPUT_MISMATCH instead of using a record channel.                                                                                        |
| Binary write                                   | With capabilities.binary true, both byte methods are required or BACKEND_CAPABILITY rejects. The encoded value must be Uint8Array, otherwise CODEC_OUTPUT_MISMATCH.                                                                             |
| Other write branch                             | Requires a string and calls storage.set, without automatic base64 fallback.                                                                                                                                                                     |
| readEnvelope(storage, key, codec, ctx)         | Binary with true capability uses getBytes then codec.decode; missing byte methods produce BACKEND_CAPABILITY, while false binary capability produces CODEC_OUTPUT_MISMATCH. Non-binary reads use get + decode. Missing values return undefined. |
| removeEnvelope(storage, key, ctx)              | Awaits storage.remove without changing business memory.                                                                                                                                                                                         |

Binary output is checked by genuine Uint8Array brand, accepting foreign intrinsic values / subclasses while rejecting a Proxy impersonating byte storage. A text-only backend with a binary codec needs a compatible backend or text codec. A method name or output label alone does not establish all capabilities.

### Errors and troubleshooting

STORE_PERSIST_SOURCE is @migaia/store-persist. StorePersistErrorCode owns the stable vocabulary:

| Property / code                                  | Meaning                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| codecNotResolved / CODEC_NOT_RESOLVED            | No codec resolved; supply one or correct resolution.                              |
| codecOutputMismatch / CODEC_OUTPUT_MISMATCH      | Codec output, payload, and backend routing disagree.                              |
| backendCapability / BACKEND_CAPABILITY           | Binary routing lacks required byte methods.                                       |
| envelopeInvalid / ENVELOPE_INVALID               | Invalid archive or version mismatch without migration.                            |
| encodeFailed / ENCODE_FAILED                     | Default encoding failed; inspect cause and input.                                 |
| hydrateAndWriteFailed / HYDRATE_AND_WRITE_FAILED | Both hydration and writing failed; inspect AggregateError.errors.                 |
| abortedByDispose / ABORTED_BY_DISPOSE            | Disposal cancellation retaining DOMException / AbortError and original cause.     |
| invalidOption / INVALID_OPTION                   | Invalid key, namespace, version, duration, callback, scheduler, or configuration. |

Invalid configuration such as an unsafe version throws TypeError synchronously. Envelope failures use PersistEnvelopeError. Failed hydration keeps flush / clear blocked with hydrationError until successful retry; write failures appear in writeError. Check codec/backend compatibility, and keep handle retirement separate from memory reset or archive deletion.

Public createStorePersistError / createStorePersistTypeError require code and message and accept optional options.cause. createStorePersistAbortError takes code, message, and optional cause, returning a native DOMException named AbortError. createStorePersistAggregateError takes code, errors, and message and retains original failures. code has type IStorePersistErrorCode; factories attach identity without overwriting stack. Ordinary Store integration need not reimplement these helpers.

Existing package scripts include fmt, lint, typecheck, typecheck:test, test, build, and test:packed. Actual reports identify which ran; listing commands does not establish verification. Investigate missing fields through partialize / debounce, then hydrationError / writeError. If Map / Set shape is lost, check whether a custom codec replaced the default collection codec.
