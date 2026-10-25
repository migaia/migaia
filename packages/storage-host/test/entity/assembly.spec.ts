import { entityMigrationFeature } from '@migaia/storage-host/entity/migration'
import { afterEach, describe, expect, it } from 'vitest'
import { defineEntity } from '@migaia/storage-host/entity'
import { entityUniqueFeature } from '@migaia/storage-host/entity/unique'
import { entityQueryFeature } from '@migaia/storage-host/entity/query'
import { entityIndexesFeature } from '@migaia/storage-host/entity/indexes'
import { entityKeysetFeature } from '@migaia/storage-host/entity/keyset'
import { StorageErrorCode } from '../../src/error-code.js'
import { createStorageHost, memoryBackendPlugin, STORAGE_HOST_SOURCE } from '@migaia/storage-host'
/** These public-entry cases keep one emitted package identity for host, transactions and entities. */
const hosts: Array<{ dispose(): Promise<void> }> = []
afterEach(async () => {
  for (const host of hosts.splice(0).reverse()) await host.dispose()
})
/** Exercise actual package exports without mixing their transaction identity with source fixtures. */
async function memoryBackend() {
  const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
  hosts.push(host)
  return host.backend('memory')
}

/** Business records keep the same fixture across basic and explicitly assembled repositories. */
type IRow = { id: string; group: string }

/** Every missing unit names its exact public migration entry before any backend work. */
function missing(name: string) {
  return {
    source: STORAGE_HOST_SOURCE,
    code: StorageErrorCode.entityFeatureRequired,
    message: expect.stringContaining(`@migaia/storage-host/entity/${name}`)
  }
}

describe('explicit entity assembly', () => {
  it('keeps definition, connection and ordinary reads/writes usable without optional units', async () => {
    const repository = defineEntity<IRow>({ name: 'basic', key: 'id' }).connect(
      await memoryBackend()
    )
    await repository.put({ id: 'a', group: 'one' })
    expect(await repository.get('a')).toEqual({ id: 'a', group: 'one' })
    expect(() => repository.query()).toThrow(expect.objectContaining(missing('query')))
    expect(() => repository.migrate()).toThrow(expect.objectContaining(missing('migration')))
    await repository.remove('a')
    expect(await repository.get('a')).toBeUndefined()
  })

  it('query alone executes the existing where/select/all workload and rejects undeclared keyset/index use', async () => {
    const repository = defineEntity<IRow>({
      name: 'query-only',
      key: 'id',
      features: [entityQueryFeature()]
    }).connect(await memoryBackend())
    await repository.put({ id: 'a', group: 'one' })
    expect(await repository.query().where('group', 'eq', 'one').select('id').all()).toEqual([
      { id: 'a' }
    ])
    expect(() => repository.query().index('missing' as never)).toThrow(
      expect.objectContaining(missing('indexes'))
    )
    await expect(repository.query().page(1)).rejects.toMatchObject(missing('keyset'))
  })

  it('migrates an older record through the public migration unit without enabling queries', async () => {
    const store = await memoryBackend()
    await store.putRecord({ version: 1, state: { id: 'a', group: 'one' } }, ['migration-only', 'a'])
    const repository = defineEntity<IRow>({
      name: 'migration-only',
      key: 'id',
      version: 2,
      features: [entityMigrationFeature()],
      migrations: { 2: (state) => ({ ...(state as IRow), group: 'migrated' }) }
    }).connect(store)
    expect(await repository.get('a')).toEqual({ id: 'a', group: 'migrated' })
    expect(() => repository.query()).toThrow(expect.objectContaining(missing('query')))
  })

  it('persists migration-only memory records across native batches without unique or query units', async () => {
    /** The basic public repository creates the original persisted version-one envelopes. */
    const store = await memoryBackend()
    const original = defineEntity<IRow>({ name: 'persisted-migration-only', key: 'id' }).connect(
      store
    )
    for (const id of ['a', 'b', 'c']) await original.put({ id, group: 'one' })
    /** Only migration is selected; two native batches must not resolve another optional owner. */
    const repository = defineEntity<IRow>({
      name: 'persisted-migration-only',
      key: 'id',
      version: 2,
      features: [entityMigrationFeature()],
      migrations: { 2: (state) => ({ ...(state as IRow), group: 'migrated' }) }
    }).connect(store)
    await expect(repository.migrate({ batchSize: 2 })).resolves.toEqual({
      scanned: 3,
      eligible: 3,
      migrated: 3,
      alreadyCurrent: 0,
      skipped: 0,
      conflicted: 0
    })
    /** Inspect persisted native envelopes so lazy read migration cannot satisfy this assertion. */
    const persisted: unknown[] = []
    for await (const [, envelope] of store.iterateRecords()) persisted.push(envelope)
    expect(persisted).toEqual(
      ['a', 'b', 'c'].map((id) => ({ version: 2, state: { id, group: 'migrated' } }))
    )
    expect(() => repository.query()).toThrow(expect.objectContaining(missing('query')))
  })

  it('still rejects a migration declaration with unique constraints but no unique unit', () => {
    expect(() =>
      defineEntity<IRow>()({
        name: 'migration-missing-unique',
        key: 'id',
        version: 2,
        features: [entityMigrationFeature(), entityIndexesFeature()],
        indexes: { group: { path: 'group', unique: true } },
        migrations: { 2: (state) => state }
      })
    ).toThrow(expect.objectContaining(missing('unique')))
  })

  it('never hides a missing migration assembly behind the invalid-record skip policy', async () => {
    const store = await memoryBackend()
    await store.putRecord({ version: 2, state: { id: 'a', group: 'one' } }, ['query-version', 'a'])
    const repository = defineEntity<IRow>({
      name: 'query-version',
      key: 'id',
      features: [entityQueryFeature()]
    }).connect(store)
    await expect(repository.query().all()).rejects.toMatchObject(missing('migration'))
    await expect(repository.list({ onInvalid: 'skip' })).rejects.toMatchObject(missing('migration'))
  })

  it('admits keyset only through its independent assembly and keeps the original cursor path', async () => {
    const repository = defineEntity<IRow>({
      name: 'keyset',
      key: 'id',
      features: [entityQueryFeature(), entityKeysetFeature()]
    }).connect(await memoryBackend())
    await repository.put({ id: 'a', group: 'one' })
    await repository.put({ id: 'b', group: 'two' })
    const query = repository.query()
    const first = await query.page(1)
    expect(first.items).toEqual([{ id: 'a', group: 'one' }])
    expect(await query.after(first.next!).all()).toEqual([{ id: 'b', group: 'two' }])
  })

  it('enforces unique writes without installing index planning', async () => {
    const repository = defineEntity<IRow>()({
      name: 'unique-only',
      key: 'id',
      features: [entityQueryFeature(), entityUniqueFeature()],
      indexes: { group: { path: 'group', unique: true } }
    }).connect(await memoryBackend())
    await repository.put({ id: 'a', group: 'one' })
    await expect(repository.put({ id: 'b', group: 'one' })).rejects.toMatchObject({
      code: StorageErrorCode.indexUniqueConflict
    })
    expect(() => repository.query().index('group')).toThrow(
      expect.objectContaining(missing('indexes'))
    )
  })

  it('rejects missing declaration assemblies before store connection', () => {
    expect(() =>
      defineEntity<IRow>({
        name: 'versions',
        key: 'id',
        version: 2,
        migrations: { 2: (value) => value }
      })
    ).toThrow(expect.objectContaining(missing('migration')))
    expect(() =>
      defineEntity<IRow>()({ name: 'indexed', key: 'id', indexes: { group: { path: 'group' } } })
    ).toThrow(expect.objectContaining(missing('indexes')))
    expect(() =>
      defineEntity<IRow>()({
        name: 'unique',
        key: 'id',
        features: [entityIndexesFeature()],
        indexes: { group: { path: 'group', unique: true } }
      })
    ).toThrow(expect.objectContaining(missing('unique')))
  })
})
