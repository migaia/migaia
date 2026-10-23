import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  compileStorageWhere,
  compileStorageQueryCondition,
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
  type IRecordQuery,
  type IQueryResult,
  type IRecordQuerySource,
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
  it('compiles source-supplied canonical AST with the original condition compiler', async () => {
    const candidates: IOrder[] = [
      { status: 'paid', total: 12, created: new Date(10) },
      { status: 'paid', total: 9, created: new Date(20) },
      { status: 'cancelled', total: 12, created: new Date(30) }
    ]
    const execute: IRecordQuerySource['execute'] = vi.fn(
      (input: Parameters<IRecordQuerySource['execute']>[0]) => {
        const predicates = input.conditions.map((condition) =>
          compileStorageQueryCondition<IOrder>(condition)
        )
        return ownedRows(
          candidates.filter((row) => predicates.every((predicate) => predicate(row)))
        )
      }
    )
    const query = createRecordQuery<IOrder>({
      pushdown: {
        source: 'canonical-ast-consumer',
        operators: ['in', 'gte'],
        operations: ['where']
      },
      execute
    })
      .where({ status: { in: ['paid'] }, created: { gte: new Date(5) }, total: { gte: 10 } })
      .requirePushdown()
    expect(await query.all()).toEqual([candidates[0]])
    expect(execute).toHaveBeenCalledTimes(1)
  })

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
    readonly asyncDisposeKey?: typeof Symbol.asyncDispose
  }
): IStorageIterator<readonly [TKey | string, unknown]> {
  /** The fixture base and its original owner expose the same host-selected resource key. */
  const asyncDisposeKey: typeof Symbol.asyncDispose =
    options?.asyncDisposeKey ?? Symbol.asyncDispose
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
    [asyncDisposeKey]: async () => undefined
  }
  /** Backend normalization keeps the original cursor error reachable through its existing code. */
  const owner = createTransactionOwner<unknown, object>(base, normalizeQueryFixtureFailure, {
    asyncDisposeKey
  })
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
    /** New terminals remain available through the original standard capability consumer. */
    await expect(store.use(records).query().where({ status: 'paid' }).firstOrThrow()).resolves.toBe(
      rows[0]
    )
    await expect(store.use(records).query().where({ status: 'paid' }).count()).resolves.toBe(1)
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

describe('record query terminals', () => {
  it('preserves all cancellation checkpoints through native EOF without another terminal read', async () => {
    /** The live signal getter exposes each original checkpoint without aborting the operation. */
    const aborted = vi.fn(() => false)
    /** Only the signal remains live after the operation context is captured. */
    const signal = {
      get aborted() {
        return aborted()
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined
    }
    /** An empty original cursor distinguishes EOF completion from user callback boundaries. */
    const query = createRecordQuery({ pushdown: noPushdown, execute: () => ownedRows([]) })
    await expect(query.all({ signal })).resolves.toEqual([])
    expect(aborted).toHaveBeenCalledTimes(6)
    /** The final partial chunk still observes cancellation after its user callback settles. */
    const controller = new AbortController()
    const partial = createRecordQuery({ pushdown: noPushdown, execute: () => ownedRows([1]) })
    await expect(
      partial.chunk(2, async () => controller.abort('chunk cancelled'), {
        signal: controller.signal
      })
    ).rejects.toMatchObject({ code: 'ABORTED', cause: 'chunk cancelled' })
  })

  it('retains terminal declarations for root, transaction and selected record shapes', () => {
    /** The three existing fluent contexts expose each new terminal without widening tx context. */
    function declarations(
      root: IRecordQuery<IOrder>,
      tx: IRecordQuery<IOrder, undefined>,
      selected: IQueryResult<Pick<IOrder, 'total'>>
    ): void {
      void [root.first(), tx.first(), selected.first()]
      void [root.maybe(), tx.maybe(), selected.maybe()]
      void [root.firstOrThrow(), tx.firstOrThrow(), selected.firstOrThrow()]
      void [root.pluck('total'), tx.pluck('total'), selected.pluck('total')]
      void [root.exists(), tx.exists(), selected.exists()]
      void [root.count(), tx.count(), selected.count()]
      void [root.each(() => undefined), tx.each(() => undefined), selected.each(() => undefined)]
      void [
        root.chunk(2, () => undefined),
        tx.chunk(2, () => undefined),
        selected.chunk(2, () => undefined)
      ]
      void [root.min('total'), tx.min('total'), selected.min('total')]
      void [root.max('total'), tx.max('total'), selected.max('total')]
      void [root.sum('total'), tx.sum('total'), selected.sum('total')]
      void [root.avg('total'), tx.avg('total'), selected.avg('total')]
      // @ts-expect-error A transaction query cannot introduce another operation context.
      void tx.first({})
      // @ts-expect-error A projected result cannot refer to a field it no longer contains.
      void selected.pluck('status')
    }
    void declarations
  })

  it('short-circuits presence reads, distinguishes undefined and closes every original cursor', async () => {
    /** Native advances and closes expose early termination through the existing author entry. */
    const next = vi.fn()
    /** Each invocation borrows a fresh original cursor, never a materialized query result. */
    const close = vi.fn(async () => undefined)
    /** Present undefined must remain distinguishable from an exhausted source. */
    const query = createRecordQuery<undefined>({
      pushdown: noPushdown,
      execute: () => ownedRows([undefined, undefined], close, undefined, { onNext: next })
    })
    await expect(query.first()).resolves.toBeUndefined()
    await expect(query.maybe()).resolves.toEqual({ some: true, value: undefined })
    await expect(query.firstOrThrow()).resolves.toBeUndefined()
    await expect(query.exists()).resolves.toBe(true)
    expect(next).toHaveBeenCalledTimes(4)
    expect(close).toHaveBeenCalledTimes(4)
    /** Empty results share normal cursor cleanup before exposing their distinct public terminal. */
    const empty = createRecordQuery<undefined>({
      pushdown: noPushdown,
      execute: () => ownedRows([], close)
    })
    await expect(empty.maybe()).resolves.toEqual({ some: false })
    await expect(empty.exists()).resolves.toBe(false)
    await expect(empty.firstOrThrow()).rejects.toMatchObject({
      source: '@migaia/storage-contract',
      code: 'QUERY_EMPTY_RESULT'
    })
    expect(close).toHaveBeenCalledTimes(7)
    /** A comparator first is the explicitly documented one-row bounded query. */
    const ordered = createRecordQuery<number>({
      pushdown: noPushdown,
      execute: () => ownedRows([3, 1, 2])
    })
    await expect(ordered.orderByComparator((a, b) => a - b).first()).resolves.toBe(1)
  })

  it('shares conditions and projection across count, pluck, sequential each and bounded chunk', async () => {
    /** The same input validates unselected and selected result terminal types. */
    const query = createRecordQuery<IOrder>({
      pushdown: noPushdown,
      execute: () => ownedRows([{ total: 1 }, { total: 2 }, { total: 3 }, { total: 4 }])
    }).where('total', 'gt', 1)
    await expect(query.count()).resolves.toBe(3)
    await expect(query.pluck('total')).resolves.toEqual([2, 3, 4])
    /** A callback completes before the next row can enter it. */
    const seen: number[] = []
    await expect(
      query
        .select((row) => row.total)
        .each(async (row, index) => {
          await Promise.resolve()
          expect(index).toBe(seen.length)
          seen.push(row)
        })
    ).resolves.toBe(3)
    expect(seen).toEqual([2, 3, 4])
    /** Only one explicit chunk is retained between callbacks, including the final partial chunk. */
    const chunks: number[][] = []
    await expect(
      query
        .select((row) => row.total)
        .chunk(2, async (rows) => {
          await Promise.resolve()
          chunks.push([...rows])
        })
    ).resolves.toBe(3)
    expect(chunks).toEqual([[2, 3], [4]])
    expectTypeOf(query.pluck('total')).toEqualTypeOf<Promise<number[]>>()
    expectTypeOf(query.maybe()).toEqualTypeOf<
      Promise<{ readonly some: true; readonly value: IOrder } | { readonly some: false }>
    >()
  })

  it('accumulates numeric statistics in one pass and preserves empty and optional-field semantics', async () => {
    /** The source counter detects repeated scans inside any single aggregate. */
    const next = vi.fn()
    /** Optional numeric fields skip absence; zero and negative values remain actual samples. */
    const query = createRecordQuery<{ value?: number | null; label: string }>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows(
          [{ value: -2 }, { value: 0 }, {}, { value: null }, { value: 5 }],
          async () => undefined,
          undefined,
          { onNext: next }
        )
    })
    await expect(query.min('value')).resolves.toEqual({ some: true, value: -2 })
    expect(next).toHaveBeenCalledTimes(6)
    await expect(query.max('value')).resolves.toEqual({ some: true, value: 5 })
    await expect(query.sum('value')).resolves.toBe(3)
    await expect(query.avg('value')).resolves.toEqual({ some: true, value: 1 })
    /** Selecting a numeric field retains the same typed streaming statistics. */
    await expect(query.select('value').sum('value')).resolves.toBe(3)
    /** No row and an absent optional number both provide no statistical sample. */
    const empty = query.limit(0)
    await expect(empty.min('value')).resolves.toEqual({ some: false })
    await expect(empty.max('value')).resolves.toEqual({ some: false })
    await expect(empty.avg('value')).resolves.toEqual({ some: false })
    await expect(empty.sum('value')).resolves.toBe(0)
    /** Invalid declarations are checked without executing unsupported calls. */
    function invalidTypes(): void {
      // @ts-expect-error Statistics accept only numeric fields.
      void query.sum('label')
      // @ts-expect-error Maybe requires discriminant narrowing before reading its payload.
      void query.maybe().then((result) => result.value)
    }
    void invalidTypes
  })

  it('counts filtered pages without executing comparator or selected callbacks', async () => {
    /** A count never needs values produced by either sorting or output mapping. */
    const compare = vi.fn((): number => {
      throw new Error('count must not compare')
    })
    /** The selected result changes public row type without changing cardinality. */
    const mapper = vi.fn((): string => {
      throw new Error('count must not map')
    })
    /** Native advance counts prove count streams until the retained page bound, without a heap. */
    const next = vi.fn()
    /** Every execution closes its original cursor exactly once. */
    const close = vi.fn(async () => undefined)
    /** Count applies actual filtering before the existing limit node. */
    const query = createRecordQuery<IOrder>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows([{ total: 1 }, { total: 4 }, { total: 2 }, { total: 3 }], close, undefined, {
          onNext: next
        })
    })
      .where('total', 'gt', 1)
      .orderByComparator(compare)
      .limit(2)
      .select(mapper)
    await expect(query.count()).resolves.toBe(2)
    expect(compare).not.toHaveBeenCalled()
    expect(mapper).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledTimes(1)
    /** A selected field getter is likewise output-only, so counting must never inspect it. */
    const projected = vi.fn((): never => {
      throw new Error('count must not project')
    })
    /** Field projection still uses its real public path rather than a test-only node. */
    const selected = createRecordQuery<{ selected: number }>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows([
          {
            get selected() {
              return projected()
            }
          }
        ])
    }).select('selected')
    await expect(selected.count()).resolves.toBe(1)
    expect(projected).not.toHaveBeenCalled()
  })

  it('keeps count native conditions and cleanup failures on the original planner and resource', async () => {
    /** Native input must contain the condition but no unused field projection. */
    const execute = vi.fn(
      ({ conditions, fields }: Parameters<IRecordQuerySource['execute']>[0]) => {
        expect(conditions).toHaveLength(1)
        expect(fields).toBeUndefined()
        return ownedRows([{ total: 2 }])
      }
    )
    /** A real native where declaration remains unchanged by count-only planning. */
    const query = createRecordQuery<IOrder>({
      pushdown: { source: 'count-native', operators: ['eq'], operations: ['where', 'select'] },
      execute
    })
      .where({ total: 2 })
      .select('total')
    await expect(query.count()).resolves.toBe(1)
    expect(execute).toHaveBeenCalledTimes(1)
    await expect(query.requirePushdown().count()).rejects.toMatchObject({
      code: 'QUERY_NOT_PUSHABLE'
    })
    expect(execute).toHaveBeenCalledTimes(1)
    /** A count predicate failure remains the primary even when physical close also fails. */
    const primary = new Error('count predicate failed')
    /** Original resource normalization keeps cleanup reachable on the primary's errors chain. */
    const cleanup = new Error('count cleanup failed')
    /** Physical close still runs once along the existing resource owner. */
    const close = vi.fn(async () => {
      throw cleanup
    })
    /** Skipped mapper errors cannot replace the one actually executed condition failure. */
    const failing = createRecordQuery<IOrder>({
      pushdown: noPushdown,
      execute: () => ownedRows([{ total: 1 }], close)
    })
      .where(() => {
        throw primary
      })
      .select(() => 0)
    await expect(failing.count()).rejects.toBe(primary)
    expect(primary).toMatchObject({ errors: [expect.objectContaining({ cause: cleanup })] })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid terminal input before I/O and preserves callback failure ahead of cleanup', async () => {
    /** Admission failures cannot acquire any original native cursor. */
    const execute = vi.fn(() => ownedRows([{ total: 1 }]))
    /** Each terminal is reached through the public shared query entry. */
    const query = createRecordQuery<IOrder>({ pushdown: noPushdown, execute })
    for (const size of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      await expect(query.chunk(size, () => undefined)).rejects.toMatchObject({
        code: 'INVALID_ARGUMENT'
      })
    await expect(query.each(null as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(query.pluck(null as never)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    /** Client-only reductions cannot silently bypass requirePushdown on an otherwise empty chain. */
    for (const terminal of [
      query.requirePushdown().count(),
      query.requirePushdown().sum('total'),
      query.requirePushdown().pluck('total'),
      query.requirePushdown().each(() => undefined),
      query.requirePushdown().chunk(1, () => undefined)
    ])
      await expect(terminal).rejects.toMatchObject({ code: 'QUERY_NOT_PUSHABLE' })
    expect(execute).not.toHaveBeenCalled()
    /** Native cleanup must not replace the original asynchronous callback rejection. */
    const primary = new Error('each failed')
    /** This independent close failure follows the first business callback error. */
    const cleanup = new Error('each cleanup failed')
    /** Original close reports once even while the registered terminal unwinds. */
    const close = vi.fn(async () => {
      throw cleanup
    })
    /** A single accepted terminal owns both callback completion and cleanup. */
    const failing = createRecordQuery<IOrder>({
      pushdown: noPushdown,
      execute: () => ownedRows([{ total: 1 }], close)
    })
    await expect(
      failing.each(async () => {
        throw primary
      })
    ).rejects.toBe(primary)
    expect(primary).toMatchObject({ errors: [expect.objectContaining({ cause: cleanup })] })
    expect(close).toHaveBeenCalledTimes(1)
    /** Numeric APIs still reject real invalid runtime data instead of returning NaN silently. */
    const invalid = createRecordQuery<{ total: number }>({
      pushdown: noPushdown,
      execute: () => ownedRows([{ total: Number.NaN }])
    })
    await expect(invalid.sum('total')).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('keeps the asynchronous each callback accepted until the original cursor can finish closing', async () => {
    /** The callback announces admission before disposal is requested on its actual resource. */
    const started = Promise.withResolvers<void>()
    /** Business completion remains inside the original accepted transaction operation. */
    const callback = Promise.withResolvers<void>()
    /** Physical cleanup must wait for the callback without introducing another cursor owner. */
    const close = vi.fn(async () => undefined)
    /** The public source exposes the same registered native resource that disposal later targets. */
    const iterator = ownedRows([1], close)
    /** All terminal behavior still enters through the original query author API. */
    const query = createRecordQuery<number>({ pushdown: noPushdown, execute: () => iterator })
    /** The callback owns no scheduler or cancellation adapter of its own. */
    const pending = query.each(async () => {
      started.resolve()
      await callback.promise
    })
    await started.promise
    /** The original resource's cached close remains pending during business work. */
    const disposed = iterator.dispose()
    expect(iterator.dispose()).toBe(disposed)
    await Promise.resolve()
    expect(close).not.toHaveBeenCalled()
    callback.resolve()
    await expect(pending).resolves.toBe(1)
    await disposed
    expect(close).toHaveBeenCalledTimes(1)
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
      // @ts-expect-error Comparator ordering cannot switch to selector ordering.
      pending.orderBy((value: number) => value)
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

describe('shared selector ordering and row controls', () => {
  it('uses canonical lexicographic selector keys once with a primary-key tail and no comparator state', async () => {
    /** Deliberately shuffled equal-selector rows must use their original logical primary key. */
    const values = [
      { id: 'c', group: 'a', value: 2 },
      { id: 'b', group: 'a', value: 1 },
      { id: 'a', group: 'a', value: 1 },
      { id: 'd', group: 'b', value: 99 }
    ]
    const group = vi.fn((row: (typeof values)[number]) => row.group)
    const value = vi.fn((row: (typeof values)[number]) => row.value)
    const close = vi.fn()
    const execute = vi.fn(() =>
      ownedRows(values, close, undefined, { key: (row) => (row as (typeof values)[number]).id })
    )
    const query = createRecordQuery<(typeof values)[number]>({ pushdown: noPushdown, execute })
      .orderBy(group)
      .orderBy(value, 'desc')
    expect(execute).not.toHaveBeenCalled()
    expect(await query.limit(3).select('id').all()).toEqual([{ id: 'c' }, { id: 'a' }, { id: 'b' }])
    expect(group).toHaveBeenCalledTimes(4)
    expect(value).toHaveBeenCalledTimes(4)
    /** A downstream first-row choice makes selector ordering relevant to cardinality itself. */
    const chosen = createRecordQuery<{ group: string; priority: number }>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows([
          { group: 'same', priority: 0 },
          { group: 'same', priority: 1 }
        ])
    })
      .orderBy((row) => row.priority, 'desc')
      .distinct('group')
      .where({ priority: { gt: 0 } })
    expect(await chosen.all()).toEqual([{ group: 'same', priority: 1 }])
    expect(await chosen.count()).toBe(1)
    expect(close).toHaveBeenCalledTimes(1)
    expect('orderByComparator' in query).toBe(false)
    expect(await query.count()).toBe(4)
    expect(group).toHaveBeenCalledTimes(4)
    expect(value).toHaveBeenCalledTimes(4)
    function invalidTypes(): void {
      // @ts-expect-error Selector ordering cannot acquire arbitrary comparator ordering.
      query.orderByComparator(() => 0)
    }
    void invalidTypes
  })

  it('streams SameValueZero distinct values and explicit skips without reading beyond the bound', async () => {
    /** Repeated NaN/zero values exercise Set identity without an alternate value codec. */
    const values = [1, 1, 0, -0, NaN, NaN, 2].map((value) => ({ value }))
    let advanced = 0
    const query = createRecordQuery<{ value: number }>({
      pushdown: noPushdown,
      execute: () => ownedRows(values, undefined, undefined, { onNext: () => advanced++ })
    })
      .distinct('value')
      .skip(1)
      .limit(2)
    expect(await query.pluck('value')).toEqual([0, NaN])
    expect(advanced).toBe(5)
    expect(query.explain().client.find((step) => step.operation === 'skip')?.reason).toContain(
      'O(n)'
    )
    expect(() => query.skip(-1)).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() => query.skip(1.5)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
  })

  it('sends native controls only to explicitly opted-in sources and preserves legacy execute arguments', async () => {
    /** Native engines accept the canonical steps, without their own fluent query implementation. */
    const execute = vi.fn(() => ownedRows([{ value: 2 }]))
    const query = createRecordQuery<{ value: number }>({
      pushdown: {
        source: 'native-controls',
        operators: [],
        operations: ['distinct', 'skip', 'limit']
      },
      nativeSteps: true,
      execute
    })
      .distinct('value')
      .skip(1)
      .limit(1)
      .requirePushdown()
    expect(query.explain().pushed.find((step) => step.operation === 'skip')?.reason).toContain(
      'O(n)'
    )
    expect(await query.all()).toEqual([{ value: 2 }])
    expect(execute.mock.calls[0]).toEqual([
      {
        conditions: [],
        fields: undefined,
        ctx: undefined,
        steps: [
          { operation: 'distinct', field: 'value' },
          { operation: 'skip', count: 1 },
          { operation: 'limit', count: 1 }
        ]
      }
    ])
    const legacy = vi.fn(() => ownedRows([{ value: 1 }, { value: 1 }, { value: 2 }]))
    const client = createRecordQuery<{ value: number }>({
      pushdown: {
        source: 'legacy-controls',
        operators: [],
        operations: ['distinct', 'skip', 'limit']
      },
      execute: legacy
    })
      .distinct('value')
      .skip(1)
      .limit(1)
    expect(await client.all()).toEqual([{ value: 2 }])
    expect(legacy.mock.calls[0]).toEqual([{ conditions: [], fields: undefined, ctx: undefined }])
    await expect(client.requirePushdown().all()).rejects.toMatchObject({
      code: 'QUERY_NOT_PUSHABLE'
    })
    expect(legacy).toHaveBeenCalledTimes(1)
  })

  it('preserves selector failure identity and closes the original accepted cursor once', async () => {
    const original = new TypeError('selector failed')
    const close = vi.fn()
    const query = createRecordQuery<number>({
      pushdown: noPushdown,
      execute: () => ownedRows([1], close)
    }).orderBy(() => {
      throw original
    })
    await expect(query.all()).rejects.toBe(original)
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe('shared keyset pages', () => {
  it('keeps canonical keyset continuity across insertions and deletions with fresh equivalent chains', async () => {
    /** A shared native collection identity survives new query descriptor objects. */
    const identity = Object.freeze({})
    const values = new Map(['d', 'a', 'c', 'b'].map((id) => [id, { id, enabled: true }]))
    const execute = vi.fn(() =>
      ownedRows([...values.values()], undefined, undefined, {
        key: (row) => (row as { id: string }).id
      })
    )
    const query = () =>
      createRecordQuery<{ id: string; enabled: boolean }>({
        pushdown: noPushdown,
        cursorSource: identity,
        execute
      }).where({ enabled: true })
    const first = await query().page(2)
    expect(first.items.map((row) => row.id)).toEqual(['a', 'b'])
    expect(first.next).toBeDefined()
    expect((await query().after(first.next!).limit(2).all()).map((row) => row.id)).toEqual([
      'c',
      'd'
    ])
    values.delete('a')
    values.delete('b')
    values.set('aa', { id: 'aa', enabled: true })
    values.set('e', { id: 'e', enabled: true })
    const second = await query().after(first.next!).page(2)
    expect(second.items.map((row) => row.id)).toEqual(['c', 'd'])
    expect((await query().after(second.next!).page(2)).items.map((row) => row.id)).toEqual(['e'])
  })

  it('maps only returned page items and keeps lookup, callbacks and cleanup in the original resource operation', async () => {
    const close = vi.fn()
    const mapper = vi.fn(async (row: { id: number }) => row.id * 10)
    const query = createRecordQuery<{ id: number }>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows([{ id: 3 }, { id: 1 }, { id: 2 }], close, undefined, {
          key: (row) => (row as { id: number }).id
        })
    })
    const first = await query.select(mapper).page(2)
    expect(first.items).toEqual([10, 20])
    expect(mapper).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(1)
    expect((await query.after(first.next!).select(mapper).page(2)).items).toEqual([30])
    expect(mapper).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledTimes(2)
  })

  it('passes indexed native key seeks and bounded lookahead through the original execute callback', async () => {
    const values = Array.from({ length: 128 }, (_, id) => ({ id }))
    let comparisons = 0
    let advances = 0
    const execute: IRecordQuerySource['execute'] = vi.fn(
      (input: Parameters<IRecordQuerySource['execute']>[0]) => {
        const after = input.steps?.find((step) => step.operation === 'after')
        const limit = input.steps?.find((step) => step.operation === 'limit')
        expect(input.steps?.[0]).toEqual({ operation: 'order', by: 'key', direction: 'asc' })
        let lower = 0
        let upper = values.length
        while (lower < upper) {
          const middle = Math.floor((lower + upper) / 2)
          comparisons++
          if (after !== undefined && values[middle]!.id <= (after.key as number)) lower = middle + 1
          else upper = middle
        }
        return ownedRows(
          values.slice(lower, lower + (limit?.operation === 'limit' ? limit.count : values.length)),
          undefined,
          undefined,
          {
            key: (row) => (row as { id: number }).id,
            onNext: () => advances++
          }
        )
      }
    )
    const query = createRecordQuery<{ id: number }>({
      pushdown: {
        source: 'indexed-keyset',
        index: 'primary',
        operators: [],
        operations: ['order', 'after', 'limit']
      },
      nativeSteps: true,
      execute
    }).requirePushdown()
    const first = await query.page(2)
    expect(first.items).toEqual([{ id: 0 }, { id: 1 }])
    comparisons = 0
    advances = 0
    expect((await query.after(first.next!).page(2)).items).toEqual([{ id: 2 }, { id: 3 }])
    expect(comparisons).toBeLessThanOrEqual(8)
    expect(advances).toBe(3)
  })

  it('rejects condition, order, source and organization cursor mismatches before any new I/O', async () => {
    const execute = vi.fn(() =>
      ownedRows([{ id: 1 }, { id: 2 }], undefined, undefined, {
        key: (row) => (row as { id: number }).id
      })
    )
    const identity = Object.freeze({})
    const order = (row: { id: number }) => row.id
    const query = createRecordQuery<{ id: number }>({
      pushdown: noPushdown,
      cursorSource: identity,
      execute
    })
      .where({ id: { gt: 0 } })
      .orderBy(order)
    const first = await query.page(1)
    expect(
      (
        await createRecordQuery<{ id: number }>({
          pushdown: noPushdown,
          cursorSource: identity,
          execute
        })
          .after(first.next!)
          .where({ id: { gt: 0 } })
          .orderBy(order)
          .page(1)
      ).items
    ).toEqual([{ id: 2 }])
    await expect(query.orderBy(order, 'desc').after(first.next!).page(1)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    await expect(query.where({ id: 2 }).after(first.next!).page(1)).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT'
    })
    await expect(
      createRecordQuery<{ id: number }>({ pushdown: noPushdown, execute })
        .where({ id: { gt: 0 } })
        .orderBy(order)
        .after(first.next!)
        .page(1)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      query.after(first.next!).page(1, { orgId: '12345678-1234-1234-1234-123456789abc' })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(query.page(0)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(() => query.after({} as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    const reflected = Object.create(
      Object.getPrototypeOf(first.next),
      Object.getOwnPropertyDescriptors(first.next!)
    )
    expect(() => query.after(reflected)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    const read = vi.fn()
    const unknown = Object.defineProperty({}, 'read', { get: read })
    expect(() => query.after(unknown as never)).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(read).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('detaches an opaque comparator anchor before mutable page items leave the operation', async () => {
    const values = [
      { id: 'b', value: 2 },
      { id: 'a', value: 1 },
      { id: 'c', value: 3 }
    ]
    const compare = (left: (typeof values)[number], right: (typeof values)[number]) =>
      left.value - right.value
    const query = createRecordQuery<(typeof values)[number]>({
      pushdown: noPushdown,
      execute: () =>
        ownedRows(values, undefined, undefined, {
          key: (row) => (row as (typeof values)[number]).id
        })
    })
      .orderByComparator(compare)
      .limit(3)
    const first = await query.page(1)
    expect(first.items[0]?.id).toBe('a')
    expect(
      query
        .after(first.next!)
        .explain()
        .client.map((step) => step.operation)
    ).toEqual(['after', 'comparator', 'limit'])
    first.items[0]!.value = 99
    expect((await query.after(first.next!).limit(2).all()).map((row) => row.id)).toEqual(['b', 'c'])
    expect((await query.after(first.next!).page(1)).items[0]?.id).toBe('b')
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
  it('uses the captured original resource key and keeps both cleanup Promises cached while mapping drains', async () => {
    /** The original host supplies one existing private key without changing global Symbol. */
    const key: typeof Symbol.asyncDispose = Symbol(
      'query-original-resource-key'
    ) as typeof Symbol.asyncDispose
    /** Native ownership stays with the original fixture owner under that exact key. */
    let closed = 0
    const native = ownedRows(
      [1],
      () => {
        closed++
      },
      undefined,
      { asyncDisposeKey: key }
    )
    /** The physical source is a legitimate borrowed resource, not a registered transaction view. */
    const source: IStorageIterator<readonly [string, unknown]> = {
      next: () => native.next(),
      dispose: () => native.dispose(),
      [key]: () => native[key](),
      [Symbol.asyncIterator]() {
        return this
      }
    }
    /** Source author facts are captured once, rather than inspected during each cleanup. */
    let keyReads = 0
    const query = createRecordQuery<number>({
      pushdown: noPushdown,
      get asyncDisposeKey(): typeof Symbol.asyncDispose {
        keyReads++
        return key
      },
      execute: () => source
    })
    /** The original mapped read remains accepted until its actual asynchronous value settles. */
    const entered = Promise.withResolvers<void>()
    const mapping = Promise.withResolvers<number>()
    const stream = query
      .select(async () => {
        entered.resolve()
        return mapping.promise
      })
      .stream()
    expect(typeof stream[key]).toBe('function')
    const pending = stream.next()
    await entered.promise
    /** Main and report-only symbolic cleanup retain the original independent cached paths. */
    const main = stream.dispose()
    const symbolic = stream[key]()
    expect(stream.dispose()).toBe(main)
    expect(stream[key]()).toBe(symbolic)
    expect(symbolic).not.toBe(main)
    await Promise.resolve()
    expect(closed).toBe(0)
    mapping.resolve(7)
    await expect(pending).resolves.toEqual({ done: false, value: 7 })
    await main
    await symbolic
    expect(closed).toBe(1)
    expect(keyReads).toBe(1)
  })

  it('reports a custom-key cleanup failure through the original symbolic entry and preserves its exact cause', async () => {
    /** Observe the original host exception channel without introducing another production reporter. */
    const reported: unknown[] = []
    const enqueue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
      try {
        callback()
      } catch (error) {
        reported.push(error)
      }
    })
    try {
      /** Original native cleanup fails once under the host-supplied key. */
      const key: typeof Symbol.asyncDispose = Symbol(
        'query-cleanup-resource-key'
      ) as typeof Symbol.asyncDispose
      const cause = new RangeError('original cursor cleanup failed')
      const close = vi.fn(() => {
        throw cause
      })
      const native = ownedRows([1], close, undefined, { asyncDisposeKey: key })
      /** Report entry calls retain the physical source receiver and original cached Promise. */
      const report = vi.fn(function (this: IStorageIterator<readonly [string, unknown]>) {
        expect(this).toBe(source)
        return native[key]()
      })
      const source: IStorageIterator<readonly [string, unknown]> = {
        next: () => native.next(),
        dispose: () => native.dispose(),
        [key]: report,
        [Symbol.asyncIterator]() {
          return this
        }
      }
      const stream = createRecordQuery<number>({
        pushdown: noPushdown,
        asyncDisposeKey: key,
        execute: () => source
      }).stream()
      expect(typeof stream[key]).toBe('function')
      /** Main cleanup keeps the exact native-normalized error and original cause. */
      const main = stream.dispose()
      const failure = await main.catch((error: unknown) => error)
      expect(failure).toMatchObject({ code: 'INVALID_ARGUMENT', cause })
      const symbolic = stream[key]()
      expect(stream[key]()).toBe(symbolic)
      expect(stream.dispose()).toBe(main)
      await expect(symbolic).resolves.toBeUndefined()
      expect(report).toHaveBeenCalledTimes(1)
      expect(reported).toEqual([failure])
      expect(close).toHaveBeenCalledTimes(1)
      expect((failure as Error).cause).toBe(cause)
    } finally {
      enqueue.mockRestore()
    }
  })

  it('validates only an explicitly supplied resource key before source execution', () => {
    /** Invalid author facts fail through the existing descriptor boundary without opening a cursor. */
    const execute = vi.fn(() => ownedRows([]))
    expect(() =>
      createRecordQuery({ pushdown: noPushdown, execute, asyncDisposeKey: 'bad-key' as never })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    /** Reflection failure keeps the original cause rather than inventing another resource key. */
    const cause = new Error('resource key getter failed')
    expect(() =>
      createRecordQuery({
        pushdown: noPushdown,
        execute,
        get asyncDisposeKey(): never {
          throw cause
        }
      })
    ).toThrowError(expect.objectContaining({ cause }))
    expect(execute).not.toHaveBeenCalled()
  })

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
