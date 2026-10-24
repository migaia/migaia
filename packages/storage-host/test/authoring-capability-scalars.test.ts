import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  ttl,
  counter,
  vector,
  rdf,
  DeleteCountMode,
  type IVectorApi,
  type IVectorCollection,
  blob,
  durableChangeFeed,
  type ITransactionalCapability,
  type IBlobApi,
  type IDurableChangeFeedApi,
  sql,
  implement,
  defineStorageCapability,
  assertStorageTtlTarget,
  assertStorageTtlDuration,
  type IStorageBase
} from '@migaia/storage-contract'
import { createSqlTag } from '../src/authoring/sql.js'
import { provideCapabilities } from '../src/authoring/capability.js'
import { snapshotStorageTtlTarget } from '../src/authoring/ttl.js'
import { snapshotStorageCounterIncrement } from '../src/authoring/counter.js'
import { lockKey } from '../src/authoring/concurrency.js'
import { term } from '../src/authoring/rdf.js'

/** Scalar contract fixtures own no data or native resource beyond their original base lifetime. */
function base(): IStorageBase {
  return {
    backend: 'scalar-fixture',
    capabilities: {
      syncRead: false,
      binary: false,
      records: false,
      transactions: false,
      iteration: false,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined
  }
}

describe('standard scalar capability contracts', () => {
  it('publishes exact vector/RDF APIs and retains portable payload schema constraints', () => {
    const collection = vi.fn()
    const rootVector = { collection }
    const rootRdf = { add: vi.fn(), delete: vi.fn(), match: vi.fn() }
    const store = provideCapabilities(base(), [
      implement(vector, rootVector as never),
      implement(rdf, rootRdf as never)
    ])
    expect(store.use(vector)).toBe(rootVector)
    expect(store.use(rdf)).toBe(rootRdf)
    expect(collection).not.toHaveBeenCalled()
    expect(DeleteCountMode).toEqual({ precount: 'precount', scroll: 'scroll' })
    expectTypeOf<ITransactionalCapability<typeof vector>>().toEqualTypeOf<never>()
    for (const method of ['add', 'delete', 'match'])
      expect(() =>
        provideCapabilities(base(), [implement(rdf, { ...rootRdf, [method]: undefined } as never)])
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => provideCapabilities(base(), [implement(vector, {} as never)])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    type IPayload = { readonly label: string; readonly nested?: { readonly enabled: boolean } }
    const selectTyped = (api: IVectorApi) => {
      const result = api.collection<IPayload>('typed', { dimensions: 2, metric: 'cosine' })
      // @ts-expect-error Date fields are not a portable vector payload output schema.
      api.collection<{ date: Date }>('invalid')
      return result
    }
    expectTypeOf<ReturnType<typeof selectTyped>>().toEqualTypeOf<IVectorCollection<IPayload>>()
  })

  it('publishes independent blob and durable APIs without flat KV or transaction authority', () => {
    const native = vi.fn(async (): Promise<never> => {
      throw new Error('admission must not execute')
    })
    const objects: IBlobApi = {
      put: native,
      get: native,
      head: native,
      remove: native,
      list: native,
      removeByPrefix: native
    }
    const changes: IDurableChangeFeedApi = { readChanges: native, tailChanges: native }
    const store = provideCapabilities(base(), [
      implement(blob, objects),
      implement(durableChangeFeed, changes)
    ])
    expect(store.use(blob)).toBe(objects)
    expect(store.use(durableChangeFeed)).toBe(changes)
    expect('get' in store).toBe(false)
    expect(native).not.toHaveBeenCalled()
    expectTypeOf<
      ITransactionalCapability<typeof blob | typeof durableChangeFeed>
    >().toEqualTypeOf<never>()
    for (const method of ['put', 'get', 'head', 'remove', 'list', 'removeByPrefix'])
      expect(() =>
        provideCapabilities(base(), [implement(blob, { ...objects, [method]: undefined } as never)])
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    for (const method of ['readChanges', 'tailChanges'])
      expect(() =>
        provideCapabilities(base(), [
          implement(durableChangeFeed, { ...changes, [method]: undefined } as never)
        ])
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    for (const token of [blob, durableChangeFeed])
      expect(() =>
        implement(token, {} as never, { forTransaction: (() => ({})) as never })
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('admits complete scalar shapes by exact token identity and captures no replacement root API', () => {
    const expiration = {
      expire: vi.fn(async () => true),
      remaining: vi.fn(async () => 1),
      persist: vi.fn(async () => false)
    }
    const increments = { increment: vi.fn(async () => 2) }
    const store = provideCapabilities(base(), [
      implement(ttl, expiration),
      implement(counter, increments)
    ])
    expect(store.use(ttl)).toBe(expiration)
    expect(store.use(counter)).toBe(increments)
    expect(store.has(defineStorageCapability<unknown>()('ttl'))).toBe(false)
    for (const method of ['expire', 'remaining', 'persist'])
      expect(() =>
        provideCapabilities(base(), [
          implement(ttl, { ...expiration, [method]: undefined } as never)
        ])
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => provideCapabilities(base(), [implement(counter, {} as never)])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    const rootSql = vi.fn(async (): Promise<never> => {
      throw new Error('SQL admission must not execute')
    })
    const executor = {
      sql: createSqlTag({ dialect: 'sqlite', all: rootSql, get: rootSql, run: rootSql })
    }
    expect(provideCapabilities(base(), [implement(sql, executor)]).use(sql)).toBe(executor)
    expect(rootSql).not.toHaveBeenCalled()
    for (const invalid of [{}, { sql: null }, { sql: () => undefined }])
      expect(() => provideCapabilities(base(), [implement(sql, invalid as never)])).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    const missing = provideCapabilities(base(), [])
    expect(() => missing.use(ttl as never)).toThrowError(
      expect.objectContaining({
        code: 'UNSUPPORTED_CAPABILITY',
        capability: 'ttl',
        backend: 'scalar-fixture'
      })
    )
  })

  it('captures the original physical TTL target and permits every finite nonnegative duration', () => {
    const date = new Date(3)
    const captured = snapshotStorageTtlTarget({ channel: 'record', key: ['x', date] }, 'memory')
    const target = { channel: 'record' as const, key: ['x', date] }
    expect(() => assertStorageTtlTarget(target, 'memory')).not.toThrow()
    expect(target.key[1]).toBe(date)
    date.setTime(9)
    expect(captured).toEqual({ channel: 'record', key: ['x', new Date(3)] })
    expect(snapshotStorageTtlTarget(lockKey.vector('catalog', 'one'), 'memory')).toEqual({
      channel: 'vector',
      collection: 'catalog',
      id: 'one'
    })
    expect(() =>
      snapshotStorageTtlTarget(
        lockKey.rdf({
          subject: term.iri('urn:s'),
          predicate: term.iri('urn:p'),
          object: term.iri('urn:o'),
          graph: term.defaultGraph
        }) as never,
        'memory'
      )
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    for (const ms of [0, -0, 0.5, Number.MAX_VALUE])
      expect(() => assertStorageTtlDuration(ms, 'memory')).not.toThrow()
    for (const ms of [-1, NaN, Infinity, '1'])
      expect(() => assertStorageTtlDuration(ms as number, 'memory')).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT', backend: 'memory' })
      )
    expect(() =>
      snapshotStorageTtlTarget({ channel: 'bytes', key: 1 } as never, 'memory')
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('captures the delta before native work and validates canonical decimal arithmetic in the atomic owner', () => {
    const increment = snapshotStorageCounterIncrement(undefined, 'memory')
    expect(increment(undefined)).toBe(1)
    expect(increment(null)).toBe(1)
    expect(increment('0')).toBe(1)
    expect(increment('-2')).toBe(-1)
    expect(snapshotStorageCounterIncrement(-2, 'memory')('3')).toBe(1)
    expect(snapshotStorageCounterIncrement(0, 'memory')('3')).toBe(3)
    for (const by of [1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null])
      expect(() => snapshotStorageCounterIncrement(by as number, 'memory')).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    for (const current of [
      '',
      ' ',
      '+1',
      '-0',
      '00',
      '01',
      '-01',
      '1.0',
      '1e2',
      String(Number.MAX_SAFE_INTEGER + 1),
      String(Number.MAX_SAFE_INTEGER)
    ])
      expect(() => increment(current)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    expect(() =>
      snapshotStorageCounterIncrement(-1, 'memory')(String(Number.MIN_SAFE_INTEGER))
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    const coercion = vi.fn(() => '1')
    expect(() => increment({ valueOf: coercion } as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(coercion).not.toHaveBeenCalled()
  })
})
