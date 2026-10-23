import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  compileStorageWhere,
  createRecordQuery,
  createTransactionOwner,
  records,
  provideCapabilities,
  implement,
  useStorageCapability,
  hasStorageCapability,
  StorageContractError,
  StorageContractErrorCode,
  QueryOperation,
  QueryOperator,
  type IStorageBase,
  type IStorageIterator,
  type IQueryPushdown,
  type IRecordsApi,
  type IWhere,
  type IQueryCondition
} from '../src/index.js'

/**
 * Business rows exercise the same conditions used by record queries and archival candidate
 * filtering.
 */
type IOrder = {
  status?: string
  total: number
  address?: { city: string }
  tags?: readonly string[]
  created?: Date
  sequence?: bigint
}

describe('canonical declarative conditions', () => {
  it('combines nested fields, and/or/not and missing fields without reading unrelated properties', () => {
    const predicate = compileStorageWhere<IOrder>({
      and: [{ status: 'paid' }, { total: { gte: 10 } }],
      or: [{ address: { city: 'Shanghai' } }, { tags: { has: 'vip' } }],
      not: { status: 'cancelled' }
    })
    expect(predicate({ status: 'paid', total: 12, address: { city: 'Shanghai' } })).toBe(true)
    expect(predicate({ status: 'paid', total: 12, tags: ['vip'] })).toBe(true)
    expect(predicate({ status: 'paid', total: 9, address: { city: 'Shanghai' } })).toBe(false)
    expect(predicate({ status: 'cancelled', total: 20, tags: ['vip'] })).toBe(false)
    expect(compileStorageWhere<IOrder>({ status: { exists: false } })({ total: 1 })).toBe(true)
    expect(
      compileStorageWhere<IOrder>({ status: { exists: true } })({ total: 1, status: undefined })
    ).toBe(true)
  })

  it('implements all declared operators without coercing incompatible fields', () => {
    expect(Object.keys(QueryOperator)).toEqual([
      'eq',
      'ne',
      'in',
      'exists',
      'gt',
      'gte',
      'lt',
      'lte',
      'between',
      'startsWith',
      'contains',
      'has'
    ])
    const row: IOrder = { status: 'paid', total: 12, tags: ['vip'] }
    const conditions: IWhere<IOrder>[] = [
      { total: { eq: 12 } },
      { total: { ne: 13 } },
      { total: { in: [2, 12] } },
      { status: { exists: true } },
      { total: { gt: 11 } },
      { total: { gte: 12 } },
      { total: { lt: 13 } },
      { total: { lte: 12 } },
      { total: { between: [10, 12] } },
      { status: { startsWith: 'pa' } },
      { status: { contains: 'ai' } },
      { tags: { has: 'vip' } }
    ]
    for (const where of conditions) expect(compileStorageWhere(where)(row)).toBe(true)
    expect(
      compileStorageWhere<{ value: number | string }>({ value: { gt: 2 } })({ value: '3' })
    ).toBe(false)
    expect(compileStorageWhere<{ value: number }>({ value: { eq: 0 } })({ value: -0 })).toBe(true)
  })

  it('captures condition getters and in list contents once, retaining explicit object identity', () => {
    let reads = 0
    const values = ['paid']
    const predicate = compileStorageWhere<IOrder>({
      get status() {
        reads++
        return { in: values }
      }
    })
    values[0] = 'cancelled'
    expect(predicate({ total: 1, status: 'paid' })).toBe(true)
    expect(predicate({ total: 1, status: 'cancelled' })).toBe(false)
    expect(reads).toBe(1)
    const identity = { code: 'same' }
    const byIdentity = compileStorageWhere<{ value: typeof identity }>({ value: { eq: identity } })
    const inIdentity = compileStorageWhere<{ value: typeof identity }>({
      value: { in: [identity] }
    })
    identity.code = 'changed'
    expect(byIdentity({ value: identity })).toBe(true)
    expect(inIdentity({ value: identity })).toBe(true)
    expect(byIdentity({ value: { code: 'changed' } })).toBe(false)
    /** Opaque identity never inspects nested non-JSON fields or getter contents. */
    const complex = {
      date: new Date(1),
      large: 2n,
      get untouched(): never {
        throw new Error('identity must not inspect contents')
      }
    }
    const eqComplex = compileStorageWhere<{ value: typeof complex }>({ value: { eq: complex } })
    const inComplex = compileStorageWhere<{ value: typeof complex }>({ value: { in: [complex] } })
    expect(eqComplex({ value: complex })).toBe(true)
    expect(inComplex({ value: complex })).toBe(true)
  })

  it('preserves Date time snapshots, bigint domains and explicit undefined operands', () => {
    const bound = new Date(10)
    const byDate = compileStorageWhere<IOrder>({
      created: { in: [bound] },
      sequence: { between: [1n, 3n] }
    })
    bound.setTime(99)
    expect(byDate({ total: 1, created: new Date(10), sequence: 2n })).toBe(true)
    expect(byDate({ total: 1, created: new Date(99), sequence: 2n })).toBe(false)
    expect(compileStorageWhere<IOrder>({ status: { eq: undefined } })({ total: 1 })).toBe(true)
    expect(
      compileStorageWhere<IOrder>({ created: { gt: new Date(9) } })({
        total: 1,
        created: new Date(10)
      })
    ).toBe(true)
    const field: IQueryCondition = {
      kind: 'field',
      path: ['created'],
      operator: 'in',
      value: [new Date(1), undefined]
    }
    expect(field.value).toHaveLength(2)
  })

  it('rejects malformed conditions and paths at compilation, retaining reflected failures', () => {
    /** An actual hole must reject rather than becoming an undefined membership candidate. */
    const sparse: unknown[] = []
    sparse.length = 1
    const cycle: Record<string, unknown> = {}
    cycle.not = cycle
    for (const where of [
      null,
      [],
      () => true,
      { total: { gt: { bad: true } } },
      { total: { between: [1] } },
      { status: { exists: 1 } },
      { status: { in: sparse } },
      { 'constructor.x': 1 },
      cycle
    ]) {
      expect(() => compileStorageWhere(where as IWhere<IOrder>)).toThrowError(
        expect.objectContaining({ source: '@migaia/storage-contract', code: 'INVALID_ARGUMENT' })
      )
    }
    const original = new Error('condition getter failed')
    expect(() =>
      compileStorageWhere<IOrder>({
        get status(): never {
          throw original
        }
      })
    ).toThrowError(expect.objectContaining({ cause: original }))
  })

  it('keeps the exact generic predicate type and rejects incompatible field operators', () => {
    const orders = compileStorageWhere<IOrder>({ total: { gt: 1 } })
    const names = compileStorageWhere<{ name: string }>({ name: { startsWith: 'A' } })
    const flags = compileStorageWhere<{ enabled: boolean }>({ enabled: true })
    expectTypeOf(orders).toEqualTypeOf<(value: IOrder) => boolean>()
    expect(names({ name: 'Ada' })).toBe(true)
    expect(flags({ enabled: true })).toBe(true)
    function invalidTypes() {
      // @ts-expect-error Numeric fields do not accept string operations.
      compileStorageWhere<IOrder>({ total: { startsWith: '1' } })
      // @ts-expect-error Unknown nested fields remain rejected.
      compileStorageWhere<IOrder>({ address: { missing: 1 } })
      // @ts-expect-error A declarative compiler does not accept a function predicate.
      compileStorageWhere<IOrder>((row: IOrder) => row.total > 1)
    }
    void invalidTypes
  })
})

/** Fixture failures retain the same coded native identity as the original transaction owner. */
type IQueryFixtureFailure = Error & { readonly source: string; readonly code: string }
/** Fixture normalization retains coded native errors, matching the original owner contract. */
function normalizeQueryFixtureFailure(cause: unknown): IQueryFixtureFailure {
  return cause instanceof Error && 'source' in cause && 'code' in cause
    ? (cause as IQueryFixtureFailure)
    : new StorageContractError(StorageContractErrorCode.invalidArgument, { cause })
}
/** Original resource ownership is exercised rather than a second iterator implementation. */
function ownedRows(
  rows: readonly unknown[],
  close: () => PromiseLike<void> | void = () => undefined,
  nextFailure?: Error
): IStorageIterator<readonly [string, unknown]> {
  /** A specialized backend needs no fabricated KV methods to own the native cursor. */
  const base: IStorageBase = {
    backend: 'query-fixture',
    capabilities: {
      syncRead: false,
      binary: false,
      records: true,
      transactions: true,
      iteration: true,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    dispose: async () => undefined,
    [Symbol.asyncDispose]: async () => undefined
  }
  /** Backend normalization keeps the original cursor error reachable through its existing code. */
  const owner = createTransactionOwner<unknown, object>(base, normalizeQueryFixtureFailure)
  /** One root belongs to the callback interval of the original transaction owner. */
  const scope = {}
  owner.register(scope, { createScope: () => ({}), onFailure: () => undefined })
  /** The port advances its original source once for every native next. */
  let index = 0
  return owner.registerIterator(scope, {
    next: async (): Promise<IteratorResult<readonly [string, unknown]>> => {
      if (nextFailure !== undefined) throw nextFailure
      return index < rows.length
        ? { done: false, value: [String(index), rows[index++]] as const }
        : { done: true, value: undefined }
    },
    close
  })
}

/** An empty support declaration exercises the common client path without inventing native support. */
const noPushdown: IQueryPushdown = { source: 'fixture', operators: [], operations: [] }

describe('standard record capability', () => {
  it('provides the shared query entry with precise backend row refinements and native prefix deletion', async () => {
    /** Data remains owned by the supplied original cursor rather than a capability-local executor. */
    const rows: IOrder[] = [
      { status: 'paid', total: 12 },
      { status: 'pending', total: 3 }
    ]
    /**
     * This independent base owns the capability publication lifetime and no cursor is opened at
     * admission.
     */
    const base: IStorageBase = {
      backend: 'record-capability-fixture',
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
    /** Source calls reveal any eager I/O introduced by token admission or fluent construction. */
    let opened = 0
    /** A native write stays on its original implementation, with the exact key/context and Promise. */
    const deletion = Promise.resolve(2)
    /** Borrowed write inputs must remain untouched until the backend implementation receives them. */
    let received: readonly unknown[] | undefined
    /**
     * Actual native API refines the default row domain while satisfying the single standard
     * declaration.
     */
    const api = {
      query<R = IOrder>() {
        return createRecordQuery<R>({
          pushdown: noPushdown,
          execute: () => {
            opened++
            return ownedRows(rows)
          }
        })
      },
      removeByPrefix(
        prefix: Parameters<IRecordsApi['removeByPrefix']>[0],
        ctx?: Parameters<IRecordsApi['removeByPrefix']>[1]
      ) {
        received = [prefix, ctx]
        return deletion
      },
      native: () => 'kept'
    } satisfies IRecordsApi<IOrder> & { native(): string }
    /** A false legacy support fact cannot prevent an actual Feature-provided record API. */
    const store = provideCapabilities(base, [implement(records, api)])
    expect(hasStorageCapability(store, records)).toBe(true)
    expect(useStorageCapability(store, records)).toBe(api)
    expect(store.use(records)).toBe(api)
    expect(store.use(records).native()).toBe('kept')
    const query = store.use(records).query().where({ status: 'paid' }).select('total')
    expect(opened).toBe(0)
    expectTypeOf(query.all).returns.toEqualTypeOf<Promise<Pick<IOrder, 'total'>[]>>()
    await expect(query.all()).resolves.toEqual([{ total: 12 }])
    expect(opened).toBe(1)
    const key = ['archive', new Date(1)] as const
    const ctx = { timeoutMs: 100 }
    expect(store.use(records).removeByPrefix(key, ctx)).toBe(deletion)
    expect(received).toEqual([key, ctx])
    expect(received?.[0]).toBe(key)
    expect(received?.[1]).toBe(ctx)
  })

  it('rejects incomplete standard APIs and retains query getter failures before publishing', () => {
    /** Complete bases receive no methods if standard records admission fails. */
    const base = (): IStorageBase => ({
      backend: 'records-admission',
      capabilities: {
        syncRead: false,
        binary: false,
        records: true,
        transactions: false,
        iteration: false,
        secondaryIndexes: false,
        changeFeed: false,
        maxValueBytes: undefined,
        opaqueEntries: false
      },
      dispose: async () => undefined,
      [Symbol.asyncDispose]: async () => undefined
    })
    for (const api of [
      {},
      { query: () => undefined },
      { query: 1, removeByPrefix: () => undefined }
    ]) {
      const resource = base()
      expect(() =>
        provideCapabilities(resource, [implement(records, api as unknown as IRecordsApi)])
      ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
      expect(Object.hasOwn(resource, 'use')).toBe(false)
      expect(hasStorageCapability(resource, records)).toBe(false)
    }
    const original = new Error('record query getter failed')
    const resource = base()
    const api = {
      get query(): never {
        throw original
      },
      removeByPrefix: async () => 0
    }
    expect(() => provideCapabilities(resource, [implement(records, api)])).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT', cause: original })
    )
    expect(Object.hasOwn(resource, 'use')).toBe(false)
    expect(hasStorageCapability(resource, records)).toBe(false)
  })
})

describe('shared record query execution', () => {
  it.each(['resolve', 'reject'] as const)(
    'keeps the complete unawaited terminal owned through mapper %s',
    async (outcome) => {
      /** This real controller models the backend callback returning without awaiting all. */
      const base: IStorageBase = {
        backend: 'composed-query',
        capabilities: {
          syncRead: false,
          binary: false,
          records: true,
          transactions: true,
          iteration: true,
          secondaryIndexes: false,
          changeFeed: false,
          maxValueBytes: undefined,
          opaqueEntries: false
        },
        dispose: async () => undefined,
        [Symbol.asyncDispose]: async () => undefined
      }
      /** The normalizer preserves the same first failure chosen by the original transaction. */
      const owner = createTransactionOwner<unknown, object>(base, normalizeQueryFixtureFailure)
      /** No other object may supply cursor or transaction authority. */
      const scope = {}
      /** Actual rollback notification records the original owner's first normalized error. */
      let firstFailure: unknown
      const controller = owner.register(scope, {
        createScope: () => ({}),
        onFailure: (error) => {
          firstFailure = error
        }
      })
      /** The mapper remains accepted work between two native advances. */
      const entered = Promise.withResolvers<void>()
      /** The mapper failure must be observed after callback admission closes. */
      const mapping = Promise.withResolvers<number>()
      /** Native cleanup is counted separately from logical query completion. */
      let closed = 0
      /** The original iterator advances just one actual row. */
      let advanced = false
      const query = createRecordQuery<{ total: number }, undefined>({
        pushdown: noPushdown,
        execute: () =>
          owner.registerIterator(scope, {
            next: async (): Promise<IteratorResult<readonly [string, unknown]>> =>
              advanced
                ? { done: true, value: undefined }
                : ((advanced = true), { done: false, value: ['key', { total: 1 }] }),
            close: () => {
              closed++
            }
          })
      })
      const pending = query
        .select(async () => {
          entered.resolve()
          return await mapping.promise
        })
        .all()
      void pending.catch(() => undefined)
      await entered.promise
      controller.stopAdmission()
      /** A commit candidate must remain pending until the whole accepted terminal settles. */
      let completed = false
      const finalized = controller.runFinalizers()
      void finalized.then(
        () => {
          completed = true
        },
        () => undefined
      )
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      expect(completed).toBe(false)
      expect(closed).toBe(0)
      if (outcome === 'reject') {
        const original = new RangeError('unawaited mapper failed')
        mapping.reject(original)
        await expect(pending).rejects.toBe(original)
        await expect(finalized).rejects.toBe(firstFailure)
        expect(firstFailure).toBe(original)
      } else {
        mapping.resolve(7)
        await expect(pending).resolves.toEqual([7])
        await expect(finalized).resolves.toBeUndefined()
        expect(firstFailure).toBeUndefined()
      }
      expect(closed).toBe(1)
    }
  )
  it('constructs immutable branches without I/O and combines all where forms before one select', async () => {
    let opened = 0
    let closed = 0
    const rows: IOrder[] = [
      { status: 'paid', total: 12, address: { city: 'Shanghai' } },
      { status: 'paid', total: 15, address: { city: 'Beijing' } },
      { status: 'pending', total: 3 }
    ]
    const query = createRecordQuery<IOrder>({
      pushdown: noPushdown,
      execute: () => {
        opened++
        return ownedRows(rows, () => {
          closed++
        })
      }
    })
    const paid = query.where({ status: 'paid' })
    const shanghai = paid.where('address.city', 'eq', 'Shanghai').where((row) => row.total > 10)
    const selected = shanghai.select('total')
    expect(opened).toBe(0)
    await expect(selected.all()).resolves.toEqual([{ total: 12 }])
    await expect(paid.all()).resolves.toEqual(rows.slice(0, 2))
    await expect(query.all()).resolves.toEqual(rows)
    expect(opened).toBe(3)
    expect(closed).toBe(3)
    expect(Object.isFrozen(query)).toBe(true)
    expect('select' in selected).toBe(false)
    expect('where' in selected).toBe(false)
    expectTypeOf(selected.all).returns.toEqualTypeOf<Promise<Pick<IOrder, 'total'>[]>>()
    function invalidTypes() {
      // @ts-expect-error A selected result has no second select transition.
      selected.select('total')
      // @ts-expect-error Path operands follow their exact field domain.
      query.where('total', 'gt', 'wrong')
    }
    void invalidTypes
  })

  it('hands the sole AST and projection to native execution and preserves the longest safe prefix', async () => {
    let calls = 0
    let conditions: readonly IQueryCondition[] = []
    let fields: readonly string[] | undefined
    const support: IQueryPushdown = {
      source: 'indexed-fixture',
      index: 'by-total',
      operations: [QueryOperation.where, QueryOperation.select],
      operators: [QueryOperator.gte, QueryOperator.eq]
    }
    const query = createRecordQuery<IOrder>({
      pushdown: support,
      execute: (input) => {
        calls++
        conditions = input.conditions
        fields = input.fields
        return ownedRows(fields === undefined ? [{ total: 12, status: 'paid' }] : [{ total: 12 }])
      }
    })
    const native = query
      .where({ total: { gte: 10 } })
      .select('total')
      .requirePushdown()
    expect(native.explain()).toEqual({
      source: 'indexed-fixture',
      index: 'by-total',
      fullScan: false,
      pushed: [
        { operation: 'where', index: 'by-total' },
        { operation: 'select', index: 'by-total' }
      ],
      client: []
    })
    expect(calls).toBe(0)
    await expect(native.all()).resolves.toEqual([{ total: 12 }])
    expect(fields).toEqual(['total'])
    expect(conditions).toEqual([
      { kind: 'and', conditions: [{ kind: 'field', path: ['total'], operator: 'gte', value: 10 }] }
    ])
    const mixed = query
      .where({ total: { gte: 10 } })
      .where((row) => row.status === 'paid')
      .where({ status: 'paid' })
      .select(async (row) => row.total * 2)
    expect(mixed.explain().pushed.map((step) => step.operation)).toEqual(['where'])
    expect(mixed.explain().client.map((step) => step.operation)).toEqual([
      'predicate',
      'where',
      'mapper'
    ])
    await expect(mixed.all()).resolves.toEqual([24])
    expect(fields).toBeUndefined()
    expect(conditions).toHaveLength(1)
    expectTypeOf(mixed.all).returns.toEqualTypeOf<Promise<number[]>>()
    await expect(mixed.requirePushdown().all()).rejects.toMatchObject({
      code: 'QUERY_NOT_PUSHABLE',
      message: expect.stringContaining('client')
    })
    expect(calls).toBe(2)
  })

  it('retains getter snapshots, typed transaction context and object identity as client work', async () => {
    let descriptors = 0
    let contextReads = 0
    const identity = { stamp: new Date(1) }
    const operations = [QueryOperation.where]
    const query = createRecordQuery<{ identity: typeof identity }, undefined>({
      get pushdown() {
        descriptors++
        return { source: 'fixture', operations, operators: [QueryOperator.eq] }
      },
      execute: ({ ctx }) => {
        expect(ctx).toBeUndefined()
        return ownedRows([{ identity }, { identity: { stamp: new Date(1) } }])
      }
    }).where({ identity: { eq: identity } })
    operations.length = 0
    expect(descriptors).toBe(1)
    expect(query.explain().client[0]?.reason).toContain('identity')
    await expect(query.all()).resolves.toEqual([{ identity }])
    const contextual = createRecordQuery<IOrder>({
      pushdown: noPushdown,
      execute: ({ ctx }) => {
        expect(ctx?.pageSize).toBe(8)
        return ownedRows([])
      }
    })
    await contextual.all({
      get pageSize() {
        contextReads++
        return 8
      }
    })
    expect(contextReads).toBe(1)
    function invalidTypes() {
      // @ts-expect-error Transaction-bound queries cannot accept operation contexts.
      query.all({ timeoutMs: 1 })
    }
    void invalidTypes
  })

  it('awaits accepted mapping and cleanup, preserving the first native error and cleanup trace', async () => {
    const gate = Promise.withResolvers<number>()
    const cleanup = Promise.withResolvers<void>()
    let closed = 0
    const query = createRecordQuery<IOrder>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows([{ total: 1 }], () => {
          closed++
          return cleanup.promise
        })
    })
    const pending = query.select(() => gate.promise).all()
    await Promise.resolve()
    expect(closed).toBe(0)
    gate.resolve(9)
    await Promise.resolve()
    await Promise.resolve()
    cleanup.resolve()
    await expect(pending).resolves.toEqual([9])
    expect(closed).toBe(1)
    const original = new RangeError('mapper failed')
    const closeFailure = new Error('cursor cleanup failed')
    const failing = createRecordQuery<IOrder>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows([{ total: 1 }], () => {
          throw closeFailure
        })
    }).select(() => {
      throw original
    })
    await expect(failing.all()).rejects.toBe(original)
    expect(original).toMatchObject({
      code: 'INVALID_ARGUMENT',
      errors: [expect.objectContaining({ cause: closeFailure })]
    })
    const frozen = Object.freeze(new TypeError('frozen mapper'))
    const frozenQuery = createRecordQuery<IOrder>({
      pushdown: noPushdown,
      execute: () => ownedRows([{ total: 1 }])
    }).select(() => {
      throw frozen
    })
    await expect(frozenQuery.all()).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      errors: [frozen, expect.any(Error)]
    })
  })

  it('closes on cancellation or source failure and rejects invalid input before opening a cursor', async () => {
    const abort = new AbortController()
    const reason = new Error('cancel query')
    let opened = 0
    let closed = 0
    const query = createRecordQuery<IOrder>({
      pushdown: noPushdown,
      execute: () => {
        opened++
        return ownedRows([{ total: 1 }], () => {
          closed++
        })
      }
    })
    await expect(
      query
        .select(() => {
          abort.abort(reason)
          return 1
        })
        .all({ signal: abort.signal })
    ).rejects.toMatchObject({ code: 'ABORTED', cause: reason })
    expect(closed).toBe(1)
    await expect(query.all({ signal: abort.signal })).rejects.toMatchObject({
      code: 'ABORTED',
      cause: reason
    })
    expect(opened).toBe(1)
    expect(() => query.select(...([] as unknown as ['total']))).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() => query.where('constructor.x' as 'total', 'eq', 1)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    const original = new Error('native next failed')
    const failedSource = createRecordQuery<IOrder>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows(
          [],
          () => {
            closed++
          },
          original
        )
    })
    await expect(failedSource.all()).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
      cause: original
    })
    expect(closed).toBe(2)
  })
})
