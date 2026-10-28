import { entityQueryFeature } from '../../src/entity/query-feature.ts'
import { entityUniqueFeature } from '../../src/entity/unique-feature.ts'
import { entityMigrationFeature } from '../../src/entity/migration-feature.ts'
import { entityIndexesFeature } from '../../src/entity/indexes-feature.ts'
import { entityKeysetFeature } from '../../src/entity/keyset.ts'
import { expect, it } from 'vitest'
import { defineEntity } from '../../src/entity.ts'
import { memoryBackend } from '../helpers/memory.ts'

/** Source and ordering transitions retain the entity adapter around the original shared core. */
type IRow = { id: string; group: string; score: number }

it('retains default ordering and its finite bound after skip and projection', async () => {
  const definition = defineEntity<IRow>()({
    features: [
      entityQueryFeature(),
      entityUniqueFeature(),
      entityMigrationFeature(),
      entityIndexesFeature(),
      entityKeysetFeature()
    ],
    name: 'query-state',
    key: 'id',
    defaultOrderBy: (left, right) => right.score - left.score
  })
  const repo = definition.connect(await memoryBackend())
  await repo.put({ id: 'a', group: 'one', score: 1 })
  await repo.put({ id: 'b', group: 'one', score: 2 })
  expect(() => repo.query().skip(0).all()).toThrowError(
    expect.objectContaining({ code: 'INVALID_CONFIG' })
  )
  expect(await repo.query().skip(1).limit(1).select('id').all()).toEqual([{ id: 'a' }])
  expect(await repo.query().skip(1).limit(1).count()).toBe(1)
  expect(await repo.query().skip(1).first()).toMatchObject({ id: 'a' })
})

it('preserves entity controls after selector and distinct branches', async () => {
  const definition = defineEntity<IRow>()({
    features: [
      entityQueryFeature(),
      entityUniqueFeature(),
      entityMigrationFeature(),
      entityIndexesFeature(),
      entityKeysetFeature()
    ],
    name: 'query-branches',
    key: 'id'
  })
  const repo = definition.connect(await memoryBackend())
  await repo.put({ id: 'a', group: 'one', score: 2 })
  await repo.put({ id: 'b', group: 'one', score: 1 })
  const ordered = repo.query().orderBy((row) => row.score)
  expect(Reflect.get(ordered, 'onInvalid')).toBeTypeOf('function')
  const controlled = ordered.onInvalid('throw')
  expect(await controlled.select('id').all()).toEqual([{ id: 'b' }, { id: 'a' }])
  expect(
    await repo
      .query()
      .orderByComparator((left, right) => left.score - right.score)
      .limit(2)
      .where({ id: 'a' })
      .onInvalid('throw')
      .all()
  ).toEqual([{ id: 'a', group: 'one', score: 2 }])
  const projected = controlled.select('id')
  expect(() => Reflect.get(projected, 'select')('id')).toThrowError(
    expect.objectContaining({ code: 'INVALID_CONFIG' })
  )
  const distinct = repo.query().distinct('group')
  expect(Reflect.get(distinct, 'onInvalid')).toBeTypeOf('function')
  expect(await distinct.onInvalid('throw').count()).toBe(1)
})

it('rejects duplicate and late source selection before opening any native iterator', async () => {
  const definition = defineEntity<IRow>()({
    features: [
      entityQueryFeature(),
      entityUniqueFeature(),
      entityMigrationFeature(),
      entityIndexesFeature(),
      entityKeysetFeature()
    ],
    name: 'query-source-state',
    key: 'id',
    indexes: { byGroup: { path: 'group' } }
  })
  const repo = definition.connect(await memoryBackend())
  for (const branch of [
    repo.query().index('byGroup', 'one'),
    repo.query().range({ lower: 'a' }),
    repo.query().where({ group: 'one' }),
    repo.query().skip(0)
  ]) {
    expect(() => Reflect.get(branch, 'index')('byGroup', 'two')).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
    expect(() => Reflect.get(branch, 'range')({ upper: 'z' })).toThrowError(
      expect.objectContaining({ code: 'INVALID_CONFIG' })
    )
  }
})

it('keeps the last page bounds after default comparison and does no work for a zero page', async () => {
  const store = await memoryBackend()
  let comparisons = 0
  const repo = defineEntity<IRow>()({
    features: [
      entityQueryFeature(),
      entityUniqueFeature(),
      entityMigrationFeature(),
      entityIndexesFeature(),
      entityKeysetFeature()
    ],
    name: 'query-page',
    key: 'id',
    defaultOrderBy: (left, right) => {
      comparisons++
      return right.score - left.score
    }
  }).connect(store)
  for (const [id, score] of [
    ['a', 1],
    ['b', 2],
    ['c', 3]
  ] as const)
    await repo.put({ id, score, group: 'one' })
  expect(await repo.query().skip(2).skip(1).limit(2).limit(1).select('id').all()).toEqual([
    { id: 'b' }
  ])
  expect(await repo.query().skip(1).limit(2).first()).toMatchObject({ id: 'b' })
  comparisons = 0
  expect(await repo.query().limit(0).all()).toEqual([])
  expect(await repo.query().limit(0).first()).toBeUndefined()
  expect(comparisons).toBe(0)
  expect(() => repo.query().skip(Number.MAX_SAFE_INTEGER).limit(1).all()).toThrowError(
    expect.objectContaining({ code: 'INVALID_CONFIG' })
  )
})

it('keeps selector failures at the original entity extension boundary', async () => {
  const store = await memoryBackend()
  const repo = defineEntity<IRow>()({
    features: [
      entityQueryFeature(),
      entityUniqueFeature(),
      entityMigrationFeature(),
      entityIndexesFeature(),
      entityKeysetFeature()
    ],
    name: 'query-selector',
    key: 'id'
  }).connect(store)
  await repo.put({ id: 'a', score: 1, group: 'one' })
  const primary = new RangeError('entity selector failure')
  const failure = await repo
    .query()
    .orderBy(() => {
      throw primary
    })
    .all()
    .catch((error) => error)
  expect(failure).toMatchObject({
    code: 'EXTENSION_FAILED',
    operation: 'query.orderBy',
    extensionStage: 'selector'
  })
  expect(failure.cause).toBe(primary)
  // @ts-expect-error a JavaScript caller can return a value outside the key domain.
  const invalid = Reflect.get(repo.query(), 'orderBy')(() => undefined)
  await expect(invalid.all()).rejects.toMatchObject({
    code: 'EXTENSION_FAILED',
    cause: expect.any(TypeError)
  })
  const selected = repo.query().orderBy((row) => row.score)
  expect(() =>
    Reflect.get(
      selected,
      'orderByComparator'
    )((left: IRow, right: IRow) => left.score - right.score)
  ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
})
