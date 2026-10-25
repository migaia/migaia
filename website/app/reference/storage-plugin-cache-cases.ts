import type { ICaseDoc, IText } from './contract.js'
/** Both language versions describe the same executable canonical request example. */
const t = (en: string, zh: string): IText => ({ en, zh })
/**
 * Request identities use the package's real portable projection rather than application JSON
 * ordering.
 */
export const storagePluginCacheCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  cachePlugin: [
    {
      title: t('Load through a published tier', '经已发布层回源'),
      problem: t(
        'Use the original published storage owners in a later cache installation batch.',
        '在后续缓存安装批次中使用原已发布存储拥有者。'
      ),
      example:
        "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { cachePlugin, cacheKey } from '@migaia/storage-plugin-cache'\n\nconst original = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'memory' })] })\nconst host = await original.use(\n  cachePlugin({\n    id: 'cache',\n    prefix: 'responses:',\n    tiers: [{ backend: 'memory', ttlMs: 30000 }],\n    maxAgeMs: 30000,\n    staleAfterMs: 10000,\n    negativeTtlMs: 1000\n  })\n)\nawait host.detect()\ntry {\n  const cache = host.backend('cache')\n  const key = await cacheKey('response', { model: 'model-one', version: 1 })\n  const value = await cache.getOrLoad(\n    key,\n    async (signal) => {\n      if (signal.aborted) return undefined\n      return { answer: 42 }\n    },\n    { meta: { model: 'model-one' } }\n  )\n  console.log(value, await cache.peek(key), cache.stats())\n  await cache.invalidate(key)\n} finally {\n  await host.dispose()\n}",
      result: t(
        'The application reads the original stored response and explicitly releases the host.',
        '应用读取原存储响应并显式释放宿主。'
      )
    }
  ],
  semanticCacheFeature: [
    {
      title: t('Match an answer through its native vector engine', '经原向量引擎匹配回答'),
      problem: t(
        'Use the original published storage owners in a later cache installation batch.',
        '在后续缓存安装批次中使用原已发布存储拥有者。'
      ),
      example:
        "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { cachePlugin } from '@migaia/storage-plugin-cache'\nimport { semanticCacheFeature } from '@migaia/storage-plugin-cache/features/semantic'\n\nconst base = await createStorageHost({\n  plugins: [memoryBackendPlugin({ id: 'values' }), memoryBackendPlugin({ id: 'vectors' })]\n})\nconst host = await base.use(\n  cachePlugin(\n    {\n      tiers: [{ backend: 'values', ttlMs: 30000 }]\n    },\n    {\n      semantic: semanticCacheFeature({\n        backend: 'vectors',\n        collection: 'answers',\n        dimensions: 2,\n        metric: 'cosine',\n        minScore: 0.8,\n        ttlMs: 30000,\n        embed: async () => [1, 0]\n      })\n    }\n  )\n)\nawait host.detect()\ntry {\n  const semantic = host.backend('cache').api.semantic\n  await semantic.set('Question', { text: 'Answer' }, { payload: { model: 'one' } })\n  const hit = await semantic.get('Question', { where: { model: 'one' }, candidates: 3 })\n  console.log(hit?.value)\n  const loaded = await semantic.getOrLoad(\n    'Second question',\n    async () => ({ text: 'Loaded answer' }),\n    { where: { model: 'two' }, payload: { model: 'two' } }\n  )\n  console.log(loaded.value)\n  await semantic.invalidate({ model: 'one' }, { count: 'scroll' })\n} finally {\n  await host.dispose()\n}",
      result: t(
        'The application reads the original stored response and explicitly releases the host.',
        '应用读取原存储响应并显式释放宿主。'
      )
    }
  ],
  cachePolicy: [
    {
      title: t('Choose write timing and a native miss lock', '选择写入时机与原生缺失锁'),
      problem: t(
        'Delay upper-tier writes while one published lower tier owns cross-client miss rechecking.',
        '延后上层写入，同时让已发布的下层原生事务负责跨客户端缺失复查。'
      ),
      example: `import { cachePlugin, CacheWriteMode } from '@migaia/storage-plugin-cache'
const plugin = cachePlugin({
  tiers: [
    { backend: 'fast', ttlMs: 10000, write: CacheWriteMode.back },
    { backend: 'slow', ttlMs: 30000 }
  ],
  stampedeLock: { backend: 'slow', timeoutMs: 5000 },
  writeBackIntervalMs: 2000,
  propagate: false
})`,
      result: t(
        'Creates a lazy plan for later installation after fast and slow. Disabling propagation leaves the hard tier lifetimes in force.',
        '创建应在快慢两层之后安装的惰性方案；关闭失效传播后，各层硬期限仍然有效。'
      )
    }
  ],
  cacheClock: [
    {
      title: t('Shorten lifetimes with wall-clock jitter', '使用墙钟抖动缩短期限'),
      problem: t(
        'Avoid synchronized expiry without extending the configured native lifetime.',
        '在不延长配置原生期限的前提下，避免大量条目同时到期。'
      ),
      example: `import { cachePlugin } from '@migaia/storage-plugin-cache'
const plugin = cachePlugin({
  tiers: [{ backend: 'memory', ttlMs: 30000 }],
  clock: Date.now,
  jitterRatio: 0.1,
  random: Math.random
})`,
      result: t(
        'Uses wall-clock timestamps and samples the supplied random function for each finite expiry reduction.',
        '使用墙钟时间戳，每次实际缩短有限期限时调用所提供的随机函数。'
      )
    }
  ],
  cacheCodec: [
    {
      title: t('Select a JSON codec identity and dependency tags', '选择 JSON 编码身份与依赖标签'),
      problem: t(
        'Choose the original JSON text codec version and index later tag invalidation in a published records backend.',
        '选择原 JSON 文字编码器版本，并在已发布记录后端中索引后续标签失效。'
      ),
      example:
        "import { cachePlugin } from '@migaia/storage-plugin-cache'\nimport { fromValueCodec } from '@migaia/storage-host/authoring/codec'\nimport { defineJsonCodec } from '@migaia/serialize/codecs/json'\nconst plugin = cachePlugin({\n  tiers: [{ backend: 'memory', ttlMs: 30000 }],\n  codec: fromValueCodec(defineJsonCodec({ version: 2 })),\n  tagIndex: { backend: 'records' }\n})",
      result: t(
        'Creates a lazy configuration. Installation requires the earlier records backend to provide records and TTL capabilities.',
        '创建惰性配置；安装时要求更早的记录后端同时提供记录与期限能力。'
      )
    }
  ],
  cacheKey: [
    {
      title: t('Normalize a request key', '规范化请求键'),
      problem: t(
        'Equivalent request objects can arrive with different field order.',
        '等价请求对象可能具有不同字段顺序。'
      ),
      example: `import { cacheKey } from '@migaia/storage-plugin-cache'
const first = await cacheKey('response', { model: 'one', version: 1 })
const responses = new Map([[first, { answer: 42 }]])
const second = await cacheKey('response', { version: 1, model: 'one' })
console.log(responses.get(second))`,
      result: t(
        'Reads the same cached response; the serializer sorts object fields before hashing.',
        '读取同一缓存响应；serializer 在哈希前规范排序对象字段。'
      )
    }
  ]
}
