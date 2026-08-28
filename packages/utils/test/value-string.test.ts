import { describe, expect, it } from 'vitest'
import { format } from '../src/string.js'
import { isBlankString, isEmptyValue, isNullish, isPrimitive } from '../src/value.js'

describe('value predicates', () => {
  it('recognizes business emptiness without collapsing valid falsy values', () => {
    for (const value of [undefined, null, Number.NaN, '', ' \n\t'])
      expect(isEmptyValue(value)).toBe(true)
    for (const value of [0, 0n, false, [], {}, '0']) expect(isEmptyValue(value)).toBe(false)
    expect(isNullish(undefined)).toBe(true)
    expect(isNullish(null)).toBe(true)
    expect(isNullish(Number.NaN)).toBe(false)
    expect(isBlankString('　')).toBe(true)
    expect(isBlankString(0)).toBe(false)
  })

  it('recognizes every primitive without allocating or admitting callable objects', () => {
    for (const value of [undefined, null, '', 0, Number.NaN, 0n, false, Symbol('x')])
      expect(isPrimitive(value)).toBe(true)
    for (const value of [{}, [], () => undefined, new Number(1)])
      expect(isPrimitive(value)).toBe(false)
  })
})

describe('string format', () => {
  it('formats flat and nested own values while preserving valid falsy values', () => {
    expect(
      format('{name}:{count}:{enabled}:{empty}:{missing}', {
        name: 'stock',
        count: 0,
        enabled: false,
        empty: null
      })
    ).toBe('stock:0:false::{missing}')
    expect(format('{user.name}', { user: { name: 'Kaeo' } })).toBe('Kaeo')
  })

  it('supports custom placeholders and doubled delimiter escapes', () => {
    expect(
      format('Hello ${name}', { name: 'Kaeo' }, { placeholder: { open: '${', close: '}' } })
    ).toBe('Hello Kaeo')
    expect(
      format(
        '[[[[name]]]] [[name]]',
        { name: 'Kaeo' },
        {
          placeholder: { open: '[[', close: ']]' }
        }
      )
    ).toBe('[[name]] Kaeo')
    expect(format('{{name}}', { name: 'ignored' })).toBe('{name}')
  })

  it('supports missing and nullish policies without prototype traversal', () => {
    expect(format('{missing}', {}, { missing: 'empty' })).toBe('')
    expect(format('{value}', { value: null }, { nullish: 'stringify' })).toBe('null')
    expect(format('{toString}', {})).toBe('{toString}')
    expect(format('{__proto__.polluted}', {})).toBe('{__proto__.polluted}')
    expect(() => format('{missing}', {}, { missing: 'throw' })).toThrow(
      expect.objectContaining({ code: 'FORMAT_VALUE_MISSING', source: '@migaia/utils' })
    )
  })

  it('preserves hostile getter and coercion failures on the cause chain', () => {
    const readFailure = new Error('read failed')
    const values = Object.defineProperty({}, 'value', {
      enumerable: true,
      get: () => {
        throw readFailure
      }
    })
    try {
      format('{value}', values)
      expect.fail('expected hostile getter failure')
    } catch (error) {
      expect(error).toMatchObject({ code: 'FORMAT_INVALID', cause: readFailure })
    }
    const coercionFailure = new Error('coercion failed')
    const hostile = {
      [Symbol.toPrimitive]: () => {
        throw coercionFailure
      }
    }
    try {
      format('{value}', { value: hostile })
      expect.fail('expected hostile coercion failure')
    } catch (error) {
      expect(error).toMatchObject({ code: 'FORMAT_INVALID', cause: coercionFailure })
    }
  })

  it('rejects ambiguous or hostile option access with package-coded native errors', () => {
    expect(() =>
      format('{value}', { value: 1 }, { placeholder: { open: '{', close: '{' } })
    ).toThrow(expect.objectContaining({ code: 'FORMAT_INVALID', source: '@migaia/utils' }))
    const options = Object.defineProperty({}, 'placeholder', {
      get: () => {
        throw new Error('option read failed')
      }
    })
    expect(() => format('{value}', { value: 1 }, options)).toThrow(
      expect.objectContaining({ code: 'FORMAT_INVALID', source: '@migaia/utils' })
    )
  })
})
