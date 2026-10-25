# storage-contract usage guide

Import types, tokens, definitions, errors and pure validators from `@migaia/storage-contract`. Input retention, query execution and resources use the [host entry table](./README.en.md#entries-and-dependency-direction).

## Validate a key without copying

```ts
import { assertStorageKey, type IStorageKey } from '@migaia/storage-contract'

const input: unknown = ['orders', new Date(0)]
assertStorageKey(input, 'memory')
const key: IStorageKey = input
console.log((key as [string, Date])[1].getTime()) // 0
```

Validation opens no store and copies no key. When asynchronous writes retain caller data, the original host authoring helper detaches mutable components:

```ts
import { snapshotStorageKey } from '@migaia/storage-host/authoring/key'

const input = ['orders', new Date(0)] as const
const saved = snapshotStorageKey(input, 'memory') as [string, Date]
input[1].setTime(1000)
console.log(saved[1].getTime()) // 0
```

Synchronous validation with no asynchronous or public ownership boundary borrows the original input.

## Validate operation intent

```ts
import { assertOperationContext, assertSyncWriteOptions } from '@migaia/storage-contract'

assertOperationContext({ timeoutMs: 0, pageSize: 100 })
assertSyncWriteOptions({ conflictPolicy: 'replace' })
```

These functions execute no cancellation, timers or writes. Invalid fields retain `INVALID_ARGUMENT`; omission supplies no backend default. Structurally valid aborted signals remain valid inputs.

```ts
import { snapshotOperationContext } from '@migaia/storage-host/authoring/context'

const controller = new AbortController()
const options = { signal: controller.signal, timeoutMs: 10 }
const captured = snapshotOperationContext(options)!
options.timeoutMs = 20
controller.abort()
console.log(captured.timeoutMs, captured.signal === controller.signal) // 10 true
console.log(captured.signal?.aborted) // true
```

Snapshots support later real awaits. They are not frozen, do not promise repeated-call identity, and specify no accessor read count. Reuse a context already captured by its backend owner.

## Inspect capabilities without acquiring a resource

```ts
import { isStorageCapabilities, type IStorageCapabilities } from '@migaia/storage-contract'

const facts: IStorageCapabilities = {
  syncRead: false,
  binary: false,
  records: false,
  transactions: false,
  iteration: false,
  secondaryIndexes: false,
  changeFeed: false,
  maxValueBytes: undefined,
  opaqueEntries: false
}
console.log(isStorageCapabilities(facts)) // true
```

Omitted `batch` means no complete batch-write support; shared conformance marks that group not applicable. Pure shape guards do not normalize copies. Host `/authoring/store` supplies `snapshotStorageCapabilities` when deferred admission must retain those facts.

## Define a token and implementation

```ts
import { defineStorageCapability, implement, isCapabilityToken } from '@migaia/storage-contract'

const status = defineStorageCapability<{ readStatus(): string }>()('status')
const api = { readStatus: () => 'ready' }
const definition = implement(status, api)
console.log(isCapabilityToken(status), typeof definition) // true object
```

This creates no published store. Host `/authoring/capability` owns publication and has/use. A token's name never substitutes for the original identity. Resource and cleanup examples remain in the [host guide](../storage-host/USEGUIDE.en.md).

## Codec receiver ownership

`assertCodec(codec)` checks the public shape of an ordinary object or legitimate class. Host `/authoring/codec` owns `snapshotCodec`: it validates and borrows the same original instance. It does not copy `{name, output, encode, decode}`, so methods using `#private` state retain their receiver. Invoke `codec.encode(value)` and `codec.decode(raw)` directly. `fromValueCodec` remains the format adapter on that same entry.

## Original errors and progress

```ts
import { StorageContractError, StorageContractErrorCode } from '@migaia/storage-contract'

const cause = new TypeError('example invalid input')
const error = new StorageContractError(StorageContractErrorCode.invalidArgument, {
  backend: 'memory',
  cause
})
console.log(error.source, error.code, error.cause === cause)
// @migaia/storage-contract INVALID_ARGUMENT true
```

Existing error instances remain frozen; original cause and stack survive. Archive migration reports progress through its existing `onArchiveRunError` hook rather than adding state to errors.

## Backend conformance

Import `runConformance` from `@migaia/storage-contract/conformance`. Supply the consumer's existing describe/it/expect and optional skip, fresh fixtures, actual token list and capability facts. Groups execute public operations and clean each fixture. They install no extra runner and infer no unlisted capability from a backend name. The entry exports the exact `IConformanceHarness` and `IConformanceSubject` types.
