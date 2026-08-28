import { expectTypeOf } from 'vitest'
import { defineEntity } from '../../src/entity'
import { memoryStorage } from '../../src/backends'
import type { IMigrateOptions, IMigrateResult, IRepository } from '../../src/entity/types.js'

type IUser = {
  id: string
  name: string
  profile: { email: string }
  tags: string[]
  score: number
}

const users = defineEntity<IUser>({ name: 'users', key: 'id' })
const repo = users.connect(memoryStorage())

// connect() 的返回类型正确推导出 IRepository<IUser>，get/put/stream
// 的值类型都是 IUser，不需要调用方手写类型断言。
expectTypeOf(repo).toEqualTypeOf<IRepository<IUser>>()
expectTypeOf(repo.get).returns.toEqualTypeOf<Promise<IUser | undefined>>()
expectTypeOf(repo.put).parameter(0).toEqualTypeOf<IUser>()
expectTypeOf(repo.stream).returns.toEqualTypeOf<AsyncIterableIterator<IUser>>()
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
const indexedRepo = indexedUsers.connect(memoryStorage())
type IUserIndexMap = {
  readonly name: string
  readonly id: string
  readonly email: string
  readonly tags: string
  readonly compound: readonly [string, number]
  readonly custom: string
  readonly customMany: string
}
expectTypeOf(indexedRepo).toEqualTypeOf<IRepository<IUser, IUserIndexMap>>()
indexedRepo.findBy('name', 'Ada')
indexedRepo.findManyBy('id')
indexedRepo.findBy('compound', ['Ada', 1])
indexedRepo.findBy('tags', 'admin')
indexedRepo.findBy('customMany', 'admin')
indexedRepo.list({ index: 'email', range: { lower: 'ada@example.com' } })
indexedRepo.list({ index: 'compound', range: { lower: ['Ada', 1] } })
indexedRepo.stream({ index: 'email', range: { lower: 'ada@example.com' } })
// @ts-expect-error R05 indexed stream ranges use the exact query-key type.
indexedRepo.stream({ index: 'name', range: { lower: 1 } })
// @ts-expect-error undeclared index names are rejected by the inferred index map.
indexedRepo.findBy('missing', 'ada@example.com')
// @ts-expect-error R05 index keys are derived from the declared projection and remain exact.
indexedRepo.findBy('tags', ['admin'])
// @ts-expect-error R05 indexed ranges use the exact query-key type.
indexedRepo.list({ index: 'name', range: { lower: 1 } })

defineEntity<IUser>({
  name: 'direct-indexed',
  key: 'id',
  // @ts-expect-error SWV2-T35 direct indexed declarations are forbidden; use the curried form above.
  indexes: { id: { path: 'id' } }
})

// key 必须是领域对象上真实存在的属性名（编译期约束）。
// @ts-expect-error "missing" 不是 IUser 的属性
defineEntity<IUser>({ name: 'bad', key: 'missing' })
