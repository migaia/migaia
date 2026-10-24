# @migaia/storage-contract

Runtime-neutral storage contracts. The root owns types, capability tokens/definitions, errors, enum-like constants and pure validators. Execution, resources and authoring snapshots belong to `@migaia/storage-host/authoring/*`. This package does not depend on host, browser storage or database clients.

## Entries and dependency direction

- `@migaia/storage-contract`: storage, codec, context, query and transaction types; standard tokens; definition identity; pure validation.
- `@migaia/storage-contract/conformance`: backend contract groups run by the consumer's existing runner. It supplies no runner and imports no host runtime.
- Host and backends depend inward on this package. Runtime authoring APIs use the entries below; the root retains no old runtime re-export or compatibility alias.

| Host entry suffix                      | Existing responsibility                                                |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `/authoring/capability`                | Publication, original store has/use, transaction implementation lookup |
| `/authoring/query`                     | Record/vector/RDF queries, condition compilation and snapshots         |
| `/authoring/concurrency`               | Policies, lock factories, the concurrency loop and lock snapshots      |
| `/authoring/transaction`               | Transaction owner, builder, execution and iterator derivation          |
| `/authoring/key`                       | Key copies, ordered/organization encoding and batch capture/projection |
| `/authoring/context`                   | Operation and reduced sync-write snapshots                             |
| `/authoring/store`                     | Store admission and capability descriptor snapshots                    |
| `/authoring/resource`                  | Original iterator lifetime                                             |
| `/authoring/sql`, `/authoring/sparql`  | Fragments, native tags and terminal binding                            |
| `/authoring/rdf`                       | Term factories, snapshots, encoding and organization graphs            |
| `/authoring/vector`                    | Vector input snapshots and recommendation synthesis                    |
| `/authoring/ttl`, `/authoring/counter` | Original scalar input helpers                                          |
| `/authoring/blob`                      | Input snapshots, upload readers and object resources                   |
| `/authoring/codec`                     | Value-codec adapter and original codec admission                       |
| `/authoring/migration`                 | Migration plans, execution and envelope recovery                       |

All these entries belong to `@migaia/storage-host`. `/authoring/backend` retains its finite backend ports. Shared template capture remains a private SQL/SPARQL module. See the [usage guide](./USEGUIDE.en.md) and [host guide](../storage-host/USEGUIDE.en.md).

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

`IStorageCapabilities.batch` declares complete KV batch writes and counted prefix deletion. Omission means unsupported, and shared conformance marks that group not applicable. Legacy omissions of secondaryIndexes/changeFeed pass pure shape admission; host descriptor snapshots normalize those two flags to false.

## Definition identity and original implementations

Custom and standard capability tokens plus `implement` stay here. Names are diagnostics; same-name tokens are not interchangeable. `readCapabilityTokenFacts` and `readStorageImplementation` inspect canonical definition identity without publication, callback execution or per-store state.

Host `/authoring/capability` owns publication, store has/use and transaction implementation lookup. It uses the same token and original API identity, including legitimate class receivers. Query, transaction, lock and iterator runtime state belongs only to host.

## Errors and accepted boundaries

`StorageContractError` retains source `@migaia/storage-contract`, its public code, original cause and stack, and extension details. No code was added or renamed. `INVALID_ARGUMENT` denotes argument shape, `INVALID_KEY` denotes the typed-key domain, and `UNSUPPORTED_CAPABILITY` denotes missing requested behavior. Runtime owners reuse the existing lifecycle, query, concurrency and migration codes.

Error instances retain their existing frozen behavior; cause objects are not frozen with them. Archive migration reports progress failures through the existing `onArchiveRunError` hook rather than modifying the frozen error. Codec admission does not clone or freeze: pure `assertCodec` validates, while host `snapshotCodec` returns the same admitted instance so class-private methods keep their receiver.

Ordinary store, option, query and snapshot records are not a freezing protocol. Host authors retain copies only where queued/native awaits or a public ownership boundary exposes mutable Date, bytes, array or RDF data. Public lock diagnostics detach keys from a still-active native lease.
