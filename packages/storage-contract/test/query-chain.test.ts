import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  compileStorageWhere,
  assertStorageKey,
  KEY_DOMAIN_LIMITS,
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
  type IStorageKey,
  type IStorageIterator,
  type IQueryPushdown,
  type IRecordsApi,
  type IWhere,
  type IQueryShape,
  type IQueryResultOf,
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
function ownedRows<TKey extends IStorageKey = string>(
  rows: readonly unknown[],
  close: () => PromiseLike<void> | void = () => undefined,
  nextFailure?: Error,
  options?: {
    readonly onNext?: () => void
    readonly onStopAdmission?: (stop: () => void) => void
    readonly key?: (row: unknown, position: number) => TKey
  }
): IStorageIterator<readonly [TKey | string, unknown]> {
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
  const registration = owner.register(scope, {
    createScope: () => ({}),
    onFailure: () => undefined
  })
  options?.onStopAdmission?.(() => registration.stopAdmission())
  /** The port advances its original source once for every native next. */
  let index = 0
  return owner.registerIterator(scope, {
    next: async (): Promise<IteratorResult<readonly [TKey | string, unknown]>> => {
      options?.onNext?.()
      if (nextFailure !== undefined) throw nextFailure
      if (index >= rows.length) return { done: true, value: undefined }
      /** One source projection supplies the existing canonical key, never a client-side re-sort. */
      const position = index++
      /** The native row and its once-projected key remain paired for this source advance. */
      const row = rows[position]
      return { done: false, value: [options?.key?.(row, position) ?? String(position), row] }
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

describe('record query Feature methods', () => {
  it('retains method references, receiver and result inference across every existing transition', async () => {
    /** The original Feature method observes each actual query receiver without a wrapper. */
    const methods = {
      feature<T>(this: T): T {
        return this
      }
    }
    /** Input rows remain on the original source cursor. */
    const query = createRecordQuery<IOrder, undefined, typeof methods>(
      {
        pushdown: noPushdown,
        execute: () => ownedRows([{ status: 'paid', total: 4 }])
      },
      methods
    )
    /** Every existing branch must retain the method itself and use its real fluent receiver. */
    const branches = [
      query,
      query.where({ status: 'paid' }),
      query.select('total'),
      query.select((row) => row.total),
      query.requirePushdown(),
      query.limit(1),
      query.orderByComparator((left, right) => left.total - right.total).limit(1)
    ]
    for (const branch of branches) {
      expect(branch.feature).toBe(methods.feature)
      expect(branch.feature()).toBe(branch)
    }
    /** Complete terminal extraction supports projected shapes and zero transaction context. */
    const selected = query.select('total')
    expectTypeOf<typeof selected>().toExtend<IQueryShape>()
    expectTypeOf<IQueryResultOf<typeof selected>>().toEqualTypeOf<Pick<IOrder, 'total'>[]>()
    expect(await selected.all()).toEqual([{ total: 4 }])
    expect(
      'feature' in createRecordQuery({ pushdown: noPushdown, execute: () => ownedRows([]) })
    ).toBe(false)
  })

  it('rejects built-in collisions before opening the original cursor', () => {
    /** No feature may replace an original terminal or state transition. */
    const execute = vi.fn(() => ownedRows([]))
    expect(() => createRecordQuery({ pushdown: noPushdown, execute }, { all() {} })).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(execute).not.toHaveBeenCalled()
  })
})

describe('bounded record execution', () => {
  it.each([
    [undefined, ['a', 'b']],
    ['next', ['b', 'c']],
    ['prev', ['a', 'c']]
  ] as const)(
    'resolves comparator ties by optional source key direction %s',
    async (direction, ids) => {
      /** Source positions deliberately differ from the compound index-key/id order. */
      const rows = [
        { id: 'a', email: 'z' },
        { id: 'b', email: 'a' },
        { id: 'c', email: 'a' }
      ]
      /** Each original cursor advance supplies its compound key exactly once. */
      const project = vi.fn((value: unknown) => {
        /** The actual indexed source knows its row shape and supplies canonical key components. */
        const row = value as (typeof rows)[number]
        return [row.email, row.id]
      })
      /** The shared query owns bounded ordering while the source owns the actual compound key. */
      const query = createRecordQuery<(typeof rows)[number]>({
        pushdown: noPushdown,
        tieBreakByKey: direction === undefined ? undefined : { direction, parts: true },
        execute: () => ownedRows(rows, undefined, undefined, { key: project })
      })
        .where((row) => row.email.length > 0)
        .orderByComparator(() => 0)
        .limit(2)
      expect(await query.select('id').all()).toEqual(ids.map((id) => ({ id })))
      /** Public iterator results contain no internal key metadata after projection. */
      const stream = query.select((row) => row.id).stream()
      for (const id of ids) await expect(stream.next()).resolves.toEqual({ done: false, value: id })
      await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
      expect(project).toHaveBeenCalledTimes(rows.length * 2)
    }
  )

  it('captures key direction once and detaches mutable compound keys without replaying source projection', async () => {
    /** The source reuses one mutable key buffer while the heap retains only three winners. */
    const rows = Array.from({ length: 257 }, (_, id) => ({ id, rank: (id * 37) % 257 }))
    /** A native source may reuse mutable key components between distinct advances. */
    const key: IStorageKey[] = [new Date(0), '']
    /** Direction is captured during source admission rather than read during comparisons. */
    let direction: 'next' | 'prev' = 'next'
    /** Borrowed source metadata must be read once even across every heap comparison. */
    let directionReads = 0
    /** Comparing values never repeats the original source's index projection. */
    let comparisons = 0
    /** The source owns one projection per candidate, before the original client reader sees it. */
    const project = vi.fn((value: unknown) => {
      /** This physical source retains its actual row-to-index-key calculation. */
      const row = value as (typeof rows)[number]
      ;(key[0] as Date).setTime(row.rank)
      key[1] = String(row.id)
      return key
    })
    /** Bounded ordering consumes the canonical source key rather than retaining the full input. */
    const query = createRecordQuery<(typeof rows)[number]>({
      pushdown: noPushdown,
      get tieBreakByKey() {
        directionReads++
        return { direction, parts: true as const }
      },
      execute: () => ownedRows(rows, undefined, undefined, { key: project })
    })
    direction = 'prev'
    expect(
      (
        await query
          .orderByComparator(() => {
            comparisons++
            return 0
          })
          .limit(3)
          .all()
      ).map((row) => row.rank)
    ).toEqual([0, 1, 2])
    expect(directionReads).toBe(1)
    expect(project).toHaveBeenCalledTimes(rows.length)
    expect(comparisons).toBeLessThan(rows.length * 4)
  })

  it('preserves each logical key budget inside an author-only compound tie key', async () => {
    /** An existing legal index key can already use the complete recursive depth budget. */
    function deepest(leaf: string): IStorageKey {
      /** The original key owner measures the first value at depth zero. */
      let key: IStorageKey = leaf
      for (let depth = 0; depth < KEY_DOMAIN_LIMITS.maxDepth; depth++) key = [key]
      return key
    }
    /** An existing legal record id can independently use the complete visited-node budget. */
    const id = Array.from({ length: KEY_DOMAIN_LIMITS.maxNodes - 1 }, () => 'id')
    /** The source's extra container is sorting metadata, not a newly authored user key. */
    const rows = [
      { value: 'z', key: [deepest('z'), id] },
      { value: 'a', key: [deepest('a'), id] }
    ]
    for (const row of rows) for (const part of row.key) assertStorageKey(part, undefined)
    /** The same physical source provides already-validated logical components to the owner. */
    const execute = () =>
      ownedRows(rows, undefined, undefined, {
        key: (value) => (value as (typeof rows)[number]).key
      })
    /** Explicit parts mode preserves each prior logical key's existing limits. */
    const query = createRecordQuery<(typeof rows)[number]>({
      pushdown: noPushdown,
      execute,
      tieBreakByKey: { direction: 'next', parts: true }
    })
    expect(
      (
        await query
          .orderByComparator(() => 0)
          .limit(1)
          .all()
      ).map((row) => row.value)
    ).toEqual(['a'])
    /** Omitted parts still treats an array as one user key with the unchanged total limits. */
    const ordinary = createRecordQuery({
      pushdown: noPushdown,
      execute,
      tieBreakByKey: { direction: 'next' }
    })
    await expect(
      ordinary
        .orderByComparator(() => 0)
        .limit(1)
        .all()
    ).rejects.toMatchObject({ code: 'INVALID_KEY' })
  })

  it('rejects an invalid key tie direction before opening a source and preserves its getter cause', () => {
    /** New optional metadata uses the existing source-admission error boundary. */
    const execute = vi.fn(() => ownedRows([]))
    expect(() =>
      createRecordQuery({ pushdown: noPushdown, execute, tieBreakByKey: 'sideways' as never })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    /** Reflection failures preserve the original object rather than a regenerated message. */
    const cause = new Error('source key direction getter')
    expect(() =>
      createRecordQuery({
        pushdown: noPushdown,
        execute,
        get tieBreakByKey(): never {
          throw cause
        }
      })
    ).toThrowError(expect.objectContaining({ cause }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('streams from the original source lazily and stops ordinary limit without reading another candidate', async () => {
    /** Source advancement is observable independently of construction and terminal materialization. */
    let advanced = 0
    let closed = 0
    const query = createRecordQuery<number>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows(
          [3, 2, 1],
          () => {
            closed++
          },
          undefined,
          {
            onNext: () => {
              advanced++
            }
          }
        )
    })
    const stream = query.limit(2).stream()
    expect(advanced).toBe(0)
    await expect(stream.next()).resolves.toEqual({ done: false, value: 3 })
    expect(advanced).toBe(1)
    await expect(stream.next()).resolves.toEqual({ done: false, value: 2 })
    await expect(stream.next()).resolves.toEqual({ done: true, value: undefined })
    expect(advanced).toBe(2)
    expect(closed).toBe(1)
    expect(stream.dispose()).toBe(stream.dispose())
    expect(stream[Symbol.asyncDispose]()).toBe(stream[Symbol.asyncDispose]())
  })

  it('retains only the bounded comparator winners with stable ties and the same all and stream results', async () => {
    /** A fixed permutation defeats a full-input sort while a three-entry heap stays linear here. */
    const rows = Array.from({ length: 257 }, (_, index) => ({
      value: (index * 37) % 257,
      id: index
    }))
    let comparisons = 0
    const query = createRecordQuery<{ value: number; id: number }>({
      pushdown: noPushdown,
      execute: () => ownedRows(rows)
    })
    const bounded = query
      .orderByComparator((left, right) => {
        comparisons++
        return left.value - right.value
      })
      .limit(3)
    expect((await bounded.all()).map((row) => row.value)).toEqual([0, 1, 2])
    expect(comparisons).toBeLessThan(rows.length * 3)
    const streamed: number[] = []
    for await (const row of bounded.stream()) streamed.push(row.value)
    expect(streamed).toEqual([0, 1, 2])
    const ties = createRecordQuery<{ value: number; id: string }>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows([
          { value: 1, id: 'a' },
          { value: 0, id: 'b' },
          { value: 1, id: 'c' },
          { value: 1, id: 'd' }
        ])
    })
    expect(
      await ties
        .orderByComparator((left, right) => left.value - right.value)
        .limit(3)
        .select('id')
        .all()
    ).toEqual([{ id: 'b' }, { id: 'a' }, { id: 'c' }])
  })

  it('rejects missing bounds and invalid limits before source execution, including bypassed static states', async () => {
    const execute = vi.fn(() => ownedRows([1, 2]))
    const query = createRecordQuery<number, undefined>({ pushdown: noPushdown, execute })
    for (const count of [-1, 1.5, Infinity, NaN])
      expect(() => query.limit(count)).toThrowError(
        expect.objectContaining({ code: 'INVALID_ARGUMENT' })
      )
    const pending = query.orderByComparator((left, right) => left - right)
    /** Static bypass still reaches the original planner's admission boundary. */
    const bypassed = pending as unknown as {
      all(): Promise<unknown>
      stream(): IStorageIterator<number>
    }
    await expect(bypassed.all()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(() => bypassed.stream()).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(execute).not.toHaveBeenCalled()
    function invalidTypes(): void {
      // @ts-expect-error Comparator results expose no terminal until an explicit limit.
      pending.all()
      // @ts-expect-error Comparator results expose no stream until an explicit limit.
      pending.stream()
      // @ts-expect-error No selector ordering is advertised by this implementation slice.
      query.orderBy((value: number) => value)
      // @ts-expect-error Transaction record queries cannot receive a new context.
      query.limit(1).stream({ timeoutMs: 1 })
    }
    void invalidTypes
  })

  it('executes zero limit without scanning and reports client-only bounded controls honestly', async () => {
    let advanced = 0
    let closed = 0
    const query = createRecordQuery<number>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows(
          [1],
          () => {
            closed++
          },
          undefined,
          {
            onNext: () => {
              advanced++
            }
          }
        )
    })
    await expect(
      query
        .orderByComparator((left, right) => left - right)
        .limit(0)
        .all()
    ).resolves.toEqual([])
    expect(advanced).toBe(0)
    expect(closed).toBe(1)
    expect(
      query
        .limit(1)
        .explain()
        .client.map((step) => step.operation)
    ).toEqual(['limit'])
    await expect(query.limit(1).requirePushdown().all()).rejects.toMatchObject({
      code: 'QUERY_NOT_PUSHABLE'
    })
  })

  it('keeps mapped next accepted through concurrent disposal using the original resource owner', async () => {
    const entered = Promise.withResolvers<void>()
    const mapping = Promise.withResolvers<number>()
    let closed = 0
    const query = createRecordQuery<number>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows([1], () => {
          closed++
        })
    })
    const stream = query
      .select(async () => {
        entered.resolve()
        return mapping.promise
      })
      .stream()
    const pending = stream.next()
    await entered.promise
    const cleanup = stream.dispose()
    expect(cleanup).toBe(stream.dispose())
    await Promise.resolve()
    expect(closed).toBe(0)
    mapping.resolve(7)
    await expect(pending).resolves.toEqual({ done: false, value: 7 })
    await cleanup
    expect(closed).toBe(1)
  })

  it('retains original scope admission for buffered comparator results after native exhaustion', async () => {
    let stop: (() => void) | undefined
    let closed = 0
    const query = createRecordQuery<number, undefined>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows(
          [3, 1, 2],
          () => {
            closed++
          },
          undefined,
          {
            onStopAdmission: (current) => {
              stop = current
            }
          }
        )
    })
    const stream = query
      .orderByComparator((left, right) => left - right)
      .limit(3)
      .stream()
    await expect(stream.next()).resolves.toEqual({ done: false, value: 1 })
    expect(closed).toBe(1)
    stop!()
    await expect(stream.next()).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await stream.dispose()
  })

  it('records comparator failure before cleanup and preserves native identity', async () => {
    const original = new RangeError('comparator failed')
    let closed = 0
    const query = createRecordQuery<number>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows([3, 2, 1], () => {
          closed++
        })
    })
    await expect(
      query
        .orderByComparator(() => {
          throw original
        })
        .limit(2)
        .all()
    ).rejects.toBe(original)
    expect(original).toMatchObject({ source: '@migaia/storage-contract', code: 'INVALID_ARGUMENT' })
    expect(closed).toBe(1)
  })
})

describe('unregistered source resource streaming', () => {
  it('closes the original native resource once without materializing all rows', async () => {
    let advanced = 0
    let closed = 0
    /** A root backend resource need not be registered as a transaction iterator. */
    const native = ownedRows(
      [1, 2, 3],
      () => {
        closed++
      },
      undefined,
      {
        onNext: () => {
          advanced++
        }
      }
    )
    const forwarded: IStorageIterator<readonly [string, unknown]> = {
      next: () => native.next(),
      dispose: () => native.dispose(),
      [Symbol.asyncDispose]: () => native[Symbol.asyncDispose](),
      [Symbol.asyncIterator]() {
        return this
      }
    }
    const query = createRecordQuery<number>({ pushdown: noPushdown, execute: () => forwarded })
    const stream = query
      .limit(1)
      .select((value) => value + 1)
      .stream()
    expect(advanced).toBe(0)
    await expect(stream.next()).resolves.toEqual({ done: false, value: 2 })
    expect(advanced).toBe(1)
    expect(stream.dispose()).toBe(stream.dispose())
    await stream.dispose()
    expect(closed).toBe(1)
  })
})

describe('bounded query operation context', () => {
  it('observes cancellation triggered by the final selected getter even when limit prevents another native next', async () => {
    const controller = new AbortController()
    let closed = 0
    const row = {
      get total() {
        controller.abort('selected getter')
        return 1
      }
    }
    const query = createRecordQuery<{ total: number }>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows([row], () => {
          closed++
        })
    })
    await expect(
      query.limit(1).select('total').all({ signal: controller.signal })
    ).rejects.toMatchObject({ code: 'ABORTED', cause: 'selected getter' })
    expect(closed).toBe(1)
  })
})

describe('root mapped read cleanup', () => {
  it.each(['resolve', 'reject'] as const)(
    'drains accepted async mapping before main or symbolic cleanup can settle: %s',
    async (outcome) => {
      /** This legitimate source wrapper has native ownership but no transaction registration itself. */
      let closed = 0
      const native = ownedRows([1], () => {
        closed++
      })
      const source: IStorageIterator<readonly [string, unknown]> = {
        next: () => native.next(),
        dispose: () => native.dispose(),
        [Symbol.asyncDispose]: () => native[Symbol.asyncDispose](),
        [Symbol.asyncIterator]() {
          return this
        }
      }
      /** The mapped read remains accepted work after native next has already returned its row. */
      const entered = Promise.withResolvers<void>()
      const mapping = Promise.withResolvers<number>()
      const query = createRecordQuery<number>({ pushdown: noPushdown, execute: () => source })
      const stream = query
        .select(async () => {
          entered.resolve()
          return mapping.promise
        })
        .stream()
      const pending = stream.next()
      await entered.promise
      const cleanup = stream.dispose()
      const symbolic = stream[Symbol.asyncDispose]()
      expect(cleanup).toBe(stream.dispose())
      expect(symbolic).toBe(stream[Symbol.asyncDispose]())
      expect(symbolic).not.toBe(cleanup)
      let mainSettled = false
      let symbolicSettled = false
      void cleanup.then(() => {
        mainSettled = true
      })
      void symbolic.then(() => {
        symbolicSettled = true
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(mainSettled).toBe(false)
      expect(symbolicSettled).toBe(false)
      expect(closed).toBe(0)
      if (outcome === 'reject') {
        const original = new RangeError('root mapper failed')
        mapping.reject(original)
        await expect(pending).rejects.toBe(original)
        expect(original).toMatchObject({
          source: '@migaia/storage-contract',
          code: 'INVALID_ARGUMENT'
        })
      } else {
        mapping.resolve(7)
        await expect(pending).resolves.toEqual({ done: false, value: 7 })
      }
      await cleanup
      await symbolic
      expect(mainSettled).toBe(true)
      expect(symbolicSettled).toBe(true)
      expect(closed).toBe(1)
    }
  )
})
