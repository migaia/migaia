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

Keep native connections private. `featureExpose` contains own enumerable string-keyed functions, including `getClient`; additional transaction-aware backends supply `getTransactionClient(scope)` through the original transaction owner. The host reserves `getKind`, `getStore`, `getBackendId`, `getLifecycle`, `onDispose` and `getScheduler`.

Register resources in the original install window through `core.onDispose`. Pass supported operations through `core.execution` before native I/O. Do not create a second transaction owner, middleware runner, capability table or Feature graph. `capabilityInstaller` returns the original port issued by `provideCapabilities`; genuine `implement(...)` records carry runtime authority.

Installation timeout applies to one entire batch. A late store that loses publication authority is disposed rather than published. A failed batch does not change previously published membership. Disposal seals admission immediately, waits for the original cleanup completion and preserves collected errors.

Schema and codec adapters live in `@migaia/storage-host/entity`: `passthrough`, `fromStandardSchema`, `jsonCodec`, `structuredCodec`, `binaryCodec` and `selectCodec`. Codec contracts remain owned by `@migaia/storage-contract`. The JSON route is named `json@1` and delegates to the portable JSON codec; undefined, nonfinite numbers and other unsupported values reject instead of being silently converted. Encoding and decoding errors carry host `SERIALIZE_FAILED` or `DESERIALIZE_FAILED`, with the contract and original codec failures on cause. Structured and binary identity codecs retain their original references; binary output can use explicit base64 routing on text backends.

The entity entry also owns the existing `REPOSITORY_KEY_PREFIX` and `repositoryMigrationKey(entityName)` layout markers shared by repositories and backend raw-record firewalls. Their persisted strings remain unchanged.

`host.hooks.on(name, listener)` and constructor `hooks` share one synchronous observation registry. Installed plugins use `core.hooks.on` during their original install window; the registration owns its unsubscribe handle. `core.emit(name, () => payload)` and the injected Feature `emit` evaluate a payload once only when listeners exist. Listener throws, hostile then getters and asynchronous rejection are reported without changing the storage result. Backend packages can augment the public `IStorageHookMap` interface.

Use `core.stageBindings` inside the backend constructor to bind its real store before `registerStore`. The seven observer families remain observation-only. Host methods such as `codecStages(store)` and `transactionStages(store)` accept only an exact store published by that host; transaction projections validate the original transaction owner. Bindings created before listeners still observe later registration and cancellation.

Register environment checks through `core.registerDetect(check)` or the injected Feature function during the original installation window. Checks run in plugin installation and registration order, using the original registration cancellation signal. `createStorageHost` completes them before returning by default; failure retains the original error and releases constructed resources in reverse order. With `autoDetect: false`, explicitly call `await host.detect()`. Until it succeeds, real execution endpoints reject with contract `UNSUPPORTED_CAPABILITY` before business I/O and never run implicit probes. Concurrent `detect()` calls share one Promise. Success is cached, failure can be retried, and a newly installed plugin batch requires explicit detection of its new registrations. The original resource scope drains checks already running during closure.

`createOrgId()` generates a lowercase UUID through the host's original `crypto.randomUUID()`. The `org` option is validated by the contract and captured before plugins run, defaulting to the zero UUID. Observation payloads use this immutable default organization identity.
