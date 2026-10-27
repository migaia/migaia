import { storageProbe } from '@migaia/storage-host/plugins/probe'
import { describe, expect, it, vi } from 'vitest'
import { createStorageHost, memoryBackendPlugin } from '@migaia/storage-host'
import { vector, ttl, DeleteCountMode, type IVectorCollection } from '@migaia/storage-contract'
import { lockKey } from '@migaia/storage-host/authoring/concurrency'
import { deferred } from '@migaia/utils/promise'
import { createManualScheduler } from '@migaia/utils/testing'
import { cachePlugin } from '../src/plugin.js'
import { cacheKey } from '../src/key.js'
import {
  semanticCacheFeature,
  type ISemanticCacheOptions,
  type ISemanticPayload
} from '../src/features/semantic.js'

/** Fixed unit vectors make the native engine's score and candidate order observable. */
const embeddings: Readonly<Record<string, readonly number[]>> = {
  first: [1, 0],
  second: [0.8, 0.6],
  third: [0.6, 0.8],
  opposite: [-1, 0]
}
/** Every scenario installs the real cache after a genuine published Memory vector backend. */
async function fixture(options: Partial<ISemanticCacheOptions> = {}) {
  const scheduler = createManualScheduler()
  const initial = await createStorageHost({
    scheduler,
    plugins: [storageProbe(), memoryBackendPlugin({ id: 'vectors' })]
  })
  const host = await initial.use(
    cachePlugin(
      { tiers: [{ backend: 'vectors' }], propagate: false },
      {
        semantic: semanticCacheFeature({
          backend: 'vectors',
          collection: 'answers',
          dimensions: 2,
          minScore: 0.5,
          embed: async (prompt) => embeddings[prompt] ?? [1, 0],
          ...options
        })
      }
    )
  )
  await host.detect()
  return {
    host,
    scheduler,
    cache: host.backend('cache'),
    semantic: host.backend('cache').api.semantic,
    vectors: host.backend('vectors'),
    collection: host.backend('vectors').use(vector).collection<ISemanticPayload>('answers')
  }
}

describe('semantic cache over real Memory vectors', () => {
  it('uses native scores, threshold and flat model filters without overriding prompt provenance', async () => {
    const { host, semantic, collection } = await fixture()
    try {
      await semantic.set('first', { answer: 1 }, { payload: { model: 'm1', prompt: 'user' } })
      await semantic.set('first', { answer: 2 }, { payload: { model: 'm2' } })
      expect(await semantic.get('second', { where: { model: 'm1' } })).toMatchObject({
        value: { answer: 1 },
        prompt: 'first',
        score: 0.8
      })
      expect(await semantic.get('first', { where: { model: 'm2' } })).toMatchObject({
        value: { answer: 2 }
      })
      expect(await semantic.get('opposite')).toBeUndefined()
      expect(await semantic.get('second', { minScore: 0.9 })).toBeUndefined()
      const points = await collection.near([1, 0]).topK(10).all()
      expect(points).toHaveLength(2)
      expect(points.find((point) => point.payload?.model === 'm1')?.payload).toMatchObject({
        prompt: 'user',
        '$cache.p': 'first',
        '$cache.f': 1
      })
      await semantic.set('first', { answer: 3 }, { payload: { prompt: 'user', model: 'm1' } })
      expect(await collection.near([1, 0]).topK(10).count()).toBe(2)
      expect(await semantic.get('first', { where: { model: 'm1' } })).toMatchObject({
        value: { answer: 3 }
      })
    } finally {
      await host.dispose()
    }
  })

  it('accepts bounded candidates in native score order and reports failed acceptance or decoding', async () => {
    const { host, semantic, collection } = await fixture()
    const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const errors = vi.fn()
      host.extensions.observe('onCacheTierError', errors)
      await semantic.set('first', 'one')
      await semantic.set('second', 'two')
      await semantic.set('third', 'three')
      const seen: unknown[] = []
      const original = new RangeError('acceptance rejected candidate')
      expect(
        await semantic.get('first', {
          candidates: 3,
          accept: (hit) => {
            seen.push(hit.value)
            if (hit.value === 'one') throw original
            return hit.value === 'two'
          }
        })
      ).toMatchObject({ value: 'two', score: 0.8 })
      expect(seen).toEqual(['one', 'two'])
      expect(errors).toHaveBeenCalledWith(
        expect.objectContaining({ tier: -1, operation: 'accept' })
      )
      expect(diagnostics).toHaveBeenCalledWith(expect.any(String), original)
      expect(await semantic.get('first', { candidates: 3, accept: () => false })).toBeUndefined()
      await collection.upsert([
        { id: 'malformed', vector: [1, 0], payload: { model: 'bad' } },
        {
          id: 'undecodable',
          vector: [1, 0],
          payload: { model: 'bad', '$cache.f': 1, '$cache.p': 'first', '$cache.v': '{' }
        }
      ])
      expect(
        await semantic.get('first', { where: { model: 'bad' }, candidates: 3 })
      ).toBeUndefined()
      expect(errors.mock.calls.filter(([event]) => event.operation === 'decode')).toHaveLength(2)
    } finally {
      diagnostics.mockRestore()
      await host.dispose()
    }
  })

  it('shares normalized prompt/payload loads while a cancelled caller leaves shared work alive', async () => {
    const { host, semantic } = await fixture()
    try {
      const entered = deferred<AbortSignal>()
      const result = deferred<string>()
      const load = vi.fn(async (signal: AbortSignal) => {
        entered.resolve(signal)
        return result.promise
      })
      const caller = new AbortController()
      const first = semantic.getOrLoad('question', load, {
        payload: { model: 'm1', version: 1 },
        ctx: { signal: caller.signal }
      })
      const cancelled = expect(first).rejects.toMatchObject({ code: 'ABORTED', cause: 'caller' })
      const sharedSignal = await entered.promise
      const joined = Array.from({ length: 4 }, () =>
        semantic.getOrLoad('question', load, { payload: { version: 1, model: 'm1' } })
      )
      await new Promise((resolve) => setTimeout(resolve, 10))
      caller.abort('caller')
      await cancelled
      expect(sharedSignal.aborted).toBe(false)
      result.resolve('shared')
      expect(await Promise.all(joined)).toEqual(
        Array(4).fill({ value: 'shared', score: undefined, prompt: 'question' })
      )
      expect(load).toHaveBeenCalledTimes(1)
      expect(await semantic.getOrLoad('question', load)).toMatchObject({
        value: 'shared',
        score: 1
      })
    } finally {
      await host.dispose()
    }
  })

  it('keeps org flights and physical vector results separate', async () => {
    const { host, semantic } = await fixture()
    try {
      const org = host.org('11111111-1111-4111-8111-111111111111').backend('cache').api.semantic
      const entered = deferred<void>()
      const result = deferred<string>()
      const first = semantic.getOrLoad('same', async () => {
        entered.resolve()
        return result.promise
      })
      await entered.promise
      expect(await org.getOrLoad('same', async () => 'org')).toMatchObject({ value: 'org' })
      result.resolve('default')
      expect(await first).toMatchObject({ value: 'default' })
      expect(await org.get('same')).toMatchObject({ value: 'org' })
      expect(await semantic.get('same')).toMatchObject({ value: 'default' })
    } finally {
      await host.dispose()
    }
  })

  it('uses native TTL, per-load shortening and cacheIf without writing rejected values', async () => {
    const { host, semantic, scheduler, collection, vectors } = await fixture({ ttlMs: 100 })
    try {
      await collection.upsert(
        [{ id: 'native-ttl', vector: [1, 0], payload: { model: 'native' } }],
        { ttlMs: 10 }
      )
      expect(await vectors.use(ttl).remaining(lockKey.vector('answers', 'native-ttl'))).toBe(10)
      await collection.delete(['native-ttl'])
      await semantic.set('first', 'default', { payload: { model: 'default' } })
      await semantic.getOrLoad('second', async () => 'short', {
        where: { model: 'short' },
        payload: { model: 'short' },
        ttlMs: 10
      })
      await semantic.getOrLoad('third', async () => 'uncached', {
        where: { model: 'uncached' },
        payload: { model: 'uncached' },
        cacheIf: () => false
      })
      expect(await semantic.get('third', { where: { model: 'uncached' } })).toBeUndefined()
      await expect(
        semantic.getOrLoad('fourth', async () => 'invalid', { ttlMs: 101 })
      ).rejects.toMatchObject({ code: 'CACHE_TIER_INVALID' })
      expect(
        await vectors
          .use(ttl)
          .remaining(lockKey.vector('answers', await cacheKey('second', { model: 'short' })))
      ).toBe(10)
      scheduler.advance(10)
      expect(await semantic.get('second', { where: { model: 'short' } })).toBeUndefined()
      expect(await semantic.get('first', { where: { model: 'default' } })).toMatchObject({
        value: 'default'
      })
      scheduler.advance(90)
      expect(await semantic.get('first')).toBeUndefined()
      expect(await collection.near([1, 0]).topK(10).all()).toEqual([])
    } finally {
      await host.dispose()
    }
  })

  it('passes the original count/context to native deletion and preserves native numbers', async () => {
    const { host, semantic, vectors, collection, cache } = await fixture()
    const api = vectors.use(vector)
    const original = api.collection
    const observed = vi.fn()
    const spy = vi
      .spyOn(api, 'collection')
      .mockImplementation(<P>(...args: Parameters<typeof original<P>>) => {
        const selected = original<P>(...args)
        return {
          ...selected,
          deleteWhere: (
            where: Parameters<IVectorCollection<P>['deleteWhere']>[0],
            ctx: Parameters<IVectorCollection<P>['deleteWhere']>[1]
          ) => {
            observed(ctx)
            return selected.deleteWhere(where, ctx)
          }
        }
      })
    try {
      await semantic.set('first', 'm1', { payload: { model: 'm1' } })
      await semantic.set('second', 'm2', { payload: { model: 'm2' } })
      /** Ordinary options retain their original identity at the actual native endpoint. */
      const ctx = { count: DeleteCountMode.scroll }
      expect(await semantic.invalidate({ model: 'm1' }, ctx)).toBe(1)
      expect(observed.mock.calls).toEqual([[ctx]])
      expect(observed.mock.calls[0]![0]).toBe(ctx)
      expect(
        await semantic.invalidate({ model: 'missing' }, { count: DeleteCountMode.precount })
      ).toBe(0)
      expect(await semantic.invalidate({ model: 'missing' })).toBe(0)
      expect(observed).toHaveBeenCalledTimes(3)
      expect(
        (await collection.near([1, 0]).topK(10).all()).map((hit) => hit.payload?.model)
      ).toEqual(['m2'])
      await cache.dispose()
      await vectors.set('after-error', 'open')
      expect(await vectors.get('after-error')).toBe('open')
    } finally {
      spy.mockRestore()
      await host.dispose()
    }
  })

  it('rejects reserved input and bad embeddings before any native point is written', async () => {
    const embed = vi.fn(async () => [1, 0])
    const { host, semantic, collection } = await fixture({ embed })
    try {
      await expect(
        semantic.set('first', 'bad', { payload: { '$cache.v': 'user' } })
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
      await expect(semantic.get('first', { where: { '$cache.p': 'first' } })).rejects.toMatchObject(
        { code: 'INVALID_ARGUMENT' }
      )
      await expect(semantic.invalidate({ '$cache.f': 1 })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      })
      for (const candidates of [0, 11, 1.5])
        await expect(semantic.get('first', { candidates })).rejects.toMatchObject({
          code: 'INVALID_ARGUMENT'
        })
      expect(embed).not.toHaveBeenCalled()
      embed.mockResolvedValueOnce([1])
      await expect(semantic.set('first', 'bad')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
      const original = new SyntaxError('embedding unavailable')
      embed.mockRejectedValueOnce(original)
      await expect(semantic.get('first')).rejects.toMatchObject({
        code: 'CACHE_EMBED_FAILED',
        cause: original
      })
      expect(await collection.near([1, 0]).topK(10).all()).toEqual([])
    } finally {
      await host.dispose()
    }
  })

  it('reports backend read/write failures as a miss or skipped write without losing the original error', async () => {
    const { host, semantic, vectors, collection } = await fixture()
    const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = vectors.use(vector)
    const original = api.collection
    const readFailure = new RangeError('native vector read failed')
    const writeFailure = new RangeError('native vector write failed')
    const observed = vi.fn()
    let failWrite = true
    const spy = vi
      .spyOn(api, 'collection')
      .mockImplementation(<P>(...args: Parameters<typeof original<P>>) => {
        const selected = original<P>(...args)
        return {
          ...selected,
          upsert: (...input: Parameters<IVectorCollection<P>['upsert']>) =>
            failWrite ? Promise.reject(writeFailure) : selected.upsert(...input),
          near: () => {
            throw readFailure
          }
        }
      })
    try {
      host.extensions.observe('onCacheTierError', observed)
      await expect(semantic.set('first', 'skipped')).resolves.toBeUndefined()
      expect(await collection.near([1, 0]).topK(10).all()).toEqual([])
      expect(await semantic.get('first')).toBeUndefined()
      failWrite = false
      expect(await semantic.getOrLoad('first', async () => 'loaded')).toMatchObject({
        value: 'loaded'
      })
      expect((await collection.near([1, 0]).topK(10).all())[0]?.payload?.['$cache.v']).toBe(
        '"loaded"'
      )
      expect(observed.mock.calls.map(([event]) => event.operation)).toEqual(['set', 'get', 'get'])
      expect(diagnostics).toHaveBeenCalledWith(expect.any(String), readFailure)
      expect(diagnostics).toHaveBeenCalledWith(expect.any(String), writeFailure)
    } finally {
      spy.mockRestore()
      diagnostics.mockRestore()
      await host.dispose()
    }
  })

  it('removes failed shared loads and preserves the exact original error for every joiner', async () => {
    const { host, semantic } = await fixture()
    try {
      const entered = deferred<void>()
      const result = deferred<string>()
      const original = new TypeError('business loader failed')
      const load = vi.fn(async () => {
        entered.resolve()
        return result.promise
      })
      const first = semantic.getOrLoad('question', load)
      const firstFailure = expect(first).rejects.toMatchObject({
        code: 'CACHE_LOAD_FAILED',
        cause: original
      })
      await entered.promise
      const next = semantic.getOrLoad('question', load)
      const secondFailure = expect(next).rejects.toMatchObject({
        code: 'CACHE_LOAD_FAILED',
        cause: original
      })
      await new Promise((resolve) => setTimeout(resolve, 10))
      result.reject(original)
      await Promise.all([firstFailure, secondFailure])
      expect(load).toHaveBeenCalledTimes(1)
      expect(await semantic.getOrLoad('question', async () => 'retry')).toMatchObject({
        value: 'retry'
      })
    } finally {
      await host.dispose()
    }
  })

  it('aborts only on close and waits for an ignoring shared loader without closing the borrowed backend', async () => {
    const { host, semantic, cache, vectors } = await fixture()
    const diagnostics = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const entered = deferred<AbortSignal>()
      const result = deferred<string>()
      const pending = semantic.getOrLoad('question', async (signal) => {
        entered.resolve(signal)
        return result.promise
      })
      const rejected = expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
      const signal = await entered.promise
      let closed = false
      const closing = cache.dispose().then(() => {
        closed = true
      })
      await rejected
      expect(signal.aborted).toBe(true)
      expect(closed).toBe(false)
      result.resolve('late')
      await closing
      await expect(Promise.resolve().then(() => semantic.get('question'))).rejects.toMatchObject({
        code: 'STORE_DISPOSED'
      })
      await vectors.set('business', 'open')
      expect(await vectors.get('business')).toBe('open')
    } finally {
      diagnostics.mockRestore()
      await host.dispose()
    }
  })

  it('requires an earlier published vector backend and rejects invalid Feature configuration', async () => {
    const options: ISemanticCacheOptions = {
      backend: 'vectors',
      collection: 'answers',
      dimensions: 2,
      minScore: 0.5,
      embed: async () => [1, 0]
    }
    expect(() => semanticCacheFeature({ ...options, dimensions: 0 })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    const failed = createStorageHost({
      plugins: [
        storageProbe(),
        memoryBackendPlugin({ id: 'vectors' }),
        cachePlugin(
          { tiers: [{ backend: 'vectors' }] },
          { semantic: semanticCacheFeature(options) }
        )
      ]
    })
    await expect(failed).rejects.toMatchObject({
      code: 'BACKEND_INSTALL_FAILED',
      cause: { cause: { code: 'BACKEND_NOT_INSTALLED' } }
    })
    const initial = await createStorageHost({
      plugins: [storageProbe(), memoryBackendPlugin({ id: 'vectors' })]
    })
    try {
      const host = await initial.use(cachePlugin({ id: 'text', tiers: [{ backend: 'vectors' }] }))
      await expect(
        host.use(
          cachePlugin(
            { id: 'semantic', tiers: [{ backend: 'vectors' }] },
            { semantic: semanticCacheFeature({ ...options, backend: 'text' }) }
          )
        )
      ).rejects.toMatchObject({
        code: 'BACKEND_INSTALL_FAILED',
        cause: { cause: { code: 'UNSUPPORTED_CAPABILITY' } }
      })
    } finally {
      await initial.dispose()
    }
  })
})
