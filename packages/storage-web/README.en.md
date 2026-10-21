# `@migaia/storage-web`

Store browser or in-memory data through one capability contract, then add entities, migrations, indexes, and query refresh only where needed.

## You may have run into this

- Editing a local profile changes the saved version: storage retained mutable input and returned references.
- A failed batch removes another successful write: rollback restores an old whole-store image over concurrent results.
- Two repositories each consider an email available: uniqueness exists only in their separate local caches.
- Reading an upgraded record also changes persistence: materialization and migration commits share one operation.
- An old screen can still write after application shutdown: a registry collected instances without owning their cleanup.

## Why choose it

- **Keep edits to inputs and returned copies outside saved data.** The memory backend copies bytes and records at read/write boundaries, as shown in [Keep edits to inputs and returned copies out of stored data](./USEGUIDE.en.md#keep-edits-to-inputs-and-returned-copies-out-of-stored-data).
- **Discard a failed transaction without erasing independent commits.** Transactions drop only their isolated draft instead of restoring an old store image, as shown in [Discard a failed draft without erasing an unrelated write](./USEGUIDE.en.md#discard-a-failed-draft-without-erasing-an-unrelated-write).
- **Enforce uniqueness across repositories while permitting a valid transfer.** Entities validate constraints against the final transaction draft, as shown in [Transfer a unique value in one final transaction draft](./USEGUIDE.en.md#transfer-a-unique-value-in-one-final-transaction-draft).
- **Read the upgraded shape before deciding to persist it.** get materializes the current version while migrate explicitly commits it, as shown in [Preview an upgrade before explicitly saving its new version](./USEGUIDE.en.md#preview-an-upgrade-before-explicitly-saving-its-new-version).
- **Give one Host both the backend instances and their cleanup.** The Host owns plugin-created stores and releases them on disposal, as shown in [Own and close named backend instances together](./USEGUIDE.en.md#own-and-close-named-backend-instances-together).

## Start here

```ts doc-test=run
import { defineEntity } from '@migaia/storage-web/entity'
import { memoryStorageHost } from '@migaia/storage-web/memory'

type IRow = { id: string; name: string }
const store = memoryStorageHost()
const users = defineEntity<IRow>({ name: 'users', key: 'id' }).connect(store)
const teams = defineEntity<IRow>({ name: 'teams', key: 'id' }).connect(store)
try {
  await users.put({ id: '1', name: 'Ada' })
  await teams.put({ id: '1', name: 'Research' })
  console.log((await users.get('1'))?.name, (await teams.get('1'))?.name)
} finally {
  await store.dispose()
}
```

Output:

```text
Ada Research
```

Next: [transfer a unique value](./USEGUIDE.en.md#transfer-a-unique-value-in-one-final-transaction-draft) or [migrate existing records explicitly](./USEGUIDE.en.md#preview-an-upgrade-before-explicitly-saving-its-new-version).

## Pitfalls when writing it yourself

This native Map sketch addresses the same primary-key task and is displayed only, not executed; comments identify record-kind and reference hazards.

```ts doc-test=check
type IRow = { id: string; name: string }
const rows = new Map<string, IRow>()
function save(row: IRow) {
  rows.set(row.id, row) // Hazard: one global key space lets a team replace a user.
}
function read(id: string) {
  return rows.get(id) // Hazard: live references allow edits outside the write boundary.
}
void save
void read
```

## A three-minute mental model

Choose a backend by capability, define record kinds, and connect repositories; use a Host for shared installation/cleanup, then reactive plugins when queries need refresh.

| Term                | Meaning                                                | Tool                                                   |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| Value layer (L0)    | The common string-value interface                      | get / set; the primary local/session/cookie capability |
| Record layer (L1)   | Bytes, structured records, iteration, and transactions | memory / indexedDbHost; inspect capabilities           |
| Entity / repository | Record rules / those rules bound to a backend          | defineEntity → connect → get / put                     |
| Schema / codec      | Domain validation/conversion / stored representation   | schema and serialize entries                           |
| Host                | Owner of named backend instances and cleanup           | createStorageHost → backend(id) → dispose              |
| Live query          | Readonly state updated after requery hints             | Reactive plugin + Resource; inspect consistency        |

## Typical scenarios

| Scenario                                                    | How to combine                                          | Details                                                                                          |
| ----------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Keep edits to inputs and returned copies out of stored data | `memoryStorageHost → setBytes / putRecord → get`        | [Complete example](./USEGUIDE.en.md#keep-edits-to-inputs-and-returned-copies-out-of-stored-data) |
| Discard a failed draft without erasing an unrelated write   | `transaction → tx.put → discard draft`                  | [Complete example](./USEGUIDE.en.md#discard-a-failed-draft-without-erasing-an-unrelated-write)   |
| Reuse a primary key across separate record kinds            | `defineEntity × 2 → connect → put / get`                | [Complete example](./USEGUIDE.en.md#reuse-a-primary-key-across-separate-record-kinds)            |
| Transfer a unique value in one final transaction draft      | `indexes(unique) → put → batch → findBy`                | [Complete example](./USEGUIDE.en.md#transfer-a-unique-value-in-one-final-transaction-draft)      |
| Preview an upgrade before explicitly saving its new version | `version + migrations → get → migrate`                  | [Complete example](./USEGUIDE.en.md#preview-an-upgrade-before-explicitly-saving-its-new-version) |
| Own and close named backend instances together              | `memoryBackendPlugin × 2 → createStorageHost → dispose` | [Complete example](./USEGUIDE.en.md#own-and-close-named-backend-instances-together)              |

## Installation

```bash
pnpm add @migaia/storage-web
```

The Host scene imports an error type directly from storage-contract; install it explicitly as well:

```bash
pnpm add @migaia/storage-contract
```

## Essential APIs

| API                                | Purpose                                                     |
| ---------------------------------- | ----------------------------------------------------------- |
| `memoryStorageHost()`              | Create a separate volatile record backend                   |
| `localStorageHost / indexedDbHost` | Choose browser persistence and its capabilities             |
| `defineEntity(options)`            | Define record kinds, keys, migration, and indexes           |
| `repository.get / put / batch`     | Materialize, save, or transactionally update domain records |
| `createStorageHost(options?)`      | Install and close named backends together                   |
| `host.liveQuery(options)`          | Refresh query state through an admitted reactive plugin     |

## Contract details

### Layers, entries, and capabilities

This package implements browser/in-memory storage-contract backends with optional entities, schema, codecs, Hosts, and live queries. It is not a server database, cross-device replication service, or general state manager. Reactive changes are requery hints rather than a strong event stream for arbitrary raw writes. Dependencies are capability, event-subscriber, lifecycle, plugin-host, reactive, resource, storage-contract, and utils.

The root exposes only stable errors, error text, and namespace contracts. There are 22 export paths including the root and these subentries; unexported source directories are not application import points.

| Subentry                                                                         | Role                                                                 |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| memory / local-storage / session-storage / cookies / indexed-db                  | Five direct backends                                                 |
| host                                                                             | createStorageHost and StorageHostFacade                              |
| plugins/memory / local-storage / session-storage / cookies / indexed-db          | Exact backend plugin subentries                                      |
| entity / schema / serialize                                                      | Repositories, domain validation/migration, and stored representation |
| reactive-adapter                                                                 | Public Feature for a custom reactive source                          |
| plugins/reactive                                                                 | Shared reactive contracts                                            |
| plugins/reactive/memory / local-storage / session-storage / cookies / indexed-db | Five canonical reactive factories                                    |

Use the memory subentry for SSR, Node, or consumers without DOM type libraries. Falling back from browser persistence to volatile memory is an explicit application decision. Exact Host/plugin imports keep unselected backends out of that entry's dependency graph; final bundle output still depends on the bundler.

Import IKeyValueStore, IRecordStore, IStorageCapabilities, IOperationContext, IWriteOptions, StorageContractError, and its guards directly from storage-contract; this root does not re-export them. isRecordStore/asRecordStore take one store without options and inspect its known backend, capabilities, and complete value/record methods. Inspection failure makes the guard false; failed narrowing throws UNSUPPORTED_CAPABILITY.

| Backend         | syncRead | binary / records / transactions / iteration | secondaryIndexes | changeFeed                                      | maxValueBytes                  | opaqueEntries |
| --------------- | -------- | ------------------------------------------- | ---------------- | ----------------------------------------------- | ------------------------------ | ------------- |
| local / session | true     | All false                                   | false            | false                                           | 5 * 1024 * 1024, approximate   | false         |
| cookie          | true     | All false                                   | false            | false                                           | 4096 for the entire assignment | true          |
| indexeddb       | false    | All true                                    | true             | True only after origin coordination is admitted | undefined                      | false         |
| memory          | true     | All true                                    | false            | true                                            | undefined                      | false         |

Capabilities are distinct: records do not imply native indexes. Cookie visibility and browser quota have additional limits. IndexedDB has no sync API, while memory.sync exposes only the value layer.

### Common operations, keys, and commit

The value layer (L0) provides get/set/remove/has/keys/clearValues/clearAll/dispose. Missing get returns null, set requires a string without coercion, and remove is idempotent for absent keys. clearValues clears values; clearAll clears that store's channels/namespace rather than another namespace. Synchronous backends expose sync get/set/remove/has/keys/clearValues, without synchronous clearAll/dispose.

The record layer (L1) adds getBytes/setBytes/removeBytes/clearBytes, getRecord/putRecord/deleteRecord/clearRecords, iterateRecords, and transaction. Missing bytes return null and missing records undefined. putRecord(value,key?,ctx?) generates a key when omitted and returns the actual IStorageKey. metadata is optional get/set/delete support present only in IndexedDB; memory and value-only stores cannot persist cross-call migration checkpoints.

`removeBytes(key, ctx?)` deletes only this key from the byte channel and succeeds when it is missing; IndexedDB resolves after the transaction commits and publishes a change only when existing bytes were actually removed. `remove` deletes only the value channel and `deleteRecord` only the record channel; neither touches the other channels.

Operation signal/timeoutMs/pageSize are optional. Signal and timeout default to undefined, without an automatic deadline. timeoutMs is a non-negative safe integer; pageSize is an integer from 1 through 4096, with IndexedDB cursor pages defaulting to 128. The first cancellation/deadline ends waiting with contract ABORTED, without falsely reporting rollback after an atomic write commits. One iterator deadline covers its lifetime rather than resetting per page. Synchronous write options accept conflictPolicy, not defined signal/timeoutMs; Cookie additionally accepts expires/maxAge.

Values, bytes, and records share logical keys. ConflictPolicy defaults to conflict: writing another channel under the same key fails DUPLICATE_KEY with existingChannel/attemptedChannel. replace atomically removes other channels before writing. Updating the same channel is different from a cross-channel conflict.

IStorageKey supports strings, finite numbers, valid Dates, ArrayBuffers, and nonempty dense nested arrays without cycles, not Uint8Array keys. snapshotStorageKey validates and copies. Limits are depth 32 with root at zero, 4096 nodes, and 1 MiB per binary component. Ranges accept lower/upper/lowerOpen/upperOpen; openness must be boolean, and reversed or empty open ranges fail INVALID_ARGUMENT.

Change notifications follow commit. Synchronous/late listener failures and reporter failures remain reported while fanout continues; they do not turn a committed write into failure. Do not repeat a business write because notification failed. Backend disposal seals admission, waits for admitted mutations, then finalizes subscriptions/connections/transports. Repeated calls share the original Promise. Finalization errors propagate or are normalized by the particular backend, including BACKEND_DISPOSE_FAILED, rather than being silently swallowed. Persistent data remains after disposal; volatile memory data is discarded.

### Web Storage and namespaces

localStorageHost(options?) and sessionStorageHost(options?) share behavior, defaulting storage to globalThis.localStorage/sessionStorage respectively. Options default to {}, namespace to nonempty 'default', and namespaceCodec to lengthPrefixedNamespaceCodec. A real structural storage port may be injected.

The port needs getItem/setItem/removeItem/key/clear and a non-negative safe-integer length. Reading explicit options.storage or an invalid descriptor fails INVALID_CONFIG. An ambient localStorage/sessionStorage getter failure becomes BACKEND_UNAVAILABLE with the original cause; explicit injection does not read that getter.

Construction actually writes and removes/restores a probe key. An existing nonempty probe key causes a different temporary key to be used rather than overwritten. A present host that refuses writes still fails BACKEND_UNAVAILABLE immediately. Quota exceptions become QUOTA_EXCEEDED; other host-access failures become BACKEND_UNAVAILABLE. The 5 MiB capability is approximate, not a browser quota guarantee.

keys validates length, physical-key types, and duplicates, retaining internal assertion errors as causes at the public boundary. clearValues snapshots physical keys before deleting individually. Partial failure identifies the logicalKey rather than claiming atomic clearance. clearAll has the same meaning on this value-only backend.

lengthPrefixedNamespaceCodec combines UTF-8 namespace byte length and encodeURIComponent, such as 'sw1:3:app:theme'. decode returns a logical key only for that namespace. Mismatched/malformed keys yield undefined without deletion or stopping enumeration. Custom INamespaceCodec must provide encode(namespace,key):string and decode(namespace,physicalKey):string|undefined and owns inverse mapping, migration, and collision prevention. Missing functions fail INVALID_CONFIG; invalid execution/output follows EXTENSION_FAILED at codec with its cause.

### Cookies, visibility, and fixed scope

cookiesHost(options?) defaults namespace to 'default', uses the default namespace codec, and reads globalThis.document when document is omitted. A missing document fails BACKEND_UNAVAILABLE; an invalid object/cookie string fails INVALID_CONFIG during the initial cookie read. Server request headers remain the application's responsibility.

Scope is fixed at construction, defaults to {path:'/'}, and is reused for writes/removals.

| Field       | Default and boundary                                        |
| ----------- | ----------------------------------------------------------- |
| path        | '/'; starts with / and contains no semicolon                |
| domain      | undefined; if set, nonempty without whitespace/semicolon    |
| sameSite    | undefined; strict/lax/none, with none requiring secure:true |
| secure      | undefined                                                   |
| partitioned | undefined; true requires secure:true                        |

Set context additionally accepts expires as a valid Date and maxAge as a safe integer, both undefined by default. maxAge<=0 or expires<=now writes a deletion assignment. sync.set supports those fields and conflictPolicy without asynchronous cancellation/deadlines. Async remove context has only signal/timeoutMs, not a runtime scope override.

Multiple visible scopes with one physical name make get/set/has/keys fail COOKIE_SCOPE_AMBIGUOUS rather than guess. After set, an invisible deletion is success; an equal visible value is success; a different visible value is ambiguous; an invisible ordinary value is WRITE_FAILED. An entire assignment over 4096 bytes, including name/attributes, fails VALUE_TOO_LARGE without truncation.

opaqueEntries:true means HttpOnly entries cannot be inspected. has:false does not prove absence, and remove cannot promise to clear server cookies. clearValues/clearAll only write deletion assignments for visible namespaced keys. Server Set-Cookie, other scopes, and privacy policy remain outside the library's control.

### IndexedDB connections, records, and transactions

indexedDbHost defaults dbName to 'storage-web', kvStoreName to 'kv', bytesStoreName to 'bytes', recordsStoreName to 'records', and cleanupLegacyRecords to false. Names must be nonempty; the three object-store names must differ and cannot use `__storage_web_revisions__`, 'storage-web:meta', or 'storage-web:index-records'.

factory defaults to globalThis.indexedDB; absence is BACKEND_UNAVAILABLE and an invalid open port is INVALID_CONFIG. keyRange defaults to globalThis.IDBKeyRange, validating bound/lowerBound/upperBound when supplied. It is dereferenced only by range queries/checkpoint cursors, so operations without ranges can still work when it is missing.

Opening is lazy and caches a connection Promise, clearing failed opens for later retry. It opens the actual version and upgrades to add missing stores rather than hardcoding database version 1. onversionchange closes the old connection and clears its cache; onblocked refuses that open. The persisted schema currently uses version 3. A private authority validates it; the public schema mirror grants no authority. A newer persisted schema fails VERSION_UNSUPPORTED.

Historical documents records move in batches of 128 to recordsStoreName. Metadata 'migration:records-v1-to-v2' tracks status/lastKey for resumption. cleanupLegacyRecords:true deletes the old store in another upgrade only after completion and a matching destination, and belongs after the application no longer needs older-client rollback.

Writes await transaction oncomplete, not merely request.onsuccess. Reads also await request and transaction completion. setBytes copies Uint8Array; putRecord structured-clones before entering asynchronous writing, with SERIALIZE_FAILED on clone failure. getBytes recognizes actual cross-realm Uint8Array/ArrayBuffer slots rather than constructor names. Record keys are snapshotted.

iterateRecords uses validated ranges and 128-item pages by default. Each short readonly transaction continues from the last key with an open lower bound, checking cancellation before/after yields. Cursor/transaction failures become TRANSACTION_FAILED with indexeddb.cursor; contract failures pass through.

transaction(run,ctx?) requires a function. The callback uses an isolated get/put/delete draft, recording each visited key's revision and the clear epoch on first actual access. Afterward one readwrite transaction compares that epoch and every accessed revision, applies the draft, and updates revisions. clearAll/clearRecords invalidate old transactions by changing the epoch. Failed drafts never restore an old full-store image over unrelated commits. Cross-channel conflict is decided at commit; tx.put alone does not mean persistence.

Storage-family callback errors retain their identity; others become TRANSACTION_FAILED. After callback completion the scope expires, with transaction.scope failure for later use. TRANSACTION_CONFLICT calls for a fresh read and application-controlled bounded retry, not unlimited recursive retry. clearAll clears all three channels in one transaction; clearRecords clears records and changes the epoch. metadata independently accesses the meta store for migration checkpoints.

### Memory isolation and volatility

`memoryStorageHost<T>()` has no arguments. Each factory call creates a separate volatile store without namespaces. It supports value/bytes/records/transactions/iteration, secondaryIndexes:false, and changeFeed:true. sync exposes only values; async operations are not merely wrappers around sync.

Bytes are copied and records use structuredClone. Functions/uncloneable host values cannot be stored; standard clone semantics apply rather than a guarantee that every object graph is preserved. Transactions use isolated drafts with visited-key revisions and a clear epoch. Discarding a failed draft does not erase unrelated successful writes, and successful merge contains no await. Iteration sorts current records by compareStorageKeys and filters ranges without paging. There is no metadata, hence no cross-call migration resume. Disposal clears the maps; memory is neither persistent nor cross-device storage.

### Codecs and reversible fallback

ICodec has name/output/encode/decode with output text/structured/binary. Schema converts domain representation; codecs choose stored representation.

| Codec                                         | Behavior and boundary                                                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| jsonCodec                                     | text; JSON.stringify/parse; undefined stringify result becomes 'null'; failures are SERIALIZE_FAILED/DESERIALIZE_FAILED |
| structuredCodec                               | structured; identity encode/decode without copying; the record backend clones, not text-only stores                     |
| binaryCodec                                   | binary; only Uint8Array, returned unchanged after validation                                                            |
| selectCodec(codec,capabilities,onDiagnostic?) | Snapshot descriptors and choose a direct path, fallback, or refusal                                                     |

JSON does not preserve Date/Map/Set/bytes types or cycles. Structured storage can retain supported built-ins/cycles without reconstructing domain class instances, validating schema, or persisting functions/DOM nodes. structured with records:false fails UNSUPPORTED_CAPABILITY rather than silently switching to JSON. Binary with binary:false reversibly uses base64 text, adding roughly one third in encoded size and one diagnostic; that is an encoding property, not a performance measurement.

Both required selectCodec arguments use storage-contract validation, failing INVALID_ARGUMENT. onDiagnostic defaults to undefined and must be a function when present. Its failure goes to the existing cleanup reporter without changing selection. Direct selection still returns a new name/output/encode/decode container, retaining function references without extra fields or old receiver binding. Binary encode/decode reject non-Uint8Array values with SERIALIZE_FAILED/DESERIALIZE_FAILED.

### Schema and migration steps

ISchemaAdapter provides name/validate and optional normalize/encode/decode, with omitted steps acting as identity. Writes follow validate→normalize→encode→codec.encode. Reads follow codec.decode→migration of the stored representation→schema.decode→validate when validateOnRead is true. Migrations receive envelope.data, which need not yet be a domain object. Domain transformations such as Date↔ISO are distinct from JSON/byte encoding.

`passthrough<T>()` takes no argument, returns the passthrough name, and validates nothing. It is the default schema. fromStandardSchema(schema) takes one required Standard Schema v1 value without importing or binding a particular validation library. It checks '~standard'.version===1, nonempty vendor, and validate function, using the name standard-schema:vendor. Results must be non-null non-array objects with value or issues. Issue messages are strings joined with '; ' in cause.message. Invalid output, synchronous throw, and rejection become VALIDATION_FAILED with traceable original causes.

runMigrations(value,fromVersion,toVersion,migrations,signal?) requires the first four arguments, while migrations may explicitly be undefined. Versions are non-negative safe integers. Container, steps, signal, and pre-abort admission are checked before the from>=to identity return. Own steps run from from+1 through to in ascending order. Missing steps/undefined are no-ops; present nonfunctions fail INVALID_CONFIG and prototype-inherited steps never execute.

Each step's context gives its own fromVersion/toVersion and the same signal reference. Ordinary migration failure becomes MIGRATION_FAILED, cancellation ABORTED. Cancellation can end waiting on a hanging step without forcibly stopping arbitrary user code. Listener installation rechecks cancellation; setup failures use INVALID_ARGUMENT and cleanup is reported without replacing the result. Public migration creates one operation runtime; repository migration reuses its original operation/reporter.

### Entity definitions and repositories

defineEntity(options), or `defineEntity<T>()`(options) for indexed inference, returns one definition that can connect to several backends. Multiple definitions may share one store while names separate identical primary keys.

| Field          | Default and boundary                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| name           | Required, nonempty, without the reserved `__` prefix                                                      |
| key            | Required nonempty domain primary-key field                                                                |
| schema         | passthrough; validate name/validate and optional functions                                                |
| codec          | Chosen at connect: structuredCodec for records, jsonCodec for value-only; explicit codecs use selectCodec |
| version        | 1, positive safe integer                                                                                  |
| migrations     | Above version 1, exactly all own functions from 2 through version                                         |
| validateOnRead | true                                                                                                      |
| onDiagnostic   | console.warn; failure is reported without changing storage results                                        |
| defaultOrderBy | undefined, otherwise a comparator                                                                         |
| indexes        | Optional named index definitions                                                                          |

connect validates the value-store contract. New record keys are [`__storage_web_entity_v2__`,entityName,encodeFlatStorageKey(id)]. Reads also accept historical [entityName,id] keys; explicit migrate moves them. Value-only backends use entityName:encodedId. An envelope `__v` newer than the definition fails VERSION_UNSUPPORTED rather than being overwritten by older code.

get(id,ctx?) returns undefined when absent and materializes through decode/migration/validation. Read-time migration does not persist. put extracts the domain key, refuses null/undefined, prepares the entire value, and returns IStorageKey. Record backends atomically write the new position and delete the historical one. remove clears both positions.

list/stream options include range, limit, orderBy, direction, and onInvalid, plus discriminated indexed options. Ranges address logical ids. Limit defaults to undefined and must be a non-negative safe integer. Direction is next/prev. orderBy defaults to defaultOrderBy, otherwise scan order. Sorting buffers all matching records before applying limit rather than retaining a constant-memory stream; non-number/NaN comparison results fail EXTENSION_FAILED at comparator/entity.orderBy.

onInvalid defaults to skip; alternatives are throw or a callback returning skip/throw. Issues contain key/raw/optional record/stage/cause with decode/migrate/validate stages. Other callback return values fail INVALID_CONFIG; ordinary callback failure becomes VALIDATION_FAILED while storage-family errors retain identity. Value-only stores scan all keys, filter entityName prefixes, and diagnose once. Record stores scan the new prefix then the whole store for historical keys, deduplicating by seenIds. list buffers the stream.

migrate defaults batchSize to 100, a positive safe integer, and uses the same onInvalid policy. Results count scanned/eligible/migrated/skipped/alreadyCurrent/conflicted. A conflicting record batch retries individually once, rechecking newer versions; remaining conflicts are counted rather than retried indefinitely. IndexedDB checkpoints repository:name:migration with phase/status/counts/lastPhysicalKey and a fingerprint of entity/version/key/schema/codec/migration versions; mismatch restarts scanning. Memory/value-only backends have no checkpoint channel.

batch(run,ctx?) requires a genuine record transaction; value-only stores reject UNSUPPORTED_CAPABILITY rather than simulate atomicity. Its scope get/put/remove handles envelopes/keys and commits the final draft. Failure does not commit the draft, and the application chooses any retry budget.

### Secondary indexes and unique constraints

Indexes belong to entity definitions, not backend schema. A single path supports unique/multiEntry/revision, defaulting to false/false/1. Compound paths prohibit multiEntry:true. Selectors require select and explicit revision; bump revision after changing a persistent projection. multiEntry projects array members, while selectors return the declared single/multiple-key shape.

findBy returns the first result or undefined; findManyBy returns an array; streamBy iterates asynchronously. Indexed options do not duplicate the ordinary range field. IndexedDB maintains a fixed sidecar projection table atomically with record writes/removals/migration. A changed epoch between pages fails INDEX_QUERY_INVALIDATED, requiring a fresh query; an index row without its record is INDEX_ORPHAN.

Other backends reuse the same projection/comparison/uniqueness rules without claiming native indexes. Record put/batch/migrate validate the final draft, allowing same-id replacement, deleted-key reuse, and writing a new owner before deleting the old one. INDEX_UNIQUE_CONFLICT leaves no partial commit. Unique commits update the two-part marker [`__storage_web_entity_v2__`,entityName] to detect concurrent new owners through the existing revision mechanism. Raw record iteration can see this marker; entity queries/migrations do not mistake it for a three-part business record.

Value-only writes prepare schema/codec and snapshot raw text outside the lock, then recheck under host Web Locks. Racing preparation yields TRANSACTION_CONFLICT; an existing owner in a stable snapshot yields INDEX_UNIQUE_CONFLICT. Fallback checks scan and project without persistent sidecars. Ordinary selector failures retain EXTENSION_FAILED/cause; native backfill retains the original exception.

Cross-page coordination requires host Web Locks; injected ports without them serialize only within one module instance. Server-side cookie changes are outside this constraint. If backfill and saving its failed state both fail, native AggregateError carries INDEX_BACKFILL_FAILED with the primary cause and all original errors. Expired owner/generation/checkpoints use INDEX_BACKFILL_STALE. Existing ensure/iteration deadlines are reused rather than adding another wait owner.

### StorageHost and backend plugins

createStorageHost(options?) is always asynchronous with no plugins by default. It returns after the first plugin tuple installs atomically; later calls use host.use. StorageHostFacade is the same empty shell with explicit subsequent use, not a second runtime.

| Plugin                      | Subentry                | Default id |
| --------------------------- | ----------------------- | ---------- |
| memoryBackendPlugin         | plugins/memory          | memory     |
| localStorageBackendPlugin   | plugins/local-storage   | local      |
| sessionStorageBackendPlugin | plugins/session-storage | session    |
| cookieBackendPlugin         | plugins/cookies         | cookies    |
| indexedDbBackendPlugin      | plugins/indexed-db      | indexed-db |

Options reuse backend config plus optional id. Literal tuples infer exact backend types and reject duplicate ids at compile time. Runtime admission still validates actual handles/providers/stores and Feature topology. Publication follows successful create/prepare/install for the whole batch, with rollback on failure instead of partial registry state. Platform access happens when the selected plugin installs.

Host installTimeoutMs defaults to 30000 for the entire batch and requires a finite non-negative number, not false; scheduler defaults to systemScheduler. report defaults to undefined, leaving the existing diagnostic path without a caller-provided sink; callbacks receive late rejection/cleanup without replacing the primary failure. Concurrent installation fails STORAGE_HOST_BUSY. backend(id) looks up an exact id, hasBackend returns boolean, and backends gives a detached ordinary Map typed ReadonlyMap. Editing that copy changes no registry; there is no implicit default id.

Dispose seals admission, clears registries, cancels installation, waits for admitted mutations/queries, and releases adapters/stores/transports through PluginHost/lifecycle. Repeated calls share the same Promise. Cleanup failure leaves a terminal Host with STORAGE_HOST_DISPOSE_FAILED and reachable causes/errors; backend/use/liveQuery cannot revive it. Borrowed reactive Runtimes are not destroyed. Internal registration/service names and WeakMap admission metadata are not application API; use backend/reactiveBackend and plugin.id.

### Reactive adapters and live queries

The five plugins/reactive/* factories are memoryReactive/localStorageReactive/sessionStorageReactive/cookiesReactive/indexedDbReactive. Each creates a backend with its one adapter. Ordinary backend plugins do not add Host.liveQuery. reactiveBackend(id) returns its admitted handle, or undefined when that adapter is not installed; it never falls back to another id. A closed Host still rejects access.

liveQuery requires backendId, the caller's runtime, and query({store,signal}). scope/matches default to undefined. Only two known unequal scopes exclude a change; absent matches treats it as related, and predicate failure reports then refreshes conservatively. keepPreviousData defaults to true, retaining old data while refreshing. equals defaults to undefined and admits each new value without an implicit Object.is policy; a provided comparator can suppress equal visible replacements, with callback failures reported.

Signal defaults to undefined and cancels the whole query. timeoutMs defaults to undefined and applies per generation. report defaults to undefined; a supplied reporter’s failures are contained without changing query results. State is a readonly computed in the same reactive Runtime with loading/ready/refreshing/error/disposed states. ready projects settlement of the initial work and retains identity across refresh; if fetching is still active when an older Promise settles, it follows the currently active Promise. refresh joins that Promise while fetching and otherwise requests a refetch. Resource generations prevent stale results overwriting new ones. Dispose seals refresh admission, cancels the generation, releases subscriptions, and awaits admitted work with one repeated completion Promise.

consistency freezes the actual adapter mode/visibility/optional poll interval: memory has instance-local push; local/session use browser events or polling with document/top-level-context restrictions; Cookie sees only JS-visible entries; IndexedDB combines after-commit changes and eventual same-origin coordination. None claims arbitrary raw-writer capture or cross-device replication.

defineReactiveAdapterFeature creates a kind-hidden native Feature. PluginHost injects the exact store and Host-snapshotted scheduler rather than accepting a caller-invented backend-kind token. Normal subscribe must synchronously return a disposer. PromiseLike in its signature allows observing invalid results: asynchronous subscription fails REACTIVE_FEATURE_INVALID and aborts/closes the original scope, releasing a disposer immediately if it arrives late.

invalidate() without a change refreshes all queries on that adapter, bypassing scope/matches that need known change metadata. It invents no sequence/origin; a supplied change follows ordinary filtering. Resource owns generations/refresh/cancellation, lifecycle owns resource release, and event-subscriber owns fanout. Query/adapter/backend cleanup remains terminal with original errors reachable.

### Errors and troubleshooting

StorageError(code,details?,message?) requires code with optional details. Source is @migaia/storage-web; top-level message defaults to `[storage-web] ${code}` and may be overridden by the third argument. Details may include backend/key/existingChannel/attemptedChannel/extensionStage/operation/cause. Cause can be undefined; when supplied it retains the original object, message, and stack rather than making the top-level message equal to it. The error is shallow-frozen, without freezing its cause. Adding operation/stage metadata to an existing StorageError preserves its message and keeps the complete old error as cause.

STORAGE_WEB_SOURCE, StorageErrorCode, and StorageErrorText are stable exports. Branch on source/code; text primarily supports extension implementations. Import contract INVALID_ARGUMENT/INVALID_KEY/UNSUPPORTED_CAPABILITY/STORE_DISPOSED/ABORTED from storage-contract. Existing storage-family failures keep identity across schema/codec/namespace boundaries.

| StorageErrorCode value                                                             | Trigger                                                                   |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| BACKEND_UNAVAILABLE / QUOTA_EXCEEDED / VALUE_TOO_LARGE                             | Missing/refused backend, quota, or oversized complete Cookie assignment   |
| SERIALIZE_FAILED / DESERIALIZE_FAILED                                              | Encoding, cloning, decoding, or envelope failure                          |
| VALIDATION_FAILED / MIGRATION_FAILED                                               | Schema or migration failure                                               |
| TRANSACTION_FAILED / TRANSACTION_CONFLICT                                          | Transaction/exclusive commit failure or changed revision/epoch/snapshot   |
| DUPLICATE_KEY                                                                      | Value/bytes/record channel conflict                                       |
| VERSION_UNSUPPORTED                                                                | Persistent schema/entity envelope newer than the code                     |
| EXTENSION_FAILED                                                                   | Extension failure; inspect extensionStage/cause                           |
| WRITE_FAILED / COOKIE_SCOPE_AMBIGUOUS                                              | Invisible Cookie write or ambiguous scope                                 |
| INVALID_CONFIG                                                                     | Adapter configuration failure                                             |
| INDEX_ORPHAN / INDEX_UNIQUE_CONFLICT / INDEX_QUERY_INVALIDATED                     | Missing indexed record, occupied unique value, or invalidated page        |
| INDEX_BACKFILL_FAILED / INDEX_BACKFILL_STALE                                       | Backfill plus failure-state error, or expired owner/generation/checkpoint |
| BACKEND_ID_INVALID / BACKEND_DUPLICATE / BACKEND_NOT_INSTALLED                     | Invalid, duplicate, or absent id                                          |
| BACKEND_PLUGIN_INVALID / BACKEND_INSTALL_FAILED                                    | Invalid plugin/store or failed install batch                              |
| STORAGE_HOST_BUSY / STORAGE_HOST_DISPOSED / STORAGE_HOST_DISPOSE_FAILED            | Busy/terminal Host or cleanup failure                                     |
| LIVE_QUERY_DISPOSED / LIVE_QUERY_DISPOSE_FAILED                                    | Terminal query or cleanup failure                                         |
| REACTIVE_FEATURE_INVALID / REACTIVE_TOPOLOGY_INVALID                               | Invalid reactive definition/topology                                      |
| REACTIVE_SERVICE_NOT_INSTALLED / REACTIVE_ADAPTER_NOT_INSTALLED                    | Missing service or selected adapter                                       |
| REACTIVE_ADAPTER_FAILED / REACTIVE_ADAPTER_DISPOSE_FAILED / BACKEND_DISPOSE_FAILED | Query/invalidation failure or terminal cleanup failure                    |

For unavailable backends, explicitly prompt or choose memory. Check Cookie scope/policy after WRITE_FAILED. Distinguish channel conflicts, occupied unique values, and optimistic races before retrying. Newer formats need compatible code, not a deleted migration graph. Structured data on text-only stores needs an explicit codec/backend choice. Judge cross-page query refresh by consistency rather than treating it as replication. Closed Hosts/queries/backends require new instances.

```bash
pnpm --filter @migaia/storage-web run fmt
pnpm --filter @migaia/storage-web run lint
pnpm --filter @migaia/storage-web run typecheck
pnpm --filter @migaia/storage-web run typecheck:test
pnpm --filter @migaia/storage-web run test
```

The test script builds with Vite/declarations before its existing coverage suite. test:e2e/typecheck:e2e/test:packed are separate existing commands; only actual executions establish their results.
