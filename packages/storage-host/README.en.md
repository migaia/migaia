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

`/authoring/backend` also provides the original flat-key encoding/decoding, range snapshots/comparisons, JSON byte budgets and opaque-token functions. Import pure key and context validation directly from the contract. `resolveStorageNamespace(configured, orgId, defaultOrgId)` preserves each instance prefix: the default organization uses configured; other organizations use `configured + "/" + orgId`. A configured value ending in `/` plus a canonical UUID rejects with contract `INVALID_ARGUMENT`; a bare UUID is allowed. Empty values and configuration defaults remain owned by each backend.

Opaque tokens retain their original format and conditional fallback. Native entropy failures reject with contract `UNSUPPORTED_CAPABILITY`, retaining the original error as cause.

`planChannelWrite` and `collectUniqueIndexOwners` share channel-conflict and unique-index rules; each backend supplies only its own error constructors. `normalizeError`, `isStorageErrorFamily` and `invokeExtension` preserve real error objects, original causes and extension context. Cancellation and timeout helpers reuse the original utils signal path and send cleanup failures to the existing operation reporter.

`core.getPublishedBackend(id)` and the Feature port borrow only backends committed by an earlier batch, during the original installation window. Current-batch, future and unknown IDs reject with `BACKEND_NOT_INSTALLED`. Borrowed views expose neither `dispose` nor the async-disposal symbol, and releasing a consumer never closes its dependencies. Business methods retain their original receiver, Promise and registration admission. `has`/`use` read the same contract capability table, including valid frozen or unprovided bases, and observe later capability publication and release immediately.

Backend core `createKeyLockPort()` constructs the shared local key-lock port only during the original installation window; `/authoring/backend` exports only its `IBackendKeyLockPort` type. `attempt(ctx, holder, native, stages?, admissionSignal?)` consumes original contract identities and attempt ordinals: try first, enter the existing utils FIFO only after a wait decision, and retain locks through actual native commit, rollback and cleanup. `inspectLocks()` returns detached snapshots in canonical order. The physical backend closure owns the port and disposes it after its final reference; the creating plugin never automatically closes a shared port. Disposal seals admission and drains actual work, with distinct cached primary and symbolic cleanup Promises.

The controller exposes its original `closingSignal`. Pass it as the optional admission signal so direct member disposal removes only that member’s queued request; it never closes a shared provider or releases an already running native attempt.
