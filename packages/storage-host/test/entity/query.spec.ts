import { STORAGE_CONTRACT_SOURCE, StorageContractErrorCode } from '@migaia/storage-contract'
import { entityQueryFeature } from '../../src/entity/query-feature.js'
import { entityUniqueFeature } from '../../src/entity/unique-feature.js'
import { entityMigrationFeature } from '../../src/entity/migration-feature.js'
import { entityIndexesFeature } from '../../src/entity/indexes-feature.js'
import { entityKeysetFeature } from '../../src/entity/keyset.js'
import { expect, it, vi } from 'vitest'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import { walkErrorCauses } from '@migaia/utils/error'
import { composeRepositoryKey } from '../../src/entity/key.js'
import { defineEntity } from '../../src/entity.js'
import {
  createStorageHost,
  defineFeature,
  StorageError,
  StorageErrorCode
} from '../../src/index.js'
import { memoryBackendPlugin, memoryBackendKind } from '../../src/plugins/memory.js'
import { memoryBackend } from '../helpers/memory.js'

/** One domain definition drives root and authentic transaction queries. */
type IRow = { id: string; group: string; score: number }
const rows = defineEntity<IRow>()({
  features: [
    entityQueryFeature(),
    entityUniqueFeature(),
    entityMigrationFeature(),
    entityIndexesFeature(),
    entityKeysetFeature()
  ],
  name: 'query-rows',
  key: 'id',
  indexes: { group: { path: 'group' } },
  onDiagnostic: () => {}
})

it('writes only the selected page through the original entity transaction', async () => {
  const store = await memoryBackend()
  const repo = rows.connect(store)
  await repo.put({ id: 'a', group: 'one', score: 1 })
  await repo.put({ id: 'b', group: 'one', score: 2 })
  await repo.put({ id: 'c', group: 'two', score: 3 })
  expect(
    await repo
      .query()
      .where({ group: 'one' })
      .orderBy((row) => row.score, 'desc')
      .limit(1)
      .update({ score: 8 })
  ).toBe(1)
  expect(await repo.get('a')).toMatchObject({ score: 1 })
  expect(await repo.get('b')).toMatchObject({ score: 8 })
  expect(await repo.query().index('group', 'two').delete()).toBe(1)
  expect(await repo.get('c')).toBeUndefined()
})

it('keeps entity query deletion and text writes in the same authentic transaction', async () => {
  const store = await memoryBackend()
  const repo = rows.connect(store)
  await repo.put({ id: 'a', group: 'one', score: 1 })
  const primary = new Error('entity delete rollback')
  const failed = await store
    .transaction(async (scope) => {
      expect(await repo.in(scope).query().where({ group: 'one' }).delete()).toBe(1)
      await scope.set('summary', 'removed')
      throw primary
    })
    .catch((error) => error)
  expect(walkErrorCauses(failed)).toContain(primary)
  expect(await repo.get('a')).toMatchObject({ score: 1 })
  expect(await store.get('summary')).toBeNull()
  await store.transaction(async (scope) => {
    expect(await repo.in(scope).query().where({ group: 'one' }).delete()).toBe(1)
    await scope.set('summary', 'removed')
  })
  expect(await repo.get('a')).toBeUndefined()
  expect(await store.get('summary')).toBe('removed')
})

it('rolls back failed query patches and refuses identity changes before any entity write', async () => {
  const store = await memoryBackend()
  const primary = new Error('entity patch validation')
  const definition = defineEntity<IRow>()({
    features: [
      entityQueryFeature(),
      entityUniqueFeature(),
      entityMigrationFeature(),
      entityIndexesFeature(),
      entityKeysetFeature()
    ],
    name: 'query-patch',
    key: 'id',
    schema: {
      name: 'query-patch',
      validate: async (value) => {
        const row = value as IRow
        if (row.id === 'b' && row.score === 99) throw primary
        return row
      }
    }
  })
  const repo = definition.connect(store)
  await repo.put({ id: 'a', group: 'one', score: 1 })
  await repo.put({ id: 'b', group: 'one', score: 2 })
  const failed = await repo
    .query()
    .update({ score: 99 })
    .catch((error) => error)
  expect(walkErrorCauses(failed)).toContain(primary)
  expect(await repo.get('a')).toMatchObject({ score: 1 })
  expect(await repo.get('b')).toMatchObject({ score: 2 })
  await expect(repo.query().where({ id: 'a' }).update({ id: 'b', score: 5 })).rejects.toMatchObject(
    { code: 'INVALID_CONFIG' }
  )
  expect(await repo.get('a')).toMatchObject({ score: 1 })
  expect(await repo.get('b')).toMatchObject({ score: 2 })
  expect(await repo.query().where({ id: 'a' }).update({ id: 'a', score: 5 })).toBe(1)
  expect(await repo.get('a')).toMatchObject({ score: 5 })
})

it('deletes the actual selected physical record when migration changes its logical id', async () => {
  const store = await memoryBackend()
  const definition = defineEntity<IRow>()({
    features: [
      entityQueryFeature(),
      entityUniqueFeature(),
      entityMigrationFeature(),
      entityIndexesFeature(),
      entityKeysetFeature()
    ],
    name: 'query-migrated',
    key: 'id',
    version: 2,
    migrations: { 2: (value) => ({ ...(value as IRow), id: 'z' }) },
    onDiagnostic: () => {}
  })
  const repo = definition.connect(store)
  await store.putRecord(
    { version: 1, state: { id: 'a', group: 'old', score: 1 } },
    composeRepositoryKey('query-migrated', 'a')
  )
  await repo.put({ id: 'z', group: 'current', score: 2 })
  expect(await repo.query().where({ group: 'old' }).delete()).toBe(1)
  expect(await store.getRecord(composeRepositoryKey('query-migrated', 'a'))).toBeUndefined()
  expect(await repo.get('z')).toMatchObject({ group: 'current', score: 2 })
})

it('keeps source branches immutable and shares index filtering, projection and bounded ordering', async () => {
  const repo = rows.connect(await memoryBackend())
  for (const row of [
    { id: 'b', group: 'one', score: 3 },
    { id: 'a', group: 'one', score: 1 },
    { id: 'c', group: 'two', score: 2 }
  ])
    await repo.put(row)
  const root = repo.query()
  const one = root.index('group', 'one')
  expect(await one.where('score', 'gt', 1).select('id').all()).toEqual([{ id: 'b' }])
  expect(
    await root
      .where({ group: 'two' })
      .select(async (row) => row.id)
      .all()
  ).toEqual(['c'])
  expect(await one.select('id').all()).toEqual([{ id: 'a' }, { id: 'b' }])
  expect(
    await root
      .orderByComparator((left, right) => right.score - left.score)
      .limit(2)
      .select('id')
      .all()
  ).toEqual([{ id: 'b' }, { id: 'c' }])
  expect(await root.range({ lower: 'b' }).select('id').all()).toEqual([{ id: 'b' }, { id: 'c' }])
  expect(repo).not.toHaveProperty('findManyBy')
  expect(repo).not.toHaveProperty('streamBy')
})

it('retains the complete unawaited transaction query and mapper under the original resource owner', async () => {
  const store = await memoryBackend()
  const repo = rows.connect(store)
  await repo.put({ id: 'a', group: 'one', score: 1 })
  const entered = deferred<void>()
  const release = deferred<void>()
  let accepted!: Promise<string[]>
  let saved!: ReturnType<ReturnType<typeof repo.in>['query']>
  const pending = store.transaction((scope) => {
    const bound = repo.in(scope)
    saved = bound.query()
    accepted = saved
      .index('group', 'one')
      .select(async (row) => {
        entered.resolve()
        await release.promise
        return row.id
      })
      .all()
  })
  await entered.promise
  let done = false
  void pending.then(() => {
    done = true
  })
  await Promise.resolve()
  expect(done).toBe(false)
  release.resolve()
  await expect(accepted).resolves.toEqual(['a'])
  await pending
  await expect(saved.all()).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
})

it('forwards selected scalar and callback terminals through the same entity source', async () => {
  const repo = rows.connect(await memoryBackend())
  await repo.put({ id: 'a', group: 'one', score: 2 })
  await repo.put({ id: 'b', group: 'one', score: 4 })
  await repo.put({ id: 'c', group: 'two', score: 99 })
  const query = repo.query().index('group', 'one').select('id', 'score')
  expect(await query.first()).toEqual({ id: 'a', score: 2 })
  expect(await query.maybe()).toEqual({ some: true, value: { id: 'a', score: 2 } })
  expect(await query.firstOrThrow()).toEqual({ id: 'a', score: 2 })
  expect(await query.pluck('id')).toEqual(['a', 'b'])
  expect(await query.exists()).toBe(true)
  expect(await query.count()).toBe(2)
  const seen: unknown[] = []
  expect(
    await query.each((row, index) => {
      seen.push([row.id, index])
    })
  ).toBe(2)
  expect(seen).toEqual([
    ['a', 0],
    ['b', 1]
  ])
  const chunks: unknown[] = []
  expect(
    await query.chunk(1, (batch) => {
      chunks.push(batch.map((row) => row.id))
    })
  ).toBe(2)
  expect(chunks).toEqual([['a'], ['b']])
  expect(await query.min('score')).toEqual({ some: true, value: 2 })
  expect(await query.max('score')).toEqual({ some: true, value: 4 })
  expect(await query.sum('score')).toBe(6)
  expect(await query.avg('score')).toEqual({ some: true, value: 3 })
  expect(await repo.query().index('group', 'missing').maybe()).toEqual({ some: false })
  await expect(repo.query().index('group', 'missing').firstOrThrow()).rejects.toMatchObject({
    code: 'QUERY_EMPTY_RESULT'
  })
  expect(
    await repo
      .query()
      .orderByComparator((left, right) => right.score - left.score)
      .first()
  ).toMatchObject({ id: 'c' })
})

it('drains unawaited each callbacks and admits invalid terminals under the original transaction owner', async () => {
  const store = await memoryBackend()
  const repo = rows.connect(store)
  await repo.put({ id: 'a', group: 'one', score: 1 })
  const entered = deferred<void>()
  const release = deferred<void>()
  let accepted!: Promise<number>
  let saved!: ReturnType<ReturnType<typeof repo.in>['query']>
  const pending = store.transaction((scope) => {
    saved = repo.in(scope).query()
    accepted = saved.each(async () => {
      entered.resolve()
      await release.promise
    })
  })
  await entered.promise
  let done = false
  void pending.then(() => {
    done = true
  })
  await Promise.resolve()
  expect(done).toBe(false)
  release.resolve()
  await expect(accepted).resolves.toBe(1)
  await pending
  await expect(saved.chunk(0, () => {})).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  const failed = await store
    .transaction(async (scope) => {
      const bound = repo.in(scope)
      await expect(bound.query().chunk(0, () => {})).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      })
      await bound.put({ id: 'b', group: 'one', score: 2 }).catch(() => undefined)
    })
    .catch((cause) => cause)
  expect(
    walkErrorCauses(failed).some(
      (cause) => (cause as { code?: string }).code === 'INVALID_ARGUMENT'
    )
  ).toBe(true)
  expect(await repo.get('b')).toBeUndefined()
})

it('keeps a mapped stream advance active until disposal can drain it', async () => {
  const store = await memoryBackend()
  const repo = rows.connect(store)
  await repo.put({ id: 'a', group: 'one', score: 1 })
  await store.transaction(async (scope) => {
    const entered = deferred<void>()
    const ready = deferred<void>()
    const iterator = repo
      .in(scope)
      .query()
      .select(async (row) => {
        entered.resolve()
        await ready.promise
        return row.id
      })
      .stream()
    const next = iterator.next()
    await entered.promise
    const closing = iterator.dispose()
    expect(iterator.dispose()).toBe(closing)
    const symbolic = iterator[asyncDisposeKey]()
    expect(iterator[asyncDisposeKey]()).toBe(symbolic)
    expect(symbolic).not.toBe(closing)
    let closed = false
    void closing.then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    ready.resolve()
    expect(await next).toMatchObject({ done: false, value: 'a' })
    await closing
    await symbolic
    expect(await iterator.next()).toMatchObject({ done: true })
  })
})

it('wraps original query callback failures even when they already carry a code', async () => {
  const repo = rows.connect(await memoryBackend())
  await repo.put({ id: 'a', group: 'one', score: 1 })
  const original = new StorageError(StorageErrorCode.invalidConfig)
  for (const [operation, query] of [
    [
      'query.where',
      repo.query().where(() => {
        throw original
      })
    ],
    [
      'query.select',
      repo.query().select(async () => {
        throw original
      })
    ],
    [
      'query.orderByComparator',
      repo
        .query()
        .orderByComparator(() => {
          throw original
        })
        .limit(1)
    ]
  ] as const) {
    if (operation.endsWith('Comparator')) await repo.put({ id: 'b', group: 'one', score: 2 })
    const failure = await query.all().catch((cause) => cause)
    expect(failure).toMatchObject({
      source: 'storage.host',
      code: 'EXTENSION_FAILED',
      operation
    })
    expect(walkErrorCauses(failure)).toContain(original)
    if (operation === 'query.select') {
      /** The root mapped stream retains the same extension cause through canonical cleanup. */
      const iterator = query.stream()
      const streamFailure = await iterator.next().catch((cause: unknown) => cause)
      expect(streamFailure).toMatchObject({ code: 'EXTENSION_FAILED', operation })
      expect(walkErrorCauses(streamFailure)).toContain(original)
      const closing = iterator.dispose()
      expect(iterator.dispose()).toBe(closing)
      const symbolic = iterator[asyncDisposeKey]()
      expect(iterator[asyncDisposeKey]()).toBe(symbolic)
      expect(symbolic).not.toBe(closing)
      await Promise.all([closing, symbolic])
    }
  }
})

it('inherits installed query methods through the same original storage cell', async () => {
  const mark = vi.fn(function (this: object) {
    return this
  })
  const feature = defineFeature(memoryBackendKind, () => ({
    capabilities: [],
    api: { store: {}, transaction: {} },
    chain: { query: { mark } }
  }))
  await using host = await createStorageHost({
    plugins: [memoryBackendPlugin(undefined, { marker: feature })]
  })
  const repo = rows.connect(host.backend('memory'))
  const branch = repo.query().where({ group: 'one' }).select('id')
  expect(branch.mark()).toBe(branch)
  expect(mark).toHaveBeenCalledTimes(1)
  expect(await branch.all()).toEqual([])
})

it('applies the default bounded comparator before limit and projection', async () => {
  const compare = vi.fn((left: IRow, right: IRow) => right.score - left.score)
  const repo = defineEntity<IRow>({
    features: [
      entityQueryFeature(),
      entityUniqueFeature(),
      entityMigrationFeature(),
      entityIndexesFeature(),
      entityKeysetFeature()
    ],
    name: 'default-order',
    key: 'id',
    defaultOrderBy: compare
  }).connect(await memoryBackend())
  for (const [id, score] of [
    ['a', 1],
    ['b', 2],
    ['c', 99]
  ] as const)
    await repo.put({ id, score, group: 'one' })
  expect(await repo.query().limit(1).all()).toEqual([{ id: 'c', score: 99, group: 'one' }])
  expect(await repo.query().limit(1).select('id').all()).toEqual([{ id: 'c' }])
  expect(await repo.query().limit(2).first()).toEqual({ id: 'c', score: 99, group: 'one' })
  expect(await repo.query().first()).toEqual({ id: 'c', score: 99, group: 'one' })
  compare.mockClear()
  expect(await repo.query().count()).toBe(3)
  expect(await repo.query().limit(1).count()).toBe(1)
  const mapper = vi.fn((row: IRow) => row.id)
  expect(await repo.query().select(mapper).count()).toBe(3)
  expect(await repo.query().limit(2).select(mapper).count()).toBe(2)
  expect(await repo.query().orderByComparator(compare).limit(1).select(mapper).count()).toBe(1)
  expect(compare).not.toHaveBeenCalled()
  expect(mapper).not.toHaveBeenCalled()
  expect(() => repo.query().select(mapper).all()).toThrowError(
    expect.objectContaining({ code: 'INVALID_CONFIG' })
  )
  expect(await repo.query().select('id').first()).toEqual({ id: 'c' })
  await expect(repo.query().limit(1).select('id').requirePushdown().count()).rejects.toMatchObject({
    code: 'QUERY_NOT_PUSHABLE'
  })
  expect(() => repo.query().select(4 as never)).toThrowError(
    expect.objectContaining({ code: 'INVALID_ARGUMENT' })
  )
})

it('observes a rejected comparator thenable before rejecting its synchronous contract', async () => {
  const repo = rows.connect(await memoryBackend())
  await repo.put({ id: 'a', group: 'one', score: 1 })
  await repo.put({ id: 'b', group: 'one', score: 2 })
  const original = new Error('late comparator rejection')
  const report = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  try {
    const invalid = (() => Promise.reject(original)) as unknown as (
      left: IRow,
      right: IRow
    ) => number
    const failure = await repo
      .query()
      .orderByComparator(invalid)
      .limit(1)
      .all()
      .catch((cause) => cause)
    expect(failure).toMatchObject({ code: 'EXTENSION_FAILED', cause: expect.any(TypeError) })
    await Promise.resolve()
    expect(report).toHaveBeenCalledWith(expect.any(String), original)
  } finally {
    report.mockRestore()
  }
})

it('applies one invalid-record policy to index projection failures in root and transaction sources', async () => {
  const store = await memoryBackend()
  const original = new Error('invalid projected row')
  let rejectProjection = false
  const entity = defineEntity<IRow>()({
    features: [
      entityQueryFeature(),
      entityUniqueFeature(),
      entityMigrationFeature(),
      entityIndexesFeature(),
      entityKeysetFeature()
    ],
    name: 'invalid-projection',
    key: 'id',
    onDiagnostic: () => {},
    indexes: {
      selected: {
        revision: 1,
        select(value) {
          if (rejectProjection && value.score < 0) throw original
          return { kind: 'single', key: value.group }
        }
      }
    }
  })
  const repo = entity.connect(store)
  await repo.put({ id: 'bad', group: 'one', score: -1 })
  await repo.put({ id: 'good', group: 'one', score: 1 })
  rejectProjection = true
  expect(await repo.query().index('selected', 'one').all()).toEqual([
    { id: 'good', group: 'one', score: 1 }
  ])
  await store.transaction(async (scope) => {
    expect(await repo.in(scope).query().index('selected', 'one').all()).toEqual([
      { id: 'good', group: 'one', score: 1 }
    ])
  })
  const failed = await store
    .transaction((scope) =>
      repo.in(scope).query().index('selected', 'one').onInvalid('throw').all()
    )
    .catch((cause) => cause)
  expect(walkErrorCauses(failed)).toContain(original)
  const terminalFailure = await store
    .transaction((scope) =>
      repo.in(scope).query().index('selected', 'one').onInvalid('throw').select('id').first()
    )
    .catch((cause) => cause)
  expect(walkErrorCauses(terminalFailure)).toContain(original)
})

it('rejects an explicit index full scan under strict intent before opening the fallback source', async () => {
  /** Memory records support authoritative entity scans, without a native secondary index. */
  const store = await memoryBackend()
  /** The same public definition keeps ordinary indexed filtering available. */
  const repository = rows.connect(store)
  await repository.put({ id: 'a', group: 'one', score: 1 })
  /** This public source observes whether strict admission leaks into physical scan work. */
  const scan = vi.spyOn(store, 'iterateRecords')
  await expect(
    repository.query().index('group', 'one').requirePushdown().all()
  ).rejects.toMatchObject({
    source: STORAGE_CONTRACT_SOURCE,
    code: StorageContractErrorCode.queryNotPushable
  })
  expect(scan).not.toHaveBeenCalled()
  expect(await repository.query().index('group', 'one').all()).toEqual([
    { id: 'a', group: 'one', score: 1 }
  ])
})
