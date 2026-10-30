import { entityHost } from '../helpers/memory.ts'
import { storageProbe } from '../../src/plugins/probe/index.ts'
import { entityQueryFeature } from '../../src/entity/query-feature.ts'
import { entityUniqueFeature } from '../../src/entity/unique-feature.ts'
import { entityMigrationFeature } from '../../src/entity/migration-feature.ts'
import { entityIndexesFeature } from '../../src/entity/indexes-feature.ts'
import { entityKeysetFeature } from '../../src/entity/keyset.ts'
import { expect, it, vi } from 'vitest'
import { asyncDisposeKey } from '@migaia/plugin-host'
import { deferred } from '@migaia/utils/promise'
import { assertTransactionOwner } from '../../src/authoring/transaction.ts'
import { type ICodecStageObserver, type IQueryStageObserver } from '@migaia/storage-contract'
import { createStorageHost, definePlugin, type IStoragePluginCore } from '../../src/index.ts'
import { memoryBackendKind } from '../../src/plugins/memory.ts'
import { createMemoryBackend } from '../../src/backends/memory.ts'
import { defineEntityPlugin } from '../../src/entity.ts'

/** Public installation captures only the already declared observation factories from the real core. */
function observedMemory() {
  let construction!: ReturnType<typeof createMemoryBackend>
  let codec!: ICodecStageObserver
  let query!: IQueryStageObserver
  const factory = (core: IStoragePluginCore) => ({
    kind: memoryBackendKind,
    capabilityInstaller: (_store: typeof construction.store) => construction.installer,
    featureExpose: () => ({
      getClient: () => undefined,
      getTransactionClient: (scope: object) => {
        assertTransactionOwner(construction.store, scope)
        return undefined
      }
    }),
    install: () => {
      construction = createMemoryBackend(core, {})
      core.registerStore(construction.store)
      core.registerChangeController(construction.store, construction.controller)
      codec = core.stageBindings.codecStages(construction.store)
      query = core.stageBindings.queryStages(construction.store)
      return {}
    }
  })
  return {
    plugin: definePlugin('observed-memory', factory),
    ports: () => ({ codecStages: codec, queryStages: query })
  }
}

it('binds codec conversions and whole queries to the actual store and current transaction view', async () => {
  const fixture = observedMemory()
  const encode: unknown[] = []
  const decode: unknown[] = []
  const query: unknown[] = []
  const waiting = deferred<void>()
  await using host = await createStorageHost({
    plugins: [
      storageProbe({
        beforeEncode: (payload) => {
          encode.push(payload)
          return waiting.promise
        },
        afterEncode: (payload) => {
          encode.push(payload)
        },
        beforeDecode: (payload) => {
          decode.push(payload)
        },
        afterDecode: (payload) => {
          decode.push(payload)
        },
        beforeQuery: (payload) => {
          query.push(payload)
          return waiting.promise
        },
        afterQuery: (payload) => {
          query.push(payload)
        }
      }),
      fixture.plugin
    ]
  })
  const store = host.backend('observed-memory')

  /** Explicit entity plugin configuration is installed before requesting a repository. */
  const entity1EntityPlugin = defineEntityPlugin<{ id: string; score: number }>()(
    'entity-stages-spec-ts-entity1-1',
    {
      features: {
        query: entityQueryFeature(),
        unique: entityUniqueFeature(),
        migration: entityMigrationFeature(),
        indexes: entityIndexesFeature(),
        keyset: entityKeysetFeature()
      },
      name: 'observed-rows',
      key: 'id'
    }
  )
  /** This actual storage host owns the entity installation for this test scope. */
  const entity1EntityPluginHost = await entityHost(entity1EntityPlugin)
  const repo = entity1EntityPluginHost.extensions[entity1EntityPlugin.id](store, fixture.ports())
  await repo.put({ id: 'a', score: 1 })
  expect(encode).toHaveLength(2)
  expect(encode[0]).toMatchObject({
    backendId: 'observed-memory',
    operation: 'entity.codec.encode',
    transactionId: expect.any(String)
  })
  expect(await repo.query().where('score', 'gt', 0).select('id').all()).toEqual([{ id: 'a' }])
  expect(decode).toHaveLength(2)
  expect(query).toHaveLength(2)
  expect(query[1]).toMatchObject({ stats: { readCount: 1, returnedCount: 1, completed: true } })
  query.length = 0
  expect(await repo.query().select('score').sum('score')).toBe(1)
  expect(query).toHaveLength(2)
  expect(query[1]).toMatchObject({ stats: { readCount: 1, returnedCount: 1, completed: true } })
  query.length = 0
  expect(await repo.query().first()).toMatchObject({ id: 'a' })
  expect(query).toHaveLength(2)
  expect(query[0]).toMatchObject({ plan: { hasLimit: true } })
  expect(query[1]).toMatchObject({ stats: { readCount: 1, returnedCount: 1, completed: true } })
  query.length = 0
  expect(await repo.query().count()).toBe(1)
  expect(query).toHaveLength(2)
  expect(query[0]).toMatchObject({ plan: { hasOrder: false } })
  await store.transaction(async (scope) => {
    const id = assertTransactionOwner(store, scope).id
    expect(await repo.in(scope).query().all()).toEqual([{ id: 'a', score: 1 }])
    expect(query.at(-1)).toMatchObject({
      transactionId: id,
      stats: { readCount: 1, returnedCount: 1 }
    })
    expect(decode.at(-1)).toMatchObject({ transactionId: id })
    const iterator = repo.in(scope).query().stream()
    expect(await iterator.next()).toMatchObject({ done: false })
    expect(query.at(-1)).toMatchObject({
      transactionId: id,
      stats: { returnedCount: 1, completed: false }
    })
    await iterator.dispose()
  })
  query.length = 0
  expect(await repo.list({ limit: 1 })).toHaveLength(1)
  expect(query).toHaveLength(2)
  expect(query[1]).toMatchObject({ stats: { readCount: 1, returnedCount: 1, completed: true } })
  await using stream = repo.stream({ limit: 1 })
  expect(await stream.next()).toMatchObject({ done: false })
  expect(await stream.next()).toMatchObject({ done: true })
  expect(query.at(-1)).toMatchObject({ stats: { readCount: 1, returnedCount: 1, completed: true } })
  /** Observation forwards the mapped root iterator's original canonical cleanup methods. */
  const mapped = repo.query().select('id').stream()
  expect(await mapped.next()).toMatchObject({ done: false, value: { id: 'a' } })
  expect(query.at(-1)).toMatchObject({ stats: { returnedCount: 1, completed: false } })
  const closing = mapped.dispose()
  expect(mapped.dispose()).toBe(closing)
  const symbolic = mapped[asyncDisposeKey]()
  expect(mapped[asyncDisposeKey]()).toBe(symbolic)
  expect(symbolic).not.toBe(closing)
  await Promise.all([closing, symbolic])
  waiting.resolve()
})

it('reports explicit observer failures without changing results and rejects cross-kind ports', async () => {
  const fixture = observedMemory()
  await using host = await createStorageHost({ plugins: [fixture.plugin] })
  const ports = fixture.ports()
  const failure = new Error('observer rejection')
  const report = vi.fn(() => undefined)
  const query = { ...ports.queryStages, beforeQuery: () => Promise.reject(failure), report }

  /** Explicit entity plugin configuration is installed before requesting a repository. */
  const entity2EntityPlugin = defineEntityPlugin<{ id: string }>()(
    'entity-stages-spec-ts-entity2-2',
    {
      features: {
        query: entityQueryFeature(),
        unique: entityUniqueFeature(),
        migration: entityMigrationFeature(),
        indexes: entityIndexesFeature(),
        keyset: entityKeysetFeature()
      },
      name: 'observer-failures',
      key: 'id'
    }
  )
  /** This actual storage host owns the entity installation for this test scope. */
  const entity2EntityPluginHost = await entityHost(entity2EntityPlugin)
  const repo = entity2EntityPluginHost.extensions[entity2EntityPlugin.id](
    host.backend('observed-memory'),
    { queryStages: query }
  )
  expect(await repo.query().all()).toEqual([])
  await Promise.resolve()
  expect(report).toHaveBeenCalledWith(failure)

  /** Explicit entity plugin configuration is installed before requesting a repository. */
  const entity3EntityPlugin = defineEntityPlugin<{ id: string }>()(
    'entity-stages-spec-ts-entity3-3',
    {
      features: {
        query: entityQueryFeature(),
        unique: entityUniqueFeature(),
        migration: entityMigrationFeature(),
        indexes: entityIndexesFeature(),
        keyset: entityKeysetFeature()
      },
      name: 'wrong-port',
      key: 'id'
    }
  )
  /** This actual storage host owns the entity installation for this test scope. */
  const entity3EntityPluginHost = await entityHost(entity3EntityPlugin)
  expect(() =>
    entity3EntityPluginHost.extensions[entity3EntityPlugin.id](host.backend('observed-memory'), {
      codecStages: ports.queryStages as never
    })
  ).toThrowError(expect.objectContaining({ code: 'INVALID_CONFIG' }))
})
