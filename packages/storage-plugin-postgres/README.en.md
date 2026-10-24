# @migaia/storage-plugin-postgres

[中文](./README.md)

Use PostgreSQL through one storage API when text, records, expiry and application SQL must commit together rather than leave half an update saved. Pass an existing client or pool to its driver and install the plugin in a host, then combine these operations in the same database transaction. Select notifications, logical replication or vectors separately when needed; your application still closes the client.

## Sound familiar?

- The order row exists but its status does not: the two writes committed separately.
- A rebuilt cache still serves stale data: a notification channel was treated as replayable history.
- Two tenants overwrite the same key: tenant filtering varies between queries.
- Shutdown hangs: the client pool closes before subscriptions and storage work have finished.

## Why choose it?

- **Commit storage operations and SQL together.** KV, records and SQL in a transaction use the same connection. See [Transactions and organizations](./USEGUIDE.en.md#transactions-and-organizations).
- **Add only the database features you need.** COPY, notifications, vectors and replayable changes have separate imports and explicit selection. See [Import and notify](./USEGUIDE.en.md#import-and-notify).
- **Know when history is no longer safe to resume.** Notifications may be lost; logical replication supplies checkpoints and rejects unprovable gaps. See [Follow committed changes](./USEGUIDE.en.md#follow-committed-changes).
- **Keep batch semantics clear.** Reads retain input order and duplicates, while writes reject equivalent duplicate keys. Array parameters avoid issuing one query per key; no speed comparison is claimed.

## Start here

Provide a PostgreSQL database through `DATABASE_URL`. Installation creates the storage tables, so the database role needs permission in the selected schema. This example writes a value and reads it back.

```ts doc-test=run
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
  await store.set('example:status', 'ready')
  console.log(await store.get('example:status'))
} finally {
  await pool.end()
}
```

Expected output:

```text
ready
```

For writes that must succeed together, see [Transactions and organizations](./USEGUIDE.en.md#transactions-and-organizations). For reconnecting consumers, see [Follow committed changes](./USEGUIDE.en.md#follow-committed-changes).

## Pitfalls in hand-written code

This function assumes the application tables already exist. It is shown for comparison, without execution.

```ts doc-test=check
import type { Pool } from 'pg'
export async function save(pool: Pool, key: string, value: string) {
  await pool.query('INSERT INTO app_settings(key,value) VALUES($1,$2)', [key, value])
  // Separate commits: a failure below leaves the first write in place.
  await pool.query('UPDATE app_stats SET writes=writes+1')
  // Repeating this function can insert twice; a lost connection does not prove zero writes.
}
```

Put changes that belong together inside `store.transaction`. Callback failure rolls them back. Keep email, payments and other external effects outside callbacks that may retry.

## The model in three minutes

| Task                                            | Tool                                             |
| ----------------------------------------------- | ------------------------------------------------ |
| Connect to PostgreSQL and close the client      | Your selected PostgreSQL SDK                     |
| Install storage and release its subscriptions   | `createStorageHost` and `host.dispose()`         |
| Use text, records, TTL, counters and SQL        | `host.backend('postgres')` or `store.use(token)` |
| Access one organization's data                  | `host.org(orgId).backend('postgres')`            |
| Add vectors, COPY, notifications or replication | Features in the plugin's second argument         |

A capability token such as `kv` or `ttl` selects a set of methods. A Feature is an explicitly installed addition. A cursor is an opaque checkpoint: save and return it unchanged.

## Typical scenarios

| Scenario                                   | Building blocks                                 | Details                                                                           |
| ------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------- |
| Commit values, records and expiry together | `transaction`, `kv`, `ttl`                      | [Transactions and organizations](./USEGUIDE.en.md#transactions-and-organizations) |
| Find similar embeddings                    | `pgvectorFeature`, optional quantized rescoring | [Vector search](./USEGUIDE.en.md#vector-search)                                   |
| Stream an import and notify after commit   | `pgCopyFeature`, `pgListenFeature`              | [Import and notify](./USEGUIDE.en.md#import-and-notify)                           |
| Resume after disconnecting                 | `pgLogicalReplicationFeature`                   | [Follow committed changes](./USEGUIDE.en.md#follow-committed-changes)             |

## Install

The package is currently marked `private: true` for use in this repository's workspace. This does not imply a public registry release. Add workspace packages from a consuming workspace package:

```bash
pnpm add @migaia/storage-host @migaia/storage-contract @migaia/storage-plugin-postgres --workspace
pnpm add pg pg-copy-streams pg-logical-replication postgres
```

| Entry          | Injected client                         | Shutdown                                |
| -------------- | --------------------------------------- | --------------------------------------- |
| `/pg`          | A `Pool` from `pg` 8                    | Release the host, then `pool.end()`     |
| `/postgres-js` | A `Sql` from `postgres` 3               | Release the host, then `client.end()`   |
| `/bun`         | Bun 1.4.4+ `SQL`, with `prepare: false` | Release the host, then `client.close()` |

The root entry loads no SDK. Logical replication currently requires `/pg`, Node 22+ and `pg-logical-replication >=2.6.0 <3`. Bun 1.4.3 lacks required adapter features and rejects before I/O. See `package.json` for exact peer ranges.

## Essential API

| API                                                   | Purpose                                                |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `postgresBackendPlugin(options, features?)`           | Install a PostgreSQL backend                           |
| `store.use(kv / records / ttl / counter / sql)`       | Select standard functionality                          |
| `store.transaction` / `store.tx().lock(...).run(...)` | Native transactions and explicit logical locks         |
| `store.sql`                                           | Parameterized application SQL                          |
| `host.org(id).backend('postgres')`                    | An organization-scoped store                           |
| PostgreSQL Feature factories                          | Add native vectors, COPY, notifications or replication |

## Contract details

Defaults are `server: 'postgres'`, `schema: 'public'` and `prefix: 'migaia'`. `cockroach` and `yugabyte` require actual server detection. Only PostgreSQL provides the ordinary change notifications; Cockroach does not support this package's pgvector Feature. Wire compatibility does not verify every deployment combination.

Organizations share tables while isolating equal keys, expiry, locks and standard vector points. Raw SQL, caller-table vector search and COPY access application tables; explicit organization views reject those endpoints. See [Behavior and limits](./USEGUIDE.en.md#behavior-and-limits) for data types, concurrency, failures and journal restrictions.

Logical replication defaults to `truncate: 'reset'`. Root streams emit one reset without `orgId` per TRUNCATE commit: consumers must invalidate every organization. `block` stops without confirming that commit. Detection reports replication lag and retained WAL and warns about unlimited retention. Keep no replication slot when a live stream is unnecessary; TTL or periodic synchronization may suffice. Host disposal never removes a slot.
