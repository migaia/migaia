# Storage host authoring

Use a named descriptor factory when defining a generic backend factory. This preserves its actual store, literal instance id, client and selected Feature types without application casts.

```ts
import { createStorageHost, definePlugin } from '@migaia/storage-host'

const health = definePlugin('health', (core) => ({
  install: () => {
    core.onDispose(() => undefined)
    return { status: () => 'ready' }
  }
}))
await using host = await createStorageHost({ plugins: [health] })
console.log(host.extensions.status())
```

Ordinary plugins can expose application extensions without pretending to provide a storage backend. They retain PluginHost's original Feature dependency protocol. Backend plugins additionally declare an authentic kind token and register one admitted store.

`host.api[id]` exposes that published backend's original `store.api`; different instances may use the same method names. Each read returns a frozen backend-id snapshot, so later `use` batches do not change a saved snapshot and failed batches publish no ids. Methods retain the original Feature lifetime guard, including extracted methods after disposal.

Keep native connections private. `featureExpose` contains own enumerable string-keyed functions, including `getClient`; additional transaction-aware backends supply `getTransactionClient(scope)` through the original transaction owner. The host reserves `getKind`, `getStore`, `getBackendId`, `getLifecycle`, `onDispose` and `getScheduler`.

Register resources in the original install window through `core.onDispose`. Pass supported operations through `core.execution` before native I/O. Do not create a second transaction owner, middleware runner, capability table or Feature graph. `capabilityInstaller` returns the original port issued by `provideCapabilities`; genuine `implement(...)` records carry runtime authority.

Installation timeout applies to one entire batch. A late store that loses publication authority is disposed rather than published. A failed batch does not change previously published membership. Disposal seals admission immediately, waits for the original cleanup completion and preserves collected errors.

Schema and codec adapters live in `@migaia/storage-host/entity`: `passthrough`, `fromStandardSchema`, `jsonCodec`, `structuredCodec`, `binaryCodec` and `selectCodec`. Codec contracts remain owned by `@migaia/storage-contract`. The JSON route is named `json@1` and delegates to the portable JSON codec; undefined, nonfinite numbers and other unsupported values reject instead of being silently converted. Encoding and decoding errors carry host `SERIALIZE_FAILED` or `DESERIALIZE_FAILED`, with the contract and original codec failures on cause. Structured and binary identity codecs retain their original references; binary output can use explicit base64 routing on text backends.

The entity entry also owns the existing `REPOSITORY_KEY_PREFIX` and `repositoryMigrationKey(entityName)` layout markers shared by repositories and backend raw-record firewalls. Their persisted strings remain unchanged.

`host.hooks.on(name, listener)` and constructor `hooks` share one synchronous observation registry. Installed plugins use `core.hooks.on` during their original install window; the registration owns its unsubscribe handle. `core.emit(name, () => payload)` and the injected Feature `emit` evaluate a payload once only when listeners exist. Listener throws, hostile then getters and asynchronous rejection are reported without changing the storage result. Backend packages can augment the public `IStorageHookMap` interface.

Use `core.stageBindings` inside the backend constructor to bind its real store before `registerStore`. The seven observer families remain observation-only. Host methods such as `codecStages(store)` and `transactionStages(store)` accept only an exact store published by that host; transaction projections validate the original transaction owner. Bindings created before listeners still observe later registration and cancellation.

Register environment checks through `core.registerDetect(check)` or the injected Feature function during the original installation window. Checks run in plugin installation and registration order, using the original registration cancellation signal. `createStorageHost` completes them before returning by default; failure retains the original error and releases constructed resources in reverse order. With `autoDetect: false`, explicitly call `await host.detect()`. Until it succeeds, real execution endpoints reject with contract `UNSUPPORTED_CAPABILITY` before business I/O and never run implicit probes. Concurrent `detect()` calls share one Promise. Success is cached, failure can be retried, and a newly installed plugin batch requires explicit detection of its new registrations. The original resource scope drains checks already running during closure.

`createOrgId()` generates a lowercase UUID through the host's original `crypto.randomUUID()`. The `org` option is validated by the contract and captured before plugins run, defaulting to the zero UUID. Observation payloads use this immutable default organization identity.

`host.envelopeStages(store, { operation, targetVersion })` binds an exact published store and captures immutable operation metadata. Pass its `observe` directly to the contract `migrateEnvelope` or `migrateEnvelopeSync`; the other callbacks observe the original envelope checks and migration completion. It executes no migration, retains no state, preserves an unknown version as undefined, and only reports listener failure.

Backend authors consume finite shared functions and `IBackendChangeController` types from `@migaia/storage-host/authoring/backend`. Call `core.createChangeController(options)` and `core.registerChangeController(store, controller)` only during the original installation window: construct, admit through `registerStore`, then register that exact store controller. The original scope rolls back partial construction; the controller retains its original mutation leases, event queue and idempotent cleanup Promise. Features use the injected `getChangeController()` to read their own store controller, returning undefined when none is registered. Authors cannot replace this getter.

`/authoring/backend` also provides the original flat-key encoding/decoding, range snapshots/comparisons, JSON byte budgets and opaque-token functions. Import pure key and context validation directly from the contract. `resolveStorageNamespace(configured)` validates and returns the original target; the three-argument form `resolveStorageNamespace(configured, orgId, defaultOrgId)` preserves each instance prefix: the default organization uses configured; other organizations use `configured + "/" + orgId`. A configured value ending in `/` plus a canonical UUID rejects with contract `INVALID_ARGUMENT`; a bare UUID is allowed. Empty values and configuration defaults remain owned by each backend.

Opaque tokens retain their original format and conditional fallback. Native entropy failures reject with contract `UNSUPPORTED_CAPABILITY`, retaining the original error as cause.

`planChannelWrite` and `collectUniqueIndexOwners` share channel-conflict and unique-index rules; each backend supplies only its own error constructors. `normalizeError`, `isStorageErrorFamily` and `invokeExtension` preserve real error objects, original causes and extension context. Cancellation and timeout helpers reuse the original utils signal path and send cleanup failures to the existing operation reporter.

`observeStorageBatch(stages, scheduler, operation, count, invoke)` shares the original batch-observation algorithm. Admit the operation through the original store/scope before supplying its actual operation stages and host scheduler. The helper invokes native work once and emits one before/after or before/error pair; elapsed time includes the original pipeline and native settlement. Before/error count is the input entry count; after uses a numeric result as the actual count, otherwise the input count. Rejection preserves the original error object. The helper owns no pipeline, transaction or close authority; callers return empty batches directly after admission.

`core.getPublishedBackend(id)` and the Feature port borrow only backends committed by an earlier batch, during the original installation window. Current-batch, future and unknown IDs reject with `BACKEND_NOT_INSTALLED`. Borrowed views expose neither `dispose` nor the async-disposal symbol, and releasing a consumer never closes its dependencies. Business methods retain their original receiver, Promise and registration admission. `has`/`use` read the same contract capability table, including valid frozen or unprovided bases, and observe later capability publication and release immediately.

Backend core `createKeyLockPort()` constructs the shared local key-lock port only during the original installation window; `/authoring/backend` exports only its `IBackendKeyLockPort` type. `attempt(ctx, holder, native, stages?, admissionSignal?, ranges?)` consumes original contract identities and attempt ordinals: try first, enter the existing utils FIFO only after a wait decision, and retain locks through actual native commit, rollback and cleanup. `inspectLocks()` returns detached snapshots in canonical order. The physical backend closure owns the port and disposes it after its final reference; the creating plugin never automatically closes a shared port. Disposal seals admission and drains actual work, with distinct cached primary and symbolic cleanup Promises. Optional ranges enables the same FIFO protection for async root points and ranges; an empty array protects points only. Optimistic roots wait for existing pessimistic holders, while omission preserves original transaction behavior.

`probe(identities, ranges?, current?)` probes canonical identities directly in the same original lock table, returning the first detached `ILockHolding` or undefined. Point probes use at most three fixed channel Map.get calls; ranges inspect only active locks in the selected channel. Range entries contain `{channel,lower,upper}`, with bounds from contract `snapshotConcurrencyLockRange`. `attemptWrite(ctx,holder,write,stages?,admissionSignal?,ranges?,admit?)` shares the original attempt and FIFO. Its native write callback is synchronous, so the final lock check and mutation occupy one uninterrupted turn. Optimistic root writes create no lock row while respecting existing pessimistic protection. Waiting or observation callbacks require a final recheck excluding this attempt's own lease; no range locks are created. Optional current must be an original live attempt context; only entries of its actual held lease are excluded while other holders remain visible. Declared keys or matching owner text grant no exemption. Optional admit(commit) connects existing physical admission after logical keys; commit runs at most once and rechecks both operation and member signals. The original lease remains held until real physical cleanup settles.

`core.registerValueCommit(store, commit)` accepts the exact handed-off store only during its original installation window. `/authoring/backend` exports `IBackendValueCommit`, which receives fixed `{prefix,expected,key,value}` plus optional write context; expected contains the raw string key/value snapshot. Entity borrows this endpoint after asynchronous schema, codec and projection preparation. The native backend compares and writes in one uninterrupted turn inside its existing physical admission. Controller, envelope observation and this endpoint share one internal row, released by the original scope; entity receives no registration or closure authority. When multiple hosts admit the same frozen or raw store, envelope boundaries fan out to its still-registered original observers. Release removes only that host binding; one host keeps its original observer endpoint.

The controller exposes its original `closingSignal`. Pass it as the optional admission signal so direct member disposal removes only that member’s queued request; it never closes a shared provider or releases an already running native attempt.

The original backend installation core exposes the captured host default identity as readonly `defaultOrgId`. `createRevisionPort()` creates local revision facts during that same installation window. One physical data universe shares this object; `read/write/epoch/clear` use the existing text/bytes/record channels and backend-captured key identities. Advance revisions only after native commit succeeds. Clear drops tombstones and advances the channel epoch so older snapshots cannot pass an ABA check. This port owns no resources or closure authority over other members.

The host root exports `memoryBackendPlugin()` and `memoryBackendKind`. Each installation owns isolated memory data, including when namespaces match. Text, bytes and record transactions reuse the original transaction owner, concurrency policy and local locks. `scope.use(kv)` exposes eight text operations on that same transaction; `scope.use(records)` executes queries through its actual record cursor. A configured owner.label is captured once; defaults use runtime and pid, or browser. The native client getter returns undefined; the transaction client checks the original scope and returns undefined. Pass selected Feature roots as the separate final argument: `memoryBackendPlugin(options, features)`. Use undefined to omit options; the default id remains memory.

Memory root asynchronous `set/setBytes/putRecord/remove/removeBytes/deleteRecord`, clears and record prefix deletion share the original concurrency policy and one operation budget; ctx.concurrency overrides the original default. Replacement protects the target and every potentially displaced channel in canonical order. Synchronous set/remove/clearValues probe active locks directly and immediately throw LOCK_REJECTED when busy, without executing asynchronous policies. Clears and prefix deletion inspect only the affected channels; final checks and native data/revision changes have no await gap. Keys and mutable payloads are captured before waiting. Reads acquire no write locks; concurrency policy does not change ConflictPolicy duplicate/replacement rules.

```ts
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { records } from '@migaia/storage-contract'

type Order = { state: string; total: number }
await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const memory = host.backend('memory')
await memory.transaction(async (tx) => {
  await tx.set('status', 'ready')
  await tx.setBytes('receipt', new Uint8Array([1, 2]))
  await tx.putRecord({ state: 'paid', total: 20 }, 'order-1')
})
console.log(await memory.use(records).query<Order>().where({ state: 'paid' }).select('total').all())
```

Memory root `getMany`, `setMany`, `removeMany` and `removeByPrefix` are also available through `use(kv)`. Batch structural keys share the original text-channel identity; string writes remain readable through single-key and sync methods. Nonempty write batches commit once through the original transaction draft, and failure leaves no earlier items behind. Duplicate write keys reject before opening the transaction; repeated removals count once. Each high-level call enters one pipeline and one operation observation pair. Empty batches enter neither a pipeline nor a new transaction; prefix deletion uses the existing radix range.

Record where/select/all reuse the contract query core; this memory source honestly declares client execution. Transaction text batches support canonical structural keys, prefixes and validated ttlMs durations. Failure discards the draft, while commit checks key revisions and clear epochs before publishing committed batches. Closing the resource cancels this instance queued lock admission and drains accepted native transactions through actual settlement.

Native ranges, transaction drafts and prefix deletion reuse one package-private compressed radix implementation. Hash maps retain point lookups; ranges localize their bounds and merge only matching draft candidates, with tombstones masking physical entries. The tree maintains extrema and adjacent leaves without query-time full sorting. Text and records retain independent index instances.

The /entity registerRecordIndexBackfillStore entry registers only the backfill provider captured by the original backend factory. RecordIndexBackfillPhase retains the persisted canonical/legacy values. Native backends mark their existing coded contention error with markRecordIndexBackfillContentionFailure without replacing it. Sessions, checkpoints and actual native transactions stay with the backend; entity orchestration uses the same original private table.

The original backend scope factory calls `core.createTransactionApi(scope)` before freezing that same view; no selected transaction methods returns undefined. Selected methods enter original `runTransactionOperation` admission, draining and first-failure handling before execution and the lazy client getter for its current scope. Expired methods preserve the original backend transaction error. `core.getChainMethods(family)` supplies selected methods to the original query/builder creators; derived branches retain the same method references and original this. Pure fluent configuration stays synchronous and does not enter intervention; actual I/O terminals enter the original runner. Built-in and duplicate names reject before capability publication.

Memory root operations wrap the complete pipeline inside the original concurrency budget. Intervention fixes input once and its terminal invokes the sole original loop, so `await next()` still observes actual mutation and failure. Stage waits count toward the same deadline; cancellation starts neither derived locks nor native writes. Transaction loops remain outside the pipeline and reenter it for each actual attempt, including callback replay after commit conflicts.

`defineEntity` is available from `@migaia/storage-host/entity`. Record repositories compose through the original `repo.in(scope)` view and `repo.batch` uses one native transaction. Schema, codec and migration work borrows that transaction's original signal. Unique constraints validate the final draft; swaps and delete/reuse remain atomic. A cached index handle is used only after the current native scope confirms readiness; otherwise the same scope scans without building indexes.

Entity archives use `{version, state}` and the shared immutable migration plan. Invalid archives and invalid encoded states keep host `DESERIALIZE_FAILED`/`SERIALIZE_FAILED`, with contract `ENVELOPE_INVALID` as first cause. Unsupported versions and failed migration steps keep the host code with the original contract failure on cause. Legacy `{__v,data}` is not accepted. Comparators require a finite limit and use the shared bounded heap; streams expose the actual disposable iterator.

Entity queries use the shared immutable core: `repo.query().index(name, keyOrRange).where(...).select(...).all()` replaces `findManyBy`; use `.stream()` in place of `streamBy`. Root and transaction queries preserve installed query Feature methods. Object and field conditions execute on the client for this source; explicit indexed queries retain native index preparation or the authoritative fallback. Comparator queries require a finite bound and retain only the selected candidates in the original heap. Transaction queries inherit the original signal and deadline; their terminals accept no separate context.

```ts
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'

await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
const memory = host.backend('memory')
const orders = defineEntity<{ id: string; state: string; total: number }>()({
  name: 'orders',
  key: 'id',
  indexes: { byState: { path: 'state' } }
}).connect(memory)
const paid = await orders
  .query()
  .index('byState', 'paid')
  .where('total', 'gt', 100)
  .orderByComparator((left, right) => right.total - left.total)
  .limit(20)
  .select('id', 'total')
  .all()
await using stream = orders.query().limit(20).stream()
for await (const order of stream) console.log(order)
await memory.transaction(async (tx) => {
  await orders.in(tx).put({ id: 'next', state: 'paid', total: 200 })
  console.log(await orders.in(tx).query().where({ state: 'paid' }).select('id').all())
})
```

`connect(store, {codecStages, queryStages})` accepts the corresponding original host stage ports. Codec observations surround each actual conversion. Each query `all` and each stream `next` observes the actual operation; stream counts accumulate, and pauses between advances do not count toward elapsed execution time. Observers never delay or veto storage work; synchronous failures and late rejections go to the existing reporter.

Unique writes on a custom value-only backend require record transactions or an atomic value commit endpoint; a sync channel alone does not provide that atomic endpoint. Without either, only that unique-write combination rejects `UNSUPPORTED_CAPABILITY` before modification; ordinary KV writes continue to work. During the original backend installation, call `core.registerStore(store)` before `core.registerValueCommit(store, commit)`. The `IBackendValueCommit` type is exported from `@migaia/storage-host/authoring/backend`: `commit({prefix, expected, key, value}, ctx?)` returns `Promise<void>`. `expected` is the captured array of raw `[key,value]` pairs under `prefix`. After all asynchronous schema and codec preparation, the backend must atomically compare that exact prefix snapshot and write `key/value`, with no await gap between comparison and mutation; changed snapshots reject `WRITE_CONFLICT` without modifying data. The endpoint borrows the original native store and adds no resource or close authority.

Memory publishes native `ttl` and `counter` capabilities. `expire`, `remaining` and `persist` address the existing text, bytes or record channel; canonical structured text keys share batch identity. Durations are finite and nonnegative, with zero expiring immediately. Lazy expiry applies equally to sync and async reads, enumeration and cross-channel conflict checks. Overwriting a live row preserves its deadline; delete, clear and replacement remove the old channel deadline. `setMany` accepts `ttlMs` in the same atomic draft. Transaction reads retain their first value and deadline, and commit detects expiry of an observed row through the existing revision checks.

`store.use(counter).increment('visits', 1)` atomically updates canonical decimal text in the same original single-key mutation. Missing text starts at zero; malformed decimals, unsafe deltas and overflow reject `INVALID_ARGUMENT` without writing. `tx.use(ttl)` and `tx.use(counter)` use the current native draft and original transaction budget.
