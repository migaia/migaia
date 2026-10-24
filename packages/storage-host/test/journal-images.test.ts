import { describe, expect, it } from 'vitest'
import { lockKey } from '../src/authoring/concurrency.js'
import { rdf, vector, ttl, type IQuad } from '@migaia/storage-contract'
import { term } from '../src/authoring/rdf.js'
import { createStorageHost, createOrgId, memoryBackendPlugin } from '../src/index.js'
import { resolveStorageJournalBinding } from '../src/journal/binding.js'
import { memoryJournalDeadlineTarget } from '../src/backends/memory-journal-image.js'

describe('original memory journal images', () => {
  it('restores exact text, byte, record and deadline images through the same native draft', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const binding = resolveStorageJournalBinding(host, 'memory').binding
    const key = [new Date(0), new Uint8Array([7]).buffer]
    await store.set('text', 'original')
    await store.setBytes('bytes', new Uint8Array([1, 2, 3]))
    await store.putRecord({ count: 1, nullable: null }, key)
    await store.use(ttl).expire({ channel: 'text', key: 'text' }, 60_000)
    const target = lockKey.text('text')
    const deadline = memoryJournalDeadlineTarget(target)
    let revision: unknown
    await store
      .tx()
      .lock(target, lockKey.bytes('bytes'), lockKey.record(key))
      .run(async (scope) => {
        const before = await binding.readImage!(scope, target)
        const bytes = await binding.readImage!(scope, lockKey.bytes('bytes'))
        const record = await binding.readImage!(scope, lockKey.record(key))
        const ttlImage = await binding.readImage!(scope, deadline)
        const observed = await binding.readRevision!(scope, target)
        expect(observed).toEqual({ epoch: 0, revision: 2 })
        await scope.set('text', 'changed')
        await scope.removeBytes('bytes')
        await scope.deleteRecord(key)
        await binding.writeImage!(scope, target, before)
        await binding.writeImage!(scope, lockKey.bytes('bytes'), bytes)
        await binding.writeImage!(scope, lockKey.record(key), record)
        await binding.writeImage!(scope, deadline, ttlImage)
        expect(await binding.readImage!(scope, target)).toEqual(before)
        expect(await binding.readImage!(scope, deadline)).toEqual(ttlImage)
        revision = await binding.readRevision!(scope, target)
        expect(revision).toEqual({ epoch: 0, revision: 3 })
      })
    expect(await store.get('text')).toBe('original')
    expect(await store.getBytes('bytes')).toEqual(new Uint8Array([1, 2, 3]))
    expect(await store.getRecord(key)).toEqual({ count: 1, nullable: null })
    await store
      .tx()
      .lock(target)
      .run(async (scope) => {
        expect(await binding.readRevision!(scope, target)).toEqual(revision)
      })
    await store.clearAll()
    await store
      .tx()
      .lock(target)
      .run(async (scope) => {
        expect(await binding.readImage!(scope, target)).toEqual({ present: false })
        expect(await binding.readRevision!(scope, target)).toEqual({ epoch: 1, revision: 0 })
      })
  })

  it('uses logical RDF graphs and the existing collection configuration for native image restoration', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const binding = resolveStorageJournalBinding(host, 'memory').binding
    const collection = store.use(vector).collection('points', { dimensions: 2, metric: 'dot' })
    await collection.upsert([{ id: 'one', vector: [1, 2], payload: { label: 'kept' } }])
    const quad: IQuad = {
      subject: term.iri('urn:subject'),
      predicate: term.iri('urn:predicate'),
      object: term.literal('原始值'),
      graph: term.defaultGraph
    }
    await store.use(rdf).add([quad])
    const vectorTarget = lockKey.vector('points', 'one')
    const rdfTarget = lockKey.rdf(quad)
    await store
      .tx()
      .lock(vectorTarget, rdfTarget)
      .run(async (scope) => {
        const vectorImage = await binding.readImage!(scope, vectorTarget)
        const rdfImage = await binding.readImage!(scope, rdfTarget)
        expect(vectorImage.present).toBe(true)
        expect(rdfImage.present).toBe(true)
        await binding.writeImage!(scope, vectorTarget, { present: false })
        await binding.writeImage!(scope, rdfTarget, { present: false })
        expect(await binding.readImage!(scope, rdfTarget)).toEqual({ present: false })
        await binding.writeImage!(scope, vectorTarget, vectorImage)
        await binding.writeImage!(scope, rdfTarget, rdfImage)
        expect(await binding.readRevision!(scope, vectorTarget)).toEqual({ epoch: 0, revision: 2 })
        expect(await binding.readRevision!(scope, rdfTarget)).toEqual({ epoch: 0, revision: 2 })
      })
    expect(await collection.near([1, 2]).topK(1).withVector().all()).toMatchObject([
      { id: 'one', vector: [1, 2], payload: { label: 'kept' } }
    ])
    expect(await store.use(rdf).match({}).all()).toEqual([quad])
  })

  it('keeps rollback, exact org authority and the ordinary structured-clone domain', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const binding = resolveStorageJournalBinding(host, 'memory').binding
    const foreign = resolveStorageJournalBinding(host.org(createOrgId()), 'memory').binding
    await store.set('text', 'before')
    await store.putRecord(new Date(0), 'structured')
    await expect(
      store
        .tx()
        .lock(lockKey.text('text'))
        .run(async (scope) => {
          expect(() => foreign.readImage!(scope, lockKey.text('text'))).toThrow()
          await scope.set('text', 'uncommitted')
          await binding.writeImage!(scope, lockKey.text('text'), {
            present: true,
            value: '{"codec":"other","version":1,"value":"bad"}'
          })
        })
    ).rejects.toMatchObject({ code: 'JOURNAL_RECORD_INVALID' })
    expect(await store.get('text')).toBe('before')
    await expect(
      store
        .tx()
        .lock(lockKey.record('structured'))
        .run(async (scope) => {
          await binding.readImage!(scope, lockKey.record('structured'))
        })
    ).rejects.toMatchObject({ cause: { code: 'INVALID_OPTION' } })
    expect(await store.getRecord('structured')).toEqual(new Date(0))
    await store
      .tx()
      .lock(lockKey.text('text'))
      .run(async (scope) => {
        expect(await binding.readRevision!(scope, lockKey.text('text'))).toEqual({
          epoch: 0,
          revision: 1
        })
      })
  })
})
