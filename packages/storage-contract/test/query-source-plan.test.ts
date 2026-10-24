import { describe, expect, it, vi } from 'vitest'
import {
  createRecordQuery,
  createStorageIteratorLifetime,
  compileStorageQueryCondition,
  type IQueryCondition,
  type IRecordQueryInput,
  type IRecordQuerySource,
  type IStorageChange,
  type IStorageIterator,
  type IStorageKey
} from '../src/index.js'

/** Finite native fixtures retain the original iterator cleanup and accepted-advance owner. */
function values<T>(items: readonly T[]): IStorageIterator<T> {
  let position = 0
  const lifetime = createStorageIteratorLifetime<T>({
    close: async () => undefined,
    report: () => undefined
  })
  return {
    next: () =>
      lifetime.advance(async () =>
        position < items.length
          ? { done: false, value: items[position++]! }
          : { done: true, value: undefined }
      ),
    dispose: lifetime.dispose,
    return: lifetime.returned,
    [Symbol.asyncDispose]: lifetime.symbolic,
    [Symbol.asyncIterator]() {
      return this
    }
  }
}
/** Native group lookup acts on the exact immutable source selection, before shared conditions. */
const rows = [
  ['a', { group: 'one', total: 1 }],
  ['b', { group: 'two', total: 2 }]
] as const

/** One declared equality index recognizes only necessary AND terms in the original AST. */
function indexedGroup(conditions: readonly IQueryCondition[]): string | undefined {
  for (const condition of conditions) {
    if (
      condition.kind === 'field' &&
      condition.path[0] === 'group' &&
      condition.operator === 'eq' &&
      typeof condition.value === 'string'
    )
      return condition.value
    if (condition.kind === 'and') {
      const group = indexedGroup(condition.conditions)
      if (group !== undefined) return group
    }
  }
  return undefined
}
/** The callback sees only canonical leading conditions, never caller where objects. */
function choose(conditions: readonly IQueryCondition[]) {
  const group = indexedGroup(conditions)
  return {
    pushdown: {
      source: 'selected-native-records',
      operators: ['eq'] as const,
      operations: ['where', 'count'] as const,
      ...(group === undefined ? {} : { index: 'byGroup' })
    },
    selection: Object.freeze({ group }),
    sourceReason: group === undefined ? 'no leading indexed condition' : 'ordinary equality',
    sourceCandidates: [{ index: 'byTotal', reason: 'no matching condition' }]
  }
}
/** A real finite index chooses candidates before the original condition compiler checks them. */
const byGroup = new Map(rows.map((row) => [row[1].group, [row]]))
/** One original translator/filter consumes canonical conditions without rereading user getters. */
function read(input: IRecordQueryInput) {
  const predicates = input.conditions.map((condition) =>
    compileStorageQueryCondition<{ group: string; total: number }>(condition)
  )
  const selection = input.selection
  const group =
    selection !== null && typeof selection === 'object' && 'group' in selection
      ? selection.group
      : undefined
  const candidates = group === 'one' || group === 'two' ? (byGroup.get(group) ?? []) : rows
  return values<readonly [IStorageKey, unknown]>(
    candidates.filter(([, row]) => predicates.every((predicate) => predicate(row)))
  )
}

describe('terminal-local native source selection', () => {
  it('captures source and user getters once and explains the chosen source without I/O', async () => {
    let planReads = 0
    let groupReads = 0
    const selected: unknown[] = []
    const alternative = { index: 'byTotal', reason: 'no matching condition' }
    const execute = vi.fn((input: IRecordQueryInput) => {
      expect(input.selection).toBe(selected.at(-1))
      return read(input)
    })
    const source: IRecordQuerySource = {
      pushdown: { source: 'unselected', operators: [], operations: [] },
      execute,
      get plan() {
        planReads++
        return function (this: unknown, conditions: readonly IQueryCondition[]) {
          expect(this).toBe(source)
          expect(Object.isFrozen(conditions)).toBe(true)
          const planned = choose(conditions)
          selected.push(planned.selection)
          return { ...planned, sourceCandidates: [alternative] }
        }
      }
    }
    const query = createRecordQuery<{ group: string; total: number }>(source).where({
      get group() {
        groupReads++
        return 'one'
      }
    })
    Object.defineProperty(source, 'plan', {
      value: () => {
        throw new Error('changed author')
      }
    })
    const explanation = query.explain()
    expect(explanation).toMatchObject({
      index: 'byGroup',
      fullScan: false,
      sourceReason: 'ordinary equality',
      sourceCandidates: [{ index: 'byTotal', reason: 'no matching condition' }]
    })
    alternative.reason = 'later author mutation'
    expect(explanation.sourceCandidates?.[0]?.reason).toBe('no matching condition')
    expect(Object.isFrozen(explanation.sourceCandidates?.[0])).toBe(true)
    expect(execute).not.toHaveBeenCalled()
    expect(await query.all()).toEqual([rows[0][1]])
    expect(planReads).toBe(1)
    expect(groupReads).toBe(1)
    expect(selected).toHaveLength(2)
    /** A possible native fallback must stay conservative without hiding the chosen index. */
    const fallback = createRecordQuery<{ group: string; total: number }>({
      pushdown: { source: 'unselected', operators: [], operations: [] },
      plan: (conditions) => ({ ...choose(conditions), fullScan: true }),
      execute: read
    }).where({ group: 'one' })
    expect(fallback.explain()).toMatchObject({ index: 'byGroup', fullScan: true })
  })

  it('does not select from conditions after a callback or row-selection barrier', async () => {
    const plan = vi.fn(choose)
    const query = createRecordQuery<{ group: string; total: number }>({
      pushdown: { source: 'unselected', operators: [], operations: [] },
      plan,
      execute: read
    })
    expect(await query.limit(1).where({ group: 'two' }).all()).toEqual([])
    expect(plan.mock.calls[0]![0]).toEqual([])
    let calls = 0
    expect(
      await query
        .where((_row) => {
          calls++
          return true
        })
        .where({ group: 'two' })
        .all()
    ).toEqual([rows[1][1]])
    expect(calls).toBe(2)
    expect(plan.mock.calls[1]![0]).toEqual([])
    const first = query.where({ group: 'one' })
    const second = query.where({ group: 'two' })
    expect(await Promise.all([first.all(), second.all()])).toEqual([[rows[0][1]], [rows[1][1]]])
    expect(plan.mock.calls[2]![0]).not.toBe(plan.mock.calls[3]![0])
  })

  it('shares one selected fact with native reductions, scoped mutation reads and native watch', async () => {
    const captured: unknown[] = []
    const observed: unknown[] = []
    const original = values<IStorageChange>([])
    const source: IRecordQuerySource & { watch: NonNullable<IRecordQuerySource['watch']> } = {
      pushdown: { source: 'base', operators: [], operations: [] },
      plan: (conditions) => {
        const plan = choose(conditions)
        captured.push(plan.selection)
        return plan
      },
      execute: (input) => {
        observed.push(input.selection)
        return read(input)
      },
      reduce: (input) => {
        observed.push(input.selection)
        return values<readonly [IStorageKey, number]>([['scalar', 1]])
      },
      mutate: (_request, run) =>
        run({
          execute: (input) => {
            observed.push(input.selection)
            return read(input)
          },
          accept: () => true
        }),
      watch: (input) => {
        observed.push(input.selection)
        return original
      }
    }
    const query = createRecordQuery<{ group: string; total: number }>(source).where({
      group: 'one'
    })
    expect(await query.count()).toBe(1)
    expect(await query.delete()).toBe(1)
    expect(query.watch()).toBe(original)
    expect(captured).toHaveLength(3)
    expect(observed).toEqual(captured)
    observed.forEach((selection, index) => expect(selection).toBe(captured[index]))
    await original.dispose()
  })

  it('keeps fallback reduction selection local and preserves callback errors before I/O', async () => {
    const plan = vi.fn(choose)
    const execute = vi.fn(read)
    const query = createRecordQuery<{ group: string; total: number }>({
      pushdown: { source: 'base', operators: ['eq'], operations: ['where', 'count'] },
      plan,
      execute,
      reduce: () => {
        throw new Error('client predicate prevents native reduction')
      }
    }).where((row) => row.total > 1)
    let signalReads = 0
    let pageReads = 0
    expect(
      await query.count({
        get signal() {
          signalReads++
          return undefined
        },
        get pageSize() {
          pageReads++
          return 10
        }
      })
    ).toBe(1)
    expect(signalReads).toBe(1)
    expect(pageReads).toBe(1)
    expect(plan).toHaveBeenCalledTimes(1)
    const cause = new Error('native source choice failed')
    const failed = createRecordQuery({
      pushdown: { source: 'base', operators: [], operations: [] },
      plan: () => {
        throw cause
      },
      execute
    })
    expect(() => failed.explain()).toThrowError(cause)
    await expect(failed.all()).rejects.toBe(cause)
    expect(cause).toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(execute).toHaveBeenCalledTimes(1)
    /** An omitted author port leaves the exact legacy three-key input shape untouched. */
    const legacy = createRecordQuery<{ group: string; total: number }>({
      pushdown: { source: 'legacy', operators: ['eq'], operations: ['where'] },
      execute: (input) => {
        expect(Object.keys(input)).toEqual(['conditions', 'fields', 'ctx'])
        return read(input)
      }
    })
    expect(await legacy.where({ group: 'one' }).all()).toEqual([rows[0][1]])
  })
})
