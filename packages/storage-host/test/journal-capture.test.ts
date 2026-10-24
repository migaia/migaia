import { describe, expect, it } from 'vitest'
import { counter, ttl, rdf, records } from '@migaia/storage-contract'
import { lockKey } from '../src/authoring/concurrency.js'
import { term } from '../src/authoring/rdf.js'
import {
  createStorageHost,
  createOrgId,
  memoryBackendPlugin,
  type IStorageJournalChange
} from '../src/index.js'
import { resolveStorageJournalBinding } from '../src/journal/binding.js'

describe('original memory ordered journal capture', () => {
  it('captures native order, TTL and query deletion members without counting net-absent rows', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const binding = resolveStorageJournalBinding(host, 'memory').binding
    await store.putRecord({ old: true }, 'retained')
    let captured: readonly IStorageJournalChange[] = []
    await store
      .tx()
      .lock(lockKey.text('counter'), lockKey.bytes('bytes'), lockKey.record('retained'))
      .run(async (scope) => {
        expect(binding.changes!(scope)).toEqual([])
        await scope.set('counter', '1')
        await scope.use(counter).increment('counter', 1)
        await scope.use(ttl).expire({ channel: 'text', key: 'counter' }, 60_000)
        await scope.setBytes('bytes', new Uint8Array([1, 2]))
        await scope.putRecord({ old: false }, 'retained')
        await scope.putRecord({ temporary: true }, 'temporary')
        await scope.use(records).query().delete()
        captured = binding.changes!(scope)
        expect(captured.map((change) => change.target.channel)).toEqual([
          'text',
          'text',
          'metadata',
          'bytes',
          'record',
          'record'
        ])
        expect(captured[0]!.before).toEqual({ present: false })
        expect(captured[0]!.after.present && JSON.parse(captured[0]!.after.value).value).toBe('1')
        expect(captured[1]!.after.present && JSON.parse(captured[1]!.after.value).value).toBe('2')
        expect(captured[2]!.before).toEqual({ present: false })
        expect(captured[2]!.after.present).toBe(true)
        expect(captured.slice(0, 4).map((change) => change.afterRevision)).toEqual([
          { epoch: 0, revision: 1 },
          { epoch: 0, revision: 1 },
          { epoch: 0, revision: 1 },
          { epoch: 0, revision: 1 }
        ])
        expect(captured[5]!.after).toEqual({ present: false })
      })
    expect(await store.get('counter')).toBe('2')
    expect(await store.getRecord('retained')).toBeUndefined()
    await store
      .tx()
      .lock(lockKey.text('counter'))
      .run(async (scope) => {
        expect(await binding.readRevision!(scope, lockKey.text('counter'))).toEqual(
          captured[0]!.afterRevision
        )
      })
  })

  it('captures logical RDF mutations and keeps non-portable writes unchanged unless capture is selected', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const binding = resolveStorageJournalBinding(host, 'memory').binding
    const quad = {
      subject: term.iri('urn:subject'),
      predicate: term.iri('urn:predicate'),
      object: term.literal('value'),
      graph: term.defaultGraph
    }
    await store.use(rdf).add([quad])
    await store
      .tx()
      .lock(lockKey.rdf(quad))
      .run(async (scope) => {
        binding.changes!(scope)
        await scope.use(rdf).match({}).delete()
        const changes = binding.changes!(scope)
        expect(changes).toHaveLength(1)
        expect(changes[0]!.target).toEqual(lockKey.rdf(quad))
        expect(changes[0]!.before.present).toBe(true)
        expect(changes[0]!.after).toEqual({ present: false })
      })
    await store
      .tx()
      .lock(lockKey.record('structured'))
      .run((scope) => scope.putRecord(new Date(0), 'structured'))
    expect(await store.getRecord('structured')).toEqual(new Date(0))
    await expect(
      store
        .tx()
        .lock(lockKey.record('structured'))
        .run(async (scope) => {
          binding.changes!(scope)
          await scope.putRecord(new Date(1), 'structured')
        })
    ).rejects.toMatchObject({ cause: { code: 'INVALID_OPTION' } })
    expect(await store.getRecord('structured')).toEqual(new Date(0))
    await expect(
      store
        .tx()
        .lock(lockKey.text('late'))
        .run(async (scope) => {
          await scope.set('late', 'not committed')
          binding.changes!(scope)
        })
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_CAPABILITY' })
    expect(await store.get('late')).toBeNull()
  })

  it('stores authentic commit evidence in the same private native draft and isolates user prefixes and orgs', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const binding = resolveStorageJournalBinding(host, 'memory').binding
    const foreign = resolveStorageJournalBinding(host.org(createOrgId()), 'memory').binding
    await using namespace = await binding.openNamespace('storage.commit.markers')
    let committed = ''
    await store
      .tx()
      .lock(lockKey.text('data'))
      .run(async (scope) => {
        committed = namespace.transactionInfo(scope).id
        binding.changes!(scope)
        await scope.set('data', 'committed')
        await binding.writeCommitMarker!(scope, committed)
        expect(await binding.hasCommitMarker!(committed)).toBe(false)
        expect(binding.changes!(scope)).toHaveLength(1)
      })
    expect(await binding.hasCommitMarker!(committed)).toBe(true)
    expect(await foreign.hasCommitMarker!(committed)).toBe(false)
    await namespace.run(async (view) => {
      expect(await view.get(committed)).toBeNull()
      await view.set(committed, 'a user log prefix cannot alter real marker evidence')
    })
    expect(await binding.hasCommitMarker!(committed)).toBe(true)
    let rolledBack = ''
    await expect(
      store
        .tx()
        .lock(lockKey.text('data'))
        .run(async (scope) => {
          rolledBack = namespace.transactionInfo(scope).id
          await binding.writeCommitMarker!(scope, rolledBack)
          await binding.writeCommitMarker!(scope, 'forged-id')
        })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(await binding.hasCommitMarker!(rolledBack)).toBe(false)
    await store.clearAll()
    expect(await binding.hasCommitMarker!(committed)).toBe(true)
    await binding.removeCommitMarker!(committed)
    expect(await binding.hasCommitMarker!(committed)).toBe(false)
  })
})
