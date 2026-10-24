# PostgreSQL usage guide

[中文](./USEGUIDE.md)

Use a database account that can create the package's storage tables. Each example is a complete program; it writes to the database. Set `DATABASE_URL` first. Examples that create application tables or indexes state those requirements below. Dispose the host before closing the caller-created client.

## Find a scenario

| Need                                       | Section                                                           |
| ------------------------------------------ | ----------------------------------------------------------------- |
| Commit values, expiry and records together | [Transactions and organizations](#transactions-and-organizations) |
| Search embeddings with native indexes      | [Vector search](#vector-search)                                   |
| Import bytes and notify after commit       | [Import and notify](#import-and-notify)                           |
| Resume an invalidation consumer            | [Follow committed changes](#follow-committed-changes)             |

## Transactions and organizations

This writes into one fixed organization. Expected output is `ready` followed by `true`.

```ts doc-test=run
import { Pool } from 'pg'
import { createStorageHost } from '@migaia/storage-host'
import { kv, records, ttl } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/authoring/concurrency'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  await using host = await createStorageHost({
    plugins: [postgresBackendPlugin({ driver: pgDriver(pool) })] as const
  })
  const store = host.org('10000000-0000-4000-8000-000000000001').backend('postgres')
  await store
    .tx()
    .lock(lockKey.text('example:status'))
    .run(async (tx) => {
      await tx.use(kv).setMany([
        { key: 'example:status', value: 'ready' },
        { key: ['example', 1], value: 'first', ttlMs: 60000 }
      ])
      await tx.putRecord({ name: 'Ada' }, 'example:user')
      await tx.use(ttl).expire(lockKey.text('example:status'), 60000)
    })
  console.log(await store.get('example:status'))
  console.log((await store.use(records).query().all()).length >= 1)
} finally {
  await pool.end()
}
```

Organizations use UUID strings. Equal logical keys, TTL, locks and revisions remain separate; the default organization shares the physical tables. `host.dropOrg(id)` removes that organization's managed rows, not other organizations or application tables. Organization views reject raw SQL, COPY and caller-table vector search.

`getMany` keeps order, duplicates and `undefined` for missing positions. Equivalent duplicate write keys reject before I/O. Empty batches perform no native operation or pipeline/hook work. Omitted `ttlMs` preserves a live deadline; a new value has no deadline. Zero expires immediately. TTL and locks use the database clock. `counter.increment` works on canonical decimal text and rejects unsafe integers before writing.

Use `store.sql` or `tx.sql` on the default root for application tables. Interpolated values are parameters, not SQL source; use `sqlFragment.id` from `@migaia/storage-host/authoring/sql` for identifiers. A root transaction may mix application SQL and standard storage methods. Supply your own tenant filters for application tables. Record query fields are evaluated by the shared client-side query code; native key ranges bound the scan.

Transactions request READ COMMITTED, and detection reports the actual isolation level. SQLSTATE 40001/40P01 can trigger replay after a confirmed rollback: unchanged observed revisions permit internal retry; changed revisions enter the selected concurrency policy. Callbacks may run again. Do not rely on exactly-once external effects. After COMMIT was sent, a connection failure never triggers blind replay. A transaction marker can prove commit; missing or unreadable evidence cannot prove no write occurred.

## Vector search

Provision the `vector` extension before selecting this Feature. The example also selects `halfvec` quantized recall and creates its expression index when needed; the database version and extension must support it. Its output depends on actual ANN candidates, rather than a promised result count.

```ts doc-test=run
import { Pool } from 'pg'
import { createStorageHost } from '@migaia/storage-host'
import { vector } from '@migaia/storage-contract'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import { pgvectorFeature } from '@migaia/storage-plugin-postgres/features/pgvector'
import { pgQuantizedFeature } from '@migaia/storage-plugin-postgres/features/quantized'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  await using host = await createStorageHost({
    plugins: [
      postgresBackendPlugin(
        { driver: pgDriver(pool) },
        { vector: pgvectorFeature(), quantized: pgQuantizedFeature({ mode: 'halfvec' }) }
      )
    ] as const
  })
  const items = host
    .backend('postgres')
    .use(vector)
    .collection<{ category: string }>('example-documents', { dimensions: 3, metric: 'cosine' })
  await items.upsert([{ id: 'guide', vector: [1, 0, 0], payload: { category: 'guide' } }])
  const hits = await items
    .near([1, 0, 0])
    .where({ category: 'guide' })
    .topK(20)
    .rescore({ topN: 5 })
    .all()
  console.log(hits.some((hit) => hit.id === 'guide'))
} finally {
  await pool.end()
}
```

`dimensions` and `metric` are required when creating a collection. Metrics are `cosine`, `dot` and `euclid`; scores are respectively `1-distance`, `-distance` and `-distance`. Points store FLOAT32 vectors. `near(query, { exact: true })` disables ANN for that read unless an explicit `rescore` stage selects quantized recall. Without `rescore`, existing database indexes and plans are used; plain pgvector selection does not create ANN indexes.

Quantization selects `halfvec` or `binary_quantize` once during installation. `topK(k)` bounds recall; `rescore({ topN })` reorders those candidates using original vectors. `topN` defaults to k and must be a positive safe integer no larger than k. Rescored queries can select fields, group and use generic rerank; they cannot delete, watch or rescore twice. No extra vector fetch is implied.

Organization, expiry and supported payload conditions appear in the native recall filter. ANN filtering does not guarantee k surviving hits. JavaScript predicates filter returned hits without refill. `requirePushdown()` rejects conditions that need client evaluation before I/O. Quantization may lose precision or reject native casts. Halfvec indexes allow up to 4000 dimensions; binary indexes up to 64000, while the original vector column allows up to 16000. These are limits, not recommended dimensions.

Collection configuration is shared across organizations and hosts using the same schema/prefix/name. `dropOrg` retains that configuration and table structure. Managed `deleteWhere` returns actual deleted rows, including expired matches that still physically exist. The separate `api.pgvector.search` accepts a structured caller-table target and native planner options; it does not turn application tables into managed collections.

## Import and notify

The program creates an application table, imports two CSV rows and commits a storage status with the notification. Expected output is `done` when the connected listener receives the committed notification. LISTEN is a live channel and can be lost on disconnect.

```ts doc-test=run
import { Pool } from 'pg'
import { createStorageHost } from '@migaia/storage-host'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import { pgCopyFeature } from '@migaia/storage-plugin-postgres/features/copy'
import { pgListenFeature } from '@migaia/storage-plugin-postgres/features/listen'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  await using host = await createStorageHost({
    plugins: [
      postgresBackendPlugin(
        { driver: pgDriver(pool) },
        { copy: pgCopyFeature(), listen: pgListenFeature() }
      )
    ] as const
  })
  const store = host.backend('postgres')
  await store.sql`CREATE TABLE IF NOT EXISTS app_example_import(name TEXT)`.run()
  const message = Promise.withResolvers<string>()
  await using subscription = await store.api.notifications.listen('example_ready', message.resolve)
  await store.transaction(async (tx) => {
    await tx.api.copy.from(
      { table: ['app_example_import'], columns: ['name'] },
      async function* () {
        yield new TextEncoder().encode('Ada\nLin\n')
      }
    )
    await tx.set('example:import', 'done')
    await tx.api.notifications.notify('example_ready', 'done')
  })
  console.log(await message.promise)
} finally {
  await pool.end()
}
```

COPY accepts structured table/column names and a source factory returning an async byte iterable. Each actual attempt calls the factory again; never pass a consumed stream. CSV defaults to comma and `header: false`. Text defaults to TAB. Omitted header and explicit header:false are supported; header:true rejects. Server files and PROGRAM are unsupported. On failure, native COPY drains before rollback. Transactions expose notify and COPY, but no listen method.

Notification channels are nonempty UTF-8 names of at most 63 bytes; payloads are below 8000 bytes. Neither accepts NUL. `listen` returns a subscription that must be disposed. Notifications are hints, not durable delivery or proof that a disconnected consumer saw every commit.

## Follow committed changes

Prepare `wal_level=logical`, a REPLICATION role, a persistent pgoutput slot and a FOR ALL TABLES publication before installation. Set `PG_REPLICATION_SLOT` and `PG_PUBLICATION` to their existing names. Only the PostgreSQL preset with `/pg` supports this Feature. Detection checks those facts without creating deployment resources.

With an existing slot, PostgreSQL may need to read retained older WAL before tailChanges finishes starting, so the next write in this example also waits. Startup time depends on that backlog: inspect confirmedFlushLagBytes and retainedWalBytes first, and do not reset or share a production slot to run this example.

This example starts at the current position, invalidates application caches and appends each processed invalidation to a file. A failed append rejects the callback. It also shows the required handling of a reset that has no organization.

```ts doc-test=run
import { appendFile } from 'node:fs/promises'
import { Pool } from 'pg'
import { createStorageHost } from '@migaia/storage-host'
import { durableChangeFeed } from '@migaia/storage-contract'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'
import { pgLogicalReplicationFeature } from '@migaia/storage-plugin-postgres/features/logical-replication'
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  await using host = await createStorageHost({
    report: console.error,
    hooks: { onCapabilityProbe: (facts) => console.log(facts.retainedWalBytes) },
    plugins: [
      postgresBackendPlugin(
        { driver: pgDriver(pool) },
        {
          replication: pgLogicalReplicationFeature({
            slot: process.env.PG_REPLICATION_SLOT!,
            publication: process.env.PG_PUBLICATION!
          })
        }
      )
    ] as const
  })
  const store = host.backend('postgres')
  const caches = new Map<string, Map<string, string>>()
  const received = Promise.withResolvers<void>()
  await using tail = await store.use(durableChangeFeed).tailChanges({
    from: 'now',
    onChange: async (change) => {
      if (change.kind === 'reset' && change.orgId === undefined) {
        for (const cache of caches.values()) cache.clear()
      } else if (change.orgId !== undefined) caches.get(change.orgId)?.clear()
      await appendFile('./example-invalidations.ndjson', JSON.stringify(change) + '\n')
      received.resolve()
    },
    onError: (error) => {
      received.reject(error)
    }
  })
  await store.set('example:feed', 'ready')
  await received.promise
} finally {
  await pool.end()
}
```

`truncate` defaults to `reset`. A root TRUNCATE produces exactly one `kind: 'reset'` without `orgId` for its commit; invalidate every organization's cached data. A routed organization feed gets its organization's reset. Do not treat every untagged non-reset event as a global event. With `truncate: 'block'`, the consumer stops, reports the condition and does not confirm the commit.

A successful `onChange` permits acknowledgement; rejection stops the stream without confirming that commit. For polling, `readChanges({ after, limit })` returns `{ changes, cursor }`. Commit derived effects and save `cursor` only after processing succeeds; pass that saved cursor as the next `after` to confirm completed progress. Cursors include complete or partial commit progress, so never parse, edit or advance them manually. Lost slots or expired/unprovable history raise `CHANGE_CURSOR_EXPIRED`. One slot supports one active consumer.

`onCapabilityProbe` includes decimal-string `confirmedFlushLagBytes` (current WAL position minus confirmed progress) and `retainedWalBytes` (current WAL position minus the slot's restart position), plus `maxSlotWalKeepSize`. Unlimited retention (`-1`) sends a warning through the reporter; it does not fail detection or change server settings. Monitor both lag and retained WAL, because a disconnected slot can retain disk indefinitely.

Disposing the tail or host releases replication connections and leaves the pool, slot and publication intact. Keep no slot when a live stream is unnecessary; TTL or periodic synchronization can avoid that retained-WAL obligation. Slot removal is a separate intentional administrative action; `api.logicalReplication.dropSlot()` exists but is not a cleanup default.

## Behavior and limits

Host detection runs automatically by default. If you set autoDetect:false, call await host.detect() before relying on the selected features. Managed vector endpoints still check the extension at first real use.

- Defaults: `server: 'postgres'`, schema `public`, prefix `migaia`; `driver` is required. `maxLockMs` defaults to 60000 ms and bounds their lease, and `concurrency` selects conflict handling. `cockroach` and `yugabyte` require their actual detected server behavior; PostgreSQL-only features do not become available merely because the wire protocol connects.
- Drivers: `/pg` borrows `Pool`; `/postgres-js` borrows `postgres.Sql`; `/bun` borrows Bun 1.4.4+ `SQL` configured with `prepare: false`. Close each SDK only after host release. The root imports none of them. Logical replication additionally uses Node 22+ and its declared `pg-logical-replication` peer. Server compatibility and adapter capability checks are not a promise that every runtime/server combination has been exercised.
- Data: text/records use portable collection-aware codecs, including Map/Set. Bytes are copied. Record keys use canonical ordered bytes; other channels encode the same key identity as hex. Missing text/bytes return `null`; records/metadata return `undefined`. Private storage tables are not an application SQL API. JSONB payload columns support filters, not a different truth value.
- SQL results: int8 is bigint; numeric/date/JSON/array retain native text; bytea becomes independent Uint8Array. No global parser is installed. postgres.js string parameters use TEXT; cast values explicitly in application SQL when another database type is required.
- Errors: package failures use source `storage.backend.postgres` and `SQL_FAILED`, `DECODE_FAILED`, `TRANSACTION_FAILED` or `DUPLICATE_KEY`. Shared validation, cancellation, timeout and concurrency codes keep their own source. Original errors remain reachable through `cause` or aggregate `errors`. Observer failures are reported; use pipelines to change an operation.
- Journals are opt-in through the host's `journal` option. Full text/bytes/record/managed-vector images and absolute expiry are captured in the data transaction. External binlog append happens after commit and is awaited; append failure reports but cannot roll back committed data. Full-image logging rejects raw SQL, COPY and caller-table vector endpoints before executing them.
- Native log storage serializes head/record updates in each database transaction and does not cache an index between operations. External WAL writes intent first and a separate marker with the data; recovery distinguishes committed data from unfinished intent. Undo is available only for the supported host journal combination, locks every target and verifies complete revisions/images before restoring. Recreating an organization cannot make old undo images valid; old images without revision birth reject with `UNDO_CONFLICT`. Cross-organization restoration is not allowed.
- Selected logs preserve repeated writes and intermediate values in execution order. Undo compares the final revision and restores original absolute deadlines; an expired deadline is not extended. Telemetry is separately opt-in, reports one completed root operation/transaction across retries and never takes ownership of the logger. Release the logger and its storage only after the host.
