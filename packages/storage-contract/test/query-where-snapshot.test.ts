import { describe, expect, it } from 'vitest'
import { snapshotStorageWhere, compileStorageQueryCondition } from '../src/index.js'

describe('native canonical where authoring', () => {
  it('shares one frozen AST and the original single-read predicate semantics', () => {
    let reads = 0
    const condition = snapshotStorageWhere({
      get total() {
        reads += 1
        return { in: [2, 3] }
      }
    })
    expect(reads).toBe(1)
    expect(Object.isFrozen(condition)).toBe(true)
    const test = compileStorageQueryCondition<{ total: number }>(condition)
    expect(test({ total: 2 })).toBe(true)
    expect(test({ total: 1 })).toBe(false)
    expect(reads).toBe(1)
  })
  it('preserves the original getter cause and INVALID_ARGUMENT admission error', () => {
    const cause = new Error('where getter failed')
    expect(() =>
      snapshotStorageWhere({
        get total() {
          throw cause
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT', cause }))
  })
})
