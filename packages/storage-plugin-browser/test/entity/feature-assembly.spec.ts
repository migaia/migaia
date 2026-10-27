import { describe, expect, it, vi, onTestFinished } from 'vitest'
import { IDBFactory, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import {
  asSecondaryIndexRecordStore,
  records,
  STORAGE_CONTRACT_SOURCE,
  StorageContractErrorCode
} from '@migaia/storage-contract'
import { createStorageHost } from '@migaia/storage-host'
import {
  STORAGE_HOST_ERROR_SOURCE,
  StorageHostErrorCode,
  STORAGE_BROWSER_ERROR_SOURCE,
  StorageBrowserErrorCode as WebErrorCode
} from '@migaia/storage-contract/error-code'
import { defineEntity } from '@migaia/storage-host/entity'
import { entityQueryFeature } from '@migaia/storage-host/entity/features/query'
import { entityUniqueFeature } from '@migaia/storage-host/entity/features/unique'
import { entityMigrationFeature } from '@migaia/storage-host/entity/features/migration'
import { entityIndexesFeature } from '@migaia/storage-host/entity/features/indexes'
import { entityKeysetFeature } from '@migaia/storage-host/entity/features/keyset'
import { walkErrorCauses } from '@migaia/utils/error'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'
import { indexedDbIndexesFeature } from '../../src/features/indexed-db-indexes.js'

/** One domain retains identical records while each case selects only its actual owners. */
type IRow = { id: string; group: string }

/** Every native client uses an isolated actual factory without the all-features helper. */
function options() {
  return { factory: new IDBFactory(), keyRange: IDBKeyRange }
}
/** Missing entity units remain attributable to the original host boundary. */
function missing(name: string) {
  return {
    source: STORAGE_HOST_ERROR_SOURCE,
    code: StorageHostErrorCode.entityFeatureRequired,
    message: expect.stringContaining('@migaia/storage-host/entity/' + name)
  }
}

/** The web backend consumes the same public entity units without implicitly selecting peers. */
describe('explicit entity Features over the web IndexedDB entry', () => {
  it('keeps basic CRUD while query alone grants where/select/all and rejects missing query peers', async () => {
    /** This public host owns and releases the case's original backend. */
    await using host = await createStorageHost({ plugins: [indexedDbBackendPlugin(options())] })
    /** The certified backend view retains its actual native transaction owner. */
    const store = host.backend('indexed-db')
    /** No optional entity owner is selected for the CRUD baseline. */
    const basic = defineEntity<IRow>({ name: 'basic', key: 'id' }).connect(store)
    await basic.put({ id: 'a', group: 'one' })
    expect(await basic.get('a')).toEqual({ id: 'a', group: 'one' })
    expect(() => basic.query()).toThrow(expect.objectContaining(missing('query')))
    expect(() => basic.migrate()).toThrow(expect.objectContaining(missing('migration')))
    /** A second definition reads the same rows through only the selected query unit. */
    const querying = defineEntity<IRow>({
      name: 'basic',
      key: 'id',
      features: [entityQueryFeature()]
    }).connect(store)
    /** Query execution must open the original records cursor after the seeded write. */
    const nativeCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor')
    onTestFinished(() => nativeCursor.mockRestore())
    expect(await querying.query().where('group', 'eq', 'one').select('id').all()).toEqual([
      { id: 'a' }
    ])
    expect(nativeCursor.mock.contexts.map((store) => (store as IDBObjectStore).name)).toContain(
      'records'
    )
    expect(() => querying.query().index('absent' as never)).toThrow(
      expect.objectContaining(missing('indexes'))
    )
    await expect(querying.query().page(1)).rejects.toMatchObject(missing('keyset'))
    await basic.remove('a')
    expect(await querying.get('a')).toBeUndefined()
  })

  it('migrates native records in batches with only migration and does not grant query', async () => {
    /** This public host owns and releases the case's original backend. */
    await using host = await createStorageHost({ plugins: [indexedDbBackendPlugin(options())] })
    /** The certified backend view retains its actual native transaction owner. */
    const store = host.backend('indexed-db')
    /** The old public definition seeds real versioned records before the upgrade. */
    const previous = defineEntity<IRow>({ name: 'versions', key: 'id' }).connect(store)
    await previous.put({ id: 'a', group: 'one' })
    await previous.put({ id: 'b', group: 'two' })
    /** Only the declared units can supply optional behavior for this repository. */
    const repository = defineEntity<IRow>({
      name: 'versions',
      key: 'id',
      version: 2,
      features: [entityMigrationFeature()],
      migrations: { 2: (state) => ({ ...(state as IRow), group: 'migrated' }) }
    }).connect(store)
    /** Migration must read and rewrite actual stored envelopes, not only return counters. */
    const nativeCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor')
    /** Native record writes distinguish the migration from later repository.get calls. */
    const nativePut = vi.spyOn(IDBObjectStore.prototype, 'put')
    onTestFinished(() => {
      nativeCursor.mockRestore()
      nativePut.mockRestore()
    })
    expect(await repository.migrate({ batchSize: 1 })).toMatchObject({ eligible: 2, migrated: 2 })
    expect(nativeCursor.mock.contexts.map((store) => (store as IDBObjectStore).name)).toContain(
      'records'
    )
    expect(nativePut.mock.contexts.map((store) => (store as IDBObjectStore).name)).toContain(
      'records'
    )
    expect(await repository.get('a')).toEqual({ id: 'a', group: 'migrated' })
    expect(await repository.get('b')).toEqual({ id: 'b', group: 'migrated' })
    expect(() => repository.query()).toThrow(expect.objectContaining(missing('query')))
  })

  it('enforces query plus unique without enabling entity or native index planning', async () => {
    /** This public host owns and releases the case's original backend. */
    await using host = await createStorageHost({ plugins: [indexedDbBackendPlugin(options())] })
    /** The certified backend view retains its actual native transaction owner. */
    const store = host.backend('indexed-db')
    /** Only the declared units can supply optional behavior for this repository. */
    const repository = defineEntity<IRow>()({
      name: 'unique',
      key: 'id',
      features: [entityQueryFeature(), entityUniqueFeature()],
      indexes: { group: { path: 'group', unique: true } }
    }).connect(store)
    await repository.put({ id: 'a', group: 'same' })
    /** Retain the original failure chain rather than replacing its package identity. */
    const failure = await repository
      .put({ id: 'b', group: 'same' })
      .catch((error: unknown) => error)
    expect(walkErrorCauses(failure)).toContainEqual(
      expect.objectContaining({
        source: STORAGE_HOST_ERROR_SOURCE,
        code: StorageHostErrorCode.indexUniqueConflict
      })
    )
    expect(await repository.get('b')).toBeUndefined()
    expect(store.capabilities.secondaryIndexes).toBe(false)
    expect(() => repository.query().index('group')).toThrow(
      expect.objectContaining(missing('indexes'))
    )
  })

  it('combines entity indexes with native indexes without borrowing migration or keyset', async () => {
    /** This public host owns and releases the case's original backend. */
    await using host = await createStorageHost({
      plugins: [indexedDbBackendPlugin(options(), { indexes: indexedDbIndexesFeature() })]
    })
    /** The certified backend view retains its actual native transaction owner. */
    const store = host.backend('indexed-db')
    /** Only the declared units can supply optional behavior for this repository. */
    const repository = defineEntity<IRow>()({
      name: 'indexed',
      key: 'id',
      features: [entityQueryFeature(), entityIndexesFeature()],
      indexes: { group: { path: 'group' } }
    }).connect(store)
    await repository.put({ id: 'a', group: 'one' })
    await repository.put({ id: 'b', group: 'two' })
    expect(await repository.query().index('group', 'one').all()).toEqual([
      { id: 'a', group: 'one' }
    ])
    /** The certified secondary-store view invokes this public native index port after preparation. */
    const nativeIndex = vi.spyOn(store, 'iterateRecordIndex')
    expect(await repository.query().index('group', 'two').requirePushdown().all()).toEqual([
      { id: 'b', group: 'two' }
    ])
    expect(nativeIndex.mock.calls.map(([selection]) => selection)).toContainEqual(
      expect.objectContaining({
        index: 'group',
        range: expect.objectContaining({ lower: 'two', upper: 'two' })
      })
    )
    expect(store.capabilities.secondaryIndexes).toBe(true)
    expect(() => repository.migrate()).toThrow(expect.objectContaining(missing('migration')))
    await expect(repository.query().page(1)).rejects.toMatchObject(missing('keyset'))
  })

  it('keeps entity keyset independent from the raw IndexedDB keyset assembly', async () => {
    /** This public host owns and releases the case's original backend. */
    await using host = await createStorageHost({ plugins: [indexedDbBackendPlugin(options())] })
    /** The certified backend view retains its actual native transaction owner. */
    const store = host.backend('indexed-db')
    /** Only the declared units can supply optional behavior for this repository. */
    const repository = defineEntity<IRow>({
      name: 'pages',
      key: 'id',
      features: [entityQueryFeature(), entityKeysetFeature()]
    }).connect(store)
    await repository.put({ id: 'a', group: 'one' })
    await repository.put({ id: 'b', group: 'two' })
    /** Cursor source identity remains shared by branches of this one original query. */
    const query = repository.query()
    /** The first page supplies the canonical continuation token for the second branch. */
    const nativeCursor = vi.spyOn(IDBObjectStore.prototype, 'openCursor')
    onTestFinished(() => nativeCursor.mockRestore())
    const first = await query.page(1)
    expect(nativeCursor.mock.contexts.map((store) => (store as IDBObjectStore).name)).toContain(
      'records'
    )
    nativeCursor.mockClear()
    expect(first.items).toEqual([{ id: 'a', group: 'one' }])
    expect(first.next).toBeDefined()
    expect(await query.after(first.next!).all()).toEqual([{ id: 'b', group: 'two' }])
    expect(nativeCursor.mock.contexts.map((store) => (store as IDBObjectStore).name)).toContain(
      'records'
    )
    await expect(store.use(records).query().page(1)).rejects.toMatchObject({
      source: STORAGE_BROWSER_ERROR_SOURCE,
      code: WebErrorCode.indexedDbFeatureNotInstalled,
      message: expect.stringContaining('indexedDbKeysetFeature')
    })
  })

  it('uses the native cursor for current-format records without a migration Feature or marker', async () => {
    /** The backend receives only its native index unit; entity migration remains unassembled. */
    await using host = await createStorageHost({
      plugins: [indexedDbBackendPlugin(options(), { indexes: indexedDbIndexesFeature() })]
    })
    /** This certified view shares the provider registered on the original native store. */
    const store = host.backend('indexed-db')
    /** Current envelopes can be proved by a full clean backfill without installing migration. */
    const repository = defineEntity<IRow>()({
      name: 'current-only',
      key: 'id',
      features: [entityQueryFeature(), entityIndexesFeature()],
      indexes: { group: { path: 'group' } }
    }).connect(store)
    await repository.put({ id: 'a', group: 'one' })
    await repository.put({ id: 'b', group: 'two' })
    /** The first strict terminal must invoke the selected backend port, without a warm-up scan. */
    const native = vi.spyOn(store, 'iterateRecordIndex')
    expect(await repository.query().index('group', 'one').requirePushdown().all()).toEqual([
      { id: 'a', group: 'one' }
    ])
    expect(native).toHaveBeenCalledOnce()
    expect(native.mock.calls[0]?.[0]).toMatchObject({
      index: 'group',
      range: { lower: 'one', upper: 'one' }
    })
    expect(() => repository.migrate()).toThrow(expect.objectContaining(missing('migration')))
  })

  it('keeps readiness running and strict queries rejected when the clean scan skips an invalid record', async () => {
    /** This isolated native backend receives no migration completion metadata. */
    await using host = await createStorageHost({
      plugins: [indexedDbBackendPlugin(options(), { indexes: indexedDbIndexesFeature() })]
    })
    /** The same public backend supplies raw records and its real secondary-index port. */
    const store = host.backend('indexed-db')
    /** Public diagnostics distinguish the skipped row from the authoritative query fallback. */
    const diagnostics: string[] = []
    /** Only query and indexes are selected, matching the migration-free current-format case. */
    const repository = defineEntity<IRow>()({
      name: 'invalid-current-only',
      key: 'id',
      features: [entityQueryFeature(), entityIndexesFeature()],
      onDiagnostic: (message) => diagnostics.push(message),
      schema: {
        name: 'current-row',
        validate: async (value) => value as IRow,
        /** A current envelope with malformed state fails decoding without needing migration. */
        decode: async (value) => {
          /** The decoder checks the stored representation before returning the domain row. */
          const row = value as IRow
          if (typeof row.group !== 'string') throw new TypeError('invalid row group')
          return row
        }
      },
      indexes: { group: { path: 'group' } }
    }).connect(store)
    await repository.put({ id: 'a', group: 'one' })
    await store.putRecord(
      { version: 1, state: { id: 'invalid', group: 1 } },
      repository.lockKey('invalid').key
    )
    /** Fallback keeps its public invalid-record policy and cannot silently use an incomplete index. */
    const native = vi.spyOn(store, 'iterateRecordIndex')
    expect(await repository.query().index('group', 'one').all()).toEqual([
      { id: 'a', group: 'one' }
    ])
    expect(diagnostics).toContain(
      '[storage-web] entity "invalid-current-only" index "group" uses authoritative full-scan fallback'
    )
    expect(diagnostics).toContain(
      '[storage-web] entity "invalid-current-only" skipped invalid record invalid'
    )
    /** The backend-issued handle used by writes exposes the authoritative readiness receipt. */
    const capability = asSecondaryIndexRecordStore(store)
    /** Captured writes and the query share this existing opaque native index identity. */
    const handle = await capability.ensureRecordIndexes('invalid-current-only', [
      { name: 'group', unique: false, multiEntry: false, revision: 1 }
    ])
    await expect(capability.getRecordIndexReadiness(handle)).resolves.toMatchObject({
      status: 'running'
    })
    await expect(
      repository.query().index('group', 'one').requirePushdown().all()
    ).rejects.toMatchObject({
      source: STORAGE_CONTRACT_SOURCE,
      code: StorageContractErrorCode.queryNotPushable
    })
    await expect(repository.query().index('group').onInvalid('throw').all()).rejects.toMatchObject({
      source: STORAGE_HOST_ERROR_SOURCE,
      code: StorageHostErrorCode.extensionFailed
    })
    expect(native).not.toHaveBeenCalled()
  })

  it('rejects missing definition owners with their exact host source and code before connection', () => {
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
