import { createStorageHost } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { cachePlugin } from '@migaia/storage-plugin-cache'
import { semanticCacheFeature } from '@migaia/storage-plugin-cache/features/semantic'

const base = await createStorageHost({
  plugins: [memoryBackendPlugin({ id: 'values' }), memoryBackendPlugin({ id: 'vectors' })]
})
const host = await base.use(
  cachePlugin(
    {
      tiers: [{ backend: 'values', ttlMs: 30000 }]
    },
    {
      semantic: semanticCacheFeature({
        backend: 'vectors',
        collection: 'answers',
        dimensions: 2,
        minScore: 0.8,
        ttlMs: 30000,
        embed: async () => [1, 0]
      })
    }
  )
)
await host.detect()
try {
  const semantic = host.backend('cache').api.semantic
  await semantic.set('Question', { text: 'Answer' }, { payload: { model: 'one' } })
  const hit = await semantic.get<{ text: string }>('Question', {
    where: { model: 'one' },
    candidates: 3
  })
  if (hit?.value.text !== 'Answer') throw new Error('Built cache semantic value differs')
  await semantic.invalidate({ model: 'one' }, { count: 'scroll' })
} finally {
  await host.dispose()
}
console.log(JSON.stringify({ status: 'PASS', groups: ['cache', 'semantic'] }))
