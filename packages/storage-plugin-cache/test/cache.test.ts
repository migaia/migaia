import { describe, it, expect } from 'vitest'
import {
  createStorageHost,
  memoryBackendPlugin,
  definePlugin,
  defineStorageBackendKind,
  type IStoragePluginCore
} from '@migaia/storage-host'
import { kv, ttl, lockKey, type IStorageBase } from '@migaia/storage-contract'
import { IdentifyError, walkErrorCauses } from '@migaia/utils/error'
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
  it('admits only earlier capable tiers and keeps independently configured cache prefixes separate', async () => {
    const invalid: Partial<ICacheOptions>[] = [
      { tiers: [{ backend: 'a' }, { backend: 'a' }] },
      { tiers: [{ backend: 'a', write: 'back' }] },
      { tiers: [{ backend: 'a', ttlMs: 1.5 }] },
      { tiers: [{ backend: 'a', ttlMs: 0 }] },
      { maxAgeMs: 100, staleAfterMs: 100 },
      { tiers: [{ backend: 'a', offload: { backend: 'objects', minBytes: 1024 } }] }
    ]
    for (const options of invalid) {
      const host = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'a' })] })
      try {
        expect(() => cachePlugin({ tiers: [{ backend: 'a' }], ...options })).toThrowError(
          expect.objectContaining({ source: 'storage.backend.cache', code: 'CACHE_TIER_INVALID' })
        )
      } finally {
        await host.dispose()
      }
    }
    for (const options of [
      { tiers: [{ backend: 'a' }, { backend: 'b' }] },
      { tiers: [{ backend: 'a', ttlMs: 100, write: 'back' as const }, { backend: 'b' }] }
    ] as const) {
      const host = await createStorageHost({
        plugins: [memoryBackendPlugin({ id: 'a' }), memoryBackendPlugin({ id: 'b' })]
      })
      try {
        const failure = await host.use(cachePlugin(options)).catch((error) => error)
        expect(walkErrorCauses(failure)).toContainEqual(
          expect.objectContaining({
            source: 'storage.backend.cache',
            code: 'CACHE_TIER_INVALID',
            tier: 0
          })
        )
      } finally {
        await host.dispose()
      }
    }
    for (const sameBatch of [false, true]) {
      const host = await createStorageHost()
      try {
        const plugin = cachePlugin({ tiers: [{ backend: 'future' }] })
        const failure = await (
          sameBatch ? host.use(memoryBackendPlugin({ id: 'future' }), plugin) : host.use(plugin)
        ).catch((error) => error)
        expect(walkErrorCauses(failure)).toContainEqual(
          expect.objectContaining({ code: 'BACKEND_NOT_INSTALLED' })
        )
      } finally {
        await host.dispose()
      }
    }
    const emptyKind = defineStorageBackendKind<IStorageBase, undefined>()('empty')
    const raw = definePlugin('empty', (core: IStoragePluginCore) => ({
      kind: emptyKind,
      featureExpose: () => ({ getClient: () => undefined }),
      install() {
        core.registerStore({
          backend: 'empty',
          capabilities: {
            syncRead: false,
            binary: false,
            records: false,
            transactions: false,
            iteration: false,
            secondaryIndexes: false,
            changeFeed: false,
            maxValueBytes: undefined,
            opaqueEntries: false
          },
          dispose: async () => {},
          [Symbol.asyncDispose]: async () => {}
        })
        return {}
      }
    }))
    const host = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'a' }), raw] })
    try {
      const failure = await host
        .use(cachePlugin({ propagate: false, tiers: [{ backend: 'a' }, { backend: 'empty' }] }))
        .catch((error) => error)
      const missing = walkErrorCauses(failure).find(
        (error) => IdentifyError.identityOf(error)?.code === 'UNSUPPORTED_CAPABILITY'
      )
      expect(missing).toMatchObject({
        source: '@migaia/storage-contract',
        code: 'UNSUPPORTED_CAPABILITY',
        message: expect.stringContaining('1')
      })
      const inner = await host.use(
        cachePlugin({ id: 'inner', propagate: false, tiers: [{ backend: 'a' }] })
      )
      for (const options of [
        { tiers: [{ backend: 'inner', ttlMs: 10 }] },
        { tiers: [{ backend: 'inner' }], stampedeLock: { backend: 'inner' } }
      ] as const) {
        const error = await inner
          .use(cachePlugin({ propagate: false, ...options }))
          .catch((value) => value)
        expect(walkErrorCauses(error)).toContainEqual(
          expect.objectContaining({
            code: 'UNSUPPORTED_CAPABILITY',
            message: expect.stringContaining('0')
          })
        )
      }
      const configured = await host.use(
        cachePlugin({ id: 'one', prefix: 'one:', propagate: false, tiers: [{ backend: 'a' }] }),
        cachePlugin({ id: 'two', prefix: 'two:', propagate: false, tiers: [{ backend: 'a' }] })
      )
      await configured.detect()
      await configured.backend('one').set('same', 'first')
      await configured.backend('two').set('same', 'second')
      expect(await configured.backend('one').get('same')).toBe('first')
      expect(await configured.backend('two').get('same')).toBe('second')
      expect(() =>
        configured.backend('one').getOrLoad('tag', async () => 'value', { tags: ['doc'] })
      ).toThrowError(expect.objectContaining({ code: 'CACHE_TIER_INVALID' }))
    } finally {
      await host.dispose()
    }
  })
  it('coalesces thirty callers for each of three independent keys', async () => {
    const { host, cache } = await fixture()
    try {
      const loads = [0, 0, 0]
      const results = await Promise.all(
        [0, 1, 2].flatMap((key) =>
          Array.from({ length: 30 }, () =>
            cache.getOrLoad('key' + key, async () => {
              loads[key]!++
              await new Promise((resolve) => setTimeout(resolve, 5))
              return key
            })
          )
        )
      )
      expect(loads).toEqual([1, 1, 1])
      expect(results).toEqual([0, 1, 2].flatMap((key) => Array(30).fill(key)))
    } finally {
      await host.dispose()
    }
  })
  it('keeps stale data after background failure and expires negative entries without caching failures', async () => {
    let now = 1000
    const reports: unknown[] = []
    const base = await createStorageHost({
      report: (error) => {
        reports.push(error)
      },
      plugins: [memoryBackendPlugin({ id: 'tier' })]
    })
    const host = await base.use(
      cachePlugin({
        propagate: false,
        clock: () => now,
        maxAgeMs: 100,
        staleAfterMs: 20,
        negativeTtlMs: 10,
        tiers: [{ backend: 'tier' }]
      })
    )
    await host.detect()
    try {
      const cache = host.backend('cache'),
        original = new RangeError('background source failed')
      await cache.getOrLoad('stale', async () => 'old')
      now += 21
      expect(
        await cache.getOrLoad('stale', async () => {
          throw original
        })
      ).toBe('old')
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(reports).toEqual([
        expect.objectContaining({ code: 'CACHE_LOAD_FAILED', cause: original })
      ])
      expect((await cache.peek('stale'))?.value).toBe('old')
      let loads = 0
      const missing = async () => {
        loads++
        return undefined
      }
      await cache.getOrLoad('negative', missing)
      await cache.getOrLoad('negative', missing)
      expect(loads).toBe(1)
      now += 11
      await cache.getOrLoad('negative', missing)
      expect(loads).toBe(2)
      now = 1101
      expect(await cache.getOrLoad('stale', async () => 'new')).toBe('new')
      const unbounded = await host.use(
        cachePlugin({ id: 'no-negative', propagate: false, tiers: [{ backend: 'tier' }] })
      )
      await unbounded.detect()
      const noNegative = unbounded.backend('no-negative')
      await noNegative.getOrLoad('missing', missing)
      await noNegative.getOrLoad('missing', missing)
      expect(loads).toBe(4)
    } finally {
      await host.dispose()
    }
  })
  it('drops each failed back write once and never flushes invalidated pending values', async () => {
    let writes = 0
    const reports: unknown[] = [],
      original = new RangeError('back write failed')
    const observer = definePlugin('back-errors', (core) => ({
      install() {
        core.useAsyncPipeline((input, next) => {
          if (input.backendId === 'fast' && input.operation === 'set') {
            writes++
            throw original
          }
          return next(input)
        })
        return {}
      }
    }))
    const base = await createStorageHost({
      report: (error) => {
        reports.push(error)
      },
      plugins: [memoryBackendPlugin({ id: 'fast' }), memoryBackendPlugin({ id: 'slow' }), observer]
    })
    const host = await base.use(
      cachePlugin({
        propagate: false,
        writeBackIntervalMs: 10000,
        tiers: [{ backend: 'fast', write: 'back', ttlMs: 10000 }, { backend: 'slow' }]
      })
    )
    await host.detect()
    const dropped: unknown[] = []
    host.hooks.on('onCacheWriteBackDropped', (event) => {
      dropped.push(event)
    })
    try {
      const cache = host.backend('cache')
      await cache.set('a', 'one')
      await cache.set('a', 'two')
      await cache.flush()
      await cache.flush()
      expect(writes).toBe(1)
      expect(cache.stats().writeBackDropped).toBe(1)
      expect(dropped).toEqual([expect.objectContaining({ tier: 0, count: 1 })])
      expect(reports).toContain(original)
      await cache.set('removed', 'value')
      await cache.remove('removed')
      await cache.set('prefix:a', 'value')
      await cache.invalidate({ prefix: 'prefix:' })
      await cache.set('cleared', 'value')
      await cache.clearAll()
      await cache.flush()
      expect(writes).toBe(1)
      expect(await base.backend('slow').keys()).toEqual([])
    } finally {
      await host.dispose()
    }
  })
  it('reports corrupt reads and native tier failures while keeping exact hook counters and lazy payloads', async () => {
    let now = 1000,
      failing = false,
      builds = 0
    const reports: unknown[] = [],
      original = new RangeError('tier read or write failed')
    let emit!: IStoragePluginCore['emit']
    const observer = definePlugin('tier-errors', (core) => ({
      install() {
        emit = core.emit
        core.useAsyncPipeline((input, next) => {
          if (
            failing &&
            (input.backendId === 'zero' || input.backendId === 'one') &&
            input.operation === 'get'
          )
            throw original
          if (
            failing &&
            (input.backendId === 'zero' || input.backendId === 'two') &&
            input.operation === 'set'
          )
            throw original
          return next(input)
        })
        return {}
      }
    }))
    const base = await createStorageHost({
      report: (error) => {
        reports.push(error)
      },
      plugins: [
        memoryBackendPlugin({ id: 'zero' }),
        memoryBackendPlugin({ id: 'one' }),
        memoryBackendPlugin({ id: 'two' }),
        observer
      ]
    })
    const host = await base.use(
      cachePlugin({
        propagate: false,
        clock: () => now,
        maxAgeMs: 100,
        staleAfterMs: 20,
        negativeTtlMs: 10,
        tiers: [{ backend: 'zero' }, { backend: 'one' }, { backend: 'two' }]
      })
    )
    await host.detect()
    const hits: unknown[] = [],
      misses: unknown[] = [],
      loads: unknown[] = [],
      errors: { tier: number; operation: string; code?: string }[] = []
    try {
      emit('onCacheHit', () => {
        builds++
        return {
          backendId: 'cache',
          backend: 'cache',
          orgId: '00000000-0000-0000-0000-000000000000',
          tier: 0,
          stale: false,
          negative: false
        }
      })
      expect(builds).toBe(0)
      host.hooks.on('onCacheHit', (event) => {
        hits.push(event)
      })
      host.hooks.on('onCacheMiss', (event) => {
        misses.push(event)
      })
      host.hooks.on('onCacheLoad', (event) => {
        loads.push(event)
      })
      host.hooks.on('onCacheTierError', (event) => {
        errors.push(event)
      })
      const raw = (value: string) =>
        JSON.stringify({ v: 1, s: 'hit', t: 's', d: value, w: now, x: 1100, g: [] })
      await base.backend('zero').set('cache:cache:a', raw('A'))
      await base.backend('one').set('cache:cache:b', raw('B'))
      await base.backend('two').set('cache:cache:c', raw('C'))
      for (const [key, value, tier] of [
        ['a', 'A', 0],
        ['b', 'B', 1],
        ['c', 'C', 2]
      ] as const) {
        expect(await host.backend('cache').getOrLoadEntry(key, async () => 'wrong')).toMatchObject({
          value,
          tier,
          stale: false,
          negative: false
        })
        expect(
          JSON.parse((await base.backend('zero').get('cache:cache:' + key))!).x
        ).toBeLessThanOrEqual(1100)
      }
      expect(host.backend('cache').stats()).toMatchObject({
        hits: [1, 1, 1],
        misses: [2, 1, 0],
        loads: 0
      })
      expect(hits).toHaveLength(3)
      expect(misses).toHaveLength(3)
      expect(loads).toHaveLength(0)
      await base.backend('zero').set('cache:cache:broken', '{')
      expect(await host.backend('cache').getOrLoad('broken', async () => 'repaired')).toBe(
        'repaired'
      )
      expect(errors.filter((event) => event.operation === 'decode')).toEqual([
        expect.objectContaining({ tier: 0 })
      ])
      failing = true
      expect(await host.backend('cache').getOrLoad('c', async () => 'wrong')).toBe('C')
      expect(
        errors.filter((event) => event.operation === 'get').map((event) => event.tier)
      ).toEqual([0, 1])
      expect(await host.backend('cache').getOrLoad('new', async () => 'source')).toBe('source')
      expect(
        errors.filter((event) => event.operation === 'set').map((event) => event.tier)
      ).toContain(2)
      failing = false
      expect(await base.backend('one').get('cache:cache:new')).toContain('source')
      host.hooks.on('onCacheHit', () => {
        throw original
      })
      expect(await host.backend('cache').getOrLoad('new', async () => 'wrong')).toBe('source')
      expect(reports).toContain(original)
      const cache = host.backend('cache'),
        invalidations: unknown[] = []
      host.hooks.on('onCacheInvalidate', (event) => {
        invalidations.push(event)
      })
      await cache.getOrLoad('negative', async () => undefined)
      expect(await cache.getOrLoadEntry('negative', async () => 'wrong')).toMatchObject({
        tier: 0,
        stale: false,
        negative: true
      })
      now = 1021
      expect(await cache.getOrLoadEntry('a', async () => 'refreshed')).toMatchObject({
        value: 'A',
        tier: 0,
        stale: true,
        negative: false
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      await cache.invalidate('negative')
      expect(cache.stats()).toMatchObject({
        hits: [3, 2, 2],
        misses: [7, 5, 3],
        loads: 4,
        staleServed: 1,
        negativeHits: 1,
        invalidations: 1
      })
      expect(hits).toHaveLength(7)
      expect(misses).toHaveLength(15)
      expect(loads).toHaveLength(4)
      expect(invalidations).toHaveLength(1)
      now = 1122
      for (const key of ['a', 'b', 'c'])
        expect(await host.backend('cache').getOrLoad(key, async () => 'expired')).toBe('expired')
      expect(loads).toHaveLength(7)
    } finally {
      await host.dispose()
    }
  })
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
      expect(
        await cache.getOrLoadEntry('source-info', async () => 'loaded', { meta: { source: true } })
      ).toMatchObject({
        value: 'loaded',
        tier: undefined,
        stale: false,
        negative: false,
        meta: { source: true }
      })
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
  it.each(['key', 'remove', 'prefix'] as const)(
    'supersedes a detached old flight through %s without storing its late result',
    async (method) => {
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
        if (method === 'key') await cache.invalidate('a')
        else if (method === 'remove') await cache.remove('a')
        else await cache.invalidate({ prefix: 'a' })
        expect(await cache.getOrLoad('a', async () => 'new')).toBe('new')
        finish('old')
        expect(await started).toBe('old')
        expect(await cache.getOrLoad('a', async () => 'wrong')).toBe('new')
      } finally {
        await host.dispose()
      }
    }
  )
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
