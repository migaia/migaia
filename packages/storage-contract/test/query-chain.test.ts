import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  compileStorageWhere,
  QueryOperator,
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
