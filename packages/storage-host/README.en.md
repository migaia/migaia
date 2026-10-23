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
