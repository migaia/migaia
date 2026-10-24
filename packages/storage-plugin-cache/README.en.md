# @migaia/storage-plugin-cache

Arrange installed key-value backends from faster to slower cache tiers, share loads for repeated requests, and fill upper tiers from lower ones. Use it to combine memory and persistent storage without writing refill and invalidation logic at every call. Configure expiry, caching of missing results and optional delayed writes as needed; tiers do not commit atomically, and delayed writes are not a durable queue.

[中文](./README.md) · [Usage guide](./USEGUIDE.en.md)

## Problems you may have seen

- A burst of requests loads the same hot key repeatedly because every request runs its own loader.
- Missing data keeps reaching the database because misses have no short-lived cache entry.
- A lower layer changes while an upper layer serves old data because copies lack invalidation or hard expiry.
- Batch loading needs its own maps, deduplication and cancellation because single-key and batch requests do not share loads.

## Why choose it

- Reads, promotion and writes use installed backends in the tier order you choose. [Tiered caching](./USEGUIDE.en.md#combine-tiers)
- `getOrLoad` and `getOrLoadMany` share loads for the same key. Cancelling one caller does not interrupt other waiters. [Loading policy](./USEGUIDE.en.md#load-missing-values-and-cache-misses)
- Freshness, maximum age and negative expiry are separate settings; stale data can return while a background refresh runs. [Expiry](./USEGUIDE.en.md#expiry-refresh-and-cancellation)
- Semantic lookup is an explicitly selected Feature. Ordinary caching needs no embedding model or vector backend. [Semantic caching](./USEGUIDE.en.md#opt-into-semantic-caching)

## Start here

Install the data tier before the cache. The second request reads the cached value without running the loader again.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { cachePlugin } from '@migaia/storage-plugin-cache'

const base = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'values' })] })
try {
  const host = await base.use(cachePlugin({ tiers: [{ backend: 'values', ttlMs: 30000 }] }))
  await host.detect()
  const cache = host.backend('cache')
  let loads = 0
  const load = async () => ({ answer: ++loads })
  await cache.getOrLoad('answer', load)
  console.log(await cache.getOrLoad('answer', load), loads) // { answer: 1 } 1
} finally {
  await base.dispose()
}
```

Expected output:

```text
{ answer: 1 } 1
```

## Pitfalls when writing it yourself

A Map around a loader still needs shared requests, expiry and an explicit policy for missing values:

```ts doc-test=check
const values = new Map<string, unknown>()
async function read(key: string) {
  if (values.has(key)) return values.get(key) // No expiry: old data stays indefinitely.
  const value = await Promise.resolve({ answer: 42 }) // Concurrent requests load separately.
  values.set(key, value) // Decide separately whether undefined should be cached.
  return value
}
console.log(await read('answer'))
```

## The three-minute model

`request → search tiers → return a hit and promote it → share a missing load → write tiers`.

| Term     | Meaning                                                               |
| -------- | --------------------------------------------------------------------- |
| Tier     | An installed KV backend, ordered from fastest to slowest              |
| through  | Settle this write, processing the slowest tier first                  |
| back     | Coalesce writes by key for later processing; report and drop failures |
| negative | A short-lived cached `undefined` result                               |
| stale    | A value beyond its fresh period but still within its valid lifetime   |

## Common scenarios

| Need                                     | Composition                       | Example                                                                 |
| ---------------------------------------- | --------------------------------- | ----------------------------------------------------------------------- |
| Share hot requests and missing lookups   | `getOrLoad` + `negativeTtlMs`     | [Missing values](./USEGUIDE.en.md#load-missing-values-and-cache-misses) |
| Combine local and persistent layers      | Multiple tiers                    | [Combine tiers](./USEGUIDE.en.md#combine-tiers)                         |
| Invalidate tags and offload large values | `tagIndex` + `offload`            | [Tags and large values](./USEGUIDE.en.md#tags-and-large-values)         |
| Filter similar answers by model metadata | Semantic Feature + vector backend | [Semantic caching](./USEGUIDE.en.md#opt-into-semantic-caching)          |

## Install

These storage packages are currently `private: true` workspace packages in this repository, not published registry packages. Run this from a consuming package inside the workspace:

```bash
pnpm add --workspace @migaia/storage-plugin-cache @migaia/storage-host @migaia/storage-contract
```

The package declares Node.js 24 or a compatible runtime. Redis, PostgreSQL and other tiers need their respective plugins and native client peers. The semantic Feature also needs your embedding function and a vector-capable backend; the root entry does not enable it automatically.

## Common APIs

| API                                              | Purpose                                                     |
| ------------------------------------------------ | ----------------------------------------------------------- |
| `cachePlugin(options, features?)`                | Select existing tiers and optional Features                 |
| `getOrLoad` / `getOrLoadEntry` / `getOrLoadMany` | Read or share a load; Entry also returns cache status       |
| `peek(key)` / `stats()`                          | Inspect entries and counters without loading                |
| `invalidate(key \| { prefix } \| { tag })`       | Delete matching copies                                      |
| `flush()` / `sweepOffload()`                     | Process pending writes or collect expired offloaded objects |
| `cacheKey(namespace, input)`                     | Build a stable key using portable serialization and SHA-256 |

## Behavior to know

- Every tier must already exist in an earlier installation batch and support KV. Tiers with `ttlMs` also need TTL. The slowest tier must use `through`. Cache offers no cross-tier atomic commit or transactions.
- Tier read failures are reported and treated as misses; tier write failures are reported and skipped. Loader and encoding failures use `CACHE_LOAD_FAILED`; embedding failures use `CACHE_EMBED_FAILED`. The original error remains in `cause`. Cache errors use `source: 'storage.backend.cache'`; argument and capability errors may come from storage-contract.
- Ordinary `get/set` handle strings; `get` reads only entries written by ordinary `set`. Use `getOrLoad`, `getOrLoadEntry` and `peek` for encoded objects and negative entries.
- Invalidation propagation is enabled by default and subscribes during `detect()`. Every tier above a change source needs hard TTL. Notifications do not make writes atomic across tiers. Dedicated cache backends avoid unrelated business clear notifications removing cache copies.
- `write: 'back'` is not a durable queue. Failures are not retried. `flush()` processes current pending writes, and shutdown flushes once too. With propagation enabled, a back tier must be below every change source and have TTL; otherwise configuration is rejected.
- Multi-tier `removeByPrefix` cannot return a reliable deduplicated count, so it rejects with `UNSUPPORTED_CAPABILITY` before I/O. Use uncounted `invalidate({ prefix })` instead. `removeMany` counts each known distinct logical key once.
- `host.org(uuid).backend('cache')` routes every tier to the same organization. Cache shutdown drains work already started and cancels subscriptions without closing borrowed tiers separately. Host shutdown releases the backends it installed.
