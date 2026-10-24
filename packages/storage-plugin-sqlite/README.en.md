# @migaia/storage-plugin-sqlite

[中文](./README.md)

When local settings, offline records and caches must be saved together, this package combines text, records, expiry and application SQL in the runtime's built-in SQLite transaction, avoiding partially saved updates. Choose the Node or Bun driver and a database file, then install the plugin in a host. No npm native database extension is needed; your application creates and closes the connection.

## Sound familiar?

- A settings update is only half saved: each statement committed separately.
- Two processes change the same item: an in-memory lock cannot coordinate them.
- Expired cache data still looks valid: values and deadlines follow different write paths.
- A root query runs during a transaction: both are trying to use one connection.

## Why choose it?

- **Write data and expiry together.** Batch values, records and TTL share one native transaction. See [Save values with expiry](./USEGUIDE.en.md#save-values-with-expiry).
- **Combine application SQL with storage methods.** Use the same tx to commit or roll back SQL and KV together. See [Commit SQL and storage together](./USEGUIDE.en.md#commit-sql-and-storage-together).
- **Keep connection cleanup explicit.** Your application creates the connection; release the host before releasing it. Node and Bun use built-in modules, with no npm native addon.
- **Understand concurrency limits.** File WAL mode coordinates logical locks across connections. Non-WAL mode coordinates only within the current process. See [Concurrency and cancellation](./USEGUIDE.en.md#concurrency-and-cancellation). No speed claim is made.

## Start here

This writes to a real SQLite in-memory database. Replace `:memory:` with a filename to persist data. Node 24 or later is required.

```ts doc-test=run
import { createStorageHost } from '@migaia/storage-host'
import { sqliteBackendPlugin } from '@migaia/storage-plugin-sqlite'
import { nodeSqliteDriver } from '@migaia/storage-plugin-sqlite/node'
await using connection = nodeSqliteDriver(':memory:')
await using host = await createStorageHost({
  plugins: [sqliteBackendPlugin({ driver: connection })] as const
})
const store = host.backend('sqlite')
await store.set('theme', 'dark')
console.log(await store.get('theme'))
```

Expected output:

```text
dark
```

For a multi-value update, see [Save values with expiry](./USEGUIDE.en.md#save-values-with-expiry). To create a database backup, see [Back up a database](./USEGUIDE.en.md#back-up-a-database).

## Pitfalls in hand-written code

This function assumes its application tables already exist. It is shown without execution.

```ts doc-test=check
import { DatabaseSync } from 'node:sqlite'
export function save(database: DatabaseSync, name: string) {
  database.prepare('INSERT INTO app_users(name) VALUES(?)').run(name)
  // The first statement has committed if the next one fails.
  database.prepare('UPDATE app_counts SET count=count+1').run()
  // A root operation during a transaction can interfere with work on this connection.
}
```

Use `store.transaction` and use only tx inside its callback. A caught or unawaited data-operation failure still causes rollback.

## The model in three minutes

| Task                                        | Tool                                           |
| ------------------------------------------- | ---------------------------------------------- |
| Open and close the SQLite file              | A connection created through `/node` or `/bun` |
| Use standard storage in that database       | `host.backend('sqlite')`                       |
| Select KV, records, SQL, expiry or counters | `store.use(token)`                             |
| Commit several changes together             | `transaction` or `tx().lock(...).run(...)`     |
| Back up or compact the file                 | The explicitly selected maintenance Feature    |

A capability token selects a set of methods. A Feature is an optional addition. WAL is SQLite's write-ahead log mode; here it also enables shared-file coordination for logical locks.

## Typical scenarios

| Scenario                               | Building blocks        | Details                                                                             |
| -------------------------------------- | ---------------------- | ----------------------------------------------------------------------------------- |
| Local tenant caches                    | Organizations, kv, ttl | [Save values with expiry](./USEGUIDE.en.md#save-values-with-expiry)                 |
| Update application tables and settings | tx.sql, tx.set         | [Commit SQL and storage together](./USEGUIDE.en.md#commit-sql-and-storage-together) |
| Create a database copy                 | maintenance.backup     | [Back up a database](./USEGUIDE.en.md#back-up-a-database)                           |

## Install

This package is currently `private: true` for use within the repository workspace, rather than a promise of public registry availability. Add it to a consuming workspace package:

```bash
pnpm add @migaia/storage-host @migaia/storage-contract @migaia/storage-plugin-sqlite --workspace
```

Node 24+ and Deno use `nodeSqliteDriver(path)` from `/node`. Bun uses `bunSqliteDriver(path)` from `/bun`. Deno needs read/write permission for the database and its journal files. Entry selection is explicit; no runtime fallback occurs. The root entry loads no database SDK.

## Essential API

| API                                             | Purpose                                       |
| ----------------------------------------------- | --------------------------------------------- |
| `sqliteBackendPlugin({ driver, table?, wal? })` | Install SQLite storage                        |
| `store.use(kv / records / sql / ttl / counter)` | Standard values, queries, expiry and counters |
| `store.transaction` / `store.tx()`              | Native transactions on the same connection    |
| `store.sql` / `tx.sql`                          | Parameterized SQL                             |
| `host.org(id).backend('sqlite')`                | Organization-scoped data                      |
| `sqliteMaintenanceFeature()`                    | Add backup and vacuum                         |

## Contract details

Give one driver to only one store at a time; multiple connections may open the same file. Files default to WAL and in-memory databases default to non-WAL. Requesting WAL for an in-memory database rejects. The default table prefix is `migaia`. Lock leases default to 30000ms without heartbeat. While a transaction occupies the connection, root operations fail; use tx instead.

Vectors, RDF and live change feeds are not provided. Record field queries evaluate on the client. Cancellation cannot preempt synchronous SQLite work already in progress. See [Data and failures](./USEGUIDE.en.md#data-and-failures) for data types, maintenance, logging and error details.
