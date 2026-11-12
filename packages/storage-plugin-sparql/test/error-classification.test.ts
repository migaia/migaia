import { describe, expect, it } from 'vitest'
import { sparqlError } from '../src/errors.ts'
import { SparqlErrorCode } from '@migaia/storage-contract/error-code'

describe('sparqlError classification', () => {
  it('keeps the native class when replacing a frozen cause', () => {
    for (const Native of [TypeError, RangeError]) {
      const cause = Object.freeze(new Native('frozen native'))
      const error = sparqlError(SparqlErrorCode.requestFailed, cause)
      expect(error).toBeInstanceOf(Native)
      expect(error).toMatchObject({ code: SparqlErrorCode.requestFailed })
      expect(error.cause).toBe(cause)
    }
  })

  it('replaces a native error whose identity conflicts', () => {
    const conflicting = new TypeError('coded')
    Object.defineProperty(conflicting, 'code', { value: 'OTHER' })
    Object.defineProperty(conflicting, 'source', { value: 'other' })
    const error = sparqlError(SparqlErrorCode.responseInvalid, conflicting)
    expect(error).toMatchObject({ code: SparqlErrorCode.responseInvalid })
    expect([error, error.cause]).toContain(conflicting)
  })
})
