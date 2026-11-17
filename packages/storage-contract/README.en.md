# @migaia/storage-contract

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

The contract shared by the storage family: interface types for key-value, records, queries, transactions, vectors, RDF and blobs, capability tokens, error types and pure validators. It performs no storage operation and does not depend on storage-host, browser storage or database clients.

**Applications usually do not start here**: to read and write data, start with [`@migaia/storage-host`](../storage-host/README.en.md) and get a store with `host.backend(name)`. You use this package directly when you:

- write generic storage code that depends only on interface types (such as `IKeyValueStore` or `IRecordStore`), without binding to a backend;
- check whether a store has a capability (`asRecordStore`, `asChangeFeedStore` and others), or branch on error codes with `source: 'storage.contract'`;
- implement your own backend and verify it with the contract cases in `/conformance`.

## Entries and dependency direction

- `@migaia/storage-contract`: storage, codec, context, query and transaction types; standard capability tokens; definition identity; pure validation.
- `@migaia/storage-contract/conformance`: backend contract case groups run by your existing test runner. It supplies no runner and imports no host runtime.
- Host and backends depend inward on this package. Runtime authoring tools for queries, transactions, locks and snapshots live in `@migaia/storage-host/sdk`; see [backend authoring entries in storage-host](../storage-host/README.en.md#backend-authoring-entries).

## Types and pure validators

`IStorageBase` describes backend, capabilities and the original cleanup surface. `IKeyValueStore` adds text operations; `IRecordStore` adds bytes, records, iteration and transactions. `ISyncKeyValueStore` describes a real synchronous text channel. Query, transaction, vector, RDF, blob, TTL, counter and durable-feed types remain here.

| Pure entry                                                                       | Behavior and failure                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `isStorageBase`, `isKeyValueStore`, `isRecordStore`                              | Check complete supported shapes and capability facts without copying or invoking native methods        |
| `asRecordStore`, `asSecondaryIndexRecordStore`, `asChangeFeedStore`              | Return the same original object; missing capability reports `UNSUPPORTED_CAPABILITY`                   |
| `isStorageCapabilities`                                                          | Checks boolean facts and optional nonnegative safe-integer `maxValueBytes`; never fills caller fields  |
| `assertStorageKey`, `assertStringStorageKey`                                     | Validate typed or string keys; retain `INVALID_KEY` / `INVALID_ARGUMENT` respectively                  |
| `assertOperationContext`, `assertSyncWriteOptions`                               | Validate fields without a snapshot, timer or abort subscription                                        |
| `assertCodec`                                                                    | Checks nonempty name, text/binary/structured output and callable encode/decode; performs no conversion |
| `assertStorageOrgId`, `assertLockKey`                                            | Validate canonical UUIDs and text/bytes/record/vector/RDF lock domains                                 |
| `assertStorageVectorCollection`, `assertStorageVector`, `assertStorageVectorIds` | Reuse schema, finite-component and dense-ID rules without input copies                                 |
| `assertStorageRdfTerm`, `assertStorageRdfPattern`, `assertStorageRdfQuad`        | Reuse lexical and positional rules; complete quads require all four positions                          |
| `assertStorageTtlTarget`, `assertStorageTtlDuration`                             | Reuse target and nonnegative-duration rules; RDF is not a TTL target                                   |
| `assertStorageBlobPut/Get/List`                                                  | Validate keys, bodies and option shapes without acquiring a reader                                     |
| `assertVersionedEnvelope`, `assertTransactionCallback`                           | Validate the original envelope or callback without executing migration or transaction work             |

Guards accept ordinary supported inputs. They promise no hostile getter, Proxy or thenable interception and no property-read count. Runtime owners retain native failure normalization, cancellation and actual operation outcomes.

## Keys, contexts and capability facts

`IStorageKey` accepts finite numbers, strings, valid Dates, ArrayBuffers and nonempty dense nested arrays of those values. Limits are depth 32, 4096 visited nodes and 1 MiB per binary component. Cycles, sparse/empty arrays and ordinary objects are invalid. Pure validation does not copy key data; use host key snapshots when asynchronous work retains mutable input.

`IOperationContext.timeoutMs` is a nonnegative safe integer and `pageSize` is an integer from 1 through 4096. Omission supplies no default. A structurally valid already-aborted `IAbortSignal` is accepted. Sync write options allow optional `conflictPolicy`, without non-undefined signal/timeoutMs.

`IStorageCapabilities.batch` declares complete KV batch writes and counted prefix deletion. Omission means unsupported, and shared conformance marks that group not applicable. Omitting `secondaryIndexes` or `changeFeed` also passes the guard; host snapshots treat both as false.

## Definition identity and original implementations

Custom and standard capability tokens plus `implement` stay here. Names are diagnostics; same-name tokens are not interchangeable. `readCapabilityTokenFacts` and `readStorageImplementation` inspect canonical definition identity without publication, callback execution or per-store state.

Host `/sdk` owns publication, store has/use and transaction implementation lookup. It uses the same token and original API identity, including legitimate class receivers. Query, transaction, lock and iterator runtime state belongs only to host.

## Errors and accepted boundaries

`StorageContractError` retains source `storage.contract`, its public code, original cause and stack, and extension details. `INVALID_ARGUMENT` denotes argument shape, `INVALID_KEY` denotes the typed-key domain, and `UNSUPPORTED_CAPABILITY` denotes missing requested behavior. Runtime owners reuse the existing lifecycle, query, concurrency and migration codes.

Error instances retain their existing frozen behavior; cause objects are not frozen with them. Archive migration reports progress failures through the existing `onArchiveRunError` hook rather than modifying the frozen error. Codec admission does not clone or freeze: pure `assertCodec` validates, while host `snapshotCodec` returns the same admitted instance so class-private methods keep their receiver.

Ordinary store, option, query and snapshot records are not a freezing protocol. Host authors retain copies only where queued/native awaits or a public ownership boundary exposes mutable Date, bytes, array or RDF data. Public lock diagnostics detach keys from a still-active native lease.

## Serialized byte order

The `@migaia/serialize` format encoders used by storage codecs emit fields in the object's own property enumeration order. Objects with equal fields and values but different insertion orders can produce different bytes, while the decoded fields and values are the same. Do not treat encoded bytes as a stable source for signature inputs or cache keys.

For recursive `Map` and `Set` values, use `defineCollectionsJsonCodec` from `@migaia/serialize/codecs/collections-json` and adapt it with `fromValueCodec` from `@migaia/storage-host/sdk`. Plain JSON does not encode collections automatically; writers and readers must use the same format. See the [serialize guide](../serialize/USEGUIDE.en.md).
