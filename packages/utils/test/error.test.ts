import { describe, expect, it } from 'vitest'
import {
  attachErrorIdentity,
  combineErrors,
  toError,
  UtilsErrorCode,
  walkErrorCauses
} from '../src/error.js'

describe('error primitives', () => {
  it('preserves error identity and rejects conflicting tags', () => {
    const error = new Error('x')
    expect(attachErrorIdentity(error, { source: '@test', code: 'X' })).toBe(error)
    expect(() => attachErrorIdentity(error, { source: '@other', code: 'X' })).toThrow()
    expect(UtilsErrorCode.invalidArgument).toBe('INVALID_ARGUMENT')
  })

  it('keeps non-error causes reachable', () => {
    const cause = { bad: true }
    expect(toError(cause).cause).toBe(cause)
    expect(combineErrors([] as unknown[], 'empty')).toBeUndefined()
  })

  it('keeps hostile cause access failures inside the bounded traversal', () => {
    const failure = new Error('cause getter failed')
    const hostile = Object.defineProperty({}, 'cause', {
      configurable: true,
      get: () => {
        throw failure
      }
    })
    const walked = walkErrorCauses(hostile)
    expect(walked[0]).toBe(hostile)
    expect(walked).toContain(failure)
  })

  it('throws an aggregate when the input error iterable fails during iteration', () => {
    const iteratorFailure = new Error('iterator failed')
    const errors = {
      [Symbol.iterator](): Iterator<unknown> {
        return {
          next: () => {
            throw iteratorFailure
          }
        }
      }
    }
    expect(() => combineErrors(errors, 'combined')).toThrow(AggregateError)
    try {
      combineErrors(errors, 'combined')
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect((error as AggregateError).errors[0]).toBe(iteratorFailure)
    }
  })
})
