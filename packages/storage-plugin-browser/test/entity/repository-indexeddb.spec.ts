import { entityTestFeatures } from '../helpers/entity-features.ts'
import { indexedDbTestFeatures } from '../helpers/indexed-db-features.ts'
import { IDBFactory, IDBIndex, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { defineEntityPlugin, type IRecordIndexBackfillStore } from '@migaia/storage-host/entity'
import * as entityOwner from '@migaia/storage-host/entity'
import { createIndexedDbTestStore } from '../helpers/installed-backends.ts'
import { StorageError } from '../../src/types/errors.ts'
import { StorageBrowserErrorCode } from '@migaia/storage-contract/error-code'
import type { IStorageKey } from '../../src/types/context.ts'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { defineConcurrencyPolicy, type ITransactionOptions } from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '../../src/indexed-db.ts'
import { deferred } from '@migaia/utils/promise'
import { walkErrorCauses } from '@migaia/utils/error'
import { captureOperationCleanup } from '../helpers/operation-reporter.ts'

type IUser = { id: string; name: string; email: string }

/** Explicit native declaration owns this scenario's optional repository capabilities. */
const usersEntityPlugin = defineEntityPlugin<IUser>()('repository-indexeddb-spec-ts-20', {
  features: entityTestFeatures,
  name: 'users',
  key: 'id'
})

const freshIndexedDb = () =>
  createIndexedDbTestStore(
    {
      factory: new IDBFactory(),
      keyRange: IDBKeyRange,
      dbName: `entity-idb-${Math.random().toString(36).slice(2)}`
    },
    true
  )

/** Low-level native cases capture the exact registered provider, with no second lookup registry. */
const freshIndexedDbBackfill = async () => {
  const register = entityOwner.registerRecordIndexBackfillStore
  let capability: IRecordIndexBackfillStore<unknown> | undefined
  const capture = vi
    .spyOn(entityOwner, 'registerRecordIndexBackfillStore')
    .mockImplementation((store, provider) => {
      register(store, provider)
      capability = provider
    })
  try {
    const { host: storeHost, store } = await freshIndexedDb()
    if (capability === undefined) throw new Error('native backfill provider was not registered')
    return { host: storeHost, store, capability }
  } finally {
    capture.mockRestore()
  }
}

describe('repository over real indexedDbHost backend', () => {
  it('uses the complete sidecar for exact/range/list/stream queries', async () => {
    type IIndexedUser = { id: string; score: number }
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const baselineEntityPlugin = defineEntityPlugin<IIndexedUser>()(
      'repository-indexeddb-spec-ts-52',
      {
        features: entityTestFeatures,
        name: 'native-users',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const baselineEntityPluginHost = await storeHost.use(baselineEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const baseline = baselineEntityPluginHost.extensions[baselineEntityPlugin.id](store)
    await baseline.put({ id: 'u1', score: 2 })
    await baseline.put({ id: 'u2', score: 1 })
    await baseline.migrate()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const repositoryEntityPlugin = defineEntityPlugin<IIndexedUser>()(
      'repository-indexeddb-spec-ts-60',
      {
        features: entityTestFeatures,
        name: 'native-users',
        key: 'id',
        indexes: { score: { path: 'score' } }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const repositoryEntityPluginHost = await storeHost.use(repositoryEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repository = repositoryEntityPluginHost.extensions[repositoryEntityPlugin.id](store)
    await repository.query().index('score', { lower: 1, upper: 2 }).all()
    const fullScan = vi.spyOn(store, 'iterateRecords')

    await expect(repository.findBy('score', 1)).resolves.toEqual({ id: 'u2', score: 1 })
    await expect(
      repository.list({
        index: 'score',
        range: { lower: 1, upper: 2 },
        direction: 'prev',
        limit: 1
      })
    ).resolves.toEqual([{ id: 'u1', score: 2 }])
    const streamed: IIndexedUser[] = []
    for await (const value of repository.query().index('score', { lower: 1, upper: 2 }).stream())
      streamed.push(value)
    expect(streamed).toEqual([
      { id: 'u2', score: 1 },
      { id: 'u1', score: 2 }
    ])
    await repository.put({ id: 'u3', score: 3 })
    await expect(repository.query().index('score', 3).all()).resolves.toEqual([
      { id: 'u3', score: 3 }
    ])
    await repository.remove('u3')
    await expect(repository.query().index('score', 3).all()).resolves.toEqual([])
    expect(fullScan).not.toHaveBeenCalled()
    await store.dispose()
  })

  it('replays an indexed migration only after real rollback and complete pipeline unwind', async () => {
    const factory = new IDBFactory()
    const release = deferred<void>()
    const trace: unknown[] = []
    let holdNext = false
    let tracking = false
    let attempts = 0
    let readCurrent!: () => Promise<unknown>
    const intervention = definePlugin('migration-pipeline', (core) => ({
      install: () => {
        core.useAsyncPipeline(async (input, next) => {
          if (input.operation !== 'indexeddb.transaction') return next(input)
          if (holdNext) {
            holdNext = false
            await release.promise
            return next(input)
          }
          if (!tracking) return next(input)
          trace.push(`enter:${++attempts}`)
          try {
            await next(input)
            trace.push(await readCurrent())
          } catch (error) {
            trace.push(error, await readCurrent())
            throw error
          } finally {
            trace.push('unwind')
          }
        })
        return {}
      }
    }))
    await using host = await createStorageHost({
      plugins: [
        indexedDbBackendPlugin(
          { id: 'holder', factory, keyRange: IDBKeyRange },
          indexedDbTestFeatures
        ),
        indexedDbBackendPlugin(
          { id: 'writer', factory, keyRange: IDBKeyRange },
          indexedDbTestFeatures
        ),
        intervention
      ]
    })
    const holder = host.backend('holder')
    const writer = host.backend('writer')
    const definition = {
      features: entityTestFeatures,
      name: 'migration-replay',
      key: 'id',
      indexes: { value: { path: 'value' } }
    } as const
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const oldEntityPlugin = defineEntityPlugin<{ id: string; value: number }>()(
      'repository-indexeddb-spec-ts-148',
      definition
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const oldEntityPluginHost = await host.use(oldEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const old = oldEntityPluginHost.extensions[oldEntityPlugin.id](writer)
    await old.put({ id: 'row', value: 1 })
    await old.migrate()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const upgradedEntityPlugin = defineEntityPlugin<{ id: string; value: number }>()(
      'repository-indexeddb-spec-ts-151',
      {
        ...definition,
        features: entityTestFeatures,
        version: 2,
        migrations: {
          2: async (value) => ({ ...(value as { id: string; value: number }), value: 2 })
        }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const upgradedEntityPluginHost = await host.use(upgradedEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const upgraded = upgradedEntityPluginHost.extensions[upgradedEntityPlugin.id](writer)
    await upgraded.query().index('value').all()
    const physical = upgraded.lockKey('row')
    readCurrent = () => holder.getRecord(physical.key)
    const put = IDBObjectStore.prototype.put
    let writes = 0
    let holding: Promise<void> | undefined
    const request = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey
    ) {
      const result = Reflect.apply(put, this, [value, key])
      if (
        this.name === 'records' &&
        JSON.stringify(key) === JSON.stringify(physical.key) &&
        (value as { version?: number })?.version === 2
      ) {
        writes += 1
        if (writes === 1) {
          holdNext = true
          holding = holder.transaction(() => undefined, { lock: [physical] })
          void holding.catch(() => undefined)
        }
      }
      return result
    })
    const context: ITransactionOptions = {
      lock: [physical],
      concurrency: defineConcurrencyPolicy({
        name: 'indexed-migration-replay',
        locking: 'optimistic',
        decide: (conflict) => {
          if (conflict.phase === 'commit') {
            trace.push('decide:commit')
            release.resolve()
            return { action: 'retry' }
          }
          return { action: 'wait' }
        }
      })
    }
    const transact = writer.transaction
    writer.transaction = (run, captured) => transact(run, { ...captured, ...context })
    try {
      tracking = true
      await expect(upgraded.migrate({ batchSize: 1 })).resolves.toMatchObject({
        migrated: 1
      })
      await holding
      expect(writes).toBe(2)
      expect(trace).toEqual([
        'enter:1',
        expect.objectContaining({ code: 'WRITE_CONFLICT' }),
        { version: 1, state: { id: 'row', value: 1 } },
        'unwind',
        'decide:commit',
        'enter:2',
        { version: 2, state: { id: 'row', value: 2 } },
        'unwind'
      ])
      await expect(upgraded.query().index('value', 2).all()).resolves.toEqual([
        { id: 'row', value: 2 }
      ])
    } finally {
      tracking = false
      release.resolve()
      writer.transaction = transact
      request.mockRestore()
    }
  })

  it('compiles narrow ranges into the lookup cursor before defensive filtering', async () => {
    type IRangeUser = { id: string; score: number }
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const baselineEntityPlugin = defineEntityPlugin<IRangeUser>()(
      'repository-indexeddb-spec-ts-233',
      {
        features: entityTestFeatures,
        name: 'native-range-users',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const baselineEntityPluginHost = await storeHost.use(baselineEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const baseline = baselineEntityPluginHost.extensions[baselineEntityPlugin.id](store)
    for (const score of [1, 2, 3, 4, 5]) await baseline.put({ id: `u${score}`, score })
    await baseline.migrate()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const repositoryEntityPlugin = defineEntityPlugin<IRangeUser>()(
      'repository-indexeddb-spec-ts-240',
      {
        features: entityTestFeatures,
        name: 'native-range-users',
        key: 'id',
        indexes: { score: { path: 'score' } }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const repositoryEntityPluginHost = await storeHost.use(repositoryEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repository = repositoryEntityPluginHost.extensions[repositoryEntityPlugin.id](store)
    const observedRanges: IDBKeyRange[] = []
    const spy = vi
      .spyOn(IDBIndex.prototype, 'openKeyCursor')
      .mockImplementation(function (this: IDBIndex, range, direction) {
        if (range !== undefined && range !== null && typeof range === 'object' && 'lower' in range)
          observedRanges.push(range as IDBKeyRange)
        spy.mockRestore()
        return this.openKeyCursor(range, direction)
      })

    await expect(repository.query().index('score', { lower: 2, upper: 4 }).all()).resolves.toEqual([
      { id: 'u2', score: 2 },
      { id: 'u3', score: 3 },
      { id: 'u4', score: 4 }
    ])
    expect(observedRanges.length).toBeGreaterThan(0)
    expect(observedRanges[0]!.lower).toEqual(['native-range-users', 'score', expect.any(String), 2])
    expect(observedRanges[0]!.upper).toEqual(['native-range-users', 'score', expect.any(String), 4])
    spy.mockRestore()
    await store.dispose()
  })

  it('keeps compound and deeply nested index keys inside the generation prefix', async () => {
    type INestedRangeUser = { id: string; values: IStorageKey[] }
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const baselineEntityPlugin = defineEntityPlugin<INestedRangeUser>()(
      'repository-indexeddb-spec-ts-271',
      {
        features: entityTestFeatures,
        name: 'native-nested-range-users',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const baselineEntityPluginHost = await storeHost.use(baselineEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const baseline = baselineEntityPluginHost.extensions[baselineEntityPlugin.id](store)
    await baseline.put({ id: 'primitive', values: ['alpha'] })
    await baseline.put({ id: 'empty-string', values: [''] })
    await baseline.put({ id: 'compound-array', values: [['tenant', 'user']] })
    await baseline.put({ id: 'deep-array', values: [[['tenant', ['region', 'user']]]] })
    await baseline.migrate()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const repositoryEntityPlugin = defineEntityPlugin<INestedRangeUser>()(
      'repository-indexeddb-spec-ts-281',
      {
        features: entityTestFeatures,
        name: 'native-nested-range-users',
        key: 'id',
        indexes: {
          value: {
            select: (value) => ({ kind: 'multiple' as const, keys: value.values }),
            revision: 1
          }
        }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const repositoryEntityPluginHost = await storeHost.use(repositoryEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repository = repositoryEntityPluginHost.extensions[repositoryEntityPlugin.id](store)
    const observedRanges: IDBKeyRange[] = []
    const spy = vi
      .spyOn(IDBIndex.prototype, 'openKeyCursor')
      .mockImplementation(function (this: IDBIndex, range, direction) {
        if (range !== undefined && range !== null && typeof range === 'object' && 'lower' in range)
          observedRanges.push(range as IDBKeyRange)
        spy.mockRestore()
        return this.openKeyCursor(range, direction)
      })

    const values = await repository.query().index('value').all()
    expect(values.map((value) => value.id).sort()).toEqual([
      'compound-array',
      'deep-array',
      'empty-string',
      'primitive'
    ])
    expect(observedRanges[0]!.upper).toEqual([
      'native-nested-range-users',
      'value',
      expect.stringContaining('\u0000')
    ])
    expect((observedRanges[0]!.upper as unknown[]).length).toBe(3)
    await store.dispose()
  })

  it('enforces a unique index atomically across two connections', async () => {
    type IUniqueUser = { id: string; email: string }
    const factory = new IDBFactory()
    const dbName = `native-unique-${Math.random().toString(36).slice(2)}`
    const { host: firstStoreHost, store: firstStore } = await createIndexedDbTestStore(
      { factory, keyRange: IDBKeyRange, dbName },
      true
    )
    const { host: secondStoreHost, store: secondStore } = await createIndexedDbTestStore(
      { factory, keyRange: IDBKeyRange, dbName },
      true
    )
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entityEntityPlugin = defineEntityPlugin<IUniqueUser>()(
      'repository-indexeddb-spec-ts-324',
      {
        features: entityTestFeatures,
        name: 'native-unique-users',
        key: 'id',
        indexes: { email: { path: 'email', unique: true } }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const entityEntityPluginHost = await firstStoreHost.use(entityEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const first = entityEntityPluginHost.extensions[entityEntityPlugin.id](firstStore)
    await first.put({ id: 'seed', email: 'seed@example.com' })
    await first.migrate()
    await first
      .query()
      .index('email', { lower: 'seed@example.com', upper: 'seed@example.com' })
      .all()
    /** Install once on the real fixture host and retain exact extension inference. */
    const entityEntityPluginHost2 = await secondStoreHost.use(entityEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const second = entityEntityPluginHost2.extensions[entityEntityPlugin.id](secondStore)
    const outcomes = await Promise.allSettled([
      first.put({ id: 'left', email: 'same@example.com' }),
      second.put({ id: 'right', email: 'same@example.com' })
    ])
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1)
    expect(outcomes.find((outcome) => outcome.status === 'rejected')).toMatchObject({
      reason: { code: 'INDEX_UNIQUE_CONFLICT' }
    })
    await firstStore.dispose()
    await secondStore.dispose()
  })

  it('entity privately backfills normalized path and selector projections', async () => {
    type IIndexedUser = { id: string; profile: { email: string }; tags: string[] }
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const baselineEntityPlugin = defineEntityPlugin<IIndexedUser>()(
      'repository-indexeddb-spec-ts-354',
      {
        features: entityTestFeatures,
        name: 'backfilled-users',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const baselineEntityPluginHost = await storeHost.use(baselineEntityPlugin)
    await baselineEntityPluginHost.extensions[baselineEntityPlugin.id](store).put({
      id: 'u1',
      profile: { email: 'ada@example.com' },
      tags: ['engineer', 'admin']
    })
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entity1EntityPlugin = defineEntityPlugin<{ id: string; label: string }>()(
      'repository-indexeddb-spec-ts-364',
      {
        features: entityTestFeatures,
        name: 'other-backfill',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const entity1EntityPluginHost = await storeHost.use(entity1EntityPlugin)
    await entity1EntityPluginHost.extensions[entity1EntityPlugin.id](store).put({
      id: 'other-1',
      label: 'must not enter users index'
    })
    await baselineEntityPluginHost.extensions[baselineEntityPlugin.id](store).migrate()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const indexedEntityPlugin = defineEntityPlugin<IIndexedUser>()(
      'repository-indexeddb-spec-ts-372',
      {
        features: entityTestFeatures,
        name: 'backfilled-users',
        key: 'id',
        indexes: {
          email: { path: 'profile.email', unique: true },
          tags: {
            select: (value: IIndexedUser) => ({ kind: 'multiple' as const, keys: value.tags }),
            revision: 3
          }
        }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const indexedEntityPluginHost = await storeHost.use(indexedEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repository = indexedEntityPluginHost.extensions[indexedEntityPlugin.id](store)
    await expect(repository.query().index('email').all()).resolves.toEqual([
      { id: 'u1', profile: { email: 'ada@example.com' }, tags: ['engineer', 'admin'] }
    ])
    const capability = store
    const handle = await capability.ensureRecordIndexes('backfilled-users', [
      { name: 'email', unique: true, multiEntry: false, revision: 1 },
      { name: 'tags', unique: false, multiEntry: true, revision: 3 }
    ])
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const readiness = await capability.getRecordIndexReadiness(handle)
      if (readiness.status === 'complete') break
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await expect(capability.getRecordIndexReadiness(handle)).resolves.toMatchObject({
      status: 'complete',
      scanned: 1,
      indexed: 3
    })
    const matches: IIndexedUser[] = []
    for await (const [, raw] of store.iterateRecordIndex({
      handle,
      index: 'tags',
      range: { lower: 'admin', upper: 'admin' }
    }))
      matches.push((raw as { state: IIndexedUser }).state)
    expect(matches).toEqual([
      { id: 'u1', profile: { email: 'ada@example.com' }, tags: ['engineer', 'admin'] }
    ])
    expect(store.capabilities.secondaryIndexes).toBe(true)
  })

  it('measures decoded custom-codec payloads before issuing a batch', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const baselineEntityPlugin = defineEntityPlugin<{ id: string; email: string }>()(
      'repository-indexeddb-spec-ts-418',
      {
        features: entityTestFeatures,
        name: 'decoded-cap-codec',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const baselineEntityPluginHost = await storeHost.use(baselineEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const baseline = baselineEntityPluginHost.extensions[baselineEntityPlugin.id](store)
    await baseline.put({ id: 'u1', email: 'large@example.com' })
    await baseline.put({ id: 'u2', email: 'small@example.com' })
    await baseline.migrate()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const indexedEntityPlugin = defineEntityPlugin<{ id: string; email: string }>()(
      'repository-indexeddb-spec-ts-426',
      {
        features: entityTestFeatures,
        name: 'decoded-cap-codec',
        key: 'id',
        codec: {
          name: 'expanding-decoded-codec',
          output: 'structured',
          encode: async (value) => value,
          decode: async (value) => {
            const envelope = value as { version: number; state: { id: string; email: string } }
            return {
              version: envelope.version,
              state: {
                ...envelope.state,
                expanded: envelope.state.id === 'u1' ? 'x'.repeat(1024 * 1024 + 32) : 'small'
              }
            }
          }
        },
        indexes: { email: { path: 'email' } }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const indexedEntityPluginHost = await storeHost.use(indexedEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const indexed = indexedEntityPluginHost.extensions[indexedEntityPlugin.id](store)

    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(
        indexed
          .query()
          .index('email', { lower: 'large@example.com', upper: 'large@example.com' })
          .all()
      ).rejects.toMatchObject({
        code: 'VALUE_TOO_LARGE',
        cause: expect.any(RangeError)
      })
      expect(report).toHaveBeenCalledWith(
        '[storage-host] operation cleanup failed',
        expect.objectContaining({ code: 'VALUE_TOO_LARGE' })
      )
    } finally {
      report.mockRestore()
    }
    const capability = store
    const handle = await capability.ensureRecordIndexes('decoded-cap-codec', [
      { name: 'email', unique: false, multiEntry: false, revision: 1 }
    ])
    await expect(capability.getRecordIndexReadiness(handle)).resolves.toMatchObject({
      status: 'pending',
      scanned: 0
    })
    await store.dispose()
  })

  it('fails closed for nested undefined in decoded entity budget', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const baselineEntityPlugin = defineEntityPlugin<{ id: string; email: string }>()(
      'repository-indexeddb-spec-ts-479',
      {
        features: entityTestFeatures,
        name: 'nested-undefined-codec',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const baselineEntityPluginHost = await storeHost.use(baselineEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const baseline = baselineEntityPluginHost.extensions[baselineEntityPlugin.id](store)
    await baseline.put({ id: 'u1', email: 'nested@example.com' })
    await baseline.migrate()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const indexedEntityPlugin = defineEntityPlugin<{ id: string; email: string }>()(
      'repository-indexeddb-spec-ts-486',
      {
        features: entityTestFeatures,
        name: 'nested-undefined-codec',
        key: 'id',
        codec: {
          name: 'nested-undefined-codec',
          output: 'structured',
          encode: async (value) => value,
          decode: async (value) => {
            const envelope = value as { version: number; state: { id: string; email: string } }
            return {
              version: envelope.version,
              state: { ...envelope.state, nested: { value: undefined } }
            }
          }
        },
        indexes: { email: { path: 'email' } }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const indexedEntityPluginHost = await storeHost.use(indexedEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const indexed = indexedEntityPluginHost.extensions[indexedEntityPlugin.id](store)

    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(indexed.query().index('email').all()).rejects.toMatchObject({
        code: 'VALUE_TOO_LARGE',
        cause: expect.any(RangeError)
      })
      expect(report).toHaveBeenCalledWith(
        '[storage-host] operation cleanup failed',
        expect.objectContaining({ code: 'VALUE_TOO_LARGE' })
      )
    } finally {
      report.mockRestore()
    }
    await store.dispose()
  })

  it('keeps the canonical record when a legacy shadow has the same id', async () => {
    type IShadowedUser = { id: string; email: string }
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entityEntityPlugin = defineEntityPlugin<IShadowedUser>()(
      'repository-indexeddb-spec-ts-524',
      {
        features: entityTestFeatures,
        name: 'shadow-wins',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const entityEntityPluginHost = await storeHost.use(entityEntityPlugin)
    await entityEntityPluginHost.extensions[entityEntityPlugin.id](store).put({
      id: 'same',
      email: 'canonical@example.com'
    })
    await store.putRecord({ version: 1, state: { id: 'same', email: 'legacy@example.com' } }, [
      'shadow-wins',
      'same'
    ])
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const indexedEntityPlugin = defineEntityPlugin<IShadowedUser>()(
      'repository-indexeddb-spec-ts-534',
      {
        features: entityTestFeatures,
        name: 'shadow-wins',
        key: 'id',
        indexes: { email: { path: 'email' } }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const indexedEntityPluginHost = await storeHost.use(indexedEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const indexed = indexedEntityPluginHost.extensions[indexedEntityPlugin.id](store)

    await expect(
      indexed
        .query()
        .index('email', {
          lower: 'canonical@example.com',
          upper: 'canonical@example.com'
        })
        .all()
    ).resolves.toEqual([{ id: 'same', email: 'canonical@example.com' }])
  })

  it('scans nested legacy IDs across foreign-key adjacency', async () => {
    type INestedUser = { id: IStorageKey; email: string }
    const { host: storeHost, store } = await freshIndexedDb()
    const diagnostics: string[] = []
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entityEntityPlugin = defineEntityPlugin<INestedUser>()(
      'repository-indexeddb-spec-ts-556',
      {
        features: entityTestFeatures,
        name: 'nested-legacy',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const entityEntityPluginHost = await storeHost.use(entityEntityPlugin)
    await entityEntityPluginHost.extensions[entityEntityPlugin.id](store).migrate()
    const nestedId: IStorageKey = ['tenant', ['region', 'user-1']]
    await store.putRecord({ version: 1, state: { id: nestedId, email: 'nested@example.com' } }, [
      'nested-legacy',
      nestedId
    ])
    await store.putRecord({ version: 1, state: { id: 'foreign', email: 'foreign@example.com' } }, [
      'foreign-entity',
      ['tenant', ['region', 'foreign']]
    ])
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const indexedEntityPlugin = defineEntityPlugin<INestedUser>()(
      'repository-indexeddb-spec-ts-571',
      {
        features: entityTestFeatures,
        name: 'nested-legacy',
        key: 'id',
        onDiagnostic: (message) => diagnostics.push(message),
        indexes: { email: { path: 'email' } }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const indexedEntityPluginHost = await storeHost.use(indexedEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const indexed = indexedEntityPluginHost.extensions[indexedEntityPlugin.id](store)
    await expect(indexed.query().index('email').all()).resolves.toEqual([
      { id: nestedId, email: 'nested@example.com' }
    ])
    expect(diagnostics).toEqual([expect.stringContaining('uses authoritative full-scan fallback')])
    const capability = store
    const handle = await capability.ensureRecordIndexes('nested-legacy', [
      { name: 'email', unique: false, multiEntry: false, revision: 1 }
    ])
    await expect(capability.getRecordIndexReadiness(handle)).resolves.toMatchObject({
      status: 'running',
      scanned: 1,
      indexed: 1
    })
    await store.dispose()
  })

  it('rejects aggregate projection rows before any sidecar write', async () => {
    const { host: storeHost, store, capability } = await freshIndexedDbBackfill()
    const scope = 'backfill-projection-cap'
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const repositoryEntityPlugin = defineEntityPlugin<{ id: string }>()(
      'repository-indexeddb-spec-ts-597',
      {
        features: entityTestFeatures,
        name: scope,
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const repositoryEntityPluginHost = await storeHost.use(repositoryEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repository = repositoryEntityPluginHost.extensions[repositoryEntityPlugin.id](store)
    for (let index = 0; index < 8; index += 1)
      await store.putRecord({ value: index }, repository.lockKey(`id-${index}`).key)
    const handle = await capability.ensureRecordIndexes(scope, [
      { name: 'tags', unique: false, multiEntry: true, revision: 1 }
    ])
    /**
     * Bound this native cap case by the actual ordered fixture records, without a private key
     * codec.
     */
    const recordKeys: IStorageKey[] = []
    for await (const [key] of store.iterateRecords()) recordKeys.push(key)
    const session = await capability.openBackfillSession(handle, {
      range: { lower: recordKeys[0]!, upper: recordKeys.at(-1)! },
      allowComplete: true,
      batchSize: 8
    })
    const keys = Array.from({ length: 600 }, (_, index) => `tag-${index}`)
    await expect(
      session.readBatch(undefined, {
        prepare: async () => ({
          decodedBytes: 1,
          outcome: 'indexed' as const,
          projection: { tags: { kind: 'multiple' as const, keys } }
        })
      })
    ).rejects.toMatchObject({
      code: 'VALUE_TOO_LARGE',
      cause: expect.any(RangeError)
    })
    await expect(capability.getRecordIndexReadiness(handle)).resolves.toMatchObject({
      status: 'running',
      scanned: 0,
      indexed: 0
    })
    session.release()
    await store.dispose()
  })

  it('keeps readiness non-complete until legacy winners are migrated', async () => {
    type ILegacyUser = { id: string; email: string }
    const { host: storeHost, store } = await freshIndexedDb()
    await store.putRecord({ version: 1, state: { id: 'legacy', email: 'legacy@example.com' } }, [
      'legacy-backfill',
      'legacy'
    ])
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entityEntityPlugin = defineEntityPlugin<ILegacyUser>()(
      'repository-indexeddb-spec-ts-647',
      {
        features: entityTestFeatures,
        name: 'legacy-backfill',
        key: 'id',
        indexes: { email: { path: 'email', unique: true } }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const entityEntityPluginHost = await storeHost.use(entityEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repository = entityEntityPluginHost.extensions[entityEntityPlugin.id](store)
    await expect(repository.query().index('email').all()).resolves.toEqual([
      { id: 'legacy', email: 'legacy@example.com' }
    ])
    const capability = store
    const handle = await capability.ensureRecordIndexes('legacy-backfill', [
      { name: 'email', unique: true, multiEntry: false, revision: 1 }
    ])
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const readiness = await capability.getRecordIndexReadiness(handle)
      if (readiness.status === 'running') break
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await expect(capability.getRecordIndexReadiness(handle)).resolves.toMatchObject({
      status: 'running',
      // Inspects the legacy phase before readiness can become complete; migration status
      // still keeps this generation non-authoritative until the legacy winner is promoted.
      scanned: 1
    })
    await entityEntityPluginHost.extensions[entityEntityPlugin.id](store).migrate()
    await expect(
      entityEntityPluginHost.extensions[entityEntityPlugin.id](store).query().index('email').all()
    ).resolves.toEqual([{ id: 'legacy', email: 'legacy@example.com' }])
    await expect(capability.getRecordIndexReadiness(handle)).rejects.toMatchObject({
      code: 'INDEX_BACKFILL_STALE'
    })
    const freshHandle = await capability.ensureRecordIndexes('legacy-backfill', [
      { name: 'email', unique: true, multiEntry: false, revision: 1 }
    ])
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const readiness = await capability.getRecordIndexReadiness(freshHandle)
      if (readiness.status === 'complete') break
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    await expect(capability.getRecordIndexReadiness(freshHandle)).resolves.toMatchObject({
      status: 'complete',
      scanned: 1,
      indexed: 1
    })
  })
  it('custom codec 未 settle 时 abort 能结束等待且不写入', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entityEntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-indexeddb-spec-ts-695',
      {
        features: entityTestFeatures,
        name: 'hanging-codec',
        key: 'id',
        codec: {
          name: 'hanging-codec',
          output: 'structured',
          encode: () => new Promise<unknown>(() => {}),
          decode: async (value) => value
        }
      }
    )
    const controller = new AbortController()
    /** Install once on the real fixture host and retain exact extension inference. */
    const entityEntityPluginHost = await storeHost.use(entityEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const pending = entityEntityPluginHost.extensions[entityEntityPlugin.id](store).put(
      { id: 'u1', name: 'Ada' },
      { signal: controller.signal }
    )
    await Promise.resolve()
    controller.abort('cancel hanging codec')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(store.getRecord(['hanging-codec', 'u1'])).resolves.toBeUndefined()
  })

  it('query-owned backfill propagates cancellation through a hanging decoder', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entity2EntityPlugin = defineEntityPlugin<{ id: string; email: string }>()(
      'repository-indexeddb-spec-ts-718',
      {
        features: entityTestFeatures,
        name: 'abort-backfill',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const entity2EntityPluginHost = await storeHost.use(entity2EntityPlugin)
    await entity2EntityPluginHost.extensions[entity2EntityPlugin.id](store).put({
      id: 'u1',
      email: 'ada@example.com'
    })
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entity3EntityPlugin = defineEntityPlugin<{ id: string; email: string }>()(
      'repository-indexeddb-spec-ts-725',
      {
        features: entityTestFeatures,
        name: 'abort-backfill',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const entity3EntityPluginHost = await storeHost.use(entity3EntityPlugin)
    await entity3EntityPluginHost.extensions[entity3EntityPlugin.id](store).migrate()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const indexedEntityPlugin = defineEntityPlugin<{ id: string; email: string }>()(
      'repository-indexeddb-spec-ts-732',
      {
        features: entityTestFeatures,
        name: 'abort-backfill',
        key: 'id',
        codec: {
          name: 'hanging-backfill-codec',
          output: 'structured',
          encode: async (value) => value,
          decode: () => new Promise<never>(() => {})
        },
        indexes: { email: { path: 'email' } }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const indexedEntityPluginHost = await storeHost.use(indexedEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const indexed = indexedEntityPluginHost.extensions[indexedEntityPlugin.id](store)
    const controller = new AbortController()
    const pending = indexed.query().index('email', undefined).all({
      signal: controller.signal
    })
    await Promise.resolve()
    controller.abort('cancel index backfill')
    await expect(pending).rejects.toMatchObject({
      code: 'ABORTED',
      cause: 'cancel index backfill'
    })
  })

  it('active backfill lease keeps concurrent queries on authoritative fallback', async () => {
    const { host: storeHost, store, capability } = await freshIndexedDbBackfill()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const baselineEntityPlugin = defineEntityPlugin<{ id: string; email: string }>()(
      'repository-indexeddb-spec-ts-758',
      {
        features: entityTestFeatures,
        name: 'leased-query-users',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const baselineEntityPluginHost = await storeHost.use(baselineEntityPlugin)
    await baselineEntityPluginHost.extensions[baselineEntityPlugin.id](store).put({
      id: 'u1',
      email: 'ada@example.com'
    })
    await baselineEntityPluginHost.extensions[baselineEntityPlugin.id](store).migrate()
    const handle = await capability.ensureRecordIndexes('leased-query-users', [
      { name: 'email', unique: false, multiEntry: false, revision: 1 }
    ])
    const seedKey =
      baselineEntityPluginHost.extensions[baselineEntityPlugin.id](store).lockKey('u1').key
    const owner = await capability.openBackfillSession(handle, {
      range: { lower: seedKey, upper: seedKey },
      allowComplete: true
    })
    const diagnostics: string[] = []
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const repositoryEntityPlugin = defineEntityPlugin<{ id: string; email: string }>()(
      'repository-indexeddb-spec-ts-774',
      {
        features: entityTestFeatures,
        name: 'leased-query-users',
        key: 'id',
        indexes: { email: { path: 'email' } },
        onDiagnostic: (message) => diagnostics.push(message)
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const repositoryEntityPluginHost = await storeHost.use(repositoryEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repository = repositoryEntityPluginHost.extensions[repositoryEntityPlugin.id](store)

    await expect(repository.query().index('email').all()).resolves.toEqual([
      { id: 'u1', email: 'ada@example.com' }
    ])
    expect(diagnostics).toEqual([expect.stringContaining('uses authoritative full-scan fallback')])
    owner.release()
  })

  it.each([false, true])(
    'preserves selector identity and ordered readiness persistence failure (%s)',
    async (failPersistence) => {
      const { host: storeHost, store } = await freshIndexedDb()
      /** Explicit native declaration owns this scenario's optional repository capabilities. */
      const baselineEntityPlugin = defineEntityPlugin<{ id: string; email: string }>()(
        'repository-indexeddb-spec-ts-793',
        {
          features: entityTestFeatures,
          name: 'failed-selector-backfill',
          key: 'id'
        }
      )
      /** Install once on the real fixture host and retain exact extension inference. */
      const baselineEntityPluginHost = await storeHost.use(baselineEntityPlugin)
      await baselineEntityPluginHost.extensions[baselineEntityPlugin.id](store).put({
        id: 'u1',
        email: 'ada@example.com'
      })
      await baselineEntityPluginHost.extensions[baselineEntityPlugin.id](store).migrate()
      const selectorFailure = new RangeError('selector projection failed')
      /** Explicit native declaration owns this scenario's optional repository capabilities. */
      const indexedEntityPlugin = defineEntityPlugin<{ id: string; email: string }>()(
        'repository-indexeddb-spec-ts-801',
        {
          features: entityTestFeatures,
          name: 'failed-selector-backfill',
          key: 'id',
          indexes: {
            email: {
              select: () => {
                throw selectorFailure
              },
              revision: 1
            }
          }
        }
      )
      /** Install once on the real fixture host and retain exact extension inference. */
      const indexedEntityPluginHost = await storeHost.use(indexedEntityPlugin)
      /** Borrow the supplied backend through the installed repository capability factories. */
      const indexed = indexedEntityPluginHost.extensions[indexedEntityPlugin.id](store)

      const capability = store
      const handle = await capability.ensureRecordIndexes('failed-selector-backfill', [
        { name: 'email', unique: false, multiEntry: true, revision: 1 }
      ])

      const persistenceFailure = new Error('failed readiness persistence failed')
      const put = IDBObjectStore.prototype.put
      const persistence = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
        this: IDBObjectStore,
        value: unknown,
        key?: IDBValidKey
      ) {
        if (
          failPersistence &&
          this.name === 'storage-plugin-browser:meta' &&
          (value as { readiness?: { status?: string } })?.readiness?.status === 'failed'
        )
          throw persistenceFailure
        return Reflect.apply(put, this, [value, key])
      })
      try {
        const cleanup = await captureOperationCleanup(async () => {
          if (failPersistence) {
            const failure: unknown = await indexed
              .query()
              .index('email')
              .all()
              .catch((cause: unknown) => cause)
            expect(failure).toBeInstanceOf(AggregateError)
            expect((failure as AggregateError).cause).toBe(selectorFailure)
            const errors = (failure as AggregateError).errors
            expect(errors[0]).toBe(selectorFailure)
            expect(walkErrorCauses(errors[1])).toContain(persistenceFailure)
          } else await expect(indexed.query().index('email').all()).rejects.toBe(selectorFailure)
          return capability.getRecordIndexReadiness(handle)
        })
        expect(cleanup.result).toMatchObject({ status: failPersistence ? 'running' : 'failed' })
        /** Rejected native put never reaches the post-admission report; both failures still reject. */
        expect(cleanup.reports).toEqual(failPersistence ? [] : [selectorFailure])
        if (failPersistence) return
        const freshHandle = await capability.ensureRecordIndexes('failed-selector-backfill', [
          { name: 'email', unique: false, multiEntry: true, revision: 1 }
        ])
        expect(freshHandle.generation).not.toBe(handle.generation)
        await expect(capability.getRecordIndexReadiness(freshHandle)).resolves.toMatchObject({
          status: 'pending'
        })
      } finally {
        persistence.mockRestore()
      }
    }
  )

  it('custom codec 在 pre-abort 时不会被调用', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    let calls = 0
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entityEntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-indexeddb-spec-ts-871',
      {
        features: entityTestFeatures,
        name: 'pre-abort-codec',
        key: 'id',
        codec: {
          name: 'pre-abort-codec',
          output: 'structured',
          encode: async (value) => {
            calls += 1
            return value
          },
          decode: async (value) => value
        }
      }
    )
    const controller = new AbortController()
    controller.abort('already cancelled')
    /** Install once on the real fixture host and retain exact extension inference. */
    const entityEntityPluginHost = await storeHost.use(entityEntityPlugin)
    await expect(
      entityEntityPluginHost.extensions[entityEntityPlugin.id](store).put(
        { id: 'u1', name: 'Ada' },
        { signal: controller.signal }
      )
    ).rejects.toMatchObject({ code: 'ABORTED' })
    expect(calls).toBe(0)
  })

  it('put/get/remove round trip', async () => {
    const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
      await freshIndexedDb()
    /** Install once on the real fixture host and retain exact extension inference. */
    const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
      usersEntityPluginBackendStore
    )
    await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', name: 'Ada', email: 'a@b.c' })
    await repo.remove('u1')
    await expect(repo.get('u1')).resolves.toBeUndefined()
  })

  it('list/stream 只用 [entityName] range 就能正确限定在本 entity 内', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const postsEntityPlugin = defineEntityPlugin<{ id: string; title: string }>()(
      'repository-indexeddb-spec-ts-903',
      {
        features: entityTestFeatures,
        name: 'posts',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const usersEntityPluginHost = await storeHost.use(usersEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const userRepo = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)
    /** Install once on the real fixture host and retain exact extension inference. */
    const postsEntityPluginHost = await storeHost.use(postsEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const postRepo = postsEntityPluginHost.extensions[postsEntityPlugin.id](store)
    await userRepo.put({ id: 'a', name: 'Ada', email: 'a@b.c' })
    await userRepo.put({ id: 'b', name: 'Bob', email: 'b@c.d' })
    await postRepo.put({ id: 'a', title: 'Hello' })

    const userList = await userRepo.list()
    expect(userList.map((u) => u.id).sort()).toEqual(['a', 'b'])
    const postList = await postRepo.list()
    expect(postList).toEqual([{ id: 'a', title: 'Hello' }])
  })

  it('range 使用共享 comparator 过滤原始 ID，而不是依赖 v2 wire 编码排序', async () => {
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const numericUsersEntityPlugin = defineEntityPlugin<{ id: number; name: string }>()(
      'repository-indexeddb-spec-ts-921',
      {
        features: entityTestFeatures,
        name: 'numeric-users',
        key: 'id'
      }
    )
    const {
      host: numericUsersEntityPluginBackendHost,
      store: numericUsersEntityPluginBackendStore
    } = await freshIndexedDb()
    const numericUsersEntityPluginHost =
      await numericUsersEntityPluginBackendHost.use(numericUsersEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = numericUsersEntityPluginHost.extensions[numericUsersEntityPlugin.id](
      numericUsersEntityPluginBackendStore
    )
    await repo.put({ id: 10, name: 'Ten' })
    await repo.put({ id: 2, name: 'Two' })
    await repo.put({ id: 1, name: 'One' })

    await expect(repo.list({ range: { lower: 2, upper: 10 } })).resolves.toEqual(
      expect.arrayContaining([
        { id: 2, name: 'Two' },
        { id: 10, name: 'Ten' }
      ])
    )
    await expect(repo.list({ range: { lower: 2, upper: 10 } })).resolves.toHaveLength(2)
  })

  it('完整 key domain 的 range 过滤与共享 comparator 保持一致', async () => {
    type IMixedRecord = { id: IStorageKey; label: string }
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const mixedEntityPlugin = defineEntityPlugin<IMixedRecord>()(
      'repository-indexeddb-spec-ts-942',
      {
        features: entityTestFeatures,
        name: 'mixed-key-users',
        key: 'id'
      }
    )
    const { host: mixedEntityPluginBackendHost, store: mixedEntityPluginBackendStore } =
      await freshIndexedDb()
    /** Install once on the real fixture host and retain exact extension inference. */
    const mixedEntityPluginHost = await mixedEntityPluginBackendHost.use(mixedEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = mixedEntityPluginHost.extensions[mixedEntityPlugin.id](
      mixedEntityPluginBackendStore
    )
    const keys: IStorageKey[] = [
      -2,
      new Date('2024-01-01T00:00:00Z'),
      'text',
      new Uint8Array([1, 2]).buffer,
      ['tenant', ['user', 2]]
    ]
    for (const [index, id] of keys.entries()) await repo.put({ id, label: String(index) })

    for (const [index, id] of keys.entries())
      await expect(repo.list({ range: { lower: id, upper: id } })).resolves.toEqual([
        { id, label: String(index) }
      ])
  })

  it('repository 使用保留 v2 物理键空间，并保留 legacy key 等待显式迁移', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Install once on the real fixture host and retain exact extension inference. */
    const usersEntityPluginHost = await storeHost.use(usersEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)
    await repo.put({ id: 'v2', name: 'V2', email: 'v2@example.com' })
    const physicalKeys: unknown[] = []
    for await (const [key] of store.iterateRecords()) physicalKeys.push(key)
    expect(physicalKeys).toContainEqual(['__storage_web_entity_v2__', 'users', expect.any(String)])

    await store.putRecord(
      { version: 1, state: { id: 'legacy', name: 'Legacy', email: 'l@example.com' } },
      ['users', 'legacy']
    )
    await expect(repo.list()).resolves.toEqual(
      expect.arrayContaining([
        { id: 'v2', name: 'V2', email: 'v2@example.com' },
        { id: 'legacy', name: 'Legacy', email: 'l@example.com' }
      ])
    )
    await store.putRecord(
      { version: 1, state: { id: 'legacy-range', name: 'Legacy Range', email: 'lr@example.com' } },
      ['users', 'legacy-range']
    )
    await expect(
      repo.list({ range: { lower: 'legacy-range', upper: 'legacy-range' } })
    ).resolves.toEqual([{ id: 'legacy-range', name: 'Legacy Range', email: 'lr@example.com' }])
    await expect(store.getRecord(['users', 'legacy'])).resolves.toMatchObject({ version: 1 })
  })

  it('batch 对 legacy 使用 v2 优先 fallback，并在写删时清理旧键', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Install once on the real fixture host and retain exact extension inference. */
    const usersEntityPluginHost = await storeHost.use(usersEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)
    await store.putRecord(
      { version: 1, state: { id: 'legacy-batch', name: 'Legacy', email: 'l@example.com' } },
      ['users', 'legacy-batch']
    )
    await repo.batch(async (tx) => {
      await expect(tx.get('legacy-batch')).resolves.toMatchObject({ id: 'legacy-batch' })
      await tx.put({ id: 'legacy-batch', name: 'Current', email: 'c@example.com' })
    })
    await expect(store.getRecord(['users', 'legacy-batch'])).resolves.toBeUndefined()
    await repo.batch(async (tx) => tx.remove('legacy-batch'))
    await expect(repo.get('legacy-batch')).resolves.toBeUndefined()
  })

  it('普通 put/remove 在兼容窗口内同事务清理 legacy 键', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Install once on the real fixture host and retain exact extension inference. */
    const usersEntityPluginHost = await storeHost.use(usersEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)
    await store.putRecord(
      { version: 1, state: { id: 'legacy-ordinary', name: 'Legacy', email: 'l@example.com' } },
      ['users', 'legacy-ordinary']
    )
    await repo.put({ id: 'legacy-ordinary', name: 'Current', email: 'c@example.com' })
    await expect(store.getRecord(['users', 'legacy-ordinary'])).resolves.toBeUndefined()
    await expect(repo.get('legacy-ordinary')).resolves.toEqual({
      id: 'legacy-ordinary',
      name: 'Current',
      email: 'c@example.com'
    })
    await repo.remove('legacy-ordinary')
    await expect(repo.get('legacy-ordinary')).resolves.toBeUndefined()
  })

  it('显式 migrate 遇到 legacy/v2 重复键时保留 v2 winner', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const repoEntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-indexeddb-spec-ts-1027',
      {
        features: entityTestFeatures,
        name: 'duplicate-migrate',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: any) => value }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const repoEntityPluginHost = await storeHost.use(repoEntityPlugin)
    await repoEntityPluginHost.extensions[repoEntityPlugin.id](store).put({
      id: 'same',
      name: 'Current'
    })
    await store.putRecord({ version: 1, state: { id: 'same', name: 'Legacy' } }, [
      'duplicate-migrate',
      'same'
    ])
    await expect(
      repoEntityPluginHost.extensions[repoEntityPlugin.id](store).migrate({ batchSize: 1 })
    ).resolves.toMatchObject({
      migrated: 0,
      alreadyCurrent: 1
    })
    await expect(
      repoEntityPluginHost.extensions[repoEntityPlugin.id](store).get('same')
    ).resolves.toEqual({ id: 'same', name: 'Current' })
    await expect(store.getRecord(['duplicate-migrate', 'same'])).resolves.toBeUndefined()
  })

  it('findBy 在真实 IndexedDB 上按属性扫描过滤', async () => {
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const indexedEntityPlugin = defineEntityPlugin<IUser>()('repository-indexeddb-spec-ts-1048', {
      features: entityTestFeatures,
      name: 'users-idb-indexed',
      key: 'id'
    })
    const { host: indexedEntityPluginBackendHost, store: indexedEntityPluginBackendStore } =
      await freshIndexedDb()
    /** Install once on the real fixture host and retain exact extension inference. */
    const indexedEntityPluginHost = await indexedEntityPluginBackendHost.use(indexedEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = indexedEntityPluginHost.extensions[indexedEntityPlugin.id](
      indexedEntityPluginBackendStore
    )
    await repo.put({ id: 'u1', name: 'Ada', email: 'ada@example.com' })
    await repo.put({ id: 'u2', name: 'Bob', email: 'bob@example.com' })
    await expect((await repo.list()).filter((user) => user.email === 'bob@example.com')).toEqual([
      { id: 'u2', name: 'Bob', email: 'bob@example.com' }
    ])
  })

  it('batch 在真实 IndexedDB 事务上成功提交与失败回滚', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Install once on the real fixture host and retain exact extension inference. */
    const usersEntityPluginHost = await storeHost.use(usersEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)
    await repo.put({ id: 'keep', name: 'Keep', email: 'k@x.y' })

    await repo.batch(async (tx) => {
      await tx.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await expect(tx.query().where({ id: 'u1' }).select('name').all()).resolves.toEqual([
        { name: 'Ada' }
      ])
    })
    await expect(repo.query().where({ id: 'u1' }).select('name').all()).resolves.toEqual([
      { name: 'Ada' }
    ])
    await store.transaction(async (scope) => {
      await expect(
        repo.in(scope).query().where({ id: 'u1' }).select('name').all()
      ).resolves.toEqual([{ name: 'Ada' }])
    })
    await expect(repo.get('u1')).resolves.toBeDefined()

    const original = new Error('boom')
    const failure = await repo
      .batch(async (tx) => {
        await tx.put({ id: 'u2', name: 'Bob', email: 'b@c.d' })
        await tx.remove('keep')
        throw original
      })
      .catch((cause: unknown) => cause)
    expect(failure).toMatchObject({ code: 'TRANSACTION_FAILED' })
    expect(walkErrorCauses(failure)).toContain(original)
    await expect(repo.get('u2')).resolves.toBeUndefined()
    await expect(repo.get('keep')).resolves.toEqual({ id: 'keep', name: 'Keep', email: 'k@x.y' })
  })

  it('版本迁移在读取时执行且不隐式写回', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const v1EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-indexeddb-spec-ts-1098',
      {
        features: entityTestFeatures,
        name: 'migratable',
        key: 'id',
        version: 1
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const v1EntityPluginHost = await storeHost.use(v1EntityPlugin)
    await v1EntityPluginHost.extensions[v1EntityPlugin.id](store).put({ id: 'u1', name: 'Ada' })

    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'repository-indexeddb-spec-ts-1106',
      {
        features: entityTestFeatures,
        name: 'migratable',
        key: 'id',
        version: 2,
        migrations: {
          2: async (prev: any) => ({ id: prev.id, displayName: prev.name })
        }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const v2EntityPluginHost = await storeHost.use(v2EntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = v2EntityPluginHost.extensions[v2EntityPlugin.id](store)
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', displayName: 'Ada' })
    await expect(
      store.getRecord(v1EntityPluginHost.extensions[v1EntityPlugin.id](store).lockKey('u1').key)
    ).resolves.toEqual({
      version: 1,
      state: { id: 'u1', name: 'Ada' }
    })
    // 每次读取都从旧 envelope 执行迁移；持久化升级由调用方显式 put。
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', displayName: 'Ada' })
  })

  it('显式 migrate 将 batch checkpoint 写入 metadata', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const v1EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-indexeddb-spec-ts-1127',
      {
        features: entityTestFeatures,
        name: 'checkpointed',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const v1EntityPluginHost = await storeHost.use(v1EntityPlugin)
    await v1EntityPluginHost.extensions[v1EntityPlugin.id](store).put({ id: 'u1', name: 'Ada' })
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'repository-indexeddb-spec-ts-1133',
      {
        features: entityTestFeatures,
        name: 'checkpointed',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const v2EntityPluginHost = await storeHost.use(v2EntityPlugin)
    await expect(
      v2EntityPluginHost.extensions[v2EntityPlugin.id](store).migrate({ batchSize: 1 })
    ).resolves.toMatchObject({
      migrated: 1
    })
    await expect(store.metadata!.get('repository:checkpointed:migration')).resolves.toMatchObject({
      status: 'complete',
      scanned: 1,
      migrated: 1
    })
  })

  it('migrate 只扫描目标 entity 的 v2 物理前缀，不触碰其他 entity', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const targetEntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-indexeddb-spec-ts-1152',
      {
        features: entityTestFeatures,
        name: 'target-migrate',
        key: 'id'
      }
    )
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const otherEntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-indexeddb-spec-ts-1157',
      {
        features: entityTestFeatures,
        name: 'other-migrate',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const targetEntityPluginHost = await storeHost.use(targetEntityPlugin)
    await targetEntityPluginHost.extensions[targetEntityPlugin.id](store).put({
      id: 'target',
      name: 'Target'
    })
    /** Install once on the real fixture host and retain exact extension inference. */
    const otherEntityPluginHost = await storeHost.use(otherEntityPlugin)
    await otherEntityPluginHost.extensions[otherEntityPlugin.id](store).put({
      id: 'other',
      name: 'Other'
    })
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const migratedEntityPlugin = defineEntityPlugin<{ id: string; label: string }>()(
      'repository-indexeddb-spec-ts-1164',
      {
        features: entityTestFeatures,
        name: 'target-migrate',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: any) => ({ id: value.id, label: value.name }) }
      }
    )

    /** Install once on the real fixture host and retain exact extension inference. */
    const migratedEntityPluginHost = await storeHost.use(migratedEntityPlugin)
    await expect(
      migratedEntityPluginHost.extensions[migratedEntityPlugin.id](store).migrate({ batchSize: 1 })
    ).resolves.toMatchObject({
      scanned: 1,
      eligible: 1,
      migrated: 1
    })
    await expect(
      otherEntityPluginHost.extensions[otherEntityPlugin.id](store).get('other')
    ).resolves.toEqual({
      id: 'other',
      name: 'Other'
    })
  })

  it('重复执行 migrate 幂等，不重复覆盖已迁移记录', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const v1EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-indexeddb-spec-ts-1185',
      {
        features: entityTestFeatures,
        name: 'idempotent-migrate',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const v1EntityPluginHost = await storeHost.use(v1EntityPlugin)
    await v1EntityPluginHost.extensions[v1EntityPlugin.id](store).put({ id: 'u1', name: 'Ada' })
    let migrationCalls = 0
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'repository-indexeddb-spec-ts-1192',
      {
        features: entityTestFeatures,
        name: 'idempotent-migrate',
        key: 'id',
        version: 2,
        migrations: {
          2: async (value: any) => {
            migrationCalls += 1
            return { id: value.id, displayName: value.name }
          }
        }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const v2EntityPluginHost = await storeHost.use(v2EntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = v2EntityPluginHost.extensions[v2EntityPlugin.id](store)
    await expect(repo.migrate({ batchSize: 1 })).resolves.toMatchObject({ migrated: 1 })
    expect(migrationCalls).toBe(1)
    await expect(repo.migrate({ batchSize: 1 })).resolves.toEqual({
      scanned: 1,
      eligible: 0,
      migrated: 0,
      alreadyCurrent: 1,
      skipped: 0,
      conflicted: 0
    })
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', displayName: 'Ada' })
    expect(migrationCalls).toBe(1)
  })

  it('显式 migrate 分批搬迁 legacy 物理键并删除旧键', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'repository-indexeddb-spec-ts-1221',
      {
        features: entityTestFeatures,
        name: 'legacy-batch-migrate',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
      }
    )
    await store.putRecord({ version: 1, state: { id: 'a', name: 'Ada' } }, [
      'legacy-batch-migrate',
      'a'
    ])
    await store.putRecord({ version: 1, state: { id: 'b', name: 'Bob' } }, [
      'legacy-batch-migrate',
      'b'
    ])
    /** Install once on the real fixture host and retain exact extension inference. */
    const v2EntityPluginHost = await storeHost.use(v2EntityPlugin)
    await expect(
      v2EntityPluginHost.extensions[v2EntityPlugin.id](store).migrate({ batchSize: 1 })
    ).resolves.toMatchObject({
      scanned: 2,
      eligible: 2,
      migrated: 2,
      alreadyCurrent: 0
    })
    await expect(store.getRecord(['legacy-batch-migrate', 'a'])).resolves.toBeUndefined()
    await expect(store.getRecord(['legacy-batch-migrate', 'b'])).resolves.toBeUndefined()
    const migratedKeys: unknown[] = []
    for await (const [key] of store.iterateRecords()) migratedKeys.push(key)
    expect(migratedKeys).toEqual(
      expect.arrayContaining([
        ['__storage_web_entity_v2__', 'legacy-batch-migrate', expect.any(String)]
      ])
    )
  })

  it('migrate 从 running checkpoint 的 exclusive physical key 继续', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'repository-indexeddb-spec-ts-1255',
      {
        features: entityTestFeatures,
        name: 'checkpoint-resume',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
      }
    )
    await store.putRecord({ version: 1, state: { id: 'a', name: 'Ada' } }, [
      'checkpoint-resume',
      'a'
    ])
    await store.putRecord({ version: 1, state: { id: 'b', name: 'Bob' } }, [
      'checkpoint-resume',
      'b'
    ])
    const keys: IStorageKey[] = []
    for await (const [key] of store.iterateRecords()) {
      if (Array.isArray(key) && key[0] === 'checkpoint-resume') keys.push(key)
    }
    await store.metadata!.set('repository:checkpoint-resume:migration', {
      status: 'running',
      version: 2,
      schemaFingerprint: 'checkpoint-resume|2|id|passthrough|structured|2',
      lastPhysicalKey: keys[0],
      scanned: 1,
      eligible: 1,
      migrated: 1,
      alreadyCurrent: 0,
      skipped: 0,
      conflicted: 0
    })
    /** Install once on the real fixture host and retain exact extension inference. */
    const v2EntityPluginHost = await storeHost.use(v2EntityPlugin)
    await expect(
      v2EntityPluginHost.extensions[v2EntityPlugin.id](store).migrate({ batchSize: 1 })
    ).resolves.toMatchObject({
      scanned: 2,
      eligible: 2,
      migrated: 2
    })
  })

  it('migrate 非冲突批失败后保留前一批 checkpoint', async () => {
    const { host: sourceHost, store: source } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const v1EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-indexeddb-spec-ts-1295',
      {
        features: entityTestFeatures,
        name: 'failure-resume',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const v1EntityPluginHost = await sourceHost.use(v1EntityPlugin)
    await v1EntityPluginHost.extensions[v1EntityPlugin.id](source).put({ id: 'a', name: 'Ada' })
    await v1EntityPluginHost.extensions[v1EntityPlugin.id](source).put({ id: 'b', name: 'Bob' })
    let calls = 0
    /**
     * Inject only the original transaction endpoint; cloning the store would lose its owner
     * identity.
     */
    const originalTransaction = source.transaction
    source.transaction = (run, ctx) => {
      calls += 1
      if (calls === 2)
        return Promise.reject(
          new StorageError(StorageBrowserErrorCode.transactionFailed, {
            backend: 'indexed-db',
            operation: 'transaction.commit'
          })
        )
      return originalTransaction(run, ctx)
    }
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'repository-indexeddb-spec-ts-1319',
      {
        features: entityTestFeatures,
        name: 'failure-resume',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
      }
    )
    /** Reuse the same entity installation after restoring the original transaction endpoint. */
    const v2EntityPluginHost = await sourceHost.use(v2EntityPlugin)
    try {
      await expect(
        v2EntityPluginHost.extensions[v2EntityPlugin.id](source).migrate({ batchSize: 1 })
      ).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED'
      })
    } finally {
      source.transaction = originalTransaction
    }
    await expect(
      v2EntityPluginHost.extensions[v2EntityPlugin.id](source).migrate({ batchSize: 1 })
    ).resolves.toMatchObject({
      scanned: 2,
      eligible: 2,
      migrated: 2
    })
  })

  it('migrate 遇到 schema fingerprint 不匹配时从头扫描', async () => {
    const { host: storeHost, store } = await freshIndexedDb()
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entityEntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-indexeddb-spec-ts-1342',
      {
        features: entityTestFeatures,
        name: 'checkpoint-mismatch',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: any) => value }
      }
    )
    await store.putRecord({ version: 1, state: { id: 'a', name: 'Ada' } }, [
      'checkpoint-mismatch',
      'a'
    ])
    await store.metadata!.set('repository:checkpoint-mismatch:migration', {
      status: 'running',
      version: 2,
      schemaFingerprint: 'stale',
      lastPhysicalKey: ['checkpoint-mismatch', 'a'],
      scanned: 99,
      eligible: 99,
      migrated: 99,
      alreadyCurrent: 0,
      skipped: 0,
      conflicted: 0
    })
    /** Install once on the real fixture host and retain exact extension inference. */
    const entityEntityPluginHost = await storeHost.use(entityEntityPlugin)
    await expect(
      entityEntityPluginHost.extensions[entityEntityPlugin.id](store).migrate()
    ).resolves.toMatchObject({
      scanned: 1,
      eligible: 1,
      migrated: 1
    })
  })
})
