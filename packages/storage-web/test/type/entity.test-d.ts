import { expectTypeOf } from 'vitest'
import { defineEntity } from '../../src/entity'
import { memoryStorage } from '../../src/backends'
import type { IMigrateOptions, IMigrateResult, IRepository } from '../../src/entity'

type IUser = { id: string; name: string }

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
    id: { path: 'id', unique: true }
  }
})
const indexedRepo = indexedUsers.connect(memoryStorage())
expectTypeOf(indexedRepo).toEqualTypeOf<IRepository<IUser, 'name' | 'id'>>()
indexedRepo.findBy('name', 'Ada')
indexedRepo.findManyBy('id')
// @ts-expect-error SWV2-T06 undeclared index names are rejected by the inferred literal union.
indexedRepo.findBy('email', 'ada@example.com')

defineEntity<IUser>({
  name: 'direct-indexed',
  key: 'id',
  // @ts-expect-error SWV2-T35 direct indexed declarations are forbidden; use the curried form above.
  indexes: { id: { path: 'id' } }
})

// key 必须是领域对象上真实存在的属性名（编译期约束）。
// @ts-expect-error "missing" 不是 IUser 的属性
defineEntity<IUser>({ name: 'bad', key: 'missing' })
