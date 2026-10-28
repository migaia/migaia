import { describe, expect, it } from 'vitest'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { memoryBackendPlugin } from '@migaia/storage-host/plugins/memory'
import { blob, records, ttl } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/sdk'
import { createManualScheduler } from '@migaia/utils/testing'
import { cachePlugin } from '../src/index.js'

describe('cache policy composition', () => {
  it('loads exactly four absent batch keys while preserving three-tier provenance and an existing flight', async () => {
    const calls: { backendId: string; operation: string; input: unknown }[] = []
    const observer = definePlugin('mixed-batch', (core) => ({
      install() {
        core.useAsyncPipeline((input, next) => {
          calls.push({ backendId: input.backendId, operation: input.operation, input: input.input })
          return next(input)
        })
        return {}
      }
    }))
    const base = await createStorageHost({
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
        tiers: [{ backend: 'zero' }, { backend: 'one' }, { backend: 'two' }]
      })
    )
    await host.detect()
    try {
      const cache = host.backend('cache'),
        keys = Array.from({ length: 10 }, (_, index) => 'key' + index)
      const raw = (key: string) =>
        JSON.stringify({
          v: 1,
          s: 'hit',
          t: 'c',
          d: JSON.stringify(key),
          w: Date.now(),
          m: { seed: true },
          g: []
        })
      for (const key of keys.slice(0, 3))
        await base.backend('zero').set('cache:cache:' + key, raw(key))
      for (const key of keys.slice(3, 5))
        await base.backend('one').set('cache:cache:' + key, raw(key))
      expect(await cache.peek(keys[3]!)).toMatchObject({
        value: keys[3],
        tier: 1,
        stale: false,
        negative: false,
        meta: { seed: true }
      })
      expect(await base.backend('zero').get('cache:cache:' + keys[3])).toBeNull()
      let began!: () => void,
        finishFlight!: () => void,
        finishBatch!: () => void,
        batchBegan!: () => void
      const entered = new Promise<void>((resolve) => {
          began = resolve
        }),
        gate = new Promise<void>((resolve) => {
          finishFlight = resolve
        }),
        batchGate = new Promise<void>((resolve) => {
          finishBatch = resolve
        }),
        batchEntered = new Promise<void>((resolve) => {
          batchBegan = resolve
        })
      const flight = cache.getOrLoad(keys[5]!, async () => {
        began()
        await gate
        return keys[5]!
      })
      await entered
      calls.length = 0
      let loads = 0
      const batch = cache.getOrLoadMany(keys, async (missing) => {
        loads++
        expect(missing).toEqual(keys.slice(6))
        batchBegan()
        await batchGate
        return new Map(missing.map((key) => [key, key]))
      })
      await batchEntered
      const single = cache.getOrLoad(keys[6]!, async () => 'wrong')
      finishBatch()
      finishFlight()
      expect(await batch).toEqual(new Map(keys.map((key) => [key, key])))
      expect(await single).toBe(keys[6])
      expect(await flight).toBe(keys[5])
      expect(loads).toBe(1)
      for (const [id, writes] of [
        ['zero', 2],
        ['one', 1],
        ['two', 1]
      ] as const) {
        expect(
          calls.filter((item) => item.backendId === id && item.operation === 'getMany')
        ).toHaveLength(1)
        expect(
          calls.filter((item) => item.backendId === id && item.operation === 'setMany')
        ).toHaveLength(writes)
      }
      const zeroWrites = calls.filter(
        (item) => item.backendId === 'zero' && item.operation === 'setMany'
      )
      expect((zeroWrites[0]!.input as { key: string }[]).map((item) => item.key)).toEqual(
        keys.slice(3, 5).map((key) => 'cache:cache:' + key)
      )
      expect((zeroWrites[1]!.input as { key: string }[]).map((item) => item.key)).toEqual(
        keys.slice(6).map((key) => 'cache:cache:' + key)
      )
      const primary = new RangeError('four-key batch source rejected')
      let reject!: (error: Error) => void, failedBegan!: () => void
      const failedEntered = new Promise<void>((resolve) => {
          failedBegan = resolve
        }),
        rejected = new Promise<ReadonlyMap<string, string>>((_resolve, fail) => {
          reject = fail
        })
      const missing = ['failed-a', 'failed-b', 'failed-c', 'failed-d']
      const failed = cache.getOrLoadMany(missing, async () => {
        failedBegan()
        return rejected
      })
      const batchFailure = expect(failed).rejects.toMatchObject({
        code: 'CACHE_LOAD_FAILED',
        cause: primary
      })
      await failedEntered
      const joined = missing.map((key) =>
        expect(cache.getOrLoad(key, async () => 'wrong')).rejects.toMatchObject({
          code: 'CACHE_LOAD_FAILED',
          cause: primary
        })
      )
      await new Promise((resolve) => setTimeout(resolve, 5))
      reject(primary)
      await Promise.all([batchFailure, ...joined])
      for (const key of missing) expect(await cache.peek(key)).toBeUndefined()
      expect(await cache.getOrLoad(missing[0]!, async () => 'retry')).toBe('retry')
    } finally {
      await host.dispose()
    }
  })
  it('samples bounded varied TTLs and applies size limits without exposing custom encrypted values', async () => {
    const scheduler = createManualScheduler(),
      key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 128 }, false, [
        'encrypt',
        'decrypt'
      ])
    let sample = 0
    const base = await createStorageHost({
      scheduler,
      plugins: [memoryBackendPlugin({ id: 'small' }), memoryBackendPlugin({ id: 'full' })]
    })
    const host = await base.use(
      cachePlugin({
        propagate: false,
        clock: () => 10000,
        jitterRatio: 0.2,
        random: () => (sample++ % 20) / 19,
        tiers: [
          { backend: 'small', ttlMs: 1000, maxEntryBytes: 256 },
          { backend: 'full', ttlMs: 1000 }
        ],
        codec: {
          name: 'application-aes-gcm',
          output: 'text',
          async encode(value) {
            const iv = crypto.getRandomValues(new Uint8Array(12)),
              encrypted = new Uint8Array(
                await crypto.subtle.encrypt(
                  { name: 'AES-GCM', iv },
                  key,
                  new TextEncoder().encode(JSON.stringify(value))
                )
              )
            return Buffer.concat([iv, encrypted]).toString('base64')
          },
          async decode(raw) {
            const bytes = new Uint8Array(Buffer.from(raw, 'base64'))
            return JSON.parse(
              new TextDecoder().decode(
                await crypto.subtle.decrypt(
                  { name: 'AES-GCM', iv: bytes.slice(0, 12) },
                  key,
                  bytes.slice(12)
                )
              )
            )
          }
        }
      })
    )
    await host.detect()
    try {
      const cache = host.backend('cache'),
        durations: number[] = []
      for (let index = 0; index < 20; index++) {
        await cache.getOrLoad('jitter' + index, async () => ({ secret: 'private-answer' }))
        const duration = await base
          .backend('full')
          .use(ttl)
          .remaining(lockKey.text('cache:cache:jitter' + index))
        durations.push(duration!)
        expect(duration).toBeGreaterThanOrEqual(800)
        expect(duration).toBeLessThanOrEqual(1000)
        for (const id of ['small', 'full'] as const)
          expect(await base.backend(id).get('cache:cache:jitter' + index)).not.toContain(
            'private-answer'
          )
      }
      expect(new Set(durations).size).toBeGreaterThan(1)
      const before = cache.stats().skipped[0]!
      const large = { secret: 'private-answer'.repeat(100) }
      expect(await cache.getOrLoad('large', async () => large)).toEqual(large)
      expect(await base.backend('small').get('cache:cache:large')).toBeNull()
      expect(await base.backend('full').get('cache:cache:large')).not.toContain('private-answer')
      expect(cache.stats().skipped[0]).toBe(before + 1)
      expect((await cache.peek<typeof large>('large'))?.value).toEqual(large)
      await cache.getOrLoad('short', async () => 'short', { ttlMs: 100 })
      scheduler.advance(101)
      expect(await cache.peek('short')).toBeUndefined()
      expect((await cache.peek('jitter0'))?.value).toEqual({ secret: 'private-answer' })
      let loads = 0
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          cache.getOrLoad(
            'uncached',
            async () => {
              loads++
              await new Promise((resolve) => setTimeout(resolve, 5))
              return undefined
            },
            { cacheIf: () => false, negativeTtlMs: 10 }
          )
        )
      )
      expect(results).toEqual(Array(5).fill(undefined))
      expect(loads).toBe(1)
      for (const id of ['small', 'full'] as const)
        expect(await base.backend(id).get('cache:cache:uncached')).toBeNull()
    } finally {
      await host.dispose()
    }
  })
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
      calls.length = 0
      expect(await cache.getOrLoad('a', async () => 'refreshed', { mode: 'refresh' })).toBe(
        'refreshed'
      )
      expect(
        calls.filter(
          (call) =>
            ['fast', 'slow'].includes(call.backendId) && ['get', 'getMany'].includes(call.operation)
        )
      ).toEqual([])
      calls.length = 0
      expect(await cache.getOrLoad('a', async () => 'bypass', { mode: 'bypass' })).toBe('bypass')
      expect(calls.filter((call) => ['fast', 'slow'].includes(call.backendId))).toEqual([])
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
        tags: ['doc:1'],
        meta: { model: 'm' }
      })
      await cache.getOrLoad('b', async () => ({ answer: 2 }), { tags: ['doc:1', 'doc:2'] })
      await cache.getOrLoad('c', async () => ({ answer: 3 }), { tags: ['doc:2'] })
      expect(await cache.peek('a')).toMatchObject({
        tags: ['doc:1'],
        meta: { model: 'm' }
      })
      expect(await host.backend('tags').use(records).query().count()).toBe(4)
      expect(
        await host
          .backend('tags')
          .use(ttl)
          .remaining(lockKey.record(['cache:cache:', 'doc:1', 'a']))
      ).toBeGreaterThan(0)
      await cache.invalidate({ tag: 'doc:1' })
      expect(await cache.peek('a')).toBeUndefined()
      expect(await cache.peek('b')).toBeUndefined()
      expect((await cache.peek('c'))?.value).toEqual({ answer: 3 })
      const remaining = host.backend('tags').iterateRecords({
        lower: ['cache:cache:', 'doc:1'],
        upper: ['cache:cache:', 'doc:1', new ArrayBuffer(0)],
        upperOpen: true
      })
      try {
        expect(await remaining.next()).toMatchObject({ done: true })
      } finally {
        await remaining.dispose()
      }
    } finally {
      await host.dispose()
    }
  })
  it('offloads full encoded content, reuses native content hash and deletes references independently', async () => {
    let now = Date.now()
    const reports: unknown[] = []
    const base = await createStorageHost({
      report: (error) => {
        reports.push(error)
      },
      plugins: [memoryBackendPlugin({ id: 'tier' }), memoryBackendPlugin({ id: 'objects' })]
    })
    const host = await base.use(
      cachePlugin({
        propagate: false,
        clock: () => now,
        tiers: [{ backend: 'tier', ttlMs: 1000, offload: { backend: 'objects', minBytes: 1024 } }]
      })
    )
    await host.detect()
    try {
      const cache = host.backend('cache'),
        objects = host.backend('objects').use(blob)
      const value = { answer: 'large'.repeat(410) }
      expect(await cache.getOrLoad('a', async () => value)).toEqual(value)
      const raw = JSON.parse((await host.backend('tier').get('cache:cache:a'))!)
      expect(raw.d).toMatchObject({
        $blob: expect.stringMatching(/^cache:cache:[a-f0-9]{64}$/),
        size: expect.any(Number)
      })
      expect((await objects.list({ prefix: 'cache:cache:' })).items).toHaveLength(1)
      expect((await cache.peek('a'))?.value).toEqual(value)
      await cache.getOrLoad('small', async () => 'x'.repeat(512))
      expect(typeof JSON.parse((await host.backend('tier').get('cache:cache:small'))!).d).toBe(
        'string'
      )
      expect((await objects.list({ prefix: 'cache:cache:' })).items).toHaveLength(1)
      expect(await cache.sweepOffload()).toBe(0)
      expect((await cache.peek('a'))?.value).toEqual(value)
      await objects.remove(raw.d.$blob)
      let reloads = 0
      expect(
        await cache.getOrLoad('a', async () => {
          reloads++
          return value
        })
      ).toEqual(value)
      expect(reloads).toBe(1)
      expect(reports).toEqual([expect.objectContaining({ code: 'INVALID_ARGUMENT' })])
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
      expect(JSON.parse((await host.backend('tier').get('cache:cache:a'))!).x).toBe(10100)
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
      expect(reports).toHaveLength(3)
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
      expect(
        await cache.getOrLoad(
          'a',
          async () => {
            loads++
            return 'actual-background-refresh'
          },
          { staleAfterMs: 1 }
        )
      ).toBe('existing')
      await new Promise((resolve) => setTimeout(resolve, 5))
      expect(loads).toBe(1)
      expect((await cache.peek('a'))?.value).toBe('actual-background-refresh')
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
  it('bounds a cache copy even when the native expiry operation fails', async () => {
    let now = 1000
    const reports: unknown[] = []
    const observer = definePlugin('failed-expiry', (core) => ({
      install() {
        core.useAsyncPipeline((input, next) => {
          if (input.backendId === 'tier' && input.operation === 'ttl.expire')
            throw new RangeError('native expiry failed')
          return next(input)
        })
        return {}
      }
    }))
    const base = await createStorageHost({
      report: (error) => {
        reports.push(error)
      },
      plugins: [memoryBackendPlugin({ id: 'tier' }), observer]
    })
    const host = await base.use(
      cachePlugin({ propagate: false, clock: () => now, tiers: [{ backend: 'tier', ttlMs: 100 }] })
    )
    await host.detect()
    try {
      const cache = host.backend('cache'),
        tier = base.backend('tier')
      expect(await cache.getOrLoad('a', async () => 'value')).toBe('value')
      expect(JSON.parse((await tier.get('cache:cache:a'))!).x).toBe(1100)
      expect(await tier.use(ttl).remaining(lockKey.text('cache:cache:a'))).toBeUndefined()
      expect(reports).toHaveLength(1)
      now += 101
      expect(await cache.peek('a')).toBeUndefined()
      expect(await tier.get('cache:cache:a')).toBeNull()
    } finally {
      await host.dispose()
    }
  })
  it('admits native batch immediate expiry without granting positive call TTL on a non-TTL tier', async () => {
    const base = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'memory' })] })
    const inner = await base.use(
      cachePlugin({ id: 'inner', propagate: false, tiers: [{ backend: 'memory' }] })
    )
    const host = await inner.use(
      cachePlugin({ id: 'outer', propagate: false, tiers: [{ backend: 'inner' }] })
    )
    await host.detect()
    try {
      const cache = host.backend('outer')
      let loads = 0
      expect(() =>
        cache.getOrLoad(
          'a',
          async () => {
            loads++
            return 'wrong'
          },
          { ttlMs: 10 }
        )
      ).toThrowError(expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' }))
      expect(loads).toBe(0)
      expect(await base.backend('memory').keys()).toEqual([])
      await cache.set('a', 'value')
      expect(await cache.get('a')).toBe('value')
      await cache.setMany([{ key: 'a', value: 'ignored', ttlMs: 0 }])
      expect(await cache.get('a')).toBeNull()
    } finally {
      await host.dispose()
    }
  })
  it('clears an old tag deadline when a refreshed entry has no finite lifetime', async () => {
    const base = await createStorageHost({
      plugins: [memoryBackendPlugin({ id: 'tier' }), memoryBackendPlugin({ id: 'tags' })]
    })
    const host = await base.use(
      cachePlugin({ propagate: false, tiers: [{ backend: 'tier' }], tagIndex: { backend: 'tags' } })
    )
    await host.detect()
    try {
      const cache = host.backend('cache'),
        target = lockKey.record(['cache:cache:', 'doc', 'a'])
      await cache.getOrLoad('a', async () => 'finite', { ttlMs: 10000, tags: ['doc'] })
      expect(await base.backend('tags').use(ttl).remaining(target)).toBeGreaterThan(0)
      await cache.getOrLoad('a', async () => 'unbounded', { mode: 'refresh', tags: ['doc'] })
      expect(await base.backend('tags').use(ttl).remaining(target)).toBeUndefined()
      expect(
        await base.backend('tier').use(ttl).remaining(lockKey.text('cache:cache:a'))
      ).toBeUndefined()
      await cache.invalidate({ tag: 'doc' })
      expect(await cache.peek('a')).toBeUndefined()
    } finally {
      await host.dispose()
    }
  })
  it.each([false, true])(
    'clears finite deadlines on single and batch refresh with native lock=%s',
    async (locked) => {
      const base = await createStorageHost({ plugins: [memoryBackendPlugin({ id: 'tier' })] })
      const host = await base.use(
        cachePlugin({
          propagate: false,
          tiers: [{ backend: 'tier' }],
          ...(locked ? { stampedeLock: { backend: 'tier' } } : {})
        })
      )
      await host.detect()
      try {
        const cache = host.backend('cache'),
          native = base.backend('tier').use(ttl)
        await cache.getOrLoad('single', async () => 'finite', { ttlMs: 10000 })
        expect(await native.remaining(lockKey.text('cache:cache:single'))).toBeGreaterThan(0)
        await cache.getOrLoad('single', async () => 'unbounded', { mode: 'refresh' })
        expect(await native.remaining(lockKey.text('cache:cache:single'))).toBeUndefined()
        await cache.getOrLoadMany(['batch'], async () => new Map([['batch', 'finite']]), {
          ttlMs: 10000
        })
        expect(await native.remaining(lockKey.text('cache:cache:batch'))).toBeGreaterThan(0)
        await cache.getOrLoadMany(['batch'], async () => new Map([['batch', 'unbounded']]), {
          mode: 'refresh'
        })
        expect(await native.remaining(lockKey.text('cache:cache:batch'))).toBeUndefined()
        expect(await cache.getOrLoadMany(['batch'], async () => new Map())).toEqual(
          new Map([['batch', 'unbounded']])
        )
      } finally {
        await host.dispose()
      }
    }
  )
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
