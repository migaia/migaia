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
