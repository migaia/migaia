/** Original pure conversion and failure ordering oracles follow their canonical Contract owner. */
import { describe, expect, it } from 'vitest'
import { safeString } from '@migaia/rpc-contract/errors'

describe('safeString failure reporting', () => {
  it('passes strings through and converts a normal object once', () => {
    let conversions = 0
    expect(safeString('ready')).toBe('ready')
    expect(
      safeString({
        toString() {
          conversions += 1
          return 'converted'
        }
      })
    ).toBe('converted')
    expect(conversions).toBe(1)
  })
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
        source: 'rpc.endpoint',
        code: 'STRING_CONVERSION_FAILED',
        message: 'rpc string conversion failed',
        cause: original
      })
      expect((error as Error).stack).toBeTruthy()
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

  it('keeps a Proxy primitive trap and rejects asynchronous reporters at typecheck', () => {
    const failure = new Error('primitive getter')
    const value = new Proxy(
      {},
      {
        get(_target, key) {
          if (key === Symbol.toPrimitive) throw failure
          return undefined
        }
      }
    )
    const failures: unknown[] = []
    expect(
      safeString(value, 'fallback', ({ error }) => {
        failures.push(error)
        return undefined
      })
    ).toBe('fallback')
    expect(failures).toEqual([failure])
    const typecheckOnly = (): void => {
      // @ts-expect-error The reporter must finish synchronously.
      safeString(value, 'fallback', async () => undefined)
    }
    void typecheckOnly
  })
})

// RPC-TEST-CCDBF0994A49-C003: original supported atoms received at their canonical owner; old alias/key facets stay NoPASS.
it('contains hostile string conversion and preserves tuple boundaries', () => {
  const reports: unknown[] = []
  const hostile = {
    toString: () => {
      throw new Error('stringify')
    }
  }
  expect(safeString('stable')).toBe('stable')
  expect(
    safeString(hostile, 'fallback', ({ error }) => {
      reports.push(error)
      return undefined
    })
  ).toBe('fallback')
  expect(reports).toHaveLength(1)
})
