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
