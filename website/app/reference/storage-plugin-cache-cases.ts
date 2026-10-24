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
        "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { cachePlugin, cacheKey } from '@migaia/storage-plugin-cache'\n\nconst original = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'memory' })] })\nconst host = await original.use(\n  cachePlugin({\n    tiers: [{ backend: 'memory', ttlMs: 30000 }],\n    maxAgeMs: 30000,\n    staleAfterMs: 10000,\n    negativeTtlMs: 1000\n  })\n)\nawait host.detect()\ntry {\n  const cache = host.backend('cache')\n  const key = await cacheKey('response', { model: 'model-one', version: 1 })\n  const value = await cache.getOrLoad(\n    key,\n    async (signal) => {\n      if (signal.aborted) return undefined\n      return { answer: 42 }\n    },\n    { meta: { model: 'model-one' } }\n  )\n  console.log(value, await cache.peek(key), cache.stats())\n  await cache.invalidate(key)\n} finally {\n  await host.dispose()\n}",
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
        "import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'\nimport { cachePlugin } from '@migaia/storage-plugin-cache'\nimport { semanticCacheFeature } from '@migaia/storage-plugin-cache/features/semantic'\n\nconst base = await createStorageHost({\n  plugins: [memoryBackendPlugin({ id: 'values' }), memoryBackendPlugin({ id: 'vectors' })]\n})\nconst host = await base.use(\n  cachePlugin(\n    {\n      tiers: [{ backend: 'values', ttlMs: 30000 }]\n    },\n    {\n      semantic: semanticCacheFeature({\n        backend: 'vectors',\n        collection: 'answers',\n        dimensions: 2,\n        minScore: 0.8,\n        ttlMs: 30000,\n        embed: async () => [1, 0]\n      })\n    }\n  )\n)\nawait host.detect()\ntry {\n  const semantic = host.backend('cache').api.semantic\n  await semantic.set('Question', { text: 'Answer' }, { payload: { model: 'one' } })\n  const hit = await semantic.get('Question', { where: { model: 'one' }, candidates: 3 })\n  console.log(hit?.value)\n  await semantic.invalidate({ model: 'one' }, { count: 'scroll' })\n} finally {\n  await host.dispose()\n}",
      result: t(
        'The application reads the original stored response and explicitly releases the host.',
        '应用读取原存储响应并显式释放宿主。'
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
