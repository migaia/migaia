# @migaia/storage-host

Runtime-neutral storage installation and typed backend authoring. The host owns one PluginHost lifecycle, atomic install batches, exact backend lookup and cleanup. Browser adapters and database clients stay outside this package.

```ts
import { createStorageHost, definePlugin } from '@migaia/storage-host'

const labels = definePlugin('labels', () => ({
  install: () => ({ label: (name: string) => name.toUpperCase() })
}))
await using host = await createStorageHost({ plugins: [labels] })
console.log(host.extensions.label('draft'))
```

A backend descriptor supplies its exact `kind`, a lazy function-only `featureExpose`, an installation hook and, when it supports Feature capabilities, its original provider's `capabilityInstaller`. Create its kind with `defineStorageBackendKind<Store, Client, ExtraExpose>()('name')`. Register the fully constructed store once during installation. The host takes responsibility for rollback and final disposal after admission.

Backend Features use `defineFeature(kind, factory, dependencies?)`. Their synchronous factory returns `capabilities`, `chain` and `api`; API methods belong to the `store` or `transaction` group. Only selected root outputs are published. Dependencies provide original construction outputs and do not become services automatically. Feature getters remain lazy because factories run before backend installation.

`core.execution.run` and `runSync` forward operations to the same original middleware owner. Storage fixes the host mode to async. An async stage makes a synchronous operation reject with `ASYNC_STAGE_IN_SYNC_ENTRY` before the stage or terminal runs. A stage that intercepts an operation without reaching its terminal produces the existing storage-contract `ABORTED` error. With no stages, the backend's actual value or Promise stays unchanged.

`host.backend(id)` returns the admitted object. `host.backends()` returns a detached map. `host.use(...)` publishes one complete batch; overlapping batches reject with `STORAGE_HOST_BUSY`. Host failures carry source `@migaia/storage-host` and retain their original causes.

Call `dispose()` to observe cleanup failure. Repeated explicit calls share one Promise. Resource syntax uses a separate cached Promise that reports cleanup failure and resolves, so cleanup cannot replace an outer failure. Both entries perform one actual cleanup. The host closes its own registrations and admitted stores, not externally borrowed clients.

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

`core.getPublishedBackend(id)` and the Feature port borrow only backends committed by an earlier batch, during the original installation window. Current-batch, future and unknown IDs reject with `BACKEND_NOT_INSTALLED`. Borrowed views expose neither `dispose` nor the async-disposal symbol, and releasing a consumer never closes its dependencies. Business methods retain their original receiver, Promise and registration admission. `has`/`use` read the same contract capability table, including valid frozen or unprovided bases, and observe later capability publication and release immediately.

Backend core `createKeyLockPort()` constructs the shared local key-lock port only during the original installation window; `/authoring/backend` exports only its `IBackendKeyLockPort` type. `attempt(ctx, holder, native, stages?, admissionSignal?)` consumes original contract identities and attempt ordinals: try first, enter the existing utils FIFO only after a wait decision, and retain locks through actual native commit, rollback and cleanup. `inspectLocks()` returns detached snapshots in canonical order. The physical backend closure owns the port and disposes it after its final reference; the creating plugin never automatically closes a shared port. Disposal seals admission and drains actual work, with distinct cached primary and symbolic cleanup Promises.

`probe(identities, ranges?, current?)` probes canonical identities directly in the same original lock table, returning the first detached `ILockHolding` or undefined. Point probes use at most three fixed channel Map.get calls; ranges inspect only active locks in the selected channel. Range entries contain `{channel,lower,upper}`, with bounds from contract `snapshotConcurrencyLockRange`. `attemptWrite(ctx,holder,write,stages?,admissionSignal?,ranges?,admit?)` shares the original attempt and FIFO. Its native write callback is synchronous, so the final lock check and mutation occupy one uninterrupted turn. Optimistic root writes create no lock row while respecting existing pessimistic protection. Waiting or observation callbacks require a final recheck excluding this attempt's own lease; no range locks are created. Optional current must be an original live attempt context; only entries of its actual held lease are excluded while other holders remain visible. Declared keys or matching owner text grant no exemption. Optional admit(commit) connects existing physical admission after logical keys; commit runs at most once and rechecks both operation and member signals. The original lease remains held until real physical cleanup settles.

The controller exposes its original `closingSignal`. Pass it as the optional admission signal so direct member disposal removes only that member’s queued request; it never closes a shared provider or releases an already running native attempt.

The original backend installation core exposes the captured host default identity as readonly `defaultOrgId`. `createRevisionPort()` creates local revision facts during that same installation window. One physical data universe shares this object; `read/write/epoch/clear` use the existing text/bytes/record channels and backend-captured key identities. Advance revisions only after native commit succeeds. Clear drops tombstones and advances the channel epoch so older snapshots cannot pass an ABA check. This port owns no resources or closure authority over other members.

The host root exports `memoryBackendPlugin()` and `memoryBackendKind`. Each installation owns isolated memory data, including when namespaces match. Text, bytes and record transactions reuse the original transaction owner, concurrency policy and local locks. `scope.use(kv)` exposes eight text operations on that same transaction; `scope.use(records)` executes queries through its actual record cursor. A configured owner.label is captured once; defaults use runtime and pid, or browser. The native client getter returns undefined; the transaction client checks the original scope and returns undefined.

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

Record where/select/all reuse the contract query core; this memory source honestly declares client execution. Transaction text batches support canonical structural keys and prefixes; explicit ttlMs currently rejects with UNSUPPORTED_CAPABILITY. Failure discards the draft, while commit checks key revisions and clear epochs before publishing committed batches. Closing the resource cancels this instance queued lock admission and drains accepted native transactions through actual settlement.

Native ranges, transaction drafts and prefix deletion reuse one package-private compressed radix implementation. Hash maps retain point lookups; ranges localize their bounds and merge only matching draft candidates, with tombstones masking physical entries. The tree maintains extrema and adjacent leaves without query-time full sorting. Text and records retain independent index instances.

The /entity registerRecordIndexBackfillStore entry registers only the backfill provider captured by the original backend factory. RecordIndexBackfillPhase retains the persisted canonical/legacy values. Native backends mark their existing coded contention error with markRecordIndexBackfillContentionFailure without replacing it. Sessions, checkpoints and actual native transactions stay with the backend; entity orchestration uses the same original private table.

The original backend scope factory calls `core.createTransactionApi(scope)` before freezing that same view; no selected transaction methods returns undefined. Selected methods enter original `runTransactionOperation` admission, draining and first-failure handling before execution and the lazy client getter for its current scope. Expired methods preserve the original backend transaction error. `core.getChainMethods(family)` supplies selected methods to the original query/builder creators; derived branches retain the same method references and original this. Fluent configuration stays synchronous and refuses asynchronous intervention through the original sync boundary. Built-in and duplicate names reject before capability publication.
