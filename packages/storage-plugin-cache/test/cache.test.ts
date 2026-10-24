import { describe, it, expect } from 'vitest'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { kv, ttl, lockKey } from '@migaia/storage-contract'
import { cachePlugin, CacheErrorCode, type ICacheOptions } from '../src/index.js'

/** Every case owns fresh native memory tiers and an independently installed cache. */
async function fixture(options: Partial<ICacheOptions> = {}) {
  const host = await createStorageHost({
    plugins: [memoryBackendPlugin({ id: 'fast' }), memoryBackendPlugin({ id: 'slow' })]
  })
  const configured = await host.use(
    cachePlugin({
      tiers: [{ backend: 'fast', ttlMs: 10000 }, { backend: 'slow' }],
      propagate: false,
      ...options
    })
  )
  await configured.detect()
  return {
    host: configured,
    cache: configured.backend('cache'),
    fast: host.backend('fast'),
    slow: host.backend('slow')
  }
}

describe('borrowed multi-tier cache', () => {
  it('loads, reads through and fills without exposing coded values as flat KV', async () => {
    const { host, cache, fast, slow } = await fixture()
    try {
      let loads = 0
      expect(
        await cache.getOrLoad('object', async () => {
          loads++
          return { answer: 42 }
        })
      ).toEqual({ answer: 42 })
      expect(
        await cache.getOrLoad('object', async () => {
          loads++
          return { answer: 9 }
        })
      ).toEqual({ answer: 42 })
      expect(loads).toBe(1)
      expect(await cache.get('object')).toBeNull()
      await cache.set('text', 'hello')
      expect(await cache.get('text')).toBe('hello')
      expect(() => cache.removeByPrefix('text')).toThrowError(
        expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
      )
      expect(await cache.get('text')).toBe('hello')
      await fast.remove('cache:cache:text')
      expect(await cache.get('text')).toBe('hello')
      expect(JSON.parse((await fast.get('cache:cache:text'))!).d).toBe(
        JSON.parse((await slow.get('cache:cache:text'))!).d
      )
      expect(await cache.keys()).toEqual(['text'])
      expect(await cache.removeMany(['text', 'text'])).toBe(1)
      expect(cache.has(kv)).toBe(true)
      expect(cache.has(ttl)).toBe(false)
      expect(cache.capabilities.transactions).toBe(false)
      await cache.dispose()
      await fast.set('business', 'still open')
      expect(await fast.get('business')).toBe('still open')
      expect(() => cache.get('text')).toThrowError(
        expect.objectContaining({ code: 'STORE_DISPOSED' })
      )
    } finally {
      await host.dispose()
    }
  })
  it('shares one loader per key while caller cancellation leaves shared work alive', async () => {
    const { host, cache } = await fixture()
    try {
      let finish!: (value: string) => void,
        loads = 0,
        signal!: AbortSignal
      const done = new Promise<string>((resolve) => {
        finish = resolve
      })
      const load = async (input: AbortSignal) => {
        signal = input
        loads++
        return done
      }
      const abort = new AbortController()
      const first = cache.getOrLoad('a', load, { ctx: { signal: abort.signal } })
      const rejected = expect(first).rejects.toMatchObject({ code: 'ABORTED' })
      const others = Array.from({ length: 29 }, () => cache.getOrLoad('a', load))
      await new Promise((resolve) => setTimeout(resolve, 10))
      abort.abort('one caller')
      await rejected
      expect(signal.aborted).toBe(false)
      finish('shared')
      expect(await Promise.all(others)).toEqual(Array(29).fill('shared'))
      expect(loads).toBe(1)
    } finally {
      await host.dispose()
    }
  })
  it('drains bypass work after its sole caller aborts', async () => {
    const { host, cache } = await fixture()
    try {
      let finish!: (value: string) => void, started!: () => void
      const began = new Promise<void>((resolve) => {
        started = resolve
      })
      const abort = new AbortController()
      const result = cache.getOrLoad(
        'bypass',
        async () => {
          started()
          return new Promise<string>((resolve) => {
            finish = resolve
          })
        },
        { mode: 'bypass', ctx: { signal: abort.signal } }
      )
      const failed = expect(result).rejects.toMatchObject({ code: 'ABORTED' })
      await began
      abort.abort('caller only')
      await failed
      let closed = false
      const disposing = cache.dispose().then(() => {
        closed = true
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(closed).toBe(false)
      finish('late true value')
      await disposing
      expect(closed).toBe(true)
    } finally {
      await host.dispose()
    }
  })
  it('supersedes a detached old flight and does not store its late result', async () => {
    const { host, cache } = await fixture()
    try {
      let finish!: (value: string) => void
      const started = cache.getOrLoad(
        'a',
        () =>
          new Promise<string>((resolve) => {
            finish = resolve
          })
      )
      await new Promise((resolve) => setTimeout(resolve, 5))
      await cache.invalidate('a')
      expect(await cache.getOrLoad('a', async () => 'new')).toBe('new')
      finish('old')
      expect(await started).toBe('old')
      expect(await cache.getOrLoad('a', async () => 'wrong')).toBe('new')
    } finally {
      await host.dispose()
    }
  })
  it('returns stale values, refreshes once and enforces an envelope hard expiry', async () => {
    let now = 1000
    const { host, cache, fast } = await fixture({
      maxAgeMs: 100,
      staleAfterMs: 20,
      clock: () => now
    })
    try {
      expect(await cache.getOrLoad('a', async () => 'one')).toBe('one')
      now += 25
      let finish!: (value: string) => void,
        loads = 0
      const load = () => {
        loads++
        return new Promise<string>((resolve) => {
          finish = resolve
        })
      }
      expect(await cache.getOrLoad('a', load)).toBe('one')
      expect(await cache.getOrLoad('a', load)).toBe('one')
      expect(loads).toBe(1)
      finish('two')
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(await cache.peek('a')).toMatchObject({ value: 'two', stale: false })
      expect(await fast.use(ttl).remaining(lockKey.text('cache:cache:a'))).toBeLessThanOrEqual(100)
      now += 101
      expect(await cache.getOrLoad('a', async () => 'three')).toBe('three')
    } finally {
      await host.dispose()
    }
  })
  it('caches negatives, honors bypass and does not cache callback failures', async () => {
    const { host, cache } = await fixture({ negativeTtlMs: 100 })
    try {
      let loads = 0
      const missing = async () => {
        loads++
        return undefined
      }
      expect(await cache.getOrLoad('a', missing)).toBeUndefined()
      expect(await cache.getOrLoadEntry('a', missing)).toMatchObject({ negative: true })
      expect(loads).toBe(1)
      expect(await cache.get('a')).toBeNull()
      expect(await cache.getOrLoad('a', async () => 'bypass', { mode: 'bypass' })).toBe('bypass')
      expect((await cache.peek('a'))?.negative).toBe(true)
      const original = new RangeError('business source failed')
      await expect(
        cache.getOrLoad('failed', async () => {
          throw original
        })
      ).rejects.toMatchObject({ code: CacheErrorCode.loadFailed, cause: original })
      expect(await cache.peek('failed')).toBeUndefined()
    } finally {
      await host.dispose()
    }
  })
  it('coalesces pending writes and flushes once without closing borrowed storage', async () => {
    const { host, cache, fast } = await fixture({
      tiers: [{ backend: 'fast', write: 'back', ttlMs: 10000 }, { backend: 'slow' }],
      writeBackIntervalMs: 10000
    })
    try {
      await cache.set('a', 'one')
      await cache.set('a', 'two')
      expect(await fast.get('cache:cache:a')).toBeNull()
      expect(await cache.get('a')).toBe('two')
      await cache.flush()
      expect(await fast.get('cache:cache:a')).toContain('two')
      await cache.set('b', 'final')
      await cache.dispose()
      expect(await fast.get('cache:cache:b')).toContain('final')
    } finally {
      await host.dispose()
    }
  })
  it('isolates org projections and preserves ordinary business values during clear', async () => {
    const { host, cache, fast } = await fixture()
    try {
      const org = host.org('11111111-1111-4111-8111-111111111111').backend('cache')
      await fast.set('business', 'safe')
      await cache.set('a', 'default')
      await org.set('a', 'org')
      expect(await cache.get('a')).toBe('default')
      expect(await org.get('a')).toBe('org')
      await org.clearAll()
      expect(await org.get('a')).toBeNull()
      expect(await cache.get('a')).toBe('default')
      expect(await fast.get('business')).toBe('safe')
    } finally {
      await host.dispose()
    }
  })
  it('rejects configuration and non-string shared keys before native writes', async () => {
    const original = new RangeError('cache identity accessor')
    expect(() =>
      cachePlugin({
        get id(): string {
          throw original
        },
        tiers: [{ backend: 'a' }]
      })
    ).toThrowError(expect.objectContaining({ code: 'CACHE_TIER_INVALID', cause: original }))
    expect(() => cachePlugin(null as never)).toThrowError(
      expect.objectContaining({ code: 'CACHE_TIER_INVALID' })
    )
    expect(() => cachePlugin({ tiers: [{ backend: 'a', write: 'back' }] })).toThrowError()
    expect(() => cachePlugin({ tiers: [{ backend: 'a', ttlMs: 0 }] })).toThrowError()
    const { host, cache, fast } = await fixture()
    try {
      expect(() => cache.getMany([['tuple']])).toThrowError()
      const sparse: unknown[] = []
      sparse.length = 1
      for (const input of [null, {}, [null], sparse])
        expect(() => cache.setMany(input as never)).toThrowError(
          expect.objectContaining({ code: 'INVALID_ARGUMENT' })
        )
      expect(await fast.keys()).toEqual([])
      expect(() => cache.getOrLoad('a', async () => 'x', { ttlMs: 20000 })).toThrowError()
    } finally {
      await host.dispose()
    }
  })
})
