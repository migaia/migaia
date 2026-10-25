# @migaia/storage-plugin-redis

[中文](./README.md)

Use Redis or Valkey through one storage API that handles organization keys, expiry, record queries and explicit key locks, reducing repeated key-prefix and expiry code. Choose a driver for your connected client or pool, install the plugin, and add Streams, rate limiting or vector search when needed. Available capabilities depend on the server modules and driver; Redis transaction partial-failure limits still apply.

## Sound familiar?

- Tenant caches overwrite each other: raw keys lack consistent organization prefixes.
- Updating a live value removes its expiry: value and TTL were written separately.
- MULTI reports an error but data changed: an EXEC item error is not a rollback.
- Reconnected consumers miss changes: Pub/Sub was treated as retained history.

## Why choose it?

- **Keep logical keys and organizations consistent.** Text, bytes and records use separate physical keys while equal keys in different organizations remain isolated. See [Organization data with expiry](./USEGUIDE.en.md#organization-data-with-expiry).
- **Submit standard mutations in one EXEC.** Values, indexes, revisions and notifications share the commit, with identifiable input failures checked first. Redis's partial-failure limits still apply. See [Transactions and concurrency](./USEGUIDE.en.md#transactions-and-concurrency).
- **Choose live hints or retained history deliberately.** Pub/Sub serves online listeners; the change Stream can resume from a cursor. See [Resume change history](./USEGUIDE.en.md#resume-change-history).
- **Use capabilities the server actually has.** Vector selection checks the Search module and binary driver ports instead of silently replacing native search with local computation. No performance comparison is claimed.

## Start here

Run Redis 7.2+ or Valkey 7.2.5+ and set `REDIS_URL`. This program writes a value and reads it back.

```ts doc-test=run
import { createClientPool } from 'redis'
import { createStorageHost } from '@migaia/storage-host'
import { redisBackendPlugin } from '@migaia/storage-plugin-redis'
import { nodeRedisDriver } from '@migaia/storage-plugin-redis/node-redis'
const pool = createClientPool({ url: process.env.REDIS_URL }, { maximum: 8 })
await pool.connect()
try {
  await using host = await createStorageHost({
    plugins: [redisBackendPlugin({ driver: nodeRedisDriver(pool) })] as const
  })
  const store = host.backend('redis')
  await store.set('example:status', 'ready')
  console.log(await store.get('example:status'))
} finally {
  await pool.close()
}
```

Expected output:

```text
ready
```

For TTL and transactions, see [Organization data with expiry](./USEGUIDE.en.md#organization-data-with-expiry). For vectors, see [Search vectors](./USEGUIDE.en.md#search-vectors).

## Pitfalls in hand-written code

This comparison is not executed.

```ts doc-test=check
import type { RedisClientType } from 'redis'
export async function save(client: RedisClientType) {
  await client.multi().set('session', 'active').incr('session').exec()
  // INCR fails on a noninteger, but SET may already have committed.
  // No organization is encoded in the key, so another tenant writes the same session.
}
```

The standard API centralizes keys, validation, WATCH and expiry. It cannot make Redis EXEC roll back all commands after an item failure. Unknown commit outcomes are never replayed automatically.

## The model in three minutes

| Task                                    | Tool                                        |
| --------------------------------------- | ------------------------------------------- |
| Create and close the SDK client or pool | Your application                            |
| Store values, records, TTL and counters | The installed backend and capability tokens |
| Serialize a specific logical key        | tx().lock(...).run(...)                     |
| Online messages or application queues   | PubSub and Streams Features                 |
| Read standard commit history            | change-stream Feature and durableChangeFeed |
| Native nearest-neighbor search          | search Feature and vector                   |

A capability token selects standard methods; a Feature adds optional methods. WATCH detects changes after a read. EXEC executes queued commands, but one command's failure does not undo successful commands.

## Typical scenarios

| Scenario                                        | Building blocks                             | Details                                                                         |
| ----------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------- |
| Sessions and counters                           | Organizations, ttl, counter, explicit locks | [Organization data with expiry](./USEGUIDE.en.md#organization-data-with-expiry) |
| Queues, rankings, rate limits and live messages | Native Features                             | [Select native features](./USEGUIDE.en.md#select-native-features)               |
| Resume an invalidation consumer                 | durableChangeFeed                           | [Resume change history](./USEGUIDE.en.md#resume-change-history)                 |
| Server-side vector search                       | Search module and binary driver             | [Search vectors](./USEGUIDE.en.md#search-vectors)                               |

## Install

The package is currently `private: true` for this repository's workspace. Public registry availability is not implied. Link workspace dependencies from a consuming workspace package, then install the SDKs you use:

```bash
pnpm add @migaia/storage-host @migaia/storage-contract @migaia/storage-plugin-redis --workspace
pnpm add redis ioredis
```

| Entry         | Injected object               | Application cleanup               |
| ------------- | ----------------------------- | --------------------------------- |
| `/node-redis` | A connected node-redis 6 pool | Release host, then pool.close()   |
| `/ioredis`    | A connected ioredis 6 client  | Release host, then client.quit()  |
| `/bun`        | A connected Bun RedisClient   | Release host, then client.close() |

The root entry loads no SDK. ioredis and node-redis provide binary commands/EXEC. The Bun adapter has no binary port: basic KV remains available, but Search vectors cannot be selected. Each subscription needs its own connection; leave pool capacity for both subscriptions and business operations. Exact peer ranges are in package.json.

## Essential API

| API                                                  | Purpose                                     |
| ---------------------------------------------------- | ------------------------------------------- |
| `redisBackendPlugin({ driver, prefix? }, features?)` | Install Redis storage                       |
| `store.use(kv / records / ttl / counter)`            | Standard values, expiry and counters        |
| `store.transaction` / `store.tx()`                   | WATCH/EXEC transactions and logical locks   |
| `host.org(id).backend('redis')`                      | Organization-scoped data                    |
| Streams / PubSub / sorted-sets / rate-limit Features | Add store.api methods                       |
| change-stream / search Features                      | Add durableChangeFeed / vector capabilities |

## Contract details

Prefix defaults to migaia and maxLockMs to 30000. Ordinary overwrites retain TTL; deadlines and locks use Redis time. Standard record queries evaluate on the client. Standard secondary indexes, SQL and RDF are absent. Organization views use the same namespace mapping; dropOrg also removes that organization's supported persistent Feature data.

Ordinary change hints are best effort, without external-command coverage, reconnect replay or instant expiry notification. Search requires the real module; connecting to Valkey does not imply vector support. EXEC item failures and disconnects after send can leave partial or unknown writes. New writes are then sealed rather than silently retried. See [Transactions and concurrency](./USEGUIDE.en.md#transactions-and-concurrency).
