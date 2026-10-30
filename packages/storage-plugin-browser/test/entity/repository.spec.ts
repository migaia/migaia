import { entityTestFeatures } from '../helpers/entity-features.ts'
import { describe, expect, it } from 'vitest'
import { defineEntityPlugin } from '@migaia/storage-host/entity'
import { createLocalTestStore } from '../helpers/installed-backends.ts'
import { fakeWebStorage } from '../../src/testing/fake-web-storage.ts'
import type { IStorageKey } from '@migaia/storage-contract'

/**
 * The original local value-only matrix keeps the same domain and query semantics after the owner
 * move.
 */
type IUser = { id: string; name: string; email: string }

/** Explicit native declaration owns this scenario's optional repository capabilities. */
const usersEntityPlugin = defineEntityPlugin<IUser>()('repository-spec-ts-14', {
  features: entityTestFeatures,
  name: 'users',
  key: 'id'
})

const backends = [
  {
    label: 'localStorageHost (KV-only)',
    create: () =>
      createLocalTestStore({ namespace: 'entity-test', storage: fakeWebStorage() }, true)
  }
] as const

for (const { label, create } of backends) {
  describe(`repository over ${label}`, () => {
    it('put 后 get 返回同值', async () => {
      const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
        await create()
      /** Install once on the real fixture host and retain exact extension inference. */
      const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
      /** Borrow the supplied backend through the installed repository capability factories. */
      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
        usersEntityPluginBackendStore
      )
      await repo.put({ id: 'u1', name: 'Ada', email: 'ada@example.com' })
      await expect(repo.get('u1')).resolves.toEqual({
        id: 'u1',
        name: 'Ada',
        email: 'ada@example.com'
      })
    })

    it('put 返回 id', async () => {
      const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
        await create()
      /** Install once on the real fixture host and retain exact extension inference. */
      const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
      /** Borrow the supplied backend through the installed repository capability factories. */
      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
        usersEntityPluginBackendStore
      )
      await expect(repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })).resolves.toBe('u1')
    })

    it('get 未写入的 id 返回 undefined', async () => {
      const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
        await create()
      /** Install once on the real fixture host and retain exact extension inference. */
      const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
      /** Borrow the supplied backend through the installed repository capability factories. */
      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
        usersEntityPluginBackendStore
      )
      await expect(repo.get('missing')).resolves.toBeUndefined()
    })

    it('put 缺少 key 属性时抛稳定 StorageError', async () => {
      const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
        await create()
      /** Install once on the real fixture host and retain exact extension inference. */
      const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
      /** Borrow the supplied backend through the installed repository capability factories. */
      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
        usersEntityPluginBackendStore
      )
      await expect(repo.put({ name: 'Ada' } as unknown as IUser)).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
    })

    it('remove 后 get 返回 undefined', async () => {
      const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
        await create()
      /** Install once on the real fixture host and retain exact extension inference. */
      const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
      /** Borrow the supplied backend through the installed repository capability factories. */
      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
        usersEntityPluginBackendStore
      )
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await repo.remove('u1')
      await expect(repo.get('u1')).resolves.toBeUndefined()
    })

    it('list 返回全部记录', async () => {
      const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
        await create()
      /** Install once on the real fixture host and retain exact extension inference. */
      const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
      /** Borrow the supplied backend through the installed repository capability factories. */
      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
        usersEntityPluginBackendStore
      )
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await repo.put({ id: 'u2', name: 'Bob', email: 'b@c.d' })
      const all = await repo.list()
      expect(all).toHaveLength(2)
      expect(all.map((u) => u.id).sort()).toEqual(['u1', 'u2'])
    })

    it('list 支持 limit', async () => {
      const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
        await create()
      /** Install once on the real fixture host and retain exact extension inference. */
      const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
      /** Borrow the supplied backend through the installed repository capability factories. */
      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
        usersEntityPluginBackendStore
      )
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await repo.put({ id: 'u2', name: 'Bob', email: 'b@c.d' })
      await repo.put({ id: 'u3', name: 'Cy', email: 'c@d.e' })
      const limited = await repo.list({ limit: 2 })
      expect(limited).toHaveLength(2)
    })

    it('stream 接受查询 options 并在流式路径应用 limit', async () => {
      const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
        await create()
      /** Install once on the real fixture host and retain exact extension inference. */
      const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
      /** Borrow the supplied backend through the installed repository capability factories. */
      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
        usersEntityPluginBackendStore
      )
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await repo.put({ id: 'u2', name: 'Bob', email: 'b@c.d' })
      const streamed: IUser[] = []
      for await (const user of repo.stream({ limit: 1 })) streamed.push(user)
      expect(streamed).toHaveLength(1)
    })

    it('stream 应用 orderBy 后再应用 limit', async () => {
      const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
        await create()
      /** Install once on the real fixture host and retain exact extension inference. */
      const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
      /** Borrow the supplied backend through the installed repository capability factories. */
      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
        usersEntityPluginBackendStore
      )
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
      const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
        await create()
      /** Install once on the real fixture host and retain exact extension inference. */
      const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
      /** Borrow the supplied backend through the installed repository capability factories. */
      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
        usersEntityPluginBackendStore
      )
      await repo.put({ id: 'c', name: 'C', email: 'c@d.e' })
      await repo.put({ id: 'a', name: 'A', email: 'a@b.c' })
      await repo.put({ id: 'b', name: 'B', email: 'b@c.d' })
      await expect(
        repo.list({ range: { lower: 'a', upper: 'c', upperOpen: true }, limit: 1 })
      ).resolves.toEqual([{ id: 'a', name: 'A', email: 'a@b.c' }])
    })

    it('stream 逐条产出全部记录', async () => {
      const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
        await create()
      /** Install once on the real fixture host and retain exact extension inference. */
      const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
      /** Borrow the supplied backend through the installed repository capability factories. */
      const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
        usersEntityPluginBackendStore
      )
      await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
      await repo.put({ id: 'u2', name: 'Bob', email: 'b@c.d' })
      const seen: string[] = []
      for await (const user of repo.stream()) seen.push(user.id)
      expect(seen.sort()).toEqual(['u1', 'u2'])
    })

    it('list/stream 不会读到其他 entity 的记录', async () => {
      const { host: storeHost, store } = await create()
      /** Explicit native declaration owns this scenario's optional repository capabilities. */
      const postsEntityPlugin = defineEntityPlugin<{ id: string; title: string }>()(
        'repository-spec-ts-120',
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
      await userRepo.put({ id: 'shared-id', name: 'Ada', email: 'a@b.c' })
      await postRepo.put({ id: 'shared-id', title: 'Hello' })
      await expect(userRepo.list()).resolves.toEqual([
        { id: 'shared-id', name: 'Ada', email: 'a@b.c' }
      ])
      await expect(postRepo.list()).resolves.toEqual([{ id: 'shared-id', title: 'Hello' }])
    })
  })
}

describe('value-only entity repository', () => {
  it('KV-only list/stream 触发一次 diagnostic 告警', async () => {
    const diagnosed: string[] = []
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const diagnosedEntityPlugin = defineEntityPlugin<IUser>()('repository-spec-ts-140', {
      features: entityTestFeatures,
      name: 'users-diag',
      key: 'id',
      onDiagnostic: (message) => diagnosed.push(message)
    })
    const { host: diagnosedEntityPluginBackendHost, store: diagnosedEntityPluginBackendStore } =
      await createLocalTestStore({ namespace: 'diag-test', storage: fakeWebStorage() }, true)
    const diagnosedEntityPluginHost =
      await diagnosedEntityPluginBackendHost.use(diagnosedEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = diagnosedEntityPluginHost.extensions[diagnosedEntityPlugin.id](
      diagnosedEntityPluginBackendStore
    )
    await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
    await repo.list()
    expect(diagnosed).toHaveLength(1)
    expect(diagnosed[0]).toContain('full key scan')
  })

  it('KV-only diagnostic 抛错不阻断 list', async () => {
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entityEntityPlugin = defineEntityPlugin<IUser>()('repository-spec-ts-156', {
      features: entityTestFeatures,
      name: 'users-diag-throw',
      key: 'id',
      onDiagnostic: () => {
        throw new Error('diagnostic sink failed')
      }
    })
    const { host: entityEntityPluginBackendHost, store: entityEntityPluginBackendStore } =
      await createLocalTestStore({ namespace: 'diag-throw-test', storage: fakeWebStorage() }, true)
    /** Install once on the real fixture host and retain exact extension inference. */
    const entityEntityPluginHost = await entityEntityPluginBackendHost.use(entityEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = entityEntityPluginHost.extensions[entityEntityPlugin.id](
      entityEntityPluginBackendStore
    )
    await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
    await expect(repo.list()).resolves.toEqual([{ id: 'u1', name: 'Ada', email: 'a@b.c' }])
  })

  it('KV-only repository supports list, stream limit, put and remove', async () => {
    const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
      await createLocalTestStore({ namespace: 'kv-only-extra', storage: fakeWebStorage() }, true)
    /** Install once on the real fixture host and retain exact extension inference. */
    const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
      usersEntityPluginBackendStore
    )
    await repo.put({ id: 'a', name: 'Ada', email: 'a@example.com' })
    await repo.put({ id: 'b', name: 'Bob', email: 'b@example.com' })
    await expect(
      repo.list({ orderBy: (left, right) => right.id.localeCompare(left.id), limit: 1 })
    ).resolves.toEqual([{ id: 'b', name: 'Bob', email: 'b@example.com' }])
    const streamed: IUser[] = []
    for await (const value of repo.stream({ limit: 1 })) streamed.push(value)
    expect(streamed).toHaveLength(1)
    await repo.remove('a')
    await expect(repo.get('a')).resolves.toBeUndefined()
  })

  it('KV-only 后端上读取旧版本记录时执行迁移但不隐式写回', async () => {
    const { host: storeHost, store } = await createLocalTestStore(
      {
        namespace: 'migrate-test',
        storage: fakeWebStorage()
      },
      true
    )
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const v1EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-spec-ts-192',
      {
        features: entityTestFeatures,
        name: 'people',
        key: 'id',
        version: 1
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const v1EntityPluginHost = await storeHost.use(v1EntityPlugin)
    await v1EntityPluginHost.extensions[v1EntityPlugin.id](store).put({ id: 'u1', name: 'Ada' })

    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'repository-spec-ts-200',
      {
        features: entityTestFeatures,
        name: 'people',
        key: 'id',
        version: 2,
        migrations: { 2: async (prev: any) => ({ id: prev.id, displayName: prev.name }) }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const v2EntityPluginHost = await storeHost.use(v2EntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = v2EntityPluginHost.extensions[v2EntityPlugin.id](store)
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', displayName: 'Ada' })
  })

  it('KV-only migrate 按批次写回新版本', async () => {
    const { host: storeHost, store } = await createLocalTestStore(
      { namespace: 'kv-migrate', storage: fakeWebStorage() },
      true
    )
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entity1EntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-spec-ts-213',
      {
        features: entityTestFeatures,
        name: 'kv-people',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const entity1EntityPluginHost = await storeHost.use(entity1EntityPlugin)
    await entity1EntityPluginHost.extensions[entity1EntityPlugin.id](store).put({
      id: 'u1',
      name: 'Ada'
    })
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const v2EntityPlugin = defineEntityPlugin<{ id: string; displayName: string }>()(
      'repository-spec-ts-220',
      {
        features: entityTestFeatures,
        name: 'kv-people',
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
      eligible: 1,
      migrated: 1
    })
  })

  it('KV-only migrate 正确区分当前记录与坏记录', async () => {
    const { host: storeHost, store } = await createLocalTestStore(
      {
        namespace: 'kv-migrate-stats',
        storage: fakeWebStorage()
      },
      true
    )
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const currentEntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-spec-ts-238',
      {
        features: entityTestFeatures,
        name: 'kv-migrate-stats',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: unknown) => value }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const currentEntityPluginHost = await storeHost.use(currentEntityPlugin)
    await currentEntityPluginHost.extensions[currentEntityPlugin.id](store).put({
      id: 'current',
      name: 'Current'
    })

    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const legacyEntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-spec-ts-247',
      {
        features: entityTestFeatures,
        name: 'kv-migrate-stats',
        key: 'id'
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const legacyEntityPluginHost = await storeHost.use(legacyEntityPlugin)
    await legacyEntityPluginHost.extensions[legacyEntityPlugin.id](store).put({
      id: 'legacy',
      name: 'Legacy'
    })
    await store.set(
      String(currentEntityPluginHost.extensions[currentEntityPlugin.id](store).lockKey('bad').key),
      '{broken-json'
    )

    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const migratedEntityPlugin = defineEntityPlugin<{ id: string; name: string }>()(
      'repository-spec-ts-255',
      {
        features: entityTestFeatures,
        name: 'kv-migrate-stats',
        key: 'id',
        version: 2,
        migrations: { 2: async (value: unknown) => value }
      }
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const migratedEntityPluginHost = await storeHost.use(migratedEntityPlugin)
    await expect(
      migratedEntityPluginHost.extensions[migratedEntityPlugin.id](store).migrate({ batchSize: 1 })
    ).resolves.toEqual({
      scanned: 3,
      eligible: 1,
      migrated: 1,
      alreadyCurrent: 1,
      skipped: 1,
      conflicted: 0
    })
    await expect(
      migratedEntityPluginHost.extensions[migratedEntityPlugin.id](store).get('legacy')
    ).resolves.toEqual({
      id: 'legacy',
      name: 'Legacy'
    })
  })

  it('KV-only 后端上 batch 抛 UNSUPPORTED_CAPABILITY', async () => {
    const { host: usersEntityPluginBackendHost, store: usersEntityPluginBackendStore } =
      await createLocalTestStore({ namespace: 'batch-test', storage: fakeWebStorage() }, true)
    /** Install once on the real fixture host and retain exact extension inference. */
    const usersEntityPluginHost = await usersEntityPluginBackendHost.use(usersEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = usersEntityPluginHost.extensions[usersEntityPlugin.id](
      usersEntityPluginBackendStore
    )
    await expect(repo.batch(async () => {})).rejects.toMatchObject({
      code: 'UNSUPPORTED_CAPABILITY'
    })
  })

  it('handler can skip an invalid KV record and reports its decoded key', async () => {
    /** Explicit native declaration owns this scenario's optional repository capabilities. */
    const entityEntityPlugin = defineEntityPlugin<{ id: string; n: number }>()(
      'repository-spec-ts-286',
      {
        features: entityTestFeatures,
        name: 'handler-users',
        key: 'id',
        schema: {
          name: 'handler',
          validate: async (value) => {
            if (typeof (value as { n: unknown }).n !== 'number') throw new Error('bad')
            return value as { id: string; n: number }
          }
        }
      }
    )
    const { host: storeHost, store } = await createLocalTestStore(
      {
        namespace: 'handler-users',
        storage: fakeWebStorage()
      },
      true
    )
    /** Install once on the real fixture host and retain exact extension inference. */
    const entityEntityPluginHost = await storeHost.use(entityEntityPlugin)
    /** Borrow the supplied backend through the installed repository capability factories. */
    const repo = entityEntityPluginHost.extensions[entityEntityPlugin.id](store)
    await repo.put({ id: 'good', n: 1 })
    await store.set(
      String(repo.lockKey('bad').key),
      JSON.stringify({ version: 1, state: { id: 'bad', n: 'x' } })
    )
    const issues: IStorageKey[] = []
    await expect(
      repo.list({
        onInvalid: (issue) => {
          issues.push(issue.key)
          return 'skip'
        }
      })
    ).resolves.toHaveLength(1)
    expect(issues).toEqual(['bad'])
  })
})
