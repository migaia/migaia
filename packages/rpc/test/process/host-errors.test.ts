import { describe, expect, it } from 'vitest'
import { RpcProcessErrorCode } from '../../src/process/error-code.js'
import { createProcessError } from '../../src/process/error.js'

describe('process Host error identity', () => {
  it.each([
    [RpcProcessErrorCode.hostInvalidOption, TypeError, 'process host options are invalid'],
    [RpcProcessErrorCode.hostClosed, Error, 'process host is closed']
  ] as const)('[A1] retains native type, original cause and field for %s', (code, type, text) => {
    /** A local primary stays reachable by identity without copying its stack. */
    const primary = new Error('local fixture failure')
    /** Host diagnostics name only the rejected field, never the deployment payload. */
    const error = createProcessError(code, primary, { field: 'strategy' })
    expect(error).toBeInstanceOf(type)
    expect(error).toMatchObject({
      source: '@migaia/rpc/process',
      code,
      message: text,
      cause: primary,
      detail: { field: 'strategy' }
    })
    expect(error.stack).toBeTruthy()
    expect(error.cause).toBe(primary)
  })
})
