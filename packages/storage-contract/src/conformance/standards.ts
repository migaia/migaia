import type { IAnyStorageCapability } from '../capability.js'
import { kv } from '../capabilities/kv.js'
import { records } from '../capabilities/records.js'
import { ttl, type ITtlTarget } from '../capabilities/ttl.js'
import { counter } from '../capabilities/counter.js'
import { sql } from '../capabilities/sql.js'
import { vector } from '../capabilities/vector.js'
import { rdf, term } from '../capabilities/rdf.js'
import { sparql } from '../capabilities/sparql.js'
import { blob } from '../capabilities/blob.js'
import { durableChangeFeed } from '../capabilities/durable-change-feed.js'
import type { IRecordStore } from '../store.js'
import type { IConformanceCase, IConformanceHarness } from './harness.js'
import { conformanceApi, conformanceCleanup } from './harness.js'

/** Standard groups use only public operations and never infer an unlisted capability. */
export function standardConformance(
  check: IConformanceCase,
  harness: IConformanceHarness,
  capabilities: readonly IAnyStorageCapability[]
): void {
  const expect = harness.expect
  if (capabilities.includes(kv)) {
    check('kv · ordered batches, canonical duplicates and prefix removal', async (store) => {
      const api = conformanceApi(store, kv)
      await api.setMany([
        { key: ['batch', 1], value: 'one' },
        { key: ['batch', 2], value: 'two' }
      ])
      await expect(
        api.getMany([['batch', 2], 'missing', ['batch', 1], ['batch', 2]])
      ).resolves.toEqual(['two', undefined, 'one', 'two'])
      await expect(
        api.setMany([
          { key: ['duplicate'], value: 'one' },
          { key: ['duplicate'], value: 'two' }
        ])
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
      await expect(api.getMany([['duplicate']])).resolves.toEqual([undefined])
      await expect(api.removeMany([['batch', 1], ['batch', 1], 'missing'])).resolves.toBe(1)
      await expect(api.removeByPrefix(['batch'])).resolves.toBe(1)
      await expect(
        api.getMany([
          ['batch', 1],
          ['batch', 2]
        ])
      ).resolves.toEqual([undefined, undefined])
      await expect(api.getMany([])).resolves.toEqual([])
      await expect(api.setMany([])).resolves.toBeUndefined()
      await expect(api.removeMany([])).resolves.toBe(0)
    })
  }
  if (capabilities.includes(records)) {
    check('records · native query and record prefix removal', async (store) => {
      const api = conformanceApi(store, records)
      const native = store as unknown as IRecordStore
      await native.putRecord({ value: 1 }, ['record-prefix', 1])
      await native.putRecord({ value: 2 }, ['record-prefix', 2])
      await expect(
        api.query<{ value: number }>().where({ value: 2 }).select('value').all()
      ).resolves.toEqual([{ value: 2 }])
      await expect(api.query().count()).resolves.toBe(2)
      await expect(api.removeByPrefix(['record-prefix'])).resolves.toBe(2)
      await expect(api.query().count()).resolves.toBe(0)
    })
  }
  if (capabilities.includes(ttl)) {
    check('ttl · missing targets, persist and immediate expiry', async (store) => {
      const api = conformanceApi(store, ttl)
      /** Select only a channel whose actual public writer this subject declares. */
      let target: ITtlTarget
      /** This original writer creates the same logical target used by the TTL calls. */
      let write: () => Promise<unknown>
      /** Read through the selected native API so ignored expiry cannot pass on a return value alone. */
      let exists: () => Promise<boolean>
      if (capabilities.includes(kv)) {
        /** Text TTL is exercised only when this subject actually publishes KV. */
        const values = conformanceApi(store, kv)
        target = { channel: 'text', key: 'ttl-key' }
        write = () => values.set('ttl-key', 'kept')
        exists = async () => (await values.get('ttl-key')) === 'kept'
      } else if (capabilities.includes(vector)) {
        /** Collection construction establishes the real vector schema before target access. */
        const collection = conformanceApi(store, vector).collection('conformance-ttl', {
          dimensions: 1,
          metric: 'dot'
        })
        target = { channel: 'vector', collection: 'conformance-ttl', id: 'ttl-key' }
        write = () => collection.upsert([{ id: 'ttl-key', vector: [1] }])
        exists = async () =>
          (await collection.search([1], { k: 1, exact: true })).some((hit) => hit.id === 'ttl-key')
      } else {
        /** A records-only native backend need not fabricate a text channel. */
        expect(capabilities.includes(records)).toBe(true)
        const native = store as unknown as IRecordStore
        expect(typeof native.putRecord).toBe('function')
        expect(typeof native.getRecord).toBe('function')
        target = { channel: 'record', key: 'ttl-key' }
        write = () => native.putRecord({ kept: true }, 'ttl-key')
        exists = async () => (await native.getRecord('ttl-key')) !== undefined
      }
      await expect(api.expire(target, 0)).resolves.toBe(false)
      await expect(api.persist(target)).resolves.toBe(false)
      await expect(api.remaining(target)).resolves.toBeUndefined()
      await write()
      await expect(api.expire(target, 60_000)).resolves.toBe(true)
      const remaining = await api.remaining(target)
      expect(typeof remaining).toBe('number')
      expect(remaining !== undefined && remaining >= 0 && remaining <= 60_000).toBe(true)
      await expect(api.persist(target)).resolves.toBe(true)
      await expect(api.remaining(target)).resolves.toBeUndefined()
      await expect(exists()).resolves.toBe(true)
      await expect(api.expire(target, 0)).resolves.toBe(true)
      await expect(exists()).resolves.toBe(false)
      await expect(api.persist(target)).resolves.toBe(false)
    })
  }
  if (capabilities.includes(counter)) {
    check('counter · concurrent increments and invalid deltas', async (store) => {
      const api = conformanceApi(store, counter)
      await Promise.all(Array.from({ length: 100 }, () => api.increment('counter-key')))
      await expect(api.increment('counter-key', 0)).resolves.toBe(100)
      await expect(api.increment('counter-key', -2)).resolves.toBe(98)
      await expect(api.increment('counter-key', 0.5)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      })
      await expect(api.increment('counter-key', 0)).resolves.toBe(98)
    })
  }
  if (capabilities.includes(sql)) {
    check('sql · parameterized native read terminals', async (store) => {
      const api = conformanceApi(store, sql).sql
      await expect(api`SELECT ${'conformance'} AS value`.get()).resolves.toEqual({
        value: 'conformance'
      })
      await expect(api`SELECT ${'conformance-all'} AS value`.all()).resolves.toEqual([
        { value: 'conformance-all' }
      ])
      const result = await api`SELECT ${'conformance-run'} AS value`.run()
      expect(typeof result.changes === 'number' || typeof result.changes === 'bigint').toBe(true)
    })
  }
  if (capabilities.includes(vector)) {
    check('vector · native rank, payload, vector and deletion', async (store) => {
      const collection = conformanceApi(store, vector).collection<{ label: string }>(
        'conformance',
        { dimensions: 2, metric: 'dot' }
      )
      await collection.upsert([
        { id: 'one', vector: [1, 0], payload: { label: 'one' } },
        { id: 'two', vector: [0, 1], payload: { label: 'two' } }
      ])
      await expect(
        collection.search([1, 0], { k: 1, withPayload: true, exact: true })
      ).resolves.toMatchObject([{ id: 'one', payload: { label: 'one' } }])
      const hits = await collection.near([1, 0], { exact: true }).topK(1).withVector().all()
      expect(hits).toMatchObject([{ id: 'one', score: 1, vector: [1, 0] }])
      await expect(collection.deleteWhere({ label: 'two' })).resolves.toBe(1)
      await expect(collection.search([0, 1], { k: 2, exact: true })).resolves.toMatchObject([
        { id: 'one' }
      ])
      await collection.delete(['one'])
      await expect(collection.search([1, 0], { k: 2, exact: true })).resolves.toEqual([])
    })
  }
  if (capabilities.includes(rdf)) {
    check('rdf · ground identity, duplicate add and delete', async (store) => {
      const api = conformanceApi(store, rdf)
      const quad = {
        subject: term.iri('urn:conformance:subject'),
        predicate: term.iri('urn:conformance:predicate'),
        object: term.literal('value'),
        graph: term.defaultGraph
      }
      await api.add([quad, quad])
      await expect(api.match({ subject: quad.subject }).all()).resolves.toEqual([quad])
      await expect(api.match({ object: term.literal('value') }).count()).resolves.toBe(1)
      await api.delete([quad, quad])
      await expect(api.match({}).all()).resolves.toEqual([])
    })
  }
  if (capabilities.includes(sparql)) {
    check('sparql · native select, ask, construct and update', async (store) => {
      const api = conformanceApi(store, sparql)
      const value = term.literal('conformance')
      await expect(api`SELECT ?value WHERE { BIND(${value} AS ?value) }`.select()).resolves.toEqual(
        [{ value }]
      )
      await expect(api`ASK { FILTER(true) }`.ask()).resolves.toBe(true)
      await expect(
        api`CONSTRUCT { <urn:conformance:s> <urn:conformance:p> ${value} } WHERE { }`.construct()
      ).resolves.toEqual([
        {
          subject: term.iri('urn:conformance:s'),
          predicate: term.iri('urn:conformance:p'),
          object: value,
          graph: term.defaultGraph
        }
      ])
      await expect(
        api`INSERT DATA { <urn:conformance:s> <urn:conformance:p> ${value} }`.update()
      ).resolves.toBeUndefined()
      await expect(
        api`ASK { <urn:conformance:s> <urn:conformance:p> ${value} }`.ask()
      ).resolves.toBe(true)
    })
  }
  if (capabilities.includes(blob)) {
    check('blob · independent bytes, ranges, listing and deletion', async (store) => {
      const api = conformanceApi(store, blob)
      const info = await api.put('objects/one', new Uint8Array([1, 2, 3]), {
        metadata: { fixture: 'conformance' }
      })
      expect(info.size).toBe(3)
      await expect(api.head('objects/one')).resolves.toMatchObject({ key: 'objects/one', size: 3 })
      const object = await api.get('objects/one', { range: { start: 1, end: 2 } })
      expect(object).toBeDefined()
      await conformanceCleanup(object!, async () => {
        await expect(object!.bytes()).resolves.toEqual(new Uint8Array([2, 3]))
      })
      expect((await api.list({ prefix: 'objects/' })).items.map((item) => item.key)).toEqual([
        'objects/one'
      ])
      await expect(api.removeByPrefix('objects/')).resolves.toBe(1)
      await expect(api.get('objects/one')).resolves.toBeUndefined()
      await expect(api.remove('objects/one')).resolves.toBe(false)
    })
  }
  if (capabilities.includes(durableChangeFeed)) {
    check('durableChangeFeed · native replay and tail resource', async (store) => {
      const api = conformanceApi(store, durableChangeFeed)
      const initial = await api.readChanges({ limit: 1 })
      expect(typeof initial.cursor).toBe('string')
      expect(Array.isArray(initial.changes)).toBe(true)
      if (capabilities.includes(kv)) {
        const values = conformanceApi(store, kv)
        await values.set('durable-replay', 'committed')
        const replay = await api.readChanges({ after: initial.cursor })
        expect(
          replay.changes.some(
            (change) =>
              (change.channel === 'all' || change.channel === 'value') &&
              (change.keys === undefined || change.keys.includes('durable-replay')) &&
              typeof change.cursor === 'string'
          )
        ).toBe(true)
        let notify!: () => void
        const notification = new Promise<void>((resolve) => {
          notify = resolve
        })
        const live = await api.tailChanges({
          from: 'now',
          onChange: (change) => {
            if (
              (change.channel === 'all' || change.channel === 'value') &&
              (change.keys === undefined || change.keys.includes('durable-tail'))
            )
              notify()
          }
        })
        await conformanceCleanup(live, async () => {
          await values.set('durable-tail', 'committed')
          await notification
          await expect(values.get('durable-tail')).resolves.toBe('committed')
        })
      }
      const tail = await api.tailChanges({ from: 'now', onChange: () => undefined })
      await conformanceCleanup(tail, () => {
        expect(typeof tail.dispose).toBe('function')
      })
      const next = await api.readChanges({ after: initial.cursor, limit: 1 })
      expect(typeof next.cursor).toBe('string')
    })
  }
}
