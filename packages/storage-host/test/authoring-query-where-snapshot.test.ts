import { describe, expect, it } from 'vitest'
import { snapshotStorageWhere, compileStorageQueryCondition } from '../src/authoring/query.js'

describe('native canonical where authoring', () => {
  it('shares the canonical AST and original membership predicate semantics', () => {
    const condition = snapshotStorageWhere({ total: { in: [2, 3] } })
    const test = compileStorageQueryCondition<{ total: number }>(condition)
    expect(test({ total: 2 })).toBe(true)
    expect(test({ total: 1 })).toBe(false)
  })
})
