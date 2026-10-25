import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import { isSome, isNone, unwrapOr, mapMaybe, toUndefined, type IMaybe } from '../src/index.js'

describe('explicit optional values', () => {
  it('distinguishes a present undefined from absence and narrows both variants', () => {
    const present: IMaybe<undefined> = { some: true, value: undefined }
    const absent: IMaybe<undefined> = { some: false }
    expect(isSome(present)).toBe(true)
    expect(isNone(present)).toBe(false)
    expect(isSome(absent)).toBe(false)
    expect(isNone(absent)).toBe(true)
    expect(toUndefined(present)).toBeUndefined()
    expect(toUndefined(absent)).toBeUndefined()
    function inspect(value: IMaybe<number>) {
      if (isSome(value)) expectTypeOf(value.value).toEqualTypeOf<number>()
      if (isNone(value)) expectTypeOf(value).toEqualTypeOf<{ readonly some: false }>()
    }
    inspect({ some: true, value: 1 })
    inspect({ some: false })
  })

  it('uses a fallback only for absence and keeps present falsy values', () => {
    expect(unwrapOr({ some: false } as IMaybe<number>, 9)).toBe(9)
    for (const value of [0, false, '', undefined, null]) {
      const present: IMaybe<typeof value> = { some: true, value }
      expect(unwrapOr(present, value)).toBe(value)
      expect(toUndefined(present)).toBe(value)
    }
    function invalidTypes(value: IMaybe<number>) {
      // @ts-expect-error Fallback does not widen the original value domain.
      unwrapOr(value, 'wrong')
      // @ts-expect-error The value cannot be read before discriminant narrowing.
      return value.value
    }
    void invalidTypes
  })

  it('maps one present value exactly once and does not invoke the mapper for absence', () => {
    const mapper = vi.fn((value: number) => String(value))
    const absent: IMaybe<number> = { some: false }
    expect(mapMaybe(absent, mapper)).toBe(absent)
    expect(mapper).not.toHaveBeenCalled()
    expect(mapMaybe({ some: true, value: 2 }, mapper)).toEqual({ some: true, value: '2' })
    expect(mapper).toHaveBeenCalledExactlyOnceWith(2)
  })

  it('preserves mapper result identity rather than awaiting or copying it', () => {
    const result = Promise.resolve(2)
    const mapped = mapMaybe({ some: true, value: 1 }, () => result)
    expectTypeOf(mapped).toEqualTypeOf<IMaybe<Promise<number>>>()
    if (!isSome(mapped)) throw new Error('expected present result')
    expect(mapped.value).toBe(result)
  })

  it('retains the exact original mapper failure', () => {
    const original = Object.assign(new Error('caller mapper failed'), {
      source: 'caller',
      code: 'MAPPING_FAILED'
    })
    expect(() =>
      mapMaybe({ some: true, value: 1 }, () => {
        throw original
      })
    ).toThrow(original)
  })
  it('codes an original native mapper error while retaining its native type, instance and stack', () => {
    const original = new RangeError('mapper native error')
    const stack = original.stack
    expect(() =>
      mapMaybe({ some: true, value: 1 }, () => {
        throw original
      })
    ).toThrow(original)
    expect(original).toMatchObject({ source: 'foundation.utils', code: 'INVALID_ARGUMENT' })
    expect(original.stack).toBe(stack)
  })

  it('keeps frozen native errors first in the identity-attachment fallback and normalizes non-errors', () => {
    const original = Object.freeze(new TypeError('frozen mapper error'))
    try {
      mapMaybe({ some: true, value: 1 }, () => {
        throw original
      })
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(AggregateError)
      expect(error).toMatchObject({ source: 'foundation.utils', code: 'INVALID_ARGUMENT' })
      expect((error as AggregateError).errors[0]).toBe(original)
    }
    expect(() =>
      mapMaybe({ some: true, value: 1 }, () => {
        throw 42
      })
    ).toThrowError(
      expect.objectContaining({ source: 'foundation.utils', code: 'NON_ERROR_VALUE', cause: 42 })
    )
  })
})
