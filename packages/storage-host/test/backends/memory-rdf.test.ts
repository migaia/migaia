import { memoryNotificationsFeature } from '../../src/features/memory-notifications.js'
import { memoryChangeFeedFeature } from '../../src/features/memory-change-feed.js'
import { describe, expect, it } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import {
  rdf,
  defineConcurrencyPolicy,
  type ILockKey,
  type IStorageChange,
  type IQuad
} from '@migaia/storage-contract'
import { term } from '../../src/authoring/rdf.js'
import { lockKey, ConcurrencyPolicy } from '../../src/authoring/concurrency.js'
import { createStorageHost, createOrgId } from '../../src/index.js'
import { memoryBackendPlugin } from '../../src/plugins/memory.js'

/** Ground fixtures use the same public term factories as applications and server authors. */
function quad(subject: string, object: string, graph = term.defaultGraph): IQuad {
  return {
    subject: term.iri('urn:' + subject),
    predicate: term.iri('urn:knows'),
    object: term.iri('urn:' + object),
    graph
  }
}

/** Actual installed native stores exercise RDF identity, namespace, draft and lock ownership. */
describe('memory native RDF', () => {
  it('matches every bound-position subset through real fixed native indexes and preserves ground identity', async () => {
    await using host = await createStorageHost({
      plugins: [
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        })
      ]
    })
    const api = host.backend('memory').use(rdf)
    const target = quad('a', 'b')
    const named: IQuad = { ...target, graph: term.iri('urn:graph') }
    await api.add([target, named, quad('x', 'y'), target])
    expect(await api.match({}).count()).toBe(3)
    const positions = ['subject', 'predicate', 'object', 'graph'] as const
    for (let mask = 1; mask < 16; mask++) {
      const pattern: Partial<IQuad> = {}
      for (const [index, position] of positions.entries())
        if ((mask & (1 << index)) !== 0) Object.assign(pattern, { [position]: target[position] })
      const query = api.match(pattern)
      expect(query.explain().fullScan).toBe(false)
      expect(query.explain().index).toMatch(/^rdf\.(?:g)?(?:spo|pos|osp)$/)
      expect(await query.all()).toContainEqual(target)
    }
    const literal: IQuad = { ...target, object: term.literal('same', { language: 'EN' }) }
    await api.add([literal, { ...target, object: term.literal('same') }])
    expect(await api.match({ object: term.literal('same', { language: 'en' }) }).all()).toEqual([
      literal
    ])
    await api.delete([target, target])
    expect(
      await api.match({ graph: term.defaultGraph, subject: target.subject }).all()
    ).not.toContainEqual(target)
    expect(await api.match({ graph: named.graph }).all()).toEqual([named])
  })

  it('accepts legal large RDF literals through native query and deletion', async () => {
    await using host = await createStorageHost({
      plugins: [
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        })
      ]
    })
    const api = host.backend('memory').use(rdf)
    const large: IQuad = { ...quad('large', 'unused'), object: term.literal('x'.repeat(1_048_577)) }
    await api.add([large])
    expect(await api.match({ object: large.object }).first()).toEqual(large)
    const page = await api.match({ subject: large.subject }).page(1)
    expect(page.items).toEqual([large])
    await api.delete([large])
    expect(await api.match({}).count()).toBe(0)
  })

  it('isolates root, default and two fixed organizations while keeping default and named graphs disjoint', async () => {
    const defaultOrg = createOrgId()
    await using host = await createStorageHost({
      org: defaultOrg,
      plugins: [
        memoryBackendPlugin(
          { namespace: 'configured' },
          {
            notifications: memoryNotificationsFeature(),
            changeFeed: memoryChangeFeedFeature()
          }
        )
      ]
    })
    const orgA = createOrgId()
    const orgB = createOrgId()
    const root = host.backend('memory').use(rdf)
    const same = quad('a', 'b')
    await root.add([same])
    await host
      .org(orgA)
      .backend('memory')
      .use(rdf)
      .add([{ ...same, graph: term.iri('urn:graph') }])
    await host
      .org(orgB)
      .backend('memory')
      .use(rdf)
      .add([quad('other', 'b')])
    expect(await host.org(defaultOrg).backend('memory').use(rdf).match({}).all()).toEqual([same])
    expect(
      await host.org(orgA).backend('memory').use(rdf).match({ graph: term.defaultGraph }).all()
    ).toEqual([])
    const extracted = host.org(orgB).backend('memory').use(rdf).match
    await host.dropOrg(orgA)
    expect(await host.org(orgA).backend('memory').use(rdf).match({}).count()).toBe(0)
    expect(await extracted({}).all()).toEqual([quad('other', 'b')])
    expect(await root.match({}).all()).toEqual([same])
  })

  it('shares the original transaction draft, rollback, conflict revisions and expired scope admission', async () => {
    await using host = await createStorageHost({
      plugins: [
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        })
      ]
    })
    const store = host.backend('memory')
    const api = store.use(rdf)
    const a = quad('a', 'b')
    const b = quad('b', 'c')
    await api.add([a])
    const failure = new Error('rollback RDF')
    await expect(
      store.transaction(async (scope) => {
        await scope.use(rdf).delete([a])
        await scope.use(rdf).add([b])
        expect(await scope.use(rdf).match({}).all()).toEqual([b])
        throw failure
      })
    ).rejects.toMatchObject({ cause: failure })
    expect(await api.match({}).all()).toEqual([a])
    let escaped: ReturnType<typeof api.match> | undefined
    await store.transaction(async (scope) => {
      await scope.use(rdf).delete([a])
      await scope.use(rdf).add([b])
      expect(await scope.use(rdf).match({ subject: b.subject }).all()).toEqual([b])
      escaped = scope.use(rdf).match({})
    })
    expect(await api.match({}).all()).toEqual([b])
    await expect(escaped!.all()).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED',
      operation: 'transaction.scope'
    })
    const read = deferred<void>()
    const finish = deferred<void>()
    const conflicts: Array<readonly ILockKey[]> = []
    const policy = defineConcurrencyPolicy({
      name: 'RDF conflict identity',
      locking: 'optimistic',
      decide: (conflict) => {
        conflicts.push(conflict.keys)
        return { action: 'reject' }
      }
    })
    const pending = store.transaction(
      async (scope) => {
        expect(await scope.use(rdf).match({}).all()).toEqual([b])
        read.resolve()
        await finish.promise
      },
      { concurrency: policy }
    )
    await read.promise
    await api.delete([b])
    finish.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
    expect(conflicts).toEqual([[lockKey.rdf(b)]])
  })

  it('reuses same-graph client traversal and canonical page cursors without claiming native traversal', async () => {
    await using host = await createStorageHost({
      plugins: [
        memoryBackendPlugin(undefined, {
          notifications: memoryNotificationsFeature(),
          changeFeed: memoryChangeFeedFeature()
        })
      ]
    })
    const api = host.backend('memory').use(rdf)
    const a = quad('a', 'b')
    const b = quad('b', 'c')
    await api.add([a, b, { ...b, graph: term.iri('urn:other') }, quad('d', 'e')])
    const query = api
      .match({ subject: a.subject, graph: term.defaultGraph })
      .follow(a.predicate)
      .inverse(a.predicate)
    expect(await query.all()).toEqual([a])
    await expect(query.requirePushdown().all()).rejects.toMatchObject({
      code: 'QUERY_NOT_PUSHABLE'
    })
    const paged = api.match({ graph: term.defaultGraph })
    const first = await paged.page(2)
    const second = await paged.after(first.next!).page(2)
    expect([...first.items, ...second.items]).toHaveLength(3)
    const stream = api.match({}).stream()
    await stream.next()
    const cleanup = stream.dispose()
    expect(stream.dispose()).toBe(cleanup)
    await cleanup
    expect(await stream.next()).toMatchObject({ done: true })
  })

  it('uses the original logical RDF lock for root mutation and capacity victims', async () => {
    await using host = await createStorageHost({
      plugins: [
        memoryBackendPlugin(
          { capacity: { maxEntries: 1 } },
          {
            notifications: memoryNotificationsFeature(),
            changeFeed: memoryChangeFeedFeature()
          }
        )
      ]
    })
    const store = host.backend('memory')
    const changes: IStorageChange[] = []
    store.subscribeChanges((change) => changes.push(change))
    const api = store.use(rdf)
    const a = quad('a', 'b')
    await api.add([a])
    const entered = deferred<void>()
    const finish = deferred<void>()
    const held = store
      .tx()
      .lock(lockKey.rdf(a))
      .run(async () => {
        entered.resolve()
        await finish.promise
      })
    await entered.promise
    try {
      await expect(
        api.delete([a], { concurrency: ConcurrencyPolicy.fail() })
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      await expect(
        store.set('victim', 'x', { concurrency: ConcurrencyPolicy.fail() })
      ).rejects.toMatchObject({ code: 'LOCK_REJECTED' })
      expect(await api.match({}).all()).toEqual([a])
    } finally {
      finish.resolve()
      await held
    }
    await store.set('victim', 'x')
    expect(await api.match({}).count()).toBe(0)
    expect(
      changes
        .filter((change) => change.channel === 'all')
        .every((change) => change.keys === undefined)
    ).toBe(true)
    await store.clearAll()
    expect(await store.keys()).toEqual([])
  })
})
