import { expect, it } from 'vitest'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { cachePlugin } from '../src/index.js'

/** Real native memory commits deliver through the original subscription owner. */
it('routes ephemeral commits by immutable org and ignores non-value channels and unrelated keys', async () => {
  const base = await createStorageHost({
    plugins: [memoryBackendPlugin({ id: 'fast' }), memoryBackendPlugin({ id: 'slow' })]
  })
  const host = await base.use(
    cachePlugin({ tiers: [{ backend: 'fast', ttlMs: 10000 }, { backend: 'slow' }] })
  )
  await host.detect()
  try {
    const cache = host.backend('cache'),
      fast = base.backend('fast'),
      slow = base.backend('slow')
    await cache.set('a', 'initial')
    expect(await cache.get('a')).toBe('initial')
    const original = JSON.parse((await slow.get('cache:cache:a'))!)
    await slow.set('unrelated', 'business')
    expect(await fast.get('cache:cache:a')).not.toBeNull()
    await slow.putRecord({ value: 1 }, ['record'])
    expect(await fast.get('cache:cache:a')).not.toBeNull()
    await slow.set('cache:cache:a', JSON.stringify({ ...original, d: 'external', w: Date.now() }))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await fast.get('cache:cache:a')).toBeNull()
    expect(await cache.get('a')).toBe('external')
    const orgId = crypto.randomUUID(),
      org = host.org(orgId).backend('cache')
    await org.set('a', 'organization')
    expect(await org.get('a')).toBe('organization')
    const orgRaw = JSON.parse((await base.org(orgId).backend('slow').get('cache:cache:a'))!)
    await base
      .org(orgId)
      .backend('slow')
      .set('cache:cache:a', JSON.stringify({ ...orgRaw, d: 'org-external', w: Date.now() }))
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await org.get('a')).toBe('org-external')
    expect(await cache.get('a')).toBe('external')
    await fast.set('business', 'safe')
    await slow.clearValues()
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(await fast.get('cache:cache:a')).toBeNull()
    expect(await fast.get('business')).toBe('safe')
  } finally {
    await host.dispose()
  }
})
