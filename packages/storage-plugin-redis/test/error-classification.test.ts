import { describe, expect, it } from 'vitest'
import { redisError } from '../src/errors.ts'
import { RedisErrorCode } from '../src/error-code.ts'

describe('redisError classification', () => {
  it('keeps the native class when replacing a frozen cause', () => {
    for (const Native of [TypeError, RangeError, SyntaxError]) {
      const cause = Object.freeze(new Native('frozen native'))
      const error = redisError(RedisErrorCode.decodeFailed, cause)
      expect(error).toBeInstanceOf(Native)
      expect(error).toMatchObject({ code: RedisErrorCode.decodeFailed })
      expect(error.cause).toBe(cause)
    }
  })

  it('replaces a cause whose identity conflicts and wraps a non-error', () => {
    const coded = Object.defineProperty(new Error('coded'), 'code', { value: 'OTHER' })
    Object.defineProperty(coded, 'source', { value: 'other' })
    const fromCoded = redisError(RedisErrorCode.failed, coded)
    expect(fromCoded).toMatchObject({ code: RedisErrorCode.failed })
    expect([fromCoded, fromCoded.cause]).toContain(coded)
    expect(redisError(RedisErrorCode.failed, 'text')).toMatchObject({
      code: RedisErrorCode.failed,
      cause: 'text'
    })
  })
})
