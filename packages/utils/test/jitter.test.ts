import { afterEach, describe, expect, it, vi } from 'vitest'
import { jitter as rootJitter } from '../src/index.ts'
import { jitter } from '../src/number.ts'

afterEach(() => vi.restoreAllMocks())

describe('jitter', () => {
  it('only shortens the deadline within both inclusive bounds', () => {
    expect(jitter(100, 0.2, () => 0)).toBe(100)
    expect(jitter(100, 0.2, () => 0.5)).toBe(90)
    expect(jitter(100, 0.2, () => 1)).toBe(80)
  })

  it('supports zero values and the full ratio domain', () => {
    expect(jitter(0, 1, () => 1)).toBe(0)
    expect(jitter(100, 0, () => 1)).toBe(100)
    expect(jitter(100, 1, () => 1)).toBe(0)
    expect(jitter(Number.MAX_VALUE, 1, () => 0)).toBe(Number.MAX_VALUE)
    expect(jitter(Number.MAX_VALUE, 1, () => 1)).toBe(0)
  })

  it.each([-1, NaN, Infinity, -Infinity])('rejects invalid value %s before sampling', (value) => {
    /** Invalid arguments must not invoke a caller-owned random source. */
    const random = vi.fn(() => 0.5)
    expect(() => jitter(value, 0.2, random)).toThrowError(
      expect.objectContaining({
        name: 'RangeError',
        source: 'foundation.utils',
        code: 'INVALID_ARGUMENT'
      })
    )
    expect(random).not.toHaveBeenCalled()
  })

  it.each([-0.1, 1.1, NaN, Infinity])('rejects invalid ratio %s before sampling', (ratio) => {
    /** A rejected ratio cannot consume randomness or extend a deadline. */
    const random = vi.fn(() => 0.5)
    expect(() => jitter(100, ratio, random)).toThrowError(
      expect.objectContaining({
        name: 'RangeError',
        source: 'foundation.utils',
        code: 'INVALID_ARGUMENT'
      })
    )
    expect(random).not.toHaveBeenCalled()
  })

  it.each([-0.1, 1.1, NaN, Infinity])('rejects out-of-domain random result %s', (sample) => {
    expect(() => jitter(100, 0.2, () => sample)).toThrowError(
      expect.objectContaining({
        name: 'RangeError',
        source: 'foundation.utils',
        code: 'INVALID_ARGUMENT'
      })
    )
  })

  it('retains callback errors on cause without changing their identity or stack', () => {
    /** A frozen callback error proves jitter wraps rather than rewriting the original. */
    const cause = Object.freeze(new TypeError('random source failed'))
    /** Compare the original stack after failure to prove it remains intact. */
    const stack = cause.stack
    /** A failing sample must not be retried. */
    const random = vi.fn(() => {
      throw cause
    })
    /** Capture the wrapper to check its native type and exact cause identity. */
    let failure: unknown
    try {
      jitter(100, 0.2, random)
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(RangeError)
    expect(failure).toMatchObject({ source: 'foundation.utils', code: 'INVALID_ARGUMENT' })
    expect((failure as RangeError).cause).toBe(cause)
    expect(random).toHaveBeenCalledOnce()
    expect(cause.stack).toBe(stack)
  })

  it('uses one Math.random sample by default and shares the root export', () => {
    /** A deterministic native sampler checks the default without depending on random outcomes. */
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(jitter(100, 0.2)).toBe(90)
    expect(random).toHaveBeenCalledOnce()
    expect(rootJitter).toBe(jitter)
  })
})
