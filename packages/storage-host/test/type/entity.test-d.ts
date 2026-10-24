import { expectTypeOf } from 'vitest'
import { defineEntity } from '../../src/entity.js'
import { memoryBackend } from '../helpers/memory.js'
import type { ICapabilityInstallPort, IStorageBase, IStorageKey } from '@migaia/storage-contract'
import {
  createStorageHost,
  definePlugin,
  defineStorageBackendKind,
  memoryBackendPlugin,
  type IStoragePluginCore
} from '../../src/index.js'
import type { IMigrateOptions, IMigrateResult, IRepository } from '../../src/entity/types.js'

type IUser = {
  id: string
  name: string
  profile: { email: string }
  tags: string[]
  score: number
}

const users = defineEntity<IUser>({ name: 'users', key: 'id' })
const repo = users.connect(await memoryBackend())

// connect() 的返回类型正确推导出 IRepository<IUser>，get/put/stream
// 的值类型都是 IUser，不需要调用方手写类型断言。
expectTypeOf(repo).toEqualTypeOf<IRepository<IUser, Readonly<Record<never, IStorageKey>>, true>>()
expectTypeOf(repo.get).returns.toEqualTypeOf<Promise<IUser | undefined>>()
expectTypeOf(repo.put).parameter(0).toEqualTypeOf<IUser>()
expectTypeOf(repo.stream).returns.toEqualTypeOf<
  import('@migaia/storage-contract').IStorageIterator<IUser>
>()
expectTypeOf(repo.migrate).parameter(0).toMatchTypeOf<IMigrateOptions<IUser> | undefined>()
expectTypeOf<Awaited<ReturnType<typeof repo.migrate>>>().toEqualTypeOf<IMigrateResult>()

const indexedUsers = defineEntity<IUser>()({
  name: 'indexed-users',
  key: 'id',
  indexes: {
    name: { path: 'name' },
    id: { path: 'id', unique: true },
    email: { path: 'profile.email' },
    tags: { path: 'tags', multiEntry: true },
    compound: { paths: ['name', 'score'] },
    custom: {
      select: (value) => ({ kind: 'single' as const, key: value.id }),
      revision: 1
    },
    customMany: {
      select: (value) => ({ kind: 'multiple' as const, keys: value.tags }),
      revision: 1
    }
  }
})
const indexedRepo = indexedUsers.connect(await memoryBackend())
type IUserIndexMap = {
  readonly name: string
  readonly id: string
  readonly email: string
  readonly tags: string
  readonly compound: readonly [string, number]
  readonly custom: string
  readonly customMany: string
}
expectTypeOf(indexedRepo).toEqualTypeOf<IRepository<IUser, IUserIndexMap, true>>()
indexedRepo.findBy('name', 'Ada')
indexedRepo.query().index('id')
indexedRepo.findBy('compound', ['Ada', 1])
indexedRepo.findBy('tags', 'admin')
indexedRepo.findBy('customMany', 'admin')
indexedRepo.list({ index: 'email', range: { lower: 'ada@example.com' } })
indexedRepo.list({ index: 'compound', range: { lower: ['Ada', 1] } })
indexedRepo.stream({ index: 'email', range: { lower: 'ada@example.com' } })
// @ts-expect-error indexed stream ranges use the exact query-key type.
indexedRepo.stream({ index: 'name', range: { lower: 1 } })
// @ts-expect-error undeclared index names are rejected by the inferred index map.
indexedRepo.findBy('missing', 'ada@example.com')
// @ts-expect-error index keys are derived from the declared projection and remain exact.
indexedRepo.findBy('tags', ['admin'])
// @ts-expect-error indexed ranges use the exact query-key type.
indexedRepo.list({ index: 'name', range: { lower: 1 } })

defineEntity<IUser>({
  name: 'direct-indexed',
  key: 'id',
  // @ts-expect-error direct indexed declarations are forbidden; use the curried form above.
  indexes: { id: { path: 'id' } }
})

// key 必须是领域对象上真实存在的属性名（编译期约束）。
// @ts-expect-error "missing" 不是 IUser 的属性
defineEntity<IUser>({ name: 'bad', key: 'missing' })

/** Certified borrowed views retain their exact data channels without taking root ownership. */
const memoryHost = await createStorageHost({ plugins: [memoryBackendPlugin()] as const })
const memoryOrg = memoryHost.org('00000000-0000-0000-0000-000000000001')
const orgRepository = users.connect(memoryOrg.backend('memory'))
expectTypeOf(orgRepository.get).returns.toEqualTypeOf<Promise<IUser | undefined>>()

/** A base-only plugin carries no key-value channel for entity connection. */
declare const baseOnlyStore: IStorageBase
/** The existing installer is only a declaration fixture and grants no runtime data channel. */
declare const baseOnlyInstaller: ICapabilityInstallPort
/** Exact kind inference must not widen a base-only organization backend to key-value. */
const baseOnlyKind = defineStorageBackendKind<IStorageBase, undefined>()('base-only')
/** Public plugin installation preserves the source store shape in the organization projection. */
const baseOnlyPlugin = definePlugin('base-only', (core: IStoragePluginCore) => ({
  kind: baseOnlyKind,
  featureExpose: () => ({ getClient: () => undefined }),
  capabilityInstaller: () => baseOnlyInstaller,
  install: () => {
    core.registerStore(baseOnlyStore)
    return {}
  }
}))
/** The organization view is genuine host output rather than a cast borrowed type. */
const baseOnlyHost = await createStorageHost({ plugins: [baseOnlyPlugin] as const })
// @ts-expect-error a precise base-only backend does not provide entity key-value channels.
users.connect(baseOnlyHost.org('00000000-0000-0000-0000-000000000001').backend('base-only'))

/** Every source/ordering transition preserves the entity adapter and exact callback domain. */
const narrowedQuery = indexedRepo.query().where({ name: 'Ada' }).skip(1).onInvalid('throw')
narrowedQuery.where('score', 'gt', 1).select('name').all()
// @ts-expect-error source selection must occur before any shared condition/control.
narrowedQuery.index('name', 'Ada')
// @ts-expect-error selecting a source removes the mutually exclusive second choice.
indexedRepo.query().index('name', 'Ada').range({ lower: 'a' })
// @ts-expect-error declared path operands retain the original numeric domain.
indexedRepo.query().where('score', 'startsWith', 'a')
const selectorQuery = indexedRepo
  .query()
  .orderBy((row) => row.name)
  .onInvalid('skip')
  .skip(1)
selectorQuery
  .orderBy((row) => row.score)
  .limit(2)
  .select('id')
  .all()
// @ts-expect-error selector ordering cannot switch to opaque comparison.
selectorQuery.orderByComparator((left, right) => left.score - right.score)
const comparatorQuery = indexedRepo
  .query()
  .orderByComparator((left, right) => left.score - right.score)
// @ts-expect-error opaque comparison must declare a finite bound before a general terminal.
comparatorQuery.all()
const boundedQuery = comparatorQuery.limit(2).onInvalid('throw').where({ name: 'Ada' })
boundedQuery.skip(1).all()
// @ts-expect-error a bounded comparator cannot introduce selector ordering.
boundedQuery.orderBy((row) => row.name)
// @ts-expect-error a bounded comparator cannot introduce another comparator.
boundedQuery.orderByComparator((left, right) => left.score - right.score)

/**
 * Only an actual root native feed exposes invalidation watch, including genuine organization
 * borrows.
 */
repo.query().watch()
orgRepository.query().watch()
// @ts-expect-error scoped entity reads cannot subscribe outside their transaction's lifetime.
repo.batch((scope) => scope.query().watch())
/** The raw legacy type has no literal true feed fact and cannot advertise a native record watcher. */
declare const unknownFeedStore: import('@migaia/storage-contract').IKeyValueStore
// @ts-expect-error a runtime-unknown feed flag cannot publish the root native watcher.
users.connect(unknownFeedStore).query().watch()
/** An explicitly false feed remains unavailable even if other legacy methods exist. */
declare const noFeedStore: import('@migaia/storage-contract').IKeyValueStore & {
  readonly capabilities: import('@migaia/storage-contract').IStorageCapabilities & {
    readonly changeFeed: false
  }
}
// @ts-expect-error false feed capability never grants watch.
users.connect(noFeedStore).query().watch()
