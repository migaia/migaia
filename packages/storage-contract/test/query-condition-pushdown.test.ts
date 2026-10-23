import { describe, expect, it, vi } from 'vitest'
import {
  createVectorQuery,
  createStorageIteratorLifetime,
  compileStorageQueryCondition,
  type IQueryCondition,
  type IStorageIterator,
  type IStorageKey,
  type IVectorHit,
  type IVectorQueryInput
} from '../src/index.js'

/** A native source fixture borrows the production iterator owner for its finite hits. */
function rows(
  values: readonly IVectorHit<{ value: number | string }, boolean>[]
): IStorageIterator<readonly [IStorageKey, IVectorHit<{ value: number | string }, boolean>]> {
  let position = 0
  const lifetime = createStorageIteratorLifetime<
    readonly [IStorageKey, IVectorHit<{ value: number | string }, boolean>]
  >({ close: async () => undefined, report: () => undefined })
  const iterator = {
    next: () =>
      lifetime.advance(async () =>
        position < values.length
          ? { done: false, value: [String(position), values[position++]!] as const }
          : { done: true, value: undefined }
      ),
    dispose: lifetime.dispose,
    return: lifetime.returned,
    [Symbol.asyncDispose]: lifetime.symbolic,
    [Symbol.asyncIterator]: () => iterator
  }
  return iterator
}
/** This fixture translator has exactly the numeric range domain of its native engine. */
function numeric(condition: IQueryCondition): boolean {
  return condition.kind === 'field'
    ? typeof condition.value === 'number'
    : condition.kind === 'not'
      ? numeric(condition.condition)
      : condition.conditions.every(numeric)
}

describe('exact native condition-domain admission', () => {
  it('captures the original callback once and pushes only the supported domain before topK', async () => {
    let reads = 0
    const pushdown = {
      source: 'numeric-native',
      operators: ['gte'] as const,
      operations: ['where', 'topK'] as const,
      get canPushCondition() {
        reads += 1
        return function (this: unknown, condition: IQueryCondition) {
          expect(this).toBe(pushdown)
          return numeric(condition)
        }
      }
    }
    const execute = vi.fn((input: IVectorQueryInput) => {
      const tests = input.conditions.map((condition) =>
        compileStorageQueryCondition<{ value: number | string }>(condition)
      )
      return rows(
        [
          { id: 'first', score: 2, payload: { value: 1 } },
          { id: 'second', score: 1, payload: { value: 3 } }
        ]
          .filter((row) => tests.every((test) => test(row.payload)))
          .slice(0, input.topK)
      )
    })
    const query = createVectorQuery<{ value: number | string }>({ pushdown, execute })
    Object.defineProperty(pushdown, 'canPushCondition', { value: () => true })
    const accepted = query
      .where({ value: { gte: 2 } })
      .topK(1)
      .requirePushdown()
    expect(accepted.explain().client).toEqual([])
    await expect(accepted.all()).resolves.toMatchObject([{ id: 'second' }])
    const rejected = query.where({ value: { gte: 'b' } }).topK(1)
    expect(rejected.explain().client[0]?.operation).toBe('where')
    const before = execute.mock.calls.length
    await expect(rejected.requirePushdown().all()).rejects.toMatchObject({
      code: 'QUERY_NOT_PUSHABLE'
    })
    expect(execute).toHaveBeenCalledTimes(before)
    expect(reads).toBe(1)
  })
  it('keeps callback failures on the original query failure path', () => {
    const cause = new Error('native translator failed')
    const query = createVectorQuery<{ value: number | string }>({
      pushdown: {
        source: 'failing-native',
        operators: ['gte'],
        operations: ['where', 'topK'],
        canPushCondition: () => {
          throw cause
        }
      },
      execute: () => rows([])
    })
      .where({ value: { gte: 1 } })
      .topK(1)
    expect(() => query.explain()).toThrowError(cause)
    expect(cause).toMatchObject({ code: 'INVALID_ARGUMENT' })
  })
})
