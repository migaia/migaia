import { describe, expect, it } from 'vitest'
import { createManualScheduler } from '@migaia/utils/testing'
import { deferred } from '@migaia/utils/promise'
import {
  vector,
  ttl,
  lockKey,
  ConcurrencyPolicy,
  defineConcurrencyPolicy,
  type ILockKey,
  DeleteCountMode,
  type IStorageChange
} from '@migaia/storage-contract'
import { createStorageHost, createOrgId, memoryBackendPlugin } from '../../src/index.js'

/** Payload declarations remain business schemas while serialize owns the actual field snapshot. */
type IPayload = { group: string; order: number }
/** Every scenario enters through an actually installed native memory backend. */
describe('memory native vectors', () => {
  it('ranks exact finite scores with UTF-16 ties and detached payload/vector output', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    expect(store.has(vector)).toBe(true)
    const collection = store
      .use(vector)
      .collection<IPayload>('docs', { dimensions: 2, metric: 'cosine' })
    class Payload {
      group = 'kept'
      order = 1
    }
    const payload = new Payload()
    const components = [1, 0]
    await collection.upsert([
      { id: 'b', vector: [0, 1], payload },
      { id: 'a', vector: components, payload },
      { id: 'b', vector: components, payload },
      { id: 'c', vector: [0, 1], payload: { group: 'other', order: 2 } },
      { id: 'd', vector: [-1, 0], payload: { group: 'other', order: 3 } }
    ])
    components[0] = 9
    payload.group = 'changed'
    expect(await collection.search([1, 0], { k: 4 })).toEqual([
      { id: 'a', score: 1 },
      { id: 'b', score: 1 },
      { id: 'c', score: 0 },
      { id: 'd', score: -1 }
    ])
    const result = await collection.near([1, 0], { exact: true }).withVector().topK(1).all()
    expect(result).toEqual([
      { id: 'a', score: 1, vector: [1, 0], payload: { group: 'kept', order: 1 } }
    ])
    result[0]!.payload!.group = 'changed output'
    expect((await collection.search([1, 0], { k: 1, withPayload: true }))[0]!.payload).toEqual({
      group: 'kept',
      order: 1
    })
    expect(() =>
      store.use(vector).collection('docs', { dimensions: 3, metric: 'cosine' })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(store.use(vector).collection('docs')).toBeDefined()
    await expect(
      collection.upsert([
        { id: 'uncommitted', vector: [1, 0] },
        { id: 'invalid', vector: [0, 0] }
      ])
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect((await collection.near([1, 0]).topK(10).all()).map((hit) => hit.id)).not.toContain(
      'uncommitted'
    )
  })

  it('filters declarative payloads before topK and runs JavaScript only on bounded engine hits', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const collection = host
      .backend('memory')
      .use(vector)
      .collection<IPayload>('docs', { dimensions: 2, metric: 'dot' })
    await collection.upsert([
      { id: 'best', vector: [3, 0], payload: { group: 'excluded', order: 3 } },
      { id: 'second', vector: [2, 0], payload: { group: 'kept', order: 2 } },
      { id: 'third', vector: [1, 0], payload: { group: 'kept', order: 1 } }
    ])
    const calls: number[] = []
    const query = collection
      .near([1, 0])
      .where((payload) => {
        calls.push(payload.order)
        return payload.order === 1
      })
      .where({ group: 'kept' })
      .topK(2)
    expect((await query.all()).map((hit) => hit.id)).toEqual(['third'])
    expect(calls).toEqual([2, 1])
    expect(query.explain().client.length).toBeGreaterThan(0)
    await expect(query.requirePushdown().all()).rejects.toMatchObject({
      code: 'QUERY_NOT_PUSHABLE'
    })
    expect(calls).toEqual([2, 1])
    expect(
      (
        await collection.search([1, 0], {
          k: 3,
          filter: {
            all: [
              { field: 'group', in: ['kept'] },
              { field: 'order', gte: 2 },
              { not: { field: 'group', eq: 'excluded' } }
            ]
          }
        })
      ).map((hit) => hit.id)
    ).toEqual(['second'])
    expect(await collection.search([1, 0], { k: 3, filter: { any: [] } })).toEqual([])
  })

  it('uses shared similarTo/recommend sample semantics and rejects invalid directions', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const collection = host
      .backend('memory')
      .use(vector)
      .collection('docs', { dimensions: 2, metric: 'cosine' })
    await collection.upsert([
      { id: 'a', vector: [1, 0] },
      { id: 'b', vector: [1, 0] },
      { id: 'c', vector: [0, 1] },
      { id: 'd', vector: [-1, 0] }
    ])
    expect((await collection.similarTo('a').topK(4).all()).map((hit) => hit.id)).toEqual([
      'b',
      'c',
      'd'
    ])
    expect(
      (
        await collection
          .recommend({ positive: ['a', 'a', 'c'], negative: ['d', 'd'] })
          .topK(4)
          .all()
      ).map((hit) => hit.id)
    ).toEqual(['b'])
    expect(() => collection.recommend({ positive: ['a'], negative: ['a'] })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    await expect(
      collection
        .recommend({ positive: ['missing'] })
        .topK(2)
        .all()
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(collection.similarTo('missing').topK(2).all()).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    expect(() => collection.near([0, 0])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    await expect(collection.search([1, 0], { k: 1.5 })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    const euclid = host
      .backend('memory')
      .use(vector)
      .collection('distance', { dimensions: 2, metric: 'euclid' })
    await euclid.upsert([
      { id: 'near', vector: [1, 0] },
      { id: 'far', vector: [3, 0] }
    ])
    expect((await euclid.search([0, 0], { k: 2 })).map((hit) => hit.score)).toEqual([-1, -3])
  })

  it('shares vector TTL with the physical draft and preserves rollback, deadlines and conflict identity', async () => {
    const scheduler = createManualScheduler()
    await using host = await createStorageHost({ scheduler, plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const collection = store.use(vector).collection('docs', { dimensions: 2, metric: 'dot' })
    const target = lockKey.vector('docs', 'a')
    await collection.upsert([{ id: 'a', vector: [1, 0] }])
    await store.set('marker', 'before')
    const original = new Error('rollback vector deadline')
    await expect(
      store.transaction(async (scope) => {
        expect(await scope.use(ttl).expire(target, 10)).toBe(true)
        expect(await scope.use(ttl).remaining(target)).toBe(10)
        await scope.set('marker', 'after')
        throw original
      })
    ).rejects.toMatchObject({ cause: original })
    expect(await store.get('marker')).toBe('before')
    expect(await store.use(ttl).remaining(target)).toBeUndefined()
    await store.transaction(async (scope) => {
      await scope.use(ttl).expire(target, 10)
      await scope.set('marker', 'committed')
    })
    scheduler.advance(5)
    await collection.upsert([{ id: 'a', vector: [2, 0] }])
    expect(await store.use(ttl).remaining(target)).toBe(5)
    const conflicts: Array<readonly ILockKey[]> = []
    const policy = defineConcurrencyPolicy({
      name: 'vector conflict identity',
      locking: 'optimistic',
      decide: (conflict) => {
        conflicts.push(conflict.keys)
        return { action: 'reject' }
      }
    })
    await expect(
      store.transaction(
        async (scope) => {
          expect(await scope.use(ttl).remaining(target)).toBe(5)
          scheduler.advance(5)
          await scope.set('marker', 'uncommitted')
        },
        { concurrency: policy }
      )
    ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
    expect(conflicts).toEqual([[target]])
    expect(await store.get('marker')).toBe('committed')
    expect(await collection.search([1, 0], { k: 2 })).toEqual([])
  })

  it('validates k=0 without scanning and physically deletes expired matches with actual counts', async () => {
    const scheduler = createManualScheduler()
    await using host = await createStorageHost({ scheduler, plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const collection = store
      .use(vector)
      .collection<{ group: string }>('docs', { dimensions: 2, metric: 'dot' })
    await collection.upsert([{ id: 'expired', vector: [1, 0], payload: { group: 'same' } }], {
      ttlMs: 1
    })
    await collection.upsert([{ id: 'live', vector: [2, 0], payload: { group: 'same' } }])
    scheduler.advance(1)
    expect(await collection.search([1, 0], { k: 0 })).toEqual([])
    expect(() => collection.near([1, 0]).topK(0)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(await collection.deleteWhere({ group: 'same' }, { count: DeleteCountMode.scroll })).toBe(
      2
    )
    expect(
      await collection.deleteWhere({ group: 'same' }, { count: DeleteCountMode.precount })
    ).toBe(0)
    expect(await store.use(ttl).remaining(lockKey.vector('docs', 'expired'))).toBeUndefined()
  })

  it('keeps org, notifications, extracted sources and lock admission on their original owner', async () => {
    const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const first = createOrgId()
    const second = createOrgId()
    const left = host.org(first).backend('memory')
    const right = host.org(second).backend('memory')
    const collection = left.use(vector).collection('docs', { dimensions: 2, metric: 'dot' })
    const other = right.use(vector).collection('docs', { dimensions: 2, metric: 'dot' })
    const changes: IStorageChange[] = []
    left.subscribeChanges((change) => changes.push(change))
    await collection.upsert([{ id: 'a', vector: [1, 0] }])
    await other.upsert([{ id: 'a', vector: [9, 0] }])
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ channel: 'all', orgId: first })
    const entered = deferred<void>()
    const finish = deferred<void>()
    const held = left
      .tx()
      .lock(lockKey.vector('docs', 'a'))
      .run(async () => {
        entered.resolve()
        await finish.promise
      })
    await entered.promise
    /** This admitted root write must detach its point before waiting on the original key lease. */
    let pending: Promise<void> | undefined
    try {
      await expect(
        collection.upsert([{ id: 'a', vector: [2, 0] }], { concurrency: ConcurrencyPolicy.fail() })
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      await expect(left.clearAll({ concurrency: ConcurrencyPolicy.fail() })).rejects.toMatchObject({
        code: 'LOCK_REJECTED'
      })
      /** Caller mutation after admission must not change the point waiting on the original lock. */
      const components = [2, 0]
      pending = collection.upsert([{ id: 'a', vector: components }])
      components[0] = 99
    } finally {
      finish.resolve()
      await held
    }
    await pending
    expect((await collection.search([1, 0], { k: 1 }))[0]!.score).toBe(2)
    expect((await other.search([1, 0], { k: 1 }))[0]!.score).toBe(9)
    const saved = collection.near([1, 0]).topK(1)
    await host.dropOrg(first)
    expect(await saved.all()).toEqual([])
    await collection.upsert([{ id: 'a', vector: [3, 0] }])
    const iterator = saved.stream()
    await host.dispose()
    await expect(saved.all()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(iterator.next()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await expect(collection.upsert([{ id: 'a', vector: [4, 0] }])).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
  })
})
