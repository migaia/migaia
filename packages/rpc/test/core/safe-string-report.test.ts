import { describe, expect, it } from 'vitest'
import { safeString } from '../../src/core/transport-kit.js'

describe('[A11] safeString failure reporting', () => {
  it('keeps one conversion and reports the original failure once', () => {
    const original = new Error('conversion failed')
    const failures: unknown[] = []
    let conversions = 0
    const value = {
      toString() {
        conversions += 1
        throw original
      }
    }
    expect(
      safeString(value, 'fallback', ({ error }) => {
        failures.push(error)
        return undefined
      })
    ).toBe('fallback')
    expect(conversions).toBe(1)
    expect(failures).toEqual([original])
  })

  it('throws a coded native TypeError without a reporter', () => {
    const original = new Error('conversion failed')
    const value = {
      [Symbol.toPrimitive]() {
        throw original
      }
    }
    try {
      safeString(value)
      throw new Error('safeString should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError)
      expect(error).toMatchObject({
        source: '@migaia/rpc/core',
        code: 'STRING_CONVERSION_FAILED',
        message: 'rpc string conversion failed',
        cause: original
      })
    }
  })

  it('keeps conversion and reporter failures in their original order', () => {
    const original = new Error('conversion failed')
    const reporterFailure = new Error('report failed')
    let reportCalls = 0
    try {
      safeString(
        {
          toString: () => {
            throw original
          }
        },
        'fallback',
        () => {
          reportCalls += 1
          throw reporterFailure
        }
      )
      throw new Error('safeString should have thrown')
    } catch (error) {
      expect(error).toMatchObject({ code: 'STRING_CONVERSION_FAILED' })
      const cause = (error as Error).cause
      expect(cause).toBeInstanceOf(AggregateError)
      expect((cause as AggregateError).errors).toEqual([original, reporterFailure])
    }
    expect(reportCalls).toBe(1)
  })
})
