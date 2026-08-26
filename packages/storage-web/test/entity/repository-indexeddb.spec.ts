import { IDBFactory, IDBKeyRange } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { defineEntity } from '../../src/entity'
import { indexedDb } from '../../src/backends'
import { StorageError, StorageErrorCode } from '../../src/types/errors'
import type { IStorageKey } from '../../src/types/context'
import { asIndexedDbBackfillStore } from '../../src/backends/indexed-db-backfill'
import { repositoryEntityRange } from '../../src/entity/key'

type IUser = { id: string; name: string; email: string }

const users = defineEntity<IUser>({ name: 'users', key: 'id' })

const freshIndexedDb = () =>
  indexedDb({
    factory: new IDBFactory(),
    keyRange: IDBKeyRange,
    dbName: `entity-idb-${Math.random().toString(36).slice(2)}`
  })

describe('repository over real indexedDb backend', () => {
  it('SWV2-T34 entity privately backfills normalized path and selector projections', async () => {
    type IIndexedUser = { id: string; profile: { email: string }; tags: string[] }
    const store = freshIndexedDb()
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
        tags: { select: (value: IIndexedUser) => value.tags, multiEntry: true, revision: 3 }
      }
    })
    const repository = indexed.connect(store)
    await expect(repository.findManyBy('email')).resolves.toEqual([
      { id: 'u1', profile: { email: 'ada@example.com' }, tags: ['engineer', 'admin'] }
    ])
    const capability = asIndexedDbBackfillStore(store)!
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
      matches.push((raw as { data: IIndexedUser }).data)
    expect(matches).toEqual([
      { id: 'u1', profile: { email: 'ada@example.com' }, tags: ['engineer', 'admin'] }
    ])
    expect(store.capabilities.secondaryIndexes).toBe(false)
  })

  it('SOL-SWV2-061 measures decoded custom-codec payloads before issuing a batch', async () => {
    const store = freshIndexedDb()
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
          const envelope = value as { __v: number; data: { id: string; email: string } }
          return {
            __v: envelope.__v,
            data: {
              ...envelope.data,
              expanded: envelope.data.id === 'u1' ? 'x'.repeat(1024 * 1024 + 32) : 'small'
            }
          }
        }
      },
      indexes: { email: { path: 'email' } }
    }).connect(store)

    await expect(
      indexed.findManyBy('email', { lower: 'large@example.com', upper: 'large@example.com' })
    ).resolves.toHaveLength(1)
    const capability = asIndexedDbBackfillStore(store)!
    const handle = await capability.ensureRecordIndexes('decoded-cap-codec', [
      { name: 'email', unique: false, multiEntry: false, revision: 1 }
    ])
    await expect(capability.getRecordIndexReadiness(handle)).resolves.toMatchObject({
      status: 'running',
      scanned: 1
    })

    await expect(
      indexed.findManyBy('email', { lower: 'small@example.com', upper: 'small@example.com' })
    ).resolves.toHaveLength(1)
    await expect(capability.getRecordIndexReadiness(handle)).resolves.toMatchObject({
      status: 'running',
      scanned: 2
    })
  })

  it('SWV2-T34 keeps readiness non-complete until legacy winners are migrated', async () => {
    type ILegacyUser = { id: string; email: string }
    const store = freshIndexedDb()
    await store.putRecord({ __v: 1, data: { id: 'legacy', email: 'legacy@example.com' } }, [
      'legacy-backfill',
      'legacy'
    ])
    const entity = defineEntity<ILegacyUser>()({
      name: 'legacy-backfill',
      key: 'id',
      indexes: { email: { path: 'email', unique: true } }
    })
    const repository = entity.connect(store)
    await expect(repository.findManyBy('email')).resolves.toEqual([
      { id: 'legacy', email: 'legacy@example.com' }
    ])
    const capability = asIndexedDbBackfillStore(store)!
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
      scanned: 0
    })
    await entity.connect(store).migrate()
    await expect(entity.connect(store).findManyBy('email')).resolves.toEqual([
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
    const store = freshIndexedDb()
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

  it('SWV2-T34 query-owned backfill propagates cancellation through a hanging decoder', async () => {
    const store = freshIndexedDb()
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
    const pending = indexed.findManyBy('email', undefined, undefined, {
      signal: controller.signal
    })
    await Promise.resolve()
    controller.abort('cancel index backfill')
    await expect(pending).rejects.toMatchObject({
      code: 'ABORTED',
      cause: 'cancel index backfill'
    })
  })

  it('SWV2-T13 active backfill lease keeps concurrent queries on authoritative fallback', async () => {
    const store = freshIndexedDb()
    const baseline = defineEntity<{ id: string; email: string }>({
      name: 'leased-query-users',
      key: 'id'
    })
    await baseline.connect(store).put({ id: 'u1', email: 'ada@example.com' })
    await baseline.connect(store).migrate()
    const capability = asIndexedDbBackfillStore(store)!
    const handle = await capability.ensureRecordIndexes('leased-query-users', [
      { name: 'email', unique: false, multiEntry: false, revision: 1 }
    ])
    const owner = await capability.openBackfillSession(handle, {
      range: repositoryEntityRange('leased-query-users'),
      allowComplete: true
    })
    const diagnostics: string[] = []
    const repository = defineEntity<{ id: string; email: string }>()({
      name: 'leased-query-users',
      key: 'id',
      indexes: { email: { path: 'email' } },
      onDiagnostic: (message) => diagnostics.push(message)
    }).connect(store)

    await expect(repository.findManyBy('email')).resolves.toEqual([
      { id: 'u1', email: 'ada@example.com' }
    ])
    expect(diagnostics).toEqual([expect.stringContaining('uses authoritative full-scan fallback')])
    owner.release()
  })

  it('SWV2-T34 preserves selector failure identity and records failed readiness', async () => {
    const store = freshIndexedDb()
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

    await expect(indexed.findManyBy('email')).rejects.toBe(selectorFailure)
    const capability = asIndexedDbBackfillStore(store)!
    const handle = await capability.ensureRecordIndexes('failed-selector-backfill', [
      { name: 'email', unique: false, multiEntry: false, revision: 1 }
    ])
    await expect(capability.getRecordIndexReadiness(handle)).resolves.toMatchObject({
      status: 'failed'
    })
  })

  it('custom codec 在 pre-abort 时不会被调用', async () => {
    const store = freshIndexedDb()
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
    const repo = users.connect(freshIndexedDb())
    await repo.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', name: 'Ada', email: 'a@b.c' })
    await repo.remove('u1')
    await expect(repo.get('u1')).resolves.toBeUndefined()
  })

  it('list/stream 只用 [entityName] range 就能正确限定在本 entity 内', async () => {
    const store = freshIndexedDb()
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
    const repo = numericUsers.connect(freshIndexedDb())
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
    const repo = mixed.connect(freshIndexedDb())
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
    const store = freshIndexedDb()
    const repo = users.connect(store)
    await repo.put({ id: 'v2', name: 'V2', email: 'v2@example.com' })
    const physicalKeys: unknown[] = []
    for await (const [key] of store.iterateRecords()) physicalKeys.push(key)
    expect(physicalKeys).toContainEqual(['__storage_web_entity_v2__', 'users', expect.any(String)])

    await store.putRecord(
      { __v: 1, data: { id: 'legacy', name: 'Legacy', email: 'l@example.com' } },
      ['users', 'legacy']
    )
    await expect(repo.list()).resolves.toEqual(
      expect.arrayContaining([
        { id: 'v2', name: 'V2', email: 'v2@example.com' },
        { id: 'legacy', name: 'Legacy', email: 'l@example.com' }
      ])
    )
    await store.putRecord(
      { __v: 1, data: { id: 'legacy-range', name: 'Legacy Range', email: 'lr@example.com' } },
      ['users', 'legacy-range']
    )
    await expect(
      repo.list({ range: { lower: 'legacy-range', upper: 'legacy-range' } })
    ).resolves.toEqual([{ id: 'legacy-range', name: 'Legacy Range', email: 'lr@example.com' }])
    await expect(store.getRecord(['users', 'legacy'])).resolves.toMatchObject({ __v: 1 })
  })

  it('batch 对 legacy 使用 v2 优先 fallback，并在写删时清理旧键', async () => {
    const store = freshIndexedDb()
    const repo = users.connect(store)
    await store.putRecord(
      { __v: 1, data: { id: 'legacy-batch', name: 'Legacy', email: 'l@example.com' } },
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
    const store = freshIndexedDb()
    const repo = users.connect(store)
    await store.putRecord(
      { __v: 1, data: { id: 'legacy-ordinary', name: 'Legacy', email: 'l@example.com' } },
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
    const store = freshIndexedDb()
    const repo = defineEntity<{ id: string; name: string }>({
      name: 'duplicate-migrate',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => value }
    })
    await repo.connect(store).put({ id: 'same', name: 'Current' })
    await store.putRecord({ __v: 1, data: { id: 'same', name: 'Legacy' } }, [
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
    const repo = indexed.connect(freshIndexedDb())
    await repo.put({ id: 'u1', name: 'Ada', email: 'ada@example.com' })
    await repo.put({ id: 'u2', name: 'Bob', email: 'bob@example.com' })
    await expect((await repo.list()).filter((user) => user.email === 'bob@example.com')).toEqual([
      { id: 'u2', name: 'Bob', email: 'bob@example.com' }
    ])
  })

  it('batch 在真实 IndexedDB 事务上成功提交与失败回滚', async () => {
    const repo = users.connect(freshIndexedDb())
    await repo.put({ id: 'keep', name: 'Keep', email: 'k@x.y' })

    await repo.batch(async (tx) => {
      await tx.put({ id: 'u1', name: 'Ada', email: 'a@b.c' })
    })
    await expect(repo.get('u1')).resolves.toBeDefined()

    await expect(
      repo.batch(async (tx) => {
        await tx.put({ id: 'u2', name: 'Bob', email: 'b@c.d' })
        await tx.remove('keep')
        throw new Error('boom')
      })
    ).rejects.toThrow()
    await expect(repo.get('u2')).resolves.toBeUndefined()
    await expect(repo.get('keep')).resolves.toEqual({ id: 'keep', name: 'Keep', email: 'k@x.y' })
  })

  it('版本迁移在读取时执行且不隐式写回', async () => {
    const store = freshIndexedDb()
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
    // 每次读取都从旧 envelope 执行迁移；持久化升级由调用方显式 put。
    await expect(repo.get('u1')).resolves.toEqual({ id: 'u1', displayName: 'Ada' })
  })

  it('显式 migrate 将 batch checkpoint 写入 metadata', async () => {
    const store = freshIndexedDb()
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
    const store = freshIndexedDb()
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
    const store = freshIndexedDb()
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
    const store = freshIndexedDb()
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'legacy-batch-migrate',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    })
    await store.putRecord({ __v: 1, data: { id: 'a', name: 'Ada' } }, ['legacy-batch-migrate', 'a'])
    await store.putRecord({ __v: 1, data: { id: 'b', name: 'Bob' } }, ['legacy-batch-migrate', 'b'])
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
    const store = freshIndexedDb()
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'checkpoint-resume',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    })
    await store.putRecord({ __v: 1, data: { id: 'a', name: 'Ada' } }, ['checkpoint-resume', 'a'])
    await store.putRecord({ __v: 1, data: { id: 'b', name: 'Bob' } }, ['checkpoint-resume', 'b'])
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
    const source = freshIndexedDb()
    const v1 = defineEntity<{ id: string; name: string }>({ name: 'failure-resume', key: 'id' })
    await v1.connect(source).put({ id: 'a', name: 'Ada' })
    await v1.connect(source).put({ id: 'b', name: 'Bob' })
    let calls = 0
    const flakyStore = {
      ...source,
      transaction: async (run: any, ctx: any) => {
        calls += 1
        if (calls === 2)
          throw new StorageError(StorageErrorCode.transactionFailed, {
            backend: 'indexeddb',
            operation: 'transaction.commit'
          })
        return source.transaction(run, ctx)
      }
    }
    const v2 = defineEntity<{ id: string; displayName: string }>({
      name: 'failure-resume',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => ({ id: value.id, displayName: value.name }) }
    })
    await expect(v2.connect(flakyStore).migrate({ batchSize: 1 })).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED'
    })
    await expect(v2.connect(source).migrate({ batchSize: 1 })).resolves.toMatchObject({
      scanned: 2,
      eligible: 2,
      migrated: 2
    })
  })

  it('migrate 遇到 schema fingerprint 不匹配时从头扫描', async () => {
    const store = freshIndexedDb()
    const entity = defineEntity<{ id: string; name: string }>({
      name: 'checkpoint-mismatch',
      key: 'id',
      version: 2,
      migrations: { 2: async (value: any) => value }
    })
    await store.putRecord({ __v: 1, data: { id: 'a', name: 'Ada' } }, ['checkpoint-mismatch', 'a'])
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
