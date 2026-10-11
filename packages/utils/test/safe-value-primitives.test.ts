import { describe, expect, it } from 'vitest'
import { createSafeRecord } from '../src/object.js'
import { tryString } from '../src/string.js'
import { isSafeIntegerValue } from '../src/value.js'

describe('safe value primitives', () => {
  it('keeps strings and performs native conversion exactly once', () => {
    /** Conversion count exposes accidental repeated coercion by a reporting wrapper. */
    let conversions = 0
    /** The value retains its own conversion receiver while Utils captures the result. */
    const value = {
      toString() {
        conversions += 1
        expect(this).toBe(value)
        return 'converted'
      }
    }
    expect(tryString('stable')).toEqual({ threw: false, value: 'stable' })
    expect(tryString(value)).toEqual({ threw: false, value: 'converted' })
    expect(conversions).toBe(1)
    expect(tryString(null)).toEqual({ threw: false, value: 'null' })
    expect(tryString(Symbol('key'))).toEqual({ threw: false, value: 'Symbol(key)' })
  })

  it('returns the exact thrown value without fallback, wrapping, or a second coercion', () => {
    /** A non-Error failure proves the captured value is not rebuilt into a native error. */
    const failure = { reason: 'conversion' }
    /** Read count distinguishes one native String attempt from repeated primitive inspection. */
    let reads = 0
    /** A hostile primitive-method getter is one concrete supported coercion failure. */
    const value = new Proxy(
      {},
      {
        get(_target, key) {
          expect(key).toBe(Symbol.toPrimitive)
          reads += 1
          throw failure
        }
      }
    )
    /** The result is data; fallback and reporting belong to the consuming boundary. */
    const conversion = tryString(value)
    expect(conversion.threw).toBe(true)
    if (conversion.threw) expect(conversion.error).toBe(failure)
    expect(reads).toBe(1)
  })

  it('accepts only safe integer numbers without coercion', () => {
    expect(isSafeIntegerValue(0)).toBe(true)
    expect(isSafeIntegerValue(Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(isSafeIntegerValue(Number.MIN_SAFE_INTEGER)).toBe(true)
    for (const value of [Number.NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, '1', 1n, null])
      expect(isSafeIntegerValue(value)).toBe(false)
  })

  it('creates independent null-prototype dictionaries with ordinary writable key descriptors', () => {
    /** Untrusted names must be stored as data without inherited setter behavior. */
    const record = createSafeRecord<number>()
    record['__proto__'] = 1
    record['constructor'] = 2
    expect(Object.getPrototypeOf(record)).toBeNull()
    expect(Object.getOwnPropertyDescriptor(record, '__proto__')).toEqual({
      value: 1,
      writable: true,
      enumerable: true,
      configurable: true
    })
    expect(record['constructor']).toBe(2)
    expect(createSafeRecord()).not.toBe(record)
  })
})
