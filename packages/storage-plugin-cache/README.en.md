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

The counted KV `removeByPrefix` is available for one tier. With multiple tiers it rejects `UNSUPPORTED_CAPABILITY` before I/O: native counts cannot identify duplicate logical copies across tiers. Use `invalidate({ prefix })` or clear methods for multi-tier deletion without a count. `removeMany` counts distinct supplied logical keys, even when several copies are removed.

Each stored envelope also caps its expiry at that layer's sampled effective hard deadline. A failed native `expire` is reported and cannot leave an unlimited valid cache copy. Positive per-call TTL requires each target tier's TTL capability before loading or writing. Shared KV `setMany` retains its finite nonnegative TTL domain: zero removes immediately.

Propagation subscribes only during explicit detection. Reliable sources persist cursors in the immediately upper default-org tier; `$cache.cursor` is reserved for that metadata. Missing or expired cursors clear managed upper prefixes before continuing from now. Failed invalidation or cursor persistence retains no backlog: the next native batch first clears the upper prefixes, then advances the cursor only after success. Only cursor expiry replaces the native tail resource; disconnects do not start a reconnect timer.
