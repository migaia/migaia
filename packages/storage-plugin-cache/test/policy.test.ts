import { describe, expect, it } from 'vitest'
import { createStorageHost, memoryBackendPlugin, definePlugin } from '@migaia/storage-host'
import { blob, records, ttl, lockKey } from '@migaia/storage-contract'
import { cachePlugin } from '../src/index.js'

describe('cache policy composition', () => {
  it('uses one native batch per layer and joins a single-key caller to the same batch source', async () => {
    const calls: { backendId: string; operation: string }[] = []
    const observer = definePlugin('observer', (core) => ({
      install() {
        core.useAsyncPipeline((input, next) => {
          calls.push({ backendId: input.backendId, operation: input.operation })
          return next(input)
        })
        return {}
      }
    }))
    const base = await createStorageHost({
      plugins: [memoryBackendPlugin({ id: 'fast' }), memoryBackendPlugin({ id: 'slow' }), observer]
    })
    const host = await base.use(
      cachePlugin({ propagate: false, tiers: [{ backend: 'fast' }, { backend: 'slow' }] })
    )
    await host.detect()
    try {
      const cache = host.backend('cache')
      let finish!: () => void,
        loads = 0
      const gate = new Promise<void>((resolve) => {
        finish = resolve
      })
      const batch = cache.getOrLoadMany(['a', 'b', 'a'], async (keys) => {
        loads++
        expect(keys).toEqual(['a', 'b'])
        await gate
        return new Map([
          ['a', 'A'],
          ['b', 'B']
        ])
      })
      await new Promise((resolve) => setTimeout(resolve, 5))
      const one = cache.getOrLoad('a', async () => 'wrong')
      finish()
      expect(await batch).toEqual(
        new Map([
          ['a', 'A'],
          ['b', 'B']
        ])
      )
      expect(await one).toBe('A')
      expect(loads).toBe(1)
      for (const id of ['fast', 'slow']) {
        expect(
          calls.filter((call) => call.backendId === id && call.operation === 'getMany')
        ).toHaveLength(1)
        expect(
          calls.filter((call) => call.backendId === id && call.operation === 'setMany')
        ).toHaveLength(1)
      }
      calls.length = 0
      expect(
        await cache.getOrLoadMany(['a', 'b'], async () => {
          throw new Error('not called')
        })
      ).toEqual(
        new Map([
          ['a', 'A'],
          ['b', 'B']
        ])
      )
      expect(
        calls.filter((call) => call.operation === 'getMany' && call.backendId === 'fast')
      ).toHaveLength(1)
      expect(
        calls.filter((call) => call.operation === 'getMany' && call.backendId === 'slow')
      ).toHaveLength(0)
    } finally {
      await host.dispose()
    }
  })
  it('indexes tags first and invalidates only the selected application dependency', async () => {
    const base = await createStorageHost({
      plugins: [memoryBackendPlugin({ id: 'tier' }), memoryBackendPlugin({ id: 'tags' })]
    })
    const host = await base.use(
      cachePlugin({
        propagate: false,
        tiers: [{ backend: 'tier', ttlMs: 10000 }],
        tagIndex: { backend: 'tags' }
      })
    )
    await host.detect()
    try {
      const cache = host.backend('cache')
      await cache.getOrLoad('a', async () => ({ answer: 1 }), {
        tags: ['doc:1', 'doc:2'],
        meta: { model: 'm' }
      })
      await cache.getOrLoad('b', async () => ({ answer: 2 }), { tags: ['doc:2'] })
      expect(await cache.peek('a')).toMatchObject({
        tags: ['doc:1', 'doc:2'],
        meta: { model: 'm' }
      })
      expect(await host.backend('tags').use(records).query().count()).toBe(3)
      expect(
        await host
          .backend('tags')
          .use(ttl)
          .remaining(lockKey.record(['cache:cache:', 'doc:1', 'a']))
      ).toBeGreaterThan(0)
      await cache.invalidate({ tag: 'doc:1' })
      expect(await cache.peek('a')).toBeUndefined()
      expect((await cache.peek('b'))?.value).toEqual({ answer: 2 })
    } finally {
      await host.dispose()
    }
  })
  it('offloads full encoded content, reuses native content hash and deletes references independently', async () => {
    let now = Date.now()
    const base = await createStorageHost({
      plugins: [memoryBackendPlugin({ id: 'tier' }), memoryBackendPlugin({ id: 'objects' })]
    })
    const host = await base.use(
      cachePlugin({
        propagate: false,
        clock: () => now,
        tiers: [{ backend: 'tier', ttlMs: 1000, offload: { backend: 'objects', minBytes: 1 } }]
      })
    )
    await host.detect()
    try {
      const cache = host.backend('cache'),
        objects = host.backend('objects').use(blob)
      const value = { answer: 'large'.repeat(100) }
      expect(await cache.getOrLoad('a', async () => value)).toEqual(value)
      const raw = JSON.parse((await host.backend('tier').get('cache:cache:a'))!)
      expect(raw.d).toMatchObject({
        $blob: expect.stringMatching(/^cache:cache:[a-f0-9]{64}$/),
        size: expect.any(Number)
      })
      expect((await objects.list({ prefix: 'cache:cache:' })).items).toHaveLength(1)
      expect((await cache.peek('a'))?.value).toEqual(value)
      await cache.invalidate('a')
      expect((await objects.list({ prefix: 'cache:cache:' })).items).toHaveLength(1)
      now += 2000
      expect(await cache.sweepOffload()).toBe(1)
    } finally {
      await host.dispose()
    }
  })
  it('honors shortened lifetimes, deterministic jitter and cacheIf without policy extension', async () => {
    const base = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'tier' })] })
    const host = await base.use(
      cachePlugin({
        propagate: false,
        maxAgeMs: 1000,
        jitterRatio: 0.5,
        random: () => 1,
        clock: () => 10000,
        tiers: [{ backend: 'tier', ttlMs: 1000 }]
      })
    )
    await host.detect()
    try {
      const cache = host.backend('cache')
      await cache.getOrLoad('a', async () => 'A', { maxAgeMs: 400, ttlMs: 400 })
      expect(JSON.parse((await host.backend('tier').get('cache:cache:a'))!).x).toBe(10200)
      expect(
        await host.backend('tier').use(ttl).remaining(lockKey.text('cache:cache:a'))
      ).toBeLessThanOrEqual(100)
      await cache.getOrLoad('b', async () => 'B', { cacheIf: () => false })
      expect(await cache.peek('b')).toBeUndefined()
      let finish!: (value: string) => void,
        calls = 0
      const first = cache.getOrLoad(
        'a',
        async () => {
          calls++
          return new Promise<string>((resolve) => {
            finish = resolve
          })
        },
        { mode: 'refresh' }
      )
      await new Promise((resolve) => setTimeout(resolve, 5))
      const second = cache.getOrLoad(
        'a',
        async () => {
          calls++
          return 'wrong'
        },
        { mode: 'refresh' }
      )
      finish('new')
      expect(await Promise.all([first, second])).toEqual(['new', 'new'])
      expect(calls).toBe(1)
    } finally {
      await host.dispose()
    }
  })
  it('skips every locked cache write when the tag index rejects', async () => {
    const reports: unknown[] = [],
      failure = new RangeError('tag storage failed')
    const observer = definePlugin('tag-failure', (core) => ({
      install() {
        core.useAsyncPipeline((input, next) => {
          if (input.backendId === 'tags' && input.operation === 'putRecord') throw failure
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
        memoryBackendPlugin({ id: 'shared' }),
        memoryBackendPlugin({ id: 'tags' }),
        observer
      ]
    })
    const host = await base.use(
      cachePlugin({
        propagate: false,
        tiers: [{ backend: 'shared', ttlMs: 10000 }],
        tagIndex: { backend: 'tags' },
        stampedeLock: { backend: 'shared' }
      })
    )
    await host.detect()
    try {
      const cache = host.backend('cache')
      expect(await cache.getOrLoad('a', async () => 'value', { tags: ['doc'] })).toBe('value')
      expect(await host.backend('shared').get('cache:cache:a')).toBeNull()
      expect(
        await cache.getOrLoadMany(
          ['b', 'c'],
          async (keys) => new Map(keys.map((key) => [key, 'value'])),
          { tags: ['doc'] }
        )
      ).toEqual(
        new Map([
          ['b', 'value'],
          ['c', 'value']
        ])
      )
      expect(await host.backend('shared').getMany(['cache:cache:b', 'cache:cache:c'])).toEqual([
        undefined,
        undefined
      ])
      expect(reports.length).toBeGreaterThan(0)
    } finally {
      await host.dispose()
    }
  })
  it('preserves a lock-time batch hit without rewriting its original expiry or metadata', async () => {
    const base = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'shared' })] })
    const host = await base.use(
      cachePlugin({
        propagate: false,
        tiers: [{ backend: 'shared', ttlMs: 10000 }],
        stampedeLock: { backend: 'shared' }
      })
    )
    await host.detect()
    try {
      const shared = host.backend('shared'),
        cache = host.backend('cache')
      let entered!: () => void, finish!: () => void
      const began = new Promise<void>((resolve) => {
          entered = resolve
        }),
        gate = new Promise<void>((resolve) => {
          finish = resolve
        })
      const raw = JSON.stringify({
        v: 1,
        s: 'hit',
        t: 's',
        d: 'existing',
        w: Date.now() - 100,
        x: Date.now() + 1000,
        m: { original: true },
        g: []
      })
      const writer = shared
        .tx()
        .lock(lockKey.text('cache:cache:a'))
        .run(async (tx) => {
          await tx.set('cache:cache:a', raw)
          entered()
          await gate
        })
      await began
      let loads = 0
      const result = cache.getOrLoadMany(['a'], async () => {
        loads++
        return new Map([['a', 'wrong']])
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
      finish()
      await writer
      expect(await result).toEqual(new Map([['a', 'existing']]))
      expect(loads).toBe(0)
      expect(await shared.get('cache:cache:a')).toBe(raw)
      expect(await cache.peek('a')).toMatchObject({
        meta: { original: true },
        ageMs: expect.any(Number)
      })
    } finally {
      await host.dispose()
    }
  })
  it('keeps the latest pending value readable until a paused back write settles', async () => {
    let active = false,
      entered!: () => void,
      finish!: () => void
    const began = new Promise<void>((resolve) => {
        entered = resolve
      }),
      gate = new Promise<void>((resolve) => {
        finish = resolve
      })
    const observer = definePlugin('paused-back', (core) => ({
      install() {
        core.useAsyncPipeline(async (input, next) => {
          if (active && input.backendId === 'fast' && input.operation === 'set') {
            entered()
            await gate
          }
          return next(input)
        })
        return {}
      }
    }))
    const base = await createStorageHost({
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
    try {
      const cache = host.backend('cache')
      await base
        .backend('fast')
        .set('cache:cache:a', JSON.stringify({ v: 1, s: 'hit', t: 's', d: 'old', w: Date.now() }))
      await cache.set('a', 'latest')
      active = true
      const flushing = cache.flush()
      await began
      expect(await cache.get('a')).toBe('latest')
      await cache.set('a', 'newest')
      finish()
      await flushing
      expect(await cache.get('a')).toBe('newest')
      await cache.flush()
      expect(await base.backend('fast').get('cache:cache:a')).toContain('newest')
    } finally {
      finish()
      await host.dispose()
    }
  })
  it('shares the original native key lock across two cache instances', async () => {
    const base = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'shared' })] })
    const options = {
      tiers: [{ backend: 'shared', ttlMs: 10000 }] as const,
      prefix: 'shared-cache:',
      propagate: false,
      stampedeLock: { backend: 'shared' }
    }
    const host = await base.use(
      cachePlugin({ ...options, id: 'one' }),
      cachePlugin({ ...options, id: 'two' })
    )
    await host.detect()
    try {
      let loads = 0
      const load = async () => {
        loads++
        await new Promise((resolve) => setTimeout(resolve, 10))
        return 'value'
      }
      expect(
        await Promise.all([
          host.backend('one').getOrLoad('a', load),
          host.backend('two').getOrLoad('a', load)
        ])
      ).toEqual(['value', 'value'])
      expect(loads).toBe(1)
    } finally {
      await host.dispose()
    }
  })
})
