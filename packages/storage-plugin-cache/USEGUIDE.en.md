# Cache usage guide

[中文](./USEGUIDE.md) · [Overview and installation](./README.en.md)

| Your task                                                | Start here                                                                    |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Share duplicate loads and remember misses briefly        | [Load missing values and cache misses](#load-missing-values-and-cache-misses) |
| Combine memory, disk or remote tiers                     | [Combine tiers](#combine-tiers)                                               |
| Serve stale data while refreshing, or cancel one request | [Expiry, refresh and cancellation](#expiry-refresh-and-cancellation)          |
| Invalidate by tag and reduce large-value copies          | [Tags and large values](#tags-and-large-values)                               |
| Reuse answers to similar questions                       | [Opt into semantic caching](#opt-into-semantic-caching)                       |

## Load missing values and cache misses

Install base tiers first, then add the cache through `host.use(cachePlugin(...))`. A loader's `undefined` result is cached only when `negativeTtlMs` is configured.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { cachePlugin } from '@migaia/storage-plugin-cache'

const base = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'data' })] })
try {
  const host = await base.use(
    cachePlugin({
      tiers: [{ backend: 'data', ttlMs: 30000 }],
      negativeTtlMs: 1000
    })
  )
  await host.detect()
  const cache = host.backend('cache')
  await cache.getOrLoad('profile:ada', async () => ({ name: 'Ada' }))
  console.log(await cache.getOrLoad('profile:ada', async () => ({ name: 'unused' })))
  // { name: 'Ada' }
  await cache.getOrLoad('profile:missing', async () => undefined)
  console.log((await cache.peek('profile:missing'))?.negative) // true
  await cache.invalidate('profile:ada')
} finally {
  await base.dispose()
}
```

`getOrLoadEntry` also returns `tier`, `stale`, `negative`, `ageMs`, `meta` and `tags`. `peek()` never loads and returns `undefined` for a missing entry. `getOrLoadMany(keys, loader)` deduplicates keys, reads each tier in batches, and passes only missing keys without an existing shared load to the loader. Return a `ReadonlyMap<string, value | undefined>`.

`stampedeLock: { backend, timeoutMs? }` can select a tier with real transactions and key locks. It rechecks under the lock and writes the value and TTL in that transaction. The timeout defaults to `30000` milliseconds. Transaction replay may invoke the loader again; this does not guarantee exactly-once loading.

Ordinary `get/set` read and write plain string entries, not the encoded objects above. Keys must be strings. For a stable key derived from parameters, import `cacheKey` from the root and use `await cacheKey('profile', { id: 'ada', version: 1 })`. Unsupported input retains the serializer's original error.

## Combine tiers

Order `tiers` from fastest to slowest. Each tier defaults to `write: 'through'`. This complete example uses two independent memory instances; install SQLite, Redis or PostgreSQL under the same IDs when replacing them in an application.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { cachePlugin, CacheWriteMode } from '@migaia/storage-plugin-cache'

const base = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'fast' }), memoryBackendPlugin({ id: 'slow' })]
})
try {
  const host = await base.use(
    cachePlugin({
      propagate: false,
      tiers: [
        { backend: 'fast', ttlMs: 10000, write: CacheWriteMode.back },
        { backend: 'slow', ttlMs: 60000 }
      ],
      writeBackIntervalMs: 1000
    })
  )
  await host.detect()
  const cache = host.backend('cache')
  await cache.set('status', 'ready')
  await cache.flush()
  console.log(await cache.get('status')) // ready
} finally {
  await base.dispose()
}
```

Through writes settle from the slowest tier upwards. Hits in slower tiers promote values to faster ones. Back mode coalesces pending writes by key and processes them every `1000` milliseconds by default. Failed items are reported and dropped without retry. The slowest tier cannot use back. This example disables propagation to demonstrate back separately. With the default `propagate: true`, every tier above a change source needs TTL, and back tiers must be below all change sources and have TTL.

Subscriptions start during `detect()`. If a reliable source loses its cursor or the cursor expires, the cache clears the relevant upper prefix before continuing. Ordinary notifications also cannot update every copy simultaneously. Hard TTL bounds stale copies when a notification is missed. Dedicated backends or instances are recommended for cache data.

`prefix` defaults to `cache:<pluginID>:`. Choose distinct prefixes for independent caches sharing a data backend. `clock` defaults to `Date.now`, and `random` to `Math.random`; override them only when a controlled clock or jitter source is needed. `$cache.cursor` is reserved for propagation cursors, not business entries.

Cache has no cross-tier transactions. Tier failures are reported and degrade to misses or skipped writes. A successful call does not mean every copy is durable. For multi-tier prefix deletion, use `invalidate({ prefix: 'profile:' })` rather than the counted KV `removeByPrefix`.

## Expiry, refresh and cancellation

This example demonstrates refresh and bypass without waiting for expiry. Refresh stores the new value; bypass returns its value only to that call.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { cachePlugin } from '@migaia/storage-plugin-cache'

const base = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'data' })] })
try {
  const host = await base.use(
    cachePlugin({
      tiers: [{ backend: 'data', ttlMs: 30000 }],
      maxAgeMs: 30000,
      staleAfterMs: 10000
    })
  )
  await host.detect()
  const cache = host.backend('cache')
  let revision = 0
  const load = async () => ({ revision: ++revision })
  await cache.getOrLoad('answer', load)
  console.log(await cache.getOrLoad('answer', load, { mode: 'refresh' })) // { revision: 2 }
  console.log(await cache.getOrLoad('answer', load, { mode: 'bypass' })) // { revision: 3 }
  console.log(await cache.getOrLoad('answer', load)) // { revision: 2 }
} finally {
  await base.dispose()
}
```

| Option          | Unit and default                          | Effect                                                                 |
| --------------- | ----------------------------------------- | ---------------------------------------------------------------------- |
| Tier `ttlMs`    | Positive safe integer milliseconds; unset | Hard expiry for that tier; needs backend TTL                           |
| `maxAgeMs`      | Positive safe integer milliseconds; unset | Maximum entry age                                                      |
| `staleAfterMs`  | Positive safe integer milliseconds; unset | Serve stale data while refreshing; must be below effective hard limits |
| `negativeTtlMs` | Positive safe integer milliseconds; unset | Lifetime for a cached `undefined`                                      |
| `jitterRatio`   | `0` through `0.5`; default `0`            | Randomly shorten expiry to spread refreshes                            |
| Per-call `mode` | `'default'`                               | `'refresh'` skips reads; `'bypass'` only loads                         |

Per-call `ttlMs/maxAgeMs/staleAfterMs/negativeTtlMs` may shorten configured bounds, never extend them. A positive per-call TTL requires TTL support in every target tier. The shared KV `setMany` TTL domain separately accepts zero to remove immediately.

A loader receives the cache-closing signal. `options.ctx.signal` cancels only that caller's wait with contract `ABORTED`, leaving other callers' shared load running. Respond to the loader signal so shutdown can drain promptly. A false `cacheIf(value)` skips all tier writes. Loader and encoding failures use `CACHE_LOAD_FAILED` and preserve the original cause; do not silently turn them into misses.

## Tags and large values

Tag indexes need records and TTL; offload storage needs blob, and its reference tier must have TTL. This complete example uses built-in memory capabilities. An application can replace the object tier with the object-storage plugin.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { cachePlugin } from '@migaia/storage-plugin-cache'

const base = await createStorageHost({
  plugins: [
    memoryBackendPlugin({ id: 'values' }),
    memoryBackendPlugin({ id: 'tags' }),
    memoryBackendPlugin({ id: 'objects' })
  ]
})
try {
  const host = await base.use(
    cachePlugin({
      tiers: [{ backend: 'values', ttlMs: 30000, offload: { backend: 'objects', minBytes: 128 } }],
      tagIndex: { backend: 'tags' }
    })
  )
  await host.detect()
  const cache = host.backend('cache')
  await cache.getOrLoad('article:1', async () => ({ body: 'x'.repeat(500) }), {
    tags: ['articles'],
    meta: { revision: 1 }
  })
  console.log((await cache.peek<{ body: string }>('article:1'))?.value?.body.length) // 500
  await cache.invalidate({ tag: 'articles' })
  console.log(await cache.peek('article:1')) // undefined
  await cache.sweepOffload()
} finally {
  await base.dispose()
}
```

Encoded content at or above `minBytes` is stored under a content hash; the tier keeps a reference. Smaller values stay in the tier. `maxEntryBytes` can skip oversized entries for a tier. Tags are written before values; a failed tag-index write is reported and skips the value so it does not leave an untracked tagged entry.

Invalidation removes references rather than immediately deleting objects that another key may use. `sweepOffload()` collects objects after their retention period. A newly invalidated object may remain until the longest referring tier's TTL; invalidation does not promise immediate disk reclamation.

## Opt into semantic caching

Import `semanticCacheFeature` from its separate entry and select it in the cache plugin's second argument. The two-dimensional embedding below demonstrates an exact repeated prompt. Use a real model in an application, with dimensions, metric and model version matching the collection.

```ts doc-test=run
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { cachePlugin } from '@migaia/storage-plugin-cache'
import { semanticCacheFeature } from '@migaia/storage-plugin-cache/features/semantic'

const base = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'values' }), memoryBackendPlugin({ id: 'vectors' })]
})
try {
  const host = await base.use(
    cachePlugin(
      { tiers: [{ backend: 'values', ttlMs: 30000 }] },
      {
        semantic: semanticCacheFeature({
          backend: 'vectors',
          collection: 'answers',
          dimensions: 2,
          metric: 'cosine',
          minScore: 0.8,
          ttlMs: 30000,
          embed: async () => [1, 0]
        })
      }
    )
  )
  await host.detect()
  const semantic = host.backend('cache').api.semantic
  await semantic.set('Question', { text: 'Answer' }, { payload: { model: 'one' } })
  const hit = await semantic.get<{ text: string }>('Question', {
    where: { model: 'one' },
    candidates: 3,
    accept: (item) => item.prompt === 'Question'
  })
  console.log(hit?.value) // { text: 'Answer' }
  await semantic.invalidate({ model: 'one' }, { count: 'scroll' })
} finally {
  await base.dispose()
}
```

The vector backend must be installed earlier and needs TTL support when semantic TTL is configured. Metric defaults to `cosine`; `dot` and `euclid` are also supported. Native engines determine scores and candidate order. Do not reuse a score threshold across metrics. `candidates` accepts `1` through `10`, defaulting to `1`. Optional `accept` runs in order; false continues, while a failed acceptance callback is reported and skips that candidate.

Payload fields support strings, finite numbers and booleans. `$cache.*` fields are reserved. Identical prompts with different payloads are stored separately. `getOrLoad` shares loads by organization, prompt and canonical payload; per-call TTL can only shorten the limit, `cacheIf` may prevent storage, and cancelling one caller does not affect others. Embedding failures use `CACHE_EMBED_FAILED`.

`invalidate(where, { count })` returns the vector backend's deletion count. The default is `precount`; `scroll` is also supported. Counts include matching expired points still physically stored and retain the backend's concurrency limits, rather than representing a global snapshot. Semantic APIs exist only when selected, under `api.semantic`; they add no cache transaction or vector-backend shutdown.

## Organizations and shutdown

Use `host.org(uuid).backend('cache')` to route borrowed tiers and Feature APIs to that organization. Shutdown cancels shared loads, waits for work already started, flushes back writes once, and cancels subscriptions. It does not independently close borrowed tiers; the host closes installed backends. `stats()` returns counters only; tier failures reach the host report callback and cache hooks.
