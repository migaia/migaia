import { describe, expect, it } from 'vitest'
import {
  attachErrorIdentity,
  attachSecondaryErrors,
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

  it('keeps the two-argument path and delegates distinct conflicts and write failures to hooks', () => {
    const original = new Error('original')
    const sameValue = attachErrorIdentity(original, { source: '@test', code: 'X' })
    expect(attachErrorIdentity(sameValue, { source: '@test', code: 'X' })).toBe(original)

    const conflictFallback = new Error('conflict fallback')
    expect(
      attachErrorIdentity(
        original,
        { source: '@other', code: 'X' },
        {
          onConflict: ({ target, key, existing, incoming }) => {
            expect(target).toBe(original)
            expect({ key, existing, incoming }).toEqual({
              key: 'source',
              existing: '@test',
              incoming: '@other'
            })
            return conflictFallback
          }
        }
      )
    ).toBe(conflictFallback)

    const frozen = Object.freeze(new Error('frozen'))
    const failureFallback = new Error('failure fallback')
    expect(
      attachErrorIdentity(
        frozen,
        { source: '@test', code: 'X' },
        {
          onFailure: ({ target, key, incoming, cause }) => {
            expect(target).toBe(frozen)
            expect(key).toBe('source')
            expect(incoming).toBe('@test')
            expect(cause).toBeInstanceOf(TypeError)
            return failureFallback
          }
        }
      )
    ).toBe(failureFallback)

    const mixedFallback = Object.defineProperty(new Error('mixed fallback'), 'code', {
      value: 'OTHER'
    })
    let mixedFailure: unknown
    try {
      attachErrorIdentity(
        frozen,
        { source: '@test', code: 'X' },
        { onFailure: () => mixedFallback }
      )
    } catch (error) {
      mixedFailure = error
    }
    expect(mixedFailure).toBeInstanceOf(TypeError)
    expect((mixedFailure as Error).cause).toBe(mixedFallback)
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

  it('attaches ordered secondary failures without replacing the primary error', () => {
    const primary = new Error('primary')
    const secondary = [new Error('cleanup-1'), new Error('cleanup-2')]
    expect(attachSecondaryErrors(primary, secondary)).toBe(primary)
    expect(Object.hasOwn(primary, 'cause')).toBe(false)
    expect((primary as Error & { readonly cause?: unknown }).cause).toBeUndefined()
    expect((primary as Error & { readonly errors?: readonly unknown[] }).errors).toEqual(secondary)
    expect(Object.getOwnPropertyDescriptor(primary, 'errors')).toMatchObject({
      enumerable: false,
      writable: false
    })
  })

  it('falls back to a primary-first aggregate for every hostile primary shape', () => {
    const secondary = new Error('cleanup')
    const throwingErrors = Object.defineProperty({}, 'errors', {
      configurable: true,
      get: () => {
        throw new Error('errors getter failed')
      }
    })
    const cases: readonly unknown[] = [
      'primitive primary',
      Object.freeze(new Error('frozen primary')),
      Object.defineProperty(new Error('non-array errors'), 'errors', {
        configurable: true,
        value: 'not-an-array'
      }),
      throwingErrors
    ]
    for (const primary of cases) {
      const attached = attachSecondaryErrors(primary, [secondary])
      expect(attached).toBeInstanceOf(AggregateError)
      expect((attached as AggregateError).errors[0]).toBe(primary)
      expect((attached as AggregateError).errors[1]).toBe(secondary)
    }
  })

  it('extends existing error lists and native aggregates without losing order or identity', () => {
    const originalCause = new Error('original cause')
    const primary = new Error('primary', { cause: originalCause }) as Error & {
      readonly errors?: readonly unknown[]
    }
    const prior = new Error('prior')
    Object.defineProperty(primary, 'errors', {
      configurable: true,
      value: Object.freeze([prior]),
      writable: false
    })
    const secondary = new Error('cleanup')
    expect(attachSecondaryErrors(primary, [secondary])).toBe(primary)
    expect(primary.cause).toBe(originalCause)
    expect(primary.errors).toEqual([prior, secondary])

    const aggregate = new AggregateError([primary], 'aggregate')
    expect(attachSecondaryErrors(aggregate, [secondary])).toBe(aggregate)
    expect(aggregate.errors).toEqual([primary, secondary])
    expect(aggregate.stack).toContain('aggregate')
  })

  it('preserves identity for an empty cleanup list and duplicate secondary failures', () => {
    const primary = new Error('primary')
    const secondary = new Error('same cleanup')
    expect(attachSecondaryErrors(primary, [])).toBe(primary)
    expect(attachSecondaryErrors(primary, [secondary, secondary])).toBe(primary)
    expect((primary as Error & { readonly errors?: readonly unknown[] }).errors).toEqual([
      secondary,
      secondary
    ])
  })
})
