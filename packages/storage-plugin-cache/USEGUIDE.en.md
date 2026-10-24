# Multi-tier cache

`cachePlugin` composes already-published storage backends. Install tiers in an earlier host batch, then install the cache and explicitly call `host.detect()`.

```ts
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { cachePlugin, cacheKey } from '@migaia/storage-plugin-cache'

const original = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'memory' })] })
const host = await original.use(
  cachePlugin({
    tiers: [{ backend: 'memory', ttlMs: 30000 }],
    maxAgeMs: 30000,
    staleAfterMs: 10000,
    negativeTtlMs: 1000
  })
)
await host.detect()
try {
  const cache = host.backend('cache')
  const key = await cacheKey('response', { model: 'model-one', version: 1 })
  const value = await cache.getOrLoad(
    key,
    async (signal) => {
      if (signal.aborted) return undefined
      return { answer: 42 }
    },
    { meta: { model: 'model-one' } }
  )
  console.log(value, await cache.peek(key), cache.stats())
  await cache.invalidate(key)
} finally {
  await host.dispose()
}
```

Layers are ordered fastest to slowest. Through writes finish from the slowest layer upwards. Back writes coalesce by key and flush through the host scheduler; failures are reported and dropped without retries. The slowest layer must be through. `flush()` sends pending writes immediately; disposal drains admitted work, flushes once and releases subscriptions without closing borrowed tiers.

The cache is eventually consistent with invalidation notifications; it has no cross-store atomic commit and advertises no transactions. Use dedicated backend instances to avoid broad business notifications evicting unrelated cache copies. Upper layers of a change feed require hard TTLs to bound missed notifications. Durable feeds use their original cursor protocol.

Logical keys are strings. Flat `get` sees only entries written by flat `set`; codec values and negative entries are available through `getOrLoad`, `getOrLoadEntry` and `peek`. `cacheKey` uses the original portable serializer and SHA-256, preserving field-order equivalence and original serializer errors.

## Entry policy

Call `ttlMs`, `maxAgeMs`, `staleAfterMs` and `negativeTtlMs` may shorten configured bounds. A longer override rejects with `CACHE_TIER_INVALID`. `jitterRatio` is between zero and 0.5 and only shortens expiry through the original numeric helper; `clock` and `random` can be injected. A stale hit returns immediately while one shared refresh runs. Undefined results are cached only when a negative TTL exists. `cacheIf` false skips all layers.

`mode: 'refresh'` skips reads, supersedes an earlier normal load and joins an existing refresh. `mode: 'bypass'` performs only the source call. One caller's cancellation rejects that caller with contract `ABORTED`; shared work receives only the cache closing signal. Source or encoder failures use `CACHE_LOAD_FAILED` with the original cause and native class.

`getOrLoadMany` deduplicates input keys, performs one native `getMany` per visited tier and one native `setMany` per through fill tier. New misses enter the same single-flight Map as single-key requests and share one batch source call. `maxEntryBytes` skips oversized entries for that tier.

`stampedeLock` selects a tier with native transactions and key locks. The original transaction rechecks the locked key before loading and writes its TTL in the same draft. Callback replay may load again; this is at least once, not exactly once. Native lock and transaction errors remain unchanged.

`tagIndex` selects a records-and-TTL backend. Tag records are written before cache values; a tag-index failure reports and skips cache writes. `invalidate({ tag })` visits only that tag's key range. `offload` selects a blob backend and requires a tier TTL: encoded values above `minBytes` use SHA-256 object keys and references. Invalidating values removes references only; explicit `sweepOffload()` removes old objects. Shared object backends retain objects for the longest configured tier TTL.

Hooks report counts and identities, never keys or values: `onCacheHit`, `onCacheMiss`, `onCacheLoad`, `onCacheInvalidate`, `onCacheTierError`, `onCacheWriteBackDropped`. Layer failures degrade to misses or skipped writes and retain their original diagnostics through the host reporter. Organization views route every tier through the same immutable host org context.

The counted KV `removeByPrefix` is available for one tier. With multiple tiers it rejects `UNSUPPORTED_CAPABILITY` before I/O: native counts cannot identify duplicate logical copies across tiers. Use `invalidate({ prefix })` or clear methods for multi-tier deletion without a count. `removeMany` counts distinct supplied logical keys, even when several copies are removed.
