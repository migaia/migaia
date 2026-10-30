import { entityHost } from '../helpers/memory.ts'
import { storageProbe } from '../../src/plugins/probe/index.ts'
import { entityQueryFeature } from '../../src/entity/query-feature.ts'
import { entityUniqueFeature } from '../../src/entity/unique-feature.ts'
import { entityMigrationFeature } from '../../src/entity/migration-feature.ts'
import { entityIndexesFeature } from '../../src/entity/indexes-feature.ts'
import { entityKeysetFeature } from '../../src/entity/keyset.ts'
import { expect, it } from 'vitest'
import { createStorageHost } from '../../src/index.ts'
import { memoryBackendPlugin } from '../../src/plugins/memory.ts'
import { defineEntityPlugin } from '../../src/entity.ts'
import { memoryBackend } from '../helpers/memory.ts'

/** Declared-path choices reach the actual original index reader and materializer. */
type IRow = { id: string; group: string; score: number; email: string }
const definitionEntityPlugin = defineEntityPlugin<IRow>()(
  'entity-query-index-plan-spec-ts-definition-1',
  {
    features: {
      query: entityQueryFeature(),
      unique: entityUniqueFeature(),
      migration: entityMigrationFeature(),
      indexes: entityIndexesFeature(),
      keyset: entityKeysetFeature()
    },
    name: 'automatic-index',
    key: 'id',
    onDiagnostic: () => {},
    indexes: {
      byGroup: { path: 'group' },
      byScore: { path: 'score' },
      byEmail: { path: 'email', unique: true },
      byPair: { paths: ['group', 'score'] }
    }
  }
)

it('selects declared equality indexes once without opening a source during explain', async () => {
  /** This actual storage host owns the entity installation for this test scope. */
  const definitionEntityPluginHost = await entityHost(definitionEntityPlugin)

  const reads: number[] = []
  await using host = await createStorageHost({
    plugins: [
      storageProbe({
        afterQuery: (info) => {
          reads.push(info.stats.readCount)
        }
      }),
      memoryBackendPlugin()
    ] as const
  })
  const store = host.backend('memory')
  const repo = definitionEntityPluginHost.extensions[definitionEntityPlugin.id](store, {
    queryStages: host.queryStages(store)
  })
  for (let index = 0; index < 12; index++)
    await repo.put({
      id: String(index),
      group: index % 2 ? 'one' : 'two',
      score: index,
      email: `${index}@test`
    })
  const query = repo.query().where({ group: 'one' })
  expect(query.explain()).toMatchObject({
    index: 'byGroup',
    fullScan: true,
    sourceReason: expect.stringContaining('Static index priority')
  })
  expect(reads).toEqual([])
  expect((await query.all()).map((row) => row.id)).toEqual(['1', '11', '3', '5', '7', '9'])
  // Memory has no secondary-index endpoint; the original fallback honestly examines all twelve rows.
  expect(reads.at(-1)).toBe(12)
  expect(await query.requirePushdown().all()).toHaveLength(6)
  expect(repo.query().where({ group: 'one', email: '1@test' }).explain().index).toBe('byEmail')
  expect(repo.query().where({ group: 'one', score: 1 }).explain().index).toBe('byGroup')
  expect(
    repo
      .query()
      .where({ group: { startsWith: 'o' }, score: { between: [1, 3] } })
      .explain().index
  ).toBe('byScore')
  expect(
    repo
      .query()
      .where({ group: { in: ['one', 'two'] }, score: { in: [1] } })
      .explain().index
  ).toBe('byScore')
  expect(repo.query().where({ group: 'one' }).explain().sourceCandidates).toContainEqual({
    index: 'byEmail',
    reason: expect.any(String)
  })
  expect(repo.query().index('byScore').where({ group: 'one' }).explain().index).toBe('byScore')
  expect(
    repo
      .query()
      .where(() => true)
      .where({ group: 'one' })
      .explain().index
  ).toBeUndefined()
})

it('uses conservative in and prefix candidates with exact canonical matching', async () => {
  /** This actual storage host owns the entity installation for this test scope. */
  const definitionEntityPluginHost = await entityHost(definitionEntityPlugin)

  const repo = definitionEntityPluginHost.extensions[definitionEntityPlugin.id](
    await memoryBackend()
  )
  for (const [id, group, score] of [
    ['a', 'prefix', 1],
    ['b', 'prefix\ufffftail', 2],
    ['c', 'prefix\uffff\ufffftail', 3],
    ['d', 'zulu', 4]
  ] as const)
    await repo.put({ id, group, score, email: `${id}@test` })
  const prefix = repo.query().where('group', 'startsWith', 'prefix')
  expect(prefix.explain().index).toBe('byGroup')
  expect((await prefix.requirePushdown().all()).map((row) => row.id)).toEqual(['a', 'b', 'c'])
  expect(
    (
      await repo
        .query()
        .where({ score: { in: [1, 3] } })
        .requirePushdown()
        .all()
    ).map((row) => row.id)
  ).toEqual(['a', 'c'])
  expect(
    await repo
      .query()
      .where({ score: { between: [2, 3] } })
      .count()
  ).toBe(2)
  expect(
    await repo
      .query()
      .where({ score: { gt: 1, lte: 3 } })
      .count()
  ).toBe(2)
  expect(
    await repo
      .query()
      .where({ score: { between: [3, 1] } })
      .count()
  ).toBe(0)
})

it('uses the same planned selection for draft reads and committed query mutations', async () => {
  /** This actual storage host owns the entity installation for this test scope. */
  const definitionEntityPluginHost = await entityHost(definitionEntityPlugin)

  const store = await memoryBackend()
  const repo = definitionEntityPluginHost.extensions[definitionEntityPlugin.id](store)
  await repo.put({ id: 'a', group: 'one', score: 1, email: 'a@test' })
  await repo.put({ id: 'b', group: 'two', score: 2, email: 'b@test' })
  await store.transaction(async (scope) => {
    const bound = repo.in(scope)
    await bound.put({ id: 'c', group: 'one', score: 3, email: 'c@test' })
    expect((await bound.query().where({ group: 'one' }).all()).map((row) => row.id)).toEqual([
      'a',
      'c'
    ])
    expect(await bound.query().where({ group: 'one' }).update({ score: 5 })).toBe(2)
  })
  expect(await repo.get('a')).toMatchObject({ score: 5 })
  expect(await repo.get('b')).toMatchObject({ score: 2 })
  expect(await repo.query().where({ group: 'one' }).delete()).toBe(2)
  expect(await repo.get('a')).toBeUndefined()
  expect(await repo.get('c')).toBeUndefined()
})

it('reuses the same default comparator identity across original keyset pages', async () => {
  /** Explicit entity plugin configuration is installed before requesting a repository. */
  const entity2EntityPlugin = defineEntityPlugin<IRow>()(
    'entity-query-index-plan-spec-ts-entity2-2',
    {
      features: {
        query: entityQueryFeature(),
        unique: entityUniqueFeature(),
        migration: entityMigrationFeature(),
        indexes: entityIndexesFeature(),
        keyset: entityKeysetFeature()
      },
      name: 'default-cursor',
      key: 'id',
      defaultOrderBy: (left, right) => right.score - left.score
    }
  )
  /** This actual storage host owns the entity installation for this test scope. */
  const entity2EntityPluginHost = await entityHost(entity2EntityPlugin)
  const repo = entity2EntityPluginHost.extensions[entity2EntityPlugin.id](await memoryBackend())
  for (const [id, score] of [
    ['a', 1],
    ['b', 2],
    ['c', 3]
  ] as const)
    await repo.put({ id, score, group: 'one', email: `${id}@test` })
  const query = repo.query().limit(3)
  const first = await query.page(1)
  expect(first.items.map((row) => row.id)).toEqual(['c'])
  expect(first.next).toBeDefined()
  expect((await query.after(first.next!).page(1)).items.map((row) => row.id)).toEqual(['b'])
})

it('uses a full compound equality tuple without parsing projection callbacks', async () => {
  /** Explicit entity plugin configuration is installed before requesting a repository. */
  const entity3EntityPlugin = defineEntityPlugin<IRow>()(
    'entity-query-index-plan-spec-ts-entity3-3',
    {
      features: {
        query: entityQueryFeature(),
        unique: entityUniqueFeature(),
        migration: entityMigrationFeature(),
        indexes: entityIndexesFeature(),
        keyset: entityKeysetFeature()
      },
      name: 'compound-source',
      key: 'id',
      onDiagnostic: () => {},
      indexes: { pair: { paths: ['group', 'score'] } }
    }
  )
  /** This actual storage host owns the entity installation for this test scope. */
  const entity3EntityPluginHost = await entityHost(entity3EntityPlugin)
  const repo = entity3EntityPluginHost.extensions[entity3EntityPlugin.id](await memoryBackend())
  await repo.put({ id: 'a', group: 'one', score: 1, email: 'a@test' })
  await repo.put({ id: 'b', group: 'one', score: 2, email: 'b@test' })
  const query = repo.query().where({ group: 'one', score: 1 })
  expect(query.explain().index).toBe('pair')
  expect((await query.requirePushdown().all()).map((row) => row.id)).toEqual(['a'])
})
