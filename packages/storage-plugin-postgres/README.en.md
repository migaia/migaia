# @migaia/storage-plugin-postgres

Install PostgreSQL through the single storage-host owner. Standard KV, bytes, records, TTL, counters, SQL, transactions, key locks and PostgreSQL invalidations share native connections and the existing contract owners. The caller owns its driver/client/pool: dispose the host first, then close the client.

```ts
import { Pool } from 'pg'
import { createStorageHost } from '@migaia/storage-host'
import { postgresBackendPlugin } from '@migaia/storage-plugin-postgres'
import { pgDriver } from '@migaia/storage-plugin-postgres/pg'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  await using host = await createStorageHost({
    plugins: [postgresBackendPlugin({ driver: pgDriver(pool) })] as const
  })
  const store = host.backend('postgres')
  await store.transaction(async (tx) => {
    await tx.set('status', 'ready')
    await tx.putRecord({ name: 'Ada' }, 'user:1')
    await tx.sql`SELECT 1`.get()
  })
} finally {
  await pool.end()
}
```

## Adapters and capabilities

| Entry          | Caller-owned input                    | Native protocols                                                |
| -------------- | ------------------------------------- | --------------------------------------------------------------- |
| `/pg`          | `pg.Pool`                             | pg-copy-streams, dedicated LISTEN, optional logical replication |
| `/postgres-js` | `postgres.Sql`                        | reserve, native COPY, shared dedicated listeners                |
| `/bun`         | Bun 1.4.4+ `SQL` with `prepare:false` | reserve, native WritableStream COPY, listeners                  |

The root loads no client. Each adapter references its real peer. Logical replication additionally requires Node 22+ and pg-logical-replication >=2.6.0 <3. Bun 1.4.3 rejects before I/O because required COPY and column metadata are absent.

```ts
import postgres from 'postgres'
import { postgresJsDriver } from '@migaia/storage-plugin-postgres/postgres-js'
const client = postgres(process.env.DATABASE_URL!)
const driver = postgresJsDriver(client)
// After disposing the host, its caller awaits client.end().
```

```ts
import { SQL } from 'bun'
import { bunSqlDriver } from '@migaia/storage-plugin-postgres/bun'
const client = new SQL(process.env.DATABASE_URL!, { prepare: false })
const driver = bunSqlDriver(client)
// After disposing the host, its caller awaits client.close().
```

`server` defaults to `postgres`; `cockroach` and `yugabyte` are admitted by actual version probes. Only PostgreSQL declares changeFeed; Cockroach rejects the pgvector Feature. Protocol compatibility is not runtime verification: this environment provides PostgreSQL only. Cockroach/Yugabyte remain unverified. Installed Bun is 1.4.3, so the 1.4.4+ native path remains unverified.

## Optional Features

- `/features/pgvector`: `pgvectorFeature()` publishes standard vector and `api.pgvector.search(target, query, options)` for caller-owned native tables. Unselected stores have no vector. registerDetect checks the extension; with autoDetect:false, the first actual vector endpoint still checks before writing.
- `/features/listen`: `pgListenFeature()` provides root `api.notifications.listen/notify`; transactions expose notify only. Hints appear after real commit and do not promise reconnect replay.
- `/features/copy`: `pgCopyFeature()` provides root/transaction `api.copy.from`. It accepts structured identifiers and client STDIN only. Each actual attempt invokes a fresh sourceFactory and retains native backpressure/drain.
- `/features/logical-replication`: `pgLogicalReplicationFeature({slot,publication})` publishes durableChangeFeed. Deployment creates the persistent pgoutput slot, FOR ALL TABLES publication and REPLICATION permission. Only postgres with `/pg` supports it. Disposal never drops the slot.

Managed vectors use native `vector(d)`. The default uses the database plan and existing ANN indexes; exact:true disables ANN only in the current read transaction. Faithful where/org/expiry filters precede topK. Function conditions process hits without refill; requirePushdown rejects client conditions before I/O. All deleteWhere count modes return the actual DELETE RETURNING count, including physically present expired matches.

## Storage and failures

Defaults are schema=public and prefix=migaia. KV/bytes/records/meta/revisions/locks/journal/commit_markers/vector_config and managed vector tables use `(org_id,key)` primary keys with org-leading indexes. Records use canonical bytea keys; other tables use hex over the same canonical bytes. Text and records retain portable/collections TEXT codecs. Payload JSONB exists only as a pushdown projection.

Locks and TTL use database clock_timestamp(). Replacing a live value preserves TTL; expiry/deletion keeps revision tombstones. Batch methods bind arrays. Empty batches open no transaction and invoke no pipeline/hooks. Organizations share tables and isolate equal keys. Organization views reject raw SQL/COPY caller-table endpoints.

Transactions request READ COMMITTED and SHOW reports the actual level. Trusted 40001/40P01 failures roll back before revision comparison: unchanged baselines replay physically without reentering the outer pipeline, strategy decisions or releasing the original locks; changed baselines enter the original WRITE_CONFLICT strategy. Callbacks may replay; external effects have no exactly-once guarantee. A transport failure after COMMIT is sent never causes blind replay or a claim of zero writes.

Owned error source is storage.backend.postgres: SQL_FAILED, DECODE_FAILED, TRANSACTION_FAILED and DUPLICATE_KEY. Shared admission/concurrency/cancellation/deadline errors retain original contract constants and original causes. Hooks observe only; thrown errors and rejected promises are reported. Use host pipeline stages for intervention.

See [USEGUIDE.en.md](./USEGUIDE.en.md) for batching, native SQL, vectors, COPY and replication.

Global `journal: { logger, namespace, binlogValues: true }` borrows the original logger's external binlog. PostgreSQL captures actual text/bytes/record/managed-vector changes and complete deadlines in the original transaction, appends only after actual COMMIT, and awaits the original append settlement. External append failures reach the host reporter and `onBinlogAppendError`; they cannot roll back committed data. External log and data commits are not atomic. When complete images are selected, native SQL/COPY/caller-owned vector tables reject before business queries or source pulls.

PostgreSQL storageLogStore uses indexExclusive:false and reads current journal state inside each original native transaction, without a cross-operation index. INSERT ON CONFLICT DO NOTHING bootstraps the head under the existing journal primary key, then SELECT FOR UPDATE serializes its read/write inside that transaction. No table, lifetime lock or renewal owner is added. nativeAtomic and original scope/terminal authority remain unchanged; 40001/40P01 use the existing physical retry path. When the same logger supplies external WAL, the original shared owner awaits the intent, then writes an independently named commit marker in the same PostgreSQL transaction. Actual commit precedes append/complete; failure retains both intent and marker for recovery on reopen. This marker shares the existing private table with short-lived lost-COMMIT evidence but has a separate identity, so normal transaction cleanup preserves recovery evidence. When the same logger selects external WAL and undoLog, the host projects `store.undo(txId, ctx?)`. The original builder locks every target, checks complete revisions and images, then restores text/bytes/record/vector/metadata and absolute deadlines in one actual PostgreSQL transaction; the new commit enters the same journal. Metadata journal identities round-trip through the original flat-key codec, while complete versions and private locks reuse the original revision and lock owners. ABA fails even when the current value matches. Original revision rows retain a native UUID birth and increasing version. dropOrg still deletes every target organization row; a recreated birth prevents old undo from reusing the same version. Adding the private column preserves existing values and versions; old external images without birth safely reject with UNDO_CONFLICT. Organization targets cannot restore one another. With the same logger selecting `level()` and `telemetry: true`, the original host observer records ordinary payloads, complete original errors, fixed organizations and canonical keys. Each complete retry loop emits once; scopes and private metadata do not duplicate entries. Disabled observation does not read level methods, and logging failures only report.

Every native commit writes its marker in the same transaction. A lost COMMIT acknowledgement is accepted only when that original marker is visible. Missing or unreadable evidence does not prove zero writes: the original physical controller seals, the original error chain survives, and no blind replay occurs. Known settlement removes the marker; cleanup failure reports and retains evidence.

Selected journals retain every actual native mutation in execution order, including repeated writes to one target and intermediate values. The original SQL RETURNING row supplies each exact raw after value and absolute deadline; no later read substitutes the final value. Undo keeps the host's existing first-before/final-after merge and complete final revision checks. Unselected operations keep their original SQL and native path.
