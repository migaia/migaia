import { describe, expect, it } from 'vitest'
import { records, rdf, vector, type IQuad } from '@migaia/storage-contract'
import { term } from '../../src/authoring/rdf.ts'
import { ConcurrencyPolicy } from '../../src/authoring/concurrency.ts'
import { createOrgId, createStorageHost, definePlugin } from '../../src/index.ts'
import { memoryBackendPlugin } from '../../src/plugins/memory.ts'
import { MemoryOperation } from '../../src/backends/memory-constants.ts'

/** Native query mutations select and write inside the original transaction attempt. */
describe('memory native query writes', () => {
  it('patches actual records and retains generic field values through one write pipeline', async () => {
    const operations: string[] = []
    const observe = definePlugin('query-write-observer', (core) => ({
      install() {
        core.usePipeline((input, next) => {
          operations.push(input.operation)
          return next(input)
        })
        return {}
      }
    }))
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin(), observe] })
    const store = host.backend('memory')
    await store.putRecord({ active: true, retained: 'a', date: new Date(1), map: new Map() }, 'a')
    await store.putRecord({ active: false, retained: 'b' }, 'b')
    operations.length = 0
    expect(
      await store
        .use(records)
        .query<{ active: boolean; retained: string; date: Date; map: Map<string, number> }>()
        .where({ active: true })
        .update({ active: false })
    ).toBe(1)
    expect(operations).toEqual([MemoryOperation.recordQueryUpdate])
    expect(await store.getRecord('a')).toMatchObject({
      active: false,
      retained: 'a',
      date: new Date(1)
    })
    expect(
      await store
        .use(records)
        .query<{ retained: string; date: Date; map: Map<string, number> }>()
        .where({ retained: 'a' })
        .update({ date: new Date(2), map: new Map([['answer', 42]]) })
    ).toBe(1)
    expect(await store.getRecord('a')).toMatchObject({
      date: new Date(2),
      map: new Map([['answer', 42]])
    })
    const failure = new Error('rollback selected record')
    await expect(
      store.transaction(async (scope) => {
        expect(
          await scope.use(records).query<{ retained: string }>().where({ retained: 'a' }).delete()
        ).toBe(1)
        expect(await scope.getRecord('a')).toBeUndefined()
        throw failure
      })
    ).rejects.toMatchObject({ cause: failure })
    expect(await store.getRecord('a')).toBeDefined()
    operations.length = 0
    await store.transaction(async (scope) => {
      operations.length = 0
      expect(
        await scope
          .use(records)
          .query<{ retained: string }>()
          .where({ retained: 'b' })
          .update({ retained: 'changed' })
      ).toBe(1)
      expect(operations).toEqual([MemoryOperation.recordQueryUpdate])
    })
    expect(await store.getRecord('b')).toEqual({ active: false, retained: 'changed' })
  })

  it('replaces only selected logical RDF identities and preserves root and scoped counts', async () => {
    const org = createOrgId()
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const api = host.org(org).backend('memory').use(rdf)
    const a: IQuad = {
      subject: term.iri('urn:a'),
      predicate: term.iri('urn:knows'),
      object: term.iri('urn:b'),
      graph: term.defaultGraph
    }
    const b: IQuad = { ...a, subject: term.iri('urn:b'), object: term.iri('urn:c') }
    const replacement: IQuad = { ...a, object: term.iri('urn:replacement') }
    await api.add([a, b, replacement])
    expect(await api.match({ subject: b.subject }).replace(a, replacement)).toBe(0)
    expect(await api.match({}).replace(a, a)).toBe(0)
    expect(await api.match({}).replace(a, replacement)).toBe(1)
    expect(await api.match({}).all()).toEqual(expect.arrayContaining([replacement, b]))
    expect(await host.backend('memory').use(rdf).match({}).count()).toBe(0)
    await host
      .org(org)
      .backend('memory')
      .transaction(async (scope) => {
        expect(await scope.use(rdf).match({ subject: replacement.subject }).delete()).toBe(1)
        expect(await scope.use(rdf).match({}).replace(b, replacement)).toBe(1)
      })
    expect(await api.match({}).all()).toEqual([replacement])
  })

  it('deletes only the original bounded vector ranking and keeps other collections and organizations', async () => {
    const operations: string[] = []
    const observe = definePlugin('vector-write-observer', (core) => ({
      install() {
        core.usePipeline((input, next) => {
          operations.push(input.operation)
          return next(input)
        })
        return {}
      }
    }))
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin(), observe] })
    const collection = host
      .backend('memory')
      .use(vector)
      .collection<{ allowed: boolean }>('points', { dimensions: 1, metric: 'dot' })
    await collection.upsert([
      { id: 'a', vector: [3], payload: { allowed: false } },
      { id: 'b', vector: [2], payload: { allowed: true } },
      { id: 'c', vector: [1], payload: { allowed: true } }
    ])
    const other = host
      .org(createOrgId())
      .backend('memory')
      .use(vector)
      .collection('points', { dimensions: 1, metric: 'dot' })
    await other.upsert([{ id: 'a', vector: [3] }])
    operations.length = 0
    expect(
      await collection
        .near([1])
        .topK(2)
        .where((payload) => payload.allowed)
        .delete()
    ).toBe(1)
    expect(operations).toEqual([MemoryOperation.vectorQueryDelete])
    expect((await collection.search([1], { k: 3 })).map((hit) => hit.id)).toEqual(['a', 'c'])
    expect(await collection.similarTo('a').topK(1).delete()).toBe(1)
    expect((await collection.search([1], { k: 3 })).map((hit) => hit.id)).toEqual(['a'])
    expect((await other.search([1], { k: 3 })).map((hit) => hit.id)).toEqual(['a'])
  })

  it('rolls back partial client selection and applies the original explicit conflict policy', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    await store.putRecord({ active: true }, 'a')
    await store.putRecord({ active: true }, 'b')
    const failure = new Error('query predicate failed')
    let calls = 0
    await expect(
      store
        .use(records)
        .query()
        .where(() => {
          if (++calls === 2) throw failure
          return true
        })
        .delete()
    ).rejects.toMatchObject({ cause: failure })
    expect(await store.use(records).query().count()).toBe(2)
    await expect(
      store
        .use(records)
        .query()
        .where(() => {
          store.sync.set('a', 'external', { conflictPolicy: 'replace' })
          return true
        })
        .limit(1)
        .update({ active: false }, { concurrency: ConcurrencyPolicy.optimistic({ retries: 0 }) })
    ).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
    expect(await store.get('a')).toBe('external')
    expect(await store.getRecord('b')).toEqual({ active: true })
  })
})
