import { expectTypeOf } from 'vitest'
import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { kv, ttl } from '@migaia/storage-contract'
import { cachePlugin, type ICacheEntryInfo, type ICacheStats } from '@migaia/storage-plugin-cache'
import {
  semanticCacheFeature,
  type ISemanticHit,
  type ISemanticLoaded
} from '@migaia/storage-plugin-cache/features/semantic'

/**
 * Public consumers retain concrete values and optional Feature methods without gaining
 * transactions.
 */
async function composition() {
  const base = await createStorageHost({
    plugins: [memoryBackendPlugin({ id: 'memory' }), memoryBackendPlugin({ id: 'vectors' })]
  })
  const host = await base.use(
    cachePlugin(
      { tiers: [{ backend: 'memory' }], propagate: false },
      {
        semantic: semanticCacheFeature({
          backend: 'vectors',
          collection: 'answers',
          dimensions: 2,
          minScore: 0.8,
          embed: async () => [1, 0]
        })
      }
    )
  )
  await host.detect()
  const cache = host.backend('cache')
  expectTypeOf(cache.getOrLoad('a', async () => ({ answer: 1 }))).toEqualTypeOf<
    Promise<{ answer: number } | undefined>
  >()
  expectTypeOf(cache.getOrLoadEntry<number>('a', async () => 1)).toEqualTypeOf<
    Promise<ICacheEntryInfo<number>>
  >()
  expectTypeOf(cache.getOrLoadMany(['a'], async () => new Map([['a', 1]]))).toEqualTypeOf<
    Promise<ReadonlyMap<string, number | undefined>>
  >()
  expectTypeOf(cache.peek<number>('a')).toEqualTypeOf<
    Promise<ICacheEntryInfo<number> | undefined>
  >()
  expectTypeOf(cache.stats()).toEqualTypeOf<ICacheStats>()
  expectTypeOf(cache.use(kv).getMany(['a'])).toEqualTypeOf<
    Promise<readonly (string | undefined)[]>
  >()
  expectTypeOf(cache.api.semantic.get<number>('prompt')).toEqualTypeOf<
    Promise<ISemanticHit<number> | undefined>
  >()
  expectTypeOf(cache.api.semantic.getOrLoad<number>('prompt', async () => 1)).toEqualTypeOf<
    Promise<ISemanticHit<number> | ISemanticLoaded<number>>
  >()
  expectTypeOf(cache.api.semantic.invalidate({ model: 'one' }, { count: 'scroll' })).toEqualTypeOf<
    Promise<number>
  >()
  await cache.invalidate('a')
  await cache.invalidate({ prefix: 'answer:' })
  await cache.invalidate({ tag: 'document' })
  // @ts-expect-error Cross-store cache transactions are not offered.
  cache.tx()
  // @ts-expect-error Cache KV publication does not claim a TTL capability.
  cache.use(ttl)
  await host.dispose()
}
void composition
