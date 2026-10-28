import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { createRecordQuery, createVectorQuery, createRdfQuery } from '../src/authoring/query.ts'
import { createStorageIteratorLifetime } from '../src/authoring/resource.ts'
import { term } from '../src/authoring/rdf.ts'
import {
  type IStorageChange,
  type IStorageIterator,
  type IRecordQueryInput,
  type IRecordsApi,
  type IRdfApi,
  type IVectorApi,
  type ITransactionRecordsApi,
  type ITransactionRdfApi,
  type IOperationContext
} from '@migaia/storage-contract'

/** One native feed fixture exposes the original resource methods without a shared event queue. */
function feed(): IStorageIterator<IStorageChange> {
  /** Accepted-advance drain and both cached cleanup paths belong to the existing resource owner. */
  const lifetime = createStorageIteratorLifetime<IStorageChange>({
    close: async () => undefined,
    report: console.error
  })
  return {
    next: () => lifetime.advance(async () => ({ done: true, value: undefined })),
    dispose: lifetime.dispose,
    return: lifetime.returned,
    [Symbol.asyncDispose]: lifetime.symbolic,
    [Symbol.asyncIterator]() {
      return this
    }
  }
}

describe('native query watch', () => {
  it('subscribes only at watch and returns the exact original iterator', async () => {
    const original = feed()
    const execute = vi.fn(() => {
      throw new Error('data cursor must not open')
    })
    const subscribe = vi.fn((_input: IRecordQueryInput) => original)
    const query = createRecordQuery<{ status: string }>({
      pushdown: { source: 'native-feed', operators: ['eq'], operations: ['where', 'select'] },
      execute,
      watch: subscribe
    })
      .where({ status: 'paid' })
      .select('status')
    expect(subscribe).not.toHaveBeenCalled()
    query.explain()
    expect(subscribe).not.toHaveBeenCalled()
    const iterator = query.watch({ pageSize: 20 })
    expect(iterator).toBe(original)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe.mock.calls[0]![0]).toMatchObject({ fields: ['status'], ctx: { pageSize: 20 } })
    expect(subscribe.mock.calls[0]![0].conditions).toHaveLength(1)
    expect(execute).not.toHaveBeenCalled()
    const main = iterator.dispose()
    const symbolic = iterator[Symbol.asyncDispose]()
    expect(iterator.dispose()).toBe(main)
    expect(iterator[Symbol.asyncDispose]()).toBe(symbolic)
    expect(main).not.toBe(symbolic)
    await Promise.all([main, symbolic])
    expectTypeOf<ReturnType<typeof query.watch>>().toEqualTypeOf<IStorageIterator<IStorageChange>>()
  })

  it('requires a complete native plan and bounded vector state before subscribing', () => {
    const original = feed()
    const watch = vi.fn(() => original)
    const execute = vi.fn(() => {
      throw new Error('data cursor must not open')
    })
    const source = {
      pushdown: { source: 'native-only-feed', operators: [] as const, operations: [] as const },
      execute,
      watch
    }
    const record = createRecordQuery<{ value: number }>(source)
    expect(() => record.where((row) => row.value > 0).watch()).toThrowError(
      expect.objectContaining({ code: 'QUERY_NOT_PUSHABLE' })
    )
    expect(() => record.select((row) => row.value).watch()).toThrowError(
      expect.objectContaining({ code: 'QUERY_NOT_PUSHABLE' })
    )
    const rdf = createRdfQuery(source, { subject: term.iri('urn:a') })
    expect(() => rdf.follow(term.iri('urn:knows')).watch()).toThrowError(
      expect.objectContaining({ code: 'QUERY_NOT_PUSHABLE' })
    )
    expect(rdf.watch()).toBe(original)
    const vector = createVectorQuery<{ value: number }>({
      ...source,
      pushdown: { ...source.pushdown, operations: ['topK'] }
    })
    expect(vector).not.toHaveProperty('watch')
    function unbounded(): void {
      // @ts-expect-error A pre-topK builder has no complete query shape for a watch terminal.
      vector.watch()
    }
    void unbounded
    expect(vector.topK(2).watch()).toBe(original)
    expect(() =>
      vector
        .where((row) => row.value > 0)
        .topK(2)
        .watch()
    ).toThrowError(expect.objectContaining({ code: 'QUERY_NOT_PUSHABLE' }))
    expect(watch).toHaveBeenCalledTimes(2)
    expect(execute).not.toHaveBeenCalled()
    expect(createRecordQuery({ ...source, watch: undefined })).not.toHaveProperty('watch')
  })

  it('grants standard native watch types only to declared change feeds and leaves transaction APIs unchanged', () => {
    function validTypes(
      records: IRecordsApi<{ value: number }, true>,
      rdf: IRdfApi<true>,
      vector: IVectorApi<false, true>,
      quiet: IRecordsApi,
      txRecords: ITransactionRecordsApi,
      txRdf: ITransactionRdfApi
    ): void {
      expectTypeOf(records.query().watch()).toEqualTypeOf<IStorageIterator<IStorageChange>>()
      expectTypeOf(rdf.match({}).watch()).toEqualTypeOf<IStorageIterator<IStorageChange>>()
      expectTypeOf(vector.collection('items').near([1]).topK(2).watch()).toEqualTypeOf<
        IStorageIterator<IStorageChange>
      >()
      expectTypeOf<Parameters<typeof records.query>['length']>().toEqualTypeOf<0>()
      expectTypeOf<Parameters<ReturnType<typeof records.query>['watch']>[0]>().toEqualTypeOf<
        IOperationContext | undefined
      >()
      // @ts-expect-error A store without a declared feed cannot watch queries.
      quiet.query().watch()
      // @ts-expect-error Transaction record queries do not expose a root subscription.
      txRecords.query().watch()
      // @ts-expect-error Transaction RDF queries do not expose a root subscription.
      txRdf.match({}).watch()
    }
    void validTypes
  })
})
