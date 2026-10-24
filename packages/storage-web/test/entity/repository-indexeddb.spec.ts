import { IDBFactory, IDBIndex, IDBKeyRange, IDBObjectStore } from 'fake-indexeddb'
import { describe, expect, it, vi } from 'vitest'
import { defineEntity, type IRecordIndexBackfillStore } from '@migaia/storage-host/entity'
import * as entityOwner from '@migaia/storage-host/entity'
import { createIndexedDbTestStore } from '../helpers/installed-backends.js'
import { StorageError, StorageErrorCode } from '../../src/types/errors'
import type { IStorageKey } from '../../src/types/context'
import { createStorageHost, definePlugin } from '@migaia/storage-host'
import { defineConcurrencyPolicy, type ITransactionOptions } from '@migaia/storage-contract'
import { indexedDbBackendPlugin } from '../../src/indexed-db.js'
import { deferred } from '@migaia/utils/promise'
import { walkErrorCauses } from '@migaia/utils/error'
import { captureOperationCleanup } from '../helpers/operation-reporter.js'

type IUser = { id: string; name: string; email: string }

const users = defineEntity<IUser>({ name: 'users', key: 'id' })

const freshIndexedDb = () =>
  createIndexedDbTestStore({
    factory: new IDBFactory(),
    keyRange: IDBKeyRange,
    dbName: `entity-idb-${Math.random().toString(36).slice(2)}`
  })

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
    const store = await freshIndexedDb()
    if (capability === undefined) throw new Error('native backfill provider was not registered')
    return { store, capability }
  } finally {
    capture.mockRestore()
  }
}

describe('repository over real indexedDbHost backend', () => {
  it('uses the complete sidecar for exact/range/list/stream queries', async () => {
    type IIndexedUser = { id: string; score: number }
    const store = await freshIndexedDb()
    const baseline = defineEntity<IIndexedUser>({ name: 'native-users', key: 'id' }).connect(store)
    await baseline.put({ id: 'u1', score: 2 })
    await baseline.put({ id: 'u2', score: 1 })
    await baseline.migrate()
    const repository = defineEntity<IIndexedUser>()({
      name: 'native-users',
      key: 'id',
      indexes: { score: { path: 'score' } }
    }).connect(store)
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
        indexedDbBackendPlugin({ id: 'holder', factory, keyRange: IDBKeyRange }),
        indexedDbBackendPlugin({ id: 'writer', factory, keyRange: IDBKeyRange }),
        intervention
      ]
    })
    const holder = host.backend('holder')
    const writer = host.backend('writer')
    const definition = {
      name: 'migration-replay',
      key: 'id',
      indexes: { value: { path: 'value' } }
    } as const
    const old = defineEntity<{ id: string; value: number }>()(definition).connect(writer)
    await old.put({ id: 'row', value: 1 })
    await old.migrate()
    const upgraded = defineEntity<{ id: string; value: number }>()({
      ...definition,
      version: 2,
      migrations: {
        2: async (value) => ({ ...(value as { id: string; value: number }), value: 2 })
      }
    }).connect(writer)
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
    const store = await freshIndexedDb()
    const baseline = defineEntity<IRangeUser>({ name: 'native-range-users', key: 'id' }).connect(
      store
    )
    for (const score of [1, 2, 3, 4, 5]) await baseline.put({ id: `u${score}`, score })
    await baseline.migrate()
    const repository = defineEntity<IRangeUser>()({
      name: 'native-range-users',
      key: 'id',
      indexes: { score: { path: 'score' } }
    }).connect(store)
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
    const store = await freshIndexedDb()
    const baseline = defineEntity<INestedRangeUser>({
      name: 'native-nested-range-users',
      key: 'id'
    }).connect(store)
    await baseline.put({ id: 'primitive', values: ['alpha'] })
    await baseline.put({ id: 'empty-string', values: [''] })
    await baseline.put({ id: 'compound-array', values: [['tenant', 'user']] })
    await baseline.put({ id: 'deep-array', values: [[['tenant', ['region', 'user']]]] })
    await baseline.migrate()
    const repository = defineEntity<INestedRangeUser>()({
      name: 'native-nested-range-users',
      key: 'id',
      indexes: {
        value: {
          select: (value) => ({ kind: 'multiple' as const, keys: value.values }),
          revision: 1
        }
      }
    }).connect(store)
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
    const firstStore = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    const secondStore = await createIndexedDbTestStore({ factory, keyRange: IDBKeyRange, dbName })
    const entity = defineEntity<IUniqueUser>()({
      name: 'native-unique-users',
      key: 'id',
      indexes: { email: { path: 'email', unique: true } }
    })
    const first = entity.connect(firstStore)
    await first.put({ id: 'seed', email: 'seed@example.com' })
    await first.migrate()
    await first
      .query()
      .index('email', { lower: 'seed@example.com', upper: 'seed@example.com' })
      .all()
    const second = entity.connect(secondStore)
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
    const store = await freshIndexedDb()
    const baseline = defineEntity<IIndexedUser>({ name: 'backfilled-users', key: 'id' })
    await baseline.connect(store).put({
      id: 'u1',
      profile: { email: 'ada@example.com' },
      tags: ['engineer', 'admin']
    })
    await defineEntity<{ id: string; label: string }>({ name: 'other-backfill', key: 'id' })
      .connect(store)
      .put({ id: 'other-1', label: 'must not enter users index' })
    await baseline.connect(store).migrate()
    const indexed = defineEntity<IIndexedUser>()({
      name: 'backfilled-users',
      key: 'id',
      indexes: {
        email: { path: 'profile.email', unique: true },
        tags: {
          select: (value: IIndexedUser) => ({ kind: 'multiple' as const, keys: value.tags }),
          revision: 3
        }
      }
    })
    const repository = indexed.connect(store)
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
    const store = await freshIndexedDb()
    const baseline = defineEntity<{ id: string; email: string }>({
      name: 'decoded-cap-codec',
      key: 'id'
    }).connect(store)
    await baseline.put({ id: 'u1', email: 'large@example.com' })
    await baseline.put({ id: 'u2', email: 'small@example.com' })
    await baseline.migrate()
    const indexed = defineEntity<{ id: string; email: string }>()({
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
    }).connect(store)

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
        '[storage-web] operation cleanup failed',
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
    const store = await freshIndexedDb()
    const baseline = defineEntity<{ id: string; email: string }>({
      name: 'nested-undefined-codec',
      key: 'id'
    }).connect(store)
    await baseline.put({ id: 'u1', email: 'nested@example.com' })
    await baseline.migrate()
    const indexed = defineEntity<{ id: string; email: string }>()({
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
    }).connect(store)

    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(indexed.query().index('email').all()).rejects.toMatchObject({
        code: 'VALUE_TOO_LARGE',
        cause: expect.any(RangeError)
      })
      expect(report).toHaveBeenCalledWith(
        '[storage-web] operation cleanup failed',
        expect.objectContaining({ code: 'VALUE_TOO_LARGE' })
      )
    } finally {
      report.mockRestore()
    }
    await store.dispose()
  })

  it('keeps the canonical record when a legacy shadow has the same id', async () => {
    type IShadowedUser = { id: string; email: string }
    const store = await freshIndexedDb()
    const entity = defineEntity<IShadowedUser>({ name: 'shadow-wins', key: 'id' })
    await entity.connect(store).put({ id: 'same', email: 'canonical@example.com' })
    await store.putRecord({ version: 1, state: { id: 'same', email: 'legacy@example.com' } }, [
      'shadow-wins',
      'same'
    ])
    const indexed = defineEntity<IShadowedUser>()({
      name: 'shadow-wins',
      key: 'id',
      indexes: { email: { path: 'email' } }
    }).connect(store)

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
    const store = await freshIndexedDb()
    const diagnostics: string[] = []
    const entity = defineEntity<INestedUser>({ name: 'nested-legacy', key: 'id' })
    await entity.connect(store).migrate()
    const nestedId: IStorageKey = ['tenant', ['region', 'user-1']]
    await store.putRecord({ version: 1, state: { id: nestedId, email: 'nested@example.com' } }, [
      'nested-legacy',
      nestedId
    ])
    await store.putRecord({ version: 1, state: { id: 'foreign', email: 'foreign@example.com' } }, [
      'foreign-entity',
      ['tenant', ['region', 'foreign']]
    ])
    const indexed = defineEntity<INestedUser>()({
      name: 'nested-legacy',
      key: 'id',
      onDiagnostic: (message) => diagnostics.push(message),
      indexes: { email: { path: 'email' } }
    }).connect(store)
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
    const { store, capability } = await freshIndexedDbBackfill()
    const scope = 'backfill-projection-cap'
    const repository = defineEntity<{ id: string }>({ name: scope, key: 'id' }).connect(store)
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
    const store = await freshIndexedDb()
    await store.putRecord({ version: 1, state: { id: 'legacy', email: 'legacy@example.com' } }, [
      'legacy-backfill',
      'legacy'
    ])
    const entity = defineEntity<ILegacyUser>()({
      name: 'legacy-backfill',
      key: 'id',
      indexes: { email: { path: 'email', unique: true } }
    })
    const repository = entity.connect(store)
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
    await entity.connect(store).migrate()
    await expect(entity.connect(store).query().index('email').all()).resolves.toEqual([
      { id: 'legacy', email: 'legacy@example.com' }
    ])
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
    const store = await freshIndexedDb()
    const entity = defineEntity<{ id: string; name: string }>({
      name: 'hanging-codec',
      key: 'id',
      codec: {
        name: 'hanging-codec',
        output: 'structured',
        encode: () => new Promise<unknown>(() => {}),
        decode: async (value) => value
      }
    })
    const controller = new AbortController()
    const pending = entity
      .connect(store)
      .put({ id: 'u1', name: 'Ada' }, { signal: controller.signal })
    await Promise.resolve()
    controller.abort('cancel hanging codec')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
    await expect(store.getRecord(['hanging-codec', 'u1'])).resolves.toBeUndefined()
  })

  it('query-owned backfill propagates cancellation through a hanging decoder', async () => {
    const store = await freshIndexedDb()
    await defineEntity<{ id: string; email: string }>({ name: 'abort-backfill', key: 'id' })
      .connect(store)
      .put({ id: 'u1', email: 'ada@example.com' })
    await defineEntity<{ id: string; email: string }>({ name: 'abort-backfill', key: 'id' })
      .connect(store)
      .migrate()
    const indexed = defineEntity<{ id: string; email: string }>()({
      name: 'abort-backfill',
      key: 'id',
      codec: {
        name: 'hanging-backfill-codec',
        output: 'structured',
        encode: async (value) => value,
        decode: () => new Promise<never>(() => {})
      },
      indexes: { email: { path: 'email' } }
    }).connect(store)
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
    const { store, capability } = await freshIndexedDbBackfill()
    const baseline = defineEntity<{ id: string; email: string }>({
      name: 'leased-query-users',
      key: 'id'
    })
    await baseline.connect(store).put({ id: 'u1', email: 'ada@example.com' })
    await baseline.connect(store).migrate()
    const handle = await capability.ensureRecordIndexes('leased-query-users', [
      { name: 'email', unique: false, multiEntry: false, revision: 1 }
    ])
    const seedKey = baseline.connect(store).lockKey('u1').key
    const owner = await capability.openBackfillSession(handle, {
      range: { lower: seedKey, upper: seedKey },
      allowComplete: true
    })
    const diagnostics: string[] = []
    const repository = defineEntity<{ id: string; email: string }>()({
      name: 'leased-query-users',
      key: 'id',
      indexes: { email: { path: 'email' } },
      onDiagnostic: (message) => diagnostics.push(message)
    }).connect(store)

    await expect(repository.query().index('email').all()).resolves.toEqual([
      { id: 'u1', email: 'ada@example.com' }
    ])
    expect(diagnostics).toEqual([expect.stringContaining('uses authoritative full-scan fallback')])
    owner.release()
  })

  it.each([false, true])(
    'preserves selector identity and ordered readiness persistence failure (%s)',
    async (failPersistence) => {
      const store = await freshIndexedDb()
      const baseline = defineEntity<{ id: string; email: string }>({
        name: 'failed-selector-backfill',
        key: 'id'
      })
      await baseline.connect(store).put({ id: 'u1', email: 'ada@example.com' })
      await baseline.connect(store).migrate()
      const selectorFailure = new RangeError('selector projection failed')
      const indexed = defineEntity<{ id: string; email: string }>()({
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
      }).connect(store)

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
          this.name === 'storage-web:meta' &&
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
    const store = await freshIndexedDb()
    let calls = 0
    const entity = defineEntity<{ id: string; name: string }>({
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
    })
    const controller = new AbortController()
    controller.abort('already cancelled')
    await expect(
      entity.connect(store).put({ id: 'u1', name: 'Ada' }, { signal: controller.signal })
    ).rejects.toMatchObject({ code: 'ABORTED' })
    expect(calls).toBe(0)
  })

  it('put/get/remove round trip', async () => {
    const repo = users.connect(await freshIndexedDb())
    await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', name: 'Ada', email: 'a@b.c' })
    await repo.remove('u1')
    await expect(repo.get('u1')).resolves.toBeUndefined()
  })

  it('list/stream 只用 [entityName] range 就能正确限定在本 entity 内', async () => {
    const store = await freshIndexedDb()
    const posts = defineEntity<{ id: string; title: string }>({ name: 'posts', key: 'id' })
    const userRepo = users.connect(store)
    const postRepo = posts.connect(store)
    await userRepo.put({ id: 'a', name: 'Ada', email: 'a@b.c' })
    await userRepo.put({ id: 'b', name: 'Bob', email: 'b@c.d' })
    await postRepo.put({ id: 'a', title: 'Hello' })

    const userList = await userRepo.list()
    expect(userList.map((u) => u.id).sort()).toEqual(['a', 'b'])
    const postList = await postRepo.list()
    expect(postList).toEqual([{ id: 'a', title: 'Hello' }])
  })

  it('range 使用共享 comparator 过滤原始 ID，而不是依赖 v2 wire 编码排序', async () => {
    const numericUsers = defineEntity<{ id: number; name: string }>({
      name: 'numeric-users',
      key: 'id'
    })
    const repo = numericUsers.connect(await freshIndexedDb())
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
    const mixed = defineEntity<IMixedRecord>({ name: 'mixed-key-users', key: 'id' })
    const repo = mixed.connect(await freshIndexedDb())
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
    const store = await freshIndexedDb()
    const repo = users.connect(store)
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
    const store = await freshIndexedDb()
    const repo = users.connect(store)
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
    const store = await freshIndexedDb()
    const repo = users.connect(store)
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
    const store = await freshIndexedDb()
    const repo = defineEntity<{ id: string; name: string }>({
      name: 'duplicate-migrate',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => value }
    })
    await repo.connect(store).put({ id: 'same', name: 'Current' })
    await store.putRecord({ version: 1, state: { id: 'same', name: 'Legacy' } }, [
      'duplicate-migrate',
      'same'
    ])
    await expect(repo.connect(store).migrate({ batchSize: 1 })).resolves.toMatchObject({
      migrated: 0,
      alreadyCurrent: 1
    })
    await expect(repo.connect(store).get('same')).resolves.toEqual({ id: 'same', name: 'Current' })
    await expect(store.getRecord(['duplicate-migrate', 'same'])).resolves.toBeUndefined()
  })

  it('findBy 在真实 IndexedDB 上按属性扫描过滤', async () => {
    const indexed = defineEntity<IUser>({
      name: 'users-idb-indexed',
      key: 'id'
    })
    const repo = indexed.connect(await freshIndexedDb())
    await repo.put({ id: 'u1', name: 'Ada', email: 'ada@example.com' })
    await repo.put({ id: 'u2', name: 'Bob', email: 'bob@example.com' })
    await expect((await repo.list()).filter((user) => user.email === 'bob@example.com')).toEqual([
      { id: 'u2', name: 'Bob', email: 'bob@example.com' }
    ])
  })

  it('batch 在真实 IndexedDB 事务上成功提交与失败回滚', async () => {
    const store = await freshIndexedDb()
    const repo = users.connect(store)
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
    const store = await freshIndexedDb()
    const v1 = defineEntity<{ id: string; name: string }>({
      name: 'migratable',
      key: 'id',
      version: 1
    })
    await v1.connect(store).put({ id: 'u1', name: 'Ada' })

    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'migratable',
      key: 'id',
      version: 2,
      migrations: {
        2: async (prev: any) => ({ id: prev.id, displayName: prev.name })
      }
    })
    const repo = v2.connect(store)
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', displayName: 'Ada' })
    await expect(store.getRecord(v1.connect(store).lockKey('u1').key)).resolves.toEqual({
      version: 1,
      state: { id: 'u1', name: 'Ada' }
    })
    // 每次读取都从旧 envelope 执行迁移；持久化升级由调用方显式 put。
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', displayName: 'Ada' })
  })

  it('显式 migrate 将 batch checkpoint 写入 metadata', async () => {
    const store = await freshIndexedDb()
    const v1 = defineEntity<{ id: string; name: string }>({ name: 'checkpointed', key: 'id' })
    await v1.connect(store).put({ id: 'u1', name: 'Ada' })
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'checkpointed',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    })
    await expect(v2.connect(store).migrate({ batchSize: 1 })).resolves.toMatchObject({
      migrated: 1
    })
    await expect(store.metadata!.get('repository:checkpointed:migration')).resolves.toMatchObject({
      status: 'complete',
      scanned: 1,
      migrated: 1
    })
  })

  it('migrate 只扫描目标 entity 的 v2 物理前缀，不触碰其他 entity', async () => {
    const store = await freshIndexedDb()
    const target = defineEntity<{ id: string; name: string }>({
      name: 'target-migrate',
      key: 'id'
    })
    const other = defineEntity<{ id: string; name: string }>({ name: 'other-migrate', key: 'id' })
    await target.connect(store).put({ id: 'target', name: 'Target' })
    await other.connect(store).put({ id: 'other', name: 'Other' })
    const migrated = defineEntity<{ id: string; label: string }>({
      name: 'target-migrate',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, label: value.name }) }
    })

    await expect(migrated.connect(store).migrate({ batchSize: 1 })).resolves.toMatchObject({
      scanned: 1,
      eligible: 1,
      migrated: 1
    })
    await expect(other.connect(store).get('other')).resolves.toEqual({
      id: 'other',
      name: 'Other'
    })
  })

  it('重复执行 migrate 幂等，不重复覆盖已迁移记录', async () => {
    const store = await freshIndexedDb()
    const v1 = defineEntity<{ id: string; name: string }>({
      name: 'idempotent-migrate',
      key: 'id'
    })
    await v1.connect(store).put({ id: 'u1', name: 'Ada' })
    let migrationCalls = 0
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'idempotent-migrate',
      key: 'id',
      version: 2,
      migrations: {
        2: async (value: any) => {
          migrationCalls += 1
          return { id: value.id, displayName: value.name }
        }
      }
    })
    const repo = v2.connect(store)
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
    const store = await freshIndexedDb()
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'legacy-batch-migrate',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    })
    await store.putRecord({ version: 1, state: { id: 'a', name: 'Ada' } }, [
      'legacy-batch-migrate',
      'a'
    ])
    await store.putRecord({ version: 1, state: { id: 'b', name: 'Bob' } }, [
      'legacy-batch-migrate',
      'b'
    ])
    await expect(v2.connect(store).migrate({ batchSize: 1 })).resolves.toMatchObject({
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
    const store = await freshIndexedDb()
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'checkpoint-resume',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    })
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
    await expect(v2.connect(store).migrate({ batchSize: 1 })).resolves.toMatchObject({
      scanned: 2,
      eligible: 2,
      migrated: 2
    })
  })

  it('migrate 非冲突批失败后保留前一批 checkpoint', async () => {
    const source = await freshIndexedDb()
    const v1 = defineEntity<{ id: string; name: string }>({ name: 'failure-resume', key: 'id' })
    await v1.connect(source).put({ id: 'a', name: 'Ada' })
    await v1.connect(source).put({ id: 'b', name: 'Bob' })
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
          new StorageError(StorageErrorCode.transactionFailed, {
            backend: 'indexed-db',
            operation: 'transaction.commit'
          })
        )
      return originalTransaction(run, ctx)
    }
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'failure-resume',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    })
    try {
      await expect(v2.connect(source).migrate({ batchSize: 1 })).rejects.toMatchObject({
        code: 'TRANSACTION_FAILED'
      })
    } finally {
      source.transaction = originalTransaction
    }
    await expect(v2.connect(source).migrate({ batchSize: 1 })).resolves.toMatchObject({
      scanned: 2,
      eligible: 2,
      migrated: 2
    })
  })

  it('migrate 遇到 schema fingerprint 不匹配时从头扫描', async () => {
    const store = await freshIndexedDb()
    const entity = defineEntity<{ id: string; name: string }>({
      name: 'checkpoint-mismatch',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => value }
    })
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
    await expect(entity.connect(store).migrate()).resolves.toMatchObject({
      scanned: 1,
      eligible: 1,
      migrated: 1
    })
  })
})
