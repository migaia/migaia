import { entityHost } from '../helpers/memory.ts'
import { entityQueryFeature } from '../../src/entity/query-feature.ts'
import { entityUniqueFeature } from '../../src/entity/unique-feature.ts'
import { entityMigrationFeature } from '../../src/entity/migration-feature.ts'
import { entityIndexesFeature } from '../../src/entity/indexes-feature.ts'
import { entityKeysetFeature } from '../../src/entity/keyset.ts'
import { beforeEach, describe, expect, it } from 'vitest'
import { walkErrorCauses } from '@migaia/utils/error'
import { defineEntityPlugin } from '../../src/entity.ts'
import { memoryBackend } from '../helpers/memory.ts'
import { StorageError } from '../../src/errors.ts'
import { StorageHostErrorCode } from '@migaia/storage-contract/error-code'
import { composeRepositoryKey } from '../../src/entity/key.ts'
import type { IStorageHost } from '../../src/types.ts'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IStorageKey,
  type ITransactionOptions
} from '@migaia/storage-contract'

type IUser = { id: string; name: string; email: string }

const usersEntityPlugin = defineEntityPlugin<IUser>()('entity-repository-spec-ts-users-1', {
  features: {
    query: entityQueryFeature(),
    unique: entityUniqueFeature(),
    migration: entityMigrationFeature(),
    indexes: entityIndexesFeature(),
    keyset: entityKeysetFeature()
  },
  name: 'users',
  key: 'id'
})

it('stream limit zero performs no backend read or yield', async () => {
  /** This actual storage host owns the entity installation for this test scope. */
  const usersEntityPluginHost = await entityHost(usersEntityPlugin)

  const store = await memoryBackend()
  const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)
  await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
  let reads = 0
  const originalIterate = store.iterateRecords
  store.iterateRecords = (range, ctx) => {
    reads += 1
    return originalIterate(range, ctx)
  }
  const values: IUser[] = []
  for await (const value of repo.stream({ limit: 0 })) values.push(value)
  expect(values).toEqual([])
  expect(reads).toBe(0)
})

it('stream direction reverses the explicit comparator order', async () => {
  /** This actual storage host owns the entity installation for this test scope. */
  const usersEntityPluginHost = await entityHost(usersEntityPlugin)

  const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await memoryBackend())
  await repo.put({ id: 'a', name: 'A', email: 'a@b.c' })
  await repo.put({ id: 'b', name: 'B', email: 'b@c.d' })
  const values: IUser[] = []
  for await (const value of repo.stream({
    orderBy: (left, right) => left.id.localeCompare(right.id),
    limit: 2,
    direction: 'prev'
  }))
    values.push(value)
  expect(values.map((value) => value.id)).toEqual(['b', 'a'])
})

it('projects explicit selectors and indexed list through the shared query route', async () => {
  type IIndexedUser = { id: string; email: string; tags: string[] }
  let selectorCalls = 0
  const diagnostics: string[] = []
  const entityEntityPlugin = defineEntityPlugin<IIndexedUser>()(
    'entity-repository-spec-ts-entity-2',
    {
      features: {
        query: entityQueryFeature(),
        unique: entityUniqueFeature(),
        migration: entityMigrationFeature(),
        indexes: entityIndexesFeature(),
        keyset: entityKeysetFeature()
      },
      name: 'indexed-list-users',
      key: 'id',
      onDiagnostic: (message) => diagnostics.push(message),
      indexes: {
        email: { path: 'email' },
        tags: { path: 'tags', multiEntry: true },
        selected: {
          select: (value) => {
            selectorCalls += 1
            return { kind: 'single' as const, key: value.email }
          },
          revision: 1
        }
      }
    }
  )
  /** This actual storage host owns the entity installation for this test scope. */
  const entityEntityPluginHost = await entityHost(entityEntityPlugin)

  const repository = entityEntityPluginHost.extensions[entityEntityPlugin.id](await memoryBackend())
  await repository.put({ id: 'u1', email: 'ada@example.com', tags: ['admin', 'staff'] })
  await repository.put({ id: 'u2', email: 'grace@example.com', tags: ['staff'] })

  await expect(
    repository.list({ index: 'tags', range: { lower: 'admin', upper: 'admin' } })
  ).resolves.toEqual([{ id: 'u1', email: 'ada@example.com', tags: ['admin', 'staff'] }])
  await expect(
    repository.list({
      index: 'selected',
      range: { lower: 'ada@example.com', upper: 'ada@example.com' }
    })
  ).resolves.toEqual([{ id: 'u1', email: 'ada@example.com', tags: ['admin', 'staff'] }])
  await expect(
    repository
      .query()
      .index('selected', {
        lower: 'ada@example.com',
        upper: 'ada@example.com'
      })
      .all()
  ).resolves.toEqual([{ id: 'u1', email: 'ada@example.com', tags: ['admin', 'staff'] }])
  const streamed: IIndexedUser[] = []
  for await (const value of repository.stream({
    index: 'tags',
    range: { lower: 'admin', upper: 'admin' }
  }))
    streamed.push(value)
  expect(streamed).toEqual([{ id: 'u1', email: 'ada@example.com', tags: ['admin', 'staff'] }])

  const selectedStream: IIndexedUser[] = []
  for await (const value of repository.stream({
    index: 'tags',
    range: { lower: 'admin', upper: 'admin' }
  }))
    selectedStream.push(value)
  expect(selectedStream).toEqual([{ id: 'u1', email: 'ada@example.com', tags: ['admin', 'staff'] }])
  expect(diagnostics).toHaveLength(5)
  expect(diagnostics).toEqual(
    diagnostics.map(() => expect.stringContaining('uses authoritative full-scan fallback'))
  )
  expect(selectorCalls).toBe(4)
})

it('fallback batch does not execute secondary-index selectors', async () => {
  let selectorCalls = 0
  const entityEntityPlugin = defineEntityPlugin<IUser>()('entity-repository-spec-ts-entity-3', {
    features: {
      query: entityQueryFeature(),
      unique: entityUniqueFeature(),
      migration: entityMigrationFeature(),
      indexes: entityIndexesFeature(),
      keyset: entityKeysetFeature()
    },
    name: 'fallback-batch-users',
    key: 'id',
    indexes: {
      email: {
        select: () => {
          selectorCalls += 1
          throw new Error('fallback must not project')
        },
        revision: 1
      }
    }
  })
  /** This actual storage host owns the entity installation for this test scope. */
  const entityEntityPluginHost = await entityHost(entityEntityPlugin)

  await entityEntityPluginHost.extensions[entityEntityPlugin.id](await memoryBackend()).batch(
    async (tx) => {
      await tx.put({ id: 'u1', name: 'Ada', email: 'ada@example.com' })
    }
  )
  expect(selectorCalls).toBe(0)
})

it('find APIs share fallback range, ordering, direction, and limit semantics', async () => {
  /** Explicit entity plugin configuration is installed before requesting a repository. */
  const entity4EntityPlugin = defineEntityPlugin<IUser>()('entity-repository-spec-ts-entity4-4', {
    features: {
      query: entityQueryFeature(),
      unique: entityUniqueFeature(),
      migration: entityMigrationFeature(),
      indexes: entityIndexesFeature(),
      keyset: entityKeysetFeature()
    },
    name: 'indexed-fallback-users',
    key: 'id',
    indexes: { email: { path: 'email' } }
  })
  /** This actual storage host owns the entity installation for this test scope. */
  const entity4EntityPluginHost = await entityHost(entity4EntityPlugin)
  const repository = entity4EntityPluginHost.extensions[entity4EntityPlugin.id](
    await memoryBackend()
  )
  await repository.put({ id: 'u2', name: 'Bob', email: 'same@example.com' })
  await repository.put({ id: 'u1', name: 'Ada', email: 'same@example.com' })
  await repository.put({ id: 'u3', name: 'Cat', email: 'z@example.com' })
  await expect(repository.findBy('email', 'same@example.com')).resolves.toMatchObject({ id: 'u1' })
  await expect(
    repository
      .query()
      .index('email', { lower: 'same@example.com', upper: 'z@example.com' })
      .orderByComparator(
        (left, right) => right.email.localeCompare(left.email) || right.id.localeCompare(left.id)
      )
      .limit(2)
      .all()
  ).resolves.toEqual([
    { id: 'u3', name: 'Cat', email: 'z@example.com' },
    { id: 'u2', name: 'Bob', email: 'same@example.com' }
  ])
  const streamed: IUser[] = []
  for await (const value of repository
    .query()
    .index('email', {
      lower: 'same@example.com',
      upper: 'same@example.com'
    })
    .stream())
    streamed.push(value)
  expect(streamed.map((value) => value.id)).toEqual(['u1', 'u2'])
})

it('indexed comparator ordering ties by index and id before direction and limit', async () => {
  const entityEntityPlugin = defineEntityPlugin<IUser>()('entity-repository-spec-ts-entity-5', {
    features: {
      query: entityQueryFeature(),
      unique: entityUniqueFeature(),
      migration: entityMigrationFeature(),
      indexes: entityIndexesFeature(),
      keyset: entityKeysetFeature()
    },
    name: 'indexed-comparator-users',
    key: 'id',
    defaultOrderBy: () => 0,
    indexes: { email: { path: 'email' } }
  })
  /** This actual storage host owns the entity installation for this test scope. */
  const entityEntityPluginHost = await entityHost(entityEntityPlugin)

  const repository = entityEntityPluginHost.extensions[entityEntityPlugin.id](await memoryBackend())
  await repository.put({ id: 'a', name: 'A', email: 'z@example.com' })
  await repository.put({ id: 'b', name: 'B', email: 'a@example.com' })

  await expect(repository.list({ index: 'email', limit: 2 })).resolves.toEqual([
    { id: 'b', name: 'B', email: 'a@example.com' },
    { id: 'a', name: 'A', email: 'z@example.com' }
  ])
  const previous: IUser[] = []
  for await (const value of repository.stream({
    index: 'email',
    direction: 'prev',
    limit: 1,
    orderBy: () => 0
  }))
    previous.push(value)
  expect(previous).toEqual([{ id: 'a', name: 'A', email: 'z@example.com' }])
  await expect(
    repository
      .query()
      .index('email')
      .orderByComparator(() => 0)
      .limit(1)
      .all()
  ).resolves.toEqual([{ id: 'b', name: 'B', email: 'a@example.com' }])
})

const backends = [{ label: 'memory (structured)', create: memoryBackend }] as const

for (const { label, create } of backends) {
  describe(`repository over ${label}`, () => {
    it('put 后 get 返回同值', async () => {
      /** This actual storage host owns the entity installation for this test scope. */
      const usersEntityPluginHost = await entityHost(usersEntityPlugin)

      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await create())
      await repo.put({ id: 'u1', name: 'Ada', email: 'ada@example.com' })
      await expect(repo.get('u1')).resolves.toEqual({
        id: 'u1',
        name: 'Ada',
        email: 'ada@example.com'
      })
    })

    it('put 返回 id', async () => {
      /** This actual storage host owns the entity installation for this test scope. */
      const usersEntityPluginHost = await entityHost(usersEntityPlugin)

      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await create())
      await expect(repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })).resolves.toBe('u1')
    })

    it('get 未写入的 id 返回 undefined', async () => {
      /** This actual storage host owns the entity installation for this test scope. */
      const usersEntityPluginHost = await entityHost(usersEntityPlugin)

      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await create())
      await expect(repo.get('missing')).resolves.toBeUndefined()
    })

    it('put 缺少 key 属性时抛稳定 StorageError', async () => {
      /** This actual storage host owns the entity installation for this test scope. */
      const usersEntityPluginHost = await entityHost(usersEntityPlugin)

      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await create())
      await expect(repo.put({ name: 'Ada' } as unknown as IUser)).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
    })

    it('remove 后 get 返回 undefined', async () => {
      /** This actual storage host owns the entity installation for this test scope. */
      const usersEntityPluginHost = await entityHost(usersEntityPlugin)

      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await create())
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await repo.remove('u1')
      await expect(repo.get('u1')).resolves.toBeUndefined()
    })

    it('list 返回全部记录', async () => {
      /** This actual storage host owns the entity installation for this test scope. */
      const usersEntityPluginHost = await entityHost(usersEntityPlugin)

      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await create())
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await repo.put({ id: 'u2', name: 'Bob', email: 'b@c.d' })
      const all = await repo.list()
      expect(all).toHaveLength(2)
      expect(all.map((u) => u.id).sort()).toEqual(['u1', 'u2'])
    })

    it('list 支持 limit', async () => {
      /** This actual storage host owns the entity installation for this test scope. */
      const usersEntityPluginHost = await entityHost(usersEntityPlugin)

      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await create())
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await repo.put({ id: 'u2', name: 'Bob', email: 'b@c.d' })
      await repo.put({ id: 'u3', name: 'Cy', email: 'c@d.e' })
      const limited = await repo.list({ limit: 2 })
      expect(limited).toHaveLength(2)
    })

    it('stream 接受查询 options 并在流式路径应用 limit', async () => {
      /** This actual storage host owns the entity installation for this test scope. */
      const usersEntityPluginHost = await entityHost(usersEntityPlugin)

      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await create())
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await repo.put({ id: 'u2', name: 'Bob', email: 'b@c.d' })
      const streamed: IUser[] = []
      for await (const user of repo.stream({ limit: 1 })) streamed.push(user)
      expect(streamed).toHaveLength(1)
    })

    it('stream 应用 orderBy 后再应用 limit', async () => {
      /** This actual storage host owns the entity installation for this test scope. */
      const usersEntityPluginHost = await entityHost(usersEntityPlugin)

      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await create())
      await repo.put({ id: 'a', name: 'Ada', email: 'a@b.c' })
      await repo.put({ id: 'b', name: 'Bob', email: 'b@c.d' })
      const streamed: IUser[] = []
      for await (const user of repo.stream({
        orderBy: (left, right) => right.name.localeCompare(left.name),
        limit: 1
      }))
        streamed.push(user)
      expect(streamed.map((user) => user.name)).toEqual(['Bob'])
    })

    it('KV list 按主键排序并在排序后应用 limit/range', async () => {
      /** This actual storage host owns the entity installation for this test scope. */
      const usersEntityPluginHost = await entityHost(usersEntityPlugin)

      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await create())
      await repo.put({ id: 'c', name: 'C', email: 'c@d.e' })
      await repo.put({ id: 'a', name: 'A', email: 'a@b.c' })
      await repo.put({ id: 'b', name: 'B', email: 'b@c.d' })
      await expect(
        repo.list({ range: { lower: 'a', upper: 'c', upperOpen: true }, limit: 1 })
      ).resolves.toEqual([{ id: 'a', name: 'A', email: 'a@b.c' }])
    })

    it('stream 逐条产出全部记录', async () => {
      /** This actual storage host owns the entity installation for this test scope. */
      const usersEntityPluginHost = await entityHost(usersEntityPlugin)

      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await create())
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await repo.put({ id: 'u2', name: 'Bob', email: 'b@c.d' })
      const seen: string[] = []
      for await (const user of repo.stream()) seen.push(user.id)
      expect(seen.sort()).toEqual(['u1', 'u2'])
    })

    it('list/stream 不会读到其他 entity 的记录', async () => {
      /** This actual storage host owns the entity installation for this test scope. */
      const usersEntityPluginHost = await entityHost(usersEntityPlugin)

      const store = await create()
      const postsEntityPlugin = defineEntityPlugin<{ id: string; title: string }>()(
        'entity-repository-spec-ts-posts-6',
        {
          features: {
            query: entityQueryFeature(),
            unique: entityUniqueFeature(),
            migration: entityMigrationFeature(),
            indexes: entityIndexesFeature(),
            keyset: entityKeysetFeature()
          },
          name: 'posts',
          key: 'id'
        }
      )
      /** This actual storage host owns the entity installation for this test scope. */
      const postsEntityPluginHost = await entityHost(postsEntityPlugin)

      const userRepo = usersEntityPluginHost.extensions[usersEntityPlugin.id](store)
      const postRepo = postsEntityPluginHost.extensions[postsEntityPlugin.id](store)
      await userRepo.put({ id: 'shared-id', name: 'Ada', email: 'a@b.c' })
      await postRepo.put({ id: 'shared-id', title: 'Hello' })
      await expect(userRepo.list()).resolves.toEqual([
        { id: 'shared-id', name: 'Ada', email: 'a@b.c' }
      ])
      await expect(postRepo.list()).resolves.toEqual([{ id: 'shared-id', title: 'Hello' }])
    })
  })
}

describe('KV-only scan diagnostics', () => {
  it('结构化后端上 list/stream 不触发 diagnostic', async () => {
    const diagnosed: string[] = []
    const diagnosedEntityEntityPlugin = defineEntityPlugin<IUser>()(
      'entity-repository-spec-ts-diagnosedEntity-7',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'users-diag-structured',
        key: 'id',
        onDiagnostic: (message) => diagnosed.push(message)
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const diagnosedEntityEntityPluginHost = await entityHost(diagnosedEntityEntityPlugin)

    const repo = diagnosedEntityEntityPluginHost.extensions[diagnosedEntityEntityPlugin.id](
      await memoryBackend()
    )
    await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
    await repo.list()
    expect(diagnosed).toHaveLength(0)
  })
})

describe('查询排序与无效记录策略', () => {
  it('comparator 异常统一为 EXTENSION_FAILED', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity8EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity8-8',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'order-error',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity8EntityPluginHost = await entityHost(entity8EntityPlugin)
    const repo = entity8EntityPluginHost.extensions[entity8EntityPlugin.id](await memoryBackend())
    await repo.put({ id: 'a' })
    await repo.put({ id: 'b' })
    const comparator = () => {
      throw new Error('comparator failure')
    }
    await expect(repo.list({ orderBy: comparator, limit: 2 })).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.orderBy',
      extensionStage: 'comparator'
    })
    await expect(
      (async () => {
        for await (const value of repo.stream({ orderBy: comparator, limit: 2 })) void value
      })()
    ).rejects.toMatchObject({ code: 'EXTENSION_FAILED', extensionStage: 'comparator' })
  })

  it('comparator 返回非 number 时不静默强制转换', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity9EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity9-9',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'invalid-comparator',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity9EntityPluginHost = await entityHost(entity9EntityPlugin)
    const repo = entity9EntityPluginHost.extensions[entity9EntityPlugin.id](await memoryBackend())
    await repo.put({ id: 'a' })
    await repo.put({ id: 'b' })
    await expect(repo.list({ orderBy: () => 'invalid' as never, limit: 2 })).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.orderBy',
      extensionStage: 'comparator'
    })
    await expect(repo.list({ orderBy: () => Number.NaN, limit: 2 })).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.orderBy',
      extensionStage: 'comparator'
    })
  })

  it('list/stream 不把显式 null orderBy 静默当成默认排序', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity10EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity10-10',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'null-order-by',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity10EntityPluginHost = await entityHost(entity10EntityPlugin)
    const repo = entity10EntityPluginHost.extensions[entity10EntityPlugin.id](await memoryBackend())
    await expect(repo.list({ orderBy: null as never })).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
    await expect(
      (async () => {
        for await (const value of repo.stream({ orderBy: null as never })) void value
      })()
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })

  it('list/stream 拒绝 null、数组和 primitive range', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity11EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity11-11',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'invalid-range',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity11EntityPluginHost = await entityHost(entity11EntityPlugin)
    const repo = entity11EntityPluginHost.extensions[entity11EntityPlugin.id](await memoryBackend())
    for (const range of [null, [], 'range', 1]) {
      await expect(repo.list({ range: range as never })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      })
      await expect(
        (async () => {
          for await (const value of repo.stream({ range: range as never })) void value
        })()
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    }
  })

  it('list/stream 拒绝非 boolean range open flags', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity12EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity12-12',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'invalid-range-flags',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity12EntityPluginHost = await entityHost(entity12EntityPlugin)
    const repo = entity12EntityPluginHost.extensions[entity12EntityPlugin.id](await memoryBackend())
    for (const range of [{ lowerOpen: 'yes' }, { upperOpen: 1 }]) {
      await expect(repo.list({ range: range as never })).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      })
      await expect(
        (async () => {
          for await (const value of repo.stream({ range: range as never })) void value
        })()
      ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    }
  })

  it('list/stream 拒绝 null、数组和 primitive options', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity13EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity13-13',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'invalid-list-options',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity13EntityPluginHost = await entityHost(entity13EntityPlugin)
    const repo = entity13EntityPluginHost.extensions[entity13EntityPlugin.id](await memoryBackend())
    for (const options of [null, [], 'options', 1]) {
      await expect(repo.list(options as never)).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
      await expect(
        (async () => {
          for await (const value of repo.stream(options as never)) void value
        })()
      ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    }
  })

  it('list/stream/migrate 在没有坏记录时也拒绝非法 onInvalid', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity14EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity14-14',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'invalid-on-invalid',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity14EntityPluginHost = await entityHost(entity14EntityPlugin)
    const repo = entity14EntityPluginHost.extensions[entity14EntityPlugin.id](await memoryBackend())
    for (const onInvalid of [null, [], 'invalid', 1]) {
      await expect(repo.list({ onInvalid: onInvalid as never })).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
      expect(() => repo.stream({ onInvalid: onInvalid as never })).toThrowError(
        expect.objectContaining({ code: 'INVALID_CONFIG' })
      )
      await expect(repo.migrate({ onInvalid: onInvalid as never })).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
    }
  })

  it('list 支持单次 orderBy 覆盖默认顺序并在排序后 limit', async () => {
    const entityEntityPlugin = defineEntityPlugin<IUser>()('entity-repository-spec-ts-entity-15', {
      features: {
        query: entityQueryFeature(),
        unique: entityUniqueFeature(),
        migration: entityMigrationFeature(),
        indexes: entityIndexesFeature(),
        keyset: entityKeysetFeature()
      },
      name: 'ordered-users',
      key: 'id',
      defaultOrderBy: (left, right) => right.name.localeCompare(left.name)
    })
    /** This actual storage host owns the entity installation for this test scope. */
    const entityEntityPluginHost = await entityHost(entityEntityPlugin)

    const repo = entityEntityPluginHost.extensions[entityEntityPlugin.id](await memoryBackend())
    await repo.put({ id: 'a', name: 'Ada', email: 'a@b.c' })
    await repo.put({ id: 'b', name: 'Bob', email: 'b@c.d' })
    await expect(repo.list({ limit: 1 })).resolves.toEqual([
      { id: 'b', name: 'Bob', email: 'b@c.d' }
    ])
    await expect(
      repo.list({ orderBy: (left, right) => left.id.localeCompare(right.id), limit: 2 })
    ).resolves.toEqual([
      { id: 'a', name: 'Ada', email: 'a@b.c' },
      { id: 'b', name: 'Bob', email: 'b@c.d' }
    ])
  })

  it('onInvalid throw 策略让坏记录终止查询', async () => {
    const entityEntityPlugin = defineEntityPlugin<{ id: string; n: number }>()(
      'entity-repository-spec-ts-entity-16',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'strict-users',
        key: 'id',
        schema: {
          name: 'strict',
          validate: async (value: { id: string; n: unknown }) => {
            const typedValue = value
            if (typeof typedValue.n !== 'number') throw new Error('invalid n')
            return typedValue as { id: string; n: number }
          }
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entityEntityPluginHost = await entityHost(entityEntityPlugin)

    const repo = entityEntityPluginHost.extensions[entityEntityPlugin.id](await memoryBackend())
    await repo.put({ id: 'good', n: 1 })
    const rawStore = await memoryBackend()
    await rawStore.putRecord({ version: 1, state: { id: 'bad', n: 'x' } }, ['strict-users', 'bad'])
    const strictRepo = entityEntityPluginHost.extensions[entityEntityPlugin.id](rawStore)
    await expect(strictRepo.get('bad')).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.schema.validate',
      extensionStage: 'schema',
      cause: { cause: { message: 'invalid n' } }
    })
    await expect(strictRepo.list({ onInvalid: 'throw' })).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.schema.validate',
      extensionStage: 'schema',
      cause: { cause: { message: 'invalid n' } }
    })
  })
})

describe('自定义 schema（normalize/encode/decode 全链路）', () => {
  it('schema 扩展 raw throw 统一为 EXTENSION_FAILED', async () => {
    const entityEntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity-17',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'schema-extension-error',
        key: 'id',
        schema: {
          name: 'throws',
          validate: async () => {
            throw new Error('schema failure')
          }
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entityEntityPluginHost = await entityHost(entityEntityPlugin)

    await expect(
      entityEntityPluginHost.extensions[entityEntityPlugin.id](await memoryBackend()).put({
        id: 'x'
      })
    ).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.schema.validate',
      extensionStage: 'schema'
    })

    const rawStore = await memoryBackend()
    await rawStore.putRecord({ version: 1, state: { id: 'x' } }, ['schema-extension-error', 'x'])
    const readRepo = entityEntityPluginHost.extensions[entityEntityPlugin.id](rawStore)
    await expect(readRepo.get('x')).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.schema.validate',
      extensionStage: 'schema'
    })
    await expect(readRepo.list({ onInvalid: 'throw' })).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.schema.validate',
      extensionStage: 'schema'
    })
  })

  it('schema 主动抛 StorageError 时保留 code 并补齐扩展上下文', async () => {
    const entityEntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity-18',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'schema-storage-error-context',
        key: 'id',
        schema: {
          name: 'throws-storage-error',
          validate: async () => {
            throw new StorageError(StorageHostErrorCode.invalidConfig)
          }
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entityEntityPluginHost = await entityHost(entityEntityPlugin)

    const store = await memoryBackend()
    await store.putRecord({ version: 1, state: { id: 'u1' } }, [
      'schema-storage-error-context',
      'u1'
    ])
    await expect(
      entityEntityPluginHost.extensions[entityEntityPlugin.id](store).get('u1')
    ).rejects.toMatchObject({
      code: 'INVALID_CONFIG',
      operation: 'entity.schema.validate',
      extensionStage: 'schema'
    })
  })

  it('读取可关闭 validate，并拒绝畸形 envelope', async () => {
    const uncheckedEntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-unchecked-19',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'unchecked-read',
        key: 'id',
        validateOnRead: false,
        schema: {
          name: 'unchecked',
          validate: async () => {
            throw new Error('must not run on read')
          }
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const uncheckedEntityPluginHost = await entityHost(uncheckedEntityPlugin)

    const store = await memoryBackend()
    await store.putRecord({ version: 1, state: { id: 'ok' } }, ['unchecked-read', 'ok'])
    await expect(
      uncheckedEntityPluginHost.extensions[uncheckedEntityPlugin.id](store).get('ok')
    ).resolves.toEqual({ id: 'ok' })

    const malformed = await memoryBackend()
    await malformed.putRecord({ broken: true }, ['unchecked-read', 'broken'])
    await expect(
      uncheckedEntityPluginHost.extensions[uncheckedEntityPlugin.id](malformed).get('broken')
    ).rejects.toMatchObject({
      code: 'DESERIALIZE_FAILED'
    })
  })

  type IRawUser = { id: string; createdAt: string }
  type IDomainUser = { id: string; createdAt: Date }

  const withSchemaEntityPlugin = defineEntityPlugin<IDomainUser, IRawUser>()(
    'entity-repository-spec-ts-withSchema-20',
    {
      features: {
        query: entityQueryFeature(),
        unique: entityUniqueFeature(),
        migration: entityMigrationFeature(),
        indexes: entityIndexesFeature(),
        keyset: entityKeysetFeature()
      },
      name: 'users-schema',
      key: 'id',
      schema: {
        name: 'test-schema',
        validate: async (value) => value as IDomainUser,
        normalize: async (value) => ({ ...value, id: value.id.toLowerCase() }),
        encode: async (value) => ({ id: value.id, createdAt: value.createdAt.toISOString() }),
        decode: async (stored) => ({ id: stored.id, createdAt: new Date(stored.createdAt) })
      }
    }
  )
  /** Each case owns an entity installation that survives until that case's existing cleanup. */
  let withSchemaEntityPluginHost: IStorageHost<readonly [typeof withSchemaEntityPlugin]>
  beforeEach(async () => {
    withSchemaEntityPluginHost = await entityHost(withSchemaEntityPlugin)
  })

  it('put 经 normalize+encode，get 经 decode，往返值语义一致', async () => {
    const repo = withSchemaEntityPluginHost.extensions[withSchemaEntityPlugin.id](
      await memoryBackend()
    )
    const createdAt = new Date('2024-01-01T00:00:00.000Z')
    await repo.put({ id: 'u1', createdAt })
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', createdAt })
  })

  it('normalize 修改主键时以规范化后的主键写入', async () => {
    const repo = withSchemaEntityPluginHost.extensions[withSchemaEntityPlugin.id](
      await memoryBackend()
    )
    await expect(
      repo.put({ id: 'ABC', createdAt: new Date('2024-01-01T00:00:00.000Z') })
    ).resolves.toBe('abc')
    await expect(repo.get('ABC')).resolves.toBeUndefined()
    await expect(repo.get('abc')).resolves.toEqual({
      id: 'abc',
      createdAt: new Date('2024-01-01T00:00:00.000Z')
    })
  })

  it('list/stream 同样经过 schema.decode', async () => {
    const repo = withSchemaEntityPluginHost.extensions[withSchemaEntityPlugin.id](
      await memoryBackend()
    )
    const createdAt = new Date('2024-01-01T00:00:00.000Z')
    await repo.put({ id: 'u1', createdAt })
    const all = await repo.list()
    expect(all).toEqual([{ id: 'u1', createdAt }])
  })
})

describe('结构化后端上的自定义 repository codec', () => {
  it('codec raw throw 统一为 EXTENSION_FAILED', async () => {
    const entityEntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity-21',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'codec-extension-error',
        key: 'id',
        codec: {
          name: 'throws',
          output: 'structured',
          encode: async () => {
            throw new Error('codec failure')
          },
          decode: async (value) => value
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entityEntityPluginHost = await entityHost(entityEntityPlugin)

    await expect(
      entityEntityPluginHost.extensions[entityEntityPlugin.id](await memoryBackend()).put({
        id: 'x'
      })
    ).rejects.toMatchObject({
      code: 'EXTENSION_FAILED',
      operation: 'entity.codec.encode',
      extensionStage: 'codec'
    })
  })

  it('put/get 都经过显式 codec，而不是绕过 codec 直存 envelope', async () => {
    let encodeCount = 0
    let decodeCount = 0
    const entityEntityPlugin = defineEntityPlugin<{ id: string; value: number }>()(
      'entity-repository-spec-ts-entity-22',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'structured-codec-users',
        key: 'id',
        codec: {
          name: 'counting-structured',
          output: 'structured',
          encode: async (value) => {
            encodeCount += 1
            const envelope = value as { version: number; state: { id: string; value: number } }
            return { ...envelope, state: { ...envelope.state, encoded: true } }
          },
          decode: async (value) => {
            decodeCount += 1
            const envelope = value as {
              version: number
              state: { id: string; value: number; encoded: boolean }
            }
            const stored = envelope.state
            expect(stored.encoded).toBe(true)
            return { ...envelope, state: { id: stored.id, value: stored.value } }
          }
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entityEntityPluginHost = await entityHost(entityEntityPlugin)

    const repo = entityEntityPluginHost.extensions[entityEntityPlugin.id](await memoryBackend())

    await repo.put({ id: 'u1', value: 7 })
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', value: 7 })
    expect(encodeCount).toBe(1)
    expect(decodeCount).toBe(1)
  })
})

describe('list 显式 range', () => {
  it('结构化后端上 list 支持显式 range，且不会逃逸到其他 entity', async () => {
    const store = await memoryBackend()
    const postsEntityPlugin = defineEntityPlugin<{ id: string; title: string }>()(
      'entity-repository-spec-ts-posts-23',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'posts-range',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const postsEntityPluginHost = await entityHost(postsEntityPlugin)

    const rangedUsersEntityPlugin = defineEntityPlugin<IUser>()(
      'entity-repository-spec-ts-rangedUsers-24',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'users-range',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const rangedUsersEntityPluginHost = await entityHost(rangedUsersEntityPlugin)

    const userRepo = rangedUsersEntityPluginHost.extensions[rangedUsersEntityPlugin.id](store)
    const postRepo = postsEntityPluginHost.extensions[postsEntityPlugin.id](store)
    await userRepo.put({ id: 'a', name: 'Ada', email: 'a@b.c' })
    await userRepo.put({ id: 'm', name: 'Mid', email: 'm@b.c' })
    await userRepo.put({ id: 'z', name: 'Zed', email: 'z@b.c' })
    await postRepo.put({ id: 'a', title: 'should not leak' })

    const results = await userRepo.list({ range: { lower: 'b', upper: 'z', upperOpen: true } })
    expect(results.map((u) => u.id).sort()).toEqual(['m'])
  })
})

describe('版本迁移', () => {
  it('读取未来 envelope version 时明确失败', async () => {
    const store = await memoryBackend()
    await store.putRecord({ version: 2, state: { id: 'u1', name: 'Ada' } }, ['future-users', 'u1'])

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity25EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'entity-repository-spec-ts-entity25-25',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'future-users',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity25EntityPluginHost = await entityHost(entity25EntityPlugin)
    const repo = entity25EntityPluginHost.extensions[entity25EntityPlugin.id](store)
    await expect(repo.get('u1')).rejects.toMatchObject({ code: 'VERSION_UNSUPPORTED' })
    await expect(repo.list({ onInvalid: 'skip' })).resolves.toEqual([])
    await expect(repo.list({ onInvalid: 'throw' })).rejects.toMatchObject({
      code: 'VERSION_UNSUPPORTED'
    })
  })

  it('拒绝超出 safe integer 的 envelope version', async () => {
    const store = await memoryBackend()
    await store.putRecord({ version: 1, state: { id: 'u1' } }, ['unsafe-envelope-version', 'u1'])

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity26EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity26-26',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'unsafe-envelope-version',
        key: 'id',
        codec: {
          name: 'unsafe-envelope',
          output: 'structured',
          encode: async (value) => value,
          decode: async () => ({ version: Number.MAX_SAFE_INTEGER + 1, state: { id: 'u1' } })
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity26EntityPluginHost = await entityHost(entity26EntityPlugin)
    const repo = entity26EntityPluginHost.extensions[entity26EntityPlugin.id](store)
    await expect(repo.get('u1')).rejects.toMatchObject({ code: 'DESERIALIZE_FAILED' })
  })

  it('显式 migrate 才持久化新版本并返回统计', async () => {
    const store = await memoryBackend()
    const v1EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'entity-repository-spec-ts-v1-27',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'explicit-migrate',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v1EntityPluginHost = await entityHost(v1EntityPlugin)

    await v1EntityPluginHost.extensions[v1EntityPlugin.id](store).put({ id: 'u1', name: 'Ada' })
    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'entity-repository-spec-ts-v2-28',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'explicit-migrate',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v2EntityPluginHost = await entityHost(v2EntityPlugin)

    await expect(
      v2EntityPluginHost.extensions[v2EntityPlugin.id](store).migrate({ batchSize: 1 })
    ).resolves.toEqual({
      scanned: 1,
      eligible: 1,
      migrated: 1,
      alreadyCurrent: 0,
      skipped: 0,
      conflicted: 0
    })
    await expect(
      store.getRecord(composeRepositoryKey('explicit-migrate', 'u1'))
    ).resolves.toMatchObject({
      version: 2
    })
  })

  it('migrate 不把显式 null batchSize 静默当成默认值', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity29EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity29-29',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'null-batch-size',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity29EntityPluginHost = await entityHost(entity29EntityPlugin)
    const repo = entity29EntityPluginHost.extensions[entity29EntityPlugin.id](await memoryBackend())
    await expect(repo.migrate({ batchSize: null as never })).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
  })

  it('migrate 拒绝超出 safe integer 的 batchSize', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity30EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity30-30',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'unsafe-batch-size',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity30EntityPluginHost = await entityHost(entity30EntityPlugin)
    const repo = entity30EntityPluginHost.extensions[entity30EntityPlugin.id](await memoryBackend())
    await expect(repo.migrate({ batchSize: Number.MAX_SAFE_INTEGER + 1 })).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
  })

  it('migrate 拒绝 null、数组和 primitive options', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity31EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity31-31',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'invalid-migrate-options',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity31EntityPluginHost = await entityHost(entity31EntityPlugin)
    const repo = entity31EntityPluginHost.extensions[entity31EntityPlugin.id](await memoryBackend())
    for (const options of [null, [], 'options', 1])
      await expect(repo.migrate(options as never)).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
  })

  it('migrate 统计被跳过的坏记录', async () => {
    const store = await memoryBackend()
    const entityEntityPlugin = defineEntityPlugin<{ id: string; value: number }>()(
      'entity-repository-spec-ts-entity-32',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'explicit-migrate-invalid',
        key: 'id',
        schema: {
          name: 'strict',
          validate: async (value: { id: string; value: number | string }) => {
            if (typeof value.value !== 'number') throw new Error('invalid value')
            return value as { id: string; value: number }
          }
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entityEntityPluginHost = await entityHost(entityEntityPlugin)

    await store.putRecord({ version: 1, state: { id: 'good', value: 1 } }, [
      'explicit-migrate-invalid',
      'good'
    ])
    await store.putRecord({ version: 1, state: { id: 'bad', value: 'x' } }, [
      'explicit-migrate-invalid',
      'bad'
    ])
    await expect(
      entityEntityPluginHost.extensions[entityEntityPlugin.id](store).migrate()
    ).resolves.toMatchObject({
      scanned: 2,
      eligible: 0,
      migrated: 0,
      alreadyCurrent: 1,
      skipped: 1
    })
  })

  it('migrate 在 optimistic transaction 冲突时统计整批 conflicted', async () => {
    const source = await memoryBackend()
    const v1EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'entity-repository-spec-ts-v1-33',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'explicit-migrate-conflict',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v1EntityPluginHost = await entityHost(v1EntityPlugin)

    await v1EntityPluginHost.extensions[v1EntityPlugin.id](source).put({ id: 'u1', name: 'Ada' })
    const conflictStore = {
      ...source,
      transaction: async () => {
        throw new StorageContractError(StorageContractErrorCode.writeConflict, {
          backend: 'memory'
        })
      }
    }
    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'entity-repository-spec-ts-v2-34',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'explicit-migrate-conflict',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v2EntityPluginHost = await entityHost(v2EntityPlugin)

    await expect(
      v2EntityPluginHost.extensions[v2EntityPlugin.id](conflictStore).migrate({ batchSize: 1 })
    ).resolves.toEqual({
      scanned: 1,
      eligible: 1,
      migrated: 0,
      alreadyCurrent: 0,
      skipped: 0,
      conflicted: 1
    })
  })

  it('migrate 归一化 backend transaction 的裸异常', async () => {
    const source = await memoryBackend()

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity35EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'entity-repository-spec-ts-entity35-35',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'raw-migrate-error',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity35EntityPluginHost = await entityHost(entity35EntityPlugin)
    await entity35EntityPluginHost.extensions[entity35EntityPlugin.id](source).put({
      id: 'u1',
      name: 'Ada'
    })
    const failingStore = {
      ...source,
      transaction: async () => {
        throw new Error('transaction exploded')
      }
    }
    const entityEntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'entity-repository-spec-ts-entity-36',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'raw-migrate-error',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entityEntityPluginHost = await entityHost(entityEntityPlugin)

    await expect(
      entityEntityPluginHost.extensions[entityEntityPlugin.id](failingStore).migrate()
    ).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED',
      cause: { message: 'transaction exploded' }
    })
  })

  it('migrate 批冲突后逐条重试，避免整批跳过', async () => {
    const source = await memoryBackend()
    const v1EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'entity-repository-spec-ts-v1-37',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'retry-migrate',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v1EntityPluginHost = await entityHost(v1EntityPlugin)

    await v1EntityPluginHost.extensions[v1EntityPlugin.id](source).put({ id: 'u1', name: 'Ada' })
    let calls = 0
    const originalTransaction = source.transaction
    type ICurrentScope = Parameters<Parameters<typeof originalTransaction>[0]>[0]
    const retryStore = source
    retryStore.transaction = async <TResult>(
      run: (scope: ICurrentScope) => TResult,
      ctx?: ITransactionOptions
    ): Promise<Awaited<TResult>> => {
      calls += 1
      if (calls === 1)
        throw new StorageContractError(StorageContractErrorCode.writeConflict, {
          backend: 'memory'
        })
      return originalTransaction(run, ctx)
    }
    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'entity-repository-spec-ts-v2-38',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'retry-migrate',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v2EntityPluginHost = await entityHost(v2EntityPlugin)

    await expect(
      v2EntityPluginHost.extensions[v2EntityPlugin.id](retryStore).migrate({ batchSize: 1 })
    ).resolves.toMatchObject({
      eligible: 1,
      migrated: 1,
      conflicted: 0
    })
  })

  it('migrate 冲突重试发现并发方已迁移时不虚报 migrated', async () => {
    const source = await memoryBackend()
    const v1EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'entity-repository-spec-ts-v1-39',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'retry-current',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v1EntityPluginHost = await entityHost(v1EntityPlugin)

    await v1EntityPluginHost.extensions[v1EntityPlugin.id](source).put({ id: 'u1', name: 'Ada' })
    let first = true
    const originalTransaction = source.transaction
    type ICurrentScope = Parameters<Parameters<typeof originalTransaction>[0]>[0]
    const retryStore = source
    retryStore.transaction = async <TResult>(
      run: (scope: ICurrentScope) => TResult,
      ctx?: ITransactionOptions
    ): Promise<Awaited<TResult>> => {
      if (first) {
        first = false
        await originalTransaction(async (tx) => {
          await tx.putRecord(
            { version: 2, state: { id: 'u1', displayName: 'Ada' } },
            composeRepositoryKey('retry-current', 'u1')
          )
          await tx.deleteRecord(['retry-current', 'u1'])
        }, ctx)
        throw new StorageContractError(StorageContractErrorCode.writeConflict, {
          backend: 'memory'
        })
      }
      return originalTransaction(run, ctx)
    }
    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'entity-repository-spec-ts-v2-40',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'retry-current',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v2EntityPluginHost = await entityHost(v2EntityPlugin)

    await expect(
      v2EntityPluginHost.extensions[v2EntityPlugin.id](retryStore).migrate({ batchSize: 1 })
    ).resolves.toMatchObject({
      migrated: 0,
      alreadyCurrent: 1,
      conflicted: 0
    })
  })

  it('迁移读取不触发隐式写回', async () => {
    const diagnosed: string[] = []
    const inner = await memoryBackend()
    const v1EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'entity-repository-spec-ts-v1-41',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'people2',
        key: 'id',
        version: 1
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v1EntityPluginHost = await entityHost(v1EntityPlugin)

    await v1EntityPluginHost.extensions[v1EntityPlugin.id](inner).put({ id: 'u1', name: 'Ada' })

    // 读正常、写失败的包装 store：用 putCalls 证明读取路径没有尝试隐式写回。
    let putCalls = 0
    const flakyStore = {
      ...inner,
      putRecord: async () => {
        putCalls += 1
        throw new Error('write-back boom')
      }
    }

    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'entity-repository-spec-ts-v2-42',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'people2',
        key: 'id',
        version: 2,
        migrations: { 2: async (prev: any) => ({ id: prev.id, displayName: prev.name }) },
        onDiagnostic: (message) => diagnosed.push(message)
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v2EntityPluginHost = await entityHost(v2EntityPlugin)

    const repo = v2EntityPluginHost.extensions[v2EntityPlugin.id](flakyStore)
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', displayName: 'Ada' })
    expect(putCalls).toBe(0)
    expect(diagnosed).toHaveLength(0)
  })

  it('迁移读取不触发非 Error 写回异常', async () => {
    const diagnosed: string[] = []
    const inner = await memoryBackend()
    const v1EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'entity-repository-spec-ts-v1-43',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'people3',
        key: 'id',
        version: 1
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v1EntityPluginHost = await entityHost(v1EntityPlugin)

    await v1EntityPluginHost.extensions[v1EntityPlugin.id](inner).put({ id: 'u1', name: 'Ada' })

    const flakyStore = {
      ...inner,
      putRecord: async () => {
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'boom-string-cause'
      }
    }

    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'entity-repository-spec-ts-v2-44',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'people3',
        key: 'id',
        version: 2,
        migrations: { 2: async (prev: any) => ({ id: prev.id, displayName: prev.name }) },
        onDiagnostic: (message) => diagnosed.push(message)
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v2EntityPluginHost = await entityHost(v2EntityPlugin)

    const repo = v2EntityPluginHost.extensions[v2EntityPlugin.id](flakyStore)
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', displayName: 'Ada' })
    expect(diagnosed).toHaveLength(0)
  })

  it('batch 作用域内 get 读到旧版本记录时触发迁移，但事务内不写回（writeBackTarget 为 undefined）', async () => {
    const store = await memoryBackend()
    const v1EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'entity-repository-spec-ts-v1-45',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'people4',
        key: 'id',
        version: 1
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v1EntityPluginHost = await entityHost(v1EntityPlugin)

    await v1EntityPluginHost.extensions[v1EntityPlugin.id](store).put({ id: 'u1', name: 'Ada' })

    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'entity-repository-spec-ts-v2-46',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'people4',
        key: 'id',
        version: 2,
        migrations: { 2: async (prev: any) => ({ id: prev.id, displayName: prev.name }) }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const v2EntityPluginHost = await entityHost(v2EntityPlugin)

    const repo = v2EntityPluginHost.extensions[v2EntityPlugin.id](store)
    /** Normal and authentic transaction reads recover exactly the same persisted envelope. */
    const normal = await repo.get('u1')
    let seen: { id: string; displayName: string } | undefined
    await repo.batch(async (tx) => {
      seen = await tx.get('u1')
    })
    expect(seen).toEqual(normal)
    expect(seen).toEqual({ id: 'u1', displayName: 'Ada' })
    expect(await store.getRecord(composeRepositoryKey('people4', 'u1'))).toEqual({
      version: 1,
      state: { id: 'u1', name: 'Ada' }
    })
  })
})

describe('batch', () => {
  it('batch 拒绝非函数 callback', async () => {
    /** This actual storage host owns the entity installation for this test scope. */
    const usersEntityPluginHost = await entityHost(usersEntityPlugin)

    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await memoryBackend())
    for (const callback of [null, undefined, {}, 'run'])
      await expect(repo.batch(callback as never)).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
  })

  it('结构化后端上 batch 成功后所有写入持久化', async () => {
    /** This actual storage host owns the entity installation for this test scope. */
    const usersEntityPluginHost = await entityHost(usersEntityPlugin)

    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await memoryBackend())
    await repo.batch(async (tx) => {
      await tx.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await tx.put({ id: 'u2', name: 'Bob', email: 'b@c.d' })
    })
    await expect(repo.get('u1')).resolves.toBeDefined()
    await expect(repo.get('u2')).resolves.toBeDefined()
  })

  it('batch put 使用 normalize 后的主键', async () => {
    const batchEntityEntityPlugin = defineEntityPlugin<{ id: string; createdAt: Date }>()(
      'entity-repository-spec-ts-batchEntity-47',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'batch-normalized',
        key: 'id',
        schema: {
          name: 'batch-normalized-schema',
          validate: async (value) => value as { id: string; createdAt: Date },
          normalize: async (value) => ({ ...value, id: value.id.toLowerCase() })
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const batchEntityEntityPluginHost = await entityHost(batchEntityEntityPlugin)

    const repo = batchEntityEntityPluginHost.extensions[batchEntityEntityPlugin.id](
      await memoryBackend()
    )
    await repo.batch(async (tx) => {
      await expect(
        tx.put({ id: 'BATCH-ABC', createdAt: new Date('2024-01-01T00:00:00.000Z') })
      ).resolves.toBe('batch-abc')
    })
    await expect(repo.get('BATCH-ABC')).resolves.toBeUndefined()
    await expect(repo.get('batch-abc')).resolves.toBeDefined()
  })

  it('结构化后端上 batch 内抛错时整批回滚', async () => {
    /** This actual storage host owns the entity installation for this test scope. */
    const usersEntityPluginHost = await entityHost(usersEntityPlugin)

    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await memoryBackend())
    await repo.put({ id: 'existing', name: 'Old', email: 'old@x.y' })
    /** The actual callback error must remain reachable through the transaction boundary. */
    const original = new Error('boom')
    const failure = await repo
      .batch(async (tx) => {
        await tx.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
        await tx.remove('existing')
        throw original
      })
      .catch((cause) => cause)
    expect(failure).toMatchObject({ code: 'TRANSACTION_FAILED' })
    expect(walkErrorCauses(failure)).toContain(original)
    await expect(repo.get('u1')).resolves.toBeUndefined()
    await expect(repo.get('existing')).resolves.toEqual({
      id: 'existing',
      name: 'Old',
      email: 'old@x.y'
    })
  })

  it('batch 作用域内 get 可读取快照内已写入的值', async () => {
    /** This actual storage host owns the entity installation for this test scope. */
    const usersEntityPluginHost = await entityHost(usersEntityPlugin)

    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](await memoryBackend())
    await repo.batch(async (tx) => {
      await tx.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await expect(tx.get('u1')).resolves.toEqual({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await expect(tx.get('missing')).resolves.toBeUndefined()
    })
  })
})

describe('entity key and invalid-record boundaries', () => {
  it('accepts supported key domains and rejects invalid keys', async () => {
    const entityEntityPlugin = defineEntityPlugin<{ id: IStorageKey; value: string }>()(
      'entity-repository-spec-ts-entity-48',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'key-domains',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entityEntityPluginHost = await entityHost(entityEntityPlugin)

    const repo = entityEntityPluginHost.extensions[entityEntityPlugin.id](await memoryBackend())
    for (const id of [
      1,
      new Date('2024-01-01T00:00:00Z'),
      new Uint8Array([1]).buffer,
      ['tenant', ['user']]
    ] as IStorageKey[]) {
      await repo.put({ id, value: 'ok' })
      await expect(repo.get(id)).resolves.toMatchObject({ value: 'ok' })
    }
    for (const id of [true, NaN, new Date('invalid'), { id: 'bad' }] as unknown[]) {
      await expect(repo.put({ id, value: 'bad' } as never)).rejects.toMatchObject({
        code: 'INVALID_KEY'
      })
    }
  })

  it('batch() 内的 tx.get()/tx.remove() 对非法 key 报的错误码要跟顶层 get()/remove() 一致', async () => {
    // 顶层 get()/remove() 在进入 key composition 前先 assertStorageKey；batch() 作用域内的
    // scope.get/scope.remove 曾经跳过这一步，让同一个非法输入在 batch 里被误分类成
    // TRANSACTION_FAILED（暗示"可重试"）而不是 INVALID_KEY（永久性、重试无意义）。

    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity49EntityPlugin = defineEntityPlugin<{ id: IStorageKey; value: string }>()(
      'entity-repository-spec-ts-entity49-49',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'batch-key-guard',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity49EntityPluginHost = await entityHost(entity49EntityPlugin)
    const repo = entity49EntityPluginHost.extensions[entity49EntityPlugin.id](await memoryBackend())
    for (const id of [true, {}, 42n] as unknown[]) {
      await expect(repo.batch((tx) => tx.get(id as IStorageKey))).rejects.toMatchObject({
        code: 'INVALID_KEY'
      })
      await expect(repo.batch((tx) => tx.remove(id as IStorageKey))).rejects.toMatchObject({
        code: 'INVALID_KEY'
      })
    }
  })

  it('rejects invalid list limits before reading', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity50EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity50-50',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'limit-guard',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity50EntityPluginHost = await entityHost(entity50EntityPlugin)
    const repo = entity50EntityPluginHost.extensions[entity50EntityPlugin.id](await memoryBackend())
    for (const limit of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      await expect(repo.list({ limit })).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(repo.list({ limit: 0 })).resolves.toEqual([])
  })

  it('list 与 stream apply the same range and invalid-record policy', async () => {
    /** Explicit entity plugin configuration is installed before requesting a repository. */
    const entity51EntityPlugin = defineEntityPlugin<{ id: string }>()(
      'entity-repository-spec-ts-entity51-51',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'list-options',
        key: 'id'
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entity51EntityPluginHost = await entityHost(entity51EntityPlugin)
    const repo = entity51EntityPluginHost.extensions[entity51EntityPlugin.id](await memoryBackend())
    await repo.put({ id: 'a' })
    const options = { range: { lower: 'a', upper: 'z' }, limit: 1, onInvalid: 'throw' as const }
    await expect(repo.list(options)).resolves.toEqual([{ id: 'a' }])
    const values: Array<{ id: string }> = []
    for await (const value of repo.stream(options)) values.push(value)
    expect(values).toEqual([{ id: 'a' }])
  })

  it('onInvalid.stage 区分 decode 与 validate', async () => {
    const store = await memoryBackend()
    const decodeEntityEntityPlugin = defineEntityPlugin<{ id: string; n: number }>()(
      'entity-repository-spec-ts-decodeEntity-52',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'stage-users',
        key: 'id',
        codec: {
          name: 'throws-decode',
          output: 'structured',
          encode: async (value) => value,
          decode: async () => {
            throw new Error('decode failure')
          }
        },
        schema: {
          name: 'stage-schema',
          validate: async (value) => value as { id: string; n: number }
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const decodeEntityEntityPluginHost = await entityHost(decodeEntityEntityPlugin)

    await store.putRecord({ version: 1, state: { id: 'bad', n: 1 } }, ['stage-users', 'bad'])
    const stages: string[] = []
    await decodeEntityEntityPluginHost.extensions[decodeEntityEntityPlugin.id](store).list({
      onInvalid: (issue) => {
        stages.push(issue.stage)
        return 'skip'
      }
    })
    expect(stages).toEqual(['decode'])
  })

  it('rejects an invalid onInvalid policy or handler result', async () => {
    const store = await memoryBackend()
    const entityEntityPlugin = defineEntityPlugin<{ id: string; n: number }>()(
      'entity-repository-spec-ts-entity-53',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'invalid-policy-users',
        key: 'id',
        codec: {
          name: 'invalid-policy-codec',
          output: 'structured',
          encode: async (value) => value,
          decode: async () => ({ invalid: true })
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entityEntityPluginHost = await entityHost(entityEntityPlugin)

    await store.putRecord({ version: 1, state: { id: 'bad', n: 1 } }, [
      'invalid-policy-users',
      'bad'
    ])
    await expect(
      entityEntityPluginHost.extensions[entityEntityPlugin.id](store).list({
        onInvalid: 'invalid' as never
      })
    ).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
    await expect(
      entityEntityPluginHost.extensions[entityEntityPlugin.id](store).list({
        onInvalid: () => 'invalid' as never
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })

  it('onInvalid.stage 区分 migration failure', async () => {
    const store = await memoryBackend()
    const entityEntityPlugin = defineEntityPlugin<{ id: string; n: number }>()(
      'entity-repository-spec-ts-entity-54',
      {
        features: {
          query: entityQueryFeature(),
          unique: entityUniqueFeature(),
          migration: entityMigrationFeature(),
          indexes: entityIndexesFeature(),
          keyset: entityKeysetFeature()
        },
        name: 'migration-stage-users',
        key: 'id',
        version: 2,
        migrations: {
          2: async () => {
            throw new Error('migration failure')
          }
        },
        schema: {
          name: 'migration-stage',
          validate: async (value) => value as { id: string; n: number }
        }
      }
    )
    /** This actual storage host owns the entity installation for this test scope. */
    const entityEntityPluginHost = await entityHost(entityEntityPlugin)

    await store.putRecord({ version: 1, state: { id: 'bad', n: 1 } }, [
      'migration-stage-users',
      'bad'
    ])
    const stages: string[] = []
    await entityEntityPluginHost.extensions[entityEntityPlugin.id](store).list({
      onInvalid: (issue) => {
        stages.push(issue.stage)
        return 'skip'
      }
    })
    expect(stages).toEqual(['migrate'])
  })
})
