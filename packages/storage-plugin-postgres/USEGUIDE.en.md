# PostgreSQL usage guide

Choose `/pg`, `/postgres-js`, or Bun 1.4.4+ `/bun` as shown in README. Pass the caller-owned driver to postgresBackendPlugin. Every store below comes from `host.backend('postgres')`; Features are selected explicitly on that same plugin.

## Batches, expiry and organizations

```ts
import { kv, ttl, counter, records, lockKey } from '@migaia/storage-contract'
await store.use(kv).setMany([
  { key: ['items', 1], value: 'first', ttlMs: 10000 },
  { key: ['items', 2], value: 'second' }
])
const values = await store.use(kv).getMany([['items', 2], ['items', 1], ['items', 2], 'missing'])
// ['second', 'first', 'second', undefined]
const removed = await store.use(kv).removeByPrefix(['items'])
await store.set('count', '0')
const next = await store.use(counter).increment('count', 1)
await store.use(ttl).expire(lockKey.text('count'), 1000)
const remaining = await store.use(ttl).remaining(lockKey.text('count'))
await store.use(ttl).persist(lockKey.text('count'))
const rows = await store.use(records).query().all()
```

Reads retain input order, duplicates and missing entries; duplicate write keys reject before I/O. Each array occupies one bound parameter. Omitted ttlMs preserves a live value's deadline and gives new values no deadline; zero means immediate expiry. Internal null array elements mean omitted durations, not client absolute timestamps. Each native update samples the database clock.

`host.org(validUuid).backend('postgres')` fixes an organization. Equal keys, TTL, locks, notifications and standard collections remain isolated; first access creates no tables. Selected vector/durableChangeFeed APIs publish through that child's original provider. Organization views reject caller-table native endpoints. Default root transactions may mix records and application SQL; callers supply tenant filters for raw SQL.

## Transactions, queries and native SQL

```ts
import { ConcurrencyPolicy, lockKey, sql } from '@migaia/storage-contract'
await store
  .tx()
  .lock(lockKey.text('balance'))
  .concurrency(ConcurrencyPolicy.wait())
  .run(async (tx) => {
    const current = Number((await tx.get('balance')) ?? '0')
    await tx.set('balance', String(current + 1))
    await tx.use(sql).sql`SELECT 1`.get()
  })
const json = await store.sql`SELECT ${'{"ready":true}'}::jsonb AS payload`.get()
const search =
  await store.sql`SELECT to_tsvector('simple', ${'hello storage'}) @@ plainto_tsquery('simple', ${'storage'}) AS matches`.get()
```

Use native SQL directly for application JSONB, full-text indexes, FOR UPDATE and pg_advisory_xact_lock. Standard records retain portable TEXT; shared query semantics process fields on the client over native bytea key ranges. int8 returns bigint, numeric/date/JSON/array retain native text, and bytea returns a copied Uint8Array. No global parser changes occur. postgres.js string parameters explicitly use TEXT to prevent its destination-OID JSON serialization; application SQL casts other types explicitly.

## Vectors

```ts
import { vector } from '@migaia/storage-contract'
import { pgvectorFeature } from '@migaia/storage-plugin-postgres/features/pgvector'
// postgresBackendPlugin({ driver }, { vector: pgvectorFeature() })
const embeddings = store.use(vector).collection('documents', { dimensions: 3, metric: 'cosine' })
await embeddings.upsert([{ id: 'a', vector: [1, 0, 0], payload: { category: 'guide' } }], {
  ttlMs: 10000
})
const hits = await embeddings
  .near([1, 0, 0], { exact: true })
  .where('category', 'eq', 'guide')
  .topK(5)
  .all()
const deleted = await embeddings.deleteWhere({ category: 'guide' }, { count: 'scroll' })
```

cosine/dot/euclid use `<=>`/`<#>`/`<->` with scores 1-distance/-distance/-distance. Native vector(d) stores float32, with its corresponding precision and tied-order limits. Create a logical collection once; other organizations may use collection('documents') with the shared physical configuration. `api.pgvector.search({table:['app_vectors'],idColumn:'id',vectorColumn:'embedding',payloadColumn:'payload'}, q, {metric:'cosine',limit:10,efSearch:64})` queries caller-owned tables. Without the quantized Feature the package creates no ANN index.

## COPY and notifications

Global collection configuration uses a stable private namespace identity in the original configuration table, independently of every host's default organization. Equal schema/prefix/name identities share one native table across hosts. dropOrg removes only that organization's point rows and retains global configuration, other organizations and native table structure. Expiry indexes also lead with org_id.

```ts
import { pgCopyFeature } from '@migaia/storage-plugin-postgres/features/copy'
import { pgListenFeature } from '@migaia/storage-plugin-postgres/features/listen'
// Select both copy/listen Features explicitly.
const subscription = await store.api.notifications.listen('app_ready', (payload) =>
  console.log(payload)
)
try {
  await store.transaction(async (tx) => {
    await tx.api.copy.from({ table: ['app_rows'], columns: ['id', 'name'] }, async function* () {
      yield new TextEncoder().encode('1,Ada\n2,Lin\n')
    })
    await tx.set('import', 'done')
    await tx.api.notifications.notify('app_ready', 'done')
  })
} finally {
  await subscription.dispose()
}
```

The application creates the target table. CSV defaults to header=false and comma; text defaults to TAB and rejects header. Only client STDIN is supported; files and PROGRAM are rejected. The sourceFactory creates a fresh iterable per actual attempt. Failures drain native COPY before rollback. Transactions have no listen method. Channels are nonempty UTF-8 names of at most 63 bytes; payloads are below 8000 bytes. Both reject NUL.

## Durable logical replication

```ts
import { durableChangeFeed } from '@migaia/storage-contract'
import { pgLogicalReplicationFeature } from '@migaia/storage-plugin-postgres/features/logical-replication'
// postgresBackendPlugin({ driver: pgDriver(pool) }, { replication: pgLogicalReplicationFeature({ slot, publication }) })
const feed = store.use(durableChangeFeed)
const batch = await feed.readChanges({ after: savedCursor, limit: 100 })
// Persist processed changes before persisting batch.cursor. A later after confirms complete progress.
const tail = await feed.tailChanges({
  from: savedCursor ?? 'now',
  onChange: async (change) => {
    await processAndPersist(change)
  },
  onError: (cause) => console.error(cause)
})
// Await tail.dispose() when finished. Only explicitly retired slots use api.logicalReplication.dropSlot().
```

Deployment supplies wal_level=logical, a REPLICATION role, a persistent pgoutput slot and FOR ALL TABLES publication. Detection performs no deployment DDL. One commit aggregates bounded invalidations in each organization's first WAL occurrence order, without retaining business rows. Opaque cursors bind store/slot/org route, COMMIT commitEndLsn and the processed organization prefix. Partial progress never confirms that end; restart decodes from the original slot's unconfirmed position and skips the processed prefix. Only the final item permits subsequent after or successful tail acknowledgement. The peer uses auto:false, timeoutSeconds:0 and flowControl:true; row LSN/commitLsn are never checkpoints and positions are never incremented/decremented. One slot permits one active consumer.

Callback failure stops without confirming its commit. Disposal releases only the replication connection and leaves the slot/pool intact. A first empty read returns a complete cursor at the original native confirmed position. Lost slots, complete cursors behind confirmed progress, and partial cursors already confirmed through their commit raise CHANGE_CURSOR_EXPIRED rather than skip an unprovable gap. Startup cancellation and native ready-query failures reject after draining the original replication resource. Root TRUNCATE cannot derive every persisted organization from its rowless WAL record, so it safely stops that commit without confirmation; an org view can invalidate its own route. Ordinary INSERT/UPDATE/DELETE remains supported. This TRUNCATE boundary is pending user review.

Global `journal: { logger, namespace, binlogValues: true }` borrows the original logger's external binlog. PostgreSQL captures actual text/bytes/record/managed-vector changes and complete deadlines in the original transaction, appends only after actual COMMIT, and awaits the original append settlement. External append failures reach the host reporter and `onBinlogAppendError`; they cannot roll back committed data. External log and data commits are not atomic. When complete images are selected, native SQL/COPY/caller-owned vector tables reject before business queries or source pulls.

PostgreSQL storageLogStore uses indexExclusive:false and reads current journal state inside each original native transaction, without a cross-operation index. INSERT ON CONFLICT DO NOTHING bootstraps the head under the existing journal primary key, then SELECT FOR UPDATE serializes its read/write inside that transaction. No table, lifetime lock or renewal owner is added. nativeAtomic and original scope/terminal authority remain unchanged; 40001/40P01 use the existing physical retry path. When the same logger supplies external WAL, the original shared owner awaits the intent, then writes an independently named commit marker in the same PostgreSQL transaction. Actual commit precedes append/complete; failure retains both intent and marker for recovery on reopen. This marker shares the existing private table with short-lived lost-COMMIT evidence but has a separate identity, so normal transaction cleanup preserves recovery evidence. When the same logger selects external WAL and undoLog, the host projects `store.undo(txId, ctx?)`. The original builder locks every target, checks complete revisions and images, then restores text/bytes/record/vector/metadata and absolute deadlines in one actual PostgreSQL transaction; the new commit enters the same journal. Metadata journal identities round-trip through the original flat-key codec, while complete versions and private locks reuse the original revision and lock owners. ABA fails even when the current value matches. Original revision rows retain a native UUID birth and increasing version. dropOrg still deletes every target organization row; a recreated birth prevents old undo from reusing the same version. Adding the private column preserves existing values and versions; old external images without birth safely reject with UNDO_CONFLICT. Organization targets cannot restore one another. With the same logger selecting `level()` and `telemetry: true`, the original host observer records ordinary payloads, complete original errors, fixed organizations and canonical keys. Each complete retry loop emits once; scopes and private metadata do not duplicate entries. Disabled observation does not read level methods, and logging failures only report.

Every native commit writes its marker in the same transaction. A lost COMMIT acknowledgement is accepted only when that original marker is visible. Missing or unreadable evidence does not prove zero writes: the original physical controller seals, the original error chain survives, and no blind replay occurs. Known settlement removes the marker; cleanup failure reports and retains evidence.

Selected journals retain every actual native mutation in execution order, including repeated writes to one target and intermediate values. The original SQL RETURNING row supplies each exact raw after value and absolute deadline; no later read substitutes the final value. Undo keeps the host's existing first-before/final-after merge and complete final revision checks. Unselected operations keep their original SQL and native path.

## Quantized recall and native exact rescoring

```ts
import { pgQuantizedFeature } from '@migaia/storage-plugin-postgres/features/quantized'
// postgresBackendPlugin({ driver }, {
//   vector: pgvectorFeature(), quantized: pgQuantizedFeature({ mode: 'halfvec' })
// })
const selected = await embeddings
  .near([1, 0, 0])
  .where({ category: 'guide' })
  .topK(20)
  .rescore({ topN: 5 })
  .rerank(({ hits }) => hits.map((hit) => hit.score))
  .all()
```

Choose `halfvec` or `binary_quantize` once at installation. `topN` defaults to k and must be a positive safe integer at most k; invalid bounds reject before I/O. The read-only result supports original `withVector`, selection, grouping and generic rerank, with unchanged engine scores; it cannot delete, watch or acquire a second native rescore. No extra vector retrieval is implicit.

The original schema owner prepares expression HNSW indexes, using the metric's halfvec opclass or `bit_hamming_ops`. Existing collection metadata is locked in the same native transaction so two hosts prepare one index safely. Layout checks/index preparation are separate native statements; the business query is one `MATERIALIZED` recall of k followed by exact original-vector ordering and topN. A metric override prepares its matching index. Sample-based origins retain their original sample-loading statements before the recall/rescore statement. This explicit quantized stage selects quantized recall even if its near call specified exact; plain `near(...,{exact:true})` keeps its original behavior.

Recall includes organization, expiry and pushed payload conditions. HNSW filters do not promise physical prefiltering or k surviving candidates. JavaScript predicates run on the outer hits without refill; a following generic reranker receives those actual hits. Opt-in expression ANN indexes are the exception to the ordinary org-leading index layout. Original vectors remain float32; halfvec indexing supports at most 4000 dimensions, binary indexing at most 64000 but the original vector column at most 16000. Native casts may lose precision or reject values outside halfvec range with `SQL_FAILED` and the native cause. Quantization is not lossless. No dependencies or background workers are added.
