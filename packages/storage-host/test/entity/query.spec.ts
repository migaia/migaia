import { expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { walkErrorCauses } from '@migaia/utils/error'
import { defineEntity } from '../../src/entity.js'
import {
  createStorageHost,
  memoryBackendPlugin,
  defineFeature,
  memoryBackendKind,
  StorageError,
  StorageErrorCode
} from '../../src/index.js'
import { memoryBackend } from '../helpers/memory.js'

/** One domain definition drives root and authentic transaction queries. */
type IRow = { id: string; group: string; score: number }
const rows = defineEntity<IRow>()({
  name: 'query-rows',
  key: 'id',
  indexes: { group: { path: 'group' } },
  onDiagnostic: () => {}
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
    let closed = false
    void closing.then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    ready.resolve()
    expect(await next).toMatchObject({ done: false, value: 'a' })
    await closing
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
      source: '@migaia/storage-host',
      code: 'EXTENSION_FAILED',
      operation
    })
    expect(walkErrorCauses(failure)).toContain(original)
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
  const repo = defineEntity<IRow>({
    name: 'default-order',
    key: 'id',
    defaultOrderBy: (left, right) => right.score - left.score
  }).connect(await memoryBackend())
  for (const [id, score] of [
    ['a', 1],
    ['b', 2],
    ['c', 99]
  ] as const)
    await repo.put({ id, score, group: 'one' })
  expect(await repo.query().limit(1).all()).toEqual([{ id: 'c', score: 99, group: 'one' }])
  expect(await repo.query().limit(1).select('id').all()).toEqual([{ id: 'c' }])
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
})
