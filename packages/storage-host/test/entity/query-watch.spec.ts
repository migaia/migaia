import { entityHost } from '../helpers/memory.ts'
import type { IMemoryBackendWithChangeFeed } from '../helpers/memory.ts'
import type { IStorageBorrowedBackend } from '../../src/types.ts'
import { memoryNotificationsFeature } from '../../src/features/memory-notifications.ts'
import { memoryChangeFeedFeature } from '../../src/features/memory-change-feed.ts'
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

/**
 * Entity invalidation borrows the original native record feed rather than maintaining another
 * subscriber.
 */
const definitionEntityPlugin = defineEntityPlugin<{ id: string; group: string }>()(
  'entity-query-watch-spec-ts-definition-1',
  {
    features: {
      query: entityQueryFeature(),
      unique: entityUniqueFeature(),
      migration: entityMigrationFeature(),
      indexes: entityIndexesFeature(),
      keyset: entityKeysetFeature()
    },
    name: 'entity-watch',
    key: 'id',
    onDiagnostic: () => {},
    indexes: { group: { path: 'group' } }
  }
)

it('uses the native watcher on a frozen raw base and rejects client predicates before subscribing', async () => {
  /** This actual storage host owns the entity installation for this test scope. */
  const definitionEntityPluginHost = await entityHost(definitionEntityPlugin)

  const store = await memoryBackend()
  Object.freeze(store)
  const repo = definitionEntityPluginHost.extensions[definitionEntityPlugin.id](store)
  const query = repo.query().where({ group: 'one' })
  expect(typeof query.watch).toBe('function')
  const iterator = query.watch()
  const next = iterator.next()
  await repo.put({ id: 'a', group: 'one' })
  expect(await next).toMatchObject({ done: false, value: { channel: 'record', kind: 'batch' } })
  const closing = iterator.dispose()
  expect(iterator.dispose()).toBe(closing)
  await closing
  expect(() =>
    repo
      .query()
      .where(() => true)
      .watch()
  ).toThrowError(expect.objectContaining({ code: 'QUERY_NOT_PUSHABLE' }))
  await repo.put({ id: 'b', group: 'two' })
  expect(await repo.get('b')).toEqual({ id: 'b', group: 'two' })
})

it('keeps the borrowed organization watcher on its original native organization', async () => {
  /** This actual storage host owns the entity installation for this test scope. */
  const definitionEntityPluginHost = await entityHost(definitionEntityPlugin)

  await using host = await createStorageHost({
    plugins: [
      memoryBackendPlugin(undefined, {
        notifications: memoryNotificationsFeature(),
        changeFeed: memoryChangeFeedFeature()
      })
    ] as const
  })
  const first = '00000000-0000-0000-0000-000000000001'
  const second = '00000000-0000-0000-0000-000000000002'
  const left = definitionEntityPluginHost.extensions[definitionEntityPlugin.id](
    host.org(first).backend('memory') as IStorageBorrowedBackend<IMemoryBackendWithChangeFeed>
  )
  const right = definitionEntityPluginHost.extensions[definitionEntityPlugin.id](
    host.org(second).backend('memory') as IStorageBorrowedBackend<IMemoryBackendWithChangeFeed>
  )
  const iterator = left.query().watch()
  let settled = false
  const next = iterator.next().then((value) => {
    settled = true
    return value
  })
  await right.put({ id: 'b', group: 'one' })
  await Promise.resolve()
  expect(settled).toBe(false)
  await left.put({ id: 'a', group: 'one' })
  expect(await next).toMatchObject({ done: false, value: { orgId: first, channel: 'record' } })
  await iterator.dispose()
  expect(await right.get('b')).toEqual({ id: 'b', group: 'one' })
})

it('keeps transaction scopes free of native watch and preserves strict page admission', async () => {
  /** This actual storage host owns the entity installation for this test scope. */
  const definitionEntityPluginHost = await entityHost(definitionEntityPlugin)

  const store = await memoryBackend()
  const repo = definitionEntityPluginHost.extensions[definitionEntityPlugin.id](store)
  await store.transaction(async (scope) => {
    expect(Reflect.get(repo.in(scope).query(), 'watch')).toBeUndefined()
    await scope.set('watch-owner', 'same transaction')
  })
  expect(() => repo.query().limit(1).watch()).toThrowError(
    expect.objectContaining({ code: 'QUERY_NOT_PUSHABLE' })
  )
  expect(await store.get('watch-owner')).toBe('same transaction')
})
