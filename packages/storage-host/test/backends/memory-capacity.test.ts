import { storageProbe } from '../../src/plugins/probe/index.ts'
import { describe, expect, it, vi } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { deferred } from '@migaia/utils/promise'
import { defineCollectionsJsonCodec } from '@migaia/serialize/codecs/collections-json'
import { utf8ByteLength } from '@migaia/utils/bytes'
import { ConcurrencyPolicy, lockKey } from '../../src/authoring/concurrency.ts'
import { counter, kv, ttl, vector } from '@migaia/storage-contract'
import { createStorageHost, createOrgId } from '../../src/index.ts'
import { memoryBackendPlugin } from '../../src/plugins/memory.ts'
import { createMemoryCapacityIndex } from '../../src/backends/memory-capacity.ts'

/**
 * Capacity is exercised through actual installed stores, namespaces and original transaction
 * owners.
 */
describe('native memory capacity', () => {
  it('preserves unbounded records and distinguishes linked LRU from LFU hits', async () => {
    await using unlimited = await createStorageHost({
      plugins: [storageProbe(), memoryBackendPlugin()]
    })
    const cycle: { self?: unknown; date: Date } = { date: new Date(1) }
    cycle.self = cycle
    await unlimited.backend('memory').putRecord(cycle, 'cycle')
    const restored = (await unlimited.backend('memory').getRecord('cycle')) as typeof cycle
    expect(restored.self).toBe(restored)
    for (const eviction of ['lru', 'lfu'] as const) {
      await using host = await createStorageHost({
        plugins: [storageProbe(), memoryBackendPlugin({ capacity: { maxEntries: 2, eviction } })]
      })
      const store = host.backend('memory')
      await store.set('a', 'a')
      await store.set('b', 'b')
      await store.get('a')
      await store.get('a')
      await store.get('b')
      await store.set('c', 'c')
      expect(await store.get('a')).toBe(eviction === 'lru' ? null : 'a')
      expect(await store.get('b')).toBe('b')
      expect(await store.get('c')).toBe(eviction === 'lru' ? 'c' : null)
      await store.clearAll()
      await store.putRecord(cycle, 'cycle')
      expect(((await store.getRecord('cycle')) as typeof cycle).date).toEqual(new Date(1))
    }
  })

  it.each(['lru', 'lfu'] as const)(
    'reclaims elapsed deadlines before live %s victims',
    async (eviction) => {
      const scheduler = createManualScheduler()
      await using host = await createStorageHost({
        scheduler,
        plugins: [storageProbe(), memoryBackendPlugin({ capacity: { maxEntries: 2, eviction } })]
      })
      const store = host.backend('memory')
      const evicted = vi.fn()
      host.extensions.observe('onEvict', evicted)
      await store.set('old-live', 'A')
      await store.use(kv).setMany([{ key: 'new-expired', value: 'B', ttlMs: 1 }])
      scheduler.advance(1)
      await store.set('new-live', 'C')
      expect(await store.get('old-live')).toBe('A')
      expect(await store.get('new-expired')).toBeNull()
      expect(await store.get('new-live')).toBe('C')
      expect(evicted).not.toHaveBeenCalled()
      await store.use(ttl).expire(lockKey.text('old-live'), 1)
      await store.use(ttl).persist(lockKey.text('old-live'))
      scheduler.advance(1)
      await store.remove('new-live')
      await store.set('replacement', 'D')
      expect(await store.get('old-live')).toBe('A')
    }
  )

  it('counts actual encoded values, raw bytes and vector components without counting metadata twice', async () => {
    const codec = defineCollectionsJsonCodec({ version: 1 })
    const payload = new Map([['key', new Set(['值'])]])
    const size = utf8ByteLength(codec.encode(payload))
    await using host = await createStorageHost({
      plugins: [storageProbe(), memoryBackendPlugin({ capacity: { maxBytes: size } })]
    })
    const store = host.backend('memory')
    await store.putRecord(payload, 'record')
    expect(await store.getRecord('record')).toEqual(payload)
    await store.setBytes('bytes', new Uint8Array(size))
    expect(await store.getRecord('record')).toBeUndefined()
    expect((await store.getBytes('bytes'))?.byteLength).toBe(size)
    await store.clearAll()
    await store.set('text', '😀'.repeat(Math.floor(size / 4)))
    expect(await store.get('text')).not.toBeNull()
    await store.set('oversize', 'x'.repeat(size + 1))
    expect(await store.keys()).toEqual([])
    const collection = store.use(vector).collection('points', { dimensions: 1, metric: 'dot' })
    await collection.upsert([{ id: 'fits', vector: [1] }])
    await store.setBytes('tail', new Uint8Array(size - 8))
    expect(await collection.search([1], { k: 1 })).toEqual([{ id: 'fits', score: 1 }])
    await store.set('one', 'x')
    expect(await store.getBytes('tail')).toBeNull()
    expect(await collection.search([1], { k: 1 })).toEqual([{ id: 'fits', score: 1 }])
  })

  it('isolates only nonencodable maxBytes records before replacements or any draft changes', async () => {
    await using host = await createStorageHost({
      plugins: [storageProbe(), memoryBackendPlugin({ capacity: { maxBytes: 100 } })]
    })
    const store = host.backend('memory')
    await store.set('same', 'retained')
    const cycle: { self?: unknown } = {}
    cycle.self = cycle
    for (const value of [new Date(1), cycle, undefined, NaN]) {
      await expect(
        store.putRecord(value, 'same', { conflictPolicy: 'replace' })
      ).rejects.toMatchObject({
        code: 'UNSUPPORTED_CAPABILITY',
        cause: expect.any(Error)
      })
      expect(await store.get('same')).toBe('retained')
    }
    await expect(
      store.transaction(async (tx) => {
        await tx.set('same', 'draft')
        await tx.putRecord(cycle, 'bad')
      })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(await store.get('same')).toBe('retained')
    expect(await store.getRecord('bad')).toBeUndefined()
  })

  it('commits capacity with the original draft and reports only actual per-channel victims', async () => {
    const original = new Error('rollback')
    const report = vi.fn()
    const listenerFailure = new Error('eviction observer')
    await using host = await createStorageHost({
      report,
      plugins: [storageProbe(), memoryBackendPlugin({ capacity: { maxEntries: 2 } })]
    })
    const store = host.backend('memory')
    const evicted = vi.fn()
    host.extensions.observe('onEvict', evicted)
    host.extensions.observe('onEvict', () => {
      throw listenerFailure
    })
    await store.set('a', 'a')
    await store.setBytes('b', new Uint8Array([1]))
    await expect(
      store.transaction(async (tx) => {
        await tx.setMany([
          { key: 'c', value: 'c' },
          { key: 'd', value: 'd' }
        ])
        throw original
      })
    ).rejects.toMatchObject({ cause: original })
    expect(await store.get('a')).toBe('a')
    expect(await store.getBytes('b')).toEqual(new Uint8Array([1]))
    expect(evicted).not.toHaveBeenCalled()
    await store.transaction(async (tx) => {
      await tx.setMany([
        { key: 'c', value: 'c' },
        { key: 'd', value: 'd' }
      ])
    })
    expect(evicted.mock.calls.map(([event]) => event)).toEqual([
      {
        backendId: 'memory',
        backend: 'memory',
        orgId: '00000000-0000-0000-0000-000000000000',
        channel: 'value',
        count: 1
      },
      {
        backendId: 'memory',
        backend: 'memory',
        orgId: '00000000-0000-0000-0000-000000000000',
        channel: 'bytes',
        count: 1
      }
    ])
    expect(report.mock.calls.map(([error]) => error)).toEqual([listenerFailure, listenerFailure])
    expect(await store.keys()).toEqual(['c', 'd'])
    await store.clearAll()
    await store.use(counter).increment('counter', 1)
    await store.setBytes('bytes', new Uint8Array([1]))
    await store.use(counter).increment('another', 2)
    expect(await store.get('counter')).toBeNull()
    expect(await store.get('another')).toBe('2')
  })

  it('uses original victim locks, waiting budgets and independent organization capacity', async () => {
    await using host = await createStorageHost({
      plugins: [storageProbe(), memoryBackendPlugin({ capacity: { maxEntries: 1 } })]
    })
    const store = host.backend('memory')
    await store.set('a', 'a')
    const entered = deferred<void>()
    const finish = deferred<void>()
    const held = store
      .tx()
      .lock(lockKey.text('a'))
      .run(async () => {
        entered.resolve()
        await finish.promise
      })
    await entered.promise
    let pending: Promise<void> | undefined
    try {
      await expect(
        store.set('b', 'b', { concurrency: ConcurrencyPolicy.fail() })
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      await expect(
        store.transaction(
          async (tx) => {
            await tx.set('b', 'b')
          },
          {
            concurrency: ConcurrencyPolicy.fail()
          }
        )
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      expect(() => store.sync.set('b', 'b')).toThrowError(
        expect.objectContaining({ code: 'LOCK_REJECTED' })
      )
      const cancellation = new AbortController()
      const cancelled = store.set('cancelled', 'not committed', { signal: cancellation.signal })
      cancellation.abort(new Error('capacity admission cancelled'))
      await expect(cancelled).rejects.toMatchObject({ code: 'ABORTED' })
      pending = store.set('b', 'b')
      const other = host.org(createOrgId()).backend('memory')
      await other.set('a', 'isolated')
      expect(await other.get('a')).toBe('isolated')
    } finally {
      finish.resolve()
      await held
    }
    await pending
    expect(await store.get('a')).toBeNull()
    expect(await store.get('b')).toBe('b')
    const txEntered = deferred<void>()
    const txFinish = deferred<void>()
    const txDraft = deferred<void>()
    const txHeld = store
      .tx()
      .lock(lockKey.text('b'))
      .run(async () => {
        txEntered.resolve()
        await txFinish.promise
      })
    await txEntered.promise
    let waiting: Promise<unknown> | undefined
    try {
      waiting = store.transaction(async (tx) => {
        await tx.set('c', 'c')
        txDraft.resolve()
      })
      await txDraft.promise
      expect(await store.get('b')).toBe('b')
      expect(await store.get('c')).toBeNull()
    } finally {
      txFinish.resolve()
      await txHeld
    }
    await waiting
    expect(await store.get('c')).toBe('c')
    const firstOrg = createOrgId()
    const secondOrg = createOrgId()
    await host.org(firstOrg).backend('memory').set('a', 'first')
    await host.org(secondOrg).backend('memory').set('a', 'second')
    await host.dropOrg(firstOrg)
    expect(await host.org(secondOrg).backend('memory').get('a')).toBe('second')
    expect(await store.get('c')).toBe('c')
  })

  it('captures valid capacity once and rejects invalid descriptors before native construction', async () => {
    let reads = 0
    const capacity = {
      get maxEntries() {
        reads += 1
        return 1
      }
    }
    await using host = await createStorageHost({
      plugins: [storageProbe(), memoryBackendPlugin({ capacity })]
    })
    await host.org(createOrgId()).backend('memory').set('a', 'a')
    expect(reads).toBe(1)
    for (const invalid of [{ maxEntries: 0 }, { maxBytes: NaN }, { eviction: 'random' }])
      expect(() => memoryBackendPlugin({ capacity: invalid as never })).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
  })

  it('visits only touched policy nodes when selecting one victim from ten thousand entries', () => {
    const index = createMemoryCapacityIndex({ maxEntries: 10_000, eviction: 'lfu' })
    for (let position = 0; position < 10_000; position += 1)
      index.put({
        id: String(position),
        channel: 'value',
        encoded: String(position),
        key: String(position),
        bytes: 1
      })
    /** Count actual Map iteration, including the bounded inverse log, without timing evidence. */
    let visits = 0
    const original = Map.prototype.entries
    const iterator = vi
      .spyOn(Map.prototype, Symbol.iterator)
      .mockImplementation(function* (this: Map<unknown, unknown>): Generator<
        [unknown, unknown],
        undefined
      > {
        const entries = Reflect.apply(original, this, []) as MapIterator<[unknown, unknown]>
        for (const entry of entries) {
          visits += 1
          yield entry
        }
        return undefined
      })
    try {
      const victims = index.preview([
        { id: 'new', channel: 'value', encoded: 'new', key: 'new', bytes: 1 }
      ])
      expect(victims.map((entry) => entry.id)).toEqual(['0'])
      expect(visits).toBeLessThan(20)
    } finally {
      iterator.mockRestore()
    }
  })
})
